// App Logic and Routing
const appContent = document.getElementById('app-content');
const audioElement = document.getElementById('audio-element');
const globalPlayer = document.getElementById('global-player');
const playBtn = document.getElementById('player-play-btn');
// 인라인 HTML(쇼츠, 우리들의 벽 등)이 재생 상태를 확인할 수 있도록 노출.
window.audioElement = audioElement;

// ============================================================
// 한글 IME Enter 안전 처리 — 사용자 audit (보내기 버튼 없이도 한 번에 전송)
// 패턴:
//   1) compositionstart/end 추적 → input.dataset.imeComposing 토글
//   2) compositionend 후 짧은 시간 (140ms) 동안은 Enter 가 "ime 종료 Enter" 일
//      가능성이 높음. 그 안에 들어온 Enter 는 → 즉시 submit (사용자가 원하는 패턴)
//   3) 인라인 핸들러는 window._safeEnterSubmit(input, fn) 호출
// ============================================================
(() => {
  const _imeJustEnded = new WeakMap();
  document.addEventListener('compositionstart', (e) => {
    const t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
    t.dataset.imeComposing = '1';
  }, true);
  document.addEventListener('compositionend', (e) => {
    const t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
    delete t.dataset.imeComposing;
    _imeJustEnded.set(t, Date.now());
  }, true);
  // 인라인에서 호출 — Enter 한 번이면 즉시 submit. 한글이든 영어든 OK.
  window._safeEnterSubmit = function (input, submitFn) {
    if (!input || !submitFn) return;
    // 합성 중이면 Enter 무시 (다음 글자 진행)
    if (input.dataset.imeComposing === '1') return;
    // 모든 경우에 submit
    submitFn();
  };
})();

// ============================================================
// 모바일 모달 스와이프-디스미스 (drag-down → close, 일반 앱 모션)
//   _attachSwipeDismiss(el, { onClose, direction, threshold, velocity,
//                             scrollGuard, exclude, grabber, backdrop })
//   - 손가락 따라 모달이 움직이고, 임계(기본 110px) 넘거나 빠르게 휙(0.5px/ms)
//     던지면 닫힘. 미달이면 통! 하고 스냅백.
//   - 모바일(≤768px)에서만 동작 — PC 는 닫기버튼/백드롭 사용.
//   - 멱등: 같은 el 에 두 번 호출돼도 1회만 wire (open 마다 불러도 안전).
//   - direction:'down'(기본) | 'right'(우측 드로어, 예: 알림 패널)
//   - scrollGuard: 내부 스크롤 영역 — 그게 top 일 때만 down-drag 닫힘 발동.
//   - exclude: 드래그 시작 금지 셀렉터 (입력칸/버튼/슬라이더 등).
// ============================================================
(() => {
  const isMobile = () => window.innerWidth <= 768;

  window._attachSwipeDismiss = function (el, opts) {
    if (!el || el._swipeDismissWired) return;
    el._swipeDismissWired = true;
    opts = opts || {};
    const dir = opts.direction === 'right' ? 'right' : 'down';
    const THRESH = opts.threshold || 110;
    const VEL = opts.velocity || 0.5;          // px/ms — 빠른 플릭 닫기
    const exclude = opts.exclude ||
      'input, textarea, button, select, a, .progress-bar, .progress-container, .vol-slider, [contenteditable="true"]';
    const onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
    const backdrop = opts.backdrop || null;

    // 내부 스크롤러 탐지 — 'auto' 면 터치 시작점의 가장 가까운 스크롤 조상.
    //   그게 top 일 때만 down-drag 닫힘 발동 (스크롤 중이면 양보).
    const findScroller = (target) => {
      if (opts.scrollGuard === 'auto' || opts.scrollGuard === true) {
        let n = target;
        while (n && n !== el && n.nodeType === 1) {
          try {
            const s = getComputedStyle(n);
            if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
          } catch (_) {}
          n = n.parentElement;
        }
        return null;
      }
      if (!opts.scrollGuard) return null;
      return (typeof opts.scrollGuard === 'string') ? el.querySelector(opts.scrollGuard) : opts.scrollGuard;
    };

    // 잡는 손잡이(grabber) 주입 — 레이아웃 안 흔들게 absolute. opts.grabber: 'dark'|'light'|false
    if (opts.grabber && dir === 'down' && !el.querySelector('.swipe-grabber')) {
      // el 이 static 이면 relative 로 (offset 없어서 위치 안 바뀜)
      try { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch (_) {}
      const g = document.createElement('div');
      g.className = 'swipe-grabber' + (opts.grabber === 'light' ? ' on-dark' : '');
      el.insertBefore(g, el.firstChild);
    }

    let startX = 0, startY = 0, curX = 0, curY = 0, startT = 0;
    let pending = false, active = false, gScroller = null;
    let lastAxis = 0, lastT2 = 0, recentVel = 0;     // 순간속도 추적용

    const axisVal = () => (dir === 'right' ? (curX - startX) : (curY - startY));

    // transform 은 !important 로 — 일부 모달(#global-player.expanded)이 CSS 에서
    // transform: none !important 를 쓰기 때문에 inline 으로는 이김.
    const applyTf = (val) => el.style.setProperty('transform', val, 'important');
    const clearTf = () => el.style.removeProperty('transform');

    const setTransform = (v) => {
      applyTf(dir === 'right' ? `translateX(${v}px)` : `translateY(${v}px)`);
      if (backdrop) {
        const span = (dir === 'right' ? el.offsetWidth : el.offsetHeight) || 600;
        const p = Math.max(0, Math.min(1, v / span));
        backdrop.style.opacity = String(1 - p * 0.85);
      }
    };

    const cleanup = () => {
      el.style.transition = ''; clearTf();
      el.classList.remove('swipe-will-close');
      if (backdrop) { backdrop.style.transition = ''; backdrop.style.opacity = ''; }
    };

    const snapBack = () => {
      el.style.transition = 'transform 0.3s cubic-bezier(0.22,1,0.36,1)';
      applyTf(dir === 'right' ? 'translateX(0)' : 'translateY(0)');
      el.classList.remove('swipe-will-close');
      if (backdrop) { backdrop.style.transition = 'opacity 0.3s'; backdrop.style.opacity = ''; }
      setTimeout(() => { el.style.transition = ''; clearTf(); if (backdrop) backdrop.style.transition = ''; }, 320);
    };

    const dismiss = () => {
      el.style.transition = 'transform 0.26s cubic-bezier(0.4,0,1,1)';
      applyTf(dir === 'right' ? 'translateX(110%)' : 'translateY(110%)');
      if (backdrop) { backdrop.style.transition = 'opacity 0.26s'; backdrop.style.opacity = '0'; }
      setTimeout(() => {
        cleanup();                       // 재사용 대비 inline 정리 후 실제 close
        if (onClose) { try { onClose(); } catch (_) {} }
      }, 270);
    };

    const start = (x, y, target) => {
      if (!isMobile()) return;
      // 영구 요소(예: 플레이어)는 열린 상태일 때만 — opts.enabled 가드.
      if (typeof opts.enabled === 'function' && !opts.enabled()) return;
      if (target && exclude && target.closest && target.closest(exclude)) return;
      startX = curX = x; startY = curY = y; startT = Date.now();
      pending = true; active = false;
      gScroller = findScroller(target);     // 터치 시작점 기준 스크롤러 캡처
    };
    const move = (x, y, ev) => {
      if (!pending && !active) return;
      curX = x; curY = y;
      const dx = curX - startX, dy = curY - startY;
      if (!active) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;   // 아직 방향 모름
        if (dir === 'down') {
          const atTop = !gScroller || gScroller.scrollTop <= 0;
          if (dy > 0 && Math.abs(dy) > Math.abs(dx) && atTop) active = true;
          else { pending = false; return; }                  // 가로/위/스크롤 → 양보
        } else {
          if (dx > 0 && Math.abs(dx) > Math.abs(dy)) active = true;
          else { pending = false; return; }
        }
        // commit 시점 — 순간속도 추적 기준점 초기화
        lastAxis = axisVal(); lastT2 = Date.now(); recentVel = 0;
      }
      if (!active) return;
      // 최근 구간 속도 — 평균이 아니라 "지금" 의 속도 (천천히 끌다 휙 던지기 인식)
      const a = axisVal();
      const now = Date.now();
      const dtt = now - lastT2;
      if (dtt > 0) { recentVel = (a - lastAxis) / dtt; lastAxis = a; lastT2 = now; }
      let v = a;
      if (v < 0) v = v / 8;               // 반대 방향 저항
      el.style.transition = '';
      setTransform(v);
      el.classList.toggle('swipe-will-close', Math.abs(v) > THRESH);
      if (ev && ev.cancelable) ev.preventDefault();
    };
    const end = () => {
      if (!active) { pending = false; return; }
      const v = axisVal();
      pending = false; active = false;
      // 거리 임계 OR 마지막 순간속도가 dismiss 방향으로 충분히 빠르면 닫기
      if (Math.abs(v) > THRESH || recentVel > VEL) dismiss();
      else snapBack();
    };

    el.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY, e.target); }, { passive: true });
    el.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY, e); }, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    // 마우스 (데스크탑 폭 줄였을 때 / 디버그) — window 리스너는 드래그 중에만 붙였다 떼서
    //   모달 새로 열 때마다 누수되지 않게 한다.
    const onWinMove = (e) => move(e.clientX, e.clientY, e);
    const onWinUp = (e) => {
      window.removeEventListener('mousemove', onWinMove);
      window.removeEventListener('mouseup', onWinUp);
      end();
    };
    el.addEventListener('mousedown', (e) => {
      start(e.clientX, e.clientY, e.target);
      if (pending) {     // start() 가 게이트 통과했을 때만 window 리스너 부착
        window.addEventListener('mousemove', onWinMove);
        window.addEventListener('mouseup', onWinUp);
      }
    });
  };
})();

// 영구 모달(DM · STO · 타마) 아래로 스와이프 닫기 — 요소가 상주하므로 로드 후 한 번만 배선.
// (display:none 이면 못 만지니 enabled 가드 불필요. 닫기 fn 은 이름으로 늦게 조회 → 정의 순서 무관.)
(function () {
  function wireModalSwipes() {
    [['dm-content', 'closeDmModal'],
     ['sto-mini-content', 'closeStoMini'],
     ['tama-modal-content', 'closeTamaModal']].forEach(function (d) {
      var el = document.getElementById(d[0]);
      if (el && window._attachSwipeDismiss) window._attachSwipeDismiss(el, {
        direction: 'down', backdrop: el.parentElement, grabber: 'dark', scrollGuard: 'auto',
        onClose: function () { try { if (typeof window[d[1]] === 'function') window[d[1]](); } catch (_) {} }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireModalSwipes);
  else wireModalSwipes();
})();

// ============================================================
// i18n — KO / EN 토글 (옵션 B, 점진적 도입)
// CSS 가 [data-lang="ko"] / [data-lang="en"] 기반으로 한쪽만 표시.
// 1) 저장된 선택 → localStorage 'offstage_lang'
// 2) 없으면 브라우저 언어로 감지 (한국어 → ko, 그 외 → en)
// 3) 토글 버튼 클릭 → 즉시 전환 + 저장
// ============================================================
(() => {
  const KEY = 'offstage_lang';
  const SUPPORTED = ['ko', 'en'];

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    const browser = (navigator.language || 'ko').toLowerCase();
    return browser.startsWith('ko') ? 'ko' : 'en';
  }

  function applyLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'ko';
    document.documentElement.dataset.lang = lang;
    try { localStorage.setItem(KEY, lang); } catch (_) {}

    // 토글 버튼 active 상태
    document.querySelectorAll('.lang-toggle .opt').forEach(el => {
      el.classList.toggle('active', el.dataset.langOpt === lang);
    });

    // Search placeholder (input 은 자식 노드 X 라서 attr 로 처리)
    const search = document.getElementById('global-search');
    if (search) search.placeholder = lang === 'ko' ? '검색...' : 'Search...';

    // 다른 컴포넌트가 listen 하고 싶을 때 (나중에 동적 렌더 컨텐츠)
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function bindToggle() {
    const toggle = document.getElementById('lang-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', (e) => {
      const opt = e.target.closest('.opt');
      if (!opt) return;
      applyLang(opt.dataset.langOpt);
    });
  }

  // 첫 페인트 전에 lang 적용 (DOM 이 이미 파싱돼있음)
  const initial = detectInitialLang();
  applyLang(initial);

  // DOM 로드 후 토글 바인딩
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToggle);
  } else {
    bindToggle();
  }

  // 외부에서 부를 수 있게 노출
  window.setLang = applyLang;
  window.getLang = () => document.documentElement.dataset.lang || 'ko';

  // JS 템플릿용 헬퍼 — 양쪽 span 을 출력 (CSS 가 한쪽만 보여줌)
  // 사용: ${_i18n('도형', 'Shapes')}
  window._i18n = (ko, en) =>
    `<span data-i18n-ko>${ko}</span><span data-i18n-en>${en}</span>`;

  // placeholder/aria-label 등 attribute 용 — 현재 lang 기준 즉시 문자열 반환
  // 사용: input.placeholder = _t('검색...', 'Search...')
  // 단점: lang 바뀌면 다시 렌더해야 함. 정적 HTML/JS innerHTML 만 쓰는 곳에 OK.
  window._t = (ko, en) => (window.getLang() === 'en' ? en : ko);

  // ── 토스트/alert/confirm 메시지 사전 — EN 모드에서 자동 번역.
  //    호출부 60곳+ 을 일일이 안 고치고 진입점(showToast/alert/confirm) 1곳에서 처리.
  const MSG_EN = {
    '로그아웃 되었어요': 'Signed out',
    '로그인이 필요해요': 'Sign-in required',
    '로그인이 필요해요.': 'Sign-in required.',
    '내용을 적어줘': 'Write something first',
    '자기소개 저장됨 ✨': 'Bio saved ✨',
    '벽에 글을 남기려면 로그인이 필요해요.': 'Sign in to post on the wall.',
    '벽에 붙었어요 📌': 'Posted to the wall 📌',
    '아직 준비 중이에요. 잠시 후 다시 시도해주세요.': 'Still loading — try again shortly.',
    '삭제됐어요': 'Deleted',
    '삭제 완료': 'Deleted',
    '댓글 삭제됨': 'Comment deleted',
    '댓글 남겼어요 ✏': 'Comment posted ✏',
    '낙서 남겼어요': 'Scribble posted',
    '폴더에 담았어요 📌': 'Added to folder 📌',
    '폴더에 담았어요 🎵': 'Added to folder 🎵',
    '폴더에서 뺐어요': 'Removed from folder',
    '이 폴더는 비어 있어요': 'This folder is empty',
    '로그인 후 이용 가능합니다': 'Sign in to use this',
    '프로필 저장 완료 ✨': 'Profile saved ✨',
    '메인 노출 해제': 'Removed from main',
    '로그인 후 투표 가능': 'Sign in to vote',
    '표 취소됨': 'Vote removed',
    '단계 변경됨 ✨': 'Stage updated ✨',
    '커버 이미지는 5MB 이하만 가능해요.': 'Cover image must be under 5MB.',
    '커버 업로드 중…': 'Uploading cover…',
    '커버 바꿨어요 ✨': 'Cover updated ✨',
    '플레이리스트에 추가됐어요!': 'Added to playlist!',
    '로그인 후 메시지를 보낼 수 있어요': 'Sign in to send messages',
    '대화방을 찾을 수 없어요': 'Conversation not found',
    '로그인 후 함께 만들 수 있어요': 'Sign in to join',
    '카드 정보를 못 찾았어요': 'Card info not found',
    '이미지 생성 실패': 'Image generation failed',
    '예시 카드입니다 ✨': 'Sample card ✨',
    '폴더 만들었어요 ✨': 'Folder created ✨',
    '플레이리스트 만들었어요 ✨': 'Playlist created ✨',
    '역할이 변경됐어요': 'Role updated',
    '트랙 삭제됨': 'Track deleted',
    '곡을 찾을 수 없어요': 'Track not found',
    '이 댓글을 지울까요?': 'Delete this comment?',
    '약관 동의가 필요해요.': 'Please agree to the terms first.',
    '추가 실패': 'Add failed',
    // 업로드/프로필 검증 에러 (throw → alert 경유)
    '오디오 파일을 선택해주세요.': 'Please choose an audio file.',
    '오디오 파일은 50MB 이하만 업로드 가능해요.': 'Audio files must be under 50MB.',
    '곡 소개 및 코멘트를 적어주세요. (필수)': 'Please write a description. (required)',
    '태그를 한 개 이상 적어주세요. (필수)': 'Please add at least one tag. (required)',
    '도형 낙서 3줄을 모두 적어주세요. (필수)': 'Please fill in all 3 graffiti lines. (required)',
    '발매(마스터)는 가사가 필요해요. 데모는 비워둬도 됩니다. (가사는 곡 페이지에 표시돼요)': 'Releases (masters) require lyrics. Demos may leave it empty. (Lyrics show on the song page.)',
    '기존 Demo 를 선택해주세요.': 'Please select an existing Demo.',
    '선택한 Demo 를 찾을 수 없어요.': 'Selected Demo not found.',
    '활동명은 비워둘 수 없어요': 'Artist name cannot be empty',
    '자기소개가 저장되지 않았어요. 로그아웃 후 다시 로그인 해보세요.': 'Bio was not saved. Try signing out and back in.',
    '로그인 세션이 없어요. 다시 로그인해주세요.': 'No session — please sign in again.',
    // 주절주절 스레드 피드 / 앨범 (이번 추가분)
    '링크 복사됐어요': 'Link copied',
    '이 글을 삭제할까요?': 'Delete this post?',
    '주절주절을 남기려면 로그인이 필요해요.': 'Sign in to post.',
    '사진이 너무 커요 (8MB 이하로 올려주세요).': 'Image too large (max 8MB).',
    '올렸어요 📌': 'Posted 📌',
    '글은 올렸어요 — 사진은 DB 설정(SQL) 후 올라가요': 'Posted — photos need the DB setup (SQL).',
    '앨범을 찾을 수 없어요': 'Album not found',
    '앨범을 찾을 수 없어요.': 'Album not found.'
  };
  const MSG_PREFIX = [
    ['올리기 실패: ', 'Post failed: '],
    ['저장 실패: ', 'Save failed: '],
    ['삭제 실패: ', 'Delete failed: '],
    ['댓글 저장 실패: ', 'Comment save failed: '],
    ['댓글 삭제 실패: ', 'Comment delete failed: '],
    ['업로드 실패: ', 'Upload failed: '],
    ['추가 실패: ', 'Add failed: '],
    ['만들기 실패: ', 'Create failed: '],
    ['생성 실패: ', 'Create failed: '],
    ['변경 실패: ', 'Update failed: '],
    ['승격 실패: ', 'Promote failed: '],
    ['단계 변경 실패: ', 'Stage change failed: '],
    ['메시지 전송 실패: ', 'Send failed: '],
    ['커버 변경 실패: ', 'Cover change failed: ']
  ];
  window._msgEn = (msg) => {
    if (typeof msg !== 'string' || window.getLang() !== 'en') return msg;
    if (MSG_EN[msg]) return MSG_EN[msg];
    for (const [k, en] of MSG_PREFIX) {
      if (msg.startsWith(k)) {
        // 접두어("업로드 실패: ") 뒤 본문도 사전에 있으면 번역 (없으면 원문).
        const body = msg.slice(k.length);
        return en + (MSG_EN[body] || body);
      }
    }
    return msg;
  };
  // alert / confirm 도 같은 사전으로 — 호출부 무수정 커버
  try {
    const _nAlert = window.alert.bind(window);
    window.alert = (m) => _nAlert(window._msgEn(m));
    const _nConfirm = window.confirm.bind(window);
    window.confirm = (m) => _nConfirm(window._msgEn(m));
  } catch (_) {}

  // 언어 바뀌면 _t() 로 박힌 텍스트들 (auth 헤더, 검색 placeholder, 현재 라우트 등)
  // 을 새 언어로 다시 그리기. _i18n() span 들은 CSS 가 자동으로 처리.
  window.addEventListener('langchange', () => {
    try { if (typeof updateHeaderAuth === 'function') updateHeaderAuth(); } catch (_) {}
    // 현재 라우트 재렌더 — _t() 로 박힌 placeholder/내용이 바뀌게.
    // navigateTo 의 dedupe (같은 라우트 0.5초 내 무시) 우회 필요.
    try {
      if (typeof currentView !== 'undefined' && typeof navigateTo === 'function' && currentView) {
        if (typeof _lastNavTs !== 'undefined') _lastNavTs = 0;
        if (typeof _lastNavRoute !== 'undefined') _lastNavRoute = null;
        setTimeout(() => navigateTo(currentView), 0);
      }
    } catch (_) {}
  });
})();

// ============================================================
// 첫 방문 온보딩 가이드 — 스와이프 3슬라이드 (환영 → 도형=노래 → 메뉴)
// localStorage 'offstage_onboarded' 로 한 번만. (사용자 요청)
// ============================================================
window.maybeShowOnboarding = function () {
  try { if (localStorage.getItem('offstage_onboarded') === '1') return; } catch (_) {}
  if (typeof currentView !== 'undefined' && currentView === 'auth') return;  // 로그인 화면이면 다음에
  window.showOnboarding();
};
window.closeOnboarding = function () {
  try { localStorage.setItem('offstage_onboarded', '1'); } catch (_) {}
  const el = document.getElementById('onboarding-guide');
  if (el) { el.classList.add('ob-closing'); setTimeout(() => el.remove(), 280); }
};
window.showOnboarding = function () {
  if (document.getElementById('onboarding-guide')) return;
  const _t2 = (ko, en) => (typeof _t === 'function' ? _t(ko, en) : ko);
  const slide1 = `
    <div class="ob-slide">
      <div class="ob-visual ob-visual-shapes" aria-hidden="true">
        <span class="ob-mini" style="background:#E07B4C;"></span>
        <span class="ob-mini" style="background:#4A77E0;"></span>
        <span class="ob-mini" style="background:#A4CC5B;"></span>
        <span class="ob-mini" style="background:#F0C84A;"></span>
      </div>
      <h2 class="ob-title">${_t2('Off-Stage 에 오신 걸 환영해요','Welcome to Off-Stage')}</h2>
      <p class="ob-body">${_t2('감성으로 노래를 발견하고, 좋아하는 아티스트와 가까워지는 곳이에요.','Discover music by mood, and get closer to the artists you love.')}</p>
    </div>`;
  const slide2 = `
    <div class="ob-slide">
      <div class="ob-visual" aria-hidden="true">
        <div class="ob-demo-shape">♪<span class="ob-tap"><i class="ri-cursor-fill"></i></span></div>
      </div>
      <h2 class="ob-title">${_t2("떠다니는 '도형'이 노래예요",'Each floating shape is a song')}</h2>
      <p class="ob-body">${_t2('한 번 탭하면 바로 재생! 끌어서 옮기고, 위로 스와이프하면 쇼츠처럼 다음 곡으로 넘어가요.','Tap to play instantly. Drag to move it, or swipe up for the next song like shorts.')}</p>
    </div>`;
  const menuRows = [
    ['ri-triangle-line',    _t2('발견','Discover'),     _t2('노래를 도형으로 발견','Browse songs as shapes')],
    ['ri-chat-3-fill', _t2('주절주절','Bla Bla'), _t2('작곡가별 데모를 쭉 둘러봐요','Browse demos by composer')],
    ['ri-add-circle-fill',  _t2('올리기','Upload'),      _t2('가운데 + 로 내 음원 올리기','Tap + to upload your track')],
    ['ri-play-list-fill',   _t2('플레이리스트','Playlist'), _t2('최근 들은·담은 노래','Recently played & saved')]
  ].map(([ic,t,d]) => `<div class="ob-menu-row"><span class="ob-menu-ic"><i class="${ic}"></i></span><div class="ob-menu-tx"><b>${t}</b><span>${d}</span></div></div>`).join('');
  const slide3 = `
    <div class="ob-slide">
      <h2 class="ob-title ob-title-sm">${_t2('이렇게 둘러보세요','Find your way around')}</h2>
      <div class="ob-menu">${menuRows}</div>
    </div>`;
  const dots = [0,1,2].map(i => `<span class="${i===0?'on':''}"></span>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
    <div id="onboarding-guide" class="ob-overlay" role="dialog" aria-modal="true" aria-label="${_t2('소개','Intro')}">
      <div class="ob-card">
        <button class="ob-skip" type="button" onclick="closeOnboarding()">${_t2('건너뛰기','Skip')}</button>
        <div class="ob-viewport"><div class="ob-track" id="ob-track">${slide1}${slide2}${slide3}</div></div>
        <div class="ob-dots" id="ob-dots">${dots}</div>
        <div class="ob-foot"><button class="ob-next" id="ob-next" type="button">${_t2('다음','Next')}</button></div>
      </div>
    </div>`);
  let idx = 0; const N = 3;
  const track = document.getElementById('ob-track');
  const dotsEl = document.getElementById('ob-dots');
  const nextBtn = document.getElementById('ob-next');
  const go = (i) => {
    idx = Math.max(0, Math.min(N - 1, i));
    track.style.transform = `translateX(${-idx * 100}%)`;
    Array.from(dotsEl.children).forEach((d, k) => d.classList.toggle('on', k === idx));
    nextBtn.textContent = (idx === N - 1) ? _t2('둘러보기','Take a tour') : _t2('다음','Next');
  };
  nextBtn.addEventListener('click', () => {
    if (idx === N - 1) {
      // 환영 슬라이드 끝 → 닫고 스포트라이트 투어 시작 (조합).
      closeOnboarding();
      setTimeout(() => { try { if (typeof window.startTutorial === 'function') window.startTutorial(); } catch (_) {} }, 320);
    } else go(idx + 1);
  });
  dotsEl.addEventListener('click', (e) => { const i = Array.from(dotsEl.children).indexOf(e.target); if (i >= 0) go(i); });
  // 좌우 스와이프로 슬라이드 넘기기
  let sx = 0, sw = false;
  const vp = track.parentElement;
  vp.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) { sx = t.clientX; sw = true; } }, { passive: true });
  vp.addEventListener('touchend', (e) => { if (!sw) return; sw = false; const t = e.changedTouches[0]; if (!t) return; const dx = t.clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? idx + 1 : idx - 1); }, { passive: true });
  go(0);
};

// ============================================================
// 스포트라이트 튜토리얼 — 요소를 하나씩 강조 + 직접 탭해서 진행 (게임 튜토리얼식)
// ============================================================
window.startTutorial = function () {
  if (document.getElementById('tut-overlay')) return;
  // 로그인 확인이 비동기라, 가이드를 켤 때 아직 __currentUser 가 안 채워졌으면 _loggedIn=false 로
  // 잡혀 아티스트 4단계가 빠지고 6단계만 나옴. 세션이 있으면 채워질 때까지 잠깐 기다렸다 시작 → 10단계.
  const _hasUser = !!(window.__currentUser || (window.DB.get && window.DB.get().currentUser));
  if (!_hasUser && !window.__tutAuthChecked && window.supabase && window.supabase.auth) {
    window.__tutAuthChecked = true;   // 이 실행 사이클에 1회만 비동기 체크 (무한 대기 방지)
    window.supabase.auth.getSession().then(({ data }) => {
      if (data && data.session) {
        let _t = 0;
        const _w = () => {
          if (window.__currentUser || (window.DB.get && window.DB.get().currentUser) || _t >= 9) window.startTutorial();
          else { _t++; setTimeout(_w, 200); }
        };
        _w();                          // 세션 있음 → 로그인 매핑될 때까지 최대 ~1.8s 대기
      } else {
        window.startTutorial();        // 진짜 비로그인 → 그대로(6단계)
      }
    }).catch(() => { window.startTutorial(); });
    return;
  }
  window.__tutAuthChecked = false;     // 체크 끝 — 다음 가이드 실행 때 또 확인하게 리셋
  const _t2 = (ko, en) => (typeof _t === 'function' ? _t(ko, en) : ko);
  const _loggedIn = !!((window.__currentUser) || (window.DB && window.DB.get && window.DB.get().currentUser));
  // 플레이리스트 — 최근 들은 노래 + 담은 노래(주절주절에서 +로 담은 곡).
  const favStep = { route: 'universe', sel: '.sb-seclabel, .sb-head',
        title: _t2('플레이리스트','Playlist'),
        body: _t2('최근에 들은 노래와, 주절주절에서 + 로 담은 노래가 여기 모여요.','Your recently played songs and the ones you saved with + in Bla Bla live here.') };
  // 로그인 시: 내 아티스트 페이지로 들어가 소식(투명 + 카드)·프로필 수정을 자세히 안내.
  const artistSteps = _loggedIn ? [
    { route: 'my-artist', sel: '.mh-track, .mh-stats, .mh-name-row', title: _t2('MY 페이지','MY Page'),
      body: _t2('팬들이 보는 내 페이지예요. 올린 데모·곡이 여기 쌓이고, 카드를 누르면 그 곡 페이지로 가요.','The page fans see. Your demos and tracks stack up here — tap a card to open that song.') },
    { sel: '.mh-editbtn', title: _t2('프로필 편집','Edit profile'),
      body: _t2('이름·한 줄 소개·프로필 사진은 편집 버튼에서 바꿀 수 있어요.','Edit your name, bio and photo from the Edit button.') }
  ] : [];
  const steps = [
    { route: 'shapes', sel: '.floating-shape[data-track-id]', title: _t2('발견 — 노래','Discover'), body: _t2('떠다니는 도형이 노래예요. 한 번 탭하면 바로 재생, 위로 스와이프하면 쇼츠처럼 다음 곡으로!','Each floating shape is a song. Tap to play, swipe up for the next one like shorts!') },
    { sel: '.mobile-tab-plus, .upload-fab', title: _t2('음원 올리기','Upload'), body: _t2('가운데 ⊕ 를 눌러 내 데모·곡을 올려요.','Tap the ⊕ in the middle to upload your demo or track.') },
    { route: 'wall', sel: '.sb-artist, .sb-seclabel', title: _t2('주절주절','Bla Bla'), body: _t2('작곡가별로 올라온 데모를 쭉 볼 수 있어요. 이름을 누르면 그 작곡가 페이지로 가요.','Browse demos grouped by composer. Tap a name to open their page.') },
    { route: 'tags', sel: '.tag-chip', title: _t2('Tags','Tags'), body: _t2('기분·태그로 노래를 찾아봐요.','Find songs by mood and tags.') },
    favStep,
    ...artistSteps,
    { sel: '#global-player', title: _t2('플레이어','Player'), body: _t2('재생·담기·셔플은 여기. 제목을 누르면 아티스트로 가요.','Play, save, shuffle here. Tap the title for the artist.') }
  ];
  document.body.insertAdjacentHTML('beforeend', `
    <div id="tut-overlay"></div>
    <div id="tut-tip" role="dialog" aria-live="polite">
      <button id="tut-skip" type="button">${_t2('건너뛰기','Skip')}</button>
      <div id="tut-title"></div>
      <div id="tut-body"></div>
      <div id="tut-foot"><span id="tut-step"></span><button id="tut-next" type="button">${_t2('다음','Next')}</button></div>
    </div>`);
  const overlay = document.getElementById('tut-overlay');
  const tip = document.getElementById('tut-tip');
  let i = 0, curTarget = null, curHandler = null;
  const cleanupTarget = () => {
    if (curTarget) {
      curTarget.classList.remove('tut-spotlight');
      curTarget.style.zIndex = curTarget.dataset._tutZ || '';
      curTarget.style.position = curTarget.dataset._tutPos || '';
      delete curTarget.dataset._tutZ; delete curTarget.dataset._tutPos;
      if (curHandler) curTarget.removeEventListener('click', curHandler, true);
    }
    curTarget = null; curHandler = null;
  };
  const finish = () => { cleanupTarget(); try { localStorage.setItem('offstage_tutorial_done','1'); } catch (_) {} if (overlay) overlay.remove(); if (tip) tip.remove(); };
  const place = (target) => {
    const r = target.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const below = r.top < window.innerHeight / 2;
    let top = below ? (r.bottom + 14) : (r.top - th - 14);
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - th - 12));
    tip.style.left = left + 'px'; tip.style.top = top + 'px'; tip.style.visibility = 'visible';
  };
  const run = () => {
    cleanupTarget();
    if (i >= steps.length) { finish(); return; }
    const s = steps[i];
    // 페이지 이동이 필요한 단계 — 한 번만 이동하고 렌더를 기다림(아래 재시도).
    if (s.route && !s._navDone && typeof currentView !== 'undefined' && currentView !== s.route) {
      s._navDone = true;
      try { if (typeof navigateTo === 'function') { window._lastNavTs = 0; navigateTo(s.route); } } catch (_) {}
    }
    // 셀렉터 매치 중 '보이는' 첫 요소 (예: 모바일 탭바 vs 데스크탑 사이드바)
    const _isVis = (e) => e && e.getBoundingClientRect().width > 0
      && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const target = Array.from(document.querySelectorAll(s.sel)).find(_isVis) || null;
    if (!target) {
      // 비동기 렌더(도형 등) 대기 — 넉넉히 재시도(약 5.6s) 후에도 없으면 건너뜀.
      if ((s._retry || 0) < 16) { s._retry = (s._retry || 0) + 1; setTimeout(run, 350); return; }
      i++; run(); return;
    }
    curTarget = target;
    target.dataset._tutZ = target.style.zIndex || '';
    target.dataset._tutPos = target.style.position || '';
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.style.zIndex = '9450';
    target.classList.add('tut-spotlight');
    document.getElementById('tut-title').textContent = s.title;
    document.getElementById('tut-body').textContent = s.body;
    document.getElementById('tut-step').textContent = (i + 1) + ' / ' + steps.length;
    document.getElementById('tut-next').textContent = (i === steps.length - 1) ? _t2('끝!','Done') : _t2('다음','Next');
    place(target);
    // 강조된 요소를 직접 탭하면 다음으로 (튜토리얼 중엔 실제 동작은 막음).
    //   합성(프로그램) 클릭은 무시 — 페이지 재렌더 등으로 저절로 넘어가던 것 방지.
    curHandler = (e) => { if (e && e.isTrusted === false) return; e.preventDefault(); e.stopPropagation(); i++; run(); };
    target.addEventListener('click', curHandler, true);
  };
  document.getElementById('tut-next').addEventListener('click', () => { i++; run(); });
  document.getElementById('tut-skip').addEventListener('click', finish);
  if (!window.__tutResizeWired) { window.__tutResizeWired = true; window.addEventListener('resize', () => { if (curTarget && document.getElementById('tut-overlay')) place(curTarget); }); }
  run();
};

// ====================================================================
// VOLUME CONTROL — 글로벌 플레이어 슬라이더 + 키보드 단축키 (↑/↓/M)
//                + 가운데 토스트 + localStorage 영구 저장
// 모든 페이지 공용 — 어디서 노래 틀어도 동작.
// 사용자 요청: 노래 재생 위치마다 슬라이더 박지 말고 한 곳에만.
// ====================================================================
(function initVolumeControl() {
  if (!audioElement) return;
  const STORAGE_VOL = 'off-stage-volume';
  const STORAGE_MUTED = 'off-stage-muted';

  // 초기값 복원
  let volume = 60;
  let muted  = false;
  try {
    const sv = parseInt(localStorage.getItem(STORAGE_VOL) || '60', 10);
    if (!isNaN(sv)) volume = Math.max(0, Math.min(100, sv));
    muted = localStorage.getItem(STORAGE_MUTED) === '1';
  } catch (_) {}

  // audio element 에 즉시 적용
  audioElement.volume = (muted ? 0 : volume) / 100;
  audioElement.muted = muted;

  // 외부에서 호출 가능하게 노출 (선택)
  window.__volume = { get: () => volume, getMuted: () => muted };

  // ⚠ Web Audio API GainNode 우회 — 두 번 시도했지만 iOS Safari 에서 매번
  //    오디오 라우팅 깨짐 (소리 안 남). createMediaElementSource 가 audio
  //    element 의 직접 출력을 빼앗고 graph 가 안정적이지 못함.
  //    → iOS 에서는 인앱 슬라이더가 시각 전용. 실제 볼륨은:
  //       · 폰 측면 +/- 버튼
  //       · 컨트롤센터 슬라이더 (MediaSession 으로 미디어 볼륨 라우팅됨)
  //    Spotify Web / YouTube Music Web 도 동일한 한계.

  // ─── DOM 요소 (defer 로 로드돼서 안전) ───
  const slider   = document.getElementById('vol-slider');
  const muteBtn  = document.getElementById('vol-mute-btn');
  const pctLbl   = document.getElementById('vol-percent');
  const toast    = document.getElementById('vol-toast');
  const toastFill= document.getElementById('vol-toast-fill');
  const toastPct = document.getElementById('vol-toast-pct');
  const toastIcon= toast && toast.querySelector('.vol-toast-icon');

  function iconClass(v, m) {
    if (m || v === 0) return 'ri-volume-mute-fill';
    if (v < 35)       return 'ri-volume-down-fill';
    return 'ri-volume-up-fill';
  }

  let toastTimer = null;
  function apply(showToast) {
    audioElement.volume = (muted ? 0 : volume) / 100;
    audioElement.muted = muted;

    if (slider)  slider.value = volume;
    if (pctLbl)  pctLbl.textContent = (muted ? 0 : volume) + '%';
    if (muteBtn) {
      muteBtn.classList.toggle('muted', muted);
      const i = muteBtn.querySelector('i');
      if (i) i.className = iconClass(volume, muted);
    }
    if (slider) {
      const filled = muted ? 0 : volume;
      slider.style.background = `linear-gradient(to right, var(--brand-color, #1DB954) 0%, var(--brand-color, #1DB954) ${filled}%, rgba(255,255,255,0.14) ${filled}%, rgba(255,255,255,0.14) 100%)`;
    }

    if (showToast && toast) {
      if (toastFill) toastFill.style.width = (muted ? 0 : volume) + '%';
      if (toastPct)  toastPct.textContent  = (muted ? 0 : volume) + '%';
      if (toastIcon) toastIcon.className = 'vol-toast-icon ' + iconClass(volume, muted);
      toast.classList.toggle('muted', muted);
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
    }

    // 저장
    try {
      localStorage.setItem(STORAGE_VOL, String(volume));
      localStorage.setItem(STORAGE_MUTED, muted ? '1' : '0');
    } catch (_) {}

    // 모바일 팝업 UI 도 갱신 (열려있을 때)
    try { if (typeof syncPopupUI === 'function') syncPopupUI(); } catch (_) {}
  }

  // ─── 슬라이더 드래그 ───
  if (slider) {
    slider.addEventListener('input', () => {
      volume = parseInt(slider.value, 10) || 0;
      if (volume > 0 && muted) muted = false;
      apply(false);
    });
  }

  // ─── 음소거 버튼 ───
  // PC: 단순 음소거 토글
  // Mobile (≤768): 팝업 슬라이더 열기 (iOS 안내 포함)
  const _isMobileVol = () => window.innerWidth <= 768;
  const _isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
                 || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // 볼륨 팝업 DOM — body 끝에 한 번만 생성
  let volPopup = null;
  function ensureVolPopup() {
    if (volPopup) return volPopup;
    volPopup = document.createElement('div');
    volPopup.id = 'vol-popup';
    volPopup.innerHTML = `
      <div class="vol-popup-row">
        <button type="button" class="vol-popup-mute" aria-label="음소거 토글">
          <i class="ri-volume-up-fill"></i>
        </button>
        <input type="range" class="vol-popup-slider" min="0" max="100" step="1" value="60" aria-label="볼륨">
        <span class="vol-popup-pct">60%</span>
      </div>
      <div class="vol-popup-hint">
        ${_isIOS()
          ? '📱 iOS는 폰 측면 <span class="key">+ / −</span> 키 / 컨트롤센터로 조절'
          : '🔊 폰 측면 <span class="key">+ / −</span> 키로도 조절 가능'}
      </div>
    `;
    document.body.appendChild(volPopup);

    // 팝업 안 슬라이더 / 음소거 핸들러
    const pSlider = volPopup.querySelector('.vol-popup-slider');
    const pMute   = volPopup.querySelector('.vol-popup-mute');
    pSlider.addEventListener('input', () => {
      volume = parseInt(pSlider.value, 10) || 0;
      if (volume > 0 && muted) muted = false;
      apply(false);
      syncPopupUI();
    });
    pMute.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      muted = !muted;
      apply(true);
      syncPopupUI();
    });

    // 외부 탭 시 닫기
    document.addEventListener('click', (ev) => {
      if (!volPopup.classList.contains('open')) return;
      if (volPopup.contains(ev.target)) return;
      if (muteBtn && (ev.target === muteBtn || muteBtn.contains(ev.target))) return;
      closeVolPopup();
    });

    return volPopup;
  }
  function syncPopupUI() {
    if (!volPopup) return;
    const pSlider = volPopup.querySelector('.vol-popup-slider');
    const pMute   = volPopup.querySelector('.vol-popup-mute');
    const pPct    = volPopup.querySelector('.vol-popup-pct');
    if (pSlider) pSlider.value = volume;
    if (pPct)    pPct.textContent = (muted ? 0 : volume) + '%';
    if (pMute) {
      pMute.classList.toggle('muted', muted);
      const i = pMute.querySelector('i');
      if (i) i.className = iconClass(volume, muted);
    }
  }
  function openVolPopup() {
    const p = ensureVolPopup();
    syncPopupUI();
    // 음소거 버튼 위치 위에 위치시킴 (우측 끝)
    if (muteBtn) {
      const rect = muteBtn.getBoundingClientRect();
      p.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 10)}px`;
      p.style.right = `${Math.max(8, window.innerWidth - rect.right + 0)}px`;
      p.style.left = 'auto';
    }
    p.classList.add('open');
  }
  function closeVolPopup() {
    if (volPopup) volPopup.classList.remove('open');
  }

  if (muteBtn) {
    // iOS 는 audio.volume 이 read-only + 팝업 슬라이더도 작동 X.
    // 사용자 요청 — iOS 에선 버튼 자체 숨기고 클릭도 무반응.
    // 안드로이드는 그대로 (팝업 슬라이더 + OS 키 안내 유지).
    if (_isIOS()) {
      muteBtn.style.display = 'none';
      // 볼륨 percent 도 같이 숨김 — 어차피 의미 없음
      const pctLblIos = document.getElementById('vol-percent');
      if (pctLblIos) pctLblIos.style.display = 'none';
    } else {
      muteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (_isMobileVol()) {
          // 모바일(안드로이드 등): 팝업 토글 (이미 열려있으면 닫기)
          if (volPopup && volPopup.classList.contains('open')) {
            closeVolPopup();
          } else {
            openVolPopup();
          }
        } else {
          // PC: 단순 음소거 토글
          muted = !muted;
          apply(true);
        }
      });
    }
  }

  // ─── 키보드 단축키 — ↑/↓ ±5%, M 음소거 ───
  // 입력 필드 안에선 무시 (텍스트 입력 방해 안 함).
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target && e.target.isContentEditable) return;
    // 검색/모달 등의 단축키와 충돌 막기 — meta/ctrl/alt 있으면 무시
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      volume = Math.min(100, volume + 5);
      if (muted) muted = false;
      apply(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      volume = Math.max(0, volume - 5);
      apply(true);
    } else if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
      apply(true);
    }
  });

  // 초기 1회 — 토스트 없이
  apply(false);
})();

let currentView = 'home';
let currentPlayingTrack = null;

// 우리들의 벽 등 곳곳의 .note-track-thumb 미니 커버 아이콘 ▶ ↔ ⏸ 동기화.
// audioElement 의 play/pause/ended/emptied 어디에서 호출돼도 안전.
window.syncNoteTrackThumbIcons = function () {
  const playingId = window.currentPlayingTrack;
  const isPlaying = !!(playingId && window.audioElement && !window.audioElement.paused && !window.audioElement.ended);
  document.querySelectorAll('.note-track-thumb[data-track-id]').forEach(btn => {
    const tid = btn.getAttribute('data-track-id');
    const active = isPlaying && tid === playingId;
    btn.classList.toggle('is-playing', active);
    const i = btn.querySelector('i');
    if (i) i.className = active ? 'ri-pause-fill' : 'ri-play-fill';
    const baseTitle = btn.getAttribute('title') || '';
    const cleaned = baseTitle.replace(/ — (재생|일시정지)$/, '');
    btn.setAttribute('title', cleaned + (active ? ' — 일시정지' : ' — 재생'));
  });
};
function syncNoteTrackThumbIcons() { return window.syncNoteTrackThumbIcons(); }

// ────────────────────────────────────────────────────────────
// Browser-history routing — keeps the URL hash in sync with currentView
// so the browser Back/Forward buttons and URL sharing both work.
// SPA structure is unchanged; this just hooks into the platform's history API.
// ────────────────────────────────────────────────────────────
let _routerInPopstate = false;

function _routeToHash(route) {
  if (!route) return '';
  // Preserve our "type:value" routes (artist:김주형, tag:bgm, etc.) — keep the colon, encode the value.
  const idx = route.indexOf(':');
  if (idx > 0) {
    return '#/' + route.slice(0, idx) + ':' + encodeURIComponent(route.slice(idx + 1));
  }
  return '#/' + encodeURIComponent(route);
}

function _hashToRoute(hash) {
  if (!hash || !hash.startsWith('#/')) return null;
  const path = hash.slice(2);
  if (!path) return null;
  const idx = path.indexOf(':');
  if (idx > 0) {
    return path.slice(0, idx) + ':' + decodeURIComponent(path.slice(idx + 1));
  }
  try { return decodeURIComponent(path); } catch (_) { return path; }
}

function _pushRouteHash(route) {
  if (typeof history === 'undefined' || typeof history.pushState !== 'function') return;
  const hash = _routeToHash(route);
  if (!hash) return;
  if (location.hash === hash) {
    // Same route — just refresh state object, don't add a duplicate stack entry
    try { history.replaceState({ route }, '', hash); } catch (_) {}
    return;
  }
  try { history.pushState({ route }, '', hash); } catch (_) {}
}

// FNV-1a 32-bit hash → stable integer seed for any string id.
// Used by shapes/wall/universe to derive deterministic positions per item.
function _hashSeed(s) {
  let h = 2166136261 >>> 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ─── Starfield background ───────────────────────────────────────────────
// Returns HTML for a sky full of tiny twinkling dots + a few bigger sparkle
// stars. Used as the background of the shapes / universe pages. Positions
// are seeded so the sky is identical on every reload.
function _buildStarfield(seedPrefix, dotCount, sparkleCount) {
  const out = [];
  // Tiny twinkling dots
  for (let i = 0; i < (dotCount || 60); i++) {
    const seed = _hashSeed((seedPrefix || 'sky') + ':dot:' + i);
    const x = ((seed % 10000) / 100).toFixed(2);              // 0–99.99 %
    const y = (((seed >>> 8) % 10000) / 100).toFixed(2);
    const size = 1 + ((seed >>> 16) % 4);                     // 1–4 px
    const dur = (2.4 + ((seed >>> 20) % 35) / 10).toFixed(1); // 2.4–5.8 s
    const delay = (((seed >>> 22) % 40) / 10).toFixed(1);     // 0–4 s
    const maxOp = (0.45 + ((seed >>> 24) % 55) / 100).toFixed(2); // 0.45–1.0
    out.push(
      `<div class="star star-dot" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;` +
      `animation-duration:${dur}s;animation-delay:${delay}s;--max-opacity:${maxOp};"></div>`
    );
  }
  // Bigger sparkle stars (✦)
  for (let i = 0; i < (sparkleCount || 8); i++) {
    const seed = _hashSeed((seedPrefix || 'sky') + ':spk:' + i);
    const x = ((seed % 10000) / 100).toFixed(2);
    const y = (((seed >>> 8) % 10000) / 100).toFixed(2);
    const size = 12 + ((seed >>> 16) % 10);                   // 12–21 px
    const dur = (3.5 + ((seed >>> 20) % 35) / 10).toFixed(1); // 3.5–6.9 s
    const delay = (((seed >>> 22) % 50) / 10).toFixed(1);
    const tilt = ((seed >>> 24) % 30) - 15;                   // -15..+14 deg
    out.push(
      `<div class="star star-sparkle" style="left:${x}%;top:${y}%;font-size:${size}px;` +
      `animation-duration:${dur}s;animation-delay:${delay}s;--tilt:${tilt}deg;">✦</div>`
    );
  }
  return out.join('');
}

// Native back/forward handler — re-render the view encoded in the new URL
window.addEventListener('popstate', (e) => {
  // 즐겨찾기 폴더 안에서 네이티브 뒤로가기(오른쪽 스와이프) → 페이지(탭)를 떠나지 말고 폴더만 나가기.
  // (폴더 진입이 history 엔트리를 쌓으므로, 그 엔트리가 pop 되면 여기서 폴더 나가기를 처리. 안 하면
  //  스와이프가 이전 탭 Tags 로 새어나감.)
  if (window.__universeFolderId && typeof window.exitFolderToUniverse === 'function') {
    window.exitFolderToUniverse();
    return;
  }
  const route = (e.state && e.state.route) || _hashToRoute(location.hash) || 'shapes';
  _routerInPopstate = true;
  try { navigateTo(route); }
  finally { _routerInPopstate = false; }
});


// Toggle bottom hamburger menu
window.toggleMenu = function() {
  const sidebar = document.getElementById('sidebar-nav');
  const btn = document.getElementById('hamburger-btn');
  const isOpen = sidebar.classList.toggle('open');
  if (btn) {
    btn.classList.toggle('open', isOpen);
    const icon = btn.querySelector('i');
    if (icon) icon.className = isOpen ? 'ri-close-line' : 'ri-menu-line';
  }
};
function closeMenu() {
  const sidebar = document.getElementById('sidebar-nav');
  const btn = document.getElementById('hamburger-btn');
  if (sidebar) sidebar.classList.remove('open');
  if (btn) {
    btn.classList.remove('open');
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'ri-menu-line';
  }
}

// Mobile bottom-tab "더보기" — opens the sidebar sheet so mobile users can
// reach search / TAG / 아티스트 페이지 / playlists / login (everything in sidebar).
window.openMoreSheet = function () {
  const sidebar = document.getElementById('sidebar-nav');
  if (!sidebar) return;
  sidebar.classList.add('open');
};

// ===================== GLOBAL BACK BUTTON =====================
// SPA doesn't push to window.history (uses internal `currentView` only), so we
// keep our own stack here. navigateTo() calls _pushNavStep(route); goBack pops.
window.__navStack = window.__navStack || [];
const _ROOT_ROUTES = new Set(['shapes', 'home', 'wall', 'universe']);   // wall·universe도 루트(뒤로가기 숨김) → off-stage 워드마크가 뜨고 뒤로가기와 안 겹침. 워드마크 누르면 발견으로.
let _backInProgress = false;

function _pushNavStep(route) {
  if (!route || _backInProgress) return;
  const top = window.__navStack[window.__navStack.length - 1];
  if (top === route) return; // dedupe consecutive
  window.__navStack.push(route);
  if (window.__navStack.length > 50) window.__navStack.shift();
}

function _updateBackButton(route) {
  const btn = document.getElementById('global-back');
  if (!btn) return;
  // Hide on root pages (도형 = home). On any other page show the button —
  // even with empty history the fallback in goBack() lands on /shapes,
  // so it's always a useful escape hatch.
  const isRoot = _ROOT_ROUTES.has(route);
  btn.hidden = isRoot;
}

// Public: try to close any open overlay first, otherwise pop the nav stack.
window.goBack = function () {
  // 0) 내 우주 안에서 폴더를 보는 중이면 → 먼저 전체 내 우주로
  if (window.__universeFolderId) {
    // enter 때 쌓은 history 엔트리가 있으면 pop → popstate 가 폴더 나가기 처리(스와이프와 동일 경로/상태일치).
    if (window.__universeFolderHistoryPushed) { try { history.back(); return; } catch (_) {} }
    if (typeof window.exitFolderToUniverse === 'function') window.exitFolderToUniverse();
    return;
  }
  // 0) Hard-coded shortcut — 내 페이지/내 우주 → 도형 (요청)
  //   nav stack과 무관하게 항상 도형으로 가도록 명시 (내 페이지로 새는 것 방지)
  if (typeof currentView !== 'undefined' && (currentView === 'profile' || currentView === 'universe')) {
    navigateTo('shapes');
    return;
  }
  // 0.5) 쇼츠 오버레이가 열려 있으면 먼저 닫기
  if (document.getElementById('shape-shorts-overlay')) {
    if (window.closeShapeShorts) window.closeShapeShorts();
    return;
  }
  if (document.getElementById('shorts-overlay')) {
    if (window.closeFolderShorts) window.closeFolderShorts();
    return;
  }
  // 1) Polaroid action menu / sheet
  const popMenu  = document.querySelector('.polaroid-actions-menu');
  const popSheet = document.querySelector('.polaroid-actions-sheet');
  if (popMenu || popSheet) {
    if (typeof window.closeCardActions === 'function') window.closeCardActions();
    return;
  }
  // 2) Sidebar sheet (모바일 더보기로 열린 상태 포함)
  const sidebar = document.getElementById('sidebar-nav');
  if (sidebar && sidebar.classList.contains('open')) {
    closeMenu();
    return;
  }
  // 3) Generic modals (display !== 'none')
  const modalIds = ['playlist-modal', 'dm-modal', 'sto-mini-modal', 'tama-modal', 'onboarding-modal'];
  for (const id of modalIds) {
    const el = document.getElementById(id);
    if (el && el.style.display && el.style.display !== 'none') {
      el.style.display = 'none';
      return;
    }
  }
  // 4) Player expanded (모바일 풀스크린 → 미니 플레이어로)
  const player = document.getElementById('global-player');
  if (player && player.classList.contains('expanded')) {
    player.classList.remove('expanded');
    // ⚠ body lock 도 같이 해제 — 안 하면 overflow:hidden + touch-action:none
    //   이 남아 페이지 전체가 영구 스크롤 불가 + 탭바 사라짐 (stuck state).
    document.body.classList.remove('player-fullscreen');
    return;
  }
  // 5) Pop the nav stack
  if (window.__navStack.length >= 2) {
    window.__navStack.pop();                       // current
    const prev = window.__navStack.pop();          // previous (will be re-pushed)
    if (prev) {
      _backInProgress = true;
      try { navigateTo(prev); }
      finally { _backInProgress = false; _pushNavStep(prev); }
      return;
    }
  }
  // 6) Fallback — go home
  navigateTo('shapes');
};

// Keyboard: Esc only when no input/textarea is focused.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = document.activeElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  // Let goBack handle modal/sheet close + nav pop.
  window.goBack();
});

// Initialization
async function init() {
  // Detect Supabase auth redirect errors in URL hash (e.g. otp_expired) and show a friendly message
  try {
    const hash = window.location.hash || '';
    if (hash.includes('error_code=') || hash.includes('error=access_denied')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const errCode = params.get('error_code') || params.get('error') || 'unknown';
      const errDesc = params.get('error_description') || '';
      let friendly = errDesc.replace(/\+/g, ' ');
      if (errCode === 'otp_expired') friendly = '이메일 링크가 만료됐어요. 이미 가입 완료됐을 수 있으니 그냥 로그인해보세요!';
      // Show toast or alert
      setTimeout(() => {
        if (typeof showToast === 'function') showToast(friendly);
        else alert(friendly);
      }, 800);
      // Clear the URL hash to prevent reshow on reload
      try { history.replaceState(null, '', window.location.pathname); } catch (_) {}
    }
  } catch (e) { console.warn('[init] hash error parse', e); }

  // Wipe stale currentUser BEFORE bootstrap so localStorage never overrides Supabase truth.
  try {
    const db = window.DB.get();
    if (db && db.currentUser) { db.currentUser = null; window.DB.save(db); }
  } catch (_) {}

  // 1) Bootstrap auth (must run first — other fetches may need user.id).
  //    ⚠️ 절대 여기서 멈추면 안 됨. bootstrap 이 네트워크 때문에 안 끝나면
  //    화면이 검은색으로 멈춰버린다(=가입 직후 검은화면 증상). 그래서 6초
  //    타임아웃을 걸어서, 늦어도 UI 는 무조건 그려지게 한다. (세션은 나중에
  //    onAuthChange 가 따라잡음)
  try {
    if (window.Auth) {
      await Promise.race([
        window.Auth.bootstrap(),
        new Promise(r => setTimeout(r, 6000))
      ]);
    }
  } catch (e) {
    console.warn('[init] Auth.bootstrap failed', e);
  }

  // 2) Render UI immediately with mock/cached data (don't wait for network)
  updateHeaderAuth();
  renderSidebarPlaylists();

  // 3) Fetch ALL Supabase data in PARALLEL — non-blocking, UI already responsive
  // This dramatically cuts perceived load time (300ms vs 1500ms+ sequentially)
  const db = window.DB.get();
  const fetches = [];
  if (window.Walls) fetches.push(window.Walls.refreshInto(db).catch(e => console.warn('[init] walls', e)));
  if (window.Tracks) fetches.push(window.Tracks.refreshInto(db).catch(e => console.warn('[init] tracks', e)));
  if (window.Follows) fetches.push(window.Follows.refreshMine().catch(e => console.warn('[init] follows', e)));
  if (window.Playlists) fetches.push(window.Playlists.refreshInto(db).catch(e => console.warn('[init] playlists', e)));
  if (window.Walls && window.Walls.refreshMyBookmarks) fetches.push(window.Walls.refreshMyBookmarks().catch(e => console.warn('[init] bookmarks', e)));
  if (window.Favorites && window.Favorites.refreshMine) fetches.push(window.Favorites.refreshMine().catch(e => console.warn('[init] favorites', e)));
  if (window.Walls && window.Walls.refreshMyFavorites) fetches.push(window.Walls.refreshMyFavorites().catch(e => console.warn('[init] note-favs', e)));
  if (window.Walls && window.Walls.refreshFavoriteCounts) fetches.push(window.Walls.refreshFavoriteCounts().catch(e => console.warn('[init] note-fav-counts', e)));

  // Don't block main render — fire and forget; re-render header/sidebar when done
  Promise.all(fetches).then(() => {
    try { updateHeaderAuth(); renderSidebarPlaylists(); } catch (_) {}
    // Re-render current view if it depends on Supabase data
    try {
      if (currentView === 'profile' && typeof renderProfile === 'function') renderProfile();
      else if (currentView === 'wall' && typeof renderWall === 'function') renderWall();
      else if (currentView === 'shapes' && typeof renderShapes === 'function') renderShapes();
      else if (currentView === 'universe' && typeof renderUniverse === 'function') renderUniverse();
      else if (currentView === 'admin' && typeof renderAdmin === 'function') renderAdmin();
      else if (currentView === 'artist' && typeof renderArtistProfile === 'function') {
        // Replay current /artist:<name> route
        const m = (window.location.hash || '').match(/#\/artist:([^/?]+)/);
        if (m) renderArtistProfile(decodeURIComponent(m[1]));
      }
    } catch (_) {}
    // 알림 Realtime 구독 — auth 가 끝났으니 이제 안전.
    try { if (typeof window.setupNotifRealtime === 'function') window.setupNotifRealtime(); } catch (_) {}
  });

  // Onboarding — first-login pick 3 artists (non-blocking, runs after main load)
  try {
    setTimeout(() => { if (window.maybeShowOnboarding) window.maybeShowOnboarding(); }, 1500);
  } catch (_) {}

  // Notifications — fire one Supabase fetch a bit after login, then update the badge
  try {
    setTimeout(() => {
      if (typeof _refreshNotifications === 'function') {
        _refreshNotifications().catch(()=>{});
      } else if (window.refreshNotifBadge) {
        window.refreshNotifBadge();
      }
    }, 800);
  } catch (_) {}

  // 백그라운드 폴링 — 45초마다 알림 자동 갱신. 페이지에 머물러도 새 알림이 떠오름.
  //   · 탭이 숨겨져 있는 동안엔(예: 다른 탭으로 이동) 폴링 스킵 — 불필요한 트래픽 절약
  //   · 탭이 다시 보이는 순간(visibilitychange)엔 즉시 1회 갱신
  try {
    if (window.__notifPollTimer) clearInterval(window.__notifPollTimer);
    window.__notifPollTimer = setInterval(() => {
      if (document.hidden) return;
      if (!window.__currentUser || !window.__currentUser.id) return;
      if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
    }, 45000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (!window.__currentUser || !window.__currentUser.id) return;
      if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
    });
  } catch (_) {}

  // Realtime push — auth 완료된 후 setupNotifRealtime() 가 실제 구독을 만든다.
  // (이 시점엔 __currentUser 가 null 일 수 있어 setupNotifRealtime 은 아래에 정의만 해두고,
  //  Promise.all(fetches).then 안에서 호출 — onAuthChange 에서도 재호출 가능)
  window.setupNotifRealtime = function () {
    try {
      const user = window.__currentUser;
      if (!user || !user.id) return;
      if (!window.supabase || !window.supabase.channel) return;
      // 이미 같은 user 로 구독 중이면 스킵
      if (window.__notifRealtimeUserId === user.id && window.__notifRealtimeChannel) return;
      // 기존 채널이 있으면 정리
      if (window.__notifRealtimeChannel) {
        try { window.supabase.removeChannel(window.__notifRealtimeChannel); } catch (_) {}
        window.__notifRealtimeChannel = null;
      }
      const myId = user.id;
      const ch = window.supabase
        .channel('notif-' + myId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, (payload) => {
          const r = payload && payload.new;
          if (r && r.sender_id && r.sender_id !== myId) {
            if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cheers', filter: 'artist_id=eq.' + myId }, () => {
          if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'follows', filter: 'followed_id=eq.' + myId }, () => {
          if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wall_note_comments' }, () => {
          if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'track_comments' }, () => {
          if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{});
        })
        // ── 삭제/수정 이벤트 — 다른 디바이스(혹은 본인이 다른 탭) 에서 지운 게 즉시 반영 ──
        // 트랙 / 메모 / 메모 댓글이 어디서든 지워지면 로컬 캐시도 제거 + 현재 화면 재렌더.
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tracks' }, (payload) => {
          const id = payload && payload.old && payload.old.id;
          if (!id) return;
          _purgeTrackEverywhere(id);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wall_notes' }, (payload) => {
          const id = payload && payload.old && payload.old.id;
          if (!id) return;
          _purgeWallNoteEverywhere(id);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wall_note_comments' }, (payload) => {
          const noteId = payload && payload.old && payload.old.note_id;
          const cid    = payload && payload.old && payload.old.id;
          if (noteId && cid) _purgeWallNoteCommentEverywhere(noteId, cid);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') console.log('[notif] realtime subscribed for', myId);
          else if (status === 'CHANNEL_ERROR') console.warn('[notif] realtime channel error');
        });
      window.__notifRealtimeChannel = ch;
      window.__notifRealtimeUserId = myId;
    } catch (e) { console.warn('[notif] setupNotifRealtime', e); }
  };

  // ── 로컬 캐시에서 삭제 + 현재 화면 재렌더 헬퍼 ──
  // 어떤 디바이스에서든 DB 에서 사라진 항목을 메모리/localStorage/DOM 에서 모두 정리.
  function _purgeTrackEverywhere(id) {
    try {
      const db = window.DB && window.DB.get();
      if (db && Array.isArray(db.tracks)) {
        db.tracks = db.tracks.filter(t => t && t.id !== id);
        window.DB.save(db);
      }
      if (Array.isArray(window.__tracks)) {
        window.__tracks = window.__tracks.filter(t => t && t.id !== id);
      }
      _maybeRerenderCurrentView();
    } catch (e) { console.warn('[realtime] purgeTrack', e); }
  }
  function _purgeWallNoteEverywhere(id) {
    try {
      const db = window.DB && window.DB.get();
      if (db && Array.isArray(db.notes)) {
        db.notes = db.notes.filter(n => n && n.id !== id);
        window.DB.save(db);
      }
      if (Array.isArray(window.__wallNotes)) {
        window.__wallNotes = window.__wallNotes.filter(n => n && n.id !== id);
      }
      // 열려있던 모달이 그 노트면 닫기
      if (window.__openNoteDetailId === id && typeof window.closeNoteDetail === 'function') {
        window.closeNoteDetail();
      }
      _maybeRerenderCurrentView();
    } catch (e) { console.warn('[realtime] purgeNote', e); }
  }
  function _purgeWallNoteCommentEverywhere(noteId, cid) {
    try {
      const db = window.DB && window.DB.get();
      const note = db && Array.isArray(db.notes) && db.notes.find(n => n && n.id === noteId);
      if (note && Array.isArray(note.comments)) {
        note.comments = note.comments.filter(c => c && c.id !== cid);
        window.DB.save(db);
      }
      if (Array.isArray(window.__wallNotes)) {
        const cached = window.__wallNotes.find(n => n && n.id === noteId);
        if (cached && Array.isArray(cached.comments)) {
          cached.comments = cached.comments.filter(c => c && c.id !== cid);
        }
      }
      _maybeRerenderCurrentView();
    } catch (e) { console.warn('[realtime] purgeComment', e); }
  }
  function _maybeRerenderCurrentView() {
    try {
      if (currentView === 'wall' && typeof renderWall === 'function') renderWall();
      else if (currentView === 'shapes' && typeof renderShapes === 'function') renderShapes();
      else if (currentView === 'universe' && typeof renderUniverse === 'function') renderUniverse();
      else if (currentView === 'artist' && typeof renderArtistProfile === 'function') {
        const m = (window.location.hash || '').match(/#\/artist:([^/?]+)/);
        if (m) renderArtistProfile(decodeURIComponent(m[1]));
      }
    } catch (_) {}
  }

  // ── 탭이 다시 보이는 순간 — 핵심 데이터 강제 새로고침. ──
  // 다른 디바이스/탭에서 업데이트한 게 cached 로 박혀있다가 어느 순간 사라지는 현상 해결.
  // (Realtime 가 못 잡는 케이스 — 잠시 백그라운드였거나 채널 에러 등 — 의 백업 안전망)
  let _lastVisRefreshAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!window.__currentUser || !window.__currentUser.id) return;
    // 짧은 간격 중복 refresh 방지 (10초 cooldown)
    const now = Date.now();
    if (now - _lastVisRefreshAt < 10000) return;
    _lastVisRefreshAt = now;
    try {
      // 트랙 / 메모 / 내 컬렉션 / 폴더 모두 백그라운드 refresh.
      // 내 우주가 다른 디바이스랑 안 맞던 이유 — Favorites/Bookmarks/Playlists
      // 가 visibility 복귀 시 안 fetch 되고 있었음.
      const _afterFresh = () => { _maybeRerenderCurrentView(); };
      const _tasks = [];
      if (window.Tracks && window.Tracks.refreshInto) {
        _tasks.push(window.Tracks.refreshInto(window.DB.get()).catch(_ => {}));
      }
      if (window.Walls && window.Walls.fetchPage) {
        _tasks.push(window.Walls.fetchPage(0, 50).then(fresh => {
          if (Array.isArray(fresh)) {
            window.__wallNotes = fresh;
            const cached = window.DB.get();
            if (cached) { cached.notes = fresh; window.DB.save(cached); }
          }
        }).catch(_ => {}));
      }
      // ⭐ 내 우주 동기화의 핵심 — Favorites(❤로 모은 곡) / Bookmarks(📌수집한 메모)
      //    / Playlists(폴더) 가 다른 디바이스에서 바뀌었을 수 있으니 다 새로고침.
      if (window.Favorites && window.Favorites.refreshMine) {
        _tasks.push(window.Favorites.refreshMine().catch(_ => {}));
      }
      if (window.Walls && window.Walls.refreshMyBookmarks) {
        _tasks.push(window.Walls.refreshMyBookmarks().catch(_ => {}));
      }
      if (window.Playlists && window.Playlists.refreshInto) {
        _tasks.push(window.Playlists.refreshInto(window.DB.get()).catch(_ => {}));
      }
      // 클라우드 위치 (user_object_positions) 도 가져오기 — 다른 PC 에서 옮긴 위치 반영
      if (window.Positions && window.Positions.hydrateFromCloud) {
        _tasks.push(window.Positions.hydrateFromCloud().catch(_ => {}));
      }
      // 전부 끝나면 현재 화면 재렌더 (내 우주면 새 데이터로 별 배경 그대로 + 아이템만 갱신)
      Promise.all(_tasks).then(_afterFresh);
    } catch (e) { console.warn('[visibility] refresh', e); }
  });
  // Backers/함께만드는중 UI removed — keep backend tables for later

  // Keep UI in sync if auth state changes (sign-out in another tab, session
  // expire, OR a session that arrived AFTER the bootstrap timeout above).
  try {
    if (window.Auth) window.Auth.onAuthChange((event) => {
      updateHeaderAuth();
      renderSidebarPlaylists();
      // 가입/로그인 직후(혹은 늦게 도착한 세션) — 현재 화면을 다시 그려서
      // 로그인 상태가 즉시 반영되게 한다.
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        try {
          if (currentView === 'profile' && typeof renderProfile === 'function') renderProfile();
          else if (currentView === 'universe' && typeof renderUniverse === 'function') renderUniverse();
          else if (currentView === 'shapes' && typeof renderShapes === 'function') renderShapes();
          else if (currentView === 'admin' && typeof renderAdmin === 'function') renderAdmin();
          else if (currentView === 'wall' && typeof renderWall === 'function') renderWall();
        } catch (_) {}
        // 새로 로그인됐을 때도 Realtime 구독 (재로그인/세션 변경 케이스)
        try { if (typeof window.setupNotifRealtime === 'function') window.setupNotifRealtime(); } catch (_) {}
        // 첫 알림 갱신 즉시
        try { if (typeof _refreshNotifications === 'function') _refreshNotifications().catch(()=>{}); } catch (_) {}
      }
      if (event === 'SIGNED_OUT') {
        // 로그아웃 시 Realtime 채널 정리 — 다른 사람 알림 받는 일 없게
        try {
          if (window.__notifRealtimeChannel && window.supabase && window.supabase.removeChannel) {
            window.supabase.removeChannel(window.__notifRealtimeChannel);
            window.__notifRealtimeChannel = null;
            window.__notifRealtimeUserId = null;
          }
        } catch (_) {}
      }
    });
  } catch (_) {}

  updateHeaderAuth();
  renderSidebarPlaylists();

  // Setup Nav Listeners (bottom menu)
  document.querySelectorAll('.sidebar-links a').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const route = el.getAttribute('data-route');
      if (route) {
        document.querySelectorAll('.sidebar-links a').forEach(a => a.classList.remove('active'));
        el.classList.add('active');
        navigateTo(route);
      }
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar-nav');
    const btn = document.getElementById('hamburger-btn');
    const tabBar = document.getElementById('mobile-tab-bar');
    if (
      sidebar && sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !(btn && btn.contains(e.target)) &&
      // Don't auto-close on mobile bottom-tab clicks — the "더보기" slot opens
      // the sheet itself, and the others handle navigation which closes it.
      !(tabBar && tabBar.contains(e.target))
    ) {
      closeMenu();
    }
  });

  // Setup Audio Player Listeners
  playBtn.addEventListener('click', togglePlay);
  audioElement.addEventListener('timeupdate', updateProgress);
  audioElement.addEventListener('ended', () => {
    const icon = playBtn.querySelector('i');
    icon.className = 'ri-play-circle-fill';
    // Send a final 'end' analytics event for the just-finished track
    if (window.Analytics && window.Analytics.trackPlayEnd) {
      window.Analytics.trackPlayEnd().catch(()=>{});
    }
    syncNoteTrackThumbIcons();
    // 🎵 자동 다음 곡 — 큐에 다음 곡이 있으면 0.4s 후 재생
    // 타이머 id 를 저장해 두고, 그 사이 유저가 직접 next/곡 선택을 하면 취소.
    // (안 하면 0.4s 창 안에 next 누를 때 자동+수동 둘 다 실행 → 2곡 점프)
    const q = window.__playQueue;
    if (q && Array.isArray(q.tracks) && q.idx + 1 < q.tracks.length) {
      const nextId = q.tracks[q.idx + 1];
      if (nextId) {
        if (window.__autoNextTimer) clearTimeout(window.__autoNextTimer);
        window.__autoNextTimer = setTimeout(() => {
          window.__autoNextTimer = null;
          // 동일 큐 안에서 이동 — _qNav 표시로 큐 rebuild 방지
          window.__playTrackFromQueue = true;
          try { window.playTrack(nextId, q.source); }
          finally { window.__playTrackFromQueue = false; }
          // shorts 모드면 카드 UI 도 다음 카드로 자동 advance (시각 동기화)
          if (q.source === 'shorts' && typeof _shortsGo === 'function' && document.getElementById('shorts-stage')) {
            try { _shortsGo('next'); } catch (_) {}
          }
          // 모바일 도형 쇼츠도 동일 — 다음 쇼츠 카드로 advance
          if (q.source === 'shapeshorts' && typeof _shapeShortsGo === 'function' && document.getElementById('sshorts-stage')) {
            try { _shapeShortsGo('next'); } catch (_) {}
          }
        }, 400);
      }
    } else if (window.__autoplayRadio !== false) {
      // 큐 끝/없음 → 취향 추천(recommendDemos)으로 라디오식 이어재생. 끝난 곡 시드로 비슷한 데모.
      const endedId = window.__nowPlayingId || (q && q.tracks && q.tracks[q.idx]) || null;
      const pick = window._autoplayRecommend ? window._autoplayRecommend(endedId) : null;
      if (pick && pick.id) {
        if (window.__autoNextTimer) clearTimeout(window.__autoNextTimer);
        window.__autoNextTimer = setTimeout(() => {
          window.__autoNextTimer = null;
          if (!(window.__autoplayHistory instanceof Set)) window.__autoplayHistory = new Set();
          window.__autoplayHistory.add(pick.id);
          if (window.__autoplayHistory.size > 25) window.__autoplayHistory = new Set([...window.__autoplayHistory].slice(-15));
          try { window.playTrack(pick.id, 'radio'); } catch (_) {}
        }, 600);
      }
    }
  });
  // 🎵 이전/다음 곡 버튼 (헤더 컨트롤) — 큐 안에서 이동
  const _prevBtn = document.querySelector('#global-player .control-btn[aria-label="이전 곡"]');
  const _nextBtn = document.querySelector('#global-player .control-btn[aria-label="다음 곡"]');
  const _navQueue = (delta) => {
    const q = window.__playQueue;
    if (!q || !Array.isArray(q.tracks)) return;
    const ni = q.idx + delta;
    if (ni < 0 || ni >= q.tracks.length) return;
    const nextId = q.tracks[ni];
    if (!nextId) return;
    window.__playTrackFromQueue = true;
    try { window.playTrack(nextId, q.source); }
    finally { window.__playTrackFromQueue = false; }
  };
  if (_prevBtn) _prevBtn.addEventListener('click', () => _navQueue(-1));
  if (_nextBtn) _nextBtn.addEventListener('click', () => _navQueue(+1));
  // 셔플 버튼 초기 상태 (localStorage 에서 복원된 __shuffle 반영)
  try { if (typeof _syncShuffleBtn === 'function') _syncShuffleBtn(); } catch (_) {}
  // 우리들의 벽 / 곳곳에 흩어진 .note-track-thumb 미니 커버의 ▶/⏸ 아이콘을
  // 실제 audio 상태와 동기화한다. (재생/일시정지/소스 변경/종료 어디서든)
  audioElement.addEventListener('play', syncNoteTrackThumbIcons);
  audioElement.addEventListener('pause', syncNoteTrackThumbIcons);
  audioElement.addEventListener('emptied', syncNoteTrackThumbIcons);
  // 재생 상태 → 미니 디스크 펄스(.is-playing) + 풀스크린 카드(비주얼라이저/펄스/아이콘) 동기화.
  const _gpEl = () => document.getElementById('global-player');
  const _onPlayState = (playing) => {
    const p = _gpEl(); if (p) p.classList.toggle('is-playing', playing);
    if (window._syncPfsPlayState) window._syncPfsPlayState();
  };
  audioElement.addEventListener('play',  () => _onPlayState(true));
  audioElement.addEventListener('playing', () => _onPlayState(true));
  audioElement.addEventListener('pause', () => _onPlayState(false));
  audioElement.addEventListener('ended', () => _onPlayState(false));

  // Load Initial View — honor URL hash so refreshing /#/admin lands on admin
  const initialRoute = _hashToRoute(location.hash) || 'shapes';
  navigateTo(initialRoute);

  // 첫 방문 온보딩 가이드 — 한 번만. (auth 화면이면 다음 방문에)
  try { setTimeout(() => { if (typeof window.maybeShowOnboarding === 'function') window.maybeShowOnboarding(); }, 800); } catch (_) {}
}

// Logout — clears local state immediately, then best-effort Supabase signOut.
// Robust: works even if Supabase call hangs/fails.
window.logout = async function () {
  console.log('[logout] start');
  // 1) Wipe local state IMMEDIATELY so UI updates even if signOut hangs
  window.__currentUser = null;
  window.__followed = new Set();
  window.__myBackings = new Set();
  window.__bookmarkedNotes = new Set();
  window.__playlists = null;
  try {
    const db = window.DB.get();
    db.currentUser = null;
    window.DB.save(db);
  } catch (_) {}

  // 2) Update UI right away
  try { updateHeaderAuth(); } catch (_) {}
  try { renderSidebarPlaylists(); } catch (_) {}
  showToast(_t('로그아웃 되었어요', 'Signed out'));
  navigateTo('shapes');

  // 3) Best-effort Supabase signOut in background (don't await blocking UI)
  if (window.supabase && window.supabase.auth) {
    Promise.race([
      window.supabase.auth.signOut(),
      new Promise(r => setTimeout(r, 5000))  // 5s max
    ]).then(() => {
      console.log('[logout] supabase signOut complete');
      // Force-clear any leftover session in localStorage
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('sb-') && k.includes('-auth-token')) localStorage.removeItem(k);
        });
      } catch (_) {}
    }).catch(e => console.warn('[logout] supabase signOut error', e));
  }
};

// Router
// 같은 라우트를 짧은 시간 안에 두 번 누르면 무시 — 화면이 살짝 늦게 떠서 두번 누르게 되는 케이스 방지.
let _lastNavRoute = null;
let _lastNavTs = 0;
function navigateTo(route) {
  const _now = Date.now();
  if (route && route === _lastNavRoute && (_now - _lastNavTs) < 500) {
    return;  // 같은 라우트로 0.5초 이내 중복 클릭 — 첫 클릭이 처리중이므로 무시
  }
  _lastNavRoute = route;
  _lastNavTs = _now;

  closeMenu();
  // 페이지 이동 시 풀스크린 플레이어 + body lock 정리 — 어떤 경로로든
  // expanded 채로 라우트가 바뀌면 lock 이 남아 stuck 되는 것 방지.
  {
    const _p = document.getElementById('global-player');
    if (_p && _p.classList.contains('expanded')) _p.classList.remove('expanded');
    document.body.classList.remove('player-fullscreen');
  }
  // Maintain internal back-nav stack (skipped during goBack to avoid loops).
  _pushNavStep(route);
  // Sync the URL hash + browser history. Skip when this nav was itself triggered
  // by a popstate (the browser already updated history for us).
  if (!_routerInPopstate && route) _pushRouteHash(route);
  currentView = route;
  // 외부(supabase.js 등)에서도 라우트 알 수 있게 미러
  window.__currentView = route;
  // 영구 별 레이어는 universe 일 때만 보임 (다른 페이지엔 숨김)
  if (route !== 'universe') document.body.classList.remove('is-universe-route');
  // 도형 페이지일 때 body 클래스 — CSS 가 page-intro 를 fixed 로 띄우는 데 사용
  document.body.classList.toggle('is-shapes-route', route === 'shapes');
  // 발견 페이지를 떠나면 물리 루프 정지(rAF 누수 방지)
  if (route !== 'shapes' && typeof stopShapesPhysics === 'function') stopShapesPhysics();
  // Toggle global back button visibility based on the new route.
  _updateBackButton(route);
  appContent.innerHTML = '';
  // 사용자 요청 — 페이지 이동 시 항상 맨 위로 스크롤.
  // 도형 페이지에서 스크롤 내려간 채로 우리들의 벽 등으로 이동하면
  // 새 페이지가 같은 스크롤 위치에 보이던 문제.
  try {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  } catch (_) {}
  // Re-trigger page fade-in animation
  appContent.style.animation = 'none';
  // eslint-disable-next-line no-unused-expressions
  appContent.offsetHeight;
  appContent.style.animation = '';

  const searchInput = document.getElementById('global-search');
  if (searchInput) searchInput.value = '';

  // Update active sidebar link + mobile bottom tab
  document.querySelectorAll('.sidebar-links a').forEach(a => {
    const r = a.getAttribute('data-route');
    a.classList.toggle('active', r === route || (route && route.startsWith('tag') && r === 'tags'));
  });
  document.querySelectorAll('.mobile-tab').forEach(a => {
    const r = a.getAttribute('data-route');
    a.classList.toggle('is-active', r === route || (route && route.startsWith('tag') && r === 'tags'));
  });

  // Tag detail route: "tag:<tagname>"
  if (route && route.startsWith('tag:')) {
    currentView = 'tag';
    const tag = decodeURIComponent(route.slice(4));
    renderTagDetail(tag);
    setTimeout(observeReveals, 20);
    return;
  }

  // Artist profile route: "artist:<name>"
  if (route && route.startsWith('artist:')) {
    currentView = 'artist';
    const name = decodeURIComponent(route.slice(7));
    try { renderArtistProfile(name); } catch (err) { _renderError(err, '아티스트 페이지'); }
    setTimeout(observeReveals, 20);
    return;
  }

  // Album (project) page route: "album:<projectId>" — 데모 하나의 프로젝트(마스터+데모) 페이지
  if (route && route.startsWith('album:')) {
    currentView = 'album';
    const pid = decodeURIComponent(route.slice(6));
    try { window.renderAlbum(pid); } catch (err) { _renderError(err, '앨범 페이지'); }
    setTimeout(observeReveals, 20);
    return;
  }

  // Playlist universe route: "playlist:<id>"
  if (route && route.startsWith('playlist:')) {
    currentView = 'playlist';
    const pid = decodeURIComponent(route.slice(9));
    try { renderPlaylistUniverse(pid); } catch (err) { _renderError(err, '플레이리스트 universe'); }
    setTimeout(observeReveals, 20);
    return;
  }

  // Polaroid card route: "card:<trackId>" (single-track share card view)
  if (route && route.startsWith('card:')) {
    currentView = 'card';
    const tid = decodeURIComponent(route.slice(5));
    try { window.renderCardPage && window.renderCardPage(tid); }
    catch (err) { _renderError(err, '카드 페이지'); }
    setTimeout(observeReveals, 20);
    return;
  }

  // 곡 상세(응원 루프 + 진화 기록): "song:<trackId>"
  if (route && route.startsWith('song:')) {
    currentView = 'song';
    const tid = decodeURIComponent(route.slice(5));
    try { renderSongDetail(tid); }
    catch (err) { _renderError(err, '곡 페이지'); }
    setTimeout(observeReveals, 20);
    return;
  }

  try {
    switch (route) {
      case 'shapes': renderShapes(); break;
      case 'home': renderHome(); break;
      case 'upload': renderUpload(); break;
      case 'library': window.renderLibrary(); break;
      case 'universe': {
        window.__universeFolderId = null;
        // navigateTo 의 fire-and-forget 제거 — renderUniverse 가 자기 안에서 모든
        // refresh 를 묶어 처리하므로 그쪽에 맡긴다. 두 군데서 동시에 fetch 하면
        // 한쪽 결과가 다른 쪽 결과를 덮어쓰는 경우 발생.
        window.renderUniverse();
        break;
      }
      case 'tags': renderTags(); break;
      case 'wall': renderWall(); break;
      case 'events': renderEvents(); break;
      case 'auth': renderAuth(); break;
      // Pseudo-route: jump to the current user's own /artist:<name> page
      case 'my-artist': {
        const _u = window.__currentUser || window.DB.get().currentUser;
        if (_u && _u.name) { currentView = 'myhome'; renderMyHome(); }
        else navigateTo('auth');
        break;
      }
      // 계정 프로필 (청취자 디자인) — 2026-06-25 재활성. studio 는 도형으로.
      case 'profile':
      case 'me':
        currentView = 'profile';
        renderProfile();
        break;
      case 'studio':
        navigateTo('shapes');
        return;
      case 'search': window.renderSearch(''); break;
      case 'admin': renderAdmin(); break;
      case 'stats': renderStats(); break;
      default: renderShapes();
    }
  } catch (err) {
    _renderError(err, route);
  }

  // Hook up scroll-reveal after content is rendered
  setTimeout(observeReveals, 20);
  // Remove any stale event banner from previous render
  document.querySelectorAll('.event-banner').forEach(el => el.remove());
}

// ===================== PROFILE MODE TOGGLE (Collection / Studio) =====================
window.setProfileMode = function(mode) {
  if (mode !== 'collection' && mode !== 'studio') return;
  try { localStorage.setItem('offstage_profile_mode', mode); } catch (_) {}
  if (currentView === 'profile' && typeof renderProfile === 'function') renderProfile();
};

// === Listener 4-tab switcher (cards / folders / notes / data) ===
window.switchListenerTab = function(tab) {
  document.querySelectorAll('.listener-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
};

// ===================== NOTIFICATIONS — 🔔 (real Supabase polling) =====================
// Cache populated by _refreshNotifications(); _genNotifications stays sync so the existing
// panel/badge code keeps working unchanged.
window.__notifCache = window.__notifCache || [];
window.__notifRefreshing = false;

async function _refreshNotifications() {
  if (window.__notifRefreshing) return;
  if (!window.supabase || !window.__currentUser || !window.__currentUser.id) {
    window.__notifCache = [];
    return;
  }
  window.__notifRefreshing = true;
  const myId   = window.__currentUser.id;
  const myName = window.__currentUser.name || '';
  const items  = [];
  const sb     = window.supabase;
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const since7  = new Date(Date.now() - 7  * 86400000).toISOString();

  try {
    // ── My tracks (need id list for comment/like notifications) ────
    const { data: myTracks } = await sb.from('tracks').select('id, title').eq('artist_id', myId);
    const myTrackIds   = (myTracks || []).map(t => t.id);
    const trackTitleById = Object.fromEntries((myTracks||[]).map(t => [t.id, t.title || '']));

    // ── 1. Comments on my tracks ──────────────────────────────────
    if (myTrackIds.length) {
      const { data: cmts } = await sb.from('track_comments')
        .select('id, track_id, author_id, author_name, text, created_at')
        .in('track_id', myTrackIds).gte('created_at', since30)
        .order('created_at', { ascending: false }).limit(20);
      (cmts || []).filter(c => c.author_id !== myId).forEach(c => {
        items.push({
          id: 'tc_' + c.id, kind: 'track_comment', icon: '💬', color: '#FF6B9D',
          title: _t(`${c.author_name || '익명'}님이 내 곡에 댓글`, `${c.author_name || 'Someone'} commented on your track`),
          body: `「${trackTitleById[c.track_id] || ''}」 — "${(c.text||'').slice(0,40)}"`,
          time: new Date(c.created_at).getTime(),
          onClickRoute: myName ? ('artist:' + encodeURIComponent(myName)) : ''
        });
      });
    }

    // ── 2. Replies on my wall posts ──────────────────────────────
    const { data: myNotes } = await sb.from('wall_notes').select('id').eq('author_id', myId);
    const myNoteIds = (myNotes || []).map(n => n.id);
    if (myNoteIds.length) {
      const { data: replies } = await sb.from('wall_note_comments')
        .select('id, note_id, author_id, author_name, text, created_at')
        .in('note_id', myNoteIds).gte('created_at', since30)
        .order('created_at', { ascending: false }).limit(20);
      (replies || []).filter(r => r.author_id !== myId).forEach(r => {
        items.push({
          id: 'nc_' + r.id, kind: 'note_reply', icon: '✏', color: '#7C5CFF',
          title: _t(`${r.author_name || '익명'}님이 내 글에 답글`, `${r.author_name || 'Someone'} replied to your note`),
          body: `"${(r.text||'').slice(0,60)}"`,
          time: new Date(r.created_at).getTime(),
          onClickRoute: 'wall'
        });
      });
    }

    // ── 3. New fans (last 30 days) ───────────────────────────────
    const { data: fans } = await sb.from('follows')
      .select('follower_id, created_at').eq('followed_id', myId)
      .gte('created_at', since30).order('created_at', { ascending: false }).limit(15);
    const fanIds = (fans || []).map(f => f.follower_id);
    let fanNames = {};
    if (fanIds.length) {
      const { data: fanProfiles } = await sb.from('profiles').select('id, name').in('id', fanIds);
      fanNames = Object.fromEntries((fanProfiles||[]).map(p => [p.id, p.name || '익명']));
    }
    (fans || []).forEach(f => {
      items.push({
        id: 'fan_' + f.follower_id + '_' + f.created_at,
        kind: 'new_fan', icon: '❤', color: '#E91E63',
        title: _t(`${fanNames[f.follower_id] || '익명'}님이 팬이 됐어요`, `${fanNames[f.follower_id] || 'Someone'} became your fan`),
        body: _t('내 페이지에서 확인해봐 ✨', 'Check it on your page ✨'),
        time: new Date(f.created_at).getTime(),
        onClickRoute: myName ? ('artist:' + encodeURIComponent(myName)) : ''
      });
    });

    // ── 4. ♥ on my tracks (grouped per track + per DAY, last 7 days) ──
    //    바뀐 점: 시간(hour) 버킷 → 일(day) 버킷. 한 곡에 하루 동안 묶음 1개.
    if (myTrackIds.length) {
      const { data: faves } = await sb.from('track_favorites')
        .select('track_id, user_id, favorited_at')
        .in('track_id', myTrackIds).gte('favorited_at', since7)
        .order('favorited_at', { ascending: false });
      const byTrackDay = {};
      (faves || []).filter(f => f.user_id !== myId).forEach(f => {
        const ts = new Date(f.favorited_at).getTime();
        const dayBucket = Math.floor(ts / 86400000);          // 하루 단위
        const key = f.track_id + '_' + dayBucket;
        const e = byTrackDay[key] || (byTrackDay[key] = { trackId: f.track_id, day: dayBucket, count: 0, latest: 0 });
        e.count++;
        if (ts > e.latest) e.latest = ts;
      });
      Object.values(byTrackDay).forEach(info => {
        items.push({
          id: 'fav_' + info.trackId + '_d' + info.day,
          kind: 'track_likes', icon: '♥', color: '#F44336',
          title: _t(`${info.count}명이 좋아해요`, `${info.count} ${info.count === 1 ? 'person likes' : 'people like'} this`),
          body: `「${trackTitleById[info.trackId] || '내 곡'}」`,
          time: info.latest,
          onClickRoute: myName ? ('artist:' + encodeURIComponent(myName)) : ''
        });
      });
    }

    // ── 5+6. Followed artists' new tracks + posts (last 7 days) ──
    const { data: myFollows } = await sb.from('follows').select('followed_id').eq('follower_id', myId);
    const followedIds = (myFollows || []).map(f => f.followed_id);
    if (followedIds.length) {
      const { data: followedProfiles } = await sb.from('profiles').select('id, name').in('id', followedIds);
      const nameById = Object.fromEntries((followedProfiles||[]).map(p => [p.id, p.name || '']));

      const { data: newTracks } = await sb.from('tracks')
        .select('id, title, artist_id, created_at, is_demo')
        .in('artist_id', followedIds).gte('created_at', since7)
        .order('created_at', { ascending: false }).limit(15);
      (newTracks || []).forEach(t => {
        const an = nameById[t.artist_id] || '아티스트';
        items.push({
          id: 'newt_' + t.id, kind: 'new_track',
          icon: t.is_demo ? '✏' : '🎵',
          color: t.is_demo ? '#FF9800' : '#1DB954',
          title: _t(`${an}님이 새 ${t.is_demo ? '데모' : '곡'}을 올렸어요`, `${an} uploaded a new ${t.is_demo ? 'demo' : 'track'}`),
          body: `「${t.title || ''}」`,
          time: new Date(t.created_at).getTime(),
          onClickRoute: an ? ('artist:' + encodeURIComponent(an)) : ''
        });
      });

      const { data: newPosts } = await sb.from('wall_notes')
        .select('id, text, author_id, author_name, created_at')
        .in('author_id', followedIds).gte('created_at', since7)
        .order('created_at', { ascending: false }).limit(15);
      (newPosts || []).forEach(p => {
        items.push({
          id: 'newp_' + p.id, kind: 'new_post', icon: '📝', color: '#FFD54F',
          title: _t(`${p.author_name || '아티스트'}님의 새 소식`, `New post from ${p.author_name || 'an artist'}`),
          body: `"${(p.text||'').slice(0,60)}"`,
          time: new Date(p.created_at).getTime(),
          onClickRoute: 'wall'
        });
      });
    }

    // ── 7. 받은 DM — 최근 30일, 다른 사람이 보낸 메시지만 ──
    //     dm_messages 에는 sender_id 가 있음 (보낸 사람 user id). 자기 자신은 제외.
    try {
      const { data: dms } = await sb.from('dm_messages')
        .select('id, sender_id, body, created_at, conversation_id')
        .neq('sender_id', myId)
        .gte('created_at', since30)
        .order('created_at', { ascending: false })
        .limit(20);
      const senderIds = Array.from(new Set((dms || []).map(d => d.sender_id).filter(Boolean)));
      let senderNameById = {};
      if (senderIds.length) {
        const { data: senderProfiles } = await sb.from('profiles').select('id, name').in('id', senderIds);
        senderNameById = Object.fromEntries((senderProfiles || []).map(p => [p.id, p.name || '익명']));
      }
      // 한 conversation 안에서 가장 최근 메시지 1개만 알림으로
      const seenConv = new Set();
      (dms || []).forEach(d => {
        if (seenConv.has(d.conversation_id)) return;
        seenConv.add(d.conversation_id);
        const senderName = senderNameById[d.sender_id] || '익명';
        items.push({
          id: 'dm_' + d.id,
          kind: 'dm', icon: '✉', color: '#42A5F5',
          title: _t(`${senderName}님이 메시지를 보냈어요`, `${senderName} sent you a message`),
          body: `"${(d.body || '').slice(0, 60)}"`,
          time: new Date(d.created_at).getTime(),
          onClickRoute: myName ? ('artist:' + encodeURIComponent(myName)) : ''   // 자기 아티스트 페이지 → 거기서 메세지 버튼
        });
      });
    } catch (e) { console.warn('[notif] dm', e); }

    // ── 8. 받은 응원 — cheers (다른 사람이 내 곡에 보낸 응원 메시지) ──
    try {
      const receivedCheers = []; // 응원 기능 미사용 — 비활성
      (receivedCheers || []).forEach(c => {
        items.push({
          id: 'cheer_' + c.id,
          kind: 'cheer', icon: '💝', color: '#FF6F91',
          title: `${c.supporter_name || '익명'}님이 응원했어요`,
          body: c.message
            ? `「${c.track_title || ''}」 — "${(c.message || '').slice(0, 50)}"`
            : `「${c.track_title || '내 곡'}」 에 응원이 도착했어요`,
          time: new Date(c.created_at).getTime(),
          onClickRoute: myName ? ('artist:' + encodeURIComponent(myName)) : ''
        });
      });
    } catch (e) { console.warn('[notif] cheers', e); }
  } catch (e) {
    console.warn('[notif] refresh', e);
  }

  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  window.__notifCache = items.slice(0, 50);
  window.__notifRefreshing = false;
  // Update the badge with the fresh data
  if (typeof window.refreshNotifBadge === 'function') window.refreshNotifBadge();
}

// Synchronous accessor — returns cached items. _refreshNotifications populates the cache.
function _genNotifications() {
  return window.__notifCache || [];
}

// Legacy mock generator preserved for reference (no longer called)
function _genNotificationsMock() {
  const db = window.DB.get();
  const myName = (db.currentUser && db.currentUser.name) || null;
  const items = [];

  // Recent demos by followed artists (mock: most recent demo from mock follows)
  try {
    const mockFollows = (typeof window._getMockFollows === 'function') ? window._getMockFollows() : [];
    mockFollows.slice(0, 3).forEach((a, i) => {
      const recentDemo = (db.tracks || []).find(t => t && t.artist === a.name && t.isDemo);
      if (recentDemo) {
        items.push({
          id: 'n_demo_' + recentDemo.id,
          kind: 'new_demo',
          icon: '✏',
          color: '#FF8A65',
          title: `${a.name}이(가) 새 데모를 올렸어요`,
          body: `「${recentDemo.title || ''}」`,
          time: Date.now() - (i+1) * 3600000 * 6,
          onClickRoute: 'artist:' + encodeURIComponent(a.name)
        });
      }
    });
  } catch(_) {}

  // Backing thank-you notifications — REMOVED. We don't surface money
  // anymore; cheer messages took over the "thank you" role.

  // Level-up notification (mock: if any followed artist crossed a tier today)
  try {
    const mockFollows = (typeof window._getMockFollows === 'function') ? window._getMockFollows() : [];
    mockFollows.slice(0, 2).forEach((a, i) => {
      const lvl = a._lastLevel || 0;
      if (lvl > 0) {
        items.push({
          id: 'n_lvlup_' + a.name,
          kind: 'levelup',
          icon: '⭐',
          color: '#FF6B9D',
          title: `${a.name} 카드가 자랐어요!`,
          body: `Lv.${lvl} 도달 — 자랑하기 가능`,
          time: Date.now() - 86400000 - (i * 7200000),
          onClickRoute: 'me'
        });
      }
    });
  } catch(_) {}

  // Wall postit replies (someone left a postit on my wall)
  if (myName) {
    try {
      const recentNotes = (db.notes || []).filter(n => n && n.author && n.author !== myName).slice(0, 2);
      recentNotes.forEach((n, i) => {
        items.push({
          id: 'n_postit_' + n.id,
          kind: 'postit',
          icon: '📝',
          color: '#7C4DFF',
          title: `${n.author}이(가) 우리들의 벽에 글을 남겼어요`,
          body: (n.text || '').slice(0, 60),
          time: new Date(n.createdAt).getTime(),
          onClickRoute: 'wall'
        });
      });
    } catch(_) {}
  }

  // Mock event invitation
  items.push({
    id: 'n_event_gonghall',
    kind: 'event',
    icon: '🎤',
    color: '#4ECDC4',
    title: '공감홀 라이브 초대',
    body: '5월 17일 합주실 201호 — 별빛 단계 분께 자동 초대권',
    time: Date.now() - 3600000,
    onClickRoute: null
  });

  // Sort newest first
  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  return items;
}

function _getNotifReadSet() {
  try { return new Set(JSON.parse(localStorage.getItem('offstage_notif_read') || '[]')); }
  catch (_) { return new Set(); }
}
function _saveNotifReadSet(set) {
  try {
    // 무한 누적 방지 — 최근 1000개만 보관 (Set 은 삽입 순서 유지)
    let arr = Array.from(set);
    if (arr.length > 1000) arr = arr.slice(-1000);
    localStorage.setItem('offstage_notif_read', JSON.stringify(arr));
  } catch(_) {}
}

// PC 간 알림 읽음 상태 동기화 — 부팅 시 한 번 클라우드에서 받아와 localStorage 에 합쳐 둠.
// 그 다음 로컬 코드는 그대로 localStorage 만 읽으면 됨.
window._hydrateNotifReadsFromCloud = async function () {
  if (!window.NotifReads) return;
  try {
    const cloudIds = await window.NotifReads.fetchAll();
    if (!cloudIds.length) return;
    const localSet = _getNotifReadSet();
    let added = 0;
    cloudIds.forEach(id => { if (!localSet.has(id)) { localSet.add(id); added++; } });
    if (added > 0) {
      _saveNotifReadSet(localSet);
      if (typeof window.refreshNotifBadge === 'function') window.refreshNotifBadge();
    }
  } catch (_) {}
};

window.openNotifPanel = function() {
  const panel = document.getElementById('notif-panel');
  const drawer = document.getElementById('notif-drawer');
  if (!panel || !drawer) return;

  const fmtTime = (t) => {
    if (!t) return '';
    const diff = Date.now() - t;
    const isEn = window.getLang() === 'en';
    if (diff < 60000) return isEn ? 'just now' : '방금';
    if (diff < 3600000) return isEn ? Math.floor(diff/60000) + 'm ago' : Math.floor(diff/60000) + '분 전';
    if (diff < 86400000) return isEn ? Math.floor(diff/3600000) + 'h ago' : Math.floor(diff/3600000) + '시간 전';
    return isEn ? Math.floor(diff/86400000) + 'd ago' : Math.floor(diff/86400000) + '일 전';
  };

  const renderDrawer = () => {
    const items = _genNotifications();
    const readSet = _getNotifReadSet();
    drawer.innerHTML = `
      <div class="notif-head">
        <button class="notif-close" onclick="closeNotifPanel()" aria-label="닫기"><i class="ri-close-line"></i></button>
        <div class="notif-title">${_t('알림', 'Notifications')}</div>
        <button class="notif-mark-all" onclick="window.markAllNotifsRead()">${_t('모두 읽음', 'Mark all read')}</button>
      </div>
      <div class="notif-list">
        ${items.length === 0 ? `
          <div class="notif-empty">
            <i class="ri-notification-off-line"></i>
            <p>${_t('새 알림이 없어요', 'No new notifications')}</p>
          </div>
        ` : items.map(n => {
          const isRead = readSet.has(n.id);
          const onClick = n.onClickRoute ? `window.markNotifRead('${n.id}'); navigateTo('${n.onClickRoute}'); closeNotifPanel();` : `window.markNotifRead('${n.id}'); event.stopPropagation();`;
          return `
            <div class="notif-item ${isRead ? 'is-read' : ''}" onclick="${onClick}">
              <div class="notif-icon" style="background:${n.color}22; color:${n.color};">${n.icon}</div>
              <div class="notif-body">
                <div class="notif-item-title">${(n.title||'').replace(/</g,'&lt;')}</div>
                <div class="notif-item-sub">${(n.body||'').replace(/</g,'&lt;')}</div>
                <div class="notif-item-time">${fmtTime(n.time)}</div>
              </div>
              ${!isRead ? '<div class="notif-dot"></div>' : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  };

  // 1) 바로 보여줘서 클릭 즉시 패널이 뜨게 (캐시 데이터). 예전엔 Promise.race 1.5초 기다림.
  renderDrawer();
  panel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // 📱 우측 드로어 — 오른쪽으로 스와이프하면 닫기 (들어온 방향으로).
  //    drawer 는 위에서 이미 선언됨 (재사용).
  if (drawer) window._attachSwipeDismiss(drawer, {
    direction: 'right',
    onClose: () => window.closeNotifPanel(),
    scrollGuard: 'auto', backdrop: panel
  });

  // 2) 백그라운드로 새 데이터 받아오면 조용히 다시 그림.
  _refreshNotifications()
    .then(() => { if (panel.style.display !== 'none') renderDrawer(); })
    .catch(() => {});
};

window.closeNotifPanel = function() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
  document.body.style.overflow = '';
  // Refresh badge
  setTimeout(window.refreshNotifBadge, 100);
};

window.markNotifRead = function(id) {
  if (!id) return;
  const set = _getNotifReadSet();
  if (!set.has(id)) {
    set.add(id);
    _saveNotifReadSet(set);
    // 다른 PC 에서도 읽음 처리되게 백그라운드로 동기화 (실패해도 로컬은 이미 처리됨)
    if (window.NotifReads) window.NotifReads.markRead(id);
  }
  window.refreshNotifBadge();
};

window.markAllNotifsRead = function() {
  const items = _genNotifications();
  const set = _getNotifReadSet();
  const newlyRead = [];
  items.forEach(n => { if (!set.has(n.id)) { set.add(n.id); newlyRead.push(n.id); } });
  _saveNotifReadSet(set);
  // 한 번에 묶어서 클라우드 mirror — 새로 읽음 처리된 것만
  if (newlyRead.length && window.NotifReads) window.NotifReads.markManyRead(newlyRead);
  window.refreshNotifBadge();
  window.openNotifPanel(); // re-render
};

window.refreshNotifBadge = function() {
  const items = _genNotifications();
  const readSet = _getNotifReadSet();
  const unread = items.filter(n => !readSet.has(n.id)).length;
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (unread > 0) {
    badge.style.display = '';
    badge.textContent = unread > 99 ? '99+' : String(unread);
  } else {
    badge.style.display = 'none';
  }
};

// ===================== ACTIVITY FEED — 다른 사람들 활동 (Threads tone) =====================
window.renderActivityFeed = function() {
  const db = window.DB.get();
  const myName = db.currentUser && db.currentUser.name;

  // Generate mock feed events from existing data + simulated other-users
  const events = [];
  const mockListeners = ['청취자_민지', '청취자_도윤', '청취자_서연', '청취자_지호', '청취자_은서', '청취자_가람'];

  // Recent backings — REMOVED. We don't surface money on the platform
  // anymore; cheer messages replaced this kind of activity entry.

  // Recent postits as activity
  (db.notes || []).slice(0, 8).forEach((n, i) => {
    if (!n || n.author === myName) return;
    events.push({
      kind: 'postit',
      who: n.author,
      whoAvatar: 'https://i.pravatar.cc/100?u=' + encodeURIComponent(n.author),
      action: '우리들의 벽에 글',
      target: (n.text || '').slice(0, 80) + ((n.text||'').length > 80 ? '...' : ''),
      time: new Date(n.createdAt).getTime(),
      cover: null,
      onClick: `navigateTo('wall')`
    });
  });

  // Card level-ups
  ['엔젤노이즈', '루시드 베어', '오프스테이지'].forEach((artist, i) => {
    const supporter = mockListeners[(i+2) % mockListeners.length];
    const stage = ['데모', '비트', '라이브', '별빛'][i % 4];
    events.push({
      kind: 'levelup',
      who: supporter,
      whoAvatar: 'https://i.pravatar.cc/100?u=' + encodeURIComponent(supporter),
      action: `${artist} 카드를 ${stage}로 키움`,
      target: `Lv.${i+1} 도달 ⭐`,
      time: Date.now() - (i+1) * 86400000 / 3,
      cover: null,
      onClick: `navigateTo('artist:${encodeURIComponent(artist)}')`
    });
  });

  events.sort((a, b) => (b.time||0) - (a.time||0));

  const fmtTime = (t) => {
    const diff = Date.now() - t;
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff/60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff/3600000) + '시간 전';
    return Math.floor(diff/86400000) + '일 전';
  };

  return `
    <div class="feed-section">
      <h2 class="feed-section-title"><i class="ri-pulse-line" style="color:#7C4DFF;"></i> 지금 일어나는 일</h2>
      <div class="feed-list">
        ${events.slice(0, 12).map(e => `
          <div class="feed-item" onclick="${e.onClick}">
            <img src="${e.whoAvatar}" class="feed-avatar" alt="">
            <div class="feed-body">
              <div class="feed-line">
                <strong>${(e.who||'').replace(/</g,'&lt;')}</strong>
                <span class="feed-action">${(e.action||'').replace(/</g,'&lt;')}</span>
              </div>
              <div class="feed-target">${(e.target||'').replace(/</g,'&lt;')}</div>
              <div class="feed-time">${fmtTime(e.time)}</div>
            </div>
            ${e.cover ? `<img src="${e.cover}" class="feed-cover" alt="">` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
};

// ===================== ARTIST DIARY (작업일지 / 미션) =====================
window.openArtistDiary = function() {
  const db = window.DB.get();
  if (!db.currentUser) {
    alert('로그인이 필요해요');
    return;
  }
  const content = document.getElementById('sto-mini-content');
  if (!content) return;
  content.innerHTML = `
    <button class="sto-mini-close" onclick="closeStoMini()" aria-label="닫기"><i class="ri-close-line"></i></button>
    <div class="sto-mini-card">
      <div class="sto-mini-banner" style="background: linear-gradient(135deg, #4ECDC4, #1D3557, #6B46C1);">
        <span class="sto-mini-banner-emoji">🎤</span>
        <div class="sto-mini-banner-text">
          <div class="sto-mini-eyebrow">작업일지 · 미션</div>
          <div class="sto-mini-title">청취자에게 보낼 메시지</div>
        </div>
      </div>
      <p class="sto-mini-desc">
        지금 작업 중인 모습 / 데모 의견 요청 / 공연 알림 등<br>
        <strong>우리들의 벽</strong>에 자동으로 포스트잇으로 올라가요 ✨
      </p>
      <div style="padding: 0 18px 12px;">
        <select id="diary-color" style="width:100%; padding:10px 12px; border:2px solid #111; border-radius:6px; font-family:inherit; font-weight:700; margin-bottom:10px;">
          <option value="yellow">🟡 노랑 (기본)</option>
          <option value="pink">🌸 핑크</option>
          <option value="blue">🔵 파랑</option>
          <option value="green">🟢 초록</option>
          <option value="orange">🟠 주황</option>
          <option value="purple">🟣 보라</option>
        </select>
        <textarea id="diary-text" rows="5" placeholder="합주실 작업 / 데모 의견 요청 / 공연 일정 / 아무거나..." style="width:100%; padding:12px; border:2px solid #111; border-radius:6px; font-family:inherit; font-size:14px; font-weight:600; resize:vertical;"></textarea>
        <button class="btn-primary" onclick="submitArtistDiary()" style="width:100%; margin-top:10px; padding:12px; font-size:14px;">
          <i class="ri-send-plane-fill"></i> 우리들의 벽에 올리기
        </button>
      </div>
      <div class="sto-mini-footer">📝 너의 모든 청취자가 보게 돼</div>
    </div>
  `;
  const modal = document.getElementById('sto-mini-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const ta = document.getElementById('diary-text'); if (ta) ta.focus(); }, 100);
};

window.submitArtistDiary = async function() {
  const text = (document.getElementById('diary-text')?.value || '').trim();
  const color = document.getElementById('diary-color')?.value || 'yellow';
  if (!text) { alert('내용을 적어줘'); return; }
  const db = window.DB.get();
  const author = db.currentUser?.name || '아티스트';
  const note = {
    id: 'n_diary_' + Date.now(),
    author,
    text,
    color,
    rotation: (Math.random() * 6 - 3),
    createdAt: new Date().toISOString(),
    comments: []
  };
  // Try Supabase first
  try {
    if (window.Walls && window.Walls.insert) {
      await window.Walls.insert({ text, color, rotation: note.rotation });
    } else {
      db.notes = [note, ...(db.notes || [])];
      window.DB.save(db);
    }
  } catch (e) {
    // Fallback to localStorage
    db.notes = [note, ...(db.notes || [])];
    window.DB.save(db);
  }
  closeStoMini();
  showToast(_t('🎤 작업일지가 우리들의 벽에 올라갔어요!', '🎤 Your work log is up on our wall!'));
  // Refresh wall if visible
  if (currentView === 'wall' && typeof renderWall === 'function') renderWall();
  if (currentView === 'profile' && typeof renderProfile === 'function') setTimeout(renderProfile, 200);
};

// ===================== STO MANAGER (아티스트 본인의 데모별 SPO 설정) =====================
window.openStoManager = function() {
  const db = window.DB.get();
  if (!db.currentUser) { alert('로그인이 필요해요'); return; }
  const myDemoTracks = (db.tracks || []).filter(t => t && t.isDemo && t.artist === db.currentUser.name);
  const content = document.getElementById('sto-mini-content');
  if (!content) return;

  const fmt = (n) => n >= 10000 ? `${(n/10000).toFixed(0)}만원` : `${(n||0).toLocaleString()}원`;

  let demosListHtml;
  if (myDemoTracks.length === 0) {
    demosListHtml = `
      <div style="text-align:center; padding:30px 18px; color:#6e6478; font-weight:600;">
        🎵 아직 데모곡이 없어요.<br>
        <button class="btn-primary" style="margin-top:12px; padding:10px 20px;" onclick="closeStoMini(); navigateTo('upload');">
          <i class="ri-upload-cloud-2-fill"></i> 첫 데모 올리기
        </button>
      </div>
    `;
  } else {
    demosListHtml = myDemoTracks.map(t => {
      const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(t) : { goalKrw:500000, unitMin:10000, raisedKrw:0, sharePercent:5 };
      const pct = Math.min(100, Math.round((cfg.raisedKrw / cfg.goalKrw) * 100));
      const safeTitle = (t.title || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      return `
        <div class="sto-mgr-row">
          <div class="sto-mgr-row-head">
            <span class="sto-mgr-row-title">「${safeTitle}」</span>
            <span class="sto-mgr-row-pct">${pct}%</span>
          </div>
          <div class="sto-mgr-row-bar"><div style="width:${pct}%; height:100%; background:linear-gradient(90deg,#9C27B0,#6B46C1);"></div></div>
          <div class="sto-mgr-row-stats">
            <span>🎯 목표 ${fmt(cfg.goalKrw)}</span>
            <span>·</span>
            <span>💎 모임 ${fmt(cfg.raisedKrw)}</span>
            <span>·</span>
            <span>📊 지분 ${cfg.sharePercent || 5}%</span>
          </div>
          <button class="sto-mgr-edit-btn" onclick="editStoForTrack('${t.id}')">
            <i class="ri-settings-3-line"></i> 이 데모 SPO 편집
          </button>
        </div>
      `;
    }).join('');
  }

  content.innerHTML = `
    <button class="sto-mini-close" onclick="closeStoMini()" aria-label="닫기"><i class="ri-close-line"></i></button>
    <div class="sto-mini-card">
      <div class="sto-mini-banner" style="background: linear-gradient(135deg, #9C27B0, #6B46C1, #4A2A8A);">
        <span class="sto-mini-banner-emoji">💎</span>
        <div class="sto-mini-banner-text">
          <div class="sto-mini-eyebrow">SPO 관리</div>
          <div class="sto-mini-title">내 데모마다 함께 만들기 설정</div>
        </div>
      </div>
      <p class="sto-mini-desc">
        각 데모의 <strong>목표 금액 / 단위 / 지분 %</strong>를 직접 정해.<br>
        모인 금액은 마스터 발매 후 후원자들에게 자동 분배돼요.
      </p>
      <div class="sto-mgr-list">
        ${demosListHtml}
      </div>
      <div class="sto-mini-footer">🤝 하나증권 SPO 연동 시 실거래 — 현재는 모의</div>
    </div>
  `;
  const modal = document.getElementById('sto-mini-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.editStoForTrack = function(trackId) {
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) return;
  const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(track) : { goalKrw:500000, unitMin:10000, raisedKrw:0, sharePercent:5, perks:[] };
  const goalInput = prompt('🎯 목표 금액 (원)', cfg.goalKrw);
  if (goalInput === null) return;
  const unitInput = prompt('💰 최소 후원 단위 (원)', cfg.unitMin);
  if (unitInput === null) return;
  const shareInput = prompt('📊 지분 % (마스터 수익에서 후원자에게 분배될 비율)', cfg.sharePercent || 5);
  if (shareInput === null) return;
  const newCfg = {
    ...cfg,
    goalKrw: Math.max(10000, parseInt(goalInput, 10) || cfg.goalKrw),
    unitMin: Math.max(1000, parseInt(unitInput, 10) || cfg.unitMin),
    sharePercent: Math.max(1, Math.min(50, parseInt(shareInput, 10) || cfg.sharePercent || 5))
  };
  // Save to track + localStorage
  track.stoConfig = newCfg;
  window.DB.save(db);
  showToast(_t('💎 SPO 설정 저장됨', '💎 SPO settings saved'));
  // Re-open manager to show updated values
  window.openStoManager();
};

// 풀스크린 플레이어 좌우 스와이프 → 이전/다음 곡 (사용자 요청).
// touchstart/end 만 사용(이동 중 transform·preventDefault 없음) → 세로 스와이프-디스미스와 충돌 X.
window._attachPlayerTrackSwipe = function (player) {
  if (!player || player._trackSwipeWired) return;
  player._trackSwipeWired = true;
  let sx = 0, sy = 0, st = 0, tracking = false;
  const EXCLUDE = '.control-btn, .play-btn, .progress-bar, .progress-container, .vol-slider, input, button, a, .player-collect-btn';
  const onStart = (x, y, target) => {
    if (!player.classList.contains('expanded')) return;          // 풀스크린일 때만
    if (target && target.closest && target.closest(EXCLUDE)) return;
    sx = x; sy = y; st = Date.now(); tracking = true;
  };
  const onEnd = (x, y) => {
    if (!tracking) return;
    tracking = false;
    const dx = x - sx, dy = y - sy, dt = Date.now() - st;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 800) {
      const nextBtn = player.querySelector('.control-btn[aria-label="다음 곡"]');
      const prevBtn = player.querySelector('.control-btn[aria-label="이전 곡"]');
      if (dx < 0) { if (nextBtn) nextBtn.click(); }   // 왼쪽 스와이프 → 다음 곡
      else        { if (prevBtn) prevBtn.click(); }   // 오른쪽 스와이프 → 이전 곡
    }
  };
  player.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) onStart(t.clientX, t.clientY, e.target); }, { passive: true });
  player.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; if (t) onEnd(t.clientX, t.clientY); }, { passive: true });
};

// ===================== MOBILE PLAYER EXPAND TOGGLE =====================
window.togglePlayerExpand = function(e) {
  // 풀스크린은 전용 카드(#player-fs)로 — 기존 푸터 reflow 대신 테스트 디자인 오버레이.
  const target = e && e.target;
  if (target && target.closest && target.closest('.control-btn, .progress-bar, .progress-container')) return;
  if (window.openPlayerFs) window.openPlayerFs();
};

// 📱 미니 → 펼치기를 '접기(아래로 슬라이드 닫힘)'의 반대로 — 아래에서 위로 부드럽게
//    슬라이드 인. 클래스만 토글하면 height 가 즉시 점프해 부자연스러우므로 transform 으로 애니메이션.
window._smoothExpandPlayer = function (player) {
  // 스와이프 업 → 풀스크린 카드 오버레이 (자체 슬라이드 인 애니메이션).
  if (window.openPlayerFs) window.openPlayerFs();
};
// 📱 미니 플레이어에서 위로 스와이프 → 펼치기. 컨트롤/슬라이더/버튼만 제외.
window._attachPlayerSwipeUp = function (player) {
  if (!player || player._swipeUpWired) return;
  player._swipeUpWired = true;
  let sx = 0, sy = 0, tracking = false, dragging = false;
  const EXCLUDE = '.control-btn, .play-btn, .progress-bar, .progress-container, .progress-bar-wrap, .vol-slider, input[type="range"], button';
  player.addEventListener('touchstart', (e) => {
    if (player.classList.contains('expanded')) return;     // 미니 상태에서만
    if (window.innerWidth > 720) return;                   // 모바일만
    const t = e.touches[0]; if (!t) return;
    if (e.target && e.target.closest && e.target.closest(EXCLUDE)) return;
    sx = t.clientX; sy = t.clientY; tracking = true; dragging = false;
  }, { passive: true });
  player.addEventListener('touchmove', (e) => {
    if (!tracking || player.classList.contains('expanded')) return;
    const t = e.touches[0]; if (!t) return;
    const dy = t.clientY - sy, dx = t.clientX - sx;
    // 위로 + 세로 우세면 페이지 스크롤만 막음(미니 바를 끌지 않음 — 펼침은 손 뗄 때 부드럽게 슬라이드).
    if (!dragging && dy < -5 && Math.abs(dy) > Math.abs(dx)) dragging = true;
    if (dragging && e.cancelable) e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    if (!tracking) return;
    tracking = false;
    const wasDrag = dragging; dragging = false;
    if (player.classList.contains('expanded')) return;
    const t = (e.changedTouches && e.changedTouches[0]); if (!t) return;
    const dy = t.clientY - sy, dx = t.clientX - sx;
    // 위로 28px 이상 + 세로 우세 → 부드럽게 펼치기 (시간 제한 없음).
    if (wasDrag && dy < -28 && Math.abs(dy) > Math.abs(dx)) {
      window._smoothExpandPlayer(player);
    }
  };
  player.addEventListener('touchend', end, { passive: true });
  player.addEventListener('touchcancel', end, { passive: true });
};
try { window._attachPlayerSwipeUp(document.getElementById('global-player')); } catch (_) {}

// ════════════════════════════════════════════════════════════════════
// 풀스크린 플레이어 카드 (#player-fs) — 테스트 디자인 그대로.
//   미니바 탭 / 스와이프업 / 펼치기 버튼 → openPlayerFs.
//   실제 동작은 기존 함수(togglePlay)·푸터 이전/다음 버튼·updateProgress 에 배선.
// ════════════════════════════════════════════════════════════════════
window.openPlayerFs = function () {
  const fs = document.getElementById('player-fs');
  if (!fs) return;
  if (window.syncPlayerFs) window.syncPlayerFs();
  fs.classList.add('open');
  fs.setAttribute('aria-hidden', 'false');
  document.body.classList.add('player-fs-open');
  if (window._attachPlayerFsSwipe) window._attachPlayerFsSwipe();
};
window.closePlayerFs = function () {
  const fs = document.getElementById('player-fs');
  if (!fs) return;
  fs.classList.remove('open');
  fs.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('player-fs-open');
};
// 현재 곡 정보로 풀스크린 카드 채우기 (색·태그·제목·아티스트·재생상태).
window.syncPlayerFs = function () {
  const fs = document.getElementById('player-fs');
  if (!fs) return;
  const gp = document.getElementById('global-player');
  const color = ((gp && gp.style.getPropertyValue('--player-color')) || '').trim() || '#8b5cf6';
  fs.style.setProperty('--pfs-color', color);
  const titleEl = document.getElementById('player-title');
  const t = document.getElementById('pfs-title');
  if (t) t.innerText = (titleEl && titleEl.innerText) || '선택된 곡 없음';
  const a = document.getElementById('pfs-artist');
  if (a) a.innerText = window.__playerArtistName || '-';   // 원(#pfs-tags)이 도형 글을 보여주므로 서브는 아티스트
  // 원 안 #태그 — 미니에 채워둔 #player-tags span 복사.
  const src = document.getElementById('player-tags');
  const dst = document.getElementById('pfs-tags');
  if (dst) {
    const spans = src ? Array.prototype.slice.call(src.querySelectorAll('span')) : [];
    dst.innerHTML = spans.length ? spans.map(function (s) { return '<p>' + s.textContent + '</p>'; }).join('') : '';
  }
  if (window._syncPfsPlayState) window._syncPfsPlayState();
};
// 재생/일시정지 → 풀스크린 카드 아이콘 + 비주얼라이저/펄스 on·off.
window._syncPfsPlayState = function () {
  const fs = document.getElementById('player-fs');
  const audio = document.getElementById('audio-element');
  if (!fs || !audio) return;
  const playing = !audio.paused && !audio.ended;
  fs.classList.toggle('playing', playing);
  const icon = document.querySelector('#pfs-play i');
  if (icon) icon.className = playing ? 'ri-pause-fill' : 'ri-play-fill';
};
// 풀스크린 컨트롤 → 실제 동작 (기존 함수/푸터 버튼 재사용).
window._pfsTogglePlay = function () {
  if (typeof togglePlay === 'function') togglePlay();
  else { const au = document.getElementById('audio-element'); if (au) { au.paused ? au.play() : au.pause(); } }
  if (window._syncPfsPlayState) window._syncPfsPlayState();
};
window._pfsPrev = function () {
  const b = document.querySelector('#global-player .control-btn[aria-label="이전 곡"]');
  if (b) b.click();
};
window._pfsNext = function () {
  const b = document.querySelector('#global-player .control-btn[aria-label="다음 곡"]');
  if (b) b.click();
};
// 풀스크린 플레이어 스와이프 — 좌:이전곡 / 우:다음곡 / 아래:축소(닫기). (사용자 지정, 멱등)
window._attachPlayerFsSwipe = function () {
  const fs = document.getElementById('player-fs');
  if (!fs || fs._swipeWired) return;
  fs._swipeWired = true;
  let sx = 0, sy = 0, tracking = false;
  const EXCLUDE = 'button, .pfs-track, input, a';
  fs.addEventListener('touchstart', function (e) {
    const t = e.touches && e.touches[0]; if (!t) { tracking = false; return; }
    if (e.target && e.target.closest && e.target.closest(EXCLUDE)) { tracking = false; return; }
    sx = t.clientX; sy = t.clientY; tracking = true;
  }, { passive: true });
  // 스와이프 중엔 브라우저 기본 동작(당겨서 새로고침/세로 바운스) 차단 — 좌우 곡넘김이 화면을 안 흔들게.
  fs.addEventListener('touchmove', function (e) {
    if (!tracking) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    if (e.cancelable && (Math.abs(t.clientX - sx) > 6 || Math.abs(t.clientY - sy) > 6)) e.preventDefault();
  }, { passive: false });
  fs.addEventListener('touchend', function (e) {
    if (!tracking) return; tracking = false;
    const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const TH = 48;   // 최소 이동
    if (adx > ady && adx > TH) {
      if (dx < 0) { if (window._pfsPrev) window._pfsPrev(); }   // 좌 → 이전 곡
      else { if (window._pfsNext) window._pfsNext(); }          // 우 → 다음 곡
    } else if (dy > TH && ady > adx) {
      if (window.closePlayerFs) window.closePlayerFs();         // 아래 → 축소
    }
  }, { passive: true });
};

// 🔗 현재 재생 곡 공유 — 미니바/풀스크린 플레이어의 공유 버튼.
//    카드 페이지(#card:<id>) 링크를 시스템 공유(navigator.share) 또는 클립보드 복사.
// 공유 — 음악앱처럼 깔끔한 바텀 시트(곡정보 + 링크복사 + 다른앱공유).
// navigator.share 직접호출은 iOS/Mac에서 제목/텍스트/URL이 이상하게 뜨던 문제 → 자체 시트로 통일하고
// '다른 앱으로'는 시트 안의 한 옵션으로만 둠(데스크탑/미지원은 링크복사로 깔끔하게 폴백).
window.sharePlayerTrack = function (e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const tid = window.currentPlayingTrack;
  if (!tid) { if (typeof showToast === 'function') showToast(_t('재생 중인 곡이 없어요', 'No song playing')); return; }
  if (window.openShareSheet) window.openShareSheet(tid);
};

window.openShareSheet = function (tid) {
  if (!tid) return;
  const db = window.DB.get();
  const t = (db.tracks || []).find(x => x && x.id === tid) || {};
  const title = t.title || 'Off-Stage';
  const artist = t.artist || '';
  const url = location.origin + location.pathname + '#card:' + encodeURIComponent(tid);
  const _esc = (s) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const PAL = ['#8B7CF6', '#FB6F92', '#46E08B', '#54E0CE', '#FFC94D', '#5AA9FF'];
  const col = PAL[(_hashSeed('disc:' + tid) >>> 0) % PAL.length];
  window.__shareData = { title, artist, url };
  const ex = document.getElementById('share-sheet'); if (ex) ex.remove();
  const nativeBtn = navigator.share ? `<button class="ssh-opt" onclick="window._shareNative()"><i class="ri-share-forward-line"></i><span>${_t('다른 앱으로', 'Share to apps')}</span></button>` : '';
  const html = `<div id="share-sheet" class="ssh-ov" onclick="if(event.target===this) closeShareSheet()"><style>
.ssh-ov{position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s;}
.ssh-ov.show{opacity:1;}
.ssh-card{width:100%;max-width:440px;background:#15151E;border:1px solid rgba(255,255,255,.08);border-radius:22px 22px 0 0;padding:10px 18px calc(18px + env(safe-area-inset-bottom));transform:translateY(100%);transition:transform .24s cubic-bezier(.22,1,.36,1);color:#F4F4F7;font-family:'Pretendard',sans-serif;}
.ssh-ov.show .ssh-card{transform:translateY(0);}
.ssh-grab{width:38px;height:4px;border-radius:3px;background:rgba(255,255,255,.2);margin:2px auto 14px;}
.ssh-song{display:flex;align-items:center;gap:13px;margin-bottom:16px;}
.ssh-disc{width:48px;height:48px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 16px rgba(0,0,0,.35);}
.ssh-t{font-size:15px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ssh-a{font-size:12.5px;color:#8B8B9A;margin-top:2px;}
.ssh-opts{display:flex;gap:10px;margin-bottom:6px;}
.ssh-opt{flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;padding:14px;border-radius:14px;background:#1D1D2A;border:1px solid rgba(255,255,255,.07);color:#F4F4F7;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;}
.ssh-opt:active{transform:scale(.97);}
.ssh-opt i{font-size:23px;color:#8B7CF6;}
.ssh-cancel{width:100%;padding:13px;border-radius:14px;background:transparent;border:none;color:#8B8B9A;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px;}
</style>
    <div class="ssh-card">
      <div class="ssh-grab"></div>
      <div class="ssh-song"><div class="ssh-disc" style="background:${col}"></div><div style="min-width:0;"><div class="ssh-t">${_esc(title)}</div><div class="ssh-a">${_esc(artist)}</div></div></div>
      <div class="ssh-opts">
        <button class="ssh-opt" onclick="window._shareCopy()"><i class="ri-link"></i><span>${_t('링크 복사', 'Copy link')}</span></button>
        ${nativeBtn}
      </div>
      <button class="ssh-cancel" onclick="closeShareSheet()">${_t('닫기', 'Close')}</button>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  requestAnimationFrame(() => { const s = document.getElementById('share-sheet'); if (s) s.classList.add('show'); });
  // 아래로 스와이프 → 닫기 (모바일). 카드가 실제로 움직이는 요소, 오버레이가 backdrop.
  try {
    const _sc = document.querySelector('#share-sheet .ssh-card');
    const _ov = document.getElementById('share-sheet');
    if (_sc && window._attachSwipeDismiss) window._attachSwipeDismiss(_sc, {
      direction: 'down', backdrop: _ov, grabber: false,
      onClose: () => { const s = document.getElementById('share-sheet'); if (s) s.remove(); }
    });
  } catch (_) {}
};
window.closeShareSheet = function () { const s = document.getElementById('share-sheet'); if (s) { s.classList.remove('show'); setTimeout(() => { try { s.remove(); } catch (_) {} }, 220); } };
window._shareCopy = async function () {
  const d = window.__shareData || {};
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(d.url); if (typeof showToast === 'function') showToast(_t('링크 복사됐어요 🔗', 'Link copied 🔗')); }
    else { const ta = document.createElement('textarea'); ta.value = d.url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); if (typeof showToast === 'function') showToast(_t('링크 복사됐어요 🔗', 'Link copied 🔗')); } catch (_) { if (typeof showToast === 'function') showToast(d.url); } ta.remove(); }
  } catch (_) { if (typeof showToast === 'function') showToast(d.url); }
  closeShareSheet();
};
window._shareNative = async function () {
  const d = window.__shareData || {};
  closeShareSheet();
  try { await navigator.share({ title: d.title, text: d.title + (d.artist ? ' — ' + d.artist : ''), url: d.url }); } catch (_) { /* 취소 무시 */ }
};

// (event banner removed)

// ===================== TAG HELPERS =====================
function getTagStats() {
  const db = window.DB.get();
  const counts = {};
  db.tracks.forEach(t => (t.tags || []).forEach(tag => {
    counts[tag] = (counts[tag] || 0) + 1;
  }));
  return counts;
}

function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) - h) + tag.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 72%, 66%)`;
}

function tagFontSize(count, max) {
  const min = 13, cap = 38;
  if (max <= 1) return 20;
  const ratio = count / max;
  return Math.round(min + (cap - min) * Math.pow(ratio, 0.7));
}

window.navigateToTag = function(tag) {
  // tag comes in raw (unencoded); navigateTo will handle routing
  navigateTo('tag:' + encodeURIComponent(tag));
}

// ===================== 다마고치 / 함께 만드는 아티스트 STAGE =====================
// 영향력 점수 = 스트리밍 30% + SPO 참여자 70% (정규화 0~100)
// 모든 팬이 같은 아티스트에 대해 같은 단계 카드를 본다 — 카드는 아티스트의 성장 추적.
// Music-career themed stages (no more flowers — too cute)
const TAMA_STAGES = [
  { level: 0, name: '씨앗',   emoji: '🌱', color: '#E0E0E0', color2: '#BDBDBD', minScore: 0  },
  { level: 1, name: '데모',   emoji: '🎤', color: '#90CAF9', color2: '#42A5F5', minScore: 10 },
  { level: 2, name: '비트',   emoji: '🎸', color: '#CE93D8', color2: '#9C27B0', minScore: 25 },
  { level: 3, name: '라이브', emoji: '🔥', color: '#FFAB91', color2: '#FF5722', minScore: 50 },
  { level: 4, name: '별빛',   emoji: '⭐', color: '#FFE082', color2: '#FFB300', minScore: 75 }
];

// 스트리밍 정규화: 0~100k 기준
const STREAM_MAX = 100000;
// SPO 참여자 정규화: 0~100명 기준
const SPO_MAX = 100;

function getTamaStage(streamCount, spoBackers) {
  const streams = Math.max(0, Number(streamCount) || 0);
  const backers = Math.max(0, Number(spoBackers) || 0);
  // 정규화 (0~100)
  const streamNorm = Math.min(100, (streams / STREAM_MAX) * 100);
  const spoNorm    = Math.min(100, (backers / SPO_MAX) * 100);
  // 가중 점수 (0~100): 스트림 30% + SPO 70%
  const score = streamNorm * 0.3 + spoNorm * 0.7;

  let stage = TAMA_STAGES[0];
  for (const s of TAMA_STAGES) {
    if (score >= s.minScore) stage = s;
  }
  const next = TAMA_STAGES[stage.level + 1] || null;
  let progress = 1.0;
  if (next) {
    const span = next.minScore - stage.minScore;
    progress = Math.min(1, Math.max(0, (score - stage.minScore) / span));
  }
  return {
    ...stage,
    score: Math.round(score * 10) / 10,
    streams,
    backers,
    progress,
    nextName: next ? next.name : '꽉찬 별빛',
    nextEmoji: next ? next.emoji : '✨',
    isMax: !next
  };
}

// Safely escape a string for embedding inside a JS single-quoted string in an HTML onclick attribute
function jsEscape(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ===================== SCROLL REVEAL (Framer Motion-like whileInView) =====================
let _revealObserver = null;
function observeReveals() {
  if (!_revealObserver) {
    _revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          _revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  }
  document.querySelectorAll('.reveal:not(.in-view), .reveal-scale:not(.in-view)').forEach(el => {
    _revealObserver.observe(el);
  });
}

window.doSearch = function() {
  const inputEl = document.getElementById('global-search') || document.getElementById('search-page-input');
  const query = (inputEl && inputEl.value || '').trim();
  if (currentView !== 'search') navigateTo('search');
  setTimeout(() => window.renderSearch(query), 50);
};

window.renderSearch = function(query) {
  currentView = 'search';
  const db = window.DB.get();
  const q = (query || '').toLowerCase().trim();

  // Always render the search page shell with input prominent
  const matchedTracks = q ? db.tracks.filter(t => (t.title||'').toLowerCase().includes(q) || (t.artist||'').toLowerCase().includes(q)) : [];
  const matchedArtists = q ? (() => {
    // Unique artists from tracks + following list
    const namesSet = new Set();
    db.tracks.forEach(t => { if (t.artist && t.artist.toLowerCase().includes(q)) namesSet.add(t.artist); });
    (db.following || []).forEach(a => { if (a.name && a.name.toLowerCase().includes(q)) namesSet.add(a.name); });
    return Array.from(namesSet).map(name => {
      const fromTrack = db.tracks.find(t => t.artist === name);
      const fromFollow = (db.following || []).find(a => a.name === name);
      return {
        name,
        avatar: (fromFollow && fromFollow.avatar) || (fromTrack && fromTrack.artistAvatar) || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(name))
      };
    });
  })() : [];
  const matchedTags = q ? (() => {
    const tagCounts = {};
    db.tracks.forEach(t => (t.tags || []).forEach(tag => {
      if (tag.toLowerCase().includes(q)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }));
    return Object.entries(tagCounts).sort((a,b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({name, count}));
  })() : [];
  const matchedNotes = q ? (db.notes || []).filter(n => (n.text||'').toLowerCase().includes(q) || (n.author||'').toLowerCase().includes(q)) : [];

  // Trending (when no query) — top tags + popular tracks
  const popularTracks = !q ? [...(db.tracks || [])].filter(t => !t.isDemo).sort((a,b) => (b.plays||0)-(a.plays||0)).slice(0, 6) : [];
  const popularTags = !q ? (() => {
    const tc = {};
    db.tracks.forEach(t => (t.tags || []).forEach(tag => { tc[tag] = (tc[tag]||0)+1; }));
    return Object.entries(tc).sort((a,b) => b[1]-a[1]).slice(0, 12).map(([name, count]) => ({name, count}));
  })() : [];

  const totalResults = matchedTracks.length + matchedArtists.length + matchedTags.length + matchedNotes.length;

  let html = `
    <div class="search-page">
      <div class="search-input-wrap">
        <i class="ri-search-line"></i>
        <input type="text" id="search-page-input" placeholder="${_t('아티스트 · 곡 · #태그 · 응원글 검색', 'Search artists · tracks · #tags · notes')}" value="${(query||'').replace(/"/g,'&quot;')}"
               oninput="window.searchOnInput()" onkeypress="if(event.key==='Enter') window.doSearch()">
        ${q ? `<button class="search-clear-btn" onclick="document.getElementById('search-page-input').value=''; window.renderSearch('');"><i class="ri-close-circle-fill"></i></button>` : ''}
      </div>
  `;

  if (!q) {
    // Empty state — trending tags + popular tracks
    html += `
      <div class="search-section">
        <h3 class="search-section-title"><i class="ri-fire-fill" style="color:#FF6B9D;"></i> ${_i18n('인기 태그', 'Trending tags')}</h3>
        <div class="search-tag-cloud">
          ${popularTags.map(t => `
            <button class="search-tag-chip" onclick="navigateToTag('${jsEscape(t.name)}')">
              <span>#${(t.name||'').replace(/</g,'&lt;')}</span>
              <span class="search-tag-count">${t.count}</span>
            </button>
          `).join('')}
        </div>
      </div>
      ${popularTracks.length > 0 ? `
        <div class="search-section">
          <h3 class="search-section-title"><i class="ri-music-2-fill" style="color:var(--brand-color);"></i> ${_i18n('인기 곡', 'Popular tracks')}</h3>
          <div class="search-track-list">
            ${popularTracks.map(t => `
              <div class="search-track-row" onclick="playTrack('${t.id}')">
                <img src="${t.cover}" alt="" class="search-track-cover">
                <div class="search-track-info">
                  <div class="search-track-title">「${(t.title||'').replace(/</g,'&lt;')}」</div>
                  <div class="search-track-artist">${(t.artist||'').replace(/</g,'&lt;')} · ${t.plays || 0} plays</div>
                </div>
                <button class="search-track-play"><i class="ri-play-fill"></i></button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } else if (totalResults === 0) {
    html += `
      <div class="search-empty">
        <i class="ri-search-eye-line"></i>
        <p>${_t(`"${(query||'').replace(/</g,'&lt;')}" 에 대한 결과가 없어요`, `No results for "${(query||'').replace(/</g,'&lt;')}"`)}</p>
        <p class="search-empty-sub">${_t('다른 키워드로 검색해보세요', 'Try a different keyword')}</p>
      </div>
    `;
  } else {
    html += `<div class="search-result-count">${_t(`"${(query||'').replace(/</g,'&lt;')}" — ${totalResults}개 결과`, `"${(query||'').replace(/</g,'&lt;')}" — ${totalResults} results`)}</div>`;

    if (matchedArtists.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-section-title"><i class="ri-user-3-fill" style="color:#7C4DFF;"></i> ${_i18n('아티스트', 'Artists')} <span class="search-count">${matchedArtists.length}</span></h3>
          <div class="search-artist-grid">
            ${matchedArtists.slice(0, 12).map(a => `
              <div class="search-artist-card" onclick="navigateTo('artist:${encodeURIComponent(a.name)}')">
                <img src="${a.avatar}" class="search-artist-avatar" alt="${(a.name||'').replace(/"/g,'&quot;')}" loading="lazy">
                <div class="search-artist-name">${(a.name||'').replace(/</g,'&lt;')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (matchedTracks.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-section-title"><i class="ri-music-2-fill" style="color:var(--brand-color);"></i> ${_i18n('곡', 'Tracks')} <span class="search-count">${matchedTracks.length}</span></h3>
          <div class="search-track-list">
            ${matchedTracks.slice(0, 20).map(t => {
              const safeTitle = (t.title||'').replace(/</g,'&lt;');
              const safeArtist = (t.artist||'').replace(/</g,'&lt;');
              return `
                <div class="search-track-row" onclick="playTrack('${t.id}')">
                  <img src="${t.cover}" alt="" class="search-track-cover">
                  <div class="search-track-info">
                    <div class="search-track-title">「${safeTitle}」 ${t.isDemo ? '<span class="search-demo-tag">DEMO</span>' : '<span class="search-master-tag">MASTER</span>'}</div>
                    <div class="search-track-artist">${safeArtist}</div>
                  </div>
                  <button class="search-track-play"><i class="ri-play-fill"></i></button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    if (matchedTags.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-section-title"><i class="ri-hashtag" style="color:#4ECDC4;"></i> ${_i18n('태그', 'Tags')} <span class="search-count">${matchedTags.length}</span></h3>
          <div class="search-tag-cloud">
            ${matchedTags.map(t => `
              <button class="search-tag-chip" onclick="navigateToTag('${jsEscape(t.name)}')">
                <span>#${(t.name||'').replace(/</g,'&lt;')}</span>
                <span class="search-tag-count">${t.count}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (matchedNotes.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-section-title"><i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> ${_i18n('응원글', 'Notes')} <span class="search-count">${matchedNotes.length}</span></h3>
          <div class="search-notes-grid">
            ${matchedNotes.slice(0, 12).map(n => {
              const c = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
              const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
              const safeAuth = (n.author || '').replace(/</g,'&lt;');
              return `
                <div class="search-note-card" style="background:${c.bg}; color:${c.text};" onclick="openNoteDetail('${n.id}')">
                  <div class="search-note-body">${safeTxt}</div>
                  <div class="search-note-sig">— ${safeAuth}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  }

  html += `</div>`;
  appContent.innerHTML = html;
  setTimeout(() => {
    const inp = document.getElementById('search-page-input');
    if (inp && !q) inp.focus();
  }, 80);
};

// Live search as user types (debounced)
window.searchOnInput = function() {
  clearTimeout(window._searchInputTimer);
  window._searchInputTimer = setTimeout(() => {
    const inp = document.getElementById('search-page-input');
    if (inp) window.renderSearch(inp.value || '');
  }, 200);
};

/* =========================================================
   VIEWS
========================================================= */

// Sidebar Auth & Playlists
function updateHeaderAuth() {
  // Prefer Supabase-synced profile if available, fall back to legacy localStorage
  const user = window.__currentUser || (window.DB && window.DB.get && window.DB.get().currentUser) || null;
  const container = document.getElementById('auth-header-container');
  // Toggle body.guest class so sidebar can hide gated links when logged out
  document.body.classList.toggle('guest', !user);
  // Toggle body.role-* class so menu items adapt (e.g. hide 아티스트 페이지 for listener)
  const role = (user && user.role) || 'listener';
  document.body.classList.toggle('role-listener', role === 'listener');
  document.body.classList.toggle('role-artist',   role === 'artist' || role === 'student');
  document.body.classList.toggle('role-admin',    role === 'admin');
  if (!container) return;
  if (user) {
    // 역할 구분 폐지 — 누구나 아티스트로도 동작. admin만 Admin 패널 추가 노출.
    const role = user.role || 'listener';
    const isAdmin = role === 'admin';
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; cursor:pointer;" onclick="navigateTo('profile')" title="내 계정 프로필">
        <img src="${user.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" alt="${(user.name||'').replace(/"/g,'&quot;')}">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user.name}</div>
          <div style="font-size:11px;color:var(--text-secondary);">${isAdmin ? _t('관리자', 'Admin') : '@' + (user.name || '').replace(/\s+/g,'').toLowerCase()}</div>
        </div>
        <i class="ri-settings-3-line" style="color:var(--text-secondary);font-size:16px;cursor:pointer;" onclick="event.stopPropagation(); editProfile();" title="${_t('설정','Settings')}"></i>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${isAdmin ? `<button class="btn-primary" style="padding:6px 14px;font-size:12px;background:#9C27B0;" onclick="navigateTo('admin')"><i class="ri-dashboard-fill"></i> Admin</button>` : ''}
        <button style="color:var(--text-secondary);font-size:12px;padding:6px 8px;" onclick="logout()">${_t('로그아웃', 'Sign out')}</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn-primary" style="width:100%;padding:10px;font-size:13px;" onclick="navigateTo('auth')">${_t('로그인 / 가입', 'Sign in / up')}</button>
    `;
  }
}

window.renderSidebarPlaylists = function() {
  const db = window.DB.get();
  const container = document.getElementById('sidebar-playlists');
  if (!container) return;

  const playlists = db.playlists || [];
  if (playlists.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="sidebar-playlists-title">Playlists</div>
    ${playlists.map(p => `
      <div class="sidebar-playlist-item" title="${p.title}">${p.title}</div>
    `).join('')}
  `;
}

// (legacy logout removed — async version defined above)

// ── 로컬 즐겨찾기 (Supabase ID 없는 mock 아티스트도 팔로우 가능) ──
window._getFollowedNames = function() {
  try {
    return new Set(JSON.parse(localStorage.getItem('offstage_followed_artists') || '[]'));
  } catch (_) { return new Set(); }
};
window._setFollowedNames = function(set) {
  try { localStorage.setItem('offstage_followed_artists', JSON.stringify(Array.from(set))); } catch (_) {}
};
window._isFollowingName = function(name) {
  return window._getFollowedNames().has(name);
};
window._toggleFollowName = function(name) {
  const s = window._getFollowedNames();
  if (s.has(name)) { s.delete(name); window._setFollowedNames(s); return false; }
  s.add(name); window._setFollowedNames(s); return true;
};

window.toggleFollowArtist = async function (artistId, artistName) {
  if (!artistName) return;
  let following;
  let syncedToServer = false;

  // Supabase ID + 로그인 상태 → 서버 토글 시도
  if (artistId && window.Follows && window.__currentUser) {
    try {
      const r = await window.Follows.toggle(artistId);
      following = r.following;
      syncedToServer = true;
    } catch (e) {
      console.warn('[follow] supabase fail, fallback to local', e);
      if (e && /자기 자신/.test(e.message || '')) {
        showToast(_t('자기 자신은 팔로우 할 수 없어요', "You can't follow yourself"));
        return;
      }
    }
  }

  if (!syncedToServer) {
    // 로컬 토글(mock 아티스트 / 서버 실패 / 미로그인)
    following = window._toggleFollowName(artistName);
    // 버튼 상태 계산이 __followed.has(artistId)로도 이뤄지므로 같이 갱신해야 UI가 바뀜.
    if (artistId && window.__followed) {
      if (following) window.__followed.add(artistId);
      else window.__followed.delete(artistId);
    }
  } else {
    // 서버 성공 — 이름 기반 셋도 동기화
    const s = window._getFollowedNames();
    if (following) s.add(artistName); else s.delete(artistName);
    window._setFollowedNames(s);
  }

  showToast(following ? _t(`${artistName} 팔로우 ❤`, `Following ${artistName} ❤`) : _t(`${artistName} 언팔로우`, `Unfollowed ${artistName}`));
  // 즉시 다시 그려서 버튼/팔로워수 반영 (현재 페이지에 맞게)
  if (currentView === 'artist' && typeof renderArtistProfile === 'function') {
    renderArtistProfile(artistName);
  } else if (currentView === 'profile' && typeof renderProfile === 'function') {
    renderProfile();
  }
};

// ===================== CARD GENERATORS =====================

window.generateTrackCard = function (track, idx = 0) {
  const db = window.DB.get();
  const isLikedLocal = db.currentUser && db.currentUser.likedTracks && db.currentUser.likedTracks.includes(track.id);
  const isFavServer = window.Favorites && window.Favorites.isFavorited && window.Favorites.isFavorited(track.id);
  const isLiked = isLikedLocal || isFavServer;
  const likeIcon = isLiked
    ? '<i class="ri-star-fill" style="color:#FFD600;"></i>'
    : '<i class="ri-star-line"></i>';
  const delayClass = idx < 6 ? ` delay-${idx + 1}` : '';

  const tags = (track.tags || []).slice(0, 2);
  const tagsHtml = tags.length ? `
    <div class="tag-pills-row">
      ${tags.map(tag => {
        const safeDisplay = tag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<span class="tag-pill" onclick="event.stopPropagation(); navigateToTag('${jsEscape(tag)}')">#${safeDisplay}</span>`;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="track-card reveal${delayClass}" onclick="openTrackDetail('${track.id}')">
      <div class="track-cover-container">
        <img src="${track.cover}" class="track-cover" alt="Cover">
        <div class="play-overlay" onclick="event.stopPropagation(); playTrack('${track.id}')">
          <i class="ri-play-fill"></i>
        </div>
        ${/^[0-9a-f-]{36}$/i.test(track.id||'') ? `<button class="add-to-playlist-btn" onclick="event.stopPropagation(); openPlaylistModal('${track.id}')" title="Add to Playlist">
          <i class="ri-add-line"></i>
        </button>` : ''}
      </div>
      <div class="track-info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div class="track-title" style="flex:1;">${(track.title||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          <button onclick="event.stopPropagation(); window.toggleLike('${track.id}')" style="background:none; border:none; color:var(--text-primary); font-size:18px; cursor:pointer; padding:0;">
            ${likeIcon}
          </button>
        </div>
        <div class="track-artist">
          <img src="${track.artistAvatar}" style="width:16px;height:16px;border-radius:50%">
          ${(track.artist||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        </div>
        <div style="margin-top: 8px; display:flex; gap: 12px; color: var(--text-secondary); font-size: 12px;">
          <span><i class="ri-heart-fill"></i> ${track.likes || 0}</span>
          <span><i class="ri-play-circle-line"></i> ${track.plays || 0}</span>
        </div>
        ${tagsHtml}
      </div>
    </div>
  `;
}

window.generateCollectionCard = function (item, subtitle, extra = '') {
  return `
    <div class="track-card">
      <div class="track-cover-container">
        <img src="${item.cover}" class="track-cover" alt="Cover">
        <div class="play-overlay">
          <i class="ri-play-fill"></i>
        </div>
      </div>
      <div class="track-info">
        <div class="track-title" style="margin-bottom: 4px;">${item.title}</div>
        <div class="track-artist" style="color: var(--text-secondary); font-size: 13px;">${subtitle}</div>
        ${extra}
      </div>
    </div>
  `;
}

window.generateArtistCard = function (artist) {
  return `
    <div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding: 20px; cursor: pointer; transition: background 0.3s; border-radius: 8px; background: var(--surface-color);" onmouseover="this.style.background='var(--surface-hover)'" onmouseout="this.style.background='var(--surface-color)'">
      <img src="${artist.avatar}" style="width: 140px; height: 140px; border-radius: 50%; object-fit: cover; margin-bottom: 16px;">
      <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">${artist.name}</div>
      <div style="color: var(--text-secondary); font-size: 13px;"><i class="ri-user-follow-fill"></i> ${artist.followers} followers</div>
      ${artist.sns ? generateSnsLinks(artist.sns) : ''}
    </div>
  `;
}

// ===================== SNS LINKS HELPER =====================

function generateSnsLinks(sns) {
  // SNS 표시 임시 숨김 (사용자 요청) — 데이터는 그대로 두고 출력만 막아둠.
  // 나중에 다시 켜고 싶을 땐 아래 return ''; 줄을 지우면 됨.
  return '';
}

// ===================== TAGS VIEW (everynoise-style cloud) =====================

function renderTags() {
  const db = window.DB.get();
  const counts = getTagStats();
  const tagList = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const maxCount = tagList.length > 0 ? counts[tagList[0]] : 1;
  const totalTracks = db.tracks.length;

  if (tagList.length === 0) {
    appContent.innerHTML = `
      <div class="page-intro reveal">${_i18n('지금의 기분을 tag의 노래로 들어보세요', 'Find music that matches your mood, through tags')}</div>
      <div style="text-align:center; padding: 80px 0; color:var(--text-secondary);">
        <i class="ri-price-tag-3-line" style="font-size: 48px; margin-bottom: 16px; display:block;"></i>
        ${_i18n('아직 태그가 없습니다. 곡을 업로드할 때 태그를 달아보세요!', 'No tags yet. Add some when you upload music!')}
      </div>
    `;
    return;
  }

  const cloudHtml = tagList.map(tag => {
    const count = counts[tag];
    const size = tagFontSize(count, maxCount);
    const color = tagColor(tag);
    const safeDisplay = tag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<span class="tag-chip" style="font-size:${size}px; color:${color};" onclick="navigateToTag('${jsEscape(tag)}')" title="${safeDisplay} · ${count}곡">#${safeDisplay}</span>`;
  }).join('');

  appContent.innerHTML = `
    <div class="page-intro reveal">${_i18n('지금의 기분을 tag의 노래로 들어보세요', 'Find music that matches your mood, through tags')}</div>
    <div class="page-count reveal">${_i18n(`총 <strong>${tagList.length}</strong>개의 태그 · <strong>${totalTracks}</strong>곡`, `<strong>${tagList.length}</strong> tags · <strong>${totalTracks}</strong> tracks`)}</div>
    <div class="tags-cloud reveal-scale">
      ${cloudHtml}
    </div>
  `;
}

function renderTagDetail(tag) {
  const db = window.DB.get();
  // 마스터·데모 모두 포함 — 태그가 일치하는 모든 곡 보여줌 (예전엔 마스터만 노출해서
  // 데모만 올린 사람의 태그 곡이 안 보였음).
  // 같은 프로젝트의 마스터 + 데모는 dedup하지 않음 — 각각이 독립된 트랙.
  const matched = db.tracks
    .filter(t => t && Array.isArray(t.tags) && t.tags.includes(tag))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const safeTag = tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (matched.length === 0) {
    appContent.innerHTML = `
      <div class="artist-canvas cosmic tag-cosmic">
        <div class="artist-bg-deco"></div>
        <div class="sub-page artist-page">
          <div class="reveal" style="margin-bottom:14px;">
            <a href="#" onclick="event.preventDefault(); navigateTo('tags')">
              <i class="ri-arrow-left-line"></i> ${_i18n('모든 태그', 'All tags')}
            </a>
          </div>
          <div class="tag-hero">
            <h1 class="tag-hero-title">#${safeTag}</h1>
          </div>
          <p style="color:#cdc7e4; margin-top: 40px; text-align:center; font-weight:600;">${_i18n('이 태그를 가진 곡이 아직 없어요.', 'No tracks with this tag yet.')}</p>
        </div>
      </div>
    `;
    return;
  }

  const uniqueArtists = [...new Set(matched.map(t => t.artist))];

  const cardsHtml = matched.map(t => {
    const safeTitle = (t.title || '').replace(/\s*\(Demo.*\)$/i, '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeArtist = (t.artist || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const artistEncoded = encodeURIComponent(t.artist || '');
    const dateLabel = formatFullDate(t.createdAt);
    return `
      <div class="tag-track-card reveal" data-track-id="${t.id}">
        <div class="tag-cover-wrap" onclick="playTrack('${t.id}')">
          <img src="${t.cover}" class="tag-cover" alt="${safeTitle}" loading="lazy">
          <div class="tag-play-overlay"><i class="ri-play-fill"></i></div>
        </div>
        <div class="tag-track-meta">
          <div class="tag-track-title" onclick="playTrack('${t.id}')" title="재생">「${safeTitle}」</div>
          <div class="tag-track-artist" onclick="navigateTo('artist:${artistEncoded}')" title="${safeArtist} 프로필">${safeArtist} <i class="ri-arrow-right-up-line"></i></div>
          <div class="tag-track-date">${dateLabel}</div>
        </div>
      </div>
    `;
  }).join('');

  appContent.innerHTML = `
    <div class="artist-canvas cosmic tag-cosmic">
      <div class="artist-bg-deco"></div>
      <div class="sub-page artist-page">
        <div class="reveal" style="margin-bottom:14px;">
          <a href="#" onclick="event.preventDefault(); navigateTo('tags')">
            <i class="ri-arrow-left-line"></i> ${_i18n('모든 태그', 'All tags')}
          </a>
        </div>

        <div class="tag-hero reveal">
          <h1 class="tag-hero-title">#${safeTag}</h1>
          <div class="tag-hero-stats">
            <span>${matched.length} ${_i18n('곡', 'tracks')}</span>
            <span class="stat-dot">·</span>
            <span>${uniqueArtists.length} ${_i18n('아티스트', 'artists')}</span>
          </div>
        </div>

        <div class="tag-track-grid">
          ${cardsHtml}
        </div>
      </div>
    </div>
  `;
}

// ===================== WALL — 우리들의 벽 (Sticky Notes) =====================

const NOTE_COLORS = {
  // 좀 더 찐한 색조 — bg는 더 진한 채도, text는 어두운 대비
  yellow: { bg: '#FFE066', border: '#F4B400', text: '#3E2723' },
  blue:   { bg: '#7EB8E8', border: '#1976D2', text: '#0D1F4D' },
  pink:   { bg: '#F48FB1', border: '#E91E63', text: '#560027' },
  green:  { bg: '#81C784', border: '#388E3C', text: '#0F3F12' },
  orange: { bg: '#FFB74D', border: '#F57C00', text: '#5D2105' },
  purple: { bg: '#BA68C8', border: '#7B1FA2', text: '#2E0846' }
};

// Wall state: pagination + search + sort
let _wallPage = 1;
const _WALL_PAGE_SIZE = 60;
let _wallSearch = '';
let _wallSort = 'new'; // 'new' | 'old' | 'random'

// Renders the small attached-song chip beneath a wall note. Returns empty
// string when the note has no song link.
// 칩 클릭 토글 — 펼치면서 곡 재생 시작. 다시 누르면 접힘.
// 곡 재생/일시정지는 playTrack 이 같은 곡이면 토글 처리.
window.toggleTrackChip = function(el, trackId) {
  if (!el) return;
  if (el.classList.contains('is-expanded')) {
    el.classList.remove('is-expanded');
  } else {
    // 우주 다른 칩들 먼저 접기
    document.querySelectorAll('.note-track-chip-mini.is-expanded').forEach(c => c.classList.remove('is-expanded'));
    el.classList.add('is-expanded');
  }
  if (trackId && typeof window.playTrack === 'function') window.playTrack(trackId, 'wall');
};

function _renderNoteTrackChip(note) {
  if (!note) return '';
  if (note.trackId) {
    const t = (window.DB.get().tracks || []).find(x => x && x.id === note.trackId);
    if (!t) return '';
    const cover = t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=300';
    const title = (t.title || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    // 미니 커버만 — 사진 클릭하면 재생. 제목/아티스트 표시 X (사용자 요청)
    // data-track-id 가 audio play/pause 이벤트와 동기화돼서 ▶ / ⏸ 가 자동 토글됨.
    const isPlaying = (window.currentPlayingTrack === t.id) && window.audioElement && !window.audioElement.paused;
    return `
      <button class="note-track-thumb ${isPlaying ? 'is-playing' : ''}" data-track-id="${t.id}" onclick="event.stopPropagation(); playTrack('${t.id}', 'wall')" title="${title} — ${isPlaying ? '일시정지' : '재생'}">
        <img src="${cover}" alt="" loading="lazy">
        <i class="${isPlaying ? 'ri-pause-fill' : 'ri-play-fill'}"></i>
      </button>`;
  }
  if (note.externalUrl) {
    const url = note.externalUrl;
    const u = url.toLowerCase();
    let provider = '링크', icon = 'ri-link';
    if (u.includes('youtube.') || u.includes('youtu.be')) { provider = 'YouTube'; icon = 'ri-youtube-fill'; }
    else if (u.includes('open.spotify.com'))               { provider = 'Spotify'; icon = 'ri-spotify-fill'; }
    else if (u.includes('music.apple.com'))                { provider = 'Apple Music'; icon = 'ri-apple-fill'; }
    else if (u.includes('soundcloud.com'))                 { provider = 'SoundCloud'; icon = 'ri-soundcloud-fill'; }
    const safeUrl = url.replace(/</g,'&lt;').replace(/"/g,'&quot;');
    // 외부 링크도 동일하게 미니 — 프로바이더 아이콘 + 외부 화살표만.
    return `
      <a class="note-track-chip note-track-chip-ext note-track-chip-mini" href="${safeUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" title="${provider}로 열기">
        <i class="${icon}"></i>
        <i class="ri-arrow-right-up-line"></i>
      </a>`;
  }
  return '';
}

// ===================== 주절주절 — 스레드/인스타 스타일 피드 (테스트 버전) =====================
// window.renderWallThreadTest() 로 프리뷰에서 호출. 기존 renderWall 은 그대로 둠.
function _threadTimeAgo(iso) {
  try {
    const t = new Date(iso).getTime(); if (!t) return '방금';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분';
    if (s < 86400) return Math.floor(s / 3600) + '시간'; return Math.floor(s / 86400) + '일';
  } catch (_) { return ''; }
}
function _threadTrackOf(trackId) {
  const t = ((window.DB.get().tracks) || []).find(x => x && x.id === trackId);
  if (!t) return null;
  return { id: t.id, title: t.title || '제목 없음', artist: t.artist || '',
           cover: t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=200',
           tags: Array.isArray(t.tags) ? t.tags : [] };
}
// 긴 글 → 6줄로 접고 더보기/접기 토글. raw=원문(미이스케이프), cls=래퍼 클래스.
function _collapsible(raw, cls) {
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const t = (raw || '').trim();
  const long = t.length > 220 || t.split(/\r?\n/).length > 6;
  const safe = esc(t);
  if (!long) return `<div class="${cls}">${safe}</div>`;
  const more = _t('더보기', 'More'), less = _t('접기', 'Less');
  return `<div class="${cls} is-clamped">${safe}</div>`
    + `<button class="more-toggle" type="button" onclick="event.stopPropagation(); var b=this.previousElementSibling; var c=b.classList.toggle('is-clamped'); this.textContent=c?'${more}':'${less}';">${more}</button>`;
}
function _threadPostHtml(p) {
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
  const nameAttr = p.name ? `data-artist="${escAttr(p.name)}"` : '';
  const linkCls = p.name ? ' is-link' : '';
  const img = p.image ? `<img class="thread-post-image" src="${p.image}" alt="" loading="lazy">` : '';
  const _trackAlbumPid = p.track ? (p.track.projectId || ('proj_' + p.track.id)) : '';
  const song = p.track ? `
        <div class="thread-song-card" onclick="playTrack('${p.track.id}','wall')">
          <img class="thread-song-cover" src="${p.track.cover}" alt="">
          <div class="thread-song-info">
            <div class="thread-song-title">${esc(p.track.title)}</div>
            <div class="thread-song-artist">${esc(p.track.artist)}</div>
          </div>
          <button class="thread-song-play" onclick="event.stopPropagation(); playTrack('${p.track.id}','wall')" aria-label="재생"><i class="ri-play-fill"></i></button>
        </div>` : '';
  const cmCount = p.comments || '';
  // 릴스형: 위 미디어(사진 or 색 그라데이션) + 아래 글. 게시물 색 = 노래색/작성자 시드(무사진 그라데이션 + 헤드라인 강조).
  const _seed = p.track ? p.track.id : (p.name || p.id);
  const postColor = SHAPE_COLORS[(_hashSeed('feed:' + _seed) >>> 0) % SHAPE_COLORS.length];
  // 미디어: 사진 여러장→캐러셀(인스타식 스와이프) / 1장→풀 / 사진없고 음원→곡 색 디스크+#태그 / 둘다없으면 그라데이션.
  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : (p.image ? [p.image] : []);
  const hasImg = images.length > 0;
  const multi = images.length > 1;
  const discTags = (p.track && Array.isArray(p.track.tags)) ? p.track.tags.slice(0, 3) : [];
  let mediaInner;
  if (multi) {
    mediaInner = `<div class="feed-carousel">`
      + images.map(u => `<div class="feed-slide"><img src="${u}" alt="" loading="lazy"></div>`).join('')
      + `</div><div class="feed-count">1/${images.length}</div>`
      + `<div class="feed-dots">` + images.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('') + `</div>`;
  } else if (hasImg) {
    mediaInner = `<img class="feed-bg" src="${images[0]}" alt="" loading="lazy">`;
  } else if (p.track) {
    // 사용자 요청: 디스크 왼쪽 + 오른쪽에 #태그(세로), 그 아래에 가수·제목.
    const _tagsHtml = discTags.length ? `<div class="feed-disc-tags">${discTags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>` : '';
    mediaInner = `<div class="feed-disc-wrap" onclick="event.stopPropagation(); playTrack('${p.track.id}','wall')">`
      + `<div class="feed-disc-row"><div class="feed-disc" style="--disc:${postColor}"><i class="ri-play-fill"></i></div>${_tagsHtml}</div>`
      + `<div class="feed-disc-meta"><div class="feed-disc-artist">${esc(p.track.artist || p.name)}</div><div class="feed-disc-title">${esc(p.track.title)}</div></div>`
      + `</div>`;
  } else {
    mediaInner = '';
  }
  const mediaStyle = hasImg ? '' : `background:linear-gradient(160deg, ${postColor}40, #0a0612 80%);`;
  const mediaCls = (!hasImg && p.track) ? 'feed-media feed-media-disc' : 'feed-media';
  // 음원 글은 디스크가 곡 비주얼이라 칩 생략, 사진 글에선 칩 유지.
  const songChip = (p.track && hasImg) ? `
          <div class="feed-song-chip" onclick="event.stopPropagation(); playTrack('${p.track.id}','wall')">
            <img src="${p.track.cover}" alt=""><span class="feed-song-chip-t">${esc(p.track.title)}</span><i class="ri-play-fill"></i>
          </div>` : '';
  // 업로드 + — 각 글 미디어 왼쪽 위 (아래 FAB 대체, 사용자 요청).
  const plusBtn = `<button class="feed-plus" type="button" onclick="event.stopPropagation(); window.openThreadComposer && window.openThreadComposer()" aria-label="${_t('올리기', 'Upload')}" title="${_t('올리기', 'Upload')}"><i class="ri-add-line"></i></button>`;
  // 작성자 옆 팔로우 버튼 (내 글 제외).
  const _following = (typeof window._isFollowingName === 'function') && window._isFollowingName(p.name);
  const followBtn = (!p.isMine && p.name) ? `<button class="feed-follow-btn${_following ? ' following' : ''}" type="button" data-author="${escAttr(p.name)}" data-author-id="${escAttr(p.authorId || '')}" onclick="event.stopPropagation(); _feedToggleFollow(this)">${_following ? _t('팔로잉', 'Following') : _t('팔로우', 'Follow')}</button>` : '';
  return `
    <div class="feed-post" data-note-id="${p.id}">
      <div class="${mediaCls}" style="${mediaStyle}">
        ${mediaInner}
        <div class="feed-media-grad"></div>
        ${plusBtn}
        ${(p.track && hasImg)
          ? `<div class="feed-headline"><div class="feed-hl-title" style="color:${postColor}">${esc(p.track.title)}</div></div>`
          : ''}
        ${songChip}
      </div>
      <div class="feed-text">
        <div class="feed-text-main">
          <div class="feed-author">
            <img class="feed-avatar${linkCls}" src="${p.avatar}" alt="" loading="lazy" ${nameAttr} onclick="_threadGoArtist(this)">
            <span class="feed-author-name${linkCls}" ${nameAttr} onclick="_threadGoArtist(this)">${esc(p.name)}</span>
            <span class="feed-author-time">· ${esc(p.time)}</span>
            ${followBtn}
            <button class="feed-post-more" aria-label="${_t('더보기', 'More')}" onclick="_threadPostMenu('${p.id}', ${p.isMine ? 'true' : 'false'})"><i class="ri-more-fill"></i></button>
          </div>
          ${p.text ? `<div class="feed-lyrics">${esc(p.text)}</div>` : ''}
          ${p.text ? `<button class="tp-translate" type="button" onclick="translatePost('${p.id}', this)"><i class="ri-translate-2"></i> ${_t('번역', 'Translate')}</button>` : ''}
        </div>
        <div class="feed-actions-col">
          <button class="fa-act tp-like ${p.liked ? 'is-liked' : ''}" data-note-id="${p.id}" aria-label="${_t('좋아요', 'Like')}" onclick="toggleNoteLike('${p.id}', this)"><i class="${p.liked ? 'ri-heart-3-fill' : 'ri-heart-3-line'}"></i><span class="fa-count tp-like-count">${p.likeCount > 0 ? p.likeCount : ''}</span></button>
          <button class="fa-act" aria-label="${_t('댓글', 'Comments')}" onclick="openCommentSheet('${p.id}')"><i class="ri-chat-3-line"></i><span class="fa-count">${cmCount}</span></button>
          <button class="fa-act" aria-label="${_t('공유', 'Share')}" onclick="_threadShare('${p.id}')"><i class="ri-send-plane-line"></i></button>
          <button class="fa-act tp-collect ${p.collected ? 'is-bookmarked' : ''}" aria-label="${_t('내 우주에 담기', 'Save to my universe')}" onclick="toggleBookmark('${p.id}', this)"><i class="${p.collected ? 'ri-bookmark-fill' : 'ri-bookmark-line'}"></i></button>
        </div>
      </div>
    </div>`;
}
// 작성자 이름/아바타 탭 → 아티스트 페이지
window._threadGoArtist = function (el) {
  const a = el && el.getAttribute('data-artist');
  if (a) navigateTo('artist:' + encodeURIComponent(a));
};
// 공유 — 링크 복사(없으면 시스템 공유)
window._threadShare = function (id) {
  try {
    const url = location.origin + location.pathname + '#wall';
    if (navigator.share) { navigator.share({ url }).catch(() => {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(url); showToast && showToast(_t('링크 복사됐어요', 'Link copied')); }
  } catch (_) {}
};
// 번역 (테스트) — 글을 반대 언어(한↔영)로 번역해 아래에 표시. 다시 누르면 원문으로.
// Google 번역(비공식 translate_a 엔드포인트, 키 불필요, 자동 언어감지). 한글 포함이면 →en, 아니면 →ko.
window.translatePost = async function (id, btn) {
  const post = btn && (btn.closest('.feed-post') || btn.closest('.thread-post'));
  if (!post) return;
  const existing = post.querySelector('.thread-post-translation');
  if (existing) { existing.remove(); btn.innerHTML = '<i class="ri-translate-2"></i> ' + _t('번역', 'Translate'); return; }
  const bodyEl = post.querySelector('.feed-lyrics') || post.querySelector('.thread-post-body');
  const text = bodyEl ? (bodyEl.textContent || '').trim() : '';
  if (!text) return;
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line"></i> ' + _t('번역 중…', 'Translating…');
  try {
    const hasKo = /[가-힣]/.test(text);
    const tgt = hasKo ? 'en' : 'ko';
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + tgt + '&dt=t&q=' + encodeURIComponent(text.slice(0, 1500));
    const res = await fetch(url);
    const data = await res.json();
    const translated = (data && data[0]) ? data[0].map(s => (s && s[0]) || '').join('') : '';
    const src = (data && data[2]) || (hasKo ? 'ko' : 'en');
    if (!translated) throw new Error('empty');
    const div = document.createElement('div');
    div.className = 'thread-post-translation';
    div.innerHTML = '<span class="tpt-label">' + src.toUpperCase() + ' → ' + tgt.toUpperCase() + '</span>' +
      translated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    bodyEl.insertAdjacentElement('afterend', div);
    btn.innerHTML = '<i class="ri-arrow-go-back-line"></i> ' + _t('원문', 'Original');
  } catch (e) {
    if (typeof showToast === 'function') showToast(_t('번역 실패 — 잠시 후 다시', 'Translation failed — try again'));
    btn.innerHTML = orig;
    console.warn('[translatePost]', e);
  } finally { btn.disabled = false; }
};
// 더보기 메뉴 — 내 글이면 삭제, 아니면 공유
window._threadPostMenu = function (id, isMine) {
  if (isMine) {
    // 삭제 확인은 deleteWallNote 안에서 1회만(이중 confirm 제거).
    if (typeof deleteWallNote === 'function') deleteWallNote(id);
  } else {
    _threadShare(id);
  }
};
// ════════════ 프로듀싱 게시판 — 주절주절('wall') 자리 (데모 진화 라운드 투표 피드) ════════════
// 백엔드 window.Producing (producing_rounds/_comments/_votes). 곡 제목·커버는 트랙 캐시에서 조회.
// candidates[].audio 있으면 재생 버튼(음원 버전), 없으면 글자만(드럼/기타·의상 등 간단 투표).
window.__pbSeg = window.__pbSeg || 'open';
window.__pbRounds = window.__pbRounds || [];
function pbEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function _pbTrack(id){ var a=(window.__tracks&&window.__tracks.length)?window.__tracks:((window.DB&&window.DB.get().tracks)||[]); return a.find(function(t){return t&&String(t.id)===String(id);})||null; }
function _pbFindRound(id){ return (window.__pbRounds||[]).find(function(r){return String(r.id)===String(id);})||null; }
function _pbTotal(r,d){ var s=0; (r.candidates||[]).forEach(function(o){s+=d.tally[o.key]||0;}); (d.comments||[]).forEach(function(c){s+=d.tally[c.id]||0;}); return s||1; }

function _pbStyle(){
  if (document.getElementById('pb-style')) return;
  var st=document.createElement('style'); st.id='pb-style';
  st.textContent = `
  .pb-page{min-height:100%;background:#07060d;color:#F4F4F7;padding-bottom:calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 30px);}
  .pb-top{display:flex;align-items:center;gap:10px;padding:14px 16px 6px;} .pb-top-t{font-size:20px;font-weight:900;}
  .pb-top-new{margin-left:auto;border:none;background:linear-gradient(135deg,#a855f7,#d946b8);color:#fff;font-family:inherit;font-weight:800;font-size:12.5px;padding:8px 14px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 4px 14px rgba(168,85,247,.4);}
  .pb-seg{display:flex;gap:6px;background:#14111f;border-radius:12px;padding:4px;margin:8px 14px 16px;}
  .pb-seg b{flex:1;text-align:center;padding:9px;border-radius:9px;font-size:12.5px;font-weight:800;color:rgba(255,255,255,.5);cursor:pointer;} .pb-seg b.on{background:#2a2440;color:#fff;}
  .pb-loading,.pb-empty{text-align:center;color:rgba(255,255,255,.5);font-size:13px;padding:50px 20px;line-height:1.7;}
  .pb-empty b{display:block;font-size:15px;color:#fff;margin-bottom:6px;}
  .pb-card{margin:0 14px 30px;}
  .pb-cover{position:relative;height:115px;border-radius:20px;overflow:hidden;display:flex;align-items:flex-end;background:#181225;}
  .pb-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 22%;} .pb-cover-grad{position:absolute;inset:0;}
  .pb-cover::after{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgba(7,6,13,.92),rgba(7,6,13,.1) 42%,transparent 62%);}
  .pb-cover-tags{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:0 20px 40px;pointer-events:none;z-index:0;}
  .pb-cover-tags span{font-size:27px;font-weight:900;line-height:1.08;color:rgba(255,255,255,.96);letter-spacing:-.5px;text-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .pb-del{position:absolute;top:10px;right:10px;z-index:3;width:34px;height:34px;border:none;border-radius:50%;background:rgba(7,6,13,.55);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);} .pb-del:hover{background:rgba(220,40,80,.9);}
  .pb-song{position:relative;z-index:1;display:flex;align-items:center;gap:11px;padding:14px;width:100%;} .pb-song-ic{width:42px;height:42px;border-radius:11px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:#1a1030;background:linear-gradient(135deg,#c9c4f5,#8b7cf6);} .pb-song-ic img{width:100%;height:100%;object-fit:cover;} .pb-song-t{font-size:17px;font-weight:900;} .pb-song-s{font-size:11px;color:rgba(255,255,255,.6);}
  .pb-q{text-align:center;font-size:13.5px;font-weight:800;color:rgba(255,255,255,.82);margin:16px 0 12px;}
  .pb-vs{display:flex;align-items:stretch;}
  .pb-opt{flex:1;border-radius:18px;padding:13px 11px 12px;text-align:center;position:relative;cursor:pointer;border:1.5px solid transparent;transition:all .18s;}
  .pb-opt.a{background:radial-gradient(120% 100% at 50% 0%,rgba(34,211,238,.22),rgba(34,211,238,.06));border-color:rgba(34,211,238,.5);}
  .pb-opt.b{background:radial-gradient(120% 100% at 50% 0%,rgba(251,73,138,.22),rgba(251,73,138,.06));border-color:rgba(251,73,138,.5);}
  .pb-opt.c{background:radial-gradient(120% 100% at 50% 0%,rgba(255,209,102,.2),rgba(255,209,102,.05));border-color:rgba(255,209,102,.5);}
  .pb-opt.simple{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:165px;}
  .pb-opt.on{transform:translateY(-2px);} .pb-opt.a.on{border-color:#22d3ee;box-shadow:0 0 26px rgba(34,211,238,.4);} .pb-opt.b.on{border-color:#fb498a;box-shadow:0 0 26px rgba(251,73,138,.4);} .pb-opt.c.on{border-color:#FFD166;box-shadow:0 0 26px rgba(255,209,102,.35);}
  .pb-badge{font-size:12px;font-weight:900;} .pb-opt.a .pb-badge{color:#22d3ee;} .pb-opt.b .pb-badge{color:#fb6f92;} .pb-opt.c .pb-badge{color:#FFD166;}
  .pb-play{width:56px;height:56px;border-radius:50%;margin:8px auto 8px;display:flex;align-items:center;justify-content:center;font-size:25px;}
  .pb-opt.a .pb-play{background:#22d3ee;color:#06222b;box-shadow:0 0 20px rgba(34,211,238,.5);} .pb-opt.b .pb-play{background:#fb498a;color:#3b0a1e;box-shadow:0 0 20px rgba(251,73,138,.5);}
  .pb-name{font-size:13.5px;font-weight:800;} .pb-name.big{font-size:23px;font-weight:900;margin-top:6px;}
  .pb-wave{display:flex;align-items:center;gap:9px;margin-top:9px;background:rgba(0,0,0,.3);border-radius:10px;padding:7px 9px;} .pb-wave i{font-size:14px;opacity:.85;} .pb-wave .wf{flex:1;height:15px;background:repeating-linear-gradient(90deg,currentColor 0 2px,transparent 2px 4px);opacity:.5;border-radius:2px;} .pb-opt.a .pb-wave{color:#22d3ee;} .pb-opt.b .pb-wave{color:#fb6f92;}
  .pb-vsmid{display:flex;align-items:center;padding:0 6px;font-size:13px;font-weight:900;color:rgba(255,255,255,.45);}
  .pb-pct{min-height:8px;}
  .pb-blind{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:14px;font-size:11.5px;font-weight:700;color:rgba(255,255,255,.5);background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.14);border-radius:12px;padding:11px;} .pb-blind i{color:#C9C4F5;}
  .pb-pct-row{display:flex;align-items:center;gap:10px;margin-top:12px;} .pb-pct-c{flex:1;} .pb-bar{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;} .pb-bar>span{display:block;height:100%;border-radius:999px;} .pb-pct-c.a .pb-bar>span{background:#22d3ee;} .pb-pct-c.b .pb-bar>span{background:#fb498a;} .pb-pn{font-size:13px;font-weight:900;margin-top:5px;} .pb-pct-c.a .pb-pn{color:#22d3ee;} .pb-pct-c.b .pb-pn{color:#fb6f92;text-align:right;}
  .pb-voices{margin-top:20px;} .pb-voices-h{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:900;margin-bottom:4px;} .pb-voices-h i{color:#fb6f92;} .pb-voices-h span{margin-left:auto;font-size:11px;color:rgba(255,255,255,.45);font-weight:600;} .pb-voices-s{font-size:10.5px;color:rgba(255,255,255,.45);margin-bottom:10px;line-height:1.4;} .pb-voices-s b{color:#FFD166;}
  .pb-cmt{display:flex;gap:10px;padding:9px 2px;align-items:flex-start;} .pb-cav{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;}
  .pb-cbd{flex:1;min-width:0;} .pb-cu{font-size:11px;font-weight:700;color:rgba(255,255,255,.6);} .pb-top1{color:#FFD166;font-size:9px;font-weight:900;margin-left:5px;background:rgba(255,209,102,.14);padding:1px 6px;border-radius:999px;} .pb-ct{font-size:13px;margin-top:1px;line-height:1.4;word-break:break-word;}
  .pb-clike{display:flex;flex-direction:column;align-items:center;gap:1px;flex-shrink:0;cursor:pointer;} .pb-clike i{font-size:18px;color:rgba(255,255,255,.4);} .pb-clike.on i{color:#fb6f92;} .pb-clike b{font-size:10px;font-weight:800;} .pb-cpct{font-size:9.5px;color:rgba(255,255,255,.4);}
  .pb-noc{font-size:12px;color:rgba(255,255,255,.4);padding:4px 2px;} .pb-more{text-align:center;font-size:12px;font-weight:700;color:rgba(255,255,255,.5);padding:9px;cursor:pointer;}
  .pb-cta{width:100%;border:none;border-radius:14px;padding:13px;margin-top:11px;font-family:inherit;font-size:14px;font-weight:800;color:#fff;background:linear-gradient(135deg,#a855f7,#d946b8);box-shadow:0 6px 22px rgba(168,85,247,.38);cursor:pointer;}
  .pb-fab{position:fixed;right:18px;bottom:calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 18px);width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(135deg,#a855f7,#d946b8);color:#fff;font-size:26px;box-shadow:0 8px 24px rgba(168,85,247,.5);cursor:pointer;z-index:40;display:flex;align-items:center;justify-content:center;}
  .pb-sheet-back{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .25s;z-index:2000;} .pb-sheet-back.on{opacity:1;pointer-events:auto;}
  .pb-sheet{position:fixed;left:0;right:0;bottom:0;max-width:480px;margin:0 auto;max-height:82vh;background:#100d18;border-radius:22px 22px 0 0;transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);z-index:2001;display:flex;flex-direction:column;} .pb-sheet.on{transform:translateY(0);}
  .pb-grab{width:44px;height:5px;border-radius:999px;background:rgba(255,255,255,.3);margin:10px auto 6px;touch-action:none;cursor:grab;}
  .pb-sh-h{text-align:center;font-size:13px;font-weight:800;padding:6px 0 10px;border-bottom:1px solid rgba(255,255,255,.07);position:relative;touch-action:none;} .pb-sh-h .x{position:absolute;right:14px;top:3px;font-size:20px;color:rgba(255,255,255,.6);cursor:pointer;touch-action:auto;}
  .pb-sh-hint{font-size:10.5px;color:#fb6f92;text-align:center;padding:8px;background:rgba(251,111,146,.08);border-radius:10px;margin:8px 14px 4px;}
  .pb-sh-list{flex:1;overflow-y:auto;padding:6px 14px;}
  .pb-sh-add{display:flex;gap:9px;align-items:center;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.07);} .pb-sh-add input{flex:1;background:#1b1726;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:11px 15px;color:#fff;font-family:inherit;font-size:13px;} .pb-sh-add button{border:none;background:none;color:#8b7cf6;font-weight:800;font-size:14px;cursor:pointer;}
  .pb-form{padding:4px 16px 14px;overflow-y:auto;flex:1;min-height:0;} .pb-flab{font-size:11.5px;font-weight:800;color:rgba(255,255,255,.65);margin:14px 0 6px;} .pb-form input,.pb-form select{width:100%;background:#1b1726;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:11px 13px;color:#fff;font-family:inherit;font-size:13px;} .pb-ab{display:flex;gap:8px;} .pb-days{display:flex;gap:8px;} .pb-day{flex:1;text-align:center;border:1px solid rgba(255,255,255,.12);background:#1b1726;color:rgba(255,255,255,.7);border-radius:11px;padding:10px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;} .pb-day.on{background:rgba(201,196,245,.16);border-color:#C9C4F5;color:#fff;}
  .pb-opt-edit{display:flex;gap:8px;align-items:center;margin-bottom:8px;} .pb-opt-edit input{flex:1;}
  .pb-opt-key{flex:0 0 28px;width:28px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:9px;font-weight:900;font-size:13px;color:#fff;} .pb-opt-key.a{background:linear-gradient(135deg,#8B7CF6,#6d5ef0);} .pb-opt-key.b{background:linear-gradient(135deg,#fb6f92,#f0567f);}
  .pb-attach{flex:0 0 auto;width:42px;height:42px;border:1px solid rgba(255,255,255,.14);background:#1b1726;color:#C9C4F5;border-radius:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;} .pb-attach.pb-att-has{background:rgba(110,224,159,.16);border-color:#6ee09f;color:#6ee09f;} .pb-attach.pb-att-busy{color:rgba(255,255,255,.5);} .pb-spin{display:inline-block;animation:pbspin .7s linear infinite;} @keyframes pbspin{to{transform:rotate(360deg);}}
  .pb-form-foot{padding:10px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.07);background:#100d18;}
  .pb-open{width:100%;border:none;border-radius:13px;padding:14px;font-family:inherit;font-size:14px;font-weight:800;color:#06140C;background:linear-gradient(135deg,#C9C4F5,#8B7CF6);cursor:pointer;}
  /* 데스크탑: 가운데 컬럼으로 좁혀 좌상단 워드마크/가이드 버튼과 안 겹치게 + 위로 여백 */
  @media (min-width:769px){
    .pb-top,.pb-seg,.pb-feed{max-width:560px;margin-left:auto !important;margin-right:auto !important;}
    .pb-top{padding-top:58px;}
  }
  `;
  document.head.appendChild(st);
}

// ════════════ 주절주절('wall') — 전기가오리 출판 페이지 스타일 데모 리스트 ════════════
// 스크린샷 이식: 하늘색 배경 + 노란 "슬로우 뮤직" 워드마크 + 박스 "주절주절" 라벨 +
//   작곡가별 검은 헤더바([업로드일자] [작곡가이름]) + 흰 행(데모 #해시태그, 텍스트 폭만큼).
// 작곡가 이름 클릭 → 마이페이지. 행 탭 → 재생. 프로듀싱은 라우팅에서 빠져 숨김(코드는 아래 보존).
function _slowStyle(){
  if (document.getElementById('sb-style')) return;
  var st=document.createElement('style'); st.id='sb-style';
  st.textContent = `
  .sb-page{min-height:100vh;background:#45CEEB;padding:calc(env(safe-area-inset-top,0px) + 10px) 0 calc(var(--player-height,72px) + 24px);}
  .sb-wordmark{text-align:center;font-family:'Black Han Sans','Pretendard',sans-serif;font-weight:400;color:#FFE800;font-size:clamp(46px,15vw,120px);line-height:.9;letter-spacing:-.5px;margin:0 0 16px;text-shadow:0 5px 0 rgba(0,0,0,.06);}
  .sb-seclabel{display:block;width:max-content;margin:0 auto 20px;padding:4px 24px;background:#fff;border:3px solid #0f0f14;border-radius:5px;font-family:'Black Han Sans','Pretendard',sans-serif;font-weight:400;font-size:24px;color:#0f0f14;}
  .sb-list{max-width:760px;margin:0 auto;padding:0 14px;}
  .sb-group{margin-bottom:30px;animation:sbUp .5s cubic-bezier(.22,1,.36,1) both;}
  @keyframes sbUp{0%{opacity:0;transform:translateY(16px);}100%{opacity:1;transform:none;}}
  .sb-head{display:block;background:#0f0f14;color:#fff;font-family:'Pretendard',sans-serif;font-weight:800;font-size:15px;padding:11px 16px;margin-bottom:9px;letter-spacing:-.3px;}
  .sb-date{opacity:.6;font-weight:600;margin-right:9px;}
  .sb-artist{cursor:pointer;font-weight:900;border-bottom:2px solid currentColor;padding-bottom:1px;}
  .sb-artist:active{opacity:.65;}
  .sb-rows{display:flex;flex-direction:column;align-items:flex-start;gap:6px;}
  .sb-row{display:inline-block;background:#fff;color:#111;font-family:'Pretendard',sans-serif;font-weight:700;font-size:15px;line-height:1.45;padding:6px 13px;border-radius:3px;border-left:4px solid #E24A9C;cursor:pointer;transition:box-shadow .15s,background .15s;max-width:100%;word-break:break-all;}
  .sb-num{display:inline-block;font-weight:900;margin-right:9px;}
  .sb-row:hover{box-shadow:0 4px 13px rgba(0,0,0,.14);background:#f6f6f9;}
  .sb-row:active{background:#ececef;}
  .sb-empty{text-align:center;color:#0f0f14;font-weight:700;padding:52px 16px;opacity:.72;}
  .sb-plempty{color:#0f0f14;opacity:.55;font-weight:700;font-size:13px;padding:3px 4px;}
  /* 데모 행 + 담기(+) 버튼 */
  .sb-rw{display:flex;align-items:center;gap:8px;max-width:100%;}
  .sb-add{flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:rgba(15,15,20,.13);color:#0f0f14;font-size:19px;font-weight:900;line-height:1;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;transition:background .15s,transform .12s;padding:0 0 2px;}
  .sb-add:hover{background:rgba(15,15,20,.3);}
  .sb-add:active{transform:scale(.9);}
  /* 앨범 전체 댓글 (흰 배경에 쌓임, 길면 잘리고 탭하면 펼침) */
  .sb-cmts{display:flex;flex-direction:column;gap:4px;margin:9px 0 0 6px;}
  .sb-cmt{font-family:'Pretendard',sans-serif;font-size:13px;line-height:1.42;color:#0c2733;background:rgba(255,255,255,.62);border-radius:8px;padding:5px 11px;cursor:pointer;max-width:600px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .sb-cmt.expanded{-webkit-line-clamp:unset;}
  .sb-cmt-ln{opacity:.5;margin-right:5px;font-weight:800;}
  .sb-cmt-a{opacity:.5;font-weight:700;}
  .sb-cmtbar{display:flex;gap:6px;margin:8px 0 0 6px;max-width:520px;}
  .sb-cmtin{flex:1;min-width:0;border:none;border-radius:8px;padding:8px 12px;font-family:'Pretendard',sans-serif;font-size:14px;background:#fff;color:#111;}
  .sb-cmtin::placeholder{color:#9aa;}
  .sb-cmtadd{flex:0 0 auto;width:36px;border:none;border-radius:8px;background:#0f0f14;color:#fff;font-size:20px;font-weight:900;cursor:pointer;transition:opacity .15s;}
  .sb-cmtadd:active{opacity:.6;}
  @media(min-width:769px){ .sb-wordmark{font-size:clamp(72px,9vw,130px);} }
  `;
  document.head.appendChild(st);
}
function renderSlowBoard(){
  currentView = 'wall';
  var app = document.getElementById('app-content'); if (!app) return;
  try { document.body.style.overflow=''; document.documentElement.style.overflow=''; } catch(_){}
  try { if (typeof stopShapesPhysics==='function') stopShapesPhysics(); } catch(_){}
  _slowStyle();
  var db = window.DB.get();
  var tracks = (Array.isArray(db.tracks) ? db.tracks : []).slice();
  if (Array.isArray(window.__tracks)) { var seen=new Set(tracks.map(function(t){return t&&t.id;})); window.__tracks.forEach(function(t){ if(t&&!seen.has(t.id)) tracks.push(t); }); }
  tracks = tracks.filter(function(t){ return t && t.version!=='demo_retired'; });
  var esc = (typeof _shEsc==='function') ? _shEsc : function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  // 작곡가별 그룹 (최신 데모 순)
  var groups={}, order=[];
  tracks.forEach(function(t){
    var name=((t.artist||'익명')+'').trim() || '익명';
    if(!groups[name]){ groups[name]={name:name, artistId:t.artistId||'', tracks:[], latest:0}; order.push(name); }
    groups[name].tracks.push(t);
    var ts=t.createdAt?(Date.parse(t.createdAt)||0):0; if(ts>groups[name].latest) groups[name].latest=ts;
  });
  order.sort(function(a,b){ return groups[b].latest-groups[a].latest; });
  function fmtDate(ts){ if(!ts) return ''; var d=new Date(ts); return d.getFullYear()+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+('0'+d.getDate()).slice(-2); }
  function tagsStr(t){
    var a=(t&&Array.isArray(t.tags))?t.tags.filter(Boolean).map(String):[];
    if(!a.length){ var ti=(t.title||'뮤직').replace(/\s*\(.*\)$/,''); a=[ti]; }
    return a.slice(0,5).map(function(x){ return '#'+esc(x.replace(/^#/,'')); }).join('');
  }
  var INFOCOL=['#E24A9C','#7FB2EC','#86CE34','#B49BEE','#F06CA8','#FF8A6E','#26C6C6','#FFB03A'];
  var listHtml = order.length ? order.map(function(name,gi){
    var g=groups[name], col=INFOCOL[gi%INFOCOL.length];
    // 오래된 데모부터(=데모 1) 위로 → 앞에 1,2,3 번호
    var demos=g.tracks.slice().sort(function(a,b){ return (Date.parse(a.createdAt||0)||0)-(Date.parse(b.createdAt||0)||0); });
    var rows=demos.map(function(t,di){
      var onc = t.id ? ' onclick="if(window.playTrack)playTrack(\''+esc(t.id)+'\',\'wall\')"' : '';
      var add = t.id ? '<button class="sb-add" onclick="event.stopPropagation();if(window._sbCollect)_sbCollect(\''+esc(t.id)+'\')" aria-label="플레이리스트에 담기">+</button>' : '';
      return '<div class="sb-rw"><span class="sb-row" style="border-left-color:'+col+'"'+onc+'><b class="sb-num" style="color:'+col+'">'+(di+1)+'</b>'+tagsStr(t)+'</span>'+add+'</div>';
    }).join('');
    var enc=encodeURIComponent(g.name);
    return '<div class="sb-group" style="animation-delay:'+(Math.min(gi,10)*0.05)+'s">'
      + '<div class="sb-head"><span class="sb-date">'+fmtDate(g.latest)+'</span>'
      + '<span class="sb-artist" style="color:'+col+'" onclick="navigateTo(\'artist:'+enc+'\')">'+esc(g.name)+'</span></div>'
      + '<div class="sb-rows">'+rows+'</div>'
      + '<div class="sb-cmts" id="sb-cmts-'+gi+'">'+_sbCmtListHtml(g.name)+'</div>'
      + '<div class="sb-cmtbar"><input class="sb-cmtin" id="sb-cmtin-'+gi+'" maxlength="200" placeholder="이 앨범에 한마디…" onkeydown="if(event.key===\'Enter\'&&!event.isComposing){event.preventDefault();_sbAddComment('+gi+')}"><button class="sb-cmtadd" onclick="_sbAddComment('+gi+')" aria-label="댓글 남기기">+</button></div>'
      + '</div>';
  }).join('') : '<div class="sb-empty">아직 올라온 데모가 없어요<br>+ 로 첫 곡을 올려보세요</div>';
  window.__sbNames = order;   // 댓글 함수가 gi→작곡가명 조회용
  app.innerHTML = '<div class="sb-page"><h1 class="sb-wordmark">슬로우 뮤직</h1>'
    + '<div class="sb-seclabel">주절주절</div>'
    + '<div class="sb-list">'+listHtml+'</div></div>';
}
window.renderSlowBoard = renderSlowBoard;

// 앨범(작곡가) 전체 댓글 — 지금은 localStorage(이 기기 전용, 서버 미동기). 나중에 테이블로 승격 가능.
function _sbCmtKey(name){ return 'sbcmt:'+name; }
function _sbLoadCmts(name){ try{ return JSON.parse(localStorage.getItem(_sbCmtKey(name))||'[]')||[]; }catch(_){ return []; } }
function _sbCmtListHtml(name){
  var arr=_sbLoadCmts(name);
  var e=function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  return arr.map(function(c){
    return '<div class="sb-cmt" onclick="this.classList.toggle(\'expanded\')"><span class="sb-cmt-ln">ㄴ</span>'+e(c.t)+(c.a?'<span class="sb-cmt-a"> — '+e(c.a)+'</span>':'')+'</div>';
  }).join('');
}
window._sbAddComment=function(gi){
  var name=(window.__sbNames||[])[gi]; if(name==null) return;
  var inp=document.getElementById('sb-cmtin-'+gi); if(!inp) return;
  var txt=(inp.value||'').trim(); if(!txt) return;
  var me; try{ me=(window.__currentUser&&window.__currentUser.name)||(window.DB.get().currentUser&&window.DB.get().currentUser.name); }catch(_){}
  var arr=_sbLoadCmts(name); arr.unshift({t:txt, a:me||'익명', ts:Date.now()});
  try{ localStorage.setItem(_sbCmtKey(name), JSON.stringify(arr.slice(0,50))); }catch(_){}
  inp.value='';
  var list=document.getElementById('sb-cmts-'+gi); if(list) list.innerHTML=_sbCmtListHtml(name);
};

// ════════════ 플레이리스트('universe') — 즐겨찾기 대체. 주절주절과 같은 스타일(검은바+흰행). ════════════
// 최근에 들은 노래(재생 기록 localStorage) + 담은 노래(CollectedTracks). 주절주절 데모 행 스타일 재사용.
function _recentPlays(){ try{ return JSON.parse(localStorage.getItem('offstage_recent')||'[]')||[]; }catch(_){ return []; } }
function _pushRecent(id){ if(!id) return; try{ var a=_recentPlays().filter(function(x){return x!==id;}); a.unshift(id); localStorage.setItem('offstage_recent', JSON.stringify(a.slice(0,30))); }catch(_){} }
window._sbCollect=function(trackId){
  if(!trackId) return;
  if(typeof isTrackLiked==='function' && isTrackLiked(trackId)){ if(typeof showToast==='function') showToast(_t('이미 담은 노래예요','Already saved')); return; }
  if(typeof window.toggleTrackHeart==='function'){ window.toggleTrackHeart(trackId, null); if(typeof showToast==='function') showToast(_t('담은 노래에 추가 💗','Saved 💗')); }
};
function renderPlaylist(){
  currentView='universe';
  var app=document.getElementById('app-content'); if(!app) return;
  try{ document.body.style.overflow=''; document.documentElement.style.overflow=''; }catch(_){}
  try{ if(typeof stopShapesPhysics==='function') stopShapesPhysics(); }catch(_){}
  _slowStyle();
  var db=window.DB.get();
  var all=(Array.isArray(db.tracks)?db.tracks:[]).slice();
  if(Array.isArray(window.__tracks)) window.__tracks.forEach(function(t){ if(t&&!all.some(function(x){return x.id===t.id;})) all.push(t); });
  var byId={}; all.forEach(function(t){ if(t&&t.id) byId[t.id]=t; });
  var esc=(typeof _shEsc==='function')?_shEsc:function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  function tagsStr(t){ var a=(t&&Array.isArray(t.tags))?t.tags.filter(Boolean).map(String):[]; if(!a.length){a=[(t&&t.title)||'뮤직'];} return a.slice(0,5).map(function(x){return '#'+esc(x.replace(/^#/,''));}).join(''); }
  function rows(ids,col){
    var seen={}, out=[];
    (ids||[]).forEach(function(id){ if(seen[id])return; seen[id]=1; var t=byId[id]; if(!t)return;
      out.push('<div class="sb-rw"><span class="sb-row" style="border-left-color:'+col+'" onclick="if(window.playTrack)playTrack(\''+esc(id)+'\',\'universe\')"><b class="sb-num" style="color:'+col+'">'+esc((t.artist||'♪')).slice(0,10)+'</b>'+tagsStr(t)+'</span></div>');
    });
    return out.length?out.join(''):'<div class="sb-plempty">아직 없어요</div>';
  }
  var recent=_recentPlays();
  var saved=[];
  try{ if(window.CollectedTracks&&window.CollectedTracks.all) saved=window.CollectedTracks.all().slice(); }catch(_){}
  if(db.currentUser&&Array.isArray(db.currentUser.likedTracks)) db.currentUser.likedTracks.forEach(function(id){ if(saved.indexOf(id)<0) saved.push(id); });
  app.innerHTML='<div class="sb-page"><h1 class="sb-wordmark">슬로우 뮤직</h1>'
    +'<div class="sb-seclabel">플레이리스트</div>'
    +'<div class="sb-list">'
      +'<div class="sb-group"><div class="sb-head">🕑 최근에 들은 노래</div><div class="sb-rows">'+rows(recent,'#7FB2EC')+'</div></div>'
      +'<div class="sb-group"><div class="sb-head">💗 담은 노래</div><div class="sb-rows">'+rows(saved,'#F06CA8')+'</div></div>'
    +'</div></div>';
}
window.renderPlaylist = renderPlaylist;

async function renderProducingBoard(){
  currentView = 'wall';
  var app = document.getElementById('app-content'); if (!app) return;
  // 방어: 이전 모달이 body/html 에 남긴 스크롤 잠금(overflow:hidden) 해제 — 보드에서 휠 스크롤 안 먹던 케이스 대비.
  try { document.body.style.overflow=''; document.documentElement.style.overflow=''; } catch(_){}
  _pbStyle();
  var logged = !!(window.__currentUser && window.__currentUser.id);
  app.innerHTML =
    '<div class="pb-page">'
    + '<div class="pb-top"><span class="pb-top-t">🎬 프로듀싱</span><button class="pb-top-new" onclick="pbOpenCreate()"><i class="ri-add-line"></i> 투표 만들기</button></div>'
    + '<div class="pb-seg"><b class="'+(window.__pbSeg==='open'?'on':'')+'" onclick="pbSeg(\'open\')">🔥 진행 중</b><b class="'+(window.__pbSeg==='closed'?'on':'')+'" onclick="pbSeg(\'closed\')">🏁 마감</b></div>'
    + '<div class="pb-feed" id="pb-feed"><div class="pb-loading">불러오는 중…</div></div>'
    + '<button class="pb-fab" onclick="pbOpenCreate()" aria-label="투표 라운드 만들기"><i class="ri-add-line"></i></button>'
    + '</div>';
  _pbEnsureSheet();   // 시트는 body 에 한 번만(보드 재렌더에 안 휩쓸리게 + 뷰포트 기준 fixed)
  _pbLoadFeed();
}
window.renderProducingBoard = renderProducingBoard;

async function _pbLoadFeed(){
  var feed = document.getElementById('pb-feed'); if (!feed) return;
  if (!window.Producing) { feed.innerHTML = _pbEmptyHtml('아직 준비 중이에요'); return; }
  var rounds = await window.Producing.fetchBoard(window.__pbSeg);
  if (!document.getElementById('pb-feed')) return;
  if (rounds === null) { feed.innerHTML = _pbEmptyHtml('프로듀싱 기능 준비 중', '곧 열려요!'); return; }
  window.__pbRounds = rounds;
  if (!rounds.length) { feed.innerHTML = _pbEmptyHtml(window.__pbSeg==='open'?'진행 중인 라운드가 없어요':'마감된 라운드가 없어요', (window.__currentUser&&window.__currentUser.id)?'+ 버튼으로 첫 라운드를 열어보세요':'곧 투표가 열려요'); return; }
  feed.innerHTML = rounds.map(_pbCardShell).join('');
  rounds.forEach(function(r){ _pbFillCard(r); });
}
function _pbEmptyHtml(t, s){ return '<div class="pb-empty"><b>'+pbEsc(t)+'</b>'+(s?pbEsc(s):'')+'</div>'; }

function _pbOpt(r, o){
  if (!o) return '';
  var inner = o.audio
    ? '<div class="pb-play" onclick="event.stopPropagation(); pbPlay(\''+pbEsc(o.audio)+'\')"><i class="ri-play-fill"></i></div><div class="pb-name">'+pbEsc(o.name)+'</div><div class="pb-wave"><i class="ri-play-mini-fill"></i><span class="wf"></span></div>'
    : '<div class="pb-name big">'+pbEsc(o.name)+'</div>';
  return '<div class="pb-opt '+o.key+(o.audio?'':' simple')+'" onclick="pbVote(\''+r.id+'\',\''+o.key+'\')"><div class="pb-badge">'+o.key.toUpperCase()+'안</div>'+inner+'</div>';
}
// 커버용 그라데이션 — 트랙 id 해시로 색상 변주(발견의 다채로움), 단 흰 해시태그 대비 위해 어둡게 유지.
function _pbCoverGrad(seed){
  var s=String(seed||''), h=0; for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))>>>0; }
  var a=h%360, b=(a+38)%360, c=(a+320)%360;
  return 'linear-gradient(150deg, hsl('+a+',60%,32%), hsl('+b+',66%,23%) 72%, hsl('+c+',54%,29%))';
}
function _pbCardShell(r){
  var tr = _pbTrack(r.track_id);
  var cover = (tr && tr.cover) ? tr.cover : '';
  var title = (tr && tr.title) ? tr.title.replace(/\s*\(Demo.*\)$/i,'') : (r.song_title || '곡');
  var artist = r.artist_name || (tr && tr.artist) || '';
  var cands = r.candidates || [];
  // 맨 위 = 아티스트 프로필 사진 우선(작게). 없으면 곡 커버, 그것도 없으면 #태그/그라데이션.
  // 구글 아바타(=s96-c)는 흐려서 고해상도(=s400-c)로 요청.
  var hero = (tr && tr.artistAvatar) ? String(tr.artistAvatar).replace(/=s\d+-c/, '=s400-c') : cover;
  var tags = (tr && Array.isArray(tr.tags) && tr.tags.length) ? tr.tags.slice(0,3) : [];
  var grad = '<div class="pb-cover-grad" style="background:'+_pbCoverGrad(r.track_id||r.id)+'"></div>';
  var coverHtml;
  if (hero){
    coverHtml = '<img class="pb-cover-img" src="'+pbEsc(hero)+'" alt="">';
  } else if (tags.length){
    coverHtml = grad + '<div class="pb-cover-tags">'+tags.map(function(tg){ return '<span>#'+pbEsc(String(tg).replace(/^#/,''))+'</span>'; }).join('')+'</div>';
  } else {
    coverHtml = grad;
  }
  // 곡 행 썸네일 = 작은 커버 이미지(있으면) 또는 디스크 아이콘.
  var songIc = cover ? '<div class="pb-song-ic"><img src="'+pbEsc(cover)+'" alt=""></div>' : '<div class="pb-song-ic"><i class="ri-disc-line"></i></div>';
  // 삭제 버튼 — 라운드 작성자 본인에게만.
  var mine = !!(window.__currentUser && window.__currentUser.id && r.artist_id === window.__currentUser.id);
  var delBtn = mine ? '<button class="pb-del" onclick="event.stopPropagation(); pbDeleteRound(\''+r.id+'\')" title="라운드 삭제"><i class="ri-delete-bin-6-line"></i></button>' : '';
  return '<div class="pb-card" id="pb-card-'+r.id+'" data-rid="'+r.id+'">'
    + '<div class="pb-cover">'+coverHtml+delBtn+'<div class="pb-song">'+songIc+'<div><div class="pb-song-t">'+pbEsc(title)+'</div><div class="pb-song-s">'+pbEsc(artist)+'</div></div></div></div>'
    + '<div class="pb-q">'+pbEsc(r.question)+'</div>'
    + '<div class="pb-vs">'+_pbOpt(r,cands[0])+'<div class="pb-vsmid">VS</div>'+_pbOpt(r,cands[1])+'</div>'
    + '<div class="pb-pct" id="pb-pct-'+r.id+'"></div>'
    + '<div class="pb-voices"><div class="pb-cmt-prev" id="pb-prev-'+r.id+'"></div></div>'
    + '<button class="pb-cta" onclick="pbOpenSheet(\''+r.id+'\')"><i class="ri-chat-3-line"></i> 의견 <b id="pb-cc-'+r.id+'">0</b> · 남기기</button>'
    + '</div>';
}
// 라운드 삭제 (작성자 본인). 댓글·투표는 DB cascade 로 함께 삭제.
window.pbDeleteRound = async function(rid){
  if (!window.confirm(_t('이 라운드를 삭제할까요? 댓글·투표도 함께 사라져요.','Delete this round? Comments and votes will be removed too.'))) return;
  try {
    await window.Producing.delete(rid);
    if (typeof showToast==='function') showToast(_t('삭제했어요','Deleted'));
    var card = document.getElementById('pb-card-'+rid); if (card) card.remove();
    var feed = document.getElementById('pb-feed');
    if (feed && !feed.querySelector('.pb-card')) renderProducingBoard();   // 비면 빈 상태로
  } catch(e){ alert(_t('삭제 실패: ','Delete failed: ')+(e.message||e)); }
};
function _pbCmtRow(r, c, d, isTop){
  var likes = d.tally[c.id]||0, on = r.__myChoice===c.id, nm = c.user_name || '익명';
  // 전체 참여(투표+하트) 대비 이 댓글의 비중 % — 항상 공개(사용자 요청).
  var total = 0; for (var k in d.tally){ if (Object.prototype.hasOwnProperty.call(d.tally,k)) total += (d.tally[k]||0); }
  var pctHtml = '<span class="pb-cpct">'+(total ? Math.round(likes/total*100) : 0)+'%</span>';
  return '<div class="pb-cmt"><div class="pb-cav" style="background:'+_pcColor(nm)+'">'+pbEsc(nm.charAt(0))+'</div>'
    + '<div class="pb-cbd"><div class="pb-cu">'+pbEsc(nm)+(isTop?'<span class="pb-top1">🏆 배틀 합류</span>':'')+'</div><div class="pb-ct">'+pbEsc(c.body)+'</div></div>'
    + '<div class="pb-clike'+(on?' on':'')+'" onclick="event.stopPropagation(); pbLikeComment(\''+r.id+'\',\''+c.id+'\')"><i class="'+(on?'ri-heart-3-fill':'ri-heart-3-line')+'"></i><b>'+likes+'</b>'+pctHtml+'</div></div>';
}
function _pbPctHtml(r, d){
  var cands = r.candidates||[]; var a = d.tally[(cands[0]||{}).key]||0, b = d.tally[(cands[1]||{}).key]||0;
  var sum = a+b||1, ap = Math.round(a/sum*100), bp = 100-ap;
  return '<div class="pb-pct-row"><div class="pb-pct-c a"><div class="pb-bar"><span style="width:'+ap+'%"></span></div><div class="pb-pn">'+ap+'%</div></div><div class="pb-pct-c b"><div class="pb-bar"><span style="width:'+bp+'%;margin-left:auto"></span></div><div class="pb-pn">'+bp+'%</div></div></div>';
}
async function _pbFillCard(r){
  if (!window.Producing) return;
  var d = await window.Producing.fetchDetail(r.id);
  r.__detail = d; r.__myChoice = d.myChoice;
  var card = document.getElementById('pb-card-'+r.id); if (!card) return;
  var cc = document.getElementById('pb-cc-'+r.id); if (cc) cc.textContent = d.comments.length;
  var sorted = d.comments.slice().sort(function(a,b){return (d.tally[b.id]||0)-(d.tally[a.id]||0);});
  var prev = document.getElementById('pb-prev-'+r.id);
  if (prev) prev.innerHTML = sorted.length ? sorted.slice(0,2).map(function(c,i){return _pbCmtRow(r,c,d,i===0);}).join('') : '<div class="pb-noc">첫 의견을 남겨보세요 · 하트 1등은 C안 합류</div>';
  var pctEl = document.getElementById('pb-pct-'+r.id);
  if (pctEl) pctEl.innerHTML = _pbPctHtml(r, d);   // 항상 퍼센트 공개(블라인드 해제)
  card.querySelectorAll('.pb-opt').forEach(function(el){ el.classList.remove('on'); });
  if (d.myChoice==='a'||d.myChoice==='b'||d.myChoice==='c'){ var o=card.querySelector('.pb-opt.'+d.myChoice); if(o)o.classList.add('on'); }
}

window.pbSeg = function(mode){ window.__pbSeg = mode; renderProducingBoard(); };
window.pbPlay = function(url){ try{ if(window.__pbAudio){window.__pbAudio.pause();} window.__pbAudio = new Audio(url); window.__pbAudio.play(); }catch(e){} };
window.pbVote = async function(rid, choice){
  if (!window.__currentUser || !window.__currentUser.id){ alert(_t('로그인하면 투표할 수 있어요','Log in to vote')); return; }
  var r = _pbFindRound(rid); if (r && r.status!=='open'){ if(typeof showToast==='function') showToast(_t('이미 마감된 라운드예요','This round is closed')); return; }
  try { await window.Producing.vote(rid, choice); if (r) await _pbFillCard(r); }
  catch(e){ alert(_t('실패: ','Failed: ')+(e.message||e)); }
};
window.pbLikeComment = async function(rid, cid){
  if (!window.__currentUser || !window.__currentUser.id){ alert(_t('로그인하면 추천할 수 있어요','Log in to vote')); return; }
  try { await window.Producing.vote(rid, cid); var r=_pbFindRound(rid); if(r){ await _pbFillCard(r); if (window.__pbSheetRound===rid) _pbRenderSheet(r); } }
  catch(e){ alert(_t('실패: ','Failed: ')+(e.message||e)); }
};
window.pbOpenSheet = async function(rid){
  var r = _pbFindRound(rid); if (!r) return;
  window.__pbSheetRound = rid;
  var sheet = document.getElementById('pb-sheet');
  sheet.innerHTML = '<div class="pb-grab"></div><div class="pb-sh-h" id="pb-sh-h">댓글<span class="x" onclick="pbCloseSheet()"><i class="ri-close-line"></i></span></div>'
    + '<div class="pb-sh-hint">💡 하트 1등 댓글이 <b>제안 배틀(C안)</b>에 올라가요</div>'
    + '<div class="pb-sh-list" id="pb-sh-list"><div class="pb-noc" style="text-align:center;padding:30px">불러오는 중…</div></div>'
    + '<div class="pb-sh-add"><input id="pb-newcmt" placeholder="'+_t('의견 남기기…','Add your idea…')+'" maxlength="500"><button onclick="pbAddComment()">'+_t('게시','Post')+'</button></div>';
  _pbShowSheet();
  if (!r.__detail) { await _pbFillCard(r); }
  _pbRenderSheet(r);
};
function _pbRenderSheet(r){
  if (window.__pbSheetRound !== r.id) return;
  var d = r.__detail || { comments:[], tally:{} };
  var sorted = d.comments.slice().sort(function(a,b){return (d.tally[b.id]||0)-(d.tally[a.id]||0);});
  var h = document.getElementById('pb-sh-h'); if (h) h.firstChild.textContent = '댓글 '+d.comments.length+' ';
  var list = document.getElementById('pb-sh-list');
  if (list) list.innerHTML = sorted.length ? sorted.map(function(c,i){return _pbCmtRow(r,c,d,i===0);}).join('') : '<div class="pb-noc" style="text-align:center;padding:30px">첫 의견을 남겨보세요!</div>';
}
// 시트/백드롭을 document.body 에 한 번만 생성(보드 재렌더 시 안 사라지게). 이미 있으면 그대로 둠.
function _pbEnsureSheet(){
  if(!document.getElementById('pb-sheet-back')){
    var b=document.createElement('div'); b.id='pb-sheet-back'; b.className='pb-sheet-back';
    b.setAttribute('onclick','pbCloseSheet()'); document.body.appendChild(b);
  }
  if(!document.getElementById('pb-sheet')){
    var s=document.createElement('div'); s.id='pb-sheet'; s.className='pb-sheet'; document.body.appendChild(s);
  }
  _pbAttachSwipe(document.getElementById('pb-sheet'));
}
// 바텀시트 스와이프-투-디스미스: 손잡이/헤더를 아래로 끌면 따라 내려가고, 일정 이상이면 닫힘(아니면 제자리 복귀).
// 손잡이(.pb-grab)·헤더(.pb-sh-h)에서만 시작 → 폼 스크롤/입력과 충돌 없음. 닫기 X(.x)는 제외.
function _pbAttachSwipe(sheet){
  if(!sheet || sheet.__pbSwipe) return; sheet.__pbSwipe = true;
  var startY=0, lastY=0, dragging=false, h=1, pid=null;
  function fromHandle(t){ return !!(t && t.closest && (t.closest('.pb-grab') || (t.closest('.pb-sh-h') && !t.closest('.x')))); }
  function onDown(e){
    if(!fromHandle(e.target)) return;
    dragging=true; pid=e.pointerId; startY=e.clientY; lastY=startY;
    h = sheet.getBoundingClientRect().height || 1;
    sheet.style.transition='none';
    try{ sheet.setPointerCapture(pid); }catch(_){}
  }
  function onMove(e){
    if(!dragging) return;
    lastY=e.clientY; var dy=Math.max(0,lastY-startY);
    sheet.style.transform='translateY('+dy+'px)';
  }
  function end(){
    if(!dragging) return; dragging=false;
    var dy=Math.max(0,lastY-startY);
    sheet.style.transition='transform .25s cubic-bezier(.4,0,.2,1)';
    if(dy > Math.min(150, h*0.28)){
      sheet.style.transform='translateY(100%)';
      var back=document.getElementById('pb-sheet-back'); if(back) back.classList.remove('on');
      setTimeout(function(){ if(typeof pbCloseSheet==='function') pbCloseSheet(); sheet.style.transition=''; sheet.style.transform=''; }, 240);
    } else {
      sheet.style.transform='translateY(0)';
      setTimeout(function(){ sheet.style.transition=''; sheet.style.transform=''; }, 240);
    }
  }
  sheet.addEventListener('pointerdown', onDown);
  sheet.addEventListener('pointermove', onMove);
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}
// 시트 열기 — 내용(innerHTML) 넣은 뒤 '다음 프레임'에 .on 을 붙여야 슬라이드업 transition 이 제대로 발동.
// (같은 프레임에 붙이면 동적 높이 + 미발동으로 시트가 translateY(100%) 닫힘 위치에 멈춰 화면 밖에 머무름 — 사용자 보고 버그.)
function _pbShowSheet(){
  var sheet=document.getElementById('pb-sheet'), back=document.getElementById('pb-sheet-back');
  if(!sheet) return;
  if(back) back.classList.add('on');
  void sheet.offsetHeight;            // 직전 상태(닫힘) 커밋 → .on 추가 시 슬라이드업 transition 발동
  sheet.classList.add('on');
}
window.pbCloseSheet = function(){ document.getElementById('pb-sheet-back').classList.remove('on'); var s=document.getElementById('pb-sheet'); if(s)s.classList.remove('on'); window.__pbSheetRound=null; };
window.pbAddComment = async function(){
  var rid = window.__pbSheetRound; var r = _pbFindRound(rid); if (!r) return;
  if (!window.__currentUser || !window.__currentUser.id){ alert(_t('로그인하면 댓글을 달 수 있어요','Log in to comment')); return; }
  var inp = document.getElementById('pb-newcmt'); var v=(inp.value||'').trim(); if(!v) return;
  inp.disabled = true;
  try { var c = await window.Producing.addComment(rid, v); try{ await window.Producing.vote(rid, c.id); }catch(_){} inp.value=''; inp.disabled=false; await _pbFillCard(r); _pbRenderSheet(r); var l=document.getElementById('pb-sh-list'); if(l)l.scrollTop=0; }
  catch(e){ alert(_t('실패: ','Failed: ')+(e.message||e)); inp.disabled=false; }
};

// ── 라운드 만들기 (보드 + 버튼) ──
window.pbOpenCreate = function(){
  if (!window.__currentUser || !window.__currentUser.id){ alert(_t('로그인이 필요해요','Login required')); navigateTo('auth'); return; }
  var me = window.__currentUser;
  var db = window.DB.get();
  var mine = (db.tracks||[]).filter(function(t){ return t && (t.artist===me.name || (me.id && t.artistId===me.id)); });
  if (!mine.length){ alert(_t('먼저 곡(데모)을 올려야 라운드를 만들 수 있어요','Upload a demo first')); return; }
  var opts = mine.map(function(t){ var ti=(t.title||'곡').replace(/\s*\(Demo.*\)$/i,''); return '<option value="'+pbEsc(t.id)+'" data-pid="'+pbEsc(t.projectId||('proj_'+t.id))+'">'+pbEsc(ti)+' · '+pbEsc(t.versionLabel||'')+'</option>'; }).join('');
  var topics = [['🎵 편곡','2절에 뭐 더 넣을까?','드럼 추가','기타 추가'],['👕 의상','무대 의상 뭐 입을까?','빨간 옷','파란 옷'],['✍️ 제목','곡 제목 뭐로?','',''],['💡 직접','','','']];
  window.__pbTopics = topics;
  window.__pbFormAudio = { a: null, b: null };   // 옵션별 첨부 음원 URL(이번 폼 리셋) — 플레이어 __pbAudio 와 충돌 방지 별도 변수
  var chips = topics.map(function(t,i){ return '<button type="button" class="pb-day" style="flex:0 0 auto" onclick="pbFillTopic('+i+')">'+t[0]+'</button>'; }).join('');
  var sheet = document.getElementById('pb-sheet');
  window.__pbSheetRound = null;
  sheet.innerHTML = '<div class="pb-grab"></div><div class="pb-sh-h">🎬 프로듀싱 라운드 만들기<span class="x" onclick="pbCloseSheet()"><i class="ri-close-line"></i></span></div>'
    + '<div class="pb-form">'
    + '<div class="pb-flab">어떤 곡/데모?</div><select id="pb-c-track">'+opts+'</select>'
    + '<div class="pb-flab">빠른 주제 (누르면 자동 채움)</div><div class="pb-days" style="flex-wrap:wrap">'+chips+'</div>'
    + '<div class="pb-flab">뭘 정할까요?</div><input id="pb-c-q" maxlength="200" placeholder="예: 후렴 편곡 / 무대 의상…">'
    + '<div class="pb-flab">두 안 (A · B) — 글자만 적으면 간단 투표 · 음원/흥얼거림 올리면 들어보고 투표</div>'
    + '<div class="pb-opt-edit"><span class="pb-opt-key a">A</span><input id="pb-c-a" maxlength="60" placeholder="A안 이름 (예: 몽환 신스)"><button type="button" class="pb-attach" id="pb-att-a" onclick="pbPickAudio(\'a\')" title="음원/흥얼거림 첨부"><i class="ri-music-2-line"></i></button><input type="file" id="pb-file-a" accept="audio/*" style="display:none" onchange="pbAudioPicked(\'a\',this)"></div>'
    + '<div class="pb-opt-edit"><span class="pb-opt-key b">B</span><input id="pb-c-b" maxlength="60" placeholder="B안 이름 (예: 펑키 기타)"><button type="button" class="pb-attach" id="pb-att-b" onclick="pbPickAudio(\'b\')" title="음원/흥얼거림 첨부"><i class="ri-music-2-line"></i></button><input type="file" id="pb-file-b" accept="audio/*" style="display:none" onchange="pbAudioPicked(\'b\',this)"></div>'
    + '<div class="pb-flab">마감</div><div class="pb-days"><button type="button" class="pb-day" data-day="1" onclick="pbPickDay(this)">1일</button><button type="button" class="pb-day on" data-day="3" onclick="pbPickDay(this)">3일</button><button type="button" class="pb-day" data-day="7" onclick="pbPickDay(this)">7일</button></div>'
    + '</div>'
    + '<div class="pb-form-foot"><button class="pb-open" onclick="pbCreate(this)"><i class="ri-rocket-2-line"></i> 라운드 열기</button></div>';
  _pbShowSheet();
};
window.pbFillTopic = function(i){ var t=(window.__pbTopics||[])[i]; if(!t)return; document.getElementById('pb-c-q').value=t[1]; document.getElementById('pb-c-a').value=t[2]; document.getElementById('pb-c-b').value=t[3]; };
window.pbPickDay = function(el){ el.parentNode.querySelectorAll('.pb-day').forEach(function(c){c.classList.remove('on');}); el.classList.add('on'); };
// A·B 옵션별 음원/흥얼거림 첨부 — 파일 고르면 즉시 업로드, 버튼에 상태 표시
window.pbPickAudio = function(key){ var f=document.getElementById('pb-file-'+key); if(f) f.click(); };
window.pbAudioPicked = async function(key, input){
  var file = input && input.files && input.files[0]; if(!file) return;
  if (!window.Tracks || !window.Tracks.uploadFile){ alert(_t('업로드 모듈 없음','Upload unavailable')); return; }
  var btn = document.getElementById('pb-att-'+key);
  if (btn){ btn.classList.add('pb-att-busy'); btn.classList.remove('pb-att-has'); btn.innerHTML='<i class="ri-loader-4-line pb-spin"></i>'; }
  try {
    var url = await window.Tracks.uploadFile(file, 'audio');
    window.__pbFormAudio = window.__pbFormAudio || {a:null,b:null};
    window.__pbFormAudio[key] = url;
    if (btn){ btn.classList.remove('pb-att-busy'); btn.classList.add('pb-att-has'); btn.innerHTML='<i class="ri-checkbox-circle-fill"></i>'; btn.title=_t('첨부됨: ','Attached: ')+(file.name||''); }
  } catch(e){
    console.warn('[pb] audio upload', e);
    alert(_t('음원 업로드 실패: ','Audio upload failed: ')+(e.message||e));
    if (btn){ btn.classList.remove('pb-att-busy'); btn.innerHTML='<i class="ri-music-2-line"></i>'; }
  }
};
window.pbCreate = async function(btn){
  var sel = document.getElementById('pb-c-track'); var opt = sel.options[sel.selectedIndex];
  var trackId = sel.value, projectId = opt ? opt.getAttribute('data-pid') : ('proj_'+trackId);
  var q = (document.getElementById('pb-c-q').value||'').trim();
  var a = (document.getElementById('pb-c-a').value||'').trim();
  var b = (document.getElementById('pb-c-b').value||'').trim();
  if (!a || !b){ alert(_t('A·B 두 안을 적어주세요','Enter A and B')); return; }
  var dayBtn = document.querySelector('.pb-form .pb-day.on[data-day]'); var days = dayBtn?parseInt(dayBtn.dataset.day,10):3;
  btn.disabled = true; var old = btn.innerHTML; btn.innerHTML = '...';
  try {
    var au = window.__pbFormAudio || {a:null,b:null};
    var candA = { key:'a', name:a }; if (au.a) candA.audio = au.a;
    var candB = { key:'b', name:b }; if (au.b) candB.audio = au.b;
    await window.Producing.create({ projectId: projectId, trackId: trackId, question: q||_t('다음 데모, 어디로?','Where next?'), candidates: [candA, candB], closesAt: new Date(Date.now()+days*86400000).toISOString() });
    if (typeof showToast==='function') showToast(_t('라운드가 열렸어요! 🎬','Round opened! 🎬'));
    window.__pbSeg = 'open'; pbCloseSheet(); renderProducingBoard();
  } catch(e){ alert(_t('실패: ','Failed: ')+(e.message||e)); btn.disabled=false; btn.innerHTML=old; }
};

// 주절주절 = 스레드 피드 (라이브). → 프로듀싱 게시판으로 교체됨. 옛 코드는 아래 보존(롤백: 이 위임 한 줄만 지우면 됨).
// 중요: 실시간 구독·새로고침·댓글 핸들러 등 곳곳에서 renderWall() 을 직접 부르므로, 여기서 보드로 위임해야
//       보드가 옛 주절주절로 덮어써지지 않는다(사용자 보고 버그).
async function renderWall() {
  if (typeof renderSlowBoard === 'function') return renderSlowBoard();
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  const db = window.DB.get();
  // 새로고침 — 레거시 renderWallLegacy 와 동일 전략: 캐시 즉시 렌더 + 백그라운드 갱신.
  if (window.Walls && window.Walls.refreshInto) {
    const hasCache = Array.isArray(db.notes) && db.notes.length > 0;
    if (hasCache) {
      const beforeIds = (db.notes || []).map(n => n.id).join('|');
      window.Walls.refreshInto(db).then(() => {
        if (currentView !== 'wall') return;
        const afterIds = (window.DB.get().notes || []).map(n => n.id).join('|');
        if (afterIds !== beforeIds) renderWall();
      }).catch(e => console.warn('[wall] bg refresh', e));
    } else {
      try {
        await Promise.race([
          window.Walls.refreshInto(db).catch(e => console.warn('[wall] refresh', e)),
          new Promise(r => setTimeout(r, 1500))
        ]);
      } catch (_) {}
      if (currentView !== 'wall') return;
    }
  }
  // 좋아요(note_favorites) — 내 좋아요 + 노트별 카운트를 백그라운드로 갱신, 바뀌면 한 번만 다시 그림.
  // (캐시는 즉시 렌더에 쓰고, 서버 최신값은 비동기로 반영. __wallFavRefreshing 으로 루프 방지.)
  if (window.Walls && window.Walls.refreshFavoriteCounts && !window.__wallFavRefreshing) {
    window.__wallFavRefreshing = true;
    const _favSig = () => (window.__favoritedNotes ? [...window.__favoritedNotes].sort().join(',') : '') + '|' + JSON.stringify(window.__noteFavCounts || {});
    const _favBefore = _favSig();
    Promise.all([
      window.Walls.refreshMyFavorites ? window.Walls.refreshMyFavorites().catch(() => {}) : null,
      window.Walls.refreshFavoriteCounts().catch(() => {})
    ]).then(() => {
      if (currentView === 'wall' && _favSig() !== _favBefore) renderWall();
    }).finally(() => { window.__wallFavRefreshing = false; });
  }
  const me = window.__currentUser || db.currentUser || null;
  const myId = me && me.id;
  const myAvatar = (me && (me.avatar_url || me.avatar)) || ('https://i.pravatar.cc/150?u=' + (myId || 'me'));
  // 작성자 실제 프로필 사진 — 노트 조인(authorAvatar) 우선, 없으면 트랙(아티스트) 아바타,
  // 그래도 없으면 기본(아이디 시드). 랜덤 얼굴 대신 각자 실제 사진을 보여주려는 것.
  const _avById = {}, _avByName = {};
  (db.tracks || []).forEach(t => { if (t) { if (t.artistId && t.artistAvatar) _avById[t.artistId] = t.artistAvatar; if (t.artist && t.artistAvatar) _avByName[t.artist] = t.artistAvatar; } });
  if (me && me.id && (me.avatar_url || me.avatar)) _avById[me.id] = me.avatar_url || me.avatar;
  const _resolveAuthorAvatar = (n) =>
    (myId && n.authorId === myId) ? myAvatar
    : (n.authorAvatar || (n.authorId && _avById[n.authorId]) || _avByName[n.author] || ('https://i.pravatar.cc/150?u=' + (n.authorId || n.author || n.id)));
  window.__resolveNoteAvatar = _resolveAuthorAvatar;   // 댓글 시트 등에서 재사용
  const notes = (db.notes || []).slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  // 전체/팔로잉 필터 — 팔로잉이면 내가 팔로우한 작성자 글만.
  const _feedFilter = window.__feedFilter || 'all';
  const _filteredNotes = (_feedFilter === 'following' && typeof window._isFollowingName === 'function')
    ? notes.filter(n => window._isFollowingName(n.author))
    : notes;
  const posts = _filteredNotes.map(n => ({
    id: n.id,
    name: n.author || '익명',
    avatar: _resolveAuthorAvatar(n),
    time: _threadTimeAgo(n.createdAt),
    text: n.text || '',
    image: n.imageUrl || null,
    images: Array.isArray(n.imageUrls) ? n.imageUrls.filter(Boolean) : (n.imageUrl ? [n.imageUrl] : []),
    track: n.trackId ? _threadTrackOf(n.trackId) : null,
    comments: (n.comments || []).length,
    isMine: !!(myId && n.authorId === myId),
    authorId: n.authorId || null,
    collected: !!(window.Walls && window.Walls.isBookmarked && window.Walls.isBookmarked(n.id)),
    liked: _isNoteLiked(n.id),
    likeCount: (window.Walls && window.Walls.favoriteCount) ? window.Walls.favoriteCount(n.id) : 0
  }));
  const composerAvatar = me ? myAvatar : ('https://i.pravatar.cc/150?u=guest');
  const empty = posts.length === 0 ? `
      <div class="thread-empty">
        <i class="ri-quill-pen-line"></i>
        <p>${_feedFilter === 'following'
          ? _i18n('팔로잉한 사람의 글이 없어요.<br>아티스트를 팔로우해보세요!', 'No posts from people you follow.<br>Follow some artists!')
          : _i18n('아직 주절주절이 없어요.<br>첫 글을 남겨보세요!', 'Nothing here yet.<br>Be the first to post!')}</p>
      </div>` : '';
  appContent.innerHTML = `
    <div class="feed-filter">
      <button class="feed-filter-btn ${_feedFilter === 'all' ? 'on' : ''}" type="button" onclick="setFeedFilter('all')">${_t('전체', 'All')}</button>
      <button class="feed-filter-btn ${_feedFilter === 'following' ? 'on' : ''}" type="button" onclick="setFeedFilter('following')">${_t('팔로잉', 'Following')}</button>
    </div>
    <div id="feed-reels" class="feed-reels">
      ${posts.map(_threadPostHtml).join('')}
      ${empty}
    </div>`;
  if (window._wireFeedCarousels) window._wireFeedCarousels();
  requestAnimationFrame(function () { if (window._wireFeedExpanders) window._wireFeedExpanders(); });
}
// 피드 캐러셀(여러 사진) — 스크롤 위치로 점·카운터 갱신. (멱등)
window._wireFeedCarousels = function () {
  document.querySelectorAll('#feed-reels .feed-carousel').forEach(function (car) {
    if (car._wired) return;
    car._wired = true;
    const media = car.parentElement;
    const dots = media ? media.querySelectorAll('.feed-dots span') : [];
    const count = media ? media.querySelector('.feed-count') : null;
    const total = car.querySelectorAll('.feed-slide').length;
    car.addEventListener('scroll', function () {
      const i = Math.round(car.scrollLeft / car.clientWidth);
      if (count) count.textContent = (i + 1) + '/' + total;
      dots.forEach(function (d, j) { d.classList.toggle('on', j === i); });
    }, { passive: true });
  });
};
// 긴 글 — 3줄 클램프 넘으면 '더보기' 노출, 누르면 인라인으로 펼침(접기 토글).
window._wireFeedExpanders = function () {
  document.querySelectorAll('#feed-reels .feed-lyrics').forEach(function (el) {
    if (el._expWired) return;
    el._expWired = true;
    if (el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 2) {
      const btn = document.createElement('button');
      btn.className = 'feed-more-btn'; btn.type = 'button';
      btn.textContent = _t('더보기', 'More');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const open = el.classList.toggle('expanded');
        btn.textContent = open ? _t('접기', 'Less') : _t('더보기', 'More');
      });
      el.insertAdjacentElement('afterend', btn);
    }
  });
};
// 전체/팔로잉 필터 토글 — 모드 저장 후 피드 다시 그림.
window.setFeedFilter = function (mode) {
  window.__feedFilter = mode;
  if (typeof renderWall === 'function') renderWall();
};
// 피드 작성자 팔로우 토글 — 토글 후 같은 작성자 버튼 전부 갱신.
window._feedToggleFollow = async function (btn) {
  const name = btn.getAttribute('data-author');
  const aid = btn.getAttribute('data-author-id') || null;
  if (!name) return;
  try { if (window.toggleFollowArtist) await window.toggleFollowArtist(aid || null, name); } catch (_) {}
  const now = (typeof window._isFollowingName === 'function') && window._isFollowingName(name);
  document.querySelectorAll('.feed-follow-btn').forEach(function (b) {
    if (b.getAttribute('data-author') === name) {
      b.classList.toggle('following', !!now);
      b.textContent = now ? _t('팔로잉', 'Following') : _t('팔로우', 'Follow');
    }
  });
};
// 프리뷰/구버전 호환 — 같은 함수를 가리킴.
window.renderWallThreadTest = renderWall;
window.__threadDraft = { imageFile: null, imageData: null };
window.openThreadComposer = function () {
  const me = window.__currentUser || (window.DB.get().currentUser);
  if (!me) { alert('주절주절을 남기려면 로그인이 필요해요.'); navigateTo('auth'); return; }
  const myAvatar = me.avatar_url || me.avatar || ('https://i.pravatar.cc/150?u=' + (me.id || 'me'));
  window.__threadDraft = { imageFile: null, imageData: null };
  window.__threadAttachedSong = null;
  const ex = document.getElementById('thread-composer-modal'); if (ex) ex.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="thread-composer-modal" class="thread-composer-modal" onclick="if(event.target===this) closeThreadComposer()">
      <div class="thread-composer-sheet">
        <div class="thread-sheet-head">
          <button class="thread-sheet-cancel" onclick="closeThreadComposer()">${_i18n('취소', 'Cancel')}</button>
          <span class="thread-sheet-title">${_i18n('새 주절주절', 'New post')}</span>
          <button class="thread-sheet-post" id="thread-sheet-post" disabled onclick="submitThreadPost()">${_i18n('게시', 'Post')}</button>
        </div>
        <div class="thread-sheet-row">
          <img class="thread-avatar" src="${myAvatar}" alt="">
          <textarea class="thread-sheet-input" id="thread-sheet-text" placeholder="${_t('무슨 생각을 하고 있나요?', "What's on your mind?")}" oninput="_threadComposerSync()"></textarea>
        </div>
        <div class="thread-sheet-preview" id="thread-sheet-preview" style="display:none;"></div>
        <div class="thread-sheet-songchip" id="thread-sheet-songchip" style="display:none;"></div>
        <div class="thread-sheet-attach">
          <button class="thread-attach-btn" type="button" onclick="document.getElementById('thread-img-input').click()"><i class="ri-image-add-line"></i> ${_i18n('사진', 'Photo')}</button>
          <button class="thread-attach-btn" type="button" onclick="_threadAttachSong()"><i class="ri-music-2-line"></i> ${_i18n('노래', 'Song')}</button>
          <input type="file" id="thread-img-input" accept="image/*" style="display:none" onchange="_threadPickImage(this)">
        </div>
      </div>
    </div>`);
  setTimeout(() => { const ta = document.getElementById('thread-sheet-text'); if (ta && window.innerWidth > 768) ta.focus(); }, 50);
};
window.closeThreadComposer = function () { const m = document.getElementById('thread-composer-modal'); if (m) m.remove(); };
window._threadComposerSync = function () {
  const ta = document.getElementById('thread-sheet-text');
  const btn = document.getElementById('thread-sheet-post');
  const has = (ta && ta.value.trim()) || (window.__threadDraft && window.__threadDraft.imageFile) || window.__threadAttachedSong;
  if (btn) btn.disabled = !has;
};
window._threadPickImage = function (input) {
  const f = input.files && input.files[0]; if (!f) return;
  if (f.size > 8 * 1024 * 1024) { alert('사진이 너무 커요 (8MB 이하로 올려주세요).'); input.value = ''; return; }
  const r = new FileReader();
  r.onload = () => {
    window.__threadDraft.imageFile = f;
    window.__threadDraft.imageData = r.result;
    const p = document.getElementById('thread-sheet-preview');
    if (p) { p.style.display = 'block'; p.innerHTML = `<img src="${r.result}" alt=""><button class="thread-sheet-preview-remove" type="button" onclick="_threadRemoveImage()">${_i18n('사진 제거', 'Remove photo')}</button>`; }
    _threadComposerSync();
  };
  r.readAsDataURL(f);
};
window._threadRemoveImage = function () {
  window.__threadDraft.imageFile = null; window.__threadDraft.imageData = null;
  const p = document.getElementById('thread-sheet-preview'); if (p) { p.style.display = 'none'; p.innerHTML = ''; }
  const inp = document.getElementById('thread-img-input'); if (inp) inp.value = '';
  _threadComposerSync();
};
// 노래 첨부 — 기존 벽의 곡 첨부기(Off-Stage 곡 / 외부 URL) 재사용.
window._threadAttachSong = function () { if (typeof openSongAttacher === 'function') openSongAttacher('thread'); };
// openSongAttacher('thread') 픽 결과를 시트의 칩으로 렌더 (_renderAttachPreview 가 위임).
window._threadRenderSongChip = function () {
  const c = document.getElementById('thread-sheet-songchip');
  if (!c) return;
  const a = window.__threadAttachedSong;
  const esc = (s) => (s || '').replace(/</g, '&lt;');
  if (!a) { c.style.display = 'none'; c.innerHTML = ''; _threadComposerSync(); return; }
  let cover = '', label = '';
  if (a.kind === 'track') {
    const t = (window.DB.get().tracks || []).find(x => x.id === a.id) || {};
    cover = t.cover || ''; label = (t.title || '곡') + (t.artist ? ' — ' + t.artist : '');
  } else { label = a.url || '링크'; }
  c.style.display = 'flex';
  c.innerHTML = `${cover ? `<img src="${cover}" alt="">` : '<div class="thread-songchip-ext"><i class="ri-link"></i></div>'}<span class="t">${esc(label)}</span><button type="button" onclick="clearAttachedSong()" aria-label="첨부 취소"><i class="ri-close-line"></i></button>`;
  _threadComposerSync();
};
window.submitThreadPost = async function () {
  const me = window.__currentUser || (window.DB.get().currentUser);
  if (!me) { alert('로그인이 필요해요.'); navigateTo('auth'); return; }
  const ta = document.getElementById('thread-sheet-text');
  const text = (ta && ta.value.trim()) || '';
  const draft = window.__threadDraft || {};
  const attached = window.__threadAttachedSong || null;
  const trackId     = attached && attached.kind === 'track' ? attached.id  : null;
  const externalUrl = attached && attached.kind === 'url'   ? attached.url : null;
  if (!text && !draft.imageFile && !trackId && !externalUrl) return;
  const btn = document.getElementById('thread-sheet-post');
  if (btn) { btn.disabled = true; btn.textContent = _t('올리는 중…', 'Posting…'); }
  try {
    let imageUrl = null;
    if (draft.imageFile && window.Tracks && window.Tracks.uploadFile) {
      imageUrl = await window.Tracks.uploadFile(draft.imageFile, 'covers');
    }
    let inserted = null, photoSkipped = false;
    if (window.Walls && window.Walls.insert) {
      const payload = { text, color: 'yellow', rotation: 0, trackId, externalUrl, imageUrl };
      try {
        inserted = await Promise.race([
          window.Walls.insert(payload),
          new Promise((_, reject) => setTimeout(() => reject(new Error('네트워크 타임아웃 (15초)')), 15000))
        ]);
      } catch (insErr) {
        // image_url 컬럼이 없는 스키마(마이그레이션 SQL 미실행)면 사진만 빼고 글·노래는 살림.
        const m = String(insErr && insErr.message || insErr);
        if (imageUrl && /image_url|column|schema|PGRST/i.test(m)) {
          delete payload.imageUrl;
          inserted = await window.Walls.insert(payload);
          photoSkipped = true;
        } else { throw insErr; }
      }
      // Walls.insert 는 __wallNotes 만 갱신 → renderWall 이 읽는 db.notes 에도 즉시 반영.
      if (inserted) {
        const _db = window.DB.get();
        if (!Array.isArray(_db.notes)) _db.notes = [];
        if (!_db.notes.some(n => n && n.id === inserted.id)) { _db.notes.unshift(inserted); try { window.DB.save(_db); } catch (_) {} }
      }
    }
    window.__threadDraft = { imageFile: null, imageData: null };
    window.__threadAttachedSong = null;
    closeThreadComposer();
    if (typeof showToast === 'function') showToast(photoSkipped ? _t('글은 올렸어요 — 사진은 DB 설정(SQL) 후 올라가요', 'Post is up — photos go live after DB setup (SQL)') : _t('올렸어요 📌', 'Posted 📌'));
    Promise.resolve(renderWall()).catch(e => console.warn('[thread] renderWall', e));
  } catch (e) {
    alert('올리기 실패: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = _t('게시', 'Post'); }
  }
};
// 구버전 호환 별칭.
window.submitThreadTest = function () { return window.submitThreadPost(); };

// ===================== 인스타식 댓글 바텀시트 (주절주절 피드) =====================
// 피드 포스트 댓글 버튼 → 아래에서 올라오는 시트에 댓글 목록 + 입력. (기존 노트 상세 모달 대신)
const _UUID_CM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _commentSheetListHtml(note, myId, myAvatar) {
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cms = (note.comments || []).slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  if (!cms.length) return `<div class="comment-sheet-empty">${_t('아직 댓글이 없어요 · 첫 댓글을 남겨보세요', 'No comments yet · Be the first')}</div>`;
  // 작성자 실제 아바타 — 조인(authorAvatar) 우선, 없으면 트랙(아티스트) 아바타, 최후에 기본.
  const _db = window.DB.get(); const _avById = {}, _avByName = {};
  (_db.tracks || []).forEach(t => { if (t) { if (t.artistId && t.artistAvatar) _avById[t.artistId] = t.artistAvatar; if (t.artist && t.artistAvatar) _avByName[t.artist] = t.artistAvatar; } });
  return cms.map(cm => {
    const isMine = !!(myId && cm.authorId === myId);
    const av = isMine ? myAvatar
      : (cm.authorAvatar || (cm.authorId && _avById[cm.authorId]) || _avByName[cm.author] || ('https://i.pravatar.cc/150?u=' + (cm.authorId || cm.author || cm.id)));
    const name = cm.author || _t('익명', 'Anonymous');
    return `<div class="comment-sheet-item" data-cm-id="${cm.id}">
      <img class="comment-sheet-av" src="${av}" alt="" loading="lazy">
      <div class="comment-sheet-body">
        <div class="comment-sheet-meta"><span class="comment-sheet-name">${esc(name)}</span> <span class="comment-sheet-time">${_threadTimeAgo(cm.createdAt)}</span></div>
        <div class="comment-sheet-text">${esc(cm.text || '')}</div>
      </div>
      ${isMine ? `<button class="comment-sheet-del" type="button" onclick="_commentSheetDelete('${note.id}','${cm.id}')" aria-label="${_t('삭제', 'Delete')}"><i class="ri-close-line"></i></button>` : ''}
    </div>`;
  }).join('');
}
window.openCommentSheet = function (noteId) {
  if (!noteId) return;
  const db = window.DB.get();
  const note = (db.notes || []).find(n => n && n.id === noteId);
  if (!note) { if (typeof showToast === 'function') showToast(_t('글을 찾을 수 없어요', 'Post not found')); return; }
  const me = window.__currentUser || db.currentUser || null;
  const myId = me && me.id;
  const myAvatar = (me && (me.avatar_url || me.avatar)) || ('https://i.pravatar.cc/150?u=' + (myId || 'guest'));
  closeCommentSheet(true);
  const backdrop = document.createElement('div');
  backdrop.id = 'comment-sheet-backdrop'; backdrop.className = 'comment-sheet-backdrop';
  backdrop.onclick = () => closeCommentSheet();
  const sheet = document.createElement('div');
  sheet.id = 'comment-sheet'; sheet.className = 'comment-sheet';
  sheet.dataset.noteId = noteId;
  sheet.innerHTML = `
    <div class="comment-sheet-grab"></div>
    <div class="comment-sheet-head">${_i18n('댓글', 'Comments')} <span class="comment-sheet-count" id="comment-sheet-count">${(note.comments || []).length}</span>
      <button class="comment-sheet-close" type="button" onclick="closeCommentSheet()" aria-label="${_t('닫기', 'Close')}"><i class="ri-close-line"></i></button>
    </div>
    <div class="comment-sheet-list" id="comment-sheet-list">${_commentSheetListHtml(note, myId, myAvatar)}</div>
    ${me ? `
    <div class="comment-sheet-inputbar">
      <img class="comment-sheet-myav" src="${myAvatar}" alt="">
      <input class="comment-sheet-input" id="comment-sheet-input" type="text" maxlength="500" placeholder="${_t('댓글 달기…', 'Add a comment…')}"
             onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault(); submitCommentSheet('${noteId}');}">
      <button class="comment-sheet-send" type="button" onclick="submitCommentSheet('${noteId}')">${_i18n('게시', 'Post')}</button>
    </div>` : `<div class="comment-sheet-loginhint">${_t('로그인하면 댓글을 남길 수 있어요', 'Sign in to comment')}</div>`}`;
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  // 아래→위 슬라이드 인
  requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });
  // 아래로 스와이프 닫기 (리스트가 맨 위일 때만 — 스크롤 우선)
  try {
    if (window._attachSwipeDismiss) window._attachSwipeDismiss(sheet, {
      direction: 'down', scrollGuard: '#comment-sheet-list', backdrop,
      onClose: () => closeCommentSheet(true)
    });
  } catch (_) {}
  // 백그라운드로 서버 댓글 최신화 후 리스트만 교체
  if (window.Walls && window.Walls.fetchComments) {
    window.Walls.fetchComments(noteId).then(fresh => {
      if (!Array.isArray(fresh) || !document.getElementById('comment-sheet')) return;
      const _db = window.DB.get(); const n = (_db.notes || []).find(x => x.id === noteId);
      if (n) { n.comments = fresh; try { window.DB.save(_db); } catch (_) {} }
      const listEl = document.getElementById('comment-sheet-list');
      const cntEl = document.getElementById('comment-sheet-count');
      if (listEl) listEl.innerHTML = _commentSheetListHtml({ id: noteId, comments: fresh }, myId, myAvatar);
      if (cntEl) cntEl.textContent = fresh.length;
      _updateFeedCommentCount(noteId, fresh.length);
    }).catch(e => console.warn('[commentSheet] fetch', e));
  }
};
window.closeCommentSheet = function (immediate) {
  const sheet = document.getElementById('comment-sheet');
  const bd = document.getElementById('comment-sheet-backdrop');
  if (!sheet && !bd) return;
  if (immediate) { if (sheet) sheet.remove(); if (bd) bd.remove(); return; }
  if (sheet) sheet.classList.remove('show');
  if (bd) bd.classList.remove('show');
  setTimeout(() => { if (sheet) sheet.remove(); if (bd) bd.remove(); }, 300);
};
window._updateFeedCommentCount = function (noteId, count) {
  if (count == null) return;
  document.querySelectorAll('.thread-post[data-note-id="' + noteId + '"] .tp-act').forEach(b => {
    const icon = b.querySelector('.ri-chat-3-line');
    if (icon) b.innerHTML = icon.outerHTML + (count ? ' ' + count : '');
  });
};
window.submitCommentSheet = async function (noteId) {
  const me = window.__currentUser || (window.DB.get().currentUser);
  if (!me) { alert('로그인이 필요해요'); return; }
  const input = document.getElementById('comment-sheet-input');
  const text = (input && input.value || '').trim();
  if (!text) return;
  const btn = document.querySelector('#comment-sheet .comment-sheet-send');
  if (btn) btn.disabled = true;
  try {
    let newCm = null;
    if (window.Walls && window.Walls.addComment) newCm = await window.Walls.addComment(noteId, { text });
    else newCm = { id: 'c' + Date.now(), author: me.name, authorId: me.id, text, createdAt: new Date().toISOString() };
    // db.notes + __wallNotes 미러 (submitInlineComment 패턴 — 즉시 보이게).
    const db = window.DB.get(); const n = (db.notes || []).find(x => x.id === noteId);
    if (n) { if (!Array.isArray(n.comments)) n.comments = []; if (newCm && !n.comments.find(c => c.id === newCm.id)) n.comments.push(newCm); try { window.DB.save(db); } catch (_) {} }
    if (Array.isArray(window.__wallNotes)) { const mem = window.__wallNotes.find(x => x.id === noteId); if (mem) { if (!Array.isArray(mem.comments)) mem.comments = []; if (newCm && !mem.comments.find(c => c.id === newCm.id)) mem.comments.push(newCm); } }
    if (input) input.value = '';
    const note = (window.DB.get().notes || []).find(x => x.id === noteId);
    const myId = me.id, myAvatar = me.avatar_url || me.avatar || ('https://i.pravatar.cc/150?u=' + myId);
    const listEl = document.getElementById('comment-sheet-list');
    if (listEl && note) listEl.innerHTML = _commentSheetListHtml(note, myId, myAvatar);
    const cntEl = document.getElementById('comment-sheet-count'); if (cntEl && note) cntEl.textContent = (note.comments || []).length;
    _updateFeedCommentCount(noteId, note ? (note.comments || []).length : null);
    if (listEl) listEl.scrollTop = listEl.scrollHeight;   // 최신 댓글로
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
  } finally { if (btn) btn.disabled = false; }
};
window._commentSheetDelete = async function (noteId, cmId) {
  if (!confirm('이 댓글을 지울까요?')) return;
  try {
    if (window.Walls && window.Walls.deleteComment && _UUID_CM.test(cmId)) {
      try { await window.Walls.deleteComment(cmId, noteId); } catch (e) { console.warn('[commentSheet] del', e); }
    }
    const db = window.DB.get(); const n = (db.notes || []).find(x => x.id === noteId);
    if (n && Array.isArray(n.comments)) { n.comments = n.comments.filter(c => c.id !== cmId); try { window.DB.save(db); } catch (_) {} }
    if (Array.isArray(window.__wallNotes)) { const mem = window.__wallNotes.find(x => x.id === noteId); if (mem && Array.isArray(mem.comments)) mem.comments = mem.comments.filter(c => c.id !== cmId); }
    const note = (window.DB.get().notes || []).find(x => x.id === noteId);
    const me = window.__currentUser || {}; const myId = me.id, myAvatar = me.avatar_url || me.avatar || ('https://i.pravatar.cc/150?u=' + myId);
    const listEl = document.getElementById('comment-sheet-list'); if (listEl) listEl.innerHTML = _commentSheetListHtml(note || { comments: [] }, myId, myAvatar);
    const cntEl = document.getElementById('comment-sheet-count'); if (cntEl) cntEl.textContent = note ? (note.comments || []).length : 0;
    _updateFeedCommentCount(noteId, note ? (note.comments || []).length : 0);
  } catch (e) { alert('삭제 실패: ' + (e.message || e)); }
};

// ===================== 아티스트 페이지 — 단일 스크롤 테스트 레이아웃 =====================
// 최신 데모(위, 크게) + 음원 더보기 + 앨범(데모) 나열 + 주절주절 피드. window.renderArtistTestLayout()
window.renderArtistTestLayout = function () {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const db = window.DB.get();
  const me = window.__currentUser || db.currentUser || {};
  const artist = { name: me.name || '주형', avatar: me.avatar || 'https://i.pravatar.cc/150?u=artisttest', bio: '베드룸 프로듀서 · 새 데모 자주 올려요 🎧' };
  const rawTracks = (db.tracks || []).slice(0, 6);
  const titles = ['한밤의 드라이브', 'Plastic Days', '여름 끝', '새벽 4시', 'Painkiller', '그루브 따리'];
  const albums = (rawTracks.length ? rawTracks : [0, 1, 2, 3, 4]).map((t, i) => ({
    id: (t && t.id) || ('atl' + i),
    title: (t && t.title) || titles[i % titles.length],
    cover: (t && t.cover) || ('https://picsum.photos/seed/atlalb' + i + '/300'),
    meta: 'Demo ' + ((i % 3) + 1)
  }));
  const latest = albums[0] || { id: 'x', title: titles[0], cover: 'https://picsum.photos/seed/atlalb0/300', meta: 'Demo 2' };
  const sampleTrack = { id: latest.id, title: latest.title, artist: artist.name, cover: latest.cover };
  const feedPosts = [
    { id: 'f1', name: artist.name, avatar: artist.avatar, time: '2시간', text: '새 데모 「' + latest.title + '」 올렸어요 🎧 들어봐요', image: null, track: sampleTrack, likes: 88, comments: 12 },
    { id: 'f2', name: artist.name, avatar: artist.avatar, time: '어제', text: '작업실에서 📸', image: 'https://picsum.photos/seed/atlstudio/600/420', track: null, likes: 42, comments: 5 },
    { id: 'f3', name: artist.name, avatar: artist.avatar, time: '3일', text: '요즘 영감 받는 무드', image: 'https://picsum.photos/seed/atlmood/600/600', track: sampleTrack, likes: 130, comments: 24 },
  ];
  appContent.innerHTML = `
    <div class="atl-page">
      <div class="atl-header">
        <img class="atl-avatar" src="${artist.avatar}" alt="">
        <div class="atl-head-info">
          <div class="atl-name">${esc(artist.name)}</div>
          <div class="atl-bio">${esc(artist.bio)}</div>
        </div>
        <button class="atl-follow" type="button"><i class="ri-user-add-line"></i> 팔로우</button>
      </div>

      <div class="atl-section-head">
        <div class="atl-section-title"><i class="ri-fire-fill" style="color:#ff6b6b;"></i> 최신 데모</div>
      </div>
      <div class="atl-hero" onclick="playTrack('${latest.id}','wall')">
        <img class="atl-hero-cover" src="${latest.cover}" alt="">
        <div class="atl-hero-info">
          <span class="atl-hero-badge">${esc(latest.meta)}</span>
          <div class="atl-hero-title">${esc(latest.title)}</div>
          <div class="atl-hero-sub">${esc(artist.name)}</div>
          <div class="atl-hero-actions">
            <button class="atl-hero-play" type="button" onclick="event.stopPropagation(); playTrack('${latest.id}','wall')" aria-label="재생"><i class="ri-play-fill"></i></button>
            <span class="atl-hero-stat"><i class="ri-heart-3-line"></i> 88</span>
            <span class="atl-hero-stat"><i class="ri-chat-3-line"></i> 12</span>
          </div>
        </div>
      </div>

      <div class="atl-section-head">
        <div class="atl-section-title"><i class="ri-album-fill" style="color:var(--brand-color);"></i> 음악</div>
        <button class="atl-more-btn" type="button" onclick="showToast && showToast(_t('전체 음악 보기 (테스트)', 'View all music (test)'))">음원 더보기 <i class="ri-arrow-right-s-line"></i></button>
      </div>
      <div class="atl-albums">
        ${albums.map(a => `
          <div class="atl-album" onclick="playTrack('${a.id}','wall')">
            <img class="atl-album-cover" src="${a.cover}" alt="" loading="lazy">
            <div class="atl-album-title">${esc(a.title)}</div>
            <div class="atl-album-meta">${esc(a.meta)}</div>
          </div>`).join('')}
      </div>

      <div class="atl-divider"></div>
      <div class="atl-feed-head"><i class="ri-chat-smile-2-line" style="color:var(--brand-color);"></i> 주절주절</div>
      <div class="thread-composer" onclick="openThreadComposer()">
        <img class="thread-avatar" src="${artist.avatar}" alt="">
        <div class="thread-composer-hint">무슨 생각 중이에요? · 노래·사진 올리기</div>
        <button class="thread-composer-go" type="button" aria-label="새 글"><i class="ri-add-line"></i></button>
      </div>
      ${feedPosts.map(_threadPostHtml).join('')}
    </div>`;
};

// ===================== 앨범(데모) 페이지 — 데모 하나당 한 페이지 (테스트) =====================
// window.renderAlbumTest(trackId) — 아티스트 페이지의 앨범 카드 → 이 페이지로 들어옴.
// 앨범 페이지 공유 렌더러 — 히어로 + 데모폼(renderProjectBox) + 소개 + 가사.
//   t = 대표 트랙(히어로/소개/가사), versions = 프로젝트의 모든 버전(데모폼), pid = projectId.
function _renderAlbumView(appContent, d) {
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const t = d.t, artistName = d.artistName, tags = d.tags || [], songTitle = d.songTitle,
        note = d.note || '', lyrics = d.lyrics || '', versions = d.versions || [], pid = d.pid;
  const cover = t.cover || 'https://picsum.photos/seed/albcover/500';
  let projectBoxHtml = '';
  try {
    // 'reveal'(스크롤 진입 애니메이션)이 IntersectionObserver 미발화 시 opacity:0 으로 숨으므로 제거.
    projectBoxHtml = renderProjectBox(pid, versions).replace('project-box reveal', 'project-box');
  } catch (e) { console.warn('[album] renderProjectBox', e); projectBoxHtml = `<div class="alb2-card">${_i18n('데모를 불러오지 못했어요', 'Failed to load demos')}</div>`; }
  appContent.innerHTML = `
    <div class="artist-canvas cosmic">
      <div class="artist-bg-deco"></div>
      <div class="sub-page">
        <div class="alb2-wrap">
          <button class="alb2-back" type="button" onclick="(window.history.length>1)?history.back():navigateTo('artist:'+encodeURIComponent('${esc(artistName)}'))" aria-label="${_t('뒤로', 'Back')}"><i class="ri-arrow-left-line"></i></button>

          <!-- 위: 히어로 (커버 + 제목 + 아티스트 + 스탯) -->
          <div class="alb2-hero">
            <img class="alb2-cover" src="${cover}" alt="" draggable="false">
            <div class="alb2-head">
              <span class="alb2-badge">${esc(t.versionLabel || (t.isDemo === false ? 'MASTER' : 'DEMO'))}</span>
              <h1 class="alb2-title">${esc(songTitle)}</h1>
              <div class="alb2-artist" onclick="navigateTo('artist:'+encodeURIComponent('${esc(artistName)}'))">— ${esc(artistName)}</div>
              <div class="alb2-stats">❤ <span class="alb2-likecount" data-track-id="${t.id}">${(typeof isTrackLiked === 'function' && isTrackLiked(t.id)) ? 1 : 0}</span> · ▶ ${(t.plays || 0).toLocaleString()} ${_i18n('재생', 'plays')}${t.createdAt ? ` · <i class="ri-calendar-line" style="font-size:0.92em;"></i> ${formatFullDate(t.createdAt)} ${_i18n('업로드', 'uploaded')}` : ''}</div>
            </div>
          </div>

          <div class="alb2-actions">
            <button class="alb2-play" type="button" onclick="playTrack('${t.id}','wall')"><i class="ri-play-fill"></i> ${_i18n('재생', 'Play')}</button>
            <button class="alb2-chip${(typeof isTrackLiked === 'function' && isTrackLiked(t.id)) ? ' is-on' : ''}" type="button" onclick="_albumToggleHeart('${t.id}', this)" aria-label="${_t('좋아요·담기', 'Like & Save')}" title="${_t('좋아요 · 즐겨찾기에 담기', 'Like & save to favorites')}"><i class="${(typeof isTrackLiked === 'function' && isTrackLiked(t.id)) ? 'ri-heart-3-fill' : 'ri-heart-3-line'}"></i></button>
            <button class="alb2-chip" type="button" aria-label="${_t('공유', 'Share')}" onclick="_albumShare()"><i class="ri-send-plane-line"></i></button>
          </div>
          ${tags.length ? `<div class="alb2-tags">${tags.map(tg => `<span class="alb2-tag">#${esc(tg)}</span>`).join('')}</div>` : ''}

          <!-- 마스터 + 데모 (projects-grid → 흰 박스 없음 + PC 가로 필름스트립 / 모바일 스네이크) -->
          <div class="alb2-projectbox projects-grid">${projectBoxHtml}</div>

          <div id="alb2-about-section">
            <h2 class="section-title"><i class="ri-quill-pen-line"></i> ${_i18n('소개', 'About')}</h2>
            ${note ? _collapsible(note, 'alb2-card') : `<div class="alb2-card alb2-card-empty">${_i18n('아직 소개가 없어요', 'No description yet')}</div>`}
          </div>
          <h2 class="section-title"><i class="ri-double-quotes-l"></i> ${_i18n('가사', 'Lyrics')}</h2>
          ${lyrics ? _collapsible(lyrics, 'alb2-card lyrics') : `<div class="alb2-card lyrics alb2-card-empty">${_i18n('아직 가사가 없어요', 'No lyrics yet')}</div>`}
        </div>
      </div>
    </div>`;

  // 마스터 미발매(「Coming Soon」) 카드 — 작은 'Coming Soon' 부제를 '곡 소개'로 교체(중복 'Coming Soon' 줄임, 사용자 요청).
  // 소개가 마스터 카드로 올라가므로 아래 '소개' 섹션은 숨김(중복 방지). 발매(master)면 부제=아티스트라 그대로 둠.
  try {
    const subEl = appContent.querySelector('.alb2-projectbox .project-header .project-artist-line');
    if (subEl && /coming\s*soon/i.test(subEl.textContent || '')) {
      subEl.textContent = note || _t('곧 공개돼요', 'Coming soon');
      subEl.classList.add('alb2-master-sub');
      const aboutEl = appContent.querySelector('#alb2-about-section');
      if (aboutEl && note) aboutEl.style.display = 'none';
    }
  } catch (_) {}
}

// 앨범 페이지 ♥ — 곡을 내 우주에 담기(track_favorites/CollectedTracks). 칩 스타일(is-on/ri-heart-3)을
// 유지하려고 toggleTrackHeart 에 btn=null 을 넘겨 저장만 시키고, 칩 표시는 여기서 직접 갱신.
window._albumToggleHeart = function (trackId, btnEl) {
  const db = window.DB.get();
  if (!db.currentUser) { alert(_t('로그인 후 이용 가능합니다', 'Sign in first')); navigateTo('auth'); return; }
  const willLike = (typeof isTrackLiked === 'function') ? !isTrackLiked(trackId) : true;
  if (btnEl) {
    btnEl.classList.toggle('is-on', willLike);
    const ic = btnEl.querySelector('i'); if (ic) ic.className = willLike ? 'ri-heart-3-fill' : 'ri-heart-3-line';
  }
  // 히어로 ♥ 카운트도 담김 상태 기반(0/1)으로 동기화 — track.likes 로컬증가의 새로고침 깜빡임 방지.
  try {
    const sel = '.alb2-likecount[data-track-id="' + ((window.CSS && CSS.escape) ? CSS.escape(trackId) : trackId) + '"]';
    document.querySelectorAll(sel).forEach(el => { el.textContent = willLike ? 1 : 0; });
  } catch (_) {}
  if (typeof showToast === 'function') showToast(willLike ? _t('💚 좋아요 · 즐겨찾기에 담았어요', 'Liked & saved to favorites') : _t('즐겨찾기에서 뺐어요', 'Removed from favorites'));
  if (typeof toggleTrackHeart === 'function') toggleTrackHeart(trackId, null);
};
// 앨범 페이지 공유 — 현재 앨범 페이지 URL 그대로 공유(시스템 공유 없으면 클립보드 복사).
window._albumShare = function () {
  try {
    const url = location.href;
    if (navigator.share) { navigator.share({ url }).catch(() => {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(url); if (typeof showToast === 'function') showToast(_t('링크 복사됐어요', 'Link copied')); }
  } catch (_) {}
};

// 실데이터 앨범 페이지 — pid = projectId 또는 'proj_'+trackId(싱글). 라우트 'album:<pid>' 가 호출.
window.renderAlbum = function (pid) {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  if (typeof pid === 'string' && pid.indexOf('%') >= 0) { try { pid = decodeURIComponent(pid); } catch (_) {} }
  const db = window.DB.get();
  let versions = (db.tracks || []).filter(t => t && (t.projectId || ('proj_' + t.id)) === pid);
  if (!versions.length) { const single = (db.tracks || []).find(t => t && t.id === pid); if (single) versions = [single]; }
  if (!versions.length) {
    appContent.innerHTML = `<div class="artist-canvas cosmic"><div class="artist-bg-deco"></div><div class="sub-page"><div class="alb2-wrap"><button class="alb2-back" type="button" onclick="history.back()"><i class="ri-arrow-left-line"></i></button><div class="alb2-card" style="margin-top:14px;">${_i18n('앨범을 찾을 수 없어요.', 'Album not found.')}</div></div></div></div>`;
    return;
  }
  const master = versions.find(v => !v.isDemo);
  const sorted = versions.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const rep = master || sorted[0];
  _renderAlbumView(appContent, {
    t: rep,
    artistName: rep.artist || '',
    tags: (Array.isArray(rep.tags) && rep.tags.length) ? rep.tags : [],
    songTitle: (rep.title || '제목 없음').replace(/\s*\(Demo.*\)$/i, ''),
    note: (rep.artistNote || rep.description || '').trim(),
    lyrics: (rep.lyrics || '').trim(),
    versions,
    pid
  });
};

// 목업 앨범 페이지(프리뷰 테스트용) — 실데이터 없이 레이아웃 확인.
window.renderAlbumTest = function (trackId) {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  const db = window.DB.get();
  let t = (db.tracks || []).find(x => x && x.id === trackId);
  if (!t) t = {
    id: 'albdemo', title: '한밤의 드라이브', artist: '주형', cover: 'https://picsum.photos/seed/albcover/500',
    versionLabel: 'Demo 2', artistNote: '새벽 4시에 작업한 곡이에요. 드라이브하면서 들으면 딱 좋아요 🚗💨\n아직 미완성이라 피드백 환영!',
    tags: ['시티팝', '새벽', '드라이브'], likes: 88, plays: 1234
  };
  const artistName = t.artist || '주형';
  const songTitle = (t.title || '제목 없음').replace(/\s*\(Demo.*\)$/i, '');
  const cover = t.cover || 'https://picsum.photos/seed/albcover/500';
  const _pid = 'albtestpid';
  const _now = Date.now();
  const mkV = (ver, label, daysAgo, vnote) => ({
    id: _pid + '_' + ver, projectId: _pid, title: songTitle, artist: artistName, cover,
    version: ver, versionLabel: label, isDemo: ver !== 'final',
    createdAt: new Date(_now - daysAgo * 86400000).toISOString(),
    artistNote: vnote || '', trackComments: [], likes: 0, plays: 0, lines: []
  });
  const versions = [
    mkV('final', 'Master', 0, ''),
    mkV('demo1', 'Demo 1', 24, '첫 스케치 — 멜로디만 흥얼거림.'),
    mkV('demo2', 'Demo 2', 17, '코드 진행 추가, 벌스 구성.'),
    mkV('demo3', 'Demo 3', 9, '드럼·베이스 입히고 훅 다듬음.'),
    mkV('demo4', 'Demo 4', 3, '믹스 1차 + 보컬 가이드 녹음. 곧 마스터!')
  ];
  _renderAlbumView(appContent, {
    t, artistName, songTitle,
    tags: (Array.isArray(t.tags) && t.tags.length) ? t.tags : ['시티팝', '새벽', '드라이브'],
    note: (t.artistNote || t.description || '새벽에 작업한 데모예요.').trim(),
    lyrics: (t.lyrics || '').trim() || '네온사인 흐르는 거리\n창문을 내리고 달려\n오늘 밤은 끝나지 않아\n우리 둘만의 드라이브',
    versions, pid: _pid
  });
};

// 레거시 포스트잇 벽 — 주절주절을 스레드 피드로 교체하면서 보존(되돌리기용). 라우트에서 호출 안 함.
async function renderWallLegacy() {
  const db = window.DB.get();
  // Refresh wall notes from Supabase. Strategy:
  //   - First visit (empty cache): wait up to 1.5s for data, then render whatever we have
  //   - Subsequent visits: render instantly with cache, fire refresh in background, re-render on completion
  // Prevents a stuck blank screen when Supabase is slow or unreachable.
  if (window.Walls && window.Walls.refreshInto) {
    const hasCache = Array.isArray(db.notes) && db.notes.length > 0;
    if (hasCache) {
      // Snapshot what we're rendering now; only re-render later if Supabase returns *different* data.
      // Without this guard, an instant refresh resolve would trigger infinite recursion.
      const beforeIds = (db.notes || []).map(n => n.id).join('|');
      window.Walls.refreshInto(db).then(() => {
        if (currentView !== 'wall') return;
        const afterIds = (window.DB.get().notes || []).map(n => n.id).join('|');
        if (afterIds !== beforeIds) renderWall();
      }).catch(e => console.warn('[wall] bg refresh', e));
    } else {
      try {
        await Promise.race([
          window.Walls.refreshInto(db).catch(e => console.warn('[wall] refresh', e)),
          new Promise(r => setTimeout(r, 1500))
        ]);
      } catch (_) {}
      // User may have navigated away during the wait — don't clobber their new page
      if (currentView !== 'wall') return;
    }
  }
  const allNotes = db.notes || [];
  const user = db.currentUser || window.__currentUser;
  const colorKeys = Object.keys(NOTE_COLORS);

  // Filter by search
  const q = _wallSearch.trim().toLowerCase();
  let filtered = allNotes;
  if (q) {
    filtered = allNotes.filter(n =>
      (n.text || '').toLowerCase().includes(q) ||
      (n.author || '').toLowerCase().includes(q)
    );
  }

  // Sort. Use note id as a tiebreaker so iteration order — and therefore the
  // grid cell each note lands in — is identical on every reload.
  const _idCmp = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (_wallSort === 'new') {
    filtered = [...filtered].sort((a, b) => {
      const d = new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return d !== 0 ? d : _idCmp(a, b);
    });
  } else if (_wallSort === 'old') {
    filtered = [...filtered].sort((a, b) => {
      const d = new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      return d !== 0 ? d : _idCmp(a, b);
    });
  } else {
    filtered = [...filtered].sort(_idCmp);
  }

  // Paginate
  const total = filtered.length;
  const shown = Math.min(_wallPage * _WALL_PAGE_SIZE, total);
  const visibleNotes = filtered.slice(0, shown);
  const hasMore = total > shown;

  // Scatter notes — responsive column count so post-its don't overflow
  // on narrow viewports.
  const _vw = (typeof window !== 'undefined' ? window.innerWidth : 1024) || 1024;
  const cols = _vw < 800 ? 1 : (_vw < 1200 ? 2 : 4);
  // 📱 모바일 — 도형처럼 사방에 흩뿌림 (그리드 X). 최신이 맨 위 + 앞으로 오게.
  //    카드를 작게(아래 CSS) + 세로로 겹쳐 쌓되 가로로 흩어 'wall' 느낌.
  const _isMobileWall = _vw <= 700;
  const _MOBI_STEP = 168;                  // 카드 세로 겹침 간격 (카드보다 작게 → 겹침)
  // Each note can now grow tall with inline comments + input — give rows more vertical room.
  // Also expand for any user-dragged positions that sit below the default grid.
  let _maxSavedY = 0;
  for (const _n of visibleNotes) {
    try {
      const _raw = localStorage.getItem('wallpos:' + _n.id);
      if (!_raw) continue;
      const _p = JSON.parse(_raw);
      if (_p && typeof _p.yPx === 'number' && _p.yPx > _maxSavedY) _maxSavedY = _p.yPx;
    } catch (_) {}
  }
  const boardH = _isMobileWall
    ? Math.max(620, 90 + visibleNotes.length * _MOBI_STEP + 340, _maxSavedY + 360)
    : Math.max(820, Math.ceil(visibleNotes.length / cols) * 390 + 300, _maxSavedY + 420);

  // Helper: escape user text for HTML
  const _esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 위치 시드에 보는 사람 ID를 끼워, 사용자마다 기본 배치가 달라지게.
  // 본인이 드래그한 건 localStorage 에 저장되어 본인 기기에서만 적용됨.
  const _viewerSeed = (window.__currentUser && window.__currentUser.id)
                   || (user && user.name)
                   || 'anon';

  let notesHtml = visibleNotes.map((note, i) => {
    const c = NOTE_COLORS[note.color] || NOTE_COLORS.yellow;
    // Seeded jitter — different per-viewer so each user sees their own arrangement
    const seed = _hashSeed(_viewerSeed + ':' + note.id);
    const rot = note.rotation != null ? note.rotation : ((((seed >>> 2) % 60) - 30) / 10);
    // 일기 톤 분리 — 첫 줄을 제목, 나머지를 본문으로 (사용자 요청)
    const _raw = note.text || '';
    const _nl = _raw.indexOf('\n');
    let _ttl = '', _bdy = '';
    if (_nl > 0) { _ttl = _raw.slice(0, _nl).trim(); _bdy = _raw.slice(_nl + 1); }
    else if (_raw.length <= 40) { _ttl = _raw.trim(); _bdy = ''; }
    else { _ttl = ''; _bdy = _raw; }
    const safeTitleCard = _esc(_ttl);
    const safeBodyCard  = _esc(_bdy).replace(/\n/g,'<br>');
    const safeText = _esc(_raw).replace(/\n/g,'<br>');    // legacy fallback
    const safeAuthor = _esc(note.author);
    const isOwner = user && user.name === note.author;
    const deleteBtn = isOwner ? `<button class="note-delete" onclick="event.stopPropagation(); deleteWallNote('${note.id}')" title="삭제"><i class="ri-close-line"></i></button>` : '';

    const col = i % cols;
    const row = Math.floor(i / cols);
    // x is a % so post-its scale with the viewport. Column spacing depends
    // on how many cols we picked above.
    let x, yPx;
    // 최신이 맨 위 + 앞으로 — i=0 이 newest(정렬 'new'). z-index 도 높게.
    const zi = Math.max(1, visibleNotes.length - i);
    // Honor any user-curated position saved on drop. Falls back to the seeded
    // grid layout when there's nothing in localStorage (or the parse fails).
    let _savedPos = null;
    try {
      const _raw = localStorage.getItem('wallpos:' + note.id);
      if (_raw) _savedPos = JSON.parse(_raw);
    } catch (_) { _savedPos = null; }
    // 사용자가 드래그해 옮긴 노트 = 고정(부유 멈춤). 아래 class 로 표시.
    const _isFixed = !!(_savedPos && typeof _savedPos.xPct === 'number' && typeof _savedPos.yPx === 'number');
    if (_isFixed) {
      x   = _savedPos.xPct;
      yPx = _savedPos.yPx;
    } else if (_isMobileWall) {
      // 📱 도형처럼 사방 흩뿌림 — 가로는 seed 로 흩어지고(작은 카드라 화면 안),
      //    세로는 index 로 차곡(겹침). 최신(i=0)이 맨 위에서 시작.
      x   = 2 + (seed % 44);                                          // 2-46% (카드 right edge 화면 안)
      yPx = 80 + i * _MOBI_STEP + ((seed >>> 8) % 46);                // 겹치며 아래로
    } else {
      if (cols === 1)      x =  4 + (seed % 8);                       //  4-12%
      else if (cols === 2) x =  4 + col * 46 + (seed % 6);            //  4-10 | 50-56
      else                  x =  2 + col * 22 + (seed % 10);          //  2-12 | 24-34 | 46-56 | 68-78
      yPx = 140 + row * 390 + ((seed >>> 8) % 40);
    }

    const bookmarked = window.Walls && window.Walls.isBookmarked && window.Walls.isBookmarked(note.id);
    const bookmarkBtn = user ? `
      <button class="note-bookmark ${bookmarked ? 'is-bookmarked' : ''}" onclick="event.stopPropagation(); toggleBookmark('${note.id}')" title="수집하기">
        <i class="${bookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line'}"></i>
      </button>
    ` : '';

    // ── Dynamic body/comments split ──────────────────────────────────────
    // 일기 분리 이후라 isClamped 는 BODY 만 기준으로 다시 계산해야 정확.
    // Rough line estimate: serif 14px 에서 카드 320(content) 정도면 약 20자/줄.
    const rawText = note.text || '';
    const explicitBreaks = (rawText.match(/\n/g) || []).length;
    const approxLines = Math.max(1, explicitBreaks + Math.ceil(rawText.length / 22));
    let bodyClamp, previewCount;
    if      (approxLines <= 1) { bodyClamp = 1; previewCount = 4; }
    else if (approxLines <= 2) { bodyClamp = 2; previewCount = 4; }
    else if (approxLines <= 3) { bodyClamp = 3; previewCount = 3; }
    else if (approxLines <= 4) { bodyClamp = 4; previewCount = 2; }
    else if (approxLines <= 5) { bodyClamp = 5; previewCount = 2; }
    else                        { bodyClamp = 6; previewCount = 1; }
    // 실제 본문(제목 제외) 의 줄수가 visible clamp 보다 길면 잘림 = 더보기 노출.
    const _bodyText = _bdy || (_ttl ? '' : _raw);
    const _bodyBreaks = (_bodyText.match(/\n/g) || []).length;
    const _bodyLines = _bodyText
      ? Math.max(1, _bodyBreaks + Math.ceil(_bodyText.length / 20))
      : 0;
    const _bodyVisible = Math.max(2, bodyClamp - (_ttl ? 1 : 0));
    const isClamped = _bodyLines > _bodyVisible;

    // 댓글 티저 — 카드 맨 아래에 최근 댓글 최대 2개 미리보기.
    // 'ㄴ "댓글…"' 한 줄씩, 3개 이상이면 마지막에 작은 '+N개 더' 표시.
    const allComments = Array.isArray(note.comments) ? note.comments : [];
    const _ctClip = (s, n) => {
      s = (s || '').replace(/\n/g, ' ');
      return s.length > n ? s.slice(0, n) + '…' : s;
    };
    const previewComments = allComments.slice(-2);   // 최근 2개 (오래된 순)
    const moreCount = Math.max(0, allComments.length - previewComments.length);
    const commentsTeaser = !previewComments.length ? '' : `
      <div class="note-comments-teaser" onclick="event.stopPropagation(); openNoteDetail('${note.id}')" title="댓글 보기">
        ${previewComments.map(c => `
          <div class="ct-line">
            <span class="ct-arrow">ㄴ</span>
            <span class="ct-preview">"${_esc(_ctClip(c.text, 22))}"</span>
          </div>
        `).join('')}
        ${moreCount > 0 ? `<div class="ct-more">+${moreCount}</div>` : ''}
      </div>
    `;

    // 포스트잇에 첨부된 노래 칩 — 오른쪽 아래 보내기(✈) 버튼 옆에 작게 둔다.
    const trackChip = _renderNoteTrackChip(note);

    // 인라인 입력칸 제거 (사용자 요청) — 카드가 지저분해 보여서.
    // 댓글은 카드 클릭 → 모달 열고 거기서만 작성. 메인 그리드는 보기 전용.
    const inlineForm = '';

    // 작성 날짜 — 왼쪽 위에 작게 표시 (YYYY년 M월 D일 형식)
    const _wallDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    };
    const dateStr = _wallDate(note.createdAt || note.created_at);
    const dateChip = dateStr ? `<div class="note-date">${dateStr}</div>` : '';
    return `
      <div class="wall-note wall-note-diary${_isFixed ? ' wall-fixed' : ''}" data-note-id="${note.id}" data-author="${safeAuthor}" style="background:${c.bg}; color:${c.text}; left:${x}%; top:${yPx}px; z-index:${zi};" title="낙서·댓글 보기">
        ${dateChip}
        ${deleteBtn}
        ${bookmarkBtn}
        ${safeTitleCard ? `<h3 class="note-card-title">${safeTitleCard}</h3>` : ''}
        ${safeBodyCard
          ? `<div class="note-card-body" style="-webkit-line-clamp:${Math.max(2, bodyClamp - (safeTitleCard ? 1 : 0))};">${safeBodyCard}</div>`
          : (!safeTitleCard ? `<div class="note-card-body" style="-webkit-line-clamp:${bodyClamp};">${safeText}</div>` : '')
        }
        ${isClamped ? `<button class="note-more-text" onclick="event.stopPropagation(); openNoteDetail('${note.id}');">더보기</button>` : ''}
        <div class="note-bottom">
          ${commentsTeaser}
          ${inlineForm}
          <div class="note-meta-row">
            <div class="note-author">${safeAuthor}</div>
            ${trackChip}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Write composer — 텍스트 입력 + 노래 첨부 + 남기기 버튼.
  // (Enter는 줄바꿈으로 자유롭게 쓰게 두고, '남기기' 버튼만 클릭으로 전송)
  const writeComposer = user ? `
    <!-- PC 백드롭 — 모달처럼 가운데로 띄울 때 뒤를 어둡게 -->
    <div class="wall-compose-backdrop" id="wall-compose-backdrop" hidden onclick="toggleWallCompose()"></div>
    <div class="wall-compose-panel" id="wall-compose-panel" hidden>
      <!-- 닫기 — PC 모달 모드에서 보임. 모바일은 hidden 으로. -->
      <button type="button" class="wall-compose-close" onclick="toggleWallCompose()" aria-label="닫기">
        <i class="ri-close-line"></i>
      </button>
      <input type="text" id="wall-title" class="form-control wall-compose-title" placeholder="${_t('제목 (선택)', 'Title (optional)')}" maxlength="50"
        style="margin-bottom:12px; font-weight:800; font-size:22px;">
      <textarea id="wall-text" class="form-control wall-compose-body" rows="6" placeholder="${_t('하고 싶은 말을 자유롭게', 'Say anything you like')}"
        style="resize:vertical; margin-bottom:14px; font-size:16px; line-height:1.6; min-height:160px;"></textarea>
      <!-- Attached song preview (hidden until a track or URL is picked) -->
      <div id="wall-attach-preview" class="wall-attach-preview" hidden></div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="display:flex; gap:6px;" id="wall-color-picker">
          ${colorKeys.map((key,i) => `<button class="color-dot ${i===0?'active':''}" data-color="${key}" style="background:${NOTE_COLORS[key].bg}; border:2px solid ${NOTE_COLORS[key].border};" onclick="document.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('active')); this.classList.add('active');"></button>`).join('')}
        </div>
        <button type="button" class="wall-attach-btn" onclick="openSongAttacher()" title="${_t('노래 첨부', 'Attach a song')}"><i class="ri-music-2-fill"></i> ${_i18n('노래', 'Song')}</button>
        <button class="btn-primary" onclick="submitWallNote()" style="margin-left:auto; padding:8px 18px; font-size:13px;">${_i18n('남기기 📌', 'Post 📌')}</button>
      </div>
    </div>
  ` : '';

  const writeFab = user
    ? `<button class="wall-fab" onclick="toggleWallCompose()" title="${_t('벽에 남기기', 'Post to the wall')}"><i class="ri-add-line"></i> ${_i18n('남기기', 'Post')}</button>`
    : `<button class="wall-fab" onclick="navigateTo('auth')" title="${_t('로그인하고 글 남기기', 'Sign in to post')}"><i class="ri-login-box-line"></i> ${_i18n('로그인', 'Sign in')}</button>`;

  // Mobile-only floating search button — hidden on desktop via CSS.
  // Tap it to slide up the search/sort sheet from the bottom.
  const searchFab = `<button class="wall-search-fab" onclick="toggleWallSearch()" title="검색"><i class="ri-search-line"></i></button>`;

  // 카운트는 page-count 로 분리 (헤더 제목 제거 후 인트로 아래에 가운데 정렬).
  const pageCountInner = q
    ? `"${q}" · <strong>${total}</strong>${_t('개', '')}`
    : _t(`총 <strong>${allNotes.length}</strong>개`, `<strong>${allNotes.length}</strong> notes`);
  const pageCountSuffix = total > 0 && shown < total ? _t(` · 보는 중 ${shown}`, ` · showing ${shown}`) : '';
  const pageCountHtml = `<div class="page-count reveal">${pageCountInner}${pageCountSuffix}</div>`;

  // 검색/정렬 진입 버튼 — 메모가 13개 이상이거나 검색중일 때만 노출.
  // 제목과 카운트가 빠진 자리에서 단독으로 보이도록 우상단에 둠.
  const showAdvancedControls = allNotes.length > 12 || q;
  const toolbar = showAdvancedControls ? `
    <div class="wall-toolbar-v2">
      <button class="wall-toolbtn" onclick="document.getElementById('wall-advanced').hidden = !document.getElementById('wall-advanced').hidden"><i class="ri-search-line"></i></button>
    </div>
    <div class="wall-advanced" id="wall-advanced" ${showAdvancedControls && q ? '' : 'hidden'}>
      <button class="wall-advanced-close" onclick="toggleWallSearch()" title="닫기" aria-label="닫기">
        <i class="ri-close-line"></i>
      </button>
      <div class="wall-search-v2">
        <i class="ri-search-line"></i>
        <input type="text" id="wall-search-input" placeholder="${_t('검색 (내용 / 작성자)', 'Search (text / author)')}" value="${q.replace(/"/g,'&quot;')}"
               oninput="wallSetSearch(this.value)"
               onkeydown="if(event.key==='Enter'){event.target.blur();}">
        ${q ? `<button class="wall-search-clear" onclick="wallSetSearch('')"><i class="ri-close-line"></i></button>` : ''}
      </div>
      <div class="wall-sort-v2">
        <button class="wall-sort-btn ${_wallSort==='new'?'active':''}" onclick="wallSetSort('new')">${_t('최신', 'New')}</button>
        <button class="wall-sort-btn ${_wallSort==='old'?'active':''}" onclick="wallSetSort('old')">${_t('오래된', 'Old')}</button>
        <button class="wall-sort-btn ${_wallSort==='random'?'active':''}" onclick="wallSetSort('random')">${_t('랜덤', 'Random')}</button>
      </div>
    </div>
  ` : '';

  const loadMoreBtn = hasMore ? `
    <div class="wall-load-more">
      <button onclick="wallLoadMore()" class="btn-primary" style="font-size:14px; padding:10px 28px;">
        <i class="ri-arrow-down-line"></i> ${_t(`더 보기 (${total - shown}개 더)`, `Load more (${total - shown} left)`)}
      </button>
    </div>
  ` : '';

  const emptyMsg = total === 0
    ? (q
        ? `<div class="wall-empty">"${q}" 검색 결과가 없어요 🔍</div>`
        : `<div class="wall-empty">${_i18n('아직 아무도 안 적었어.<br>첫 번째가 되어봐! 🖊️', 'No notes yet.<br>Be the first! 🖊️')}</div>`
      )
    : '';

  appContent.innerHTML = `
    <div class="page-intro reveal">${_i18n('게시물을 올려 지금의 기분을 음악과 같이 표현해보세요', 'Post a note and share your mood through music')}</div>
    ${pageCountHtml}
    <div class="wall-board" style="height:${total > 0 ? boardH : 600}px;">
      ${toolbar ? `<div class="wall-header-v2"><div class="wall-title-row">${toolbar}</div></div>` : ''}
      ${writeFab}
      ${searchFab}
      ${writeComposer}
      ${notesHtml}
      ${emptyMsg}
      ${loadMoreBtn}
    </div>
  `;

  initNoteDrag();

  // 업로드 완료 후 넘어온 경우 — 작성창을 곡 첨부된 채로 자동으로 연다.
  if (window.__pendingWallCompose != null && user) {
    const prefill = window.__pendingWallCompose;
    window.__pendingWallCompose = null;
    setTimeout(() => {
      const panel = document.getElementById('wall-compose-panel');
      if (panel && panel.hidden && typeof toggleWallCompose === 'function') toggleWallCompose();
      const ta = document.getElementById('wall-text');
      if (ta) { ta.value = (typeof prefill === 'string') ? prefill : ''; ta.focus(); }
      window.__songAttachTarget = 'wall';
      if (typeof _renderAttachPreview === 'function') _renderAttachPreview();
    }, 80);
  }
}

// Mobile: toggle the search/sort sheet that slides up from the bottom.
// Also focuses the input when opening so the keyboard pops up immediately.
window.toggleWallSearch = function () {
  const panel = document.getElementById('wall-advanced');
  if (!panel) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  if (opening) {
    const input = document.getElementById('wall-search-input');
    if (input) setTimeout(() => input.focus(), 60);
  }
};

window.wallSetSearch = function(val) {
  _wallSearch = val || '';
  _wallPage = 1;
  // debounce for typing
  clearTimeout(window._wallSearchTimer);
  window._wallSearchTimer = setTimeout(() => renderWall(), 180);
};
window.wallSetSort = function(sort) {
  _wallSort = sort;
  _wallPage = 1;
  renderWall();
};
window.wallLoadMore = function() {
  _wallPage++;
  renderWall();
  setTimeout(() => {
    window.scrollTo({ top: document.body.scrollHeight - 600, behavior: 'smooth' });
  }, 100);
};
window.wallResetPage = function() {
  _wallPage = 1;
  renderWall();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// 데모 카드 옆 '+ DEMO N 추가' 빈 포스트잇이 호출 — 그 프로젝트의 다음 데모로 업로드 폼 자동 세팅.
window.quickUploadDemoToProject = function(projectId) {
  if (!projectId) { navigateTo('upload'); return; }
  window.__pendingUploadProjectId   = projectId;
  window.__pendingUploadVersionType = 'demo';
  navigateTo('upload');
};

// 팔로워 별자리 — 본인 페이지에서 ✨ 누르면 풀스크린으로 떠다니는 도형 visualization.
// 각 도형 = 한 명의 팔로워. 누르면 그 사람 페이지로.
window.openFollowerConstellation = async function () {
  const me = window.__currentUser;
  if (!me || !me.id) { alert('로그인이 필요해요.'); return; }
  const old = document.getElementById('constellation-overlay');
  if (old) old.remove();
  // 셸 먼저 띄우기 — 데이터는 비동기로 채움
  const shell = `
    <div id="constellation-overlay" class="constellation-overlay">
      <button class="constellation-close" onclick="closeFollowerConstellation()" aria-label="닫기">
        <i class="ri-close-line"></i> ${_t('닫기', 'Close')}
      </button>
      <div class="constellation-stage" id="constellation-stage">
        <div class="constellation-center">
          <img src="${me.avatar || ('https://i.pravatar.cc/150?u=' + me.id)}" alt="${(me.name||'').replace(/</g,'&lt;')}">
          <div class="constellation-center-name">${(me.name||'').replace(/</g,'&lt;')}</div>
        </div>
        <div class="constellation-loading">${_t('팔로워를 불러오는 중…', 'Loading followers…')}</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', shell);
  document.body.style.overflow = 'hidden';
  let followers = [];
  try {
    followers = (window.Follows && window.Follows.listFollowers)
      ? await window.Follows.listFollowers(me.id, { limit: 60 }) : [];
  } catch (e) { console.warn('[constellation]', e); }
  const stage = document.getElementById('constellation-stage');
  if (!stage) return;
  const loader = stage.querySelector('.constellation-loading');
  if (loader) loader.remove();
  if (!followers.length) {
    stage.insertAdjacentHTML('beforeend',
      `<div class="constellation-empty">${_t('아직 팔로워가 없어요', 'No followers yet')}<br><small>${_t('곡 / 메모를 올리면 친구가 생길지도!', 'Upload tracks or notes — friends may follow!')}</small></div>`);
    return;
  }
  const SHAPES = (typeof SHAPE_TYPES !== 'undefined' && SHAPE_TYPES.length) ? SHAPE_TYPES
                : ['circle','square','triangle','diamond','pentagon','heart','star'];
  const COLORS = ['#FF9800','#9C27B0','#03A9F4','#E91E63','#FFC107','#4CAF50','#FF5722','#673AB7'];
  // 원형 배치 — 팔로워 수에 맞춰 반지름 조정.
  // 너무 많으면 두세 겹의 동심원으로.
  const N = followers.length;
  const isMobile = window.innerWidth <= 768;
  const baseR = isMobile ? 130 : 200;
  const maxPerRing = isMobile ? 8 : 12;
  followers.forEach((u, i) => {
    const ring = Math.floor(i / maxPerRing);
    const inRing = N - ring * maxPerRing < maxPerRing ? (N - ring * maxPerRing) : maxPerRing;
    const idx = i % maxPerRing;
    const angle = (idx / inRing) * 2 * Math.PI + (ring * 0.3); // 링마다 살짝 회전 오프셋
    const r = baseR + ring * (isMobile ? 70 : 90);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    // 도형/색은 follower id 로 결정 (안정적)
    const hash = (u.id || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
    const shape = SHAPES[Math.abs(hash) % SHAPES.length];
    const color = COLORS[Math.abs(hash >> 3) % COLORS.length];
    const isTri = shape === 'triangle';
    const bgStyle = isTri ? `border-bottom-color:${color}; color:${color}; --shape-bg:${color};`
                          : `background:${color}; --shape-bg:${color};`;
    const safeName = (u.name || '').replace(/</g,'&lt;');
    const delay = i * 35; // stagger 등장
    stage.insertAdjacentHTML('beforeend', `
      <button class="constellation-star floating-shape shape-${shape}"
              style="--tx:${x}px; --ty:${y}px; animation-delay:${delay}ms; ${bgStyle}"
              onclick="closeFollowerConstellation(); navigateTo('artist:' + encodeURIComponent('${safeName.replace(/'/g,"\\'")}'))"
              title="${safeName}">
        <img class="constellation-star-avatar" src="${u.avatar}" alt="${safeName}" loading="lazy">
        <span class="constellation-star-name">${safeName}</span>
      </button>
    `);
  });
};

window.closeFollowerConstellation = function () {
  const m = document.getElementById('constellation-overlay');
  if (m) m.remove();
  document.body.style.overflow = '';
};

// 팔로워/팔로잉 리스트 모달 — 카운트 칩 누르면 호출.
// mode: 'followers' | 'followings'
window.openFollowListModal = async function (mode, displayName, userId) {
  if (!userId) {
    if (window.Follows && window.Follows.getArtistIdByName) {
      userId = await window.Follows.getArtistIdByName(displayName);
    }
    if (!userId) { alert(_t('아직 정보를 불러오는 중이에요. 잠시 후 다시 시도해주세요.', 'Still loading — please try again in a moment.')); return; }
  }
  const old = document.getElementById('follow-list-modal');
  if (old) old.remove();
  const title = mode === 'followers' ? _t('팔로워', 'Followers') : _t('팔로잉', 'Following');
  const icon = mode === 'followers' ? 'ri-group-line' : 'ri-user-3-line';
  const html = `
    <div id="follow-list-modal" class="profile-modal" onclick="if(event.target===this) closeFollowListModal()">
      <div class="profile-modal-card">
        <div class="profile-modal-head">
          <i class="${icon}" style="color:#1DB954;"></i>
          <div class="profile-modal-title">${title} — ${(displayName||'').replace(/</g,'&lt;')}</div>
          <button class="profile-modal-close" onclick="closeFollowListModal()" aria-label="닫기">
            <i class="ri-close-line"></i>
          </button>
        </div>
        <div class="profile-modal-body" id="follow-list-body">
          <div style="text-align:center; padding:36px 0; color:var(--text-secondary);">${_t('불러오는 중…', 'Loading…')}</div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  try {
    const list = mode === 'followers'
      ? await window.Follows.listFollowers(userId)
      : await window.Follows.listFollowings(userId);
    const body = document.getElementById('follow-list-body');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = `<div style="text-align:center; padding:36px 0; color:var(--text-secondary); font-size:13px;">
        ${mode === 'followers' ? _t('아직 팔로워가 없어요', 'No followers yet') : _t('아직 팔로잉이 없어요', 'Not following anyone yet')}
      </div>`;
      return;
    }
    const myId = window.__currentUser && window.__currentUser.id;
    body.innerHTML = list.map(u => {
      const safeName2 = (u.name || '').replace(/</g,'&lt;').replace(/'/g,"\\'");
      const isSelf2 = myId && myId === u.id;
      const iFollow = !isSelf2 && window.__followed && window.__followed.has(u.id);
      return `
        <div class="follow-row" onclick="closeFollowListModal(); navigateTo('artist:' + encodeURIComponent('${safeName2}'))">
          <img src="${u.avatar}" alt="" class="follow-row-avatar" loading="lazy">
          <div class="follow-row-name">${safeName2}</div>
          ${isSelf2 ? '' : `
            <button class="follow-row-btn ${iFollow ? 'is-following' : ''}"
              onclick="event.stopPropagation(); toggleFollowArtist('${u.id}', '${safeName2}'); this.classList.toggle('is-following'); this.innerHTML = this.classList.contains('is-following') ? '<i class=\\'ri-user-follow-fill\\'></i> ' + _t('팔로잉','Following') : '<i class=\\'ri-user-add-line\\'></i> ' + _t('팔로우','Follow');">
              ${iFollow ? '<i class="ri-user-follow-fill"></i> ' + _t('팔로잉', 'Following') : '<i class="ri-user-add-line"></i> ' + _t('팔로우', 'Follow')}
            </button>
          `}
        </div>
      `;
    }).join('');
  } catch (e) {
    const body = document.getElementById('follow-list-body');
    if (body) body.innerHTML = `<div style="text-align:center; padding:36px 0; color:#ff8080; font-size:13px;">${_t('불러오기 실패', 'Failed to load')}: ${e.message || e}</div>`;
  }
};
window.closeFollowListModal = function () {
  const m = document.getElementById('follow-list-modal');
  if (m) m.remove();
};

// 메세지함 모달 — 자기소개프로필 옆 '메세지' 버튼이 호출. 받은 DM 인박스 표시.
window.openDmInboxModal = function () {
  // 기존 모달 있으면 정리
  const old = document.getElementById('dm-inbox-modal');
  if (old) old.remove();
  const html = `
    <div id="dm-inbox-modal" class="profile-modal" onclick="if(event.target===this) closeDmInboxModal()">
      <div class="profile-modal-card">
        <div class="profile-modal-head">
          <i class="ri-mail-fill" style="color:#1DB954;"></i>
          <div class="profile-modal-title">${_t('메세지함', 'Inbox')}</div>
          <button class="profile-modal-close" onclick="closeDmInboxModal()" aria-label="닫기">
            <i class="ri-close-line"></i>
          </button>
        </div>
        <div class="profile-modal-body">
          <div id="dm-inbox-mount"><div style="text-align:center; padding:30px 0; color:var(--text-secondary);">${_t('불러오는 중…', 'Loading…')}</div></div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  // 인박스 채우기 (기존 mountDmInbox 재활용)
  if (typeof window.mountDmInbox === 'function') {
    window.mountDmInbox('dm-inbox-mount');
  }
};
window.closeDmInboxModal = function () {
  const m = document.getElementById('dm-inbox-modal');
  if (m) m.remove();
};

// 자기소개프로필 모달 — bio 보기 + 수정. 작은 textarea 로 100자 free-form.
window.openProfileBioModal = function () {
  const old = document.getElementById('profile-bio-modal');
  if (old) old.remove();
  const me = window.__currentUser || (window.DB.get && window.DB.get().currentUser) || {};
  const bio = (me.bio || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const html = `
    <div id="profile-bio-modal" class="profile-modal" onclick="if(event.target===this) closeProfileBioModal()">
      <div class="profile-modal-card">
        <div class="profile-modal-head">
          <i class="ri-user-3-line" style="color:#1DB954;"></i>
          <div class="profile-modal-title">자기소개</div>
          <button class="profile-modal-close" onclick="closeProfileBioModal()" aria-label="닫기">
            <i class="ri-close-line"></i>
          </button>
        </div>
        <div class="profile-modal-body">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
            <i class="ri-edit-line"></i> 자유롭게 100자 안에서 — 어떤 음악 하는지, 무엇을 좋아하는지
          </div>
          <textarea id="profile-bio-textarea" maxlength="100" rows="4"
            style="width:100%; padding:12px; border:1px solid var(--divider,#2a2a2a); border-radius:8px; background:rgba(255,255,255,0.04); color:inherit; font-size:14px; line-height:1.5; resize:vertical; font-family:inherit;"
            placeholder="자기소개를 적어보세요...">${bio}</textarea>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:11px; color:var(--text-secondary);">
            <span><i class="ri-information-line"></i> 다른 사람도 볼 수 있어요</span>
            <span id="profile-bio-counter">${(me.bio || '').length} / 100</span>
          </div>
          <div style="margin-top: 14px; display: flex; gap: 8px;">
            <button class="btn-primary" style="flex:1;" onclick="saveProfileBio()">저장</button>
            <button class="btn-primary" style="flex:1; background:#333;" onclick="closeProfileBioModal()">취소</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const ta = document.getElementById('profile-bio-textarea');
  const counter = document.getElementById('profile-bio-counter');
  if (ta && counter) {
    ta.addEventListener('input', () => {
      counter.textContent = ta.value.length + ' / 100';
    });
    setTimeout(() => ta.focus(), 80);
  }
};
window.closeProfileBioModal = function () {
  const m = document.getElementById('profile-bio-modal');
  if (m) m.remove();
};
window.saveProfileBio = async function () {
  const ta = document.getElementById('profile-bio-textarea');
  if (!ta) return;
  const bio = ta.value.trim().slice(0, 100);
  const btns = document.querySelectorAll('#profile-bio-modal button');
  btns.forEach(b => b.disabled = true);
  const _withTimeout = (p, ms, label) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error((label || '작업') + ' 시간초과')), ms))
  ]);
  try {
    if (window.supabase && window.__currentUser) {
      // ensureProfileRow 짧은 타임아웃으로 — 실패해도 진행
      if (window.Auth && window.Auth.ensureProfileRow) {
        try { await _withTimeout(window.Auth.ensureProfileRow(), 4000, 'ensureProfileRow'); }
        catch (e) { console.warn('[saveProfileBio] ensureProfileRow', e.message); }
      }
      const { data: rows, error } = await _withTimeout(
        window.supabase
          .from('profiles')
          .update({ bio: bio || null })
          .eq('id', window.__currentUser.id)
          .select('id, bio'),
        8000, 'bio update');
      if (error) throw error;
      if (!Array.isArray(rows) || rows.length === 0) {
        console.error('[saveProfileBio] 0 rows updated — id:', window.__currentUser.id);
        throw new Error('자기소개가 저장되지 않았어요. 로그아웃 후 다시 로그인 해보세요.');
      }
      window.__currentUser.bio = bio;
    }
    // 로컬 캐시도 갱신 — 다시 들어가면 즉시 반영
    try {
      const cached = window.DB.get();
      if (cached && cached.currentUser) {
        cached.currentUser.bio = bio;
        window.DB.save(cached);
      }
    } catch (_) {}
    showToast(_t('자기소개 저장됨 ✨', 'Bio saved ✨'));
    closeProfileBioModal();
    // 현재 보고 있는 아티스트 페이지가 자기 거면 다시 그려서 bio 표시 갱신
    if (currentView && currentView.startsWith('artist:')) {
      if (typeof renderArtistProfile === 'function') {
        const name = decodeURIComponent(currentView.slice(7));
        renderArtistProfile(name);
      }
    }
  } catch (e) {
    alert('저장 실패: ' + (e.message || e));
  } finally {
    btns.forEach(b => b.disabled = false);
  }
};

// "글 추가" 버튼 (아티스트 페이지 소식 헤더) → 벽으로 이동 + 컴포저 자동 열기
window.goAddSoshik = function() {
  // 주절주절이 스레드 피드로 바뀜 → 레거시 작성 패널 대신 피드 작성기를 연다.
  navigateTo('wall');
  setTimeout(() => { if (typeof openThreadComposer === 'function') openThreadComposer(); }, 200);
};

window.toggleWallCompose = function() {
  const panel = document.getElementById('wall-compose-panel');
  if (!panel) return;
  const backdrop = document.getElementById('wall-compose-backdrop');
  panel.hidden = !panel.hidden;
  // PC 모달 모드일 때 backdrop 도 같이 토글 (모바일은 CSS 로 항상 hidden)
  if (backdrop) backdrop.hidden = panel.hidden;
  if (!panel.hidden) {
    const t = document.getElementById('wall-title');
    const ta = document.getElementById('wall-text');
    // PC 는 제목부터, 모바일은 기존처럼 본문부터 focus
    const isMobile = window.innerWidth <= 768;
    if (!isMobile && t) t.focus();
    else if (ta) ta.focus();
  }
};

// ── Song attacher (wall compose + comment compose) ──────────────────────
// Picks an Off-Stage track OR an external URL (YouTube / Spotify / Apple Music)
// and stashes the result depending on which "target" the modal was opened for:
//   - 'wall'    → window.__wallAttachedSong, preview in #wall-attach-preview
//   - 'comment' → window.__commentAttachedSong, preview in #comment-attach-preview
window.__wallAttachedSong = null;
window.__commentAttachedSong = null;
window.__threadAttachedSong = null;   // 주절주절 스레드 작성기용
window.__songAttachTarget = 'wall';

function _detectProvider(url) {
  const u = (url || '').toLowerCase();
  if (/youtube\.com\/|youtu\.be\//.test(u))   return { provider: 'youtube', label: 'YouTube' };
  if (/open\.spotify\.com\//.test(u))          return { provider: 'spotify', label: 'Spotify' };
  if (/music\.apple\.com\//.test(u))           return { provider: 'apple',   label: 'Apple Music' };
  if (/soundcloud\.com\//.test(u))             return { provider: 'soundcloud', label: 'SoundCloud' };
  return null;
}

function _renderAttachPreview() {
  // Target depends on which composer the user opened the attacher from
  const tgt = window.__songAttachTarget;
  // 주절주절 스레드 작성기는 자체 칩 렌더러로 위임 (시트의 #thread-sheet-songchip).
  if (tgt === 'thread') { if (typeof window._threadRenderSongChip === 'function') window._threadRenderSongChip(); return; }
  const previewId = tgt === 'comment' ? 'comment-attach-preview'
                  : tgt === 'story'   ? 'story-attach-preview'
                  : 'wall-attach-preview';
  const preview = document.getElementById(previewId);
  if (!preview) return;
  const a = tgt === 'comment' ? window.__commentAttachedSong
          : tgt === 'story'   ? window.__storyAttachedSong
          : window.__wallAttachedSong;
  if (!a) { preview.innerHTML = ''; preview.hidden = true; return; }
  preview.hidden = false;
  if (a.kind === 'track') {
    const t = (window.DB.get().tracks || []).find(x => x.id === a.id) || {};
    preview.innerHTML = `
      <div class="wall-attached-chip">
        <img src="${t.cover || ''}" alt="">
        <div class="wall-attached-info">
          <div class="wall-attached-title">${(t.title||'').replace(/</g,'&lt;')}</div>
          <div class="wall-attached-sub">${(t.artist||'').replace(/</g,'&lt;')} · Off-Stage</div>
        </div>
        <button type="button" class="wall-attached-x" onclick="clearAttachedSong()" aria-label="첨부 취소"><i class="ri-close-line"></i></button>
      </div>`;
    return;
  }
  if (a.kind === 'url') {
    const p = _detectProvider(a.url) || { label: '링크' };
    preview.innerHTML = `
      <div class="wall-attached-chip">
        <div class="wall-attached-ext"><i class="ri-link"></i></div>
        <div class="wall-attached-info">
          <div class="wall-attached-title">${p.label}</div>
          <div class="wall-attached-sub" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;">${a.url.replace(/</g,'&lt;')}</div>
        </div>
        <button type="button" class="wall-attached-x" onclick="clearAttachedSong()" aria-label="첨부 취소"><i class="ri-close-line"></i></button>
      </div>`;
  }
}

window.clearAttachedSong = function() {
  if (window.__songAttachTarget === 'comment') window.__commentAttachedSong = null;
  else if (window.__songAttachTarget === 'story') window.__storyAttachedSong = null;
  else if (window.__songAttachTarget === 'thread') window.__threadAttachedSong = null;
  else window.__wallAttachedSong = null;
  _renderAttachPreview();
};

window.openSongAttacher = function(target) {
  window.__songAttachTarget = (target === 'comment') ? 'comment'
                            : (target === 'thread')  ? 'thread'
                            : (target === 'story')   ? 'story'
                            : 'wall';
  const existing = document.getElementById('wall-song-modal');
  if (existing) existing.remove();
  // Only show Supabase-stored tracks — their ids are real UUIDs that the
  // wall_notes.track_id / wall_note_comments.track_id columns can accept.
  // Mock seed tracks (like 't1', 't2') have non-UUID ids and would fail INSERT.
  const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const myTracks = (window.DB.get().tracks || [])
    .filter(t => t && t.title && (t.__supabase || _UUID_RE.test(t.id)))
    .slice(0, 30);
  const trackList = myTracks.map(t => `
    <div class="wall-song-row" onclick="pickAttachedTrack('${t.id}')">
      <img src="${t.cover || ''}" alt="" loading="lazy">
      <div class="wall-song-info">
        <div class="wall-song-title">${(t.title||'').replace(/</g,'&lt;')}</div>
        <div class="wall-song-sub">${(t.artist||'').replace(/</g,'&lt;')}${t.isDemo ? ' · DEMO' : ''}</div>
      </div>
    </div>`).join('');
  const modal = document.createElement('div');
  modal.id = 'wall-song-modal';
  modal.className = 'wall-song-modal';
  modal.innerHTML = `
    <div class="wall-song-modal-content" onclick="event.stopPropagation()">
      <div class="wall-song-modal-head">
        <h3 style="margin:0; font-size:16px;">${_t('노래 첨부', 'Attach a song')}</h3>
        <button class="wall-song-close" onclick="closeSongAttacher()" aria-label="닫기"><i class="ri-close-line"></i></button>
      </div>
      <div class="wall-song-tabs">
        <button class="wall-song-tab active" data-tab="track" onclick="_switchSongAttachTab('track')"><i class="ri-music-2-line"></i> ${_t('Off-Stage 곡', 'Off-Stage track')}</button>
        <button class="wall-song-tab"        data-tab="url"   onclick="_switchSongAttachTab('url')"><i class="ri-link"></i> URL</button>
      </div>
      <div class="wall-song-pane" data-pane="track">
        <input type="text" class="form-control" placeholder="${_t('곡 제목·아티스트 검색', 'Search title · artist')}" oninput="_filterAttachTracks(this.value)" style="margin-bottom:10px;">
        <div class="wall-song-list" id="wall-song-list">${trackList || `<div style="text-align:center; padding:24px; color:var(--text-secondary); font-size:13px;">${_t('아직 업로드된 Off-Stage 곡이 없어요.<br>옆 탭에서 YouTube/Spotify URL은 첨부 가능 →', 'No Off-Stage tracks yet.<br>You can attach a YouTube/Spotify URL in the other tab →')}</div>`}</div>
      </div>
      <div class="wall-song-pane" data-pane="url" style="display:none;">
        <input type="url" id="wall-song-url" class="form-control" placeholder="YouTube · Spotify · Apple Music URL" style="margin-bottom:12px;">
        <button class="btn-primary" style="width:100%;" onclick="pickAttachedUrl()">${_t('첨부', 'Attach')}</button>
        <p style="font-size:11px; color:var(--text-secondary); margin-top:10px;">${_t('지원', 'Supported')}: youtube.com · open.spotify.com · music.apple.com</p>
      </div>
    </div>
  `;
  modal.onclick = (e) => { if (e.target === modal) closeSongAttacher(); };
  document.body.appendChild(modal);
};

window.closeSongAttacher = function() {
  const m = document.getElementById('wall-song-modal');
  if (m) m.remove();
};

window._switchSongAttachTab = function(tab) {
  document.querySelectorAll('.wall-song-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.wall-song-pane').forEach(p => p.style.display = (p.dataset.pane === tab) ? '' : 'none');
};

window._filterAttachTracks = function(q) {
  q = (q || '').trim().toLowerCase();
  const list = document.getElementById('wall-song-list');
  if (!list) return;
  const rows = list.querySelectorAll('.wall-song-row');
  rows.forEach(r => {
    const t = r.textContent.toLowerCase();
    r.style.display = (!q || t.includes(q)) ? '' : 'none';
  });
};

function _storeAttachedSong(value) {
  if (window.__songAttachTarget === 'comment') window.__commentAttachedSong = value;
  else if (window.__songAttachTarget === 'story') window.__storyAttachedSong = value;
  else if (window.__songAttachTarget === 'thread') window.__threadAttachedSong = value;
  else window.__wallAttachedSong = value;
}

window.pickAttachedTrack = function(trackId) {
  _storeAttachedSong({ kind: 'track', id: trackId });
  _renderAttachPreview();
  closeSongAttacher();
};

window.pickAttachedUrl = function() {
  const urlEl = document.getElementById('wall-song-url');
  const url = (urlEl && urlEl.value || '').trim();
  if (!url) { alert('URL을 입력해주세요'); return; }
  if (!_detectProvider(url)) {
    if (!confirm('지원하지 않는 URL일 수 있어요. 그래도 첨부할까요?')) return;
  }
  _storeAttachedSong({ kind: 'url', url });
  _renderAttachPreview();
  closeSongAttacher();
};

window.submitWallNote = async function() {
  const user = window.__currentUser || (window.DB.get().currentUser);
  if (!user) {
    alert('벽에 글을 남기려면 로그인이 필요해요.');
    navigateTo('auth');
    return;
  }
  const titleEl = document.getElementById('wall-title');
  const titleRaw = (titleEl && titleEl.value || '').trim();
  const textEl = document.getElementById('wall-text');
  const bodyRaw = (textEl && textEl.value || '').trim();
  // 제목 + 본문을 합쳐 저장 — 첫 줄 = 제목 (벽 카드/모달의 일기 톤 파싱과 호환)
  let text;
  if (titleRaw && bodyRaw) text = titleRaw + '\n' + bodyRaw;
  else                     text = titleRaw || bodyRaw;
  if (!text) return;
  const activeColor = document.querySelector('.color-dot.active');
  const color = activeColor ? activeColor.dataset.color : 'yellow';
  const rotation = Math.random() * 5 - 2.5;

  const btn = document.querySelector('button.btn-primary[onclick*="submitWallNote"]');
  if (btn) { btn.disabled = true; btn.textContent = '붙이는 중…'; }
  // Pull any attached song link picked via openSongAttacher()
  const attached = window.__wallAttachedSong || null;
  const trackId    = attached && attached.kind === 'track' ? attached.id : null;
  const externalUrl = attached && attached.kind === 'url'  ? attached.url : null;

  try {
    if (window.Walls) {
      // 10초 안에 응답 안 오면 강제로 실패 처리 (form 영구 잠김 방지)
      const inserted = await Promise.race([
        window.Walls.insert({ text, color, rotation, trackId, externalUrl }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('네트워크 타임아웃 (10초)')), 10000))
      ]);
      // ⚠️ Walls.insert는 __wallNotes에만 새 노트를 unshift하고 db.notes는 안 건드림.
      //    renderWall은 db.notes에서 읽어가니까 여기서 직접 넣어줘야 즉시 보임(실시간 반영).
      if (inserted) {
        const _db = window.DB.get();
        if (!Array.isArray(_db.notes)) _db.notes = [];
        if (!_db.notes.some(n => n && n.id === inserted.id)) {
          _db.notes.unshift(inserted);
          try { window.DB.save(_db); } catch (_) {}
        }
      }
    } else {
      window.DB.addNote({ id: 'n' + Date.now(), author: user.name, text, color, rotation, createdAt: new Date().toISOString() });
    }
    if (textEl) textEl.value = '';
    window.__wallAttachedSong = null;
    const preview = document.getElementById('wall-attach-preview');
    if (preview) { preview.innerHTML = ''; preview.hidden = true; }
    const panel = document.getElementById('wall-compose-panel');
    if (panel) panel.hidden = true;
    showToast(_t('벽에 붙었어요 📌', 'Posted to the wall 📌'));
    // renderWall은 fire-and-forget — 실패해도 form 잠기는 일 없게
    if (btn) { btn.disabled = false; btn.innerHTML = '붙이기 📌'; }
    Promise.resolve(renderWall()).catch(e => console.warn('[submitWallNote] renderWall', e));
    return;
  } catch (e) {
    alert('저장 실패: ' + (e.message || e));
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '붙이기 📌'; }
};

// ── 주절주절 글 좋아요 (note_favorites — 공개 + 카운트) ──
// 예전엔 하트가 시각 토글뿐이었으나, 이제 실제 좋아요로 저장. 누가 좋아요했는지
// note_favorites 에 남아 나중에 "내가 좋아요한 글"로 따로 모아볼 수 있음(백엔드 준비됨).
// 좋아요 여부의 단일 진실원천은 서버(note_favorites → window.__favoritedNotes, refreshMyFavorites
// 가 채움). 예전엔 기기 미러(localStorage)를 뒀으나, 미러는 기기-로컬이라 PC↔모바일 동기화를
// 막았다 → 제거. 서버 저장만 정상이면(아래 toggleFavorite 버그 수정) 기기 간 자동 동기화됨.
function _isNoteLiked(id) {
  return !!(window.Walls && window.Walls.isFavorited && window.Walls.isFavorited(id));
}
window._isNoteLiked = _isNoteLiked;
function _updateNoteLikeDom(noteId) {
  const liked = _isNoteLiked(noteId);
  const count = (window.__noteFavCounts && window.__noteFavCounts[noteId]) || 0;
  let sel;
  try { sel = '.tp-like[data-note-id="' + ((window.CSS && CSS.escape) ? CSS.escape(noteId) : noteId) + '"]'; }
  catch (_) { sel = '.tp-like[data-note-id="' + noteId + '"]'; }
  document.querySelectorAll(sel).forEach(btn => {
    btn.classList.toggle('is-liked', liked);
    const ic = btn.querySelector('i'); if (ic) ic.className = liked ? 'ri-heart-3-fill' : 'ri-heart-3-line';
    const c = btn.querySelector('.tp-like-count'); if (c) c.textContent = count > 0 ? count : '';
  });
}
window._updateNoteLikeDom = _updateNoteLikeDom;

window.toggleNoteLike = async function (noteId, btnEl) {
  const db = window.DB.get();
  if (!db.currentUser) { alert(_t('로그인 후 이용 가능합니다', 'Sign in to like posts')); navigateTo('auth'); return; }
  if (!window.Walls || !window.Walls.toggleFavorite) return;
  if (!window.__favoritedNotes) window.__favoritedNotes = new Set();
  if (!window.__noteFavCounts) window.__noteFavCounts = {};
  const willLike = !window.__favoritedNotes.has(noteId);
  // 낙관적 반영 — 좋아요 set + 카운트 + 같은 노트의 모든 하트 버튼 DOM (즉시 채워짐, 모바일도 바로 반응)
  if (willLike) window.__favoritedNotes.add(noteId); else window.__favoritedNotes.delete(noteId);
  window.__noteFavCounts[noteId] = Math.max(0, (window.__noteFavCounts[noteId] || 0) + (willLike ? 1 : -1));
  _updateNoteLikeDom(noteId);
  if (willLike && btnEl) { btnEl.classList.add('pop'); setTimeout(() => btnEl.classList.remove('pop'), 360); }
  try {
    // willLike 명시 전달 — 낙관적으로 바꾼 __favoritedNotes 와 무관하게 서버에 정확히 insert/delete.
    // (예전엔 인자 없이 호출 → toggleFavorite 이 __favoritedNotes 보고 거꾸로 삭제 → 서버 미저장 → 동기화 실패)
    await window.Walls.toggleFavorite(noteId, willLike);
  } catch (e) {
    // 실패 — 되돌리기
    if (willLike) window.__favoritedNotes.delete(noteId); else window.__favoritedNotes.add(noteId);
    window.__noteFavCounts[noteId] = Math.max(0, (window.__noteFavCounts[noteId] || 0) + (willLike ? -1 : 1));
    _updateNoteLikeDom(noteId);
    if (typeof showToast === 'function') {
      const _msg = (e && e.message === 'NO_DELETE_POLICY')
        ? _t('좋아요 취소가 적용되지 않았어요 (서버 권한 설정 필요)', "Couldn't remove like (server permission needed)")
        : (willLike ? _t('좋아요 실패 — 다시 시도해줘', 'Like failed — try again')
                    : _t('좋아요 취소 실패 — 다시 시도해줘', 'Unlike failed — try again'));
      showToast(_msg);
    }
    console.warn('[toggleNoteLike]', e);
  }
};

window.toggleBookmark = async function(noteId, btnEl) {
  if (!window.Walls || !window.Walls.toggleBookmark) {
    alert('아직 준비 중이에요. 잠시 후 다시 시도해주세요.');
    return;
  }
  // __currentUser 가 인증 새로고침 타이밍에 잠깐 null 일 수 있음 → 로컬 db도 확인.
  const user = window.__currentUser || (window.DB.get && window.DB.get().currentUser);
  if (!user) {
    if (confirm('포스트잇을 수집하려면 로그인이 필요해요. 로그인할까요?')) navigateTo('auth');
    return;
  }
  // 탭 즉시 모션 피드백 (서버 응답 전, 좋아요와 동일하게 pop).
  if (btnEl) { btnEl.classList.add('pop'); setTimeout(() => btnEl.classList.remove('pop'), 420); }
  try {
    const { bookmarked } = await window.Walls.toggleBookmark(noteId);
    // Update icon in DOM in-place — 새 피드(.feed-post)도 포함 (옛 .thread-post 만이라 새 피드선 아이콘이 안 바뀌던 버그)
    document.querySelectorAll(`.wall-note[data-note-id="${noteId}"] .note-bookmark, #note-detail-modal .note-bookmark[data-note-id="${noteId}"], .thread-post[data-note-id="${noteId}"] .tp-collect, .feed-post[data-note-id="${noteId}"] .tp-collect`).forEach(btn => {
      btn.classList.toggle('is-bookmarked', bookmarked);
      const i = btn.querySelector('i');
      if (i) i.className = bookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line';
    });
    showToast(bookmarked ? _t('수집했어요 📌', 'Collected 📌') : _t('수집 취소됐어요', 'Removed from collection'));
  } catch (e) {
    alert(e.message || '수집 실패');
  }
};

// 내 우주에서 포스트잇 빼기 (✕) — 수집 해제 + Set 갱신 + 우주 다시 그리기.
window._removeNoteFromUniverse = async function (noteId, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  if (!noteId) return;
  try {
    if (window.Walls && window.Walls.toggleBookmark && window.Walls.isBookmarked && window.Walls.isBookmarked(noteId)) {
      await window.Walls.toggleBookmark(noteId);   // 북마크 상태 → 토글하면 해제
    }
    if (window.__bookmarkedNotes && window.__bookmarkedNotes.delete) window.__bookmarkedNotes.delete(noteId);
    if (typeof showToast === 'function') showToast(_t('우주에서 뺐어요', 'Removed from universe'));
    if (typeof renderUniverse === 'function') renderUniverse();
  } catch (e) { console.warn('[universe] remove note', e); if (typeof showToast === 'function') showToast(_t('빼기 실패', 'Remove failed')); }
};

// 내 우주 포스트잇 전부 빼기 — 수집(북마크)한 노트를 한 번에 모두 해제.
// (예전 주절주절에서 담아둔 옛 포스트잇을 일일이 ✕ 안 누르고 한 번에 정리.)
window.clearAllUniverseNotes = async function () {
  const ids = (window.__bookmarkedNotes && window.__bookmarkedNotes.size) ? [...window.__bookmarkedNotes] : [];
  if (!ids.length) { if (typeof showToast === 'function') showToast(_t('뺄 포스트잇이 없어요', 'No notes to remove')); return; }
  if (!confirm(_t(`포스트잇 ${ids.length}개를 내 우주에서 전부 뺄까요?`, `Remove all ${ids.length} notes from your universe?`))) return;
  let failed = 0;
  for (const id of ids) {
    try {
      if (window.Walls && window.Walls.toggleBookmark && window.Walls.isBookmarked && window.Walls.isBookmarked(id)) {
        await window.Walls.toggleBookmark(id);   // 서버 note_bookmarks 행 삭제
      }
      if (window.__bookmarkedNotes && window.__bookmarkedNotes.delete) window.__bookmarkedNotes.delete(id);
    } catch (e) { failed++; console.warn('[universe] clearAll', id, e); }
  }
  if (typeof showToast === 'function') {
    showToast(failed
      ? _t(`${ids.length - failed}개 뺐어요 (${failed}개 실패)`, `Removed ${ids.length - failed} (${failed} failed)`)
      : _t('포스트잇 전부 뺐어요', 'Removed all notes'));
  }
  if (typeof renderUniverse === 'function') renderUniverse();
};

window.deleteWallNote = async function(noteId) {
  if (!confirm(_t('이 글을 삭제할까요?', 'Delete this post?'))) return;
  try {
    if (window.Walls) {
      await window.Walls.delete(noteId);
    } else {
      window.DB.deleteNote(noteId);
    }
    await renderWall();
    showToast(_t('삭제됐어요', 'Deleted'));
  } catch (e) {
    alert('삭제 실패: ' + (e.message || e));
  }
};

// 포스트잇 본문이 잘려 있을 때 "더보기"를 누르면 전체 글이 펼쳐진다.
window.expandNoteBody = function(btn) {
  const card = btn.closest('.wall-note');
  if (!card) return;
  const body = card.querySelector('.note-body');
  if (body) {
    body.style.webkitLineClamp = 'unset';
    body.style.display = 'block';
    body.style.overflow = 'visible';
  }
  btn.remove();
};

// ===================== NOTE DETAIL MODAL (comments) =====================
// 상세 모달 안에서 좌/우 스와이프로 시퀀스(소식 스택 등) 넘기기.
//   nav = { seq:[noteId...], idx }. 세로 제스처는 닫기/스크롤에 양보.
function _attachNoteHorizNav(content, nav) {
  if (!content || content._horizNavWired) return;
  content._horizNavWired = true;
  const exclude = '.scribble-input-row, .scribble-input, .note-track-thumb, .note-bookmark, .note-detail-close, input, textarea, button, a, [contenteditable="true"]';
  let sx = 0, sy = 0, drag = false, active = false;
  const onStart = (x, y, t) => {
    if (window.innerWidth > 768) return;
    if (t && t.closest && t.closest(exclude)) return;
    sx = x; sy = y; drag = true; active = false;
  };
  const onMove = (x, y, ev) => {
    if (!drag) return;
    const dx = x - sx, dy = y - sy;
    if (!active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) active = true;
      else { drag = false; return; }            // 세로 → 닫기/스크롤에 양보
    }
    content.style.transition = 'none';
    content.style.transform = `translateX(${x - sx}px)`;
    if (ev && ev.cancelable) ev.preventDefault();
  };
  const onEnd = (x) => {
    if (!drag || !active) { drag = false; return; }
    drag = false;
    const dx = x - sx;
    const N = nav.seq.length;
    content.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1)';
    if (Math.abs(dx) > 70) {
      const dir = dx < 0 ? 1 : -1;
      let ni = nav.idx + dir;
      if (ni < 0) ni = 0;
      if (ni >= N) ni = N - 1;
      if (ni === nav.idx) { content.style.transform = ''; return; }   // 끝 → 스냅백
      content.style.transform = `translateX(${dx < 0 ? -100 : 100}vw)`;
      const targetId = nav.seq[ni];
      window.__noteDetailEnterFrom = dx < 0 ? 'right' : 'left';
      setTimeout(() => { window.openNoteDetail(targetId, { seq: nav.seq, idx: ni }); }, 230);
    } else {
      content.style.transform = '';                                   // 스냅백
    }
  };
  content.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) onStart(t.clientX, t.clientY, e.target); }, { passive: true });
  content.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY, e); }, { passive: false });
  content.addEventListener('touchend', (e) => onEnd((e.changedTouches[0] && e.changedTouches[0].clientX != null) ? e.changedTouches[0].clientX : sx));
  const wm = (e) => onMove(e.clientX, e.clientY, e);
  const wu = (e) => { window.removeEventListener('mousemove', wm); window.removeEventListener('mouseup', wu); onEnd(e.clientX); };
  content.addEventListener('mousedown', (e) => { onStart(e.clientX, e.clientY, e.target); if (drag) { window.addEventListener('mousemove', wm); window.addEventListener('mouseup', wu); } });
}

window.openNoteDetail = function(noteId, nav) {
  const db = window.DB.get();
  let note = (db.notes || []).find(n => n.id === noteId);
  if (!note) return;

  // Analytics: count this as a "view" (deduped per session by SQL unique index)
  if (window.Analytics && window.Analytics.noteView) {
    window.Analytics.noteView(noteId).catch(()=>{});
  }

  const c = NOTE_COLORS[note.color] || NOTE_COLORS.yellow;
  // 일기 톤 분리 — 첫 줄을 제목, 나머지를 본문으로 (사용자 요청: 일기처럼)
  const _rawText = note.text || '';
  const _nlIdx = _rawText.indexOf('\n');
  let _title = '', _bodyRest = '';
  if (_nlIdx > 0) {
    _title = _rawText.slice(0, _nlIdx).trim();
    _bodyRest = _rawText.slice(_nlIdx + 1);
  } else {
    // 줄바꿈 없음 — 전체를 제목으로(짧으면), 본문으로(길면) 둘 다 보일 수 있게.
    if (_rawText.length <= 40) { _title = _rawText.trim(); _bodyRest = ''; }
    else { _title = ''; _bodyRest = _rawText; }
  }
  const _esc2 = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeTitleText = _esc2(_title);
  const safeBodyText = _esc2(_bodyRest).replace(/\n/g, '<br>');
  const safeText = _esc2(_rawText).replace(/\n/g, '<br>');     // legacy compat
  const safeAuthor = (note.author || '').replace(/</g,'&lt;');
  // 작성 날짜 — 모달 왼쪽 위에 작게 (벽 카드와 같은 포맷)
  const _modalDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  };
  const modalDateStr = _modalDate(note.createdAt || note.created_at);
  const modalDateChip = modalDateStr ? `<div class="note-detail-date">${modalDateStr}</div>` : '';

  // 댓글 목록 HTML — note.comments 가 바뀔 때 다시 그려서 in-place 업데이트.
  // (예전엔 모달 열기 전에 fetchComments 를 await 해서 클릭 후 1~2초 멈춰있던 게 원인)
  const buildCommentsListHtml = () => {
    const comments = note.comments || [];
    const _me = db.currentUser || window.__currentUser;
    const _myId = (window.__currentUser && window.__currentUser.id) || null;
    const _myName = (_me && _me.name) || '';
    if (comments.length === 0) {
      return `<div class="no-comments">${_t('ㄴ 아직 조용하네...<br>ㄴ 첫 낙서를 남겨봐', 'ㄴ All quiet here...<br>ㄴ Leave the first scribble')}</div>`;
    }
    return comments.map((cm, i) => {
      const cmSafe = (cm.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const cmAuth = (cm.author || '익명').replace(/</g,'&lt;');
      const isMine = (_myId && cm.authorId && cm.authorId === _myId)
                  || (!cm.authorId && _myName && cm.author === _myName);
      const delBtn = isMine
        ? `<button class="comment-del" onclick="event.stopPropagation(); deleteNoteComment('${noteId}','${cm.id}')" title="댓글 삭제"><i class="ri-close-line"></i></button>`
        : '';
      return `
        <div class="comment-line" style="padding-left:${Math.min(i,5) * 18 + 4}px;">
          <span class="comment-arrow">ㄴ</span><span class="comment-text">${cmSafe}</span><span class="comment-author">— ${cmAuth}</span>${delBtn}
        </div>
      `;
    }).join('');
  };
  const commentsHtml = buildCommentsListHtml();

  // 스와이프로 들어오는 케이스 — 기존 모달은 슬라이드 아웃 중일 수 있어, 즉시 지우지 않고
  // 잠시 후에 정리. 새 모달은 위/아래에서 슬라이드 인.
  const swipeFrom = window.__noteDetailEnterFrom;
  window.__noteDetailEnterFrom = null;
  const existingModal = document.getElementById('note-detail-modal');
  if (existingModal) {
    if (swipeFrom) {
      // 기존 모달은 슬라이드 아웃 중 — 잠시 후 자동 제거
      existingModal.id = 'note-detail-modal-prev';
      setTimeout(() => { try { existingModal.remove(); } catch (_) {} }, 320);
    } else {
      existingModal.remove();
    }
  }

  const isBookmarked = window.Walls && window.Walls.isBookmarked && window.Walls.isBookmarked(noteId);
  // 모바일 터치-스와이프가 클릭을 먹어버리는 케이스가 있어, ontouchend 에서도
  // 같은 핸들러를 명시적으로 호출 (백업). _bookmarkTouched 로 중복 호출 방지.
  const bookmarkBtnModal = db.currentUser ? `
    <button class="note-bookmark in-modal ${isBookmarked ? 'is-bookmarked' : ''}"
            data-note-id="${noteId}"
            onclick="event.stopPropagation(); if(!this._bookmarkTouched){ toggleBookmark('${noteId}'); } this._bookmarkTouched=false;"
            ontouchend="event.stopPropagation(); event.preventDefault(); this._bookmarkTouched=true; toggleBookmark('${noteId}');"
            title="${isBookmarked ? '수집 취소' : '수집하기'}">
      <i class="${isBookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line'}"></i>
    </button>
  ` : '';

  // 카드 전체를 포스트잇 색으로 통일 — 위(본문)와 아래(댓글)가 한 장의 종이처럼.
  // 정리: '✎ 낙서' 타이틀, 작성자 앞 '—' dash, '이름' 입력칸, 댓글 placeholder, '남기기' 버튼 모두 제거.
  // 댓글은 엔터로만 전송. 이름은 로그인한 계정 이름이 자동으로 들어감.
  const modalHtml = `
    <div id="note-detail-modal" class="note-detail-modal" onclick="if(event.target===this) closeNoteDetail()">
      <div class="note-detail-content note-detail-paper note-detail-diary" style="background:${c.bg}; color:${c.text};">
        ${modalDateChip}
        <button class="note-detail-close" onclick="closeNoteDetail()"><i class="ri-close-line"></i></button>
        <div class="note-detail-postit">
          ${bookmarkBtnModal}
          ${safeTitleText ? `<h2 class="note-diary-title">${safeTitleText}</h2>` : ''}
          ${safeTitleText && safeBodyText ? `<div class="note-diary-divider"></div>` : ''}
          ${safeBodyText ? `<div class="note-diary-body">${safeBodyText}</div>` : ''}
          ${!safeTitleText && !safeBodyText ? `<div class="note-diary-body">${safeText}</div>` : ''}
        </div>

        <div class="comments-scribble">
          <div id="note-detail-comments-list">${commentsHtml}</div>

          <div class="scribble-input-row">
            <input type="text" id="comment-text" class="scribble-input" placeholder="${_t('댓글 남기기…', 'Leave a comment…')}" onkeyup="if(event.key==='Enter' && !event.isComposing){ submitComment('${noteId}'); }">
            <!-- 모바일 Enter 키가 안 먹는 IME/브라우저 대비 명확한 send 버튼 — PC 에선 CSS 로 숨김 -->
            <button type="button" class="scribble-send-btn" onclick="submitComment('${noteId}')" aria-label="댓글 남기기"><i class="ri-send-plane-fill"></i></button>
          </div>
        </div>

        <!-- 작성자 + 음원 — 모달 진짜 맨 아래 오른쪽 (사용자 요청) -->
        <div class="note-meta-row note-meta-row-in-modal">
          <div class="note-author-line">
            <a href="#" class="author-link" onclick="event.preventDefault(); closeNoteDetail(); navigateTo('artist:' + encodeURIComponent('${safeAuthor}'))">${safeAuthor}</a>
          </div>
          ${_renderNoteTrackChip(note)}
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  // 스와이프로 들어왔으면 다른 방향에서 슬라이드 인.
  if (swipeFrom) {
    const newContent = document.querySelector('#note-detail-modal .note-detail-content');
    if (newContent) {
      newContent.style.animation = swipeFrom === 'bottom'
        ? 'noteSlideInFromBottom 0.3s cubic-bezier(0.22,1,0.36,1)'
        : 'noteSlideInFromTop 0.3s cubic-bezier(0.22,1,0.36,1)';
    }
  }
  // 모바일에선 자동 포커스 안 함 — 모달 열자마자 키보드가 튀어올라 '바로 댓글로
  // 끌려가는' 느낌이 났음. 사용자가 입력칸을 직접 탭해야 키보드 뜨도록 변경.
  // PC 만 자동 포커스 유지.
  const _isMobile = window.innerWidth <= 768;
  if (!_isMobile) {
    setTimeout(() => {
      const input = document.getElementById('comment-text');
      if (input) input.focus();
    }, 100);
  }

  // ── 📱 모바일 — 아래로 스와이프 → 닫기 (모든 모달 통일 모션, _attachSwipeDismiss) ──
  //    (이전: 좌우=닫기 / 상하=다음·이전 메모. 사용자 요청으로 "아래로 드래그=닫기" 통일.)
  try {
    const modalEl = document.getElementById('note-detail-modal');
    const content = modalEl && modalEl.querySelector('.note-detail-content');
    if (content) window._attachSwipeDismiss(content, {
      onClose: () => closeNoteDetail(),
      scrollGuard: 'auto',
      grabber: 'dark',
      backdrop: modalEl,
      exclude: '.scribble-input-row, .scribble-input, .note-track-thumb, .note-bookmark, .note-detail-close, input, textarea, button, a, [contenteditable="true"]'
    });
    // 시퀀스(소식 스택 등)로 들어왔으면 좌/우 스와이프로 다음·이전 글 넘기기
    if (content && nav && Array.isArray(nav.seq) && nav.seq.length > 1) {
      _attachNoteHorizNav(content, nav);
    }
  } catch (_) {}

  // 백그라운드로 최신 댓글 가져와서 목록만 조용히 업데이트 (모달은 즉시 떴음).
  // ⚡ 내용이 그대로면 innerHTML 안 건드림 — 매번 DOM 교체하면 슬라이드 인 도중에
  //    스크롤바가 깜빡일 수 있음 + 불필요한 reflow.
  if (window.Walls && window.Walls.fetchComments) {
    window.Walls.fetchComments(noteId).then(fresh => {
      note.comments = fresh;
      if (Array.isArray(window.__wallNotes)) {
        const cached = window.__wallNotes.find(x => x.id === noteId);
        if (cached) cached.comments = fresh;
      }
      const listEl = document.getElementById('note-detail-comments-list');
      if (!listEl) return;
      const newHtml = buildCommentsListHtml();
      if (listEl.innerHTML !== newHtml) listEl.innerHTML = newHtml;
    }).catch(e => console.warn('[openNoteDetail] bg fetchComments', e));
  }
};

window.closeNoteDetail = function() {
  const m = document.getElementById('note-detail-modal');
  if (m) m.remove();
};

// Delete a comment the current user wrote (from the note detail modal).
window.deleteNoteComment = async function(noteId, commentId) {
  if (!noteId || !commentId) return;
  if (!confirm('이 댓글을 지울까요?')) return;
  try {
    const db = window.DB.get();
    const note = (db.notes || []).find(n => n.id === noteId);
    const isSupabaseComment = !String(commentId).startsWith('c'); // local ids look like 'c123…'
    if (window.Walls && window.Walls.deleteComment && isSupabaseComment) {
      await window.Walls.deleteComment(commentId, noteId);
    }
    // Mirror into local cache regardless
    if (note && Array.isArray(note.comments)) {
      note.comments = note.comments.filter(c => c.id !== commentId);
      window.DB.save(db);
    }
    if (Array.isArray(window.__wallNotes)) {
      const wn = window.__wallNotes.find(n => n.id === noteId);
      if (wn && Array.isArray(wn.comments)) wn.comments = wn.comments.filter(c => c.id !== commentId);
    }
    showToast(_t('댓글 삭제됨', 'Comment deleted'));
    // Re-open the modal to refresh the comment list, then re-render wall behind it
    openNoteDetail(noteId);
    renderWall();
  } catch (e) {
    alert('댓글 삭제 실패: ' + (e.message || e));
  }
};

window.submitComment = async function(noteId) {
  const textEl = document.getElementById('comment-text');
  // 이름 입력칸은 제거됨 — 로그인한 사용자명으로 자동 (Walls.addComment 내부에서 처리)
  const authorEl = document.getElementById('comment-author');
  const text = (textEl && textEl.value || '').trim();
  if (!text) return;
  const authorName = (authorEl && authorEl.value || '').trim();

  const btn = document.querySelector('#note-detail-modal .scribble-send-btn');
  if (btn) { btn.disabled = true; }
  try {
    if (window.Walls) {
      await window.Walls.addComment(noteId, { text, authorName });
    } else {
      window.DB.addNoteComment(noteId, {
        id: 'c' + Date.now(), author: authorName || '익명', text, createdAt: new Date().toISOString()
      });
    }
    // Clear input, re-open modal (pulls fresh comments)
    if (textEl) textEl.value = '';
    await openNoteDetail(noteId);
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; }
  }
};

// Inline comment submit — used by the input row directly on each post-it (no modal)
window.submitInlineComment = async function(noteId, formEl) {
  if (!formEl) return;
  const input = formEl.querySelector('.note-inline-input');
  const text = (input && input.value || '').trim();
  if (!text) return;
  const btn = formEl.querySelector('.note-inline-send');
  if (btn) btn.disabled = true;
  try {
    let newCm = null;
    if (window.Walls) {
      newCm = await window.Walls.addComment(noteId, { text });
    } else {
      newCm = { id: 'c' + Date.now(), author: '익명', text, createdAt: new Date().toISOString() };
    }
    // window.DB.get() re-parses localStorage every call — it returns a *new*
    // object each time, so mutations are NOT shared between calls unless we
    // explicitly DB.save(). Without this save, the next renderWall reads
    // stale localStorage and the just-added comment is invisible until the
    // bg refresh eventually persists it (which is why the new comment used
    // to appear only on the *next* submit).
    const db = window.DB.get();
    const n = (db.notes || []).find(x => x.id === noteId);
    if (n) {
      if (!Array.isArray(n.comments)) n.comments = [];
      if (newCm && !n.comments.find(c => c.id === newCm.id)) n.comments.push(newCm);
      try { window.DB.save(db); } catch (_) {}
    }
    // Also mirror onto the in-memory __wallNotes cache so any code reading
    // from it (or a quick subsequent render) sees the update too.
    if (Array.isArray(window.__wallNotes)) {
      const mem = window.__wallNotes.find(x => x.id === noteId);
      if (mem) {
        if (!Array.isArray(mem.comments)) mem.comments = [];
        if (newCm && !mem.comments.find(c => c.id === newCm.id)) mem.comments.push(newCm);
      }
    }
    if (input) input.value = '';
    // 방금 쓴 댓글을 그 포스트잇에 바로 한 줄 추가 (새로고침 없이 보이게)
    try {
      const postit = formEl.closest('.artist-postit');
      const listEl = postit && postit.querySelector('.artist-postit-cm-list');
      if (listEl && newCm) {
        const _esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const line = document.createElement('div');
        line.className = 'artist-postit-cm-line';
        line.innerHTML = `ㄴ ${_esc(newCm.text)} <span class="artist-postit-cm-auth">— ${_esc(newCm.author || '익명')}</span>`;
        listEl.innerHTML = ''; listEl.appendChild(line); // 최신 1개만 보이게
      }
    } catch (_) {}
    if (typeof showToast === 'function') showToast(_t('댓글 남겼어요 ✏', 'Comment posted ✏'));
    // Re-render the wall to show the new comment inline. Preserve scroll.
    if (currentView === 'wall' && typeof renderWall === 'function') {
      const scrollY = window.scrollY;
      await renderWall();
      window.scrollTo({ top: scrollY });
    }
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ===================== NOTE DRAG SYSTEM =====================
// Global state so we can register document listeners ONCE (not on every render)
let _noteDragState = { dragEl: null, startX: 0, startY: 0, origLeft: 0, origTop: 0, moved: false, startedAt: 0 };
let _noteDocListenersAttached = false;

function _noteMove(e) {
  const s = _noteDragState;
  if (!s.dragEl) return;
  const ptr = e.touches ? e.touches[0] : e;
  const dx = ptr.clientX - s.startX;
  const dy = ptr.clientY - s.startY;
  // Higher threshold on touch: fingers shake
  const threshold = e.touches ? 14 : 6;
  if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) s.moved = true;
  // 📱 모바일도 도형처럼 드래그로 이동 (사용자 요청) — 옮긴 위치는 _noteUp 이
  //    wallpos: 에 저장해 고정. (이전엔 그리드라 막아뒀던 것 해제.)
  s.dragEl.style.left = (s.origLeft + dx) + 'px';
  s.dragEl.style.top = (s.origTop + dy) + 'px';
  if (s.moved) e.preventDefault();
}

function _noteUp() {
  const s = _noteDragState;
  if (!s.dragEl) return;
  const el = s.dragEl;
  const wasMoved = s.moved;
  s.dragEl = null;
  el.classList.remove('dragging');
  el.style.transition = '';

  // Persist user-curated position to localStorage so the post-it stays
  // where it was dropped across page reloads. % for x (scales with
  // viewport width) + px for y.
  if (wasMoved) {
    const noteId = el.dataset.noteId;
    const board = el.parentElement;
    if (noteId && board) {
      try {
        const boardRect = board.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const leftPx = elRect.left - boardRect.left + (board.scrollLeft || 0);
        const topPx  = elRect.top  - boardRect.top  + (board.scrollTop || 0);
        const xPct   = boardRect.width > 0 ? (leftPx / boardRect.width) * 100 : 0;
        localStorage.setItem('wallpos:' + noteId, JSON.stringify({ xPct, yPx: topPx }));
        // 옮긴 노트 = 고정 → 부유(둥둥) 멈추고 그 자리에 딱 (사용자 요청)
        el.classList.add('wall-fixed');
      } catch (_) {}
    }
    return;   // Don't open detail modal on drag-release
  }

  // Short click/tap (no drag):
  //  · 곡이 첨부된 메모 → 모달 열고 + 그 곡 바로 재생 (둘 다 동시에)
  //  · 곡 없는 메모 → 모달만 열림
  const noteId = el.dataset.noteId;
  if (!noteId) return;
  const db = window.DB.get();
  const note = (db.notes || []).find(n => n && n.id === noteId)
            || (Array.isArray(window.__wallNotes) ? window.__wallNotes.find(n => n.id === noteId) : null);
  if (note && note.trackId && typeof window.playTrack === 'function') {
    setTimeout(() => window.playTrack(note.trackId, 'wall'), 10);
  }
  if (typeof window.openNoteDetail === 'function') {
    setTimeout(() => window.openNoteDetail(noteId), 10);
  }
}

function initNoteDrag() {
  const notes = document.querySelectorAll('.wall-note');

  function down(e) {
    if (e.target.closest('.note-delete')) return;
    if (e.target.closest('.note-bookmark')) return;
    if (e.target.closest('.note-inline-form')) return;
    if (e.target.closest('.note-more-comments')) return;
    if (e.target.closest('.note-more-text')) return;
    if (e.target.closest('.note-track-chip')) return;
    if (e.target.closest('.note-comments-teaser')) return;
    if (e.touches && e.touches.length > 1) return;

    const el = e.currentTarget;
    const s = _noteDragState;
    s.dragEl = el;
    s.moved = false;
    s.startedAt = Date.now();

    const ptr = e.touches ? e.touches[0] : e;
    s.startX = ptr.clientX;
    s.startY = ptr.clientY;

    const board = el.parentElement;
    const rect = el.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    s.origLeft = rect.left - boardRect.left + board.scrollLeft;
    s.origTop = rect.top - boardRect.top + board.scrollTop;

    el.style.left = s.origLeft + 'px';
    el.style.top = s.origTop + 'px';
    el.style.transition = 'none';
    el.classList.add('dragging');
    // Don't preventDefault on touchstart — lets iOS register the tap normally
  }

  notes.forEach(el => {
    el.addEventListener('mousedown', down);
    el.addEventListener('touchstart', down, { passive: true });
  });

  // Attach document listeners ONCE (even across re-renders)
  if (!_noteDocListenersAttached) {
    document.addEventListener('mousemove', _noteMove);
    document.addEventListener('touchmove', _noteMove, { passive: false });
    document.addEventListener('mouseup', _noteUp);
    document.addEventListener('touchend', _noteUp);
    document.addEventListener('touchcancel', _noteUp);
    _noteDocListenersAttached = true;
  }
}

// ===================== 1. HOME VIEW — FLOATING SHAPES UNIVERSE =====================

// 텍스트가 깔끔하게 들어가는 둥근 모양만 사용 — 별/삼각/다이아/평행사변형은
// 글씨가 삐져나오고 애매해서 제외.
const SHAPE_TYPES = ['circle', 'oval', 'rect', 'wide', 'pill', 'hexagon'];
// 제외된(애매한) 모양 → 깔끔한 모양으로 매핑 (기존 트랙의 star 등도 정리)
const SHAPE_REMAP = { triangle: 'circle', star: 'circle', diamond: 'hexagon', parallelogram: 'rect' };
// 테스트 팔레트 그대로 — 비비드 네온(핑크/시안/퍼플/주황/라임/레드핑크/틸/바이올렛/옐로/블루). 사용자 요청.
const SHAPE_COLORS = ['#FF2EA0', '#00E5FF', '#B14BFF', '#FF9100', '#76FF03', '#FF4D6D', '#2EE6D6', '#9D4EDD', '#FFD166', '#4D9DFF'];

// ── 장르 → 고정 색 (업로드 시 선택) ───────────────────────────────────────
// 도형/플레이어/커버 색을 장르로 통일(같은 장르 = 같은 색). 장르는 tags 첫 칸에 저장되되
// 도형 글(lines)에는 안 들어감(genre 제외). 장르 없는(기존) 곡은 곡 id 해시 색으로 폴백.
const GENRES = [
  { key: '발라드',  en: 'Ballad',   color: '#7C9CFF' },
  { key: '댄스',    en: 'Dance',    color: '#36E0C8' },
  { key: '힙합',    en: 'Hip-hop',  color: '#FF6B6B' },
  { key: 'R&B',     en: 'R&B',      color: '#B06BFF' },
  { key: '록',      en: 'Rock',     color: '#FF4D6D' },
  { key: '인디',    en: 'Indie',    color: '#9DE05A' },
  { key: '시티팝',  en: 'City Pop', color: '#FF9F45' },
  { key: '재즈',    en: 'Jazz',     color: '#FFC94D' },
  { key: 'EDM',     en: 'EDM',      color: '#00E5FF' },
  { key: '트로트',  en: 'Trot',     color: '#FF7AC6' },
  { key: '포크',    en: 'Folk',     color: '#8BD17C' },
  { key: 'K-팝',    en: 'K-Pop',    color: '#5AA9FF' },
];
window.GENRES = GENRES;
function _findGenre(s) {
  if (!s) return null;
  const v = String(s).trim().toLowerCase();
  return GENRES.find(G => G.key.toLowerCase() === v || G.en.toLowerCase() === v) || null;
}
window._isGenreTag = function (t) { return !!_findGenre(t); };
// 트랙의 장르 객체({key,en,color}) — track.genre 또는 태그 중 장르 매칭. 없으면 null.
function genreOfTrack(track) {
  if (!track) return null;
  let g = _findGenre(track.genre);
  if (g) return g;
  const tags = Array.isArray(track.tags) ? track.tags : [];
  for (let i = 0; i < tags.length; i++) { g = _findGenre(tags[i]); if (g) return g; }
  return null;
}
window.genreOfTrack = genreOfTrack;
// 트랙 색 — 장르 색 우선, 없으면 곡 id 해시(기존 동작). 도형·플레이어·커버 공통.
function genreColorOf(track) {
  const g = genreOfTrack(track);
  if (g) return g.color;
  const id = (track && track.id) || '';
  return SHAPE_COLORS[(_hashSeed('shape-col:' + id) >>> 0) % SHAPE_COLORS.length];
}
window.genreColorOf = genreColorOf;

// 도형 배경색 대비 글자색 — 어두운 색이면 흰 글씨, 밝으면 검정(상대휘도).
function _textOn(hex) {
  let c = String(hex || '').trim().replace(/^#/, '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return '#111';
  const n = parseInt(c, 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.42 ? '#fff' : '#111';   // 왠만하면 검정 — 정말 어두운 색만 흰 글씨
}
window._textOn = _textOn;

// ── 추천 알고리즘 (콘텐츠 기반 + 팔로우 부스트, 백엔드 ML 없음) ──────────────
// 내 취향(응원·팔로우한 장르/태그/아티스트)으로 '모을 데모'를 점수화해 정렬.
// '모을 카드'·추천 섹션·자동재생에 재사용. allTracks=후보풀, cheers=내 응원(track_id 포함), followed=[{name}].
window.recommendDemos = function (allTracks, cheers, followed, opts) {
  allTracks = Array.isArray(allTracks) ? allTracks : [];
  cheers = Array.isArray(cheers) ? cheers : [];
  followed = Array.isArray(followed) ? followed : [];
  opts = opts || {};
  const limit = opts.limit || 6;
  const myName = opts.myName || null;
  const cheeredIds = new Set(cheers.map(c => c && c.track_id).filter(Boolean));
  const followedNames = new Set(followed.map(a => a && a.name).filter(Boolean));

  // 1) 취향 프로필 — 응원한 곡의 장르/태그/아티스트 가중치
  const genreW = {}, tagW = {}, artistW = {};
  const bump = (o, k, w) => { if (k != null && k !== '') o[k] = (o[k] || 0) + w; };
  cheers.forEach(c => {
    const t = allTracks.find(x => x && x.id === c.track_id);
    if (!t) { bump(artistW, c && c.artist_name, 1); return; }
    const g = genreOfTrack(t);
    if (g) bump(genreW, g.key, 3);
    (Array.isArray(t.tags) ? t.tags : []).forEach(tag => bump(tagW, tag, 1));
    bump(artistW, t.artist, 2);
  });
  followedNames.forEach(n => bump(artistW, n, 2));
  const hasTaste = !!(Object.keys(genreW).length || Object.keys(tagW).length || Object.keys(artistW).length);

  // 발매(마스터) 있는 프로젝트 제외 — '키울 데모'가 아니므로.
  const finalProjects = new Set(allTracks.filter(t => t && !t.isDemo).map(t => t.projectId || ('proj_' + t.id)));

  // 2) 후보 = 미발매 데모 · 내 곡 아님 · 이미 응원 안 함 · 프로젝트당 1개
  const seen = {};
  const candidates = allTracks.filter(t => {
    if (!t || !t.isDemo) return false;
    const pid = t.projectId || ('proj_' + t.id);
    if (finalProjects.has(pid)) return false;
    if (myName && t.artist === myName) return false;
    if (cheeredIds.has(t.id)) return false;
    if (seen[pid]) return false; seen[pid] = 1;
    return true;
  });

  // 3) 점수 — 장르>아티스트>태그 + 팔로우/최신 부스트
  const now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
  const scored = candidates.map(t => {
    let s = 0;
    const g = genreOfTrack(t);
    if (g && genreW[g.key]) s += genreW[g.key] * 4;
    (Array.isArray(t.tags) ? t.tags : []).forEach(tag => { if (tagW[tag]) s += tagW[tag] * 2; });
    if (t.artist && artistW[t.artist]) s += artistW[t.artist] * 3;
    if (followedNames.has(t.artist)) s += 5;
    if (now) { const age = (now - new Date(t.createdAt || 0).getTime()) / 86400000; if (age >= 0 && age < 30) s += (30 - age) / 30 * 2; }
    s += (_hashSeed('rec:' + (t.id || '')) % 100) / 1000;   // 결정적 타이브레이크
    return { t, s };
  });
  scored.sort((a, b) => b.s - a.s);

  // 취향 전무(신규 유저)면 최신 데모 폴백
  let picks = hasTaste ? scored.map(x => x.t)
    : candidates.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return picks.slice(0, limit);
};

// 자동재생(라디오) — 방금 끝난 곡을 취향 시드로 비슷한 데모 1곡 고름. 최근 자동재생곡은 제외(반복 방지).
window._autoplayRecommend = function (endedTrackId) {
  try {
    if (!window.recommendDemos) return null;
    const db = window.DB.get();
    let allTracks = (db.tracks || []).slice();
    if (Array.isArray(window.__tracks)) {
      const seen = new Set(allTracks.map(t => t && t.id));
      window.__tracks.forEach(t => { if (t && !seen.has(t.id)) allTracks.push(t); });
    }
    const cur = allTracks.find(t => t && t.id === endedTrackId) || null;
    const seedCheers = cur ? [{ track_id: cur.id, artist_name: cur.artist }] : [];
    const followed = window.__followedArtistsCache || [];
    const myName = (window.__currentUser && window.__currentUser.name) || null;
    const recs = window.recommendDemos(allTracks, seedCheers, followed, { limit: 16, myName });
    const recent = (window.__autoplayHistory instanceof Set) ? window.__autoplayHistory : new Set();
    return recs.find(t => t && t.id !== endedTrackId && !recent.has(t.id))
        || recs.find(t => t && t.id !== endedTrackId)
        || null;
  } catch (e) { console.warn('[autoplay] recommend', e); return null; }
};

function renderHome() {
  const db = window.DB.get();
  // Main exposure: master + pinned demo only
  const allTracks = db.tracks || [];
  const tracks = allTracks.filter(t => !t.isDemo || t.pinned);
  const notes = db.notes || [];

  // === 떠다니는 우주: 도형 + 아티스트 + 앨범 + 포스트잇 + 해시태그 ===

  // 0) Floating track shapes (graffiti-style)
  const shapeItems = tracks.filter(t => t.version === 'final' || !t.isDemo).map(t => ({
    type: 'shape',
    id: t.id,
    title: t.title,
    artist: t.artist,
    shape: SHAPE_REMAP[t.shape] || t.shape || SHAPE_TYPES[0],
    // 저장된 shapeColor 무시 → 스크린샷 팔레트에서만 (트랙 id 시드로 안정적). 사용자 요청.
    color: SHAPE_COLORS[(_hashSeed('shape-col:' + t.id) >>> 0) % SHAPE_COLORS.length],
    lines: t.lines || [t.title, t.artist, '클릭해서 들어봐!']
  }));

  // 1) Unique artists with avatars
  const artistMap = new Map();
  tracks.forEach(t => {
    if (!t.artist) return;
    if (!artistMap.has(t.artist)) {
      artistMap.set(t.artist, { name: t.artist, avatar: t.artistAvatar });
    }
  });
  const artistItems = Array.from(artistMap.values()).map(a => ({
    type: 'artist',
    name: a.name,
    avatar: a.avatar
  }));

  // 2) Master albums (one cover per project, dedupe)
  const seenAlbum = new Set();
  const albumItems = [];
  tracks.forEach(t => {
    if (t.version !== 'final' && t.isDemo) return;
    const pid = t.projectId || t.id;
    if (seenAlbum.has(pid)) return;
    seenAlbum.add(pid);
    albumItems.push({
      type: 'album',
      id: t.id,
      title: (t.title || '').replace(/\s*\(Demo.*\)$/i, ''),
      artist: t.artist,
      cover: t.cover
    });
  });

  // 3) Recent notes (up to 30)
  const noteItems = notes.slice(0, 30).map(n => ({
    type: 'note',
    id: n.id,
    text: (n.text || '').split('\n').slice(0, 2).join('\n'),
    author: n.author,
    color: n.color
  }));

  // 4) Tags (top 40 by popularity)
  const tagCounts = {};
  tracks.forEach(t => (t.tags || []).forEach(tag => {
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }));
  const tagList = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 40);
  const maxTag = tagList.length > 0 ? tagCounts[tagList[0]] : 1;
  const tagItems = tagList.map(tag => ({
    type: 'tag',
    name: tag,
    count: tagCounts[tag],
    size: tagFontSize(tagCounts[tag], maxTag) + 6,
    color: tagColor(tag)
  }));

  // Mix & shuffle everything
  const allItems = [...shapeItems, ...artistItems, ...albumItems, ...noteItems, ...tagItems];
  for (let i = allItems.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allItems[i], allItems[j]] = [allItems[j], allItems[i]];
  }

  // Layout on a big canvas — 4 columns
  const w = (typeof window !== 'undefined') ? window.innerWidth : 1024;
  const cols = w < 560 ? 2 : (w < 860 ? 3 : 4);
  const rows = Math.ceil(allItems.length / cols);
  const universeHeight = Math.max(1100, rows * 260 + 220);

  // Also sprinkle some decorative floating dots — seeded so they stay put across reloads
  let decoHtml = '';
  for (let i = 0; i < 40; i++) {
    const seed = _hashSeed('deco-tag:' + i);
    const size = 8 + (seed % 40);
    const x = (seed >>> 6) % 96;
    const y = (seed >>> 13) % 96;
    const color = SHAPE_COLORS[(seed >>> 20) % SHAPE_COLORS.length];
    const opacity = 0.12 + (((seed >>> 23) % 40) / 100);
    const dur = 10 + ((seed >>> 26) % 22);
    const radius = ((seed >>> 29) & 1) ? '50%' : '4px';
    const dx = ((seed >>> 4) % 70) - 35;
    const dy = ((seed >>> 11) % 70) - 35;
    const rot = ((((seed >>> 17) % 80) - 40) / 10);
    decoHtml += `<div class="deco-shape" style="width:${size}px;height:${size}px;left:${x}%;top:${y}%;background:${color};opacity:${opacity};border-radius:${radius};animation:floatDrift ${dur}s ease-in-out infinite;--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;"></div>`;
  }

  // Spacing per-column based on cols
  const colWidth = (95 - 4) / cols; // distribute across 4% to 95%

  // Render floating items
  let itemsHtml = '';
  allItems.forEach((item, si) => {
    const col = si % cols;
    const row = Math.floor(si / cols);
    const _sdHU = _hashSeed('home-univ:' + (item.id || si));
    const xBase = 3 + col * colWidth + ((_sdHU % 100) / 100) * (colWidth * 0.25);
    const yPx = 40 + row * 260 + ((_sdHU >>> 7) % 70);
    const rot = ((((_sdHU >>> 13) % 100) - 50) / 10);
    const dur = 14 + ((_sdHU >>> 19) % 18);
    const _hSeedHU = _hashSeed('home-univ-d:' + (item.id || si));
    const dx = (_hSeedHU % 50) - 25;
    const dy = ((_hSeedHU >>> 8) % 50) - 25;
    const posStyle = `left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;`;

    if (item.type === 'shape') {
      const isTriangle = item.shape === 'triangle';
      const bgStyle = isTriangle
        ? `border-bottom-color: ${item.color}; color: ${item.color};`
        : `background: ${item.color};`;
      const safeLines = item.lines.map(l => (l || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      // 홈 페이지 — 드래그 핸들러 안 붙으니까 인라인 onclick 으로 재생.
      // source='universe' 로 큐 자동 빌드 → 즐겨찾기 곡 흐르듯이 이어 재생.
      itemsHtml += `
        <div class="floating-shape shape-${item.shape} univ-shape" data-track-id="${item.id}"
             style="${bgStyle} ${posStyle}"
             onclick="playTrack('${item.id}', 'universe')"
             title="${(item.title||'').replace(/</g,'&lt;')} — ${(item.artist||'').replace(/</g,'&lt;')}">
          <div class="shape-text">${safeLines.join('\n')}</div>
        </div>
      `;
    } else if (item.type === 'artist') {
      const safeName = (item.name || '').replace(/</g,'&lt;');
      const enc = encodeURIComponent(item.name || '');
      itemsHtml += `
        <div class="univ-artist" style="${posStyle}" onclick="navigateTo('artist:${enc}')" title="${safeName} 프로필">
          <img src="${item.avatar || 'https://i.pravatar.cc/150'}" class="univ-artist-avatar" alt="${safeName}" loading="lazy">
          <div class="univ-artist-name">${safeName}</div>
        </div>
      `;
    } else if (item.type === 'album') {
      const safeTitle = (item.title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeArtist = (item.artist || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      itemsHtml += `
        <div class="univ-album" style="${posStyle}" onclick="playTrack('${item.id}', 'universe')" title="${safeTitle} — ${safeArtist}">
          <img src="${item.cover}" class="univ-album-cover" alt="${safeTitle}" loading="lazy">
          <div class="univ-album-play"><i class="ri-play-fill"></i></div>
          <div class="univ-album-title">「${safeTitle}」</div>
          <div class="univ-album-artist">${safeArtist}</div>
        </div>
      `;
    } else if (item.type === 'note') {
      const c = NOTE_COLORS[item.color] || NOTE_COLORS.yellow;
      const safeTxt = (item.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const safeAuth = (item.author || '').replace(/</g,'&lt;');
      const encAuth = encodeURIComponent(item.author || '');
      itemsHtml += `
        <div class="univ-note" style="${posStyle} background:${c.bg}; color:${c.text};" onclick="navigateTo('artist:${encAuth}')" title="${safeAuth}의 벽글">
          <div class="univ-note-body">${safeTxt}</div>
          <div class="univ-note-sig">— ${safeAuth}</div>
        </div>
      `;
    } else if (item.type === 'tag') {
      const safeTag = (item.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      itemsHtml += `
        <div class="univ-tag" style="${posStyle} color:${item.color}; font-size:${item.size}px;" onclick="navigateToTag('${jsEscape(item.name)}')" title="${safeTag} · ${item.count}곡">
          #${safeTag}
        </div>
      `;
    }
  });

  appContent.innerHTML = `
    <div class="shapes-universe discover-universe" style="height: ${universeHeight}px;">
      ${decoHtml}
      ${itemsHtml}
    </div>
    <div class="upload-fab" onclick="navigateTo('upload')" title="음악 업로드">
      <i class="ri-add-line"></i>
    </div>
  `;

  // Enable drag on all discover universe items
  initDiscoverDrag();
}

// ===================== PLAYLIST UNIVERSE — 4섹션 레이아웃 =====================
// Section 1: 마스터 음원 (커버) — final 버전 앨범커버
// Section 2: 데모 섞인거 — 도형 낙서 톤
// Section 3: 응원 포스트잇
// Section 4: 감성 TAG
async function renderPlaylistUniverse(playlistId) {
  const db = window.DB.get();
  // Fetch the latest playlists (Supabase if available)
  let playlist = null;
  try {
    if (window.Playlists && window.Playlists.fetchMine) {
      const all = await window.Playlists.fetchMine();
      playlist = all.find(p => p.id === playlistId);
    }
  } catch (e) { console.warn('[playlist] fetch', e); }
  if (!playlist) {
    playlist = (db.playlists || []).find(p => p.id === playlistId);
  }
  if (!playlist) {
    appContent.innerHTML = `
      <div style="padding: 60px 24px; text-align:center; color: var(--text-secondary);">
        <h2 style="margin-bottom:12px;">🎵 플레이리스트를 찾지 못했어요</h2>
        <button class="btn-primary" onclick="navigateTo('profile')" style="margin-top:18px;">내 페이지로</button>
      </div>
    `;
    return;
  }

  const trackIdsSet = new Set(playlist.trackIds || []);
  const allTracks = Array.isArray(db.tracks) ? db.tracks : [];
  const allNotes = Array.isArray(db.notes) ? db.notes : [];
  const tracks = allTracks.filter(t => t && trackIdsSet.has(t.id));
  // 폴더에 직접 담은 포스트잇 (내 우주에서 드래그-드롭한 것)
  const folderNoteIds = _getFolderNoteIds(playlistId);
  const notes = allNotes.filter(n => n && folderNoteIds.has(n.id));

  // Split master vs demo
  const masterTracks = tracks.filter(t => !t.isDemo); // final / master
  const demoTracks = tracks.filter(t => !!t.isDemo);

  // Master albums (one per project)
  const seenMaster = new Set();
  const masterItems = [];
  masterTracks.forEach(t => {
    const pid = t.projectId || t.id;
    if (seenMaster.has(pid)) return;
    seenMaster.add(pid);
    masterItems.push({
      id: t.id,
      title: (t.title || '').replace(/\s*\(Demo.*\)$/i, ''),
      artist: t.artist,
      cover: t.cover
    });
  });

  // Tags scoped to playlist
  const tagCounts = {};
  tracks.forEach(t => (t.tags || []).forEach(tag => {
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }));
  const tagList = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 30);
  const maxTag = tagList.length > 0 ? tagCounts[tagList[0]] : 1;

  const w = (typeof window !== 'undefined') ? window.innerWidth : 1024;

  // -------- SECTION 1: 마스터 음원 (커버) --------
  let section1Html = '';
  if (masterItems.length > 0) {
    const cols = w < 560 ? 2 : (w < 860 ? 3 : 4);
    const rows = Math.ceil(masterItems.length / cols);
    const sec1H = Math.max(320, rows * 240 + 60);
    const colW = (94 - 3) / cols;

    let decoHtml = '';
    for (let i = 0; i < 14; i++) {
      const seed = _hashSeed('deco-tag-sec1:' + i);
      const size = 8 + (seed % 36);
      const x = (seed >>> 6) % 96;
      const y = (seed >>> 13) % 96;
      const color = SHAPE_COLORS[(seed >>> 20) % SHAPE_COLORS.length];
      const opacity = 0.1 + (((seed >>> 23) % 30) / 100);
      const dur = 10 + ((seed >>> 26) % 22);
      const radius = ((seed >>> 29) & 1) ? '50%' : '4px';
      const dx = ((seed >>> 4) % 70) - 35;
      const dy = ((seed >>> 11) % 70) - 35;
      const rot = ((((seed >>> 17) % 80) - 40) / 10);
      decoHtml += `<div class="deco-shape" style="width:${size}px;height:${size}px;left:${x}%;top:${y}%;background:${color};opacity:${opacity};border-radius:${radius};animation:floatDrift ${dur}s ease-in-out infinite;--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;"></div>`;
    }

    let itemsHtml = '';
    masterItems.forEach((it, si) => {
      const col = si % cols;
      const row = Math.floor(si / cols);
      const sd = _hashSeed('home-master:' + (it.id || si));
      const xBase = 2 + col * colW + ((sd % 100) / 100) * (colW * 0.25);
      const yPx = 30 + row * 230 + ((sd >>> 7) % 40);
      const rot = ((((sd >>> 11) % 80) - 40) / 10);
      const dur = 14 + ((sd >>> 17) % 14);
      const dx = ((sd >>> 21) % 40) - 20;
      const dy = ((sd >>> 25) % 40) - 20;
      const posStyle = `left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;`;
      const safeTitle = (it.title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeArtist = (it.artist || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      itemsHtml += `
        <div class="univ-album" style="${posStyle}" onclick="openFolderShorts('${playlistId}','${it.id}')" title="${safeTitle} — ${safeArtist}">
          <img src="${it.cover}" class="univ-album-cover" alt="${safeTitle}" loading="lazy">
          <div class="univ-album-play"><i class="ri-play-fill"></i></div>
          <div class="univ-album-title">「${safeTitle}」</div>
          <div class="univ-album-artist">${safeArtist}</div>
        </div>
      `;
    });

    section1Html = `
      <section class="pl-section pl-section-master">
        <h2 class="pl-section-title"><i class="ri-disc-fill"></i> 마스터 음원 <span class="pl-count">${masterItems.length}</span></h2>
        <p class="pl-section-sub">정식 발매된 곡들의 커버</p>
        <div class="shapes-universe discover-universe pl-universe" style="height: ${sec1H}px;">
          ${decoHtml}
          ${itemsHtml}
        </div>
      </section>
    `;
  } else {
    section1Html = `
      <section class="pl-section pl-section-master">
        <h2 class="pl-section-title"><i class="ri-disc-fill"></i> 마스터 음원</h2>
        <p class="pl-section-empty">아직 정식 발매곡이 없어요</p>
      </section>
    `;
  }

  // -------- SECTION 2: 데모 섞인거 — 도형/낙서 톤 --------
  let section2Html = '';
  if (demoTracks.length > 0) {
    const cols = w < 560 ? 2 : (w < 860 ? 3 : 4);
    const rows = Math.ceil(demoTracks.length / cols);
    const sec2H = Math.max(320, rows * 220 + 60);
    const colW = (94 - 3) / cols;

    let demoHtml = '';
    demoTracks.forEach((t, si) => {
      const col = si % cols;
      const row = Math.floor(si / cols);
      const sd = _hashSeed('home-demo:' + (t.id || si));
      const xBase = 2 + col * colW + ((sd % 100) / 100) * (colW * 0.3);
      const yPx = 30 + row * 220 + ((sd >>> 7) % 40);
      const rot = ((((sd >>> 11) % 140) - 70) / 10);
      const dur = 12 + ((sd >>> 17) % 16);
      const dx = ((sd >>> 21) % 50) - 25;
      const dy = ((sd >>> 25) % 50) - 25;
      let shape = t.shape || SHAPE_TYPES[si % SHAPE_TYPES.length];
      if (SHAPE_REMAP[shape]) shape = SHAPE_REMAP[shape];
      const color = t.shapeColor || SHAPE_COLORS[si % SHAPE_COLORS.length];
      const isTriangle = shape === 'triangle';
      const bgStyle = isTriangle
        ? `border-bottom-color: ${color}; color: ${color};`
        : `background: ${color};`;
      const safeTitle = (t.title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeArtist = (t.artist || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const lines = t.lines || [t.title, t.artist, '✏ demo'];
      const safeLines = lines.map(l => (l || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      const posStyle = `${bgStyle} left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;`;
      demoHtml += `
        <div class="floating-shape shape-${shape} univ-shape pl-demo" data-track-id="${t.id}"
             style="${posStyle}"
             onclick="openFolderShorts('${playlistId}','${t.id}')"
             title="${safeTitle} — ${safeArtist}">
          <div class="shape-text">${safeLines.join('\n')}</div>
        </div>
      `;
    });

    section2Html = `
      <section class="pl-section pl-section-demo">
        <h2 class="pl-section-title"><i class="ri-edit-2-fill"></i> 데모 섞인거 <span class="pl-count">${demoTracks.length}</span></h2>
        <p class="pl-section-sub">아직 다듬는 중인 곡들 — 거친 톤 그대로</p>
        <div class="shapes-universe pl-universe pl-demo-universe" style="height: ${sec2H}px;">
          ${demoHtml}
        </div>
      </section>
    `;
  } else {
    section2Html = `
      <section class="pl-section pl-section-demo">
        <h2 class="pl-section-title"><i class="ri-edit-2-fill"></i> 데모 섞인거</h2>
        <p class="pl-section-empty">데모 버전 곡이 담기면 여기 나와요</p>
      </section>
    `;
  }

  // -------- SECTION 3: 응원 포스트잇 --------
  let section3Html = '';
  if (notes.length > 0) {
    const notesHtml = notes.map((n, i) => {
      const c = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
      const rot = ((i % 2 === 0 ? -1 : 1) * (Math.random() * 4 + 1));
      const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const safeAuth = (n.author || '').replace(/</g,'&lt;');
      const encAuth = encodeURIComponent(n.author || '');
      return `
        <div class="pl-postit" style="background:${c.bg}; color:${c.text}; --rot:${rot}deg;" onclick="openFolderShorts('${playlistId}','${n.id}')" title="눌러서 쇼츠로 보기">
          <div class="pl-postit-body">${safeTxt}</div>
          <div class="pl-postit-sig">— ${safeAuth}</div>
        </div>
      `;
    }).join('');
    section3Html = `
      <section class="pl-section pl-section-notes">
        <h2 class="pl-section-title"><i class="ri-sticky-note-fill"></i> 담은 포스트잇 <span class="pl-count">${notes.length}</span></h2>
        <p class="pl-section-sub">눌러서 쇼츠로 한 장씩 넘겨봐</p>
        <div class="pl-postit-grid">${notesHtml}</div>
      </section>
    `;
  } else {
    section3Html = `
      <section class="pl-section pl-section-notes">
        <h2 class="pl-section-title"><i class="ri-sticky-note-fill"></i> 담은 포스트잇</h2>
        <p class="pl-section-empty">${_t('즐겨찾기에서 포스트잇을 이 폴더로 끌어다 담아보세요 📌', 'Drag notes from Favorites into this folder 📌')}</p>
      </section>
    `;
  }

  // -------- SECTION 4: 감성 TAG --------
  let section4Html = '';
  if (tagList.length > 0) {
    const tagsHtml = tagList.map(tag => {
      const cnt = tagCounts[tag];
      const size = tagFontSize(cnt, maxTag) + 8;
      const safeTag = (tag || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const sd = _hashSeed('home-tag:' + tag);
      const rot = ((((sd) % 80) - 40) / 10);
      const dur = 14 + ((sd >>> 7) % 14);
      const dx = ((sd >>> 13) % 30) - 15;
      const dy = ((sd >>> 19) % 30) - 15;
      return `
        <span class="pl-tag-bubble" style="color:${tagColor(tag)}; font-size:${size}px; --rot:${rot}deg; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px;" onclick="navigateToTag('${jsEscape(tag)}')" title="${safeTag} · ${cnt}곡">
          #${safeTag}
        </span>
      `;
    }).join('');
    section4Html = `
      <section class="pl-section pl-section-tags">
        <h2 class="pl-section-title"><i class="ri-hashtag"></i> 감성 태그 <span class="pl-count">${tagList.length}</span></h2>
        <p class="pl-section-sub">이 폴더의 무드 — 클릭해서 비슷한 곡 더 찾기</p>
        <div class="pl-tag-cloud">${tagsHtml}</div>
      </section>
    `;
  } else {
    section4Html = `
      <section class="pl-section pl-section-tags">
        <h2 class="pl-section-title"><i class="ri-hashtag"></i> 감성 태그</h2>
        <p class="pl-section-empty">곡들에 태그가 붙으면 여기에 모여요</p>
      </section>
    `;
  }

  const safePlaylistTitle = (playlist.title || '플레이리스트').replace(/</g,'&lt;');

  // ── 폴더 내부 = 똑같은 '우주' (곡/포스트잇 둥둥, 누르면 쇼츠) ──
  const built = _folderItemsHtml(playlistId);

  if (built.total === 0) {
    appContent.innerHTML = `
      <div class="pl-page pl-universe-page">
        <div class="pl-header">
          <button class="pl-back" onclick="navigateTo('universe')" aria-label="즐겨찾기로"><i class="ri-arrow-left-line"></i></button>
          <div class="pl-title-block">
            <div class="pl-eyebrow">내 음악 폴더</div>
            <h1 class="pl-title">${safePlaylistTitle}</h1>
          </div>
        </div>
        <div class="pl-empty-page">
          <div style="font-size:40px; margin-bottom:12px;">🎵</div>
          <p>${_t('이 폴더는 아직 비어 있어요.<br>즐겨찾기에서 곡이나 포스트잇을 이 폴더로 끌어다 담아보세요.', 'This folder is empty.<br>Drag tracks or notes here from Favorites.')}</p>
        </div>
      </div>`;
    return;
  }

  // 내 우주와 '같은' 별 하늘 — 폴더 안/밖이 하나의 우주처럼 이어지게.
  const folderDeco = _buildStarfield('universe-sky', 160, 15);

  appContent.innerHTML = `
    <div class="pl-page pl-universe-page">
      <div class="pl-header">
        <button class="pl-back" onclick="navigateTo('universe')" aria-label="내 우주로"><i class="ri-arrow-left-line"></i></button>
        <div class="pl-title-block">
          <div class="pl-eyebrow">내 음악 폴더</div>
          <h1 class="pl-title">${safePlaylistTitle}</h1>
          <div class="pl-meta">🎵 ${built.trackCount} 곡 · 📝 ${built.noteCount} 포스트잇 — 눌러서 쇼츠로</div>
        </div>
        <button class="pl-shorts-btn" onclick="openFolderShorts('${playlistId}','${built.firstId}')"><i class="ri-stack-fill"></i> 쇼츠로 보기</button>
      </div>
      <div class="shapes-universe my-universe pl-folder-universe" style="height:${built.height}px;">
        ${folderDeco}
        ${built.html}
      </div>
    </div>`;
}

// ============================================================
// 폴더 쇼츠 모드 🎞️ — 폴더 안의 곡/포스트잇을 '포스트잇 한 장'씩 세로로
// 넘기며(뜯기 애니) 보는 모드. 곡은 연속 재생(직접 누를 때만 교체).
// 폴더 안에서 곡이나 포스트잇을 누르면 진입.
// ============================================================

// 폴더에 담은 포스트잇(note) id 저장 — 곡은 플레이리스트(서버), 포스트잇은 로컬.
function _folderNotesKey(folderId) { return 'folder_notes:' + folderId; }
function _getFolderNoteIds(folderId) {
  // 서버 캐시(__folderNotes — 다른 기기와 동기화) 우선. 로딩 전/오프라인이면 localStorage 폴백.
  if (window.__folderNotes && window.__folderNotes[folderId]) return window.__folderNotes[folderId];
  try {
    const raw = localStorage.getItem(_folderNotesKey(folderId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (_) { return new Set(); }
}
function _addNoteToFolder(folderId, noteId) {
  const s = _getFolderNoteIds(folderId);
  s.add(noteId);
  if (!window.__folderNotes) window.__folderNotes = {};
  window.__folderNotes[folderId] = s;                                                            // 캐시(동기화 소스)
  try { localStorage.setItem(_folderNotesKey(folderId), JSON.stringify([...s])); } catch (_) {}  // 오프라인 미러
  // 서버 저장 → 다른 기기 동기화
  if (window.Playlists && window.Playlists.addNote) {
    window.Playlists.addNote(folderId, noteId).catch(e => console.warn('[addNoteToFolder] server', e && e.message));
  }
}

// 내 우주에서 포스트잇 오브제를 폴더 위로 드롭했을 때 호출.
// 수집(북마크)은 그대로 유지 — 폴더에 담긴 건 떠다니는 우주에서만 빠진다(폴더 안에 있으니까).
window._dropNoteIntoFolder = function (noteId, folderId) {
  if (!noteId || !folderId) return;
  _addNoteToFolder(folderId, noteId);
  if (typeof showToast === 'function') showToast(_t('폴더에 담았어요 📌', 'Added to folder 📌'));
  // 끊김 방지 — 전체 renderUniverse() 대신 드롭된 노트만 DOM 에서 제거 +
  // 폴더 배지 카운트 surgical update. (다른 도형들 transform/움직임 보존)
  _surgicalDropCleanup({ itemSelector: `[data-note-id="${noteId}"]`, folderId });
};

// 폴더로 떨어뜨린 항목만 DOM 에서 깔끔히 제거 + 폴더 카운트 살짝 갱신.
// 전체 universe 재렌더 없이 다른 도형/노트의 움직임을 보존한다.
function _surgicalDropCleanup({ itemSelector, folderId }) {
  try {
    // 1) 떨어뜨린 항목은 이미 transform:scale(0.15)+opacity:0 로 사라지는 중 — 정리만.
    const droppedEls = document.querySelectorAll(itemSelector);
    setTimeout(() => {
      droppedEls.forEach(el => { try { el.remove(); } catch (_) {} });
    }, 260);   // pointerUp 의 0.25s 흡수 애니메이션 끝난 직후

    // 2) 폴더 카운트 배지 갱신 — 없으면 1, 있으면 +1
    if (folderId) {
      const folderEl = document.querySelector(`[data-folder-id="${folderId}"]`);
      if (folderEl) {
        const badge = folderEl.querySelector('.folder-orb-count, .folder-count, .playlist-count, [data-folder-count]');
        if (badge) {
          const cur = parseInt(badge.textContent, 10) || 0;
          badge.textContent = String(cur + 1);
        }
        // 폴더에 살짝 '받았다' 펄스 — 시각 피드백
        folderEl.classList.add('folder-receive-pulse');
        setTimeout(() => folderEl.classList.remove('folder-receive-pulse'), 500);
      }
    }
  } catch (e) { console.warn('[universe] surgicalDropCleanup', e); }
}

// 폴더에서 항목(곡/포스트잇) 빼기 — 잘못 담았을 때. 수집 자체는 유지되니
// 빼면 다시 떠다니는 내 우주로 돌아온다.
window._removeFromFolder = async function (folderId, id, kind) {
  if (!folderId || !id) return;
  if (kind === 'note') {
    const s = _getFolderNoteIds(folderId);
    s.delete(id);
    if (!window.__folderNotes) window.__folderNotes = {};
    window.__folderNotes[folderId] = s;
    try { localStorage.setItem(_folderNotesKey(folderId), JSON.stringify([...s])); } catch (_) {}
    if (window.Playlists && window.Playlists.removeNote) {
      try { await window.Playlists.removeNote(folderId, id); } catch (e) { console.warn('[removeFromFolder] note server', e && e.message); }
    }
  } else {
    try {
      if (window.Playlists && window.Playlists.removeTrack) {
        await window.Playlists.removeTrack(folderId, id);
        await window.Playlists.refreshInto(window.DB.get());
      } else if (window.DB && window.DB.removeTrackFromPlaylist) {
        window.DB.removeTrackFromPlaylist(folderId, id);
      }
    } catch (e) { console.warn('[removeFromFolder]', e); }
  }
  if (typeof showToast === 'function') showToast(_t('폴더에서 뺐어요', 'Removed from folder'));
  if (typeof renderSidebarPlaylists === 'function') renderSidebarPlaylists();
  // 보고 있던 폴더 화면 다시 그리기
  if (window.__universeFolderId === folderId && typeof _renderFolderUniverse === 'function') {
    _renderFolderUniverse(folderId);
  } else if (currentView === 'playlist' && typeof renderPlaylistUniverse === 'function') {
    renderPlaylistUniverse(folderId);
  }
};

// 어느 폴더든 담겨 있는 포스트잇/곡 id 모음 (떠다니는 내 우주에서 제외하려고)
function _allFolderedNoteIds() {
  const ids = new Set();
  // 서버 캐시(__folderNotes — 기기 간 동기화) 우선. 로드되면 이게 진실원천이라,
  // 다른 기기서 폴더에 넣은 노트도 '밖(우주)'에서 제대로 제외됨(중복 방지).
  if (window.__folderNotes) {
    Object.keys(window.__folderNotes).forEach(pid => {
      const s = window.__folderNotes[pid];
      if (s && s.forEach) s.forEach(id => ids.add(id));
    });
    return ids;
  }
  // 아직 서버 로드 전 → localStorage 폴백
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('folder_notes:') === 0) {
        (JSON.parse(localStorage.getItem(k) || '[]') || []).forEach(id => ids.add(id));
      }
    }
  } catch (_) {}
  return ids;
}
function _allFolderedTrackIds() {
  const ids = new Set();
  try {
    const lists = Array.isArray(window.__playlists)
      ? window.__playlists
      : ((window.DB.get().playlists) || []);
    lists.forEach(p => (p.trackIds || []).forEach(id => ids.add(id)));
  } catch (_) {}
  return ids;
}

// 폴더 안 아이템(곡 + 담긴 포스트잇)을 한 번 정해진 랜덤 순서로 반환.
function _buildFolderCards(playlist) {
  const db = window.DB.get();
  const allTracks = Array.isArray(db.tracks) ? db.tracks : [];
  const allNotes = Array.isArray(db.notes) ? db.notes : [];
  const trackIdsSet = new Set(playlist.trackIds || []);
  const tracks = allTracks.filter(t => t && trackIdsSet.has(t.id));
  const noteIds = _getFolderNoteIds(playlist.id);
  const notes = allNotes.filter(n => n && noteIds.has(n.id));
  let items = [
    ...tracks.map(t => ({ kind: 'track', id: t.id })),
    ...notes.map(n => ({ kind: 'note', id: n.id }))
  ];
  // 시드 셔플 — 폴더+아이템 id 기준이라 다시 열어도 순서 유지
  items = items
    .map(it => ({ it, k: _hashSeed('shorts:' + playlist.id + ':' + it.id) }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.it);
  return items;
}

const _shEsc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 폴더 안에서 드래그로 옮긴 위치 저장/불러오기 (폴더별로 구분)
function _loadPlPos(playlistId, id) {
  try {
    const raw = localStorage.getItem('plpos:' + playlistId + ':' + id);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.xPct !== 'number' || typeof p.yPx !== 'number') return null;
    return p;
  } catch (_) { return null; }
}

// 폴더 우주의 떠다니는 아이템 HTML 생성 — 폴더 페이지 + 진입 전환이 같은 위치를
// 쓰도록 한 곳에서 만든다. (곡=도형, 포스트잇=노트, 누르면 쇼츠)
function _folderItemsHtml(playlistId) {
  const db = window.DB.get();
  let playlist = (db.playlists || []).find(p => p.id === playlistId);
  if (!playlist && Array.isArray(window.__playlists)) playlist = window.__playlists.find(p => p.id === playlistId);
  if (!playlist) return { html: '', height: 820, firstId: '', trackCount: 0, noteCount: 0, total: 0 };
  const trackIdsSet = new Set(playlist.trackIds || []);
  const merged = (Array.isArray(db.tracks) ? db.tracks : []).slice();
  if (Array.isArray(window.__tracks)) {
    const seen = new Set(merged.map(t => t && t.id));
    window.__tracks.forEach(t => { if (t && !seen.has(t.id)) merged.push(t); });
  }
  const tracks = merged.filter(t => t && trackIdsSet.has(t.id));
  const noteIds = _getFolderNoteIds(playlistId);
  const notes = (Array.isArray(db.notes) ? db.notes : []).filter(n => n && noteIds.has(n.id));
  const items = [
    ...tracks.map(t => ({ kind: 'track', t, id: t.id })),
    ...notes.map(n => ({ kind: 'note', n, id: n.id }))
  ];
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cols = (typeof window !== 'undefined' && window.innerWidth < 560) ? 2 : 3;
  // 모바일(2칸)은 도형이 커서 칸 간격을 좁히고 우측 한계를 둬서 오른쪽으로 안 넘치게.
  const colSpan = (cols === 2) ? 40 : (86 / cols);
  const maxX = (cols === 2) ? 52 : 90;
  const height = Math.max(820, Math.ceil(items.length / cols) * 280);
  if (typeof _dpStyle === 'function') _dpStyle();   // 발견/즐겨찾기와 동일한 dp- 도형 CSS
  let html = '';
  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const seed = _hashSeed('plitem:' + playlistId + ':' + it.id);
    const _sp = _loadPlPos(playlistId, it.id);   // 드래그로 옮긴 위치 있으면 사용
    // 좌우 균형 잡힌 흔들기(+만 주면 전부 오른쪽으로 쏠림 → 치우쳐 보임)
    const jitterX = (seed % 9) - 4;
    let xBase = _sp ? _sp.xPct : (5 + col * colSpan + jitterX);
    if (!_sp) xBase = Math.max(3, Math.min(xBase, maxX));
    const yPx = _sp ? _sp.yPx : (30 + row * 260 + ((seed >>> 4) % 50));
    const rot = ((((seed >>> 8) % 140) - 70) / 10);
    const dur = 11 + ((seed >>> 16) % 16);
    const dx = (((seed >>> 12) % 50) - 25);
    const dy = (((seed >>> 20) % 50) - 25);
    if (it.kind === 'track') {
      const t = it.t;
      // 발견/메인 즐겨찾기와 통일 — dp- 도형/레트로색/해시태그. 클릭은 폴더 쇼츠 유지.
      const _DPC = ['#E24A9C','#7FB2EC','#86CE34','#B49BEE','#F06CA8','#FF8A6E','#26C6C6','#FFB03A'];
      const _DPS = ['burst','circle','tri'];
      const _dc = _DPS[i % _DPS.length], _dcol = _DPC[i % _DPC.length];
      const _tags = (Array.isArray(t.tags) && t.tags.length) ? t.tags.slice(0,3)
                  : [t.title || '곡', t.artist || ''].filter(Boolean).slice(0,3);
      const _tagHtml = _tags.map(tg => '#' + String(tg).replace(/^#/, '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).join('<br>');
      html += `
        <div class="floating-shape dp-univ${_dc==='tri' ? ' dp-tri-wrap' : ''}" data-track-id="${t.id}" data-folder-id="${playlistId}"
             style="left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;"
             onclick="openFolderShorts('${playlistId}','${t.id}')">
          <div class="dp-shape dp-${_dc}" style="background:${_dcol}"></div>
          <div class="dp-s-text">${_tagHtml}</div>
        </div>`;
    } else {
      const n = it.n;
      const c = (typeof NOTE_COLORS !== 'undefined' ? NOTE_COLORS[n.color] : null) || { bg: '#FFF59D', text: '#1a1a1a' };
      const safeTxt = (n.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const safeAuth = (n.author || '').replace(/</g, '&lt;');
      html += `
        <div class="universe-note floating-shape" data-note-id="${n.id}" data-folder-id="${playlistId}"
             style="left:${xBase}%; top:${yPx}px; background:${c.bg}; color:${c.text}; animation: floatDrift ${dur + 4}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;"
             onclick="openFolderShorts('${playlistId}','${n.id}')">
          <div class="universe-note-body">${safeTxt}</div>
          <div class="universe-note-sig">— ${safeAuth}</div>
          ${(typeof _renderNoteTrackChip === 'function') ? _renderNoteTrackChip(n) : ''}
        </div>`;
    }
  });
  return { html, height, firstId: (items[0] && items[0].id) || '', trackCount: tracks.length, noteCount: notes.length, total: items.length };
}

// 진입점 — 폴더 안에서 곡/포스트잇 누르면 호출
window.openFolderShorts = async function (playlistId, startId) {
  // 롱프레스 메뉴(폴더에서 빼기)가 떠 있는 동안 들어온 '유령 클릭'이면 쇼츠를 열지 않는다.
  if (document.getElementById('shape-longpress-menu')) return;
  const db = window.DB.get();
  let playlist = (db.playlists || []).find(p => p.id === playlistId);
  if (!playlist && window.Playlists && window.Playlists.fetchMine) {
    try { const all = await window.Playlists.fetchMine(); playlist = (all || []).find(p => p.id === playlistId); }
    catch (_) {}
  }
  if (!playlist) return;
  let items = _buildFolderCards(playlist);
  if (!items.length) { if (typeof showToast === 'function') showToast(_t('이 폴더는 비어 있어요', 'This folder is empty')); return; }
  // 순서는 매번 무작위 — 누른 아이템을 1번으로, 그 뒤는 랜덤. (Fisher–Yates)
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  if (startId) {
    const si = items.findIndex(x => x.id === startId);
    if (si > 0) { const [s] = items.splice(si, 1); items.unshift(s); }
  }
  const idx = 0;
  window.__shorts = { playlistId, items, idx, title: playlist.title || '폴더' };
  _shortsMount();
  // 곡을 눌러서 들어왔으면 그 곡 바로 재생
  const cur = items[idx];
  if (cur && cur.kind === 'track' && typeof playTrack === 'function') playTrack(cur.id, 'shorts');
};

function _shortsCardHtml(item) {
  const db = window.DB.get();
  if (item.kind === 'note') {
    const n = (db.notes || []).find(x => x && x.id === item.id) || {};
    const c = (typeof NOTE_COLORS !== 'undefined' ? NOTE_COLORS[n.color] : null) || { bg: '#FFF59D', text: '#1a1a1a' };
    const body = _shEsc(n.text || '').replace(/\n/g, '<br>');
    const author = _shEsc(n.author || '익명');
    let songBtn = '';
    if (n.trackId) {
      const t = (db.tracks || []).find(x => x && x.id === n.trackId);
      if (t) songBtn = `<button class="shorts-play" onclick="_shortsPlay('${t.id}')"><i class="ri-play-circle-fill"></i> ${_shEsc(t.title || '곡')} 듣기</button>`;
    } else if (n.externalUrl) {
      songBtn = `<a class="shorts-play" href="${(n.externalUrl||'').replace(/"/g,'&quot;')}" target="_blank" rel="noopener"><i class="ri-external-link-line"></i> 링크 열기</a>`;
    }
    return `
      <div class="shorts-card note-paper" style="--paper:${c.bg}; --ink:${c.text};">
        <div class="shorts-paper-tape"></div>
        <div class="shorts-kind">📌 포스트잇</div>
        <div class="shorts-card-body">${body || '...'}</div>
        <div class="shorts-card-sig">— ${author}</div>
        ${songBtn}
      </div>`;
  }
  // track → 포스트잇 형태
  const t = (db.tracks || []).find(x => x && x.id === item.id) || {};
  const cover = t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=300';
  const title = _shEsc(t.title || '제목 없음');
  const artist = _shEsc(t.artist || '');
  const desc = _shEsc(t.description || t.artistNote || '').replace(/\n/g, '<br>');
  return `
    <div class="shorts-card track-paper">
      <div class="shorts-paper-tape"></div>
      <div class="shorts-kind">🎵 곡</div>
      <img class="shorts-cover" src="${cover}" alt="" loading="lazy" draggable="false">
      <div class="shorts-card-title">${title}</div>
      <div class="shorts-card-artist">${artist}</div>
      ${desc ? `<div class="shorts-card-body">${desc}</div>` : `<div class="shorts-card-body shorts-card-body-dim">소개글이 아직 없어요</div>`}
      <button class="shorts-play" onclick="_shortsPlay('${t.id}')"><i class="ri-play-circle-fill"></i> 이 곡 듣기</button>
    </div>`;
}

function _shortsCommentsOf(item) {
  const db = window.DB.get();
  if (item.kind === 'note') {
    const n = (db.notes || []).find(x => x && x.id === item.id);
    return (n && Array.isArray(n.comments)) ? n.comments : [];
  }
  const t = (db.tracks || []).find(x => x && x.id === item.id);
  return (t && Array.isArray(t.trackComments)) ? t.trackComments : [];
}

function _shortsRenderComments() {
  const st = window.__shorts; if (!st) return;
  const list = document.getElementById('shorts-cm-list');
  if (!list) return;
  const cms = _shortsCommentsOf(st.items[st.idx]);
  const cnt = document.getElementById('shorts-cm-count');
  if (cnt) cnt.textContent = cms.length ? cms.length : '';
  list.innerHTML = cms.length === 0
    ? `<div class="shorts-cm-empty">${_i18n('아직 댓글이 없어요.<br>첫 댓글을 남겨보세요 ✏️', 'No comments yet.<br>Be the first ✏️')}</div>`
    : cms.map(cm => `
        <div class="shorts-cm">
          <span class="shorts-cm-auth">${_shEsc(cm.author || '익명')}</span>
          <span class="shorts-cm-text">${_shEsc(cm.text || '')}</span>
        </div>`).join('');
  list.scrollTop = list.scrollHeight;
}

// 곡 카드 댓글을 처음 한 번 서버에서 불러와 채움
async function _shortsMaybeLoadTrackComments() {
  const st = window.__shorts; if (!st) return;
  const item = st.items[st.idx];
  if (!item || item.kind !== 'track') return;
  const db = window.DB.get();
  const t = (db.tracks || []).find(x => x && x.id === item.id);
  if (!t || t._commentsLoaded || !t.__supabase || !window.Tracks || !window.Tracks.fetchComments) return;
  t._commentsLoaded = true;
  try {
    const comments = await window.Tracks.fetchComments(item.id);
    t.trackComments = comments;
    try { window.DB.save(db); } catch (_) {}
    if (window.__shorts && window.__shorts.items[window.__shorts.idx] && window.__shorts.items[window.__shorts.idx].id === item.id) {
      _shortsRenderComments();
    }
  } catch (_) {}
}

function _shortsUpdateChrome() {
  const st = window.__shorts; if (!st) return;
  const prog = document.getElementById('shorts-progress');
  if (prog) prog.textContent = (st.idx + 1) + ' / ' + st.items.length;
  const up = document.getElementById('shorts-up');
  const down = document.getElementById('shorts-down');
  if (up) up.classList.toggle('disabled', st.idx <= 0);
  if (down) down.classList.toggle('disabled', st.idx >= st.items.length - 1);
}

function _shortsGo(dir) {
  const st = window.__shorts; if (!st) return;
  const ni = st.idx + (dir === 'next' ? 1 : -1);
  if (ni < 0 || ni >= st.items.length) return;
  const stage = document.getElementById('shorts-stage'); if (!stage) return;
  const cur = stage.querySelector('.shorts-card:not(.tear-out-up):not(.tear-out-down)');
  st.idx = ni;
  const wrap = document.createElement('div');
  wrap.innerHTML = _shortsCardHtml(st.items[ni]);
  const card = wrap.firstElementChild;
  card.classList.add(dir === 'next' ? 'tear-in-up' : 'tear-in-down');
  if (cur) { cur.classList.add(dir === 'next' ? 'tear-out-up' : 'tear-out-down'); setTimeout(() => cur.remove(), 460); }
  stage.appendChild(card);
  _shortsRenderComments();
  _shortsUpdateChrome();
  _shortsMaybeLoadTrackComments();
}

window._shortsPlay = function (trackId) {
  if (trackId && typeof playTrack === 'function') playTrack(trackId, 'shorts');
};

window._shortsSubmitComment = async function (formEl) {
  const st = window.__shorts; if (!st || !formEl) return;
  const item = st.items[st.idx]; if (!item) return;
  const input = formEl.querySelector('.shorts-cm-input');
  const text = (input && input.value || '').trim();
  if (!text) return;
  input.value = '';
  const db = window.DB.get();
  const author = (window.__currentUser && window.__currentUser.name)
    || (db.currentUser && db.currentUser.name) || '익명';
  try {
    if (item.kind === 'note') {
      let newCm = null;
      if (window.Walls && window.Walls.addComment) newCm = await window.Walls.addComment(item.id, { text });
      if (!newCm) newCm = { id: 'c' + Date.now(), author, text };
      const n = (db.notes || []).find(x => x && x.id === item.id);
      if (n) { if (!Array.isArray(n.comments)) n.comments = []; n.comments.push(newCm); window.DB.save(db); }
    } else {
      let newCm = null;
      if (window.Tracks && window.Tracks.addComment) newCm = await window.Tracks.addComment(item.id, { text, authorName: author });
      if (!newCm) newCm = { id: 'c' + Date.now(), author, text };
      const t = (db.tracks || []).find(x => x && x.id === item.id);
      if (t) { if (!Array.isArray(t.trackComments)) t.trackComments = []; t.trackComments.push(newCm); window.DB.save(db); }
    }
  } catch (e) { console.warn('[shorts] addComment', e); }
  _shortsRenderComments();
};

window.closeFolderShorts = function () {
  const ov = document.getElementById('shorts-overlay');
  if (ov) ov.remove();
  if (window.__shortsKeyHandler) { document.removeEventListener('keydown', window.__shortsKeyHandler); window.__shortsKeyHandler = null; }
  window.__shorts = null;
};

function _shortsMount() {
  const st = window.__shorts; if (!st) return;
  let ov = document.getElementById('shorts-overlay');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'shorts-overlay';
  ov.className = 'shorts-overlay';
  ov.innerHTML = `
    <div class="shorts-top">
      <button class="shorts-close" onclick="closeFolderShorts()" aria-label="닫기"><i class="ri-arrow-left-line"></i></button>
      <div class="shorts-title">${_shEsc(st.title)}</div>
      <div class="shorts-progress" id="shorts-progress"></div>
    </div>
    <div class="shorts-body">
      <div class="shorts-main">
        <div class="shorts-stage" id="shorts-stage"></div>
        <div class="shorts-navhint">
          <button class="shorts-nav" id="shorts-up" onclick="_shortsGo('prev')" aria-label="이전"><i class="ri-arrow-up-s-line"></i></button>
          <button class="shorts-nav" id="shorts-down" onclick="_shortsGo('next')" aria-label="다음"><i class="ri-arrow-down-s-line"></i></button>
        </div>
      </div>
      <aside class="shorts-side" id="shorts-side">
        <div class="shorts-side-head" onclick="document.getElementById('shorts-overlay').classList.toggle('cm-open')">
          <span class="shorts-side-grab"></span>
          <i class="ri-chat-3-line"></i> 댓글 <span id="shorts-cm-count"></span>
          <i class="ri-arrow-up-s-line shorts-side-caret"></i>
        </div>
        <div class="shorts-cm-list" id="shorts-cm-list"></div>
        <form class="shorts-cm-form" onsubmit="event.preventDefault(); _shortsSubmitComment(this);">
          <input type="text" class="shorts-cm-input" maxlength="200" placeholder="댓글 달기…">
          <button type="submit" class="shorts-cm-send"><i class="ri-send-plane-fill"></i></button>
        </form>
      </aside>
    </div>
  `;
  document.body.appendChild(ov);

  // 첫 카드
  const stage = ov.querySelector('#shorts-stage');
  const wrap = document.createElement('div');
  wrap.innerHTML = _shortsCardHtml(st.items[st.idx]);
  const card = wrap.firstElementChild;
  card.classList.add('tear-in-up');
  stage.appendChild(card);
  _shortsRenderComments();
  _shortsUpdateChrome();
  _shortsMaybeLoadTrackComments();

  // 손가락으로 넘길 때 뒤(우주 페이지)가 같이 움직이지 않게 — 댓글 목록만 스크롤 허용,
  // 그 외 영역의 기본 스크롤(배경 따라 움직임/고무줄)은 전부 막는다.
  ov.addEventListener('touchmove', (e) => {
    if (e.target.closest('.shorts-cm-list')) return;  // 댓글 목록만 통과
    e.preventDefault();
  }, { passive: false });

  // 댓글 시트가 열려 있을 때 시트 바깥(카드·빈 공간)을 탭하면 닫힌다.
  ov.addEventListener('click', (e) => {
    if (!ov.classList.contains('cm-open')) return;
    if (e.target.closest('.shorts-side')) return;   // 시트 안 탭은 유지
    ov.classList.remove('cm-open');
  });

  // 휠 / 스와이프 / 키보드
  let wheelLock = false;
  ov.addEventListener('wheel', (e) => {
    if (e.target.closest('.shorts-side')) return;  // 댓글 스크롤은 통과
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true; setTimeout(() => wheelLock = false, 480);
    _shortsGo(e.deltaY > 0 ? 'next' : 'prev');
  }, { passive: false });

  // 위아래 스와이프 — 손가락 따라 카드가 끌려오고, 놓으면 다음/이전으로 넘어가거나 스프링백.
  //   (도형 쇼츠와 같은 라이브 모션. 단순 감지가 아니라 실시간 transform 동기화.)
  const main = ov.querySelector('.shorts-main');
  let ty0 = null, tx0 = null, dragCard = null, dragging = false;
  main.addEventListener('touchstart', (e) => {
    if (!e.touches[0]) return;
    if (e.target.closest('.shorts-side, .shorts-nav, .shorts-close, .shorts-cm-list')) { ty0 = null; return; }
    ty0 = e.touches[0].clientY; tx0 = e.touches[0].clientX;
    dragCard = ov.querySelector('.shorts-card:not(.tear-out-up):not(.tear-out-down)');
    dragging = false;
    if (dragCard) { dragCard.style.transition = 'none'; dragCard.style.willChange = 'transform'; }
  }, { passive: true });
  main.addEventListener('touchmove', (e) => {
    if (ty0 == null || !dragCard || !e.touches[0]) return;
    const dy = e.touches[0].clientY - ty0;
    const dx = e.touches[0].clientX - tx0;
    if (!dragging && Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
    dragging = true;
    if (e.cancelable) e.preventDefault();
    dragCard.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  main.addEventListener('touchend', (e) => {
    if (ty0 == null) { dragCard = null; dragging = false; return; }
    const t = e.changedTouches[0];
    const dy = t ? t.clientY - ty0 : 0;
    const dx = t ? t.clientX - tx0 : 0;
    ty0 = tx0 = null;
    const c = dragCard; dragCard = null;
    const was = dragging; dragging = false;
    if (!c) return;
    const st2 = window.__shorts;
    // 위/아래 스와이프 인정: 50px 이상 + 세로 우세(대각선 22° 허용)
    if (was && st2 && Math.abs(dy) >= 50 && Math.abs(dy) >= Math.abs(dx) * 0.4) {
      const dir = dy < 0 ? 'next' : 'prev';
      const ni = st2.idx + (dir === 'next' ? 1 : -1);
      if (ni >= 0 && ni < st2.items.length) {
        // 넘어감 — 인라인 transform 걷어내고 tear 애니에 양보
        c.style.transition = ''; c.style.transform = ''; c.style.willChange = '';
        _shortsGo(dir);
        return;
      }
    }
    // 임계 미달 또는 경계(첫/마지막) → 부드럽게 원위치
    if (was) {
      c.style.transition = 'transform 0.34s cubic-bezier(0.34,1.56,0.64,1)';
      c.style.transform = 'translateY(0)';
      c.style.willChange = '';
    }
  }, { passive: true });

  window.__shortsKeyHandler = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _shortsGo('next'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _shortsGo('prev'); }
    else if (e.key === 'Escape') { closeFolderShorts(); }
  };
  document.addEventListener('keydown', window.__shortsKeyHandler);
}

// ============================================================
// 도형 쇼츠 🎴 — 모바일 전용. 도형을 '원래 모양 그대로' 크게 화면에 띄워
// 글자를 잘 보이게 하고, 위/아래로 넘기면 랜덤 다음 곡이 자동 재생.
// 오른쪽 아래 아티스트 이름 누르면 그 아티스트 페이지로.
// ============================================================
window.__shapeShorts = null;

function _isMobileShorts() {
  try { return window.matchMedia('(max-width: 768px)').matches; } catch (_) { return window.innerWidth <= 768; }
}

window.openShapeShorts = function (startTrackId) {
  if (!_isMobileShorts()) return false;  // 모바일 전용
  const db = window.DB.get();
  let tracks = (Array.isArray(db.tracks) ? db.tracks : []).slice();
  if (Array.isArray(window.__tracks)) {
    const seen = new Set(tracks.map(t => t && t.id));
    window.__tracks.forEach(t => { if (t && !seen.has(t.id)) tracks.push(t); });
  }
  tracks = tracks.filter(t => t && t.version !== 'demo_retired' && t.audioUrl !== undefined);
  if (!tracks.length) return false;
  // 랜덤 순서 (알고리즘 없음) — Fisher–Yates
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  }
  // 탭해서 들어온 도형은 맨 앞으로
  if (startTrackId) {
    const idx = tracks.findIndex(t => t.id === startTrackId);
    if (idx > 0) { const [s] = tracks.splice(idx, 1); tracks.unshift(s); }
  }
  window.__shapeShorts = { tracks, idx: 0 };
  _shapeShortsMount();
  return true;
};

function _shapeShortsCardHtml(t) {
  const artist = (t.artist || '아티스트').replace(/</g, '&lt;');
  // 자켓 모드: 풀스크린은 '커버를 크게(선명)' — 도형 대신 자켓. (탭해서 들어온 곳과 일관)
  if (window.__discoverMode === 'jacket') {
    const _cover = t.cover || '';
    const _hasCover = /^https?:\/\//i.test(_cover);
    const _col = SHAPE_COLORS[(_hashSeed('shape-col:' + t.id) >>> 0) % SHAPE_COLORS.length];
    const _bg = _hasCover
      ? `background-image:url('${_cover.replace(/'/g, '%27')}')`
      : `background-image:linear-gradient(140deg, ${_col}, rgba(0,0,0,0.55))`;
    return `
    <div class="sshorts-stage">
      <div class="sshorts-jacket" style="${_bg}"></div>
      <button class="sshorts-artist" onclick="_shapeShortsGoArtist('${encodeURIComponent(t.artist || '')}')">${artist}</button>
    </div>`;
  }
  let shape = t.shape || SHAPE_TYPES[0];
  if (SHAPE_REMAP[shape]) shape = SHAPE_REMAP[shape];
  const color = t.shapeColor || '#FF9800';
  const isTri = shape === 'triangle';
  const bg = isTri ? `border-bottom-color:${color}; color:${color}; --shape-bg:${color};` : `background:${color}; --shape-bg:${color};`;
  const lines = t.lines || [t.title || '', t.artist || '', '클릭해서 들어봐!'];
  const safeLines = lines.map(l => (l || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return `
    <div class="sshorts-stage">
      <div class="floating-shape shape-${shape} sshorts-shape" style="${bg}">
        <div class="shape-text">${safeLines.join('\n')}</div>
      </div>
      <button class="sshorts-artist" onclick="_shapeShortsGoArtist('${encodeURIComponent(t.artist || '')}')">${artist}</button>
    </div>`;
}

function _shapeShortsRenderChrome() {
  const st = window.__shapeShorts; if (!st) return;
  const prog = document.getElementById('sshorts-progress');
  if (prog) prog.textContent = (st.idx + 1) + ' / ' + st.tracks.length;
}

function _shapeShortsPlayCurrent() {
  const st = window.__shapeShorts; if (!st) return;
  const t = st.tracks[st.idx];
  if (t && typeof playTrack === 'function') playTrack(t.id, 'shapeshorts');
}

function _shapeShortsGo(dir) {
  const st = window.__shapeShorts; if (!st) return;
  if (st._animating) return;                    // 전환 중 중복 입력 무시
  const ni = st.idx + (dir === 'next' ? 1 : -1);
  if (ni < 0 || ni >= st.tracks.length) return;
  const stage = document.getElementById('sshorts-body'); if (!stage) return;
  const cur = stage.querySelector('.sshorts-stage');
  st.idx = ni;
  st._animating = true;

  // 드래그로 들어왔을 때 cur 카드가 이미 어딘가에 살짝 옮겨져 있을 수 있다.
  // 그 위치를 그대로 이어받아서 슬라이드를 시작해야 '끊기는' 느낌이 안 든다.
  let curY = 0;
  if (cur && cur.style.transform) {
    const mt = cur.style.transform.match(/translate(?:Y)?\(\s*([-0-9.]+)px(?:,\s*([-0-9.]+)px)?/);
    if (mt) curY = parseFloat(mt[2] != null ? mt[2] : mt[1]);
  }
  const vh = stage.getBoundingClientRect().height || window.innerHeight;

  // 두 카드가 한 덩어리처럼 한 viewport 만큼 움직임 — 이어붙여 슬라이드.
  // dir='next' (위로 스와이프): cur 은 위로(−vh), next 는 아래에서(+vh)
  // dir='prev' (아래로 스와이프): cur 은 아래로(+vh), next 는 위에서(−vh)
  //
  // ⭐️ 자연스러움 핵심: cur 과 next 가 같은 거리를 같은 시간에 이동해야 한 덩어리처럼 보임.
  // 이전엔 curTarget 을 curY 기준으로 계산해서 cur 은 항상 vh 만큼 이동, 하지만
  // next 는 (vh − |curY|) 만큼만 이동 → 두 카드 속도가 달라 "끊기는" 느낌.
  // 수정: curTarget 을 절대 위치 dirSign*vh 로 고정 → 두 카드 모두 (vh − |curY|) 만큼만 이동.
  const dirSign = dir === 'next' ? -1 : 1;
  const curTarget = dirSign * vh;              // 끝 위치 절대 좌표 (curY 와 무관)
  const nextStart = curY - dirSign * vh;       // cur 의 반대편에 딱 붙여 시작

  const wrap = document.createElement('div');
  wrap.innerHTML = _shapeShortsCardHtml(st.tracks[ni]);
  const next = wrap.firstElementChild;
  next.style.transition = 'none';
  next.style.transform = `translate(0px, ${nextStart}px)`;
  stage.appendChild(next);
  // 강제 reflow 후 동시 슬라이드
  void next.getBoundingClientRect();

  // 부드러운 ease-out (out-quint) — 끊기는 느낌이 사라지고 자연스럽게 정착.
  const ease = 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
  if (cur) {
    cur.style.transition = ease;
    cur.style.transform = `translate(0px, ${curTarget}px)`;
  }
  next.style.transition = ease;
  next.style.transform = 'translate(0px, 0px)';

  _shapeShortsRenderChrome();
  // 스와이프는 슬라이드만 — 다음 트랙은 사용자가 탭해야 재생 (사용자 요청).
  setTimeout(() => {
    if (cur && cur.parentElement) cur.remove();
    st._animating = false;
  }, 400);
}

window._shapeShortsGoArtist = function (encName) {
  closeShapeShorts();
  if (encName) navigateTo('artist:' + encName);
};

window.closeShapeShorts = function () {
  const ov = document.getElementById('shape-shorts-overlay');
  if (ov) ov.remove();
  if (window.__shapeShortsKey) { document.removeEventListener('keydown', window.__shapeShortsKey); window.__shapeShortsKey = null; }
  window.__shapeShorts = null;
};

function _shapeShortsMount() {
  const st = window.__shapeShorts; if (!st) return;
  let ov = document.getElementById('shape-shorts-overlay');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'shape-shorts-overlay';
  ov.className = 'sshorts-overlay';
  ov.innerHTML = `
    <div class="sshorts-top">
      <button class="sshorts-close" onclick="closeShapeShorts()" aria-label="닫기"><i class="ri-arrow-left-line"></i></button>
      <div class="sshorts-progress" id="sshorts-progress"></div>
    </div>
    <div class="sshorts-body" id="sshorts-body"></div>
    <div class="sshorts-hint"><i class="ri-arrow-up-down-line"></i> 위아래로 넘겨요</div>
  `;
  document.body.appendChild(ov);

  const body = ov.querySelector('#sshorts-body');
  const wrap = document.createElement('div');
  wrap.innerHTML = _shapeShortsCardHtml(st.tracks[st.idx]);
  const card = wrap.firstElementChild;
  body.appendChild(card);
  _shapeShortsRenderChrome();
  _shapeShortsPlayCurrent();   // 처음 띄운 곡 바로 재생

  // 휠
  let wheelLock = false;
  ov.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true; setTimeout(() => wheelLock = false, 480);
    _shapeShortsGo(e.deltaY > 0 ? 'next' : 'prev');
  }, { passive: false });

  // 위아래 스와이프 — 손가락 따라 카드가 살짝 끌려오고 놓으면 스프링백 / 또는 다음으로 넘어감.
  // 단순 스와이프 감지가 아닌, 라이브 transform 동기화로 "잡고 끌고 다니는" 모션 적용.
  let ty0 = null, tx0 = null;
  let dragStage = null;
  let dragging = false;
  ov.addEventListener('touchstart', (e) => {
    if (!e.touches[0]) return;
    if (e.target.closest('.sshorts-close, .sshorts-artist')) { ty0 = tx0 = null; return; }
    const st = window.__shapeShorts;
    if (st && st._animating) { ty0 = tx0 = null; return; }   // 전환 중이면 새 드래그 무시
    ty0 = e.touches[0].clientY;
    tx0 = e.touches[0].clientX;
    dragStage = ov.querySelector('.sshorts-stage');
    dragging = false;
    if (dragStage) {
      dragStage.style.transition = 'none';      // 손가락 따라 즉시 반응
      dragStage.style.willChange = 'transform';
    }
  }, { passive: true });
  ov.addEventListener('touchmove', (e) => {
    if (e.cancelable) e.preventDefault();
    if (ty0 == null || tx0 == null || !dragStage || !e.touches[0]) return;
    const dy = e.touches[0].clientY - ty0;
    const dx = e.touches[0].clientX - tx0;
    if (!dragging && Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
    dragging = true;
    // 가로는 살짝만 따라오게(40%) + 약간의 기울기로 살아있는 느낌. 세로는 그대로.
    const followX = dx * 0.4;
    const rot = Math.max(-7, Math.min(7, dx / 18));
    dragStage.style.transform = `translate(${followX}px, ${dy}px) rotate(${rot}deg)`;
  }, { passive: false });
  let _suppressClickUntil = 0;     // 드래그 직후 따라오는 유령 click 잠깐 차단
  ov.addEventListener('touchend', (e) => {
    if (ty0 == null) { dragStage = null; dragging = false; return; }
    const touch = e.changedTouches[0];
    const dy = touch ? touch.clientY - ty0 : 0;
    const dx = touch ? touch.clientX - tx0 : 0;
    ty0 = tx0 = null;
    const stage = dragStage;
    dragStage = null;
    const wasDragging = dragging;
    dragging = false;
    if (wasDragging) _suppressClickUntil = Date.now() + 350;
    if (!stage) return;
    // 위/아래 스와이프 — 대각선도 포함 (위왼쪽/위오른쪽 → 위, 아래왼쪽/아래오른쪽 → 아래).
    //   · 임계값 50px 로 낮추고 (기존 80)
    //   · |dy| >= |dx| * 0.4 로 완화 (기존: |dy| > |dx|, 즉 45° 이상만 인정)
    //     → 약 22° 이상이면 인정 — 대각선 자연스럽게 인식.
    if (Math.abs(dy) >= 50 && Math.abs(dy) >= Math.abs(dx) * 0.4) {
      // 경계 케이스(첫/마지막 카드)는 _shapeShortsGo 가 아무것도 안 하고 return —
      // 이때 카드가 끌어 놓은 자리에 박혀있으므로 직접 spring-back 시켜야 한다.
      const _prevIdx = window.__shapeShorts ? window.__shapeShorts.idx : -1;
      _shapeShortsGo(dy < 0 ? 'next' : 'prev');
      const _newIdx = window.__shapeShorts ? window.__shapeShorts.idx : -1;
      if (_prevIdx === _newIdx && wasDragging && stage) {
        // 더 이상 갈 곳이 없으니 원위치로 부드럽게 — 일반 spring-back 과 동일
        stage.style.transition = 'transform 0.34s cubic-bezier(0.34,1.56,0.64,1)';
        stage.style.transform = 'translate(0, 0) rotate(0deg)';
        stage.style.willChange = '';
      }
      return;
    }
    // 임계값 못 넘기면 부드럽게 원위치 (살짝 spring 느낌의 ease)
    if (wasDragging) {
      stage.style.transition = 'transform 0.34s cubic-bezier(0.34,1.56,0.64,1)';
      stage.style.transform = 'translate(0, 0) rotate(0deg)';
      stage.style.willChange = '';
    }
  }, { passive: true });

  // 탭 처리(스와이프는 위 touchend가, 탭은 click이 담당):
  //  · 도형 한 번 탭 → 현재 트랙 재생/일시정지 (사용자 요청)
  //  · 도형 더블탭 → 그 아티스트 페이지
  //  · 빈 공간 탭 → 뒤로가기(닫기)
  //  · 아래 이름/닫기 버튼은 자기 onclick 처리
  let _lastShapeClick = 0;
  let _singleTapTimer = null;
  const _mountedAt = Date.now();
  ov.addEventListener('click', (e) => {
    if (Date.now() < _suppressClickUntil) return;
    if (Date.now() - _mountedAt < 450) return;
    if (e.target.closest('.sshorts-artist, .sshorts-close')) return;
    if (e.target.closest('.sshorts-shape')) {
      const now = Date.now();
      if (now - _lastShapeClick < 320) {
        // 더블탭 — single-tap 예약된 재생을 취소하고 아티스트 페이지로
        if (_singleTapTimer) { clearTimeout(_singleTapTimer); _singleTapTimer = null; }
        _lastShapeClick = 0;
        const s = window.__shapeShorts;
        const t = s && s.tracks[s.idx];
        _shapeShortsGoArtist(encodeURIComponent((t && t.artist) || ''));
      } else {
        _lastShapeClick = now;
        // single-tap 액션: 더블탭 윈도우(330ms) 끝나면 현재 트랙 재생/일시정지
        _singleTapTimer = setTimeout(() => {
          _shapeShortsPlayCurrent();
          _singleTapTimer = null;
        }, 330);
      }
      return;
    }
    closeShapeShorts();   // 빈 공간 → 닫기
  });

  window.__shapeShortsKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _shapeShortsGo('next'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _shapeShortsGo('prev'); }
    else if (e.key === 'Escape') { closeShapeShorts(); }
  };
  document.addEventListener('keydown', window.__shapeShortsKey);
}

// ===================== DISCOVER UNIVERSE DRAG =====================
let _discoverDocListenersAttached = false;
let _discoverDragState = { dragEl: null, startX: 0, startY: 0, origLeft: 0, origTop: 0, moved: false };

function _discoverMove(e) {
  const s = _discoverDragState;
  if (!s.dragEl) return;
  const ptr = e.touches ? e.touches[0] : e;
  const dx = ptr.clientX - s.startX;
  const dy = ptr.clientY - s.startY;
  const threshold = e.touches ? 12 : 5;
  if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) s.moved = true;
  s.dragEl.style.left = (s.origLeft + dx) + 'px';
  s.dragEl.style.top = (s.origTop + dy) + 'px';
  if (s.moved) e.preventDefault();
}

function _discoverUp() {
  const s = _discoverDragState;
  if (!s.dragEl) return;
  const el = s.dragEl;
  const wasMoved = s.moved;
  s.dragEl = null;
  el.style.zIndex = '';
  el.style.transition = '';
  if (wasMoved) {
    // Mark it so the following click event gets cancelled
    el.setAttribute('data-just-dragged', '1');
    setTimeout(() => el.removeAttribute('data-just-dragged'), 300);
  }
}

function initDiscoverDrag() {
  const items = document.querySelectorAll(
    '.discover-universe .univ-artist, .discover-universe .univ-album, ' +
    '.discover-universe .univ-note, .discover-universe .univ-tag, ' +
    '.discover-universe .univ-shape'
  );

  function down(e) {
    if (e.touches && e.touches.length > 1) return;
    const el = e.currentTarget;
    const s = _discoverDragState;
    s.dragEl = el;
    s.moved = false;
    const ptr = e.touches ? e.touches[0] : e;
    s.startX = ptr.clientX;
    s.startY = ptr.clientY;

    el.style.animation = 'none';
    const rect = el.getBoundingClientRect();
    const parentRect = el.parentElement.getBoundingClientRect();
    s.origLeft = rect.left - parentRect.left + el.parentElement.scrollLeft;
    s.origTop = rect.top - parentRect.top + el.parentElement.scrollTop;
    el.style.left = s.origLeft + 'px';
    el.style.top = s.origTop + 'px';
    el.style.zIndex = '50';
    el.style.transition = 'none';
  }

  items.forEach(el => {
    el.addEventListener('mousedown', down);
    el.addEventListener('touchstart', down, { passive: true });
  });

  if (!_discoverDocListenersAttached) {
    document.addEventListener('mousemove', _discoverMove);
    document.addEventListener('touchmove', _discoverMove, { passive: false });
    document.addEventListener('mouseup', _discoverUp);
    document.addEventListener('touchend', _discoverUp);
    document.addEventListener('touchcancel', _discoverUp);

    // Capture-phase click blocker when just dragged
    document.addEventListener('click', function(e) {
      const el = e.target && e.target.closest && e.target.closest(
        '.univ-artist, .univ-album, .univ-note, .univ-tag, .univ-shape'
      );
      if (el && el.hasAttribute('data-just-dragged')) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);

    _discoverDocListenersAttached = true;
  }
}

// ===================== SHAPES UNIVERSE (original floating shapes view) =====================
function renderShapes() {
  const db = window.DB.get();
  // 자켓 모드 제거(사용자 요청) — 발견은 항상 도형(shape) 모드. 저장된 jacket 선택도 무시.
  window.__discoverMode = 'shape';
  const _jacketMode = false;
  // 도형 페이지 들어올 때마다 Supabase에서 새 트랙 백그라운드 확인.
  // 트랙 목록이 바뀌었을 때만 다시 그려서 무한루프 방지.
  if (window.Tracks && window.Tracks.refreshInto && !window.__shapesRefreshing) {
    window.__shapesRefreshing = true;
    // 정렬해서 비교 → 순서만 바뀐 경우(서버가 같은 곡을 다른 순서로 반환)엔 재렌더 안 함(불필요한 끊김 방지).
    const beforeIds = (db.tracks || []).map(t => t && t.id).sort().join('|');
    window.Tracks.refreshInto(window.DB.get())
      .then(() => {
        const afterIds = (window.DB.get().tracks || []).map(t => t && t.id).sort().join('|');
        if (currentView === 'shapes' && afterIds !== beforeIds) renderShapes();
      })
      .catch(e => console.warn('[shapes] bg refresh', e))
      .finally(() => { window.__shapesRefreshing = false; });
  }
  // 모든 도형이 우주에서 자유롭게 떠다님 — 청취자가 아티스트를 모으는 컨셉
  //
  // 노출 규칙 (이른 단계 — 빈 플랫폼이 더 빈약해 보이지 않게 완화):
  //   1) 마스터 트랙 (version=final, !isDemo) → 무조건 노출
  //   2) Pinned demo (아티스트가 메인 노출로 선택한 데모) → 노출
  //   3) 본인이 올린 곡 (현재 로그인 유저) → master/demo 상관없이 무조건 노출
  //   4) demo_retired (이전 final이 demoted된 것) → 숨김
  const allTracks = db.tracks || [];
  const myName = (db.currentUser && db.currentUser.name) || (window.__currentUser && window.__currentUser.name) || '';
  const myId   = (window.__currentUser && window.__currentUser.id) || null;

  const tracks = allTracks
    .filter(t => {
      if (!t) return false;
      // Hide demoted-from-final tracks (auto-demoted previous finals).
      if (t.version === 'demo_retired') return false;
      // 빈 플랫폼 단계 — 모든 곡 표시 (master / demo / 본인 / 남이 올린 거 다)
      // 나중에 트래픽 늘면 master + pinned 만 노출하도록 다시 조이면 됨.
      return true;
    })
    // 정렬 — createdAt 내림차순 (최신 곡 먼저). 사용자 요청: 최신이 메인(앞/위)으로 오고
    // 나머지는 뒤로 밀려나게. si 0 = 최신 → 가운데 위 + 앞(z-index).
    // 드래그한 도형은 _loadShapePos(stored) 가 우선이라 어디든 그대로 고정.
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime() || 0;
      const tb = new Date(b.createdAt || 0).getTime() || 0;
      if (ta !== tb) return tb - ta;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

  // 발견 = 패턴 디자인(테스트 이식, 실제 곡). 롤백: 이 한 블록만 지우면 아래 옛 별필드로 복귀.
  if (typeof renderDiscoverPattern === 'function') { try { renderDiscoverPattern(tracks); return; } catch (e) { console.warn('[discover-pattern]', e); } }

  // Starfield background — replaces the old "조잡한" floating shapes with
  // a real twinkling night sky. Positions are seeded so the sky is the same
  // across reloads.
  const decoHtml = _buildStarfield('shapes-sky', 360, 30);   // 2D 필드가 커서 별도 늘림

  // Track shapes — one shape per track (user request). Previously each track
  // rendered twice to fill the universe; that doubled up on every upload.
  let shapesHtml = '';
  const totalShapes = tracks.length;
  // 우주 필드 = '내용만큼만'. 미리 크게 잡지 않고 도형 면적에 맞춰 정함 → 적으면 화면에 딱,
  // 많아질수록 자연히 넓어짐. 빈 스크롤/미리 정해둔 여백 없음. 시작은 왼쪽위 고정(가운데 스크롤 X).
  const _isNarrow = (typeof window !== 'undefined' ? window.innerWidth : 1024) < 600;
  const _vwNow = (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const _vhNow = (typeof window !== 'undefined' ? window.innerHeight : 800);
  const _avgW = _isNarrow ? 134 : (_vwNow < 768 ? 230 : 275);
  const _avgH = _isNarrow ? 108 : (_vwNow < 768 ? 180 : 215);
  const _spread = 0.45;     // 채움 정도(높을수록 빽빽 + 필드 작음 = 빈공간 적음)
  const _fArea = (totalShapes * _avgW * _avgH) / _spread;
  // 가로 스크롤 없이 '세로로만' — 필드 폭 = 화면 폭, 높이만 내용에 따라 늘어남 (사용자 요청).
  const _fieldW = _vwNow;
  let _fieldH = Math.max(_vhNow - 120, Math.round(_fArea / _fieldW));
  // 모바일: 세로 스택(겹침 방지) — 한 줄에 도형 하나, 최신이 맨 위, 아래로 차곡차곡 (사용자 요청).
  const _stackRow = _avgH + 64;
  if (_isNarrow) _fieldH = 16 + Math.max(1, totalShapes) * _stackRow + 48;
  // 2D 지터-그리드: 필드를 칸으로 나눠 고르게(쏠림/빈 사분면 없이), 칸 안은 랜덤(유기적)
  let _gCols = Math.max(1, Math.round(Math.sqrt(Math.max(1, totalShapes) * (_fieldW / _fieldH))));
  _gCols = Math.min(_gCols, Math.max(1, totalShapes));
  const _gRows = Math.max(1, Math.ceil(totalShapes / _gCols));
  const _cellWpx = _fieldW / _gCols;
  const _cellHpx = _fieldH / _gRows;
  // 인기도(♥*3 + 재생) 최대값 — 크기 스케일 정규화용 (#4)
  const _maxPop = Math.max(1, ...tracks.map(t => ((t.likes || 0) * 3) + (t.plays || 0)));

  const shapeEntries = tracks.map((track, i) => ({ track, idx: i, pass: 0 }));

  // 배치 시드 = 로그인과 무관한 '고정값'. (사용자 요청: 켤 때마다 안 바뀌고 한 곳에 고정)
  //   예전엔 사용자 id 를 시드로 써서, 로그인 전(anon)→후(id) 비동기 확인 시 배치가
  //   통째로 바뀌었음(20개 중 19개 이동). 고정값으로 모두 같은 안정 배치.
  //   (개인 드래그는 여전히 별도 localStorage 로 기기별 적용)
  const _viewerSeed = 'offstage-shapes-v1';

  // Stored drag positions for the shapes page (keyed by trackId:pass)
  function _loadShapePos(id, pass) {
    try {
      const raw = localStorage.getItem('shapepos:' + id + ':' + pass);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.xPct !== 'number' || typeof p.yPx !== 'number') return null;
      return p;
    } catch (_) { return null; }
  }

  shapeEntries.forEach((entry, si) => {
    const { track, idx, pass } = entry;
    // 발견 도형 = 곡 id 해시로 빈티지(Memphis) 다양화 — 폭발별·삼각형·별(뾰족) + 원·카드·타원·와이드(둥근).
    const _SHAPE_SET = ['burst', 'tri', 'circle', 'rect', 'star', 'burst', 'tri', 'oval', 'circle', 'rect', 'wide', 'star'];
    let shape = _SHAPE_SET[(_hashSeed('shape-type:' + (track.id || '')) >>> 0) % _SHAPE_SET.length];
    // 색 = 장르 색(있으면) / 없으면 트랙 id 해시(기존). genreColorOf 공통.
    const color = genreColorOf(track);
    const lines = track.lines || [track.title, track.artist, '클릭해서 들어봐!'];
    const safeLines = lines.map(l => (l || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

    // 최신(si 0)은 위쪽 가운데(앞으로), 나머지는 시드 랜덤으로 전체에 흩뿌림 (#6)
    const _isNewestSlot = (si === 0);
    // Seeded per-track-per-pass per-viewer — different users see different
    // default layouts so personal arrangements feel personal.
    const seed = _hashSeed(_viewerSeed + ':' + track.id + ':' + pass);
    // Stored user drag overrides the seeded default
    const stored = _loadShapePos(track.id, pass);
    const _newest = _isNewestSlot && !stored;          // 최신 + 드래그 안 함 → 메인 자리
    const _pinned = _isNarrow || !!stored || _newest;  // 모바일 스택/드래그/최신 = 고정 — declump 가 안 흩뜨림
    // 2D 칸 배치: 필드 전체(상하좌우)에 고르게 + 칸 안 랜덤. 최신은 필드 한가운데(시작 지점).
    const _rx = ((seed >>> 0) & 0xffff) / 0xffff;
    const _ry = ((seed >>> 16) & 0xffff) / 0xffff;
    const _ci = ((si - 1) % _gCols + _gCols) % _gCols;
    const _ri = Math.floor((si - 1) / _gCols);
    const _xpx = _newest ? (_fieldW - _avgW) / 2
               : (_ci * _cellWpx + _rx * Math.max(8, _cellWpx - _avgW));
    const _ypx = _newest ? (_fieldH - _avgH) / 2
               : (_ri * _cellHpx + _ry * Math.max(8, _cellHpx - _avgH));
    let xBase, yPx;
    if (_isNarrow && !stored) {
      // 모바일 세로 스택 — si 순(최신 si=0 맨 위)으로 위→아래, 한 줄에 하나(겹침 방지). 가로는 가운데±약간(유기적).
      const _jx = ((((seed >>> 0) & 0xffff) / 0xffff) - 0.5) * (_fieldW * 0.14);
      const _sx = Math.max(8, Math.min(_fieldW - _avgW - 8, (_fieldW - _avgW) / 2 + _jx));
      xBase = (_sx / _fieldW) * 100;
      yPx = 16 + si * _stackRow;
    } else {
      xBase = stored ? stored.xPct : (_xpx / _fieldW * 100);   // 필드폭 기준 %
      yPx = stored ? stored.yPx : _ypx;
    }
    const rot = _newest ? 0 : ((((seed >>> 10) % 140) - 70) / 10);
    const dur = 10 + ((seed >>> 18) % 18);
    // 떠다니는 진폭: 모바일은 좁아서 ±10, PC는 ±25 (겹침 방지)
    const _drift = _isNarrow ? 7 : 9;      // 제자리 둥둥 — 부드러운 진폭(겹침 방지)
    const dx = ((((seed >>> 22) % (_drift * 2))) - _drift);
    const dy = ((((seed >>> 26) % (_drift * 2))) - _drift);
    // 크기 = 등록 크기 + 인기도(♥*3+재생). 발견 크기 배율(사용자: +40% → 0.72·0.9 에서 ×1.4).
    const _pop = ((track.likes || 0) * 3) + (track.plays || 0);
    const _shrink = _isNarrow ? 1.26 : 1.01;
    const _popScale = (_shrink * (1 + (_isNarrow ? 0.18 : 0.35) * Math.min(1, _pop / _maxPop))).toFixed(3);
    const _newestStyle = _newest ? ' z-index:30;' : '';     // 최신은 앞으로 (#6)

    if (_jacketMode) {
      // 테스트: 도형 대신 '앨범 자켓' — 커버를 살짝 블러로 깔고 그 위에 해시태그.
      // 커버 없는 곡(Coming Soon 등)은 곡 색 그라데이션 자켓으로 통일(노란 얼룩 방지).
      const _cover = track.cover || '';
      const _hasCover = /^https?:\/\//i.test(_cover);
      const _coverBg = _hasCover
        ? `background-image:url('${_cover.replace(/'/g, '%27')}')`
        : `background-image:linear-gradient(140deg, ${color}, rgba(0,0,0,0.55))`;
      shapesHtml += `
      <div class="floating-shape shape-jacket${_newest ? ' is-newest' : ''}" data-track-id="${track.id}" data-pass="${pass}"${_pinned ? ' data-pinned="1"' : ''} data-artist="${encodeURIComponent(track.artist || '')}"
           style="left:${xBase}%; top:${yPx}px;${_newestStyle} animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg; --scale:${_popScale};">
        <div class="jkt-cover" style="${_coverBg}"></div>
        <div class="jkt-veil"></div>
        <div class="shape-text">${safeLines.join('\n')}</div>
      </div>`;
    } else {
      const isTriangle = shape === 'triangle';
      const bgStyle = isTriangle
        ? `border-bottom-color: ${color}; color: ${color}; --shape-bg: ${color};`
        : `background: ${color}; color: ${_textOn(color)}; --shape-bg: ${color};`;
      shapesHtml += `
      <div class="floating-shape shape-${shape}${_newest ? ' is-newest' : ''}" data-track-id="${track.id}" data-pass="${pass}"${_pinned ? ' data-pinned="1"' : ''} data-artist="${encodeURIComponent(track.artist || '')}"
           style="${bgStyle} left:${xBase}%; top:${yPx}px;${_newestStyle} animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg; --scale:${_popScale};">
        <div class="shape-text">${safeLines.join('\n')}</div>
      </div>`;
    }
  });

  // Activity feed ("지금 일어나는 일") — removed by user request. Was showing
  // mock listener actions which felt spammy on the empty/early platform.
  const feedHtml = '';

  // Random-play dice — real 3D CSS cube pinned above the upload FAB.
  // Each face is its own div with pre-placed dots; the wrapper's data-face
  // attribute drives the cube's rotation transform (see CSS).
  const initialFace = 1 + Math.floor(Math.random() * 6);
  const _dicePips = (n) => {
    const map = {
      1: ['c'],
      2: ['tl','br'],
      3: ['tl','c','br'],
      4: ['tl','tr','bl','br'],
      5: ['tl','tr','c','bl','br'],
      6: ['tl','ml','bl','tr','mr','br']
    };
    return (map[n] || []).map(p => `<span class="die-dot" data-pos="${p}"></span>`).join('');
  };
  // 셔플 버튼 — 3D 행성. 표면 줄무늬가 흘러서 "자전"하는 느낌, 호버하면 빨라짐.
  const diceHtml = `
    <div class="planet-fab" id="random-dice"
         onclick="diceBouncePlay(this)"
         title="행성을 돌려 도형 섞기 🪐">
      <span class="planet-ring planet-ring-back"></span>
      <span class="planet-sphere"></span>
      <span class="planet-ring planet-ring-front"></span>
    </div>
  `;

  // 빈티지(Memphis) 장식 — 곡 아닌 순수 장식(색종이·음표·종이뭉치·반짝이). 도형 뒤(z=0), floatDrift 제자리 부유.
  // top 을 %로 줘서 물리가 필드를 늘려도 전체 높이에 고르게 퍼지게.
  let vintageDecoHtml = '';
  try {
    const _vr = _mulberry32((_hashSeed(_viewerSeed + ':vintage') >>> 0) || 7);
    const _cc = ['#FF2EA0', '#00E5FF', '#FFD166', '#76FF03', '#B14BFF', '#FF6B6B', '#2EE6D6'];
    for (let i = 0; i < 52; i++) {
      const x = (_vr() * 95 + 2).toFixed(1), y = (_vr() * 97 + 1).toFixed(1), sz = 7 + Math.floor(_vr() * 15);
      const col = _cc[Math.floor(_vr() * _cc.length)], dur = 8 + Math.floor(_vr() * 10);
      const css = _vr() < 0.4
        ? `width:0;height:0;border-left:${(sz / 2).toFixed(0)}px solid transparent;border-right:${(sz / 2).toFixed(0)}px solid transparent;border-bottom:${sz}px solid ${col};`
        : `width:${sz}px;height:${sz}px;background:${col};border-radius:${_vr() < 0.5 ? '50%' : '2px'};`;
      vintageDecoHtml += `<div class="vtg-deco" style="left:${x}%;top:${y}%;${css}animation:floatDrift ${dur}s ease-in-out infinite;--dx:${(_vr() * 16 - 8).toFixed(0)}px;--dy:${(_vr() * 16 - 8).toFixed(0)}px;--rot:${Math.floor(_vr() * 360)}deg;"></div>`;
    }
    for (let i = 0; i < 16; i++) {
      const x = (_vr() * 94 + 3).toFixed(1), y = (_vr() * 96 + 2).toFixed(1), sz = 10 + Math.floor(_vr() * 9), dur = 7 + Math.floor(_vr() * 8);
      vintageDecoHtml += `<div class="vtg-deco vtg-spark" style="left:${x}%;top:${y}%;font-size:${sz}px;animation:floatDrift ${dur}s ease-in-out infinite;--dx:6px;--dy:-6px;--rot:0deg;">✦</div>`;
    }
    for (let i = 0; i < 7; i++) {
      const x = (_vr() * 86 + 5).toFixed(1), y = (_vr() * 92 + 3).toFixed(1), dur = 9 + Math.floor(_vr() * 7);
      vintageDecoHtml += `<div class="vtg-deco vtg-note" style="left:${x}%;top:${y}%;animation:floatDrift ${dur}s ease-in-out infinite;--dx:8px;--dy:-8px;--rot:${(_vr() * 30 - 15).toFixed(0)}deg;">♪♪</div>`;
    }
    for (let i = 0; i < 5; i++) {
      const x = (_vr() * 76 + 9).toFixed(1), y = (_vr() * 88 + 4).toFixed(1), dur = 11 + Math.floor(_vr() * 6);
      vintageDecoHtml += `<div class="vtg-deco vtg-papers" style="left:${x}%;top:${y}%;animation:floatDrift ${dur}s ease-in-out infinite;--dx:5px;--dy:-5px;--rot:${(_vr() * 16 - 8).toFixed(0)}deg;"><i></i><i></i><i></i></div>`;
    }
  } catch (e) { console.warn('[shapes] vintage deco', e); }

  // .shapes-universe = 뷰포트 크기 스크롤 창, .universe-field = 그보다 큰 2D 필드(사방으로 큼)
  appContent.innerHTML = `
    <div class="page-intro">${_i18n('우주 탐색 피드', 'Explore the Universe')}</div>
    <div class="shapes-subtitle">${_i18n('탭=재생 · 끌어서 옮기기 · 제자리에 둥둥', 'Tap = play · Drag to move · Floating in place')}</div>
    <div class="shapes-universe" id="shapes-scroll">
      <div class="universe-field" style="width:100%; height:${_fieldH}px;">
        ${decoHtml}
        ${vintageDecoHtml}
        ${shapesHtml}
      </div>
    </div>
    ${feedHtml}
    ${diceHtml}
    <div class="upload-fab" onclick="navigateTo('upload')" title="음악 업로드">
      <i class="ri-add-line"></i>
    </div>
  `;

  // 유기적으로 흩뿌린 뒤, 많이 겹친 것만 떼어놓기(살짝 겹침 허용). innerHTML 직후 동기 실행.
  const _scroll = appContent.querySelector('#shapes-scroll');
  const _field = _scroll && _scroll.querySelector('.universe-field');
  try {
    if (_field) _declumpShapes(_field, {
      H: _fieldH,                          // 폭은 declump 가 실제 필드(100%) 폭을 재서 사용 → 가로 넘침 0
      pinnedFn: el => el.dataset.pinned === '1',
      slack: _isNarrow ? 0.04 : 0.05,      // 거의 안 겹치게(살짝만 여유 — 제자리 둥둥이라 이동 충돌 없음)
      rand: _mulberry32((_hashSeed(_viewerSeed + ':scatter') >>> 0) || 1)
    });
  } catch (e) { console.warn('[shapes] declump', e); }

  // 시작 위치는 왼쪽 위 고정(스크롤 0,0) — 가운데로 자동 이동 안 함 → 새로고침해도 안 튐.
  if (_scroll) { _scroll.scrollLeft = 0; _scroll.scrollTop = 0; }

  initShapeDrag();
  // 발견 = 제자리에서 둥둥(작은 진폭) + 부딪히면 옆으로(연속 분리). 이동/튕김 없음.
  try {
    stopShapesPhysics();
    if (!_jacketMode && _scroll && _field) startShapesPhysics(_field, _scroll);
  } catch (e) { console.warn('[shapes] physics', e); }
  // initDiceDrag() removed — dice is now fixed-position above upload-fab.
}
// supabase.js 등 외부 스크립트에서 window.renderShapes() 로 호출 가능하게 명시 노출.
// (비-모듈 스크립트에선 function 선언만으로도 window 에 매달리지만, 모든 환경 안전하게)
window.renderShapes = renderShapes;

// ============================================================
// 발견 · 패턴 디자인 (discover-pattern-test.html 이식). 실제 곡 태그로 구동, 탭=재생.
// 샘플 멤피스 배치(20도형/판, 곡 6개) + 판마다 살짝 흔들림 + 곡 도형은 해시태그 길이에 맞춰 auto-grow.
// renderShapes 가 트랙 계산 후 이리로 위임. 롤백: renderShapes 의 위임 한 줄만 지우면 옛 별필드로.
// ============================================================
function dpEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
// 즐겨찾기/폴더의 dp-univ 도형은 고정 크기 → 긴 해시태그가 별/삼각 뾰족한 부분에서 잘림.
// 렌더 후 도형별 안전영역에 맞게 폰트를 줄여 잘림 방지(원>삼각>별 순으로 여유). rAF 로 레이아웃 후 실행.
function _fitDpUnivText(root){
  var scope = root || document;
  if (!scope.querySelectorAll) return;
  var run = function(){
    var els = scope.querySelectorAll('.dp-univ');
    for (var k = 0; k < els.length; k++){
      var wrap = els[k];
      var txt = wrap.querySelector('.dp-s-text');
      if (!txt) continue;
      var shape = wrap.querySelector('.dp-shape');
      var isBurst = shape && shape.classList.contains('dp-burst');
      var isTri = wrap.classList.contains('dp-tri-wrap') || (shape && shape.classList.contains('dp-tri'));
      var W = wrap.offsetWidth || 155;
      var frac = isBurst ? 0.5 : (isTri ? 0.58 : 0.72);   // 별=가장 좁음, 삼각=중간, 원=넉넉
      var safeW = W * frac;
      var safeH = W * (isTri ? 0.42 : 0.70);
      var fs = 13;
      txt.style.fontSize = fs + 'px';
      txt.style.lineHeight = '1.12';
      var guard = 0;
      // offsetWidth 접근이 강제 리플로우 → 동기 측정 가능(헤드리스 rAF 미발화 회피)
      while (guard++ < 24 && (txt.scrollWidth > safeW || txt.scrollHeight > safeH) && fs > 6.5){
        fs -= 0.5; txt.style.fontSize = fs + 'px';
      }
    }
  };
  run();   // 즉시(동기) — 이미 DOM 삽입 후라 레이아웃 가능
  // 글꼴이 늦게 로드되면 폭이 바뀌므로 폰트 준비 후 한 번 더 맞춤
  try { if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(run); } catch (_) {}
  setTimeout(run, 80);
}
function _dpStyle(){
  if (document.getElementById('dp-style')) return;
  var st=document.createElement('style'); st.id='dp-style';
  st.textContent = `
  .dp-scroll{position:relative;height:100vh;height:100dvh;overflow-y:auto;background:#45CEEB;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
  .dp-scroll::-webkit-scrollbar{display:none;}
  .dp-band{position:relative;height:100%;}
  .dp-slot{position:absolute;transform:translate(-50%,-50%) rotate(var(--rot,0deg));width:var(--w);height:var(--h);display:flex;align-items:center;justify-content:center;z-index:1;}
  .dp-slot.info{z-index:5;cursor:pointer;}
  .dp-shape{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 4px 11px rgba(0,0,0,.5));}
  .dp-burst{clip-path:polygon(50% 0%,61% 26%,87% 13%,74% 39%,100% 47%,79% 62%,90% 90%,61% 75%,50% 100%,39% 75%,10% 90%,21% 62%,0% 47%,26% 39%,13% 13%,39% 26%);}
  .dp-tri{clip-path:polygon(50% 3%,3% 97%,97% 97%);}
  /* 예전 spark(뾰족 8각 이상한 별) → 깔끔한 다이아몬드로 전면 교체(사용자 요청). 클래스명은 유지. */
  .dp-spark{clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);}
  .dp-circle,.dp-ellipse{border-radius:50%;}
  .dp-square{border-radius:6px;}
  .dp-stack .dp-shape{background:none;filter:none;}
  .dp-stack .p{position:absolute;background:#F4F1E8;border:1.5px solid #cfc7b2;border-radius:3px;width:74%;height:74%;box-shadow:0 3px 8px rgba(0,0,0,.45);}
  .dp-stack .p:nth-child(1){left:0;top:0;transform:rotate(-8deg);}
  .dp-stack .p:nth-child(2){left:14%;top:12%;transform:rotate(4deg);}
  .dp-stack .p:nth-child(3){left:26%;top:24%;transform:rotate(-3deg);}
  .dp-notes{font-size:var(--w);line-height:1;font-weight:900;filter:drop-shadow(0 3px 7px rgba(0,0,0,.5));}
  .dp-s-text{position:relative;z-index:2;text-align:center;font-weight:800;line-height:1.5;letter-spacing:-.2px;pointer-events:none;white-space:nowrap;color:#1b1522;}
  .dp-tri-wrap .dp-s-text{transform:translateY(28%);}
  /* ── 상단 히어로: 하늘색 배경 + 검은고딕 대형 워드마크 + 떨어지는 번개 (스크린샷 이식) ── */
  /* 히어로 = 상단 압축 헤더(워드마크만, 가운데). 큰 빈 공간 없이 바로 아래 곡 도형과 한 화면에 합쳐짐. */
  .dp-hero{position:relative;width:100%;padding:calc(env(safe-area-inset-top,0px) + 6px) 14px 2px;pointer-events:none;overflow:visible;text-align:center;}
  .dp-wordmark{position:relative;z-index:2;font-family:'Black Han Sans','Pretendard',sans-serif;color:#FFE800;font-weight:400;line-height:.9;letter-spacing:-.5px;margin:0;font-size:clamp(52px,16vw,150px);text-shadow:0 5px 0 rgba(0,0,0,.06);text-align:center;}
  /* 떨어지는 장식 도형(번개 대신) — 화면 고정 레이어라 스크롤해도 모든 위치에서 계속 떨어짐.
     곡 도형 위(z-index 6)로 겹쳐 흘러 하나로 어우러짐. pointer-events:none 로 탭 방해 X. 상단탭/플레이어는 더 높은 z 라 안 가림. */
  .dp-fall-layer{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:6;}
  .dp-fall{position:absolute;top:0;width:var(--fw,32px);height:var(--fw,32px);will-change:transform;animation:dpFall linear infinite;}
  .dp-fall .dp-shape{filter:drop-shadow(0 3px 6px rgba(0,0,0,.14));}
  .dp-fall .dp-notes{font-size:var(--fw,32px);line-height:1;}
  @keyframes dpFall{0%{transform:translateY(-16vh) rotate(-12deg);opacity:0;}7%{opacity:1;}90%{opacity:1;}100%{transform:translateY(112vh) rotate(220deg);opacity:0;}}
  @media (max-width:620px){ .dp-wordmark{font-size:clamp(46px,17vw,110px);} }
  `;
  document.head.appendChild(st);
}
function renderDiscoverPattern(tracks){
  currentView = 'shapes';
  var app = document.getElementById('app-content'); if (!app) return;
  try { if (typeof stopShapesPhysics==='function') stopShapesPhysics(); } catch(_){}
  _dpStyle();
  tracks = (tracks||[]).filter(Boolean);
  // 곡 → 해시태그 3개(태그 우선, 없으면 아티스트/제목으로 보충)
  function tagsOf(t){
    // 입력한 해시태그 전부 표시(예전 3개 상한 → 잘림). 폭주 방지로 8개까지만.
    var a = (t && Array.isArray(t.tags)) ? t.tags.filter(Boolean).map(String).slice(0,8) : [];
    if (!a.length && t){ var ti=(t.title||'곡').replace(/\s*\(.*\)$/,''); a=[t.artist||'off-stage', ti]; }
    return a.slice(0,8);
  }
  // 샘플 멤피스 배치(곡=info 밝은 도형: 버스트·원·삼각형)
  var TPL = [
    {id:'s1', x:13,y:7,  w:58,h:38, cls:'ellipse', color:'#FFD24A'},
    {id:'s2', x:60,y:10, w:40,h:40, cls:'spark',   color:'#26C6C6'},
    {id:'s3', x:33,y:24, w:178,h:178, cls:'burst', color:'#E24A9C', info:1, fit:.5,  fitH:.46},
    {id:'s4', x:77,y:33, w:222,h:198, cls:'tri',   color:'#7FB2EC', info:1, fit:.68, fitH:.46},
    {id:'s5', x:17,y:45, w:78,h:78, cls:'stack',   color:'#F4F1E8'},
    {id:'s6', x:37,y:49, w:38,h:34, cls:'notes',   color:'#E24A9C', glyph:'♪'},
    {id:'s7', x:43,y:57, w:138,h:138, cls:'circle', color:'#86CE34', info:1, fit:.68, fitH:.62},
    {id:'s8', x:81,y:64, w:238,h:212, cls:'tri',   color:'#B49BEE', info:1, fit:.68, fitH:.46},
    {id:'s9', x:22,y:74, w:138,h:138, cls:'burst', color:'#F06CA8', info:1, fit:.5,  fitH:.46},
    {id:'s10',x:75,y:83, w:152,h:152, cls:'burst', color:'#FF8A6E', info:1, fit:.5,  fitH:.46},
    {id:'s11',x:25,y:93, w:52,h:52, cls:'square',  color:'#FFD24A'},
    {id:'s13',x:89,y:20, w:30,h:30, cls:'spark',   color:'#E24A9C'},
    {id:'s14',x:61,y:76, w:34,h:34, cls:'notes',   color:'#26C6C6', glyph:'♫'},
    {id:'a1', x:47,y:9,  w:46,h:46, cls:'burst',   color:'#FFD24A'},
    {id:'a2', x:10,y:31, w:40,h:40, cls:'spark',   color:'#E24A9C'},
    {id:'a3', x:91,y:46, w:50,h:44, cls:'tri',     color:'#26C6C6'},
    {id:'a4', x:58,y:45, w:32,h:32, cls:'notes',   color:'#86CE34', glyph:'♪'},
    {id:'a5', x:10,y:63, w:46,h:46, cls:'burst',   color:'#3E6FD9'},
    {id:'a6', x:52,y:89, w:42,h:42, cls:'spark',   color:'#F06CA8'}
  ];
  function mkShape(cls,color,glyph){
    if (cls==='stack') return '<div class="dp-shape"><div class="p"></div><div class="p"></div><div class="p"></div></div>';
    if (cls==='notes') return '<div class="dp-notes" style="color:'+color+'">'+glyph+'</div>';
    return '<div class="dp-shape dp-'+cls+'" style="background:'+color+'"></div>';
  }
  var perBand=6, bandCount = tracks.length ? Math.min(16, Math.max(3, Math.ceil(tracks.length/perBand))) : 3;
  app.innerHTML = '<div class="dp-scroll" id="dp-scroll"></div>'
    + '<div class="upload-fab" onclick="navigateTo(\'upload\')" title="음악 업로드"><i class="ri-add-line"></i></div>';
  var scroll = document.getElementById('dp-scroll'), ti=0, built=false;
  // 곡 도형: 태그 길이에 맞춰 스케일(mul=화면폭 배율 반영). 글자=12*mul
  function songDim(el,s,mul){ var te=el.querySelector('.dp-s-text'); te.style.fontSize=(16*mul)+'px'; te.style.whiteSpace='nowrap'; var cap=Math.max(1,s.w*mul*s.fit); var scale=Math.max(.82,Math.min(1.3,te.offsetWidth/cap)); return {w:Math.round(s.w*mul*scale),h:Math.round(s.h*mul*scale)}; }
  function build(){
    if (built || !document.getElementById('dp-scroll')) return; built=true;
    // 스크롤 높이 = 실제 가용 영역(상단 오프셋~플레이어 위)
    try {
      var _pl=document.getElementById('global-player'); var _ph=(_pl&&_pl.offsetHeight)?_pl.offsetHeight+8:66;
      var _av=window.innerHeight - Math.max(0, scroll.getBoundingClientRect().top) - _ph;
      scroll.style.height = Math.max(420, _av) + 'px';
    } catch(_){}
    // 상단 히어로 — 스크린샷 이식: 하늘색 + 검은고딕 대형 노란 워드마크 "슬로우 뮤직" + 위→아래 떨어지는 번개
    // 워드마크 헤더(가운데) — 곡 도형과 한 화면.
    scroll.insertAdjacentHTML('beforeend', '<div class="dp-hero"><h1 class="dp-wordmark">슬로우 뮤직</h1></div>');
    // 떨어지는 장식 도형(번개 대신) — 화면 고정 레이어라 스크롤 어디서든 계속 떨어짐. 곡(음원) 도형 아님(글자 없음). spark=다이아.
    var _fallCfg=[
      {c:'circle',col:'#FFD24A',w:30,left:7, dur:6.2,delay:0},
      {c:'tri',   col:'#E24A9C',w:38,left:24,dur:7.4,delay:1.1},
      {c:'square',col:'#26C6C6',w:26,left:41,dur:6.6,delay:2.3},
      {c:'spark', col:'#B49BEE',w:32,left:58,dur:7.8,delay:0.6},
      {c:'notes', col:'#FF8A6E',w:30,left:73,dur:6.9,delay:3.1},
      {c:'circle',col:'#7FB2EC',w:22,left:88,dur:5.8,delay:1.8},
      {c:'tri',   col:'#FFD24A',w:26,left:15,dur:7.1,delay:3.7},
      {c:'square',col:'#F06CA8',w:22,left:50,dur:6.3,delay:4.4},
      {c:'spark', col:'#86CE34',w:28,left:66,dur:7.6,delay:2.7},
      {c:'circle',col:'#B49BEE',w:20,left:33,dur:5.9,delay:5.0}
    ];
    var _bolts=_fallCfg.map(function(b){
      var inner = (b.c==='notes') ? '<div class="dp-notes" style="color:'+b.col+'">♪</div>'
                                  : '<div class="dp-shape dp-'+b.c+'" style="background:'+b.col+'"></div>';
      return '<span class="dp-fall" style="left:'+b.left+'%;--fw:'+b.w+'px;animation-duration:'+b.dur+'s;animation-delay:'+b.delay+'s;">'+inner+'</span>';
    }).join('');
    scroll.insertAdjacentHTML('beforeend', '<div class="dp-fall-layer">' + _bolts + '</div>');
    // 좁으면(모바일) 손으로 짠 조판 그대로, 넓으면(PC) 화면 전체에 하나로 흩뿌림(반복 없음)+크게
    var BW0=scroll.clientWidth||360;
    var wide = BW0>=620;
    var mul = wide ? Math.max(1.1, Math.min(1.55, BW0/1050)) : 1;
    var SH = parseInt(scroll.style.height,10) || (scroll.clientHeight||600);
    var songsPer = wide ? Math.max(9, Math.min(15, Math.round(BW0*SH/80000))) : 6;
    var bandCount = Math.max(3, Math.min(16, Math.ceil((tracks.length||18)/songsPer)));
    var INFOCOL=['#E24A9C','#7FB2EC','#86CE34','#B49BEE','#F06CA8','#FF8A6E','#26C6C6','#FFB03A'];
    var SONGSH=[{cls:'burst',fit:.5,fitH:.46,w:150,h:150},{cls:'circle',fit:.68,fitH:.62,w:132,h:132},{cls:'tri',fit:.68,fitH:.46,w:222,h:196}];
    var DECOR=[{cls:'spark',w:44,color:'#26C6C6'},{cls:'tri',w:58,color:'#7FB2EC'},{cls:'burst',w:52,color:'#FFD24A'},{cls:'notes',w:36,color:'#E24A9C',glyph:'♪'},{cls:'stack',w:68,color:'#F4F1E8'},{cls:'spark',w:40,color:'#F06CA8'},{cls:'tri',w:56,color:'#86CE34'},{cls:'notes',w:34,color:'#26C6C6',glyph:'♫'},{cls:'ellipse',w:56,color:'#FFD24A'},{cls:'burst',w:50,color:'#B49BEE'},{cls:'square',w:46,color:'#3E6FD9'},{cls:'spark',w:38,color:'#FF8A6E'}];
    function _songText(tk){ var tg=tk?tagsOf(tk):['off','stage','music']; if(!tg.length)tg=['뮤직']; return '<div class="dp-s-text" data-lines="'+tg.length+'">'+tg.map(function(x){return '#'+dpEsc(x);}).join('<br>')+'</div>'; }
    function _fitFont(el,fit,fitH,W,H,m){ var te=el.querySelector('.dp-s-text'); var mw=W*fit,mh=H*fitH,fs=parseFloat(te.style.fontSize)||(16*m),g=0; while((te.offsetWidth>mw||te.offsetHeight>mh)&&fs>8&&g++<26){fs-=0.5;te.style.fontSize=fs+'px';} }
    function _freePlace(items,W,H){ var out=[]; items.forEach(function(it){ var best={x:W/2,y:H/2},bm=-1e9,r=it.r,pad=it.pad; for(var t=0;t<90;t++){ var x=r+8+Math.random()*Math.max(1,W-2*r-16), y=r+8+Math.random()*Math.max(1,H-2*r-16), m=1e9; for(var j=0;j<out.length;j++){var d=Math.hypot(x-out[j].x,y-out[j].y)-(r+out[j].r); if(d<m)m=d;} if(m>=pad){best={x:x,y:y};break;} if(m>bm){bm=m;best={x:x,y:y};} } it.x=best.x; it.y=best.y; out.push({x:best.x,y:best.y,r:r}); }); }
    for (var bi=0; bi<bandCount; bi++){
      var band=document.createElement('div'); band.className='dp-band'; scroll.appendChild(band);
      var BW=band.clientWidth||BW0, BH=band.clientHeight||SH;
      if (!wide){
        TPL.forEach(function(s){
          var el=document.createElement('div');
          el.className='dp-slot'+(s.info?' info':'')+(s.cls==='stack'?' dp-stack':'')+(s.cls==='tri'?' dp-tri-wrap':'');
          var inner=mkShape(s.cls,s.color,s.glyph), track=null;
          if(s.info){ track=tracks.length?tracks[ti%tracks.length]:null; ti++; inner+=_songText(track); }
          el.innerHTML=inner; band.appendChild(el);
          if(s.info&&track){ el.setAttribute('onclick',"if(window.playTrack)playTrack('"+dpEsc(track.id)+"','universe')"); el.setAttribute('title',dpEsc((track.title||'')+' — '+(track.artist||''))); }
          var W=s.w,H=s.h;
          if(s.info){ var dim=songDim(el,s,1); W=dim.w; H=dim.h; el.style.setProperty('--w',W+'px'); el.style.setProperty('--h',H+'px'); _fitFont(el,s.fit,s.fitH,W,H,1); }
          else { el.style.setProperty('--w',W+'px'); el.style.setProperty('--h',H+'px'); }
          el.style.setProperty('--rot',((s.rot||0)+(Math.random()-0.5)*14)+'deg');
          var sz=Math.max(W,H),hw=(sz/2)/BW*100,hh=(sz/2)/BH*100;
          el.style.left=Math.max(hw+2,Math.min(98-hw,s.x+(Math.random()-0.5)*5))+'%';
          el.style.top=Math.max(hh+3,Math.min(90-hh,s.y+(Math.random()-0.5)*4))+'%';
        });
      } else {
        var items=[];
        for (var si=0; si<songsPer; si++){
          var track=tracks.length?tracks[ti%tracks.length]:null; ti++;
          var st=SONGSH[si%SONGSH.length];
          var el=document.createElement('div'); el.className='dp-slot info'+(st.cls==='tri'?' dp-tri-wrap':'');
          el.innerHTML=mkShape(st.cls,INFOCOL[si%INFOCOL.length])+_songText(track); band.appendChild(el);
          if(track){ el.setAttribute('onclick',"if(window.playTrack)playTrack('"+dpEsc(track.id)+"','universe')"); el.setAttribute('title',dpEsc((track.title||'')+' — '+(track.artist||''))); }
          var dim=songDim(el,st,mul); el.style.setProperty('--w',dim.w+'px'); el.style.setProperty('--h',dim.h+'px'); _fitFont(el,st.fit,st.fitH,dim.w,dim.h,mul);
          el.style.setProperty('--rot',((Math.random()-0.5)*16)+'deg');
          items.push({el:el, r:Math.max(dim.w,dim.h)/2, pad:14});
        }
        for (var di=0; di<Math.round(songsPer*1.5); di++){
          var dc=DECOR[di%DECOR.length];
          var e2=document.createElement('div'); e2.className='dp-slot'+(dc.cls==='stack'?' dp-stack':'');
          var w=Math.round(dc.w*mul); e2.style.setProperty('--w',w+'px'); e2.style.setProperty('--h',w+'px'); e2.style.setProperty('--rot',((Math.random()-0.5)*18)+'deg');
          e2.innerHTML=mkShape(dc.cls,dc.color,dc.glyph); band.appendChild(e2);
          items.push({el:e2, r:w/2, pad:6});
        }
        _freePlace(items, BW, BH);
        items.forEach(function(it){ it.el.style.left=(it.x/BW*100)+'%'; it.el.style.top=(it.y/BH*100)+'%'; });
      }
    }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  setTimeout(build, 350);
}
window.renderDiscoverPattern = renderDiscoverPattern;

// ============================================================
// 발견(도형) 물리 — 둥둥 드리프트 + 벽 가둠 + 안겹침 분리(도형끼리 튕김 없음) + 끌어서 던지기(flick).
// shape 모드에서만 동작(각 도형 el.__phys 부착). universe(즐겨찾기)는
// __phys 가 안 붙으므로 기존 floatDrift/드래그 그대로 유지된다.
// 탭1=재생 / 탭2=아티스트 페이지 는 initShapeDrag 의 탭 로직이 처리.
// ============================================================
window.__shapesPhys = window.__shapesPhys || { raf: 0, items: [] };
function stopShapesPhysics() {
  const P = window.__shapesPhys;
  if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0; }
  // 곡 id별 마지막 위치/속도를 저장 → 배경 새로고침으로 renderShapes 가 다시 그려도
  // 도형이 씨드 시작점으로 '툭' 되돌아가지 않고 이어서 떠다니게(startShapesPhysics 가 복원).
  window.__shapePos = window.__shapePos || {};
  if (P.items) P.items.forEach(b => {
    try {
      const k = b.el && b.el.dataset && b.el.dataset.trackId;
      if (k) window.__shapePos[k] = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
      delete b.el.__phys; b.el.classList.remove('phys-shape');
    } catch (_) {}
  });
  P.items = [];
}
window.stopShapesPhysics = stopShapesPhysics;

// 제자리 둥둥(floatDrift) + 안겹침 — 이동 물리 대신 '1회 정리'로 도형을 서로 안 겹치게 배치.
// 위치만 left/top 으로 쓰고 transform(floatDrift 부유)은 건드리지 않아 제자리 부유가 유지됨.
// 겹치면 필드 아래로 늘려 세로로 펼침(발견=세로 스크롤 피드). data-pinned(최신/드래그)은 고정.
function _relaxNoOverlap(field, viewport) {
  if (!field) return;
  const els = Array.prototype.slice.call(field.querySelectorAll('.floating-shape'));
  if (els.length < 2) return;
  const fieldW = field.clientWidth || (viewport && viewport.clientWidth) || window.innerWidth;
  const vvh = (viewport && viewport.clientHeight) || window.innerHeight || 600;
  const BOB = 20;   // floatDrift 진폭 여유(둘 다 흔들려도 안 겹치게)
  const items = els.map(function (el) {
    const sc = parseFloat(el.style.getPropertyValue('--scale') || '1') || 1;
    const w = el.offsetWidth * sc, h = el.offsetHeight * sc;
    return {
      el: el, w: w, h: h, r: Math.max(w, h) / 2,
      x: (parseFloat(el.style.left) || 0) / 100 * fieldW,
      y: parseFloat(el.style.top) || 0,
      pin: el.dataset.pinned === '1'
    };
  });
  for (let it = 0; it < 300; it++) {
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const c = items[j];
        if (a.pin && c.pin) continue;
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2, ccx = c.x + c.w / 2, ccy = c.y + c.h / 2;
        let dx = ccx - acx, dy = ccy - acy; const dist = Math.hypot(dx, dy) || 0.01;
        const min = (a.r + c.r) + BOB;
        if (dist < min) {
          const ov = min - dist; let nx = dx / dist, ny = dy / dist;
          // 거의 같은 높이로 가로로만 밀리면(가로 정체) 세로로도 벌려 줌 — 위는 위로/아래는 아래로(필드 확장)
          if (Math.abs(ny) < 0.3) { ny = (acy <= ccy ? 1 : -1) * 0.65; const nm = Math.hypot(nx, ny) || 1; nx /= nm; ny /= nm; }
          if (a.pin) { c.x += nx * ov; c.y += ny * ov; }
          else if (c.pin) { a.x -= nx * ov; a.y -= ny * ov; }
          else { a.x -= nx * ov / 2; a.y -= ny * ov / 2; c.x += nx * ov / 2; c.y += ny * ov / 2; }
        }
      }
    }
    for (let k = 0; k < items.length; k++) {
      const b = items[k]; if (b.pin) continue;
      if (b.x < 0) b.x = 0; else if (b.x + b.w > fieldW) b.x = Math.max(0, fieldW - b.w);
      if (b.y < 0) b.y = 0;     // 아래로는 자유(필드 확장)
    }
  }
  let maxY = vvh;
  items.forEach(function (b) { maxY = Math.max(maxY, b.y + b.h + 24); });
  field.style.height = maxY + 'px';
  items.forEach(function (b) { b.el.style.left = (b.x / fieldW * 100) + '%'; b.el.style.top = b.y + 'px'; });
}
window._relaxNoOverlap = _relaxNoOverlap;

function startShapesPhysics(field, viewport) {
  if (!field) return;
  const els = Array.prototype.slice.call(field.querySelectorAll('.floating-shape'));
  if (!els.length) return;
  const P = window.__shapesPhys;
  // 홈 = renderShapes 가 씨드로 정한 고정 위치(최신이 맨 위, 아래로 차곡차곡). 재진입해도 동일 →
  // 매번 흩어지지 않아 '초기화' 느낌이 없고, 새 곡은 맨 위로 들어오고 기존은 아래로 밀린다.
  // 한 화면에 ~8개(3열). 씨드 결정적 배치 → 재진입해도 동일(랜덤 초기화 없음).
  const fieldW0 = field.clientWidth || (viewport && viewport.clientWidth) || window.innerWidth;
  const vvh = (viewport && viewport.clientHeight) || window.innerHeight || 600;
  // 촘촘한 씨드 격자 — 도형 크기에 맞춰 빽빽하게 깔고, 연속 분리가 안 겹치게 마무리한다.
  // (이전엔 cellH≈vvh*3/7 ≈ 428px 로 너무 성겨서 분리가 더 조일 게 없었음 → 띄엄띄엄)
  const cols = Math.max(1, Math.min(4, Math.round(fieldW0 / 240)));
  const rows = Math.max(1, Math.ceil(els.length / cols));
  const cellH = 270;                                      // 행 간격(도형 +40%에 맞춰 확대, 분리가 겹침 정리)
  const fieldH = Math.max(vvh, rows * cellH);
  field.style.height = fieldH + 'px';
  const cellW = fieldW0 / cols;
  function _h(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }  // 결정적 0~1
  window.__shapePos = window.__shapePos || {};
  const items = els.map((el, idx) => {
    const sc = parseFloat((el.style.getPropertyValue('--scale') || '1')) || 1;
    el.style.animation = 'none';                           // floatDrift 끔 — 물리가 제자리 둥둥+분리를 transform 으로 몲
    el.style.transition = 'none';
    const w = el.offsetWidth * sc, h = el.offsetHeight * sc;
    const col = idx % cols, row = Math.floor(idx / cols);
    // 앵커(제자리) = 씨드 격자. 같은 곡 직전 위치 있으면 복원(재렌더 '툭' 방지).
    let x = col * cellW + 4 + _h(idx * 2 + 1) * Math.max(4, cellW - w - 8);
    let y = row * cellH + 4 + _h(idx * 2 + 3) * Math.max(4, cellH - h - 8);
    const _pk = el.dataset && el.dataset.trackId;
    const _pc = _pk && window.__shapePos[_pk];
    if (_pc) { x = _pc.x; y = _pc.y; }
    el.style.left = '0'; el.style.top = '0';
    el.style.willChange = 'transform';
    el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)' + (sc !== 1 ? ' scale(' + sc + ')' : '');
    // x,y = 제자리 앵커(분리/드래그가 옮김). ph/amp = 작은 제자리 둥둥.
    // 클립 도형(별·폭발별·삼각형)은 bbox가 실제보다 커서 반경을 줄여 덜 띄엄띄엄하게(안 겹침은 유지).
    const _clip = /shape-(burst|tri|star|diamond|hexagon|parallelogram)/.test(el.className);
    const item = { el, x, y, w, h, sc, r: Math.max(w, h) / 2 * (_clip ? 0.6 : 0.95), ph: _h(idx + 11) * 6.283, amp: 1.5 + _h(idx + 5) * 2.5 };
    el.__phys = item;
    el.classList.add('phys-shape');
    return item;
  });
  P.items = items;
  // 경계는 init 때 한 번만 — step 안에서 clientWidth/scrollHeight 읽으면 직전 프레임의 left/top 쓰기 때문에
  // 매 프레임 강제 리플로우(레이아웃 thrash)가 일어나 '던질 때 끊김'의 주범. 캐시해서 제거.
  const BW0 = field.clientWidth || fieldW0;
  const BH0 = fieldH;
  // 초기 강하게 분리 → 빠르게 안 겹치게 정착(가로 정체 시 세로로 펼침). 촘촘한 씨드라 반복 넉넉히.
  for (let _it = 0; _it < 360; _it++) _shapeSeparate(items, BW0);
  let _fieldH = BH0;
  items.forEach((b) => { if (b.y + b.h + 40 > _fieldH) _fieldH = b.y + b.h + 40; });
  field.style.height = _fieldH + 'px';
  let frame = 0;
  function step() {
    const its = P.items, n = its.length;
    if (!n) return;
    // 부딪히면 옆으로 — 연속 분리(매 프레임, 튕김/이동 없이 위치만 밀어 비켜감). 안정 위해 2회.
    _shapeSeparate(its, BW0); _shapeSeparate(its, BW0);
    frame++;
    let maxY = BH0;
    for (let i = 0; i < n; i++) {
      const b = its[i];
      if (b.el.classList.contains('dragging')) continue;
      if (b.x < 0) b.x = 0; else if (b.x + b.w > BW0) b.x = Math.max(0, BW0 - b.w);
      if (b.y < 0) b.y = 0;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
      const bx = Math.sin(frame * 0.012 + b.ph) * b.amp;   // 제자리 둥둥(작은 진폭)
      const by = Math.cos(frame * 0.010 + b.ph * 1.3) * b.amp;
      b.el.style.transform = 'translate3d(' + (b.x + bx) + 'px,' + (b.y + by) + 'px,0)' + (b.sc && b.sc !== 1 ? ' scale(' + b.sc + ')' : '');
    }
    if (maxY + 40 > _fieldH) { _fieldH = maxY + 40; field.style.height = _fieldH + 'px'; }  // 늘기만(스크롤 점프 방지)
    P.raf = requestAnimationFrame(step);
  }
  P.raf = requestAnimationFrame(step);
}
// 부딪히면 옆으로 — 위치만 밀어 분리(튕김/속도 없음). 가로로만 겹치면 세로로도 벌려 정체 해소.
function _shapeSeparate(items, BW) {
  for (let i = 0; i < items.length; i++) {
    const a = items[i]; if (a.el.classList.contains('dragging')) continue;
    for (let j = i + 1; j < items.length; j++) {
      const c = items[j]; if (c.el.classList.contains('dragging')) continue;
      const acx = a.x + a.w / 2, acy = a.y + a.h / 2, ccx = c.x + c.w / 2, ccy = c.y + c.h / 2;
      let dx = ccx - acx, dy = ccy - acy; const dist = Math.hypot(dx, dy) || 0.01;
      const min = (a.r + c.r) + 26;    // 반경 + 여백(사용자: 좀 더 덜 겹치게 범위 확대) → 사이 간격 넉넉
      if (dist < min) {
        const ov = (min - dist) / 2; let nx = dx / dist, ny = dy / dist;
        if (Math.abs(ny) < 0.25) { ny = (acy <= ccy ? 1 : -1) * 0.5; const nm = Math.hypot(nx, ny) || 1; nx /= nm; ny /= nm; }
        a.x -= nx * ov; a.y -= ny * ov; c.x += nx * ov; c.y += ny * ov;
      }
    }
  }
}
window.startShapesPhysics = startShapesPhysics;

// 발견 보기 토글: 도형 ↔ 앨범 자켓(블라인드+해시태그). 선택은 localStorage 에 저장.
window.toggleDiscoverMode = function () {
  window.__discoverMode = (window.__discoverMode === 'jacket') ? 'shape' : 'jacket';
  try { localStorage.setItem('offstage_discover_mode', window.__discoverMode); } catch (_) {}
  if (typeof renderShapes === 'function') renderShapes();
};

// ── Unified "like" for tracks (works for both Supabase tracks and mock tracks).
// Reads from window.__favoritedTracks (Supabase cache) or db.currentUser.likedTracks (legacy).
// ============================================================
// CollectedTracks — '내 우주에 모으기'의 단일 진실 소스(local).
// db.currentUser.likedTracks 는 프로필 재매핑 때 []로 덮어써지고,
// window.__favoritedTracks 는 Supabase 테이블이 있어야만 동작한다.
// 그래서 어떤 경우에도 안 지워지는 전용 localStorage 키에 따로 저장한다.
// ============================================================
window.CollectedTracks = {
  _key: 'offstage_collected_tracks',
  _ids: null,
  _load() {
    if (this._ids) return this._ids;
    try {
      const raw = localStorage.getItem(this._key);
      this._ids = new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { this._ids = new Set(); }
    return this._ids;
  },
  _save() {
    try { localStorage.setItem(this._key, JSON.stringify([...this._load()])); } catch (_) {}
  },
  has(id)    { return !!id && this._load().has(id); },
  all()      { return [...this._load()]; },
  add(id)    { if (id) { this._load().add(id); this._save(); } },
  remove(id) { if (id) { this._load().delete(id); this._save(); } },
  toggle(id) {
    const s = this._load();
    if (s.has(id)) { s.delete(id); this._save(); return false; }
    s.add(id); this._save(); return true;
  }
};

function isTrackLiked(trackId) {
  // 1순위: 전용 localStorage (가장 안정적)
  if (window.CollectedTracks && window.CollectedTracks.has(trackId)) return true;
  if (window.__favoritedTracks && window.__favoritedTracks.has && window.__favoritedTracks.has(trackId)) return true;
  try {
    const db = window.DB && window.DB.get && window.DB.get();
    if (db && db.currentUser && Array.isArray(db.currentUser.likedTracks)) {
      return db.currentUser.likedTracks.indexOf(trackId) >= 0;
    }
  } catch (_) {}
  return false;
}

// Toggle a track heart. Mirrors to both Supabase (if track is server-stored)
// and the local DB so liked items always appear in the universe.
// Long-press menu on a floating shape: quick actions like collect-to-universe
// and add-to-playlist. Anchored near the touch point.
window.openShapeLongPressMenu = function(trackId, anchorX, anchorY, shapeEl) {
  // Clean up any existing menu first
  const existing = document.getElementById('shape-longpress-menu');
  if (existing) existing.remove();

  // 폴더 안인지 판단 — 폴더 안이면 '폴더에서 빼기', 아니면 '내 우주에 모으기/빼기'.
  const folderId = (shapeEl && shapeEl.dataset && shapeEl.dataset.folderId) || window.__universeFolderId || null;
  const noteId = shapeEl && shapeEl.dataset && shapeEl.dataset.noteId;

  let itemsHtml;
  if (folderId) {
    const itemId = trackId || noteId || '';
    if (!itemId) return;
    const kind = (trackId ? 'track' : 'note');
    const argId = itemId.replace(/'/g, "\\'");
    const argF  = (folderId || '').replace(/'/g, "\\'");
    itemsHtml = `
      <button class="splp-item" onclick="event.stopPropagation(); _splpClose(); _removeFromFolder('${argF}','${argId}','${kind}')">
        <i class="ri-inbox-unarchive-line" style="color:#ff6b6b;"></i>
        <span>폴더에서 빼기</span>
      </button>`;
  } else {
    // 떠다니는 내 우주 — 트랙만 메뉴 있음
    if (!trackId) return;
    const inUniverse = (typeof isTrackLiked === 'function') ? isTrackLiked(trackId) : false;
    const argT = (trackId || '').replace(/'/g, "\\'");
    itemsHtml = `
      <button class="splp-item" onclick="event.stopPropagation(); _splpCollect('${argT}', this)">
        <i class="ri-${inUniverse ? 'heart-fill' : 'heart-add-line'}" style="color:#ff2e63;"></i>
        <span>${inUniverse ? '우주에서 빼기' : '내 우주에 모으기'}</span>
      </button>`;
  }

  const menu = document.createElement('div');
  menu.id = 'shape-longpress-menu';
  menu.className = 'shape-longpress-menu';
  menu.innerHTML = itemsHtml + `
    <button class="splp-item splp-cancel" onclick="event.stopPropagation(); _splpClose()">
      <i class="ri-close-line"></i>
      <span>닫기</span>
    </button>
  `;
  document.body.appendChild(menu);

  // Position near the anchor, clamping to viewport
  const W = menu.offsetWidth || 200;
  const H = menu.offsetHeight || 140;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = Math.min(Math.max(8, anchorX - W / 2), vw - W - 8);
  let top  = Math.max(8, anchorY - H - 14);          // prefer above the touch
  if (top < 60) top = Math.min(anchorY + 16, vh - H - 8);  // not enough room → below
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';

  // Dismiss on outside tap/click — register on next tick to avoid the
  // touchend that triggered the menu from immediately closing it.
  // ⚠️ 데스크탑: 꾹 눌렀다 떼면 그 도형에서 'click' 이 한 번 발생하는데,
  //    그게 메뉴를 즉시 닫아버림(=메뉴가 안 뜨는 것처럼 보임). 그래서 메뉴를
  //    연 도형(shapeEl) 위의 클릭/탭은 무시한다.
  setTimeout(() => {
    const onOutside = (ev) => {
      if (menu.contains(ev.target)) return;
      if (shapeEl && (ev.target === shapeEl || (shapeEl.contains && shapeEl.contains(ev.target)))) return;
      _splpClose();
    };
    menu.__onOutside = onOutside;
    document.addEventListener('click', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
  }, 50);
};

window._splpClose = function() {
  const m = document.getElementById('shape-longpress-menu');
  if (!m) return;
  if (m.__onOutside) {
    document.removeEventListener('click', m.__onOutside, true);
    document.removeEventListener('touchstart', m.__onOutside, true);
  }
  m.remove();
};

window._splpCollect = function(trackId, btn) {
  if (typeof window.toggleTrackHeart === 'function') {
    window.toggleTrackHeart(trackId, btn);
  }
  _splpClose();
  // On /universe, the removed shape should disappear — refresh
  if (currentView === 'universe' && typeof renderUniverse === 'function') {
    setTimeout(() => renderUniverse(), 200);
  }
};

window._splpAddToFolder = function(trackId) {
  _splpClose();
  if (typeof window.openPlaylistModal === 'function') {
    window.openPlaylistModal(trackId);
  }
};

// 내 우주에서 곡 오브제를 폴더 오브제 위로 드래그-드롭했을 때 호출.
// 곡을 폴더(플레이리스트)에 담고, 떠다니던 곡은 우주에서 정리(제거)한다.
window._dropTrackIntoFolder = async function(trackId, folderId) {
  if (!trackId || !folderId) return;
  let ok = false;
  try {
    if (window.Playlists && window.Playlists.addTrack) {
      await window.Playlists.addTrack(folderId, trackId);
      await window.Playlists.refreshInto(window.DB.get());
      ok = true;
    } else if (window.DB && window.DB.addTrackToPlaylist) {
      window.DB.addTrackToPlaylist(folderId, trackId);
      ok = true;
    }
  } catch (e) {
    console.warn('[universe] dropTrackIntoFolder', e);
    if (typeof showToast === 'function') showToast(e.message || _t('담기에 실패했어요', 'Failed to add'));
  }

  if (ok) {
    // 수집(❤)은 그대로 유지 — 폴더에 담긴 곡은 떠다니는 우주에서만 빠진다(폴더 안에 있으니까).
    if (typeof showToast === 'function') showToast(_t('폴더에 담았어요 🎵', 'Added to folder 🎵'));
    if (typeof renderSidebarPlaylists === 'function') renderSidebarPlaylists();
    // 끊김 방지 — 전체 renderUniverse() 대신 surgical 정리만.
    // 다른 도형/포스트잇 움직임/transform 그대로 보존.
    _surgicalDropCleanup({ itemSelector: `[data-track-id="${trackId}"]`, folderId });
  }
};

window.toggleTrackHeart = async function(trackId, btnEl) {
  const db = window.DB.get();
  if (!db.currentUser) {
    alert('로그인 후 이용 가능합니다');
    navigateTo('auth');
    return;
  }
  const track = db.tracks && db.tracks.find(t => t.id === trackId);
  const wasLiked = isTrackLiked(trackId);

  // Optimistic UI flip
  if (btnEl) {
    const icon = btnEl.querySelector('i');
    btnEl.classList.toggle('is-liked', !wasLiked);
    if (icon) icon.className = !wasLiked ? 'ri-heart-fill' : 'ri-heart-line';
    if (!wasLiked) {
      btnEl.classList.add('pop');
      setTimeout(() => btnEl.classList.remove('pop'), 360);
    }
  }

  // 1순위 저장소 — 전용 localStorage (절대 안 지워짐)
  if (window.CollectedTracks) {
    if (wasLiked) window.CollectedTracks.remove(trackId);
    else          window.CollectedTracks.add(trackId);
  }

  // Local DB mirror (used by every shape/demo render + universe)
  if (!Array.isArray(db.currentUser.likedTracks)) db.currentUser.likedTracks = [];
  const idx = db.currentUser.likedTracks.indexOf(trackId);
  if (wasLiked) {
    if (idx >= 0) db.currentUser.likedTracks.splice(idx, 1);
  } else if (idx < 0) {
    db.currentUser.likedTracks.push(trackId);
  }
  if (track) track.likes = Math.max(0, (track.likes || 0) + (wasLiked ? -1 : 1));
  window.DB.save(db);

  // Supabase mirror (only for server-stored tracks)
  if (track && track.__supabase && window.Favorites && window.Favorites.toggle) {
    try { await window.Favorites.toggle(trackId); }
    catch (e) { console.warn('[toggleTrackHeart] Favorites.toggle', e); }
  }
  // 플레이어 바 담기 버튼도 같은 곡이면 동기화 (카드에서 담아도 반영)
  if (typeof _updatePlayerCollectState === 'function' && trackId === window.currentPlayingTrack) {
    _updatePlayerCollectState();
  }
};

// ── 플레이어 바 "담기" — 현재 재생 곡을 즐겨찾기에 모으기 (북마크 아이콘) ──
window.togglePlayerCollect = function (btn) {
  const id = window.currentPlayingTrack;
  if (!id) {
    if (typeof showToast === 'function') showToast(_t('재생 중인 곡이 없어요', 'No track playing'));
    return;
  }
  const el = btn || document.getElementById('player-collect-btn');
  const willCollect = (typeof isTrackLiked === 'function') ? !isTrackLiked(id) : true;
  // 낙관적 북마크 플립 (toggleTrackHeart 에 btn 안 넘김 → 하트 아이콘 강제 안 됨).
  if (el) {
    el.classList.toggle('is-collected', willCollect);
    const icon = el.querySelector('i');
    if (icon) icon.className = willCollect ? 'ri-check-line' : 'ri-add-line';
    if (willCollect) { el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 380); }
  }
  if (typeof window.toggleTrackHeart === 'function') window.toggleTrackHeart(id, null);
};
// 곡이 바뀔 때 담기 버튼의 채움/비움 상태 동기화 (담기 = +, 담김 = ✓).
function _updatePlayerCollectState() {
  const btn = document.getElementById('player-collect-btn');
  if (!btn) return;
  const id = window.currentPlayingTrack;
  const collected = !!(id && typeof isTrackLiked === 'function' && isTrackLiked(id));
  btn.classList.toggle('is-collected', collected);
  const icon = btn.querySelector('i');
  if (icon) icon.className = collected ? 'ri-check-line' : 'ri-add-line';
}
window._updatePlayerCollectState = _updatePlayerCollectState;

// ── 플레이어 제목/아티스트 클릭 → 그 아티스트 페이지로 ──
window.goToPlayerArtist = function (e) {
  if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (_) {} }
  const name = window.__playerArtistName;
  if (!name || name === '-') return;
  // 풀스크린 카드/펼침 열려있으면 닫고 이동
  if (window.closePlayerFs) window.closePlayerFs();
  const player = document.getElementById('global-player');
  if (player && player.classList.contains('expanded')) {
    player.classList.remove('expanded');
    document.body.classList.remove('player-fullscreen');
  }
  navigateTo('artist:' + encodeURIComponent(name));
};

// 미니바 탭 = 풀스크린 펼치기 / 풀스크린(expanded) 상태에서 이름·아트 탭 = 아티스트 마이페이지로.
// (사용자 요청 흐름: 플레이바 누르면 풀스크린 → 거기서 이름 누르면 마이페이지)
window.playerArtOrExpand = function (e) {
  if (e) { try { e.stopPropagation(); } catch (_) {} }
  const player = document.getElementById('global-player');
  if (player && player.classList.contains('expanded')) {
    if (window.goToPlayerArtist) window.goToPlayerArtist(e);
  } else {
    if (window.togglePlayerExpand) window.togglePlayerExpand(e);
  }
};

// Long-press the dice to enter drag mode. Short click still triggers bounce+play.
function initDiceDrag() {
  const dice = document.getElementById('random-dice');
  if (!dice) return;

  const LONG_PRESS_MS = 380;
  const MOVE_CANCEL_PX = 8;  // moving farther than this before timer fires cancels long-press
  let pressTimer = null;
  let isDragging = false;
  let pressActive = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function onDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    const pt = e.touches ? e.touches[0] : e;
    pressActive = true;
    isDragging = false;
    startX = pt.clientX;
    startY = pt.clientY;

    // Compute current dice position in parent's pixel coordinates so we can drag
    const parent = dice.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const diceRect = dice.getBoundingClientRect();
    startLeft = diceRect.left - parentRect.left;
    startTop = diceRect.top - parentRect.top;

    pressTimer = setTimeout(() => {
      // Long-press achieved → enter drag mode
      isDragging = true;
      dice.classList.add('dragging');
      // Lock position to current pixel coords (overrides the `left: X%` from inline style)
      dice.style.left = startLeft + 'px';
      dice.style.top  = startTop + 'px';
    }, LONG_PRESS_MS);
  }

  function onMove(e) {
    if (!pressActive) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;

    // If user moves before long-press fires, treat as scroll/cancel — abort.
    if (!isDragging) {
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
        clearTimeout(pressTimer); pressTimer = null;
        pressActive = false;
      }
      return;
    }

    dice.style.left = (startLeft + dx) + 'px';
    dice.style.top  = (startTop  + dy) + 'px';
    if (e.cancelable) e.preventDefault();
  }

  function onUp() {
    clearTimeout(pressTimer); pressTimer = null;
    if (isDragging) {
      dice.classList.remove('dragging');
      // Suppress the click that would fire immediately after mouseup
      dice.__suppressNextClick = true;
      setTimeout(() => { dice.__suppressNextClick = false; }, 80);
    }
    pressActive = false;
    isDragging = false;
  }

  dice.addEventListener('mousedown', onDown);
  dice.addEventListener('touchstart', onDown, { passive: true });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', onUp);
}

// Set which face of the 3D cube is toward the camera (1-6).
// data-face lives on the .dice-shape wrapper — CSS rotates .dice-cube
// to the matching orientation with a transition.
function setDieFace(el, n) {
  if (el) el.setAttribute('data-face', String(n));
}

// Mouse over → CSS handles the 3D tumble animation via :hover .dice-cube.
// JS just keeps the function defined for compat with inline onmouseenter.
window.diceHoverStart = function(el) { /* CSS-driven */ };
window.diceHoverEnd   = function(el) { /* CSS-driven */ };

// Click → bounce up + shuffle every floating shape. The cube also "rolls"
// to a new random face by changing data-face mid-bounce (CSS transitions it).
window.diceBouncePlay = function(el) {
  if (!el) return;
  // Just finished dragging — swallow this synthetic click
  if (el.__suppressNextClick) { el.__suppressNextClick = false; return; }

  // Quick spin-pulse on the planet (separate from the hover idle spin)
  el.classList.remove('bouncing');
  void el.offsetWidth;                // force reflow → restart animation
  el.classList.add('bouncing');
  setTimeout(() => el.classList.remove('bouncing'), 700);

  // Shuffle all floating shapes to new spots.
  setTimeout(() => shuffleAllShapes(), 120);
};

// ── 유기적 흩뿌리기 + 충돌 완화(relax) ─────────────────────────────────────
// 격자(grid)가 딱딱하다는 피드백 → 막 뿌리되 '많이' 겹치는 것만 떼어놓음(살짝 겹침 허용).

// 시드 기반 결정적 RNG — 리로드해도 같은 배치가 나오게.
function _mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 원형 근사 반복 분리. (a.r+b.r)*(1-slack) 보다 가까운 쌍만 살짝 밀어냄 → slack 만큼 겹침 허용.
function _relaxScatter(items, W, H, o) {
  o = o || {};
  const iters = o.iters || 90;
  const slack = o.slack != null ? o.slack : 0.16;
  const topPad = o.topPad != null ? o.topPad : 24;
  const margin = o.margin != null ? o.margin : 6;
  const rand = o.rand || Math.random;
  for (let k = 0; k < iters; k++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        let dx = (a.x + a.w / 2) - (b.x + b.w / 2);
        let dy = (a.y + a.h / 2) - (b.y + b.h / 2);
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.5) { dx = rand() - 0.5; dy = rand() - 0.5; dist = Math.sqrt(dx * dx + dy * dy) || 0.5; }
        const minD = (a.r + b.r) * (1 - slack);
        if (dist < minD) {
          const push = minD - dist, ux = dx / dist, uy = dy / dist;
          const aFree = !a.pinned, bFree = !b.pinned;
          const aMove = aFree ? (bFree ? push / 2 : push) : 0;
          const bMove = bFree ? (aFree ? push / 2 : push) : 0;
          a.x += ux * aMove; a.y += uy * aMove;
          b.x -= ux * bMove; b.y -= uy * bMove;
          moved = true;
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.pinned) continue;
      it.x = Math.max(margin, Math.min(W - it.w - margin, it.x));
      it.y = Math.max(topPad, Math.min(H - it.h - topPad, it.y));
    }
    if (!moved) break;
  }
}

// DOM 도형 측정 → relax → 위치 적용. render/shuffle 공용.
//   opts.W/opts.H = 필드 경계(주면 그 안에서 정리, 캔버스 크기 안 건드림),
//   opts.pinnedFn(el)→고정, opts.heroCenter!==false 면 .is-newest 를 필드 한가운데 고정.
function _declumpShapes(canvas, opts) {
  opts = opts || {};
  const els = Array.from(canvas.querySelectorAll('.floating-shape[data-track-id], .floating-shape[data-note-id]'));
  if (els.length < 2) return;
  const W = opts.W || canvas.clientWidth || canvas.getBoundingClientRect().width || 360;
  const topPad = opts.topPad != null ? opts.topPad : 24;
  const margin = opts.margin != null ? opts.margin : 6;
  const items = els.map(el => {
    const ps = parseFloat(getComputedStyle(el).getPropertyValue('--scale')) || 1;   // 인기 크기(transform이라 offset엔 안 잡힘)
    const w = (el.offsetWidth || 80) * ps, h = (el.offsetHeight || 80) * ps;
    const isPct = (el.style.left || '').indexOf('%') >= 0;
    const lp = parseFloat(el.style.left) || 0;
    const x = isPct ? (lp / 100) * W : lp;
    const y = parseFloat(el.style.top) || 0;
    const pinned = opts.pinnedFn ? !!opts.pinnedFn(el) : false;
    return { el, w, h, x, y, pinned, r: (w + h) / 4 };
  });
  // 필드 높이 — 주어지면 그대로, 아니면 면적/밀도로 추정 후 캔버스에 적용(구버전 호환)
  let H = opts.H;
  if (!H) {
    const totalArea = items.reduce((s, it) => s + it.w * it.h, 0);
    H = Math.max(opts.minH || 640, topPad + totalArea / (W * (opts.density || 0.5)));
    canvas.style.height = Math.round(H) + 'px';
  }
  // 최신(hero)은 시작 화면(왼쪽 위, 스크롤 0,0)에 보이게 — 첫 뷰포트 폭 안에서 위쪽 가운데.
  if (opts.heroCenter !== false) {
    const vw = (typeof window !== 'undefined' ? window.innerWidth : W);
    items.forEach(it => {
      if (it.el.classList.contains('is-newest')) {
        it.x = Math.max(margin, Math.min(W - it.w - margin, (Math.min(vw, W) - it.w) / 2));
        it.y = topPad;
        it.pinned = true; it._hero = true;
      }
    });
  }
  _relaxScatter(items, W, H, { slack: opts.slack, iters: opts.iters || 90, topPad, margin, rand: opts.rand });
  items.forEach(it => {
    // 드래그 저장 위치는 그대로 두고(hero 와 자유 도형만 적용)
    if (it.pinned && !it._hero) return;
    it.el.style.left = (it.x / W * 100).toFixed(2) + '%';
    it.el.style.top = Math.round(it.y) + 'px';
  });
}

// 행성 버튼 — 도형을 2D 필드 안에서 고르게(칸 셔플) 다시 흩뿌린 뒤 relax 로 정리.
function shuffleAllShapes() {
  const field = document.querySelector('#shapes-scroll .universe-field') || document.querySelector('.universe-field');
  if (!field) return;
  const els = Array.from(field.querySelectorAll('.floating-shape[data-track-id], .floating-shape[data-note-id]'));
  if (!els.length) return;
  const isNarrow = (typeof window !== 'undefined' ? window.innerWidth : 1024) < 600;
  const fieldW = field.offsetWidth || field.clientWidth || 360;
  const fieldH = field.offsetHeight || field.clientHeight || 800;
  const N = els.length;
  const avgW = isNarrow ? 134 : 235, avgH = isNarrow ? 108 : 180;
  // 2D 칸 격자(필드 비율에 맞춤)
  let gCols = Math.max(1, Math.round(Math.sqrt(N * (fieldW / fieldH))));
  gCols = Math.min(gCols, N);
  const gRows = Math.max(1, Math.ceil(N / gCols));
  const cellW = fieldW / gCols, cellH = fieldH / gRows;
  // 칸 배정을 섞는다 → 매번 다른 자리(셔플 느낌). 칸 안은 랜덤.
  const order = els.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  order.forEach((el, idx) => {
    const ci = idx % gCols, ri = Math.floor(idx / gCols);
    const x = ci * cellW + Math.random() * Math.max(8, cellW - avgW);
    const y = ri * cellH + Math.random() * Math.max(8, cellH - avgH);
    el.style.animation = 'none';
    el.style.transition = 'left 0.6s cubic-bezier(0.34, 1.2, 0.5, 1), top 0.6s cubic-bezier(0.34, 1.2, 0.5, 1)';
    el.style.left = (x / fieldW * 100).toFixed(2) + '%';
    el.style.top  = Math.round(y) + 'px';
  });
  // 최신도 같이 흩뿌림(heroCenter:false), 필드 경계 안에서 정리
  _declumpShapes(field, { W: fieldW, H: fieldH, slack: isNarrow ? 0.14 : 0.18, heroCenter: false, rand: Math.random });
  // Resume floatDrift after the glide settles
  setTimeout(() => {
    els.forEach(el => { el.style.transition = ''; el.style.animation = ''; });
  }, 700);
}

// Back-compat: older onclick="rollRandomTrack(this)" still works
window.rollRandomTrack = function(el) { window.diceBouncePlay(el); };

// ============================================================
// 내 음악 폴더 (playlists) — 우주에 둥둥 떠다니는 오브제(orb)로 렌더.
// 곡/포스트잇과 같은 floating-shape 캔버스 위에서 드래그 가능.
// 나중에 모은 곡을 폴더 위로 끌어다 정리하는 그림.
// ============================================================
function _floatingFolderHtml(it, pos) {
  // pos 가 없으면(null) = 상단 '폴더 줄' 모드 — 절대위치/드리프트 없이 인라인 배치 +
  // 클릭은 드래그 캔버스 밖이라 명시 onclick 으로 연결(열기/생성/템플릿).
  const row = !pos;
  // ── 즐겨찾기 폴더 바(row 모드) = 테스트 글래스 카드(폴더 아이콘 + 이름 + "N곡 보관").
  //    drag-drop(곡→폴더) 위해 .floating-folder + data-folder-id 유지. pos 모드(캔버스 floating)는 아래 윈도우 폴더 그대로. ──
  if (row) {
    if (it.kind === 'folderNew') return '';   // 새 폴더 생성은 상단 헤더 버튼(✨ 옆)으로 이동 — 폴더 바엔 카드 안 넣음(사용자 요청)
    if (it.kind === 'folderTpl') {
      const f = it.tpl; const ttl = (f.title || '폴더').replace(/</g, '&lt;');
      return `<div class="floating-folder uni-folder-row-item folder-glass" data-folder-template="${ttl.replace(/"/g, '&quot;')}" data-uid="${it.id}" style="--folder-color:${f.color};" onclick="window.createDefaultPlaylist && createDefaultPlaylist('${ttl.replace(/'/g, "\\'")}')"><div class="fg-icon" style="color:${f.color};"><i class="ri-folder-3-line"></i></div><div class="fg-title">${ttl}</div><div class="fg-count">0${_t('곡 보관', ' saved')}</div></div>`;
    }
    const fp = it.folder; const ftitle = (fp.title || '무제').replace(/</g, '&lt;');
    const fcount = (fp.trackIds || []).length + (typeof _getFolderNoteIds === 'function' ? _getFolderNoteIds(fp.id).size : 0);
    return `<div class="floating-folder uni-folder-row-item folder-glass" data-folder-id="${fp.id}" onclick="window.enterFolderWithAnim && enterFolderWithAnim('${fp.id}', this)"><button class="fg-del" type="button" onclick="event.stopPropagation(); window.deletePlaylistFolder && deletePlaylistFolder('${fp.id}')" aria-label="${_t('폴더 삭제', 'Delete folder')}" title="${_t('폴더 삭제', 'Delete folder')}"><i class="ri-close-line"></i></button><div class="fg-icon"><i class="ri-folder-3-line"></i></div><div class="fg-title">${ftitle}</div><div class="fg-count">${fcount}${_t('곡 보관', ' saved')}</div></div>`;
  }
  const posStyle = row ? '' : `left:${pos.xBase}%; top:${pos.yPx}px; animation: floatDrift ${pos.dur}s ease-in-out infinite; --dx:${pos.dx}px; --dy:${pos.dy}px; --rot:${pos.rot}deg;`;
  const cls = row ? 'floating-folder is-winfolder uni-folder-row-item' : 'floating-shape floating-folder is-winfolder';

  if (it.kind === 'folderNew') {
    // '새 폴더' — 윈도우 폴더 모양 고스트(반투명) + 플러스 (사용자 요청: 폴더 모양 통일)
    return `
      <div class="${cls} is-wf-new" data-folder-new="1" data-uid="${it.id}" style="${posStyle}" ${row ? 'onclick="window.promptNewPlaylist && promptNewPlaylist()"' : ''}>
        <div class="winfolder">
          <span class="wf-back" aria-hidden="true"></span>
          <span class="wf-front" aria-hidden="true"></span>
          <span class="wf-plus" aria-hidden="true"><i class="ri-add-line"></i></span>
        </div>
        <div class="folder-orb-title">${_t('새 폴더', 'New folder')}</div>
      </div>`;
  }

  if (it.kind === 'folderTpl') {
    // 템플릿(만들기 유도) 폴더 — 윈도우 폴더 모양에 색 입히고 이모지를 앞면에
    const f = it.tpl;
    const title = (f.title || '폴더').replace(/</g,'&lt;');
    return `
      <div class="${cls} is-wf-tpl" data-folder-template="${title.replace(/"/g,'&quot;')}" data-uid="${it.id}"
           style="${posStyle} --folder-color:${f.color};" ${row ? `onclick="window.createDefaultPlaylist && createDefaultPlaylist('${title.replace(/'/g,"\\'")}')"` : ''}>
        <div class="winfolder">
          <span class="wf-back" aria-hidden="true"></span>
          <span class="wf-front" aria-hidden="true"></span>
          <span class="wf-emoji" aria-hidden="true">${f.emoji}</span>
        </div>
        <div class="folder-orb-title">${title}</div>
      </div>`;
  }

  // 실제 사용자 폴더 — 윈도우(OS) 폴더 모양: 뒤판+탭, 커버가 안에서 빼꼼, 앞 덮개. (사용자 요청)
  const p = it.folder;
  const title = (p.title || '무제').replace(/</g,'&lt;');
  const count = (p.trackIds || []).length + (typeof _getFolderNoteIds === 'function' ? _getFolderNoteIds(p.id).size : 0);   // 트랙 + 폴더에 담은 포스트잇
  const cover = p.cover || '';
  const paper = cover
    ? `<img class="wf-paper" src="${cover}" alt="${title.replace(/"/g,'&quot;')}" loading="lazy" draggable="false">`
    : '';
  return `
    <div class="${cls}" data-folder-id="${p.id}" style="${posStyle}" ${row ? `onclick="window.enterFolderWithAnim && enterFolderWithAnim('${p.id}', this)"` : ''}>
      <div class="winfolder">
        <span class="wf-back" aria-hidden="true"></span>
        ${paper}
        <span class="wf-front" aria-hidden="true"></span>
        <span class="folder-orb-count">${count}</span>
      </div>
      <div class="folder-orb-title">${title}</div>
    </div>`;
}

// ============================================================
// 내 우주 — user's curated collection space
// Liked tracks (masters + demos) + bookmarked post-its, all
// floating in the same shapes-universe canvas. Drag to rearrange.
// ============================================================
window.renderUniverse = async function (force) {
  // 즐겨찾기 → 플레이리스트로 교체(사용자 요청). 옛 우주(도형·폴더) 코드는 아래 보존.
  // 롤백: 이 위임 한 줄만 지우면 옛 즐겨찾기 우주로 복귀.
  if (typeof renderPlaylist === 'function') return renderPlaylist();
  const db = window.DB.get();
  if (!db.currentUser) { navigateTo('auth'); return; }

  // 폴더 진입/나가기 애니메이션 중엔 백그라운드 콜백(북마크 fetch 등)의 재렌더를 막는다.
  // (진입 시작~완료 사이 __universeFolderId 가 아직 null 이라 기존 가드를 통과해 애니를 wipe →
  //  '한번 움직이다 멈추고 툭툭' 끊기던 원인.) 의도된 렌더(exitFolderToUniverse)는 force=true.
  if (window.__universeFolderEntering && !force) return;

  // 폴더 안을 보는 중이면(내 우주를 벗어나지 않고 그 자리에서) 폴더 우주를 그린다.
  if (window.__universeFolderId) { _renderFolderUniverse(window.__universeFolderId); return; }

  // Refresh strategy: render cached state first, refresh in background.
  // 내 우주의 모든 데이터 소스를 한 번에 fetch — 다른 디바이스랑 안 맞던 원인이
  // refreshTasks 에 Playlists/Tracks/Positions 가 빠져있던 거였음.
  const hasFavCache = window.__favoritedTracks && window.__favoritedTracks.size > 0;
  const hasBmkCache = window.__bookmarkedNotes && window.__bookmarkedNotes.size > 0;
  const refreshTasks = [];
  if (window.Walls && window.Walls.refreshMyBookmarks)   refreshTasks.push(window.Walls.refreshMyBookmarks().catch(()=>{}));
  if (window.Favorites && window.Favorites.refreshMine)  refreshTasks.push(window.Favorites.refreshMine().catch(()=>{}));
  if (window.Playlists && window.Playlists.refreshInto)  refreshTasks.push(window.Playlists.refreshInto(db).catch(()=>{}));
  if (window.Tracks && window.Tracks.refreshInto)        refreshTasks.push(window.Tracks.refreshInto(db).catch(()=>{}));
  if (window.Positions && window.Positions.hydrateFromCloud) refreshTasks.push(window.Positions.hydrateFromCloud().catch(()=>{}));
  if (refreshTasks.length) {
    if (hasFavCache || hasBmkCache || window.__universeLoadedOnce) {
      // sig 비교 확장 — 폴더 / 폴더 안 곡·포스트잇 변화도 감지 (다른 기기에서 폴더에 담은 케이스)
      const buildSig = () => {
        const fav = Array.from(window.__favoritedTracks || []).sort().join('|');
        const bmk = Array.from(window.__bookmarkedNotes || []).sort().join('|');
        const pls = (window.__playlists || (db.playlists || []))
          .map(p => {
            if (!p) return '';
            const tids = (p.trackIds || []).slice().sort().join(',');
            const nids = Array.from((window.__folderNotes && window.__folderNotes[p.id]) || []).sort().join(',');
            return p.id + ':' + tids + '/' + nids;
          })
          .sort().join(';');
        return fav + '#' + bmk + '@' + pls;
      };
      const sigBefore = buildSig();
      Promise.all(refreshTasks).then(() => {
        window.__universeLoadedOnce = true;
        if (currentView !== 'universe' || window.__universeFolderId) return;
        // 폴더 진입 애니메이션 중이면 재렌더 스킵 — 애니 wipe 방지
        if (window.__universeFolderEntering) return;
        const sigAfter = buildSig();
        if (sigAfter !== sigBefore) window.renderUniverse();
      });
    } else {
      // 최초 1회 — 1.5s 까지 데이터 기다림
      await Promise.race([
        Promise.all(refreshTasks),
        new Promise(r => setTimeout(r, 1500))
      ]);
      window.__universeLoadedOnce = true;
      if (currentView !== 'universe') return;
    }
  }

  // ── Liked tracks (masters + demos) ───────────────────────
  // 우선순위: 전용 localStorage(CollectedTracks) → likedTracks → Supabase 캐시
  const likedIds = new Set(db.currentUser.likedTracks || []);
  if (window.CollectedTracks && window.CollectedTracks.all) {
    window.CollectedTracks.all().forEach(id => likedIds.add(id));
  }
  // Also fold in Supabase favorites cache
  if (window.__favoritedTracks && window.__favoritedTracks.forEach) {
    window.__favoritedTracks.forEach(id => likedIds.add(id));
  }
  // db.tracks 에 아직 안 들어온 신규 업로드도 찾을 수 있게 __tracks 병합
  const allTracks = (db.tracks || []).slice();
  if (Array.isArray(window.__tracks)) {
    const seen = new Set(allTracks.map(t => t && t.id));
    window.__tracks.forEach(t => { if (t && !seen.has(t.id)) allTracks.push(t); });
  }
  // 폴더에 담긴 곡은 떠다니는 우주에서 제외(폴더 안에 있으니까). 수집(❤)은 유지.
  const _folderedTracks = (typeof _allFolderedTrackIds === 'function') ? _allFolderedTrackIds() : new Set();
  const likedTracks = allTracks.filter(t => t && likedIds.has(t.id) && !_folderedTracks.has(t.id));

  // ── Bookmarked notes ─────────────────────────────────────
  const allNotes = db.notes || [];
  let bookmarkedNotes = [];
  if (window.__bookmarkedNotes && window.__bookmarkedNotes.size) {
    const setIds = window.__bookmarkedNotes;
    bookmarkedNotes = allNotes.filter(n => n && setIds.has(n.id));
    // 캐시(db.notes)로 즉시 렌더하고, 로컬에 없는 북마크 노트는 백그라운드로
    // 가져와 db.notes 에 합친 뒤 1회만 다시 그린다 (await 제거 → 뒤로가기 빠름)
    if (window.Walls && window.Walls.fetchMyBookmarks) {
      window.Walls.fetchMyBookmarks().then(fetched => {
        if (currentView !== 'universe' || window.__universeFolderId) return;
        const dbNow = window.DB.get();
        const have = new Set((dbNow.notes || []).map(n => n && n.id));
        const extra = (fetched || []).filter(n => n && !have.has(n.id));
        if (extra.length) {
          dbNow.notes = (dbNow.notes || []).concat(extra);
          try { window.DB.save(dbNow); } catch (_) {}
          window.renderUniverse();  // 이제 db.notes 에 있으니 재호출 루프 없음
        }
      }).catch(() => {});
    }
  }
  // 폴더에 담긴 포스트잇은 떠다니는 우주에서 제외(폴더 안에 있으니까). 수집(북마크)은 유지.
  const _folderedNotes = (typeof _allFolderedNoteIds === 'function') ? _allFolderedNoteIds() : new Set();
  if (_folderedNotes.size) bookmarkedNotes = bookmarkedNotes.filter(n => n && !_folderedNotes.has(n.id));

  // ── 내 음악 폴더 (playlists) — 우주에 둥둥 떠다니는 오브제로 ──
  // 캐시(window.__playlists / db.playlists) 우선 — 뒤로가기 등에서 네트워크
  // 대기 없이 즉시 렌더. (목록은 init/폴더생성 때 이미 갱신됨)
  let myPlaylists = Array.isArray(window.__playlists)
    ? window.__playlists
    : (Array.isArray(db.playlists) ? db.playlists : []);

  const folderItems = (myPlaylists || []).map(p => ({ kind: 'folder', id: p.id, folder: p }));
  // 폴더가 하나도 없으면 기본 템플릿을 띄워 만들기를 유도
  if (folderItems.length === 0) {
    [
      { title: '즐겨듣기',   emoji: '⭐', color: '#FFD54F' },
      { title: '투자하고픈', emoji: '💎', color: '#BA68C8' },
      { title: '애는 된다',  emoji: '🔥', color: '#FF8A65' }
    ].forEach(f => folderItems.push({ kind: 'folderTpl', id: 'tpl:' + f.title, tpl: f }));
  }
  // '폴더 줄'(상단 고정) 아이템 — 생성(+)이 맨 앞(왼쪽), 그 다음 폴더들. 새로 만들면 오른쪽으로 추가됨.
  const folderRowItems = [{ kind: 'folderNew', id: 'folder-new' }, ...folderItems];

  // ── Layout: distribute items in a 3-col grid pattern with a deterministic jitter ──
  // Order + jitter must be STABLE across reloads so user-curated positions feel persistent.
  function _loadUniversePos(id) {
    try {
      const raw = localStorage.getItem('unipos:' + id);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.xPct !== 'number' || typeof p.yPx !== 'number') return null;
      return p;
    } catch (_) { return null; }
  }

  // 폴더는 상단 줄로 분리됨 — 캔버스엔 곡(도형)·포스트잇만 떠다님.
  const allItems = [
    ...likedTracks.map(t => ({ kind: 'track', t, id: t.id })),
    ...bookmarkedNotes.map(n => ({ kind: 'note', n, id: n.id }))
  ];
  // Stable order: sort by item id so reloading doesn't rearrange the grid.
  allItems.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 실제 폴더가 정확히 1개면 자동 위치저장을 건너뛰어 _centerUniverseFolder 가
  // 매 렌더 가운데로 두게 한다 (사용자 요청). 드래그하면 그때 저장돼 우선됨.
  const realFolderCount = allItems.filter(it => it.kind === 'folder').length;

  // 모바일은 2열 + 간격 넓게 → 폴더(152px)·도형이 좁은 화면에서 안 겹치게 (발견 페이지와 동일 방식)
  const _uniNarrow = (typeof window !== 'undefined' ? window.innerWidth : 1024) < 600;
  const cols = _uniNarrow ? 2 : 3;
  const _uniSpread = _uniNarrow ? 46 : 30;   // 열 간 가로 간격(%)
  const _uniRowH   = _uniNarrow ? 250 : 280;  // 행 간 세로 간격(px)
  const universeHeight = Math.max(900, Math.ceil(allItems.length / cols) * _uniRowH + 60);

  // 별 배경은 #app-content 밖의 영구 레이어로 → innerHTML 재설정에 안 영향받음.
  // _ensurePersistentStarfield() 가 body 에 한 번만 생성, 페이지 .is-universe 클래스로 보이기 토글.
  _ensurePersistentStarfield();
  if (typeof _dpStyle === 'function') _dpStyle();   // 발견 dp- 도형 스타일(즐겨찾기 곡 도형도 동일하게)
  document.body.classList.add('is-universe-route');
  // 본문 안엔 별 자리 비워 둠 (호환성 차원에서 .universe-starfield 빈 div 만)
  const decoHtml = '';

  // Item nodes
  let itemsHtml = '';
  allItems.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Per-item deterministic seed → stable jitter + drift animation
    const seed = _hashSeed(it.id);
    const stored = _loadUniversePos(it.id);
    let xBase, yPx, rot;
    if (stored) {
      xBase = stored.xPct;
      yPx   = stored.yPx;
      rot   = (typeof stored.rot === 'number') ? stored.rot : ((((seed >>> 8) % 140) - 70) / 10);
    } else {
      // 처음 배치는 인덱스 기반 격자 → 그대로 두면 항목이 추가/삭제될 때(폴더에
      // 담을 때) 인덱스가 밀려 위치가 초기화됨. 그래서 첫 렌더에 위치를 저장해
      // 고정시킨다(이후엔 stored 사용 → 안 밀림).
      xBase = 4 + col * _uniSpread + (seed % (_uniNarrow ? 5 : 14));
      yPx   = 30 + row * _uniRowH + ((seed >>> 4) % (_uniNarrow ? 30 : 50));
      rot   = (((seed >>> 8) % 140) - 70) / 10;
      // 폴더 1개 케이스는 폴더+새폴더버튼 자동저장 스킵 → 중앙 나란히 정렬 유지 (드래그 시에만 저장).
      const _skipAutoSave = ((it.kind === 'folder' || it.kind === 'folderNew') && realFolderCount === 1);
      if (!_skipAutoSave) {
        try { localStorage.setItem('unipos:' + it.id, JSON.stringify({ xPct: xBase, yPx, rot })); } catch (_) {}
      }
    }
    const dur = 10 + ((seed >>> 16) % 18);
    const _uniDrift = _uniNarrow ? 10 : 25;   // 모바일은 진폭 줄여 겹침 방지
    const dx  = (((seed >>> 12) % (_uniDrift * 2)) - _uniDrift);
    const dy  = (((seed >>> 20) % (_uniDrift * 2)) - _uniDrift);

    if (it.kind === 'folder' || it.kind === 'folderTpl' || it.kind === 'folderNew') {
      itemsHtml += _floatingFolderHtml(it, { xBase, yPx, rot, dur, dx, dy });
    } else if (it.kind === 'track') {
      const t = it.t;
      // 발견(새 패턴)과 통일 — dp- 도형/레트로색/해시태그. .floating-shape 는 유지(드래그/위치/드리프트).
      const _DPC = ['#E24A9C','#7FB2EC','#86CE34','#B49BEE','#F06CA8','#FF8A6E','#26C6C6','#FFB03A'];
      const _DPS = ['burst','circle','tri'];
      const _dc = _DPS[i % _DPS.length], _dcol = _DPC[i % _DPC.length];
      const _tags = (Array.isArray(t.tags) && t.tags.length) ? t.tags.slice(0,3)
                  : [t.title || '곡', t.artist || ''].filter(Boolean).slice(0,3);
      const _tagHtml = _tags.map(tg => '#' + String(tg).replace(/^#/, '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).join('<br>');
      itemsHtml += `
        <div class="floating-shape dp-univ${_dc==='tri' ? ' dp-tri-wrap' : ''}" data-track-id="${t.id}" data-artist="${encodeURIComponent(t.artist || '')}"
             style="left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;">
          <div class="dp-shape dp-${_dc}" style="background:${_dcol}"></div>
          <div class="dp-s-text">${_tagHtml}</div>
        </div>
      `;
    } else {
      const n = it.n;
      const c = (typeof NOTE_COLORS !== 'undefined' ? NOTE_COLORS[n.color] : null) || { bg:'#FFF59D', text:'#1a1a1a' };
      const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const safeAuth = (n.author || '').replace(/</g,'&lt;');
      // Notes use the same seeded rotation as shapes for stability
      const noteRot = (typeof n.rotation === 'number') ? n.rotation : rot;
      const noteChip = (typeof _renderNoteTrackChip === 'function') ? _renderNoteTrackChip(n) : '';
      itemsHtml += `
        <div class="universe-note floating-shape" data-note-id="${n.id}"
             style="left:${xBase}%; top:${yPx}px; background:${c.bg}; color:${c.text}; animation: floatDrift ${dur+4}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${noteRot}deg;">
          <button class="universe-note-x" onclick="_removeNoteFromUniverse('${n.id}', event)" aria-label="${_t('우주에서 빼기', 'Remove')}" title="${_t('우주에서 빼기', 'Remove from universe')}"><i class="ri-close-line"></i></button>
          <div class="universe-note-body">${safeTxt}</div>
          <div class="universe-note-sig">— ${safeAuth}</div>
          ${noteChip}
        </div>
      `;
    }
  });

  appContent.innerHTML = `
    <div id="universe-head">
      <div class="uni-guide">
        <i class="ri-sparkling-2-fill uni-guide-spark"></i>
        <span>${_i18n('행성을 끌어다 아래 폴더에 놓으면 수집!', 'Drag a planet into a folder below to collect!')}</span>
      </div>
      <button class="uni-newfolder-btn" type="button" onclick="window.promptNewPlaylist && window.promptNewPlaylist()" aria-label="${_t('새 폴더', 'New folder')}"><i class="ri-folder-add-line"></i></button>
    </div>
    <div class="universe-folder-row">${folderRowItems.map(it => _floatingFolderHtml(it, null)).join('')}</div>
    <div class="shapes-universe my-universe" style="height: ${universeHeight}px;">
      ${itemsHtml}
    </div>
  `;

  // Reuse the same drag system as the main shapes page
  if (typeof initShapeDrag === 'function') initShapeDrag();

  // 폴더가 하나면 화면 가로 중앙으로 (사용자 요청). 여러 개면 그대로 둠.
  try { _centerUniverseFolder(); } catch (_) {}
  // dp- 곡 도형 해시태그 잘림 방지(도형별 안전영역에 폰트 맞춤)
  try { if (typeof _fitDpUnivText === 'function') _fitDpUnivText(appContent); } catch (_) {}
};

// 폴더 1개일 때: 폴더 + '새 폴더' 버튼을 가로 중앙에 나란히 (겹침 방지). 드래그하면 그 위치 저장돼 우선.
function _centerUniverseFolder() {
  const canvas = document.querySelector('.shapes-universe.my-universe');
  if (!canvas) return;
  const folders = canvas.querySelectorAll('.floating-folder[data-folder-id]');
  if (folders.length !== 1) return;
  const f = folders[0];
  // 사용자가 직접 옮긴(저장된) 위치가 있으면 존중.
  let fStored = null;
  try { fStored = localStorage.getItem('unipos:' + f.getAttribute('data-folder-id')); } catch (_) {}
  const cw = canvas.clientWidth || canvas.offsetWidth || 0;
  const fw = f.offsetWidth || 150;
  const newBtn = canvas.querySelector('.floating-folder[data-folder-new]');
  let newStored = null;
  try { newStored = newBtn && localStorage.getItem('unipos:folder-new'); } catch (_) {}

  // 둘 다 안 옮겼으면 → 가운데 나란히 배치
  if (newBtn && !fStored && !newStored) {
    const nw = newBtn.offsetWidth || 150;
    const gap = 14;
    const total = fw + gap + nw;
    let startX = Math.round((cw - total) / 2);
    if (startX < 6) startX = 6;
    f.style.setProperty('left', startX + 'px', 'important');
    f.style.setProperty('top', '130px', 'important');
    newBtn.style.setProperty('left', (startX + fw + gap) + 'px', 'important');
    newBtn.style.setProperty('top', '130px', 'important');
    return;
  }
  // 폴더만 안 옮겼으면 폴더만 가운데
  if (!fStored) {
    const leftPx = Math.max(0, Math.round((cw - fw) / 2));
    f.style.setProperty('left', leftPx + 'px', 'important');
    f.style.setProperty('top', '120px', 'important');
  }
}
window._centerUniverseFolder = _centerUniverseFolder;

// body 에 영구 별 레이어 한 번만 생성. 페이지 이동 / innerHTML 재설정 영향 X.
// .is-universe-route 클래스로 보임/숨김 토글.
function _ensurePersistentStarfield() {
  if (document.getElementById('persistent-starfield')) return;
  const layer = document.createElement('div');
  layer.id = 'persistent-starfield';
  layer.className = 'persistent-starfield-layer';
  layer.innerHTML = _buildStarfield('universe-sky', 160, 15);
  document.body.appendChild(layer);
}

// ===================== DRAG SYSTEM FOR FLOATING SHAPES =====================
function initShapeDrag() {
  const shapes = document.querySelectorAll('.floating-shape');
  let dragEl = null;
  let startX, startY, origLeft, origTop, moved;
  let lastX = 0, lastY = 0;        // last pointer position (for drop hit-test)
  let longPressTimer = null;
  let longPressFired = false;
  let dragModeEntered = false;     // <-- drag actually engaged?
  const LONG_PRESS_MS = 550;

  // 드롭 대상 폴더 찾기 — 포인터 아래에 있는 실제 폴더 오브제(.floating-folder[data-folder-id]).
  // 끌고 있는 곡 자신(exclude)은 건너뛴다. 템플릿/'새 폴더'는 data-folder-id가 없어 제외됨.
  function _folderAt(x, y, exclude) {
    let stack = [];
    try { stack = document.elementsFromPoint(x, y) || []; } catch (_) { return null; }
    for (const node of stack) {
      if (node === exclude) continue;
      const folder = node.closest && node.closest('.floating-folder[data-folder-id]');
      if (folder && folder !== exclude) return folder;
    }
    return null;
  }
  function _clearDropHover(except) {
    document.querySelectorAll('.floating-folder.folder-drop-hover').forEach(f => {
      if (f !== except) f.classList.remove('folder-drop-hover');
    });
  }

  function pointerDown(e) {
    // Skip if clicking the resize handle
    if (e.target.closest('.shape-resize-handle')) return;
    // Ignore if it's a touch with multiple fingers
    if (e.touches && e.touches.length > 1) return;

    const el = e.currentTarget;
    dragEl = el;
    moved = false;
    longPressFired = false;
    dragModeEntered = false;

    const ptr = e.touches ? e.touches[0] : e;
    startX = ptr.clientX;
    startY = ptr.clientY;
    lastX = startX; lastY = startY;

    // 끌어당기는 모션 피드백 — 누르는 순간 살짝 작아지면서 "집었다" 느낌.
    // 손가락 떠나면 (pointerUp) 제거. 드래그로 넘어가면 .dragging 으로 전환.
    el.classList.add('pressing');

    // ⚠️ Don't modify the shape yet — entering drag mode immediately
    // makes the long-press menu unusable on mobile (shape jiggles as
    // finger lands). We only cache the origin position and start the
    // long-press timer. Drag mode is engaged in pointerMove once the
    // user actually slides past the threshold.
    const rect = el.getBoundingClientRect();
    const universe = el.parentElement.getBoundingClientRect();
    origLeft = rect.left - universe.left + el.parentElement.scrollLeft;
    origTop = rect.top - universe.top + el.parentElement.scrollTop;

    // Long-press detection — fires after LONG_PRESS_MS if user didn't move/release.
    // ⚠️ 트랙(곡)에만 적용. 폴더/포스트잇 등 trackId 없는 오브제는 롱프레스 메뉴가
    //    없으므로 롱프레스 자체를 걸지 않는다. (안 그러면 살짝 쥐었다 끌 때
    //    longPressFired 가 켜져서 pointerUp 이 일찍 빠져나가 '놓아도 안 떨어지는'
    //    느낌이 남.)
    if (longPressTimer) clearTimeout(longPressTimer);
    // 트랙은 항상, 포스트잇은 폴더 안일 때만 롱프레스 메뉴(폴더에서 빼기)를 건다.
    const _lpHasMenu = el.dataset.trackId || (el.dataset.folderId && el.dataset.noteId);
    if (_lpHasMenu && typeof window.openShapeLongPressMenu === 'function') {
      longPressTimer = setTimeout(() => {
        if (!dragEl || moved || dragModeEntered) return;
        longPressFired = true;
        window.openShapeLongPressMenu(el.dataset.trackId || null, startX, startY, el);
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
      }, LONG_PRESS_MS);
    }

    // Don't preventDefault here — let click/tap through if no movement.
  }

  function pointerMove(e) {
    if (!dragEl) return;
    // 두 손가락(핀치 확대/축소) 중이면 드래그(이동)는 멈춘다 — 안 그러면
    // 한 손가락이 도형을 끌고 다녀서 핀치랑 충돌(도형이 안 보이거나 튐).
    if (e.touches && e.touches.length > 1) return;
    const ptr = e.touches ? e.touches[0] : e;
    const dx = ptr.clientX - startX;
    const dy = ptr.clientY - startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      moved = true;
      // Cancel pending long-press once user starts to drag
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

      // Engage drag mode on first qualifying movement
      if (!dragModeEntered) {
        dragModeEntered = true;
        // 'pressing' (집은 느낌) → 'dragging' 으로 전환
        dragEl.classList.remove('pressing');
        // floatDrift 애니메이션은 클래스로 일시정지 (style.animation = 'none' 대신).
        // 이렇게 하면 pointerUp 에서 클래스만 빼면 원래 animation 이 그대로 살아남.
        dragEl.classList.add('drag-paused');
        // floatDrift 애니가 주던 축소(--scale)를 드래그 중에도 유지 (안 그러면 커짐)
        const _sc = (getComputedStyle(dragEl).getPropertyValue('--scale') || '').trim();
        if (dragEl.__phys) {
          // 발견 도형: 위치가 transform(translate3d)에 있음 → 잡으면 translate 제거(스케일만 남김)하고
          //   left/top 으로 전환. 안 그러면 translate + left/top 이중 오프셋(도형이 튐).
          dragEl.style.transform = (_sc && _sc !== '1') ? ('scale(' + _sc + ')') : 'none';
        } else if (_sc && _sc !== '1' && _sc !== '') {
          dragEl.style.transform = 'scale(' + _sc + ')';
        }
        dragEl.style.left = origLeft + 'px';
        dragEl.style.top = origTop + 'px';
        dragEl.style.zIndex = '1000';   // 폴더 줄(z:5)·다른 도형보다 확실히 위로 — 끌 때 안 가려지게
        dragEl.style.transition = 'none';
        dragEl.classList.add('dragging');
        // 폴더 줄은 캔버스 '위쪽'에 따로 있어, 도형을 폴더 쪽(위)으로 끌면 캔버스 overflow:hidden 에
        // 잘려 사라졌음 → 드래그 동안만 그 캔버스 클립을 풀어 도형이 폴더 줄 위까지 보이게(놓으면 복원).
        if (currentView === 'universe') {
          const _cv = dragEl.closest('.shapes-universe');
          if (_cv) { _cv.dataset._dragOvf = _cv.style.overflow || ''; _cv.style.overflow = 'visible'; }
        }
      }
    }

    if (dragModeEntered) {
      dragEl.style.left = (origLeft + dx) + 'px';
      dragEl.style.top = (origTop + dy) + 'px';
      e.preventDefault();
      // 던지기(flick) 속도 — 마지막 이동 델타를 도형에 기록(놓을 때 물리 속도로 주입).
      if (dragEl) { dragEl.__flickVX = ptr.clientX - lastX; dragEl.__flickVY = ptr.clientY - lastY; }
      lastX = ptr.clientX; lastY = ptr.clientY;
      // 곡/포스트잇을 끌고 있을 때 폴더 위 하이라이트 (내 우주 한정)
      if (currentView === 'universe' && (dragEl.dataset.trackId || dragEl.dataset.noteId)) {
        const folder = _folderAt(ptr.clientX, ptr.clientY, dragEl);
        _clearDropHover(folder);
        if (folder) folder.classList.add('folder-drop-hover');
      }
    }
  }

  function pointerUp(e) {
    if (!dragEl) return;
    const el = dragEl;
    dragEl = null;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

    el.classList.remove('dragging');
    el.classList.remove('pressing');
    // 둥둥 떠다니는 floatDrift 애니메이션 복원 — 클래스만 빼면 원래 inline animation 살아남
    el.classList.remove('drag-paused');
    // 드래그 중 강제 scale transform 도 정리 → floatDrift 가 다시 transform 을 자기 거로 사용
    el.style.transform = '';
    el.style.zIndex = '';
    el.style.transition = '';
    // 드래그 동안 풀어둔 캔버스 클립(overflow) 복원
    try { const _cv = el.closest('.shapes-universe'); if (_cv && _cv.dataset._dragOvf !== undefined) { _cv.style.overflow = _cv.dataset._dragOvf; delete _cv.dataset._dragOvf; } } catch (_) {}

    // 드래그가 일어났다면 — touchend 뒤에 따라오는 click 한 번을 swallow.
    // (안 막으면 폴더 안에서 도형 끌어 놓을 때 inline onclick="openFolderShorts(...)"
    //  가 터져서 의도 안 한 쇼츠/포스트잇 모달이 즉시 열림)
    if (moved) {
      const _swallow = (clickEv) => {
        clickEv.stopPropagation();
        clickEv.stopImmediatePropagation();
        clickEv.preventDefault();
      };
      // capture 단계로 → 인라인 onclick 보다 먼저 도달
      el.addEventListener('click', _swallow, { capture: true, once: true });
      // 안전망 — 350ms 안에 click 안 오면 그냥 정리
      setTimeout(() => {
        try { el.removeEventListener('click', _swallow, { capture: true }); } catch (_) {}
      }, 350);
    }

    // If long-press menu opened, don't treat as click/drag-end
    if (longPressFired) {
      longPressFired = false;
      return;
    }

    // 모바일: 터치하면 touchend 뒤에 '유령 mouseup/click'이 한 번 더 와서
    // pointerUp 이 두 번 실행됨(=한 번 탭에 재생+아티스트이동 동시 발생).
    // touchend 시각을 기록해두고, 직후 들어오는 mouseup 은 무시한다.
    const _nowTs = Date.now();
    if (e.type === 'touchend') {
      window.__lastTouchEndTs = _nowTs;
    } else if (e.type === 'mouseup' && window.__lastTouchEndTs && (_nowTs - window.__lastTouchEndTs) < 700) {
      return;  // 유령 이벤트 — 이미 touchend 에서 처리함
    }

    // ── 드롭: 곡/포스트잇을 폴더 오브제 위에 떨어뜨리면 그 폴더에 담는다 ──
    _clearDropHover(null);
    if (moved && currentView === 'universe' && (el.dataset.trackId || el.dataset.noteId)) {
      const folder = _folderAt(lastX, lastY, el);
      if (folder && folder.dataset.folderId) {
        const fid = folder.dataset.folderId;
        // 흡수되는 듯한 피드백
        el.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        el.style.transform = 'scale(0.15)';
        el.style.opacity = '0';
        if (el.dataset.trackId && typeof window._dropTrackIntoFolder === 'function') {
          window._dropTrackIntoFolder(el.dataset.trackId, fid);
        } else if (el.dataset.noteId && typeof window._dropNoteIntoFolder === 'function') {
          window._dropNoteIntoFolder(el.dataset.noteId, fid);
        }
        return;   // 위치 저장/클릭 처리 건너뜀 — 폴더로 흡수됨
      }
    }

    // Persist user-curated position on /universe and /shapes (+ 폴더 안).
    // Saves a percentage for x (so it scales with width) and pixels for y.
    if (moved && (currentView === 'universe' || currentView === 'shapes')) {
      const itemId = el.dataset.trackId || el.dataset.noteId || el.dataset.folderId || el.dataset.uid;
      if (itemId && el.parentElement) {
        const parentRect = el.parentElement.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const leftPx = elRect.left - parentRect.left;
        const topPx  = Math.max(0, elRect.top - parentRect.top);   // 음수(캔버스 위로) 방지 — 놓을 때 폴더 줄 영역에 잘려 사라지지 않게
        const xPct   = parentRect.width > 0 ? (leftPx / parentRect.width) * 100 : 0;
        const pass   = el.dataset.pass;
        // scope/scope_id 정리 — 클라우드(user_object_positions) 와 동일한 키 체계
        let scope, scopeId, key;
        if (window.__universeFolderId) {
          scope = 'playlist'; scopeId = window.__universeFolderId;
          key = 'plpos:' + scopeId + ':' + itemId;
        } else if (currentView === 'universe') {
          scope = 'universe'; scopeId = '';
          key = 'unipos:' + itemId;
        } else {
          scope = 'shape'; scopeId = '';
          key = 'shapepos:' + itemId + ':' + (pass != null ? pass : '0');
        }
        try { localStorage.setItem(key, JSON.stringify({ xPct, yPx: topPx })); }
        catch (_) {}
        // PC 간 동기화 — 다른 컴퓨터에서 같은 계정으로 들어가면 같은 배치
        if (window.Positions && window.__currentUser) {
          window.Positions.save(scope, scopeId, itemId, pass != null ? pass : 0, xPct, topPx);
        }
      }
    }

    // 발견 물리: 드래그 놓을 때 = 던지기(flick). 물리 아이템 있을 때만(즐겨찾기 영향 X).
    if (moved && el.__phys) {
      el.__phys.x = parseFloat(el.style.left) || el.__phys.x;
      el.__phys.y = parseFloat(el.style.top)  || el.__phys.y;
      // 드래그 동안 쓰던 left/top → transform 으로 되돌림(물리가 transform 으로 이어받음). 안 하면 left/top+translate 이중 오프셋.
      const _sc = el.__phys.sc || 1;
      el.style.transition = 'none';
      el.style.left = '0'; el.style.top = '0';
      el.style.transform = 'translate3d(' + el.__phys.x + 'px,' + el.__phys.y + 'px,0)' + (_sc !== 1 ? ' scale(' + _sc + ')' : '');
      const _cap = 16;
      el.__phys.vx = Math.max(-_cap, Math.min(_cap, (el.__flickVX || 0) * 0.7));
      el.__phys.vy = Math.max(-_cap, Math.min(_cap, (el.__flickVY || 0) * 0.7));
    }

    // If barely moved, treat as click — first click on a shape plays the song,
    // a second click on the SAME shape (no time limit) navigates to artist page.
    // Clicking a different shape resets: that shape is now the "primed" one.
    if (!moved) {
      // 폴더 안에서는 탭 동작을 인라인 onclick(쇼츠 열기)에 맡긴다 — 드래그(이동)만 처리.
      if (window.__universeFolderId) return;
      // 폴더 오브제 탭 — 폴더가 왼쪽 위로 커지는 전환 애니 후 폴더 우주로
      if (el.dataset.folderId) {
        if (typeof window.enterFolderWithAnim === 'function') window.enterFolderWithAnim(el.dataset.folderId, el);
        else if (typeof openMyPlaylist === 'function') openMyPlaylist(el.dataset.folderId);
        return;
      }
      if (el.dataset.folderTemplate) {
        if (typeof createDefaultPlaylist === 'function') createDefaultPlaylist(el.dataset.folderTemplate);
        return;
      }
      if (el.hasAttribute('data-folder-new')) {
        if (typeof promptNewPlaylist === 'function') promptNewPlaylist();
        return;
      }
      // 내 우주 등에서 포스트잇 오브제 탭 → 글/댓글 모달 열기
      if (el.dataset.noteId) {
        if (typeof openNoteDetail === 'function') openNoteDetail(el.dataset.noteId);
        return;
      }
      const trackId = el.dataset.trackId;
      const artistEnc = el.dataset.artist;
      // (이전: 모바일 도형 탭 → 풀스크린 쇼츠. 사용자 요청으로 비활성화 —
      //  이제 도형 탭1=재생 / 탭2=해당 곡 아티스트 페이지. 아래 기본 탭 로직으로 흐름.)
      // if (trackId && currentView === 'shapes' && typeof openShapeShorts === 'function'
      //     && _isMobileShorts() && openShapeShorts(trackId)) { return; }
      // 자켓 모드(PC): 탭 = 자켓 '공개'(커버 선명·해시태그 사라짐) + 재생 (사용자 요청 ⓑ).
      if (trackId && currentView === 'shapes' && window.__discoverMode === 'jacket' && el.classList.contains('shape-jacket')) {
        document.querySelectorAll('.floating-shape.shape-jacket.revealed').forEach(j => { if (j !== el) j.classList.remove('revealed'); });
        el.classList.add('revealed');
        if (typeof playTrack === 'function') playTrack(trackId, 'shape');
        return;
      }
      // 탭 = 항상 재생. (두 번째 클릭 → 아티스트 이동 제거 — 아티스트는 아래 플레이바의 가수/제목 클릭으로.)
      // source 를 currentView 에 맞게 정함 → 큐 자동 빌드. 'universe' 면 즐겨찾기, 'shapes' 면 도형 페이지 곡 전체.
      const _src = (currentView === 'universe') ? 'universe' : 'shape';
      if (trackId) playTrack(trackId, _src);
    }
  }

  // Wheel resize: scroll up = bigger, scroll down = smaller
  function onWheel(e) {
    const el = e.currentTarget;
    e.preventDefault();
    el.style.animation = 'none';

    let scale = parseFloat(el.dataset.scale || '1');
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    scale = Math.min(3, Math.max(0.3, scale + delta));
    el.dataset.scale = scale;
    el.style.transform = `scale(${scale})`;
  }

  // Pinch resize for mobile (two-finger)
  let pinchEl = null, pinchStartDist = 0, pinchStartScale = 1;
  function getPinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function touchStartPinch(e) {
    if (e.touches.length === 2) {
      // 진행 중이던 한 손가락 드래그/롱프레스를 즉시 취소 (핀치와 충돌 방지)
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (dragEl) { dragEl.classList.remove('dragging'); dragEl.style.zIndex = ''; }
      dragEl = null; moved = false; dragModeEntered = false; longPressFired = false;

      pinchEl = e.currentTarget;
      pinchEl.style.animation = 'none';
      pinchEl.style.transition = 'none';            // 손가락 따라 실시간으로
      pinchEl.style.willChange = 'transform';
      pinchEl.style.transformOrigin = 'center center';
      pinchStartDist = getPinchDist(e.touches);
      pinchStartScale = parseFloat(pinchEl.dataset.scale || '1');
      e.preventDefault();
    }
  }
  function touchMovePinch(e) {
    if (!pinchEl || e.touches.length < 2) return;
    const dist = getPinchDist(e.touches);
    if (!pinchStartDist) return;
    let scale = pinchStartScale * (dist / pinchStartDist);
    scale = Math.min(3, Math.max(0.3, scale));
    pinchEl.dataset.scale = scale;
    pinchEl.style.transform = `scale(${scale})`;
    e.preventDefault();
  }
  function touchEndPinch(e) {
    if (pinchEl && e.touches.length < 2) {
      pinchEl.style.willChange = '';
      pinchEl = null;
    }
  }

  // Resize handle drag (mobile-friendly)
  let resizeEl = null, resizeStartDist = 0, resizeStartScale = 1, resizeCenter = null;

  function resizeDown(e) {
    e.stopPropagation();
    const handle = e.currentTarget;
    const shape = handle.closest('.floating-shape');
    if (!shape) return;
    resizeEl = shape;
    resizeEl.style.animation = 'none';

    const ptr = e.touches ? e.touches[0] : e;
    const rect = resizeEl.getBoundingClientRect();
    resizeCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const dx = ptr.clientX - resizeCenter.x;
    const dy = ptr.clientY - resizeCenter.y;
    resizeStartDist = Math.sqrt(dx * dx + dy * dy);
    resizeStartScale = parseFloat(resizeEl.dataset.scale || '1');
    resizeEl.classList.add('resizing');

    e.preventDefault();
  }
  function resizeMove(e) {
    if (!resizeEl) return;
    const ptr = e.touches ? e.touches[0] : e;
    const dx = ptr.clientX - resizeCenter.x;
    const dy = ptr.clientY - resizeCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let scale = resizeStartScale * (dist / resizeStartDist);
    scale = Math.min(3, Math.max(0.3, scale));
    resizeEl.dataset.scale = scale;
    resizeEl.style.transform = `scale(${scale})`;
    e.preventDefault();
  }
  function resizeUp() {
    if (!resizeEl) return;
    resizeEl.classList.remove('resizing');
    resizeEl = null;
  }

  shapes.forEach(el => {
    el.addEventListener('mousedown', pointerDown);
    el.addEventListener('touchstart', pointerDown, { passive: false });
    // 크기 조절(마우스 휠 / 핀치 / 리사이즈 핸들) 제거 — 사용자 요청.
    //   크기는 등록 크기로 고정 + 인기도(_popScale)로만 결정. 드래그(이동)는 유지.

    // 데스크탑: 오른쪽 클릭(우클릭)으로 메뉴 — 우주에선 '모으기', 폴더 안에선 '폴더에서 빼기'.
    el.addEventListener('contextmenu', (e) => {
      const trackId = el.dataset.trackId;
      const hasMenu = trackId || (el.dataset.folderId && el.dataset.noteId);
      if (!hasMenu || typeof window.openShapeLongPressMenu !== 'function') return;
      e.preventDefault();
      window.openShapeLongPressMenu(trackId || null, e.clientX, e.clientY, el);
    });
  });

  // 이전 렌더에서 붙인 document 리스너 제거 → 페이지를 다시 그릴 때마다
  // 핸들러가 쌓이는(이중 실행/메모리 누수) 문제 방지.
  if (window.__shapeDragDocCleanup) { try { window.__shapeDragDocCleanup(); } catch (_) {} }

  document.addEventListener('mousemove', resizeMove);
  document.addEventListener('touchmove', resizeMove, { passive: false });
  document.addEventListener('mouseup', resizeUp);
  document.addEventListener('touchend', resizeUp);

  document.addEventListener('mousemove', pointerMove);
  document.addEventListener('touchmove', pointerMove, { passive: false });
  document.addEventListener('touchmove', touchMovePinch, { passive: false });
  document.addEventListener('mouseup', pointerUp);
  document.addEventListener('touchend', pointerUp);
  document.addEventListener('touchend', touchEndPinch);

  window.__shapeDragDocCleanup = () => {
    document.removeEventListener('mousemove', resizeMove);
    document.removeEventListener('touchmove', resizeMove);
    document.removeEventListener('mouseup', resizeUp);
    document.removeEventListener('touchend', resizeUp);
    document.removeEventListener('mousemove', pointerMove);
    document.removeEventListener('touchmove', pointerMove);
    document.removeEventListener('touchmove', touchMovePinch);
    document.removeEventListener('mouseup', pointerUp);
    document.removeEventListener('touchend', pointerUp);
    document.removeEventListener('touchend', touchEndPinch);
  };
}

// ===================== 2. TRACK DETAIL =====================

window.openTrackDetail = function (trackId) {
  const db = window.DB.get();
  const track = db.tracks.find(t => t.id === trackId);
  if (!track) return;

  // Find artist SNS
  const artistData = (db.following || []).find(a => a.name === track.artist);
  const artistSns = artistData?.sns || {};
  const snsHtml = generateSnsLinks(artistSns);

  const artistTracks = db.tracks.filter(t => t.artist === track.artist && t.id !== track.id);
  let trackListHtml = '';
  if (artistTracks.length > 0) {
    trackListHtml = `
      <div style="margin-top: 30px; border-top: 1px solid var(--divider); padding-top: 24px;">
        <h3 style="font-size: 16px; margin-bottom: 16px;">More from ${(track.artist||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${artistTracks.map((t, idx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--surface-color); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--surface-hover)'" onmouseout="this.style.background='var(--surface-color)'" onclick="openTrackDetail('${t.id}')">
              <div style="display: flex; align-items: center; gap: 16px;">
                <img src="${t.cover}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">
                <div style="color: var(--text-secondary); font-size: 12px; width: 20px; text-align: center;">${idx + 1}</div>
                <div style="font-size: 14px; font-weight: 500;">${(t.title||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
              </div>
              <div style="color: var(--text-secondary); font-size: 12px;">
                <i class="ri-play-fill"></i> ${t.plays || 0}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  appContent.innerHTML = `
    <!-- Hero Banner -->
    <div style="background: linear-gradient(135deg, #333, #121212); margin: -32px -32px 24px -32px; padding: 40px 32px; display: flex; justify-content: space-between; align-items: stretch; border-radius: 8px 8px 0 0;">
      <div style="display: flex; gap: 24px; max-width: 65%;">
        <button onclick="playTrack('${track.id}')" style="width: 64px; height: 64px; border-radius: 50%; background: var(--brand-color); color: white; display: flex; align-items: center; justify-content: center; font-size: 32px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(29,185,84,0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.06)'" onmouseout="this.style.transform='scale(1)'">
          <i class="ri-play-fill"></i>
        </button>
        <div style="display: flex; flex-direction: column; justify-content: flex-start; padding-top: 4px;">
          <h1 style="font-size: 36px; line-height: 1.2; margin-bottom: 8px;">${(track.title||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</h1>
          <h2 style="font-size: 18px; color: var(--text-secondary); margin-bottom: 0;">${(track.artist||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')} <i class="ri-verified-badge-fill" style="color: var(--brand-color); font-size: 16px; vertical-align: middle;"></i></h2>
        </div>
      </div>
      <img src="${track.cover}" style="width: 220px; height: 220px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); object-fit: cover;">
    </div>

    <!-- Action Bar -->
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--divider); padding-bottom: 12px; margin-bottom: 24px;">
      <div style="display: flex; gap: 8px;">
        <button style="background: transparent; border: 1px solid var(--divider); color: var(--text-primary); padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; transition: border-color 0.2s;" onclick="window.toggleLike('${track.id}', this)" onmouseover="this.style.borderColor='white'" onmouseout="this.style.borderColor='var(--divider)'"><i class="${isTrackLiked(track.id) ? 'ri-heart-fill' : 'ri-heart-line'}"></i> Like</button>
        <button style="background: transparent; border: 1px solid var(--divider); color: var(--text-primary); padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; transition: border-color 0.2s;" onmouseover="this.style.borderColor='white'" onmouseout="this.style.borderColor='var(--divider)'"><i class="ri-repeat-2-line"></i> Repost</button>
        <button style="background: linear-gradient(135deg,#FFD54F,#FF6F61); color:#111; border:none; padding: 8px 16px; font-size: 13px; font-weight:700; border-radius: 20px; cursor:pointer; transition: transform 0.2s, box-shadow 0.2s;" onclick="window.openTrackCard && window.openTrackCard('${track.id}')" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 14px rgba(255,111,97,0.35)'" onmouseout="this.style.transform=''; this.style.boxShadow=''"><i class="ri-image-line"></i> 카드 만들기</button>
        <button style="background: transparent; border: 1px solid var(--divider); color: var(--text-primary); padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; transition: border-color 0.2s;" onclick="window.shareTrackCard && window.shareTrackCard('${track.id}')" onmouseover="this.style.borderColor='white'" onmouseout="this.style.borderColor='var(--divider)'"><i class="ri-share-forward-line"></i> Share</button>
        ${/^[0-9a-f-]{36}$/i.test(track.id||'') ? `<button style="background: var(--brand-color); color: white; padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; border:none; transition: background 0.2s;" onclick="openPlaylistModal('${track.id}')" onmouseover="this.style.background='var(--brand-hover)'" onmouseout="this.style.background='var(--brand-color)'"><i class="ri-add-line"></i> Playlist</button>` : ''}
      </div>
      <div style="display: flex; gap: 16px; color: var(--text-secondary); font-size: 14px;">
        <span><i class="ri-play-fill"></i> ${(track.plays || 0).toLocaleString()}</span>
        <span><i class="ri-heart-fill"></i> ${track.likes || 0}</span>
      </div>
    </div>

    <!-- Main Layout -->
    <div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 40px;">
      <!-- Left Column -->
      <div>
        <!-- Artist Profile Row -->
        <div style="display: flex; gap: 20px; align-items: flex-start; margin-bottom: 24px;">
          <div style="text-align: center; flex-shrink: 0;">
            <img src="${track.artistAvatar || 'https://i.pravatar.cc/150?img=11'}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 8px;">
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px;">${(track.artist||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            ${snsHtml}
            <button class="btn-primary" style="padding: 6px 16px; font-size: 12px; margin-top: 8px;"><i class="ri-user-follow-line"></i> Follow</button>
          </div>
          <div style="flex-grow: 1;">
            ${track.description ? `<div style="line-height: 1.7; color: var(--text-secondary); padding-top: 10px; font-size: 14px; white-space: pre-line;">${(track.description||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : '<div style="line-height: 1.7; color: var(--text-secondary); padding-top: 10px; font-size: 14px; font-style: italic;">코멘트가 없습니다.</div>'}
            ${(track.tags && track.tags.length) ? `
              <div class="tag-pills-row" style="margin-top: 16px;">
                ${track.tags.map(tag => {
                  const safeDisplay = tag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                  return `<span class="tag-pill" onclick="navigateToTag('${jsEscape(tag)}')">#${safeDisplay}</span>`;
                }).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        ${trackListHtml}

        ${track.youtubeId ? `
          <h3 style="margin-bottom: 16px; border-top: 1px solid var(--divider); padding-top: 24px; font-size: 16px;">Music Video</h3>
          <iframe width="100%" height="400" src="https://www.youtube.com/embed/${track.youtubeId}" frameborder="0" allowfullscreen style="border-radius: 8px;"></iframe>
        ` : ''}
      </div>

      <!-- Right Column -->
      <div style="border-left: 1px solid var(--divider); padding-left: 40px;">
        <h3 style="font-size: 14px; color: var(--text-secondary); border-bottom: 1px solid var(--divider); padding-bottom: 8px; margin-bottom: 16px;"><i class="ri-heart-fill" style="color:var(--text-secondary)"></i> ${track.likes} LIKES</h3>
        <div style="display: flex; gap: 8px; margin-bottom: 30px; flex-wrap: wrap;">
          <img src="https://i.pravatar.cc/150?img=1" style="width: 32px; height: 32px; border-radius: 50%;">
          <img src="https://i.pravatar.cc/150?img=2" style="width: 32px; height: 32px; border-radius: 50%;">
          <img src="https://i.pravatar.cc/150?img=3" style="width: 32px; height: 32px; border-radius: 50%;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--surface-hover); display:flex; align-items:center; justify-content:center; font-size: 12px; color: var(--text-secondary);">+ ${(track.likes > 3) ? track.likes - 3 : 0}</div>
        </div>

        <h3 style="font-size: 14px; color: var(--text-secondary); border-bottom: 1px solid var(--divider); padding-bottom: 8px; margin-bottom: 16px;"><i class="ri-repeat-2-line"></i> REPOSTS</h3>
        <div style="display: flex; gap: 8px; margin-bottom: 30px; flex-wrap: wrap;">
          <img src="https://i.pravatar.cc/150?img=5" style="width: 32px; height: 32px; border-radius: 50%;">
          <img src="https://i.pravatar.cc/150?img=6" style="width: 32px; height: 32px; border-radius: 50%;">
        </div>
      </div>
    </div>
  `;
}

// ===================== 3. UPLOAD VIEW =====================

// ── 업로드 위저드(키오스크 발매/데모 → 새/작업중 → 폼) 단계 이동 + 미리보기 ──
// 화면만 단계로 감싸고, 기존 숨긴 토글(.upload-type-opt)을 .click() 으로 구동 →
// 기존 검증·동기화·제출 로직은 그대로 동작. DOM 은 호출 시점에 조회(렌더 후라 안전).
window.uwUpGo = function (step) {
  document.querySelectorAll('#uploadWizard .uw-step').forEach(function (s) { s.classList.remove('uw-on'); });
  var t = document.querySelector('#uploadWizard [data-step="' + step + '"]');
  if (t) { t.classList.add('uw-on'); }
  try { window.scrollTo(0, 0); var sc = document.getElementById('app-content'); if (sc) sc.scrollTop = 0; } catch (_) {}
};
window.uwUpBack = function () { window.uwUpGo(window.__uwFormBack || 'kiosk'); };
window.uwUpPick = function (what) {
  var click = function (sel) { var el = document.querySelector('#uploadWizard ' + sel); if (el) el.click(); };
  if (what === 'release') {
    // 발매는 아직 런칭 전 — 막고 '준비 중' 안내. (지금은 데모만)
    if (typeof showToast === 'function') showToast(_t('발매는 아직 준비 중이에요 🛠️ 지금은 데모만 올릴 수 있어요', 'Release is coming soon — demos only for now'));
    return;
  }
  else if (what === 'demo') { click('[data-version-type="demo"]'); window.uwUpGo('dchoice'); }
  else if (what === 'new') { click('[data-proj-choice="new"]'); window.__uwFormBack = 'dchoice'; window.uwUpGo('form'); }
  else if (what === 'existing') { click('[data-proj-choice="existing"]'); window.__uwFormBack = 'dchoice'; window.uwUpGo('form'); }
};
window.uwPrevLine = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
window.uwPickShape = function (el) {
  document.querySelectorAll('#uwShapes .uw-sh').forEach(function (s) { s.classList.remove('uw-sel'); });
  el.classList.add('uw-sel');
  var shape = el.getAttribute('data-shape');
  var sel = document.getElementById('up-shape'); if (sel) { sel.value = shape; try { sel.dispatchEvent(new Event('change')); } catch (_) {} }
  var p = document.getElementById('uwPrev');
  if (p) {
    var M = { circle: [150, 150, '50%', 'none'], oval: [174, 120, '50%', 'none'], rect: [150, 150, '18px', 'none'], wide: [186, 120, '12px', 'none'], pill: [196, 106, '999px', 'none'], hexagon: [162, 152, '0', 'polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)'] };
    var s = M[shape] || M.circle;
    p.style.width = s[0] + 'px'; p.style.height = s[1] + 'px'; p.style.borderRadius = s[2]; p.style.clipPath = s[3];
  }
};
window.uwPickColor = function (el) {
  document.querySelectorAll('#uwCols .uw-col').forEach(function (c) { c.classList.remove('uw-sel'); });
  el.classList.add('uw-sel');
  var color = el.getAttribute('data-color');
  var inp = document.getElementById('up-shape-color'); if (inp) inp.value = color;
  var p = document.getElementById('uwPrev'); if (p) p.style.background = color;
};
// 업로드 태그 → 발견 도형 미리보기 (앞 3개를 #태그로). 도형 낙서 입력 통합(사용자 요청).
window.uwTagsPreview = function (raw) {
  var tags = (raw || '').split(/[#,]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 3);
  ['uwP1', 'uwP2', 'uwP3'].forEach(function (id, i) {
    var e = document.getElementById(id);
    if (e) e.textContent = tags[i] ? ('#' + tags[i]) : '';
  });
};
// 업로드 장르 선택 → 색 스와치 미리보기.
window.uwGenrePreview = function (key) {
  var sw = document.getElementById('up-genre-swatch');
  if (!sw) return;
  var g = (typeof _findGenre === 'function') ? _findGenre(key) : null;
  sw.style.background = g ? g.color : '#333';
};

function renderUpload() {
  const db = window.DB.get();
  if (!db.currentUser) {
    // pending 상태 남겨두면 다음 로그인 시 의도와 다른 자동 세팅이 됨 — 항상 클리어.
    window.__pendingUploadProjectId = null;
    window.__pendingUploadVersionType = null;
    navigateTo('auth');
    return;
  }

  // 데모 업로드 기본 커버 — 노란 포스트잇 + "Coming Soon" (data: URL이라 별도 호스팅 불필요)
  const COMING_SOON_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">' +
    '<rect width="500" height="500" fill="#FFF59D"/>' +
    '<rect x="200" y="0" width="100" height="22" fill="rgba(255,255,255,0.55)"/>' +
    '<g transform="rotate(-3 250 260)" font-family="Comic Sans MS, Gaegu, cursive" font-weight="800" fill="#3a2a00" text-anchor="middle">' +
      '<text x="250" y="250" font-size="62">Coming</text>' +
      '<text x="250" y="322" font-size="62">Soon...</text>' +
    '</g>' +
    '</svg>'
  );

  appContent.innerHTML = `
    <style>
      #uploadWizard .uw-step{display:none;max-width:600px;margin:0 auto;padding:22px}
      #uploadWizard .uw-step.uw-on{display:block}
      #uploadWizard .upload-type-toggle{display:none !important}
      #uploadWizard .form-group:has(.upload-type-toggle){display:none !important}
      .uw-kgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}
      .uw-kbtn{position:relative;border-radius:20px;border:2px solid;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer;text-align:center;padding:30px 12px;min-height:300px;background:none;font-family:inherit;color:inherit;transition:transform .12s,background .2s}
      .uw-kbtn:active{transform:scale(.97)}
      .uw-krel{background:rgba(250,199,117,.12);border-color:rgba(250,199,117,.55)}
      .uw-kdemo{background:rgba(127,119,221,.14);border-color:rgba(127,119,221,.6)}
      .uw-knum{position:absolute;top:13px;left:14px;font-size:13px;font-weight:800;width:25px;height:25px;border-radius:50%;display:flex;align-items:center;justify-content:center}
      .uw-krel .uw-knum{background:#fac775;color:#3a2a00}.uw-kdemo .uw-knum{background:#b5aef0;color:#1a1530}
      .uw-kic{width:76px;height:76px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:38px}
      .uw-krel .uw-kic{background:rgba(250,199,117,.22);color:#cf9320}.uw-kdemo .uw-kic{background:rgba(127,119,221,.24);color:#5b51bd}
      .uw-kt{font-size:23px;font-weight:800}.uw-ken{font-size:11px;opacity:.55;font-weight:700;letter-spacing:1px;margin-top:-7px}
      .uw-kd{font-size:12.5px;opacity:.78;line-height:1.5}
      .uw-cc{display:flex;align-items:center;gap:14px;padding:18px 16px;border-radius:16px;border:1.5px solid var(--divider,rgba(0,0,0,.14));cursor:pointer;margin-bottom:12px;background:none;width:100%;font-family:inherit;color:inherit;text-align:left;transition:border-color .2s,background .2s}
      .uw-cc:hover{border-color:#7f77dd;background:rgba(127,119,221,.06)}
      .uw-cc .uw-ci{width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:23px;background:rgba(127,119,221,.15);color:#5b51bd;flex:0 0 auto}
      .uw-cc .uw-ct{font-size:16px;font-weight:700;display:block}.uw-cc .uw-cdd{font-size:12px;opacity:.65;margin-top:2px;display:block}
      .uw-back{display:inline-flex;align-items:center;gap:5px;font-size:14px;font-weight:600;color:inherit;opacity:.72;cursor:pointer;background:none;border:none;font-family:inherit;padding:2px;margin-bottom:14px}
      .uw-prevwrap{height:184px;display:flex;align-items:center;justify-content:center;border-radius:14px;margin-bottom:12px;position:relative;background:repeating-linear-gradient(45deg,rgba(127,119,221,.05),rgba(127,119,221,.05) 10px,transparent 10px,transparent 20px)}
      .uw-pcap{position:absolute;top:9px;left:0;right:0;text-align:center;font-size:11px;opacity:.5;font-weight:700;letter-spacing:.5px}
      .uw-prev{display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;box-sizing:border-box;background:#FF4081;transition:width .25s,height .25s,border-radius .25s,background .25s;box-shadow:0 10px 26px rgba(0,0,0,.22)}
      .uw-prev .uw-pt{font-family:var(--font-hand,'Gaegu',cursive);font-weight:700;font-size:18px;line-height:1.4;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.2);word-break:keep-all}
      .uw-prev .uw-pt span{display:block}
      .uw-shapes{display:flex;gap:10px;overflow-x:auto;padding:2px 0 8px;margin-bottom:6px}
      .uw-sh{flex:0 0 auto;width:46px;height:46px;position:relative;cursor:pointer}
      .uw-sh .uw-sp{position:absolute;inset:0;background:#b0b0b8;transition:background .2s}.uw-sh:hover .uw-sp{background:#8a83c9}.uw-sh.uw-sel .uw-sp{background:#7f77dd}
      .uw-sh.uw-sel{outline:2px solid #1d9e75;outline-offset:3px;border-radius:5px}
      .uw-sh .uw-ck{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#fff;font-size:19px;text-shadow:0 1px 3px rgba(0,0,0,.6)}.uw-sh.uw-sel .uw-ck{display:flex}
      .uws-circle{border-radius:50%}.uws-oval{border-radius:50%;top:9px;bottom:9px}.uws-rect{border-radius:9px}.uws-wide{border-radius:6px;top:11px;bottom:11px}.uws-pill{border-radius:999px;top:13px;bottom:13px}.uws-hexagon{clip-path:polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)}
      .uw-cols{display:flex;gap:9px;flex-wrap:wrap}
      .uw-col{width:31px;height:31px;border-radius:50%;cursor:pointer;border:2px solid transparent}.uw-col.uw-sel{outline:2px solid #1d9e75;outline-offset:2px}
    </style>
    <div class="upload-wizard" id="uploadWizard">
      <div class="uw-step uw-on" data-step="kiosk">
        <h1 style="text-align:center;margin:8px 0 2px;">${_i18n('무엇을 올릴까요?','What are you uploading?')}</h1>
        <p style="text-align:center;color:var(--text-secondary);font-size:13px;margin:0;">${_i18n('탭해서 선택하세요','Tap to choose')}</p>
        <div class="uw-kgrid">
          <button type="button" class="uw-kbtn uw-krel uw-soon" onclick="uwUpPick('release')" style="opacity:.5; position:relative;"><span class="uw-knum">1</span><span class="uw-kic"><i class="ri-album-line"></i></span><span class="uw-kt">${_i18n('발매','Release')}</span><span class="uw-ken">RELEASE</span><span class="uw-kd">${_i18n('준비 중<br>곧 열려요','Coming soon')}</span><span style="position:absolute; top:8px; right:8px; background:#FFC94D; color:#06140C; font-size:9px; font-weight:900; padding:3px 8px; border-radius:999px; letter-spacing:.02em;">${_i18n('준비 중','SOON')}</span></button>
          <button type="button" class="uw-kbtn uw-kdemo" onclick="uwUpPick('demo')"><span class="uw-knum">2</span><span class="uw-kic"><i class="ri-mic-2-line"></i></span><span class="uw-kt">${_i18n('데모','Demo')}</span><span class="uw-ken">DEMO</span><span class="uw-kd">${_i18n('작업 중인 곡<br>가볍게','Work in progress<br>quick')}</span></button>
        </div>
      </div>
      <div class="uw-step" data-step="dchoice">
        <button type="button" class="uw-back" onclick="uwUpGo('kiosk')"><i class="ri-arrow-left-line"></i> ${_i18n('뒤로','Back')}</button>
        <h1 style="margin:0 0 2px;">${_i18n('데모 — 어떤 거?','Demo — which?')}</h1>
        <p style="color:var(--text-secondary);font-size:13px;margin:0 0 16px;">${_i18n('새로 시작인가요, 이어서인가요?','New, or continue?')}</p>
        <button type="button" class="uw-cc" onclick="uwUpPick('new')"><span class="uw-ci"><i class="ri-add-line"></i></span><span><span class="uw-ct">${_i18n('새 데모','New demo')}</span><span class="uw-cdd">${_i18n('처음 올리는 곡','First upload')}</span></span></button>
        <button type="button" class="uw-cc" onclick="uwUpPick('existing')"><span class="uw-ci"><i class="ri-stack-line"></i></span><span><span class="uw-ct">${_i18n('작업중인 데모','In-progress demo')}</span><span class="uw-cdd">${_i18n('이미 있는 곡에 다음 버전','Next version of an existing song')}</span></span></button>
      </div>
      <div class="uw-step" data-step="form">
        <button type="button" class="uw-back" id="uwBack" onclick="uwUpBack()"><i class="ri-arrow-left-line"></i> ${_i18n('뒤로','Back')}</button>
    <div class="card" style="padding: 24px;">
      <h1 style="margin-bottom: 8px;">${_i18n('음원 업로드', 'Upload Music')}</h1>
      <p style="color:var(--text-secondary); font-size:13px; margin-bottom: 24px;">
        ${_i18n('데모부터 발매까지 — 하나의 Demo 안에 여러 버전을 차곡차곡 쌓을 수 있어요.', 'From demo to release — stack multiple versions inside a single Demo.')}
      </p>

      <!-- Tier 1: 발매 단독 vs Demo (구 "프로젝트")
           발매 단독은 "준비중" 으로 막아놓음. 기본은 Demo 선택. -->
      <div class="upload-type-toggle">
        <label class="upload-type-opt is-disabled" data-mode="master_solo" aria-disabled="true" title="준비중 — 곧 열려요!">
          <input type="radio" name="up-mode" value="master_solo" disabled>
          <div class="upload-type-label">발매 (Release)</div>
          <div class="upload-type-sub"><i class="ri-time-line"></i> 준비중 (Coming soon)</div>
        </label>
        <label class="upload-type-opt active" data-mode="project">
          <input type="radio" name="up-mode" value="project" checked>
          <div class="upload-type-label">Demo</div>
          <div class="upload-type-sub">데모/발매를 하나의 프로젝트로 (Demo &amp; release)</div>
        </label>
      </div>

      <form id="upload-form">
        <!-- Tier 2: Demo(=project) 하위 옵션 — 기본 mode 가 project 이라 처음부터 보임.
             "프로젝트" 표기 → 사용자 요청으로 모두 "Demo" 로 통일. -->
        <div id="project-substep" style="display:block;">
          <div class="form-group">
            <label>어느 Demo? (Which?)</label>
            <div class="upload-type-toggle compact">
              <label class="upload-type-opt active" data-proj-choice="new">
                <input type="radio" name="up-proj-choice" value="new" checked>
                <div class="upload-type-label">새 Demo (New)</div>
              </label>
              <label class="upload-type-opt" data-proj-choice="existing">
                <input type="radio" name="up-proj-choice" value="existing">
                <div class="upload-type-label">기존 Demo (Existing)</div>
              </label>
            </div>
          </div>

          <div id="existing-project-picker" style="display:none;">
            <div class="form-group">
              <select class="form-control" id="up-project-id">
                <option value="">불러오는 중... (Loading...)</option>
              </select>
              <div id="existing-version-info" style="font-size:13px; color:var(--text-secondary); margin-top:6px;"></div>
            </div>
          </div>

          <div class="form-group">
            <label>이번 업로드는? (Upload type)</label>
            <div class="upload-type-toggle compact">
              <label class="upload-type-opt active" data-version-type="demo">
                <input type="radio" name="up-version-type" value="demo" checked>
                <div class="upload-type-label">데모 (Demo)</div>
                <div class="upload-type-sub">진행 중 버전 (Work in progress)</div>
              </label>
              <label class="upload-type-opt" data-version-type="master">
                <input type="radio" name="up-version-type" value="master">
                <div class="upload-type-label">발매 (Release)</div>
                <div class="upload-type-sub">최종 완성본 (Final)</div>
              </label>
            </div>
          </div>
        </div>

        <div class="form-group master-only">
          <label>${_i18n('곡 제목', 'Title')} <span id="up-title-hint" style="color:var(--text-secondary); font-weight:normal;"></span></label>
          <input type="text" class="form-control" id="up-title" required placeholder="${_t('예: 한밤의 드라이브', 'e.g. Midnight Drive')}">
        </div>
        <div class="form-group master-only">
          <label>${_i18n('버전 라벨', 'Version label')}</label>
          <input type="text" class="form-control" id="up-version-label" value="Final" placeholder="${_t('예: Final, Demo 1, Pre-master', 'e.g. Final, Demo 1, Pre-master')}">
          <div class="form-note">${_i18n('카드에 표시될 이름. 데모는 Demo N 으로 자동 — 발매만 편집.', 'Card name — demos auto Demo N; edit for releases.')}</div>
        </div>

        <div class="form-group">
          <label>${_i18n('커버 이미지 (선택)', 'Cover image (optional)')}</label>
          <input type="file" class="form-control" id="up-cover" accept="image/*">
          <div class="form-note">${_i18n('안 넣으면 Coming Soon 또는 곡 색 자켓으로 떠요', "Skip it — shows a Coming Soon / color jacket")}</div>
        </div>
        <div class="form-group">
          <label>${_i18n('오디오 파일', 'Audio file')} <span id="up-audio-size" style="color:var(--text-secondary); font-weight:normal;"></span></label>
          <input type="file" class="form-control" id="up-audio" accept="audio/*" required
                 onchange="(function(el){var f=el.files[0];if(!f)return;var mb=(f.size/1048576).toFixed(1);var lbl=document.getElementById('up-audio-size');if(lbl)lbl.textContent=' · '+mb+'MB'+(f.size>50*1048576?' (50MB 초과 — 거부됨 / over limit)':'');})(this)">
          <div class="form-note">${_i18n('"파일 선택" 으로 오디오 첨부 · 최대 50MB · mp3/m4a/wav', 'Click "Choose file" to attach audio · Max 50MB · mp3/m4a/wav')}</div>
        </div>
        <div class="form-group">
          <label>${_i18n('곡 소개', 'Description')} <span style="color:#ff6b6b;">${_i18n('(필수)', '(required)')}</span></label>
          <textarea class="form-control" id="up-description" rows="3" placeholder="${_t('이 곡에 얽힌 이야기나 리스너들에게 전하고 싶은 멘트를 자유롭게 적어주세요.', 'Share the story behind this track or a message for your listeners.')}" required></textarea>
        </div>
        <div class="form-group">
          <label><i class="ri-double-quotes-l" style="color:var(--brand-color);"></i> ${_i18n('가사', 'Lyrics')} <span style="color:var(--text-secondary); font-weight:normal; font-size:12px;">${_i18n('(발매 시 필수 · 데모는 선택)', '(required for release · optional for demo)')}</span></label>
          <textarea class="form-control" id="up-lyrics" rows="6" placeholder="${_t(`가사를 적어주세요. 곡(앨범) 페이지의 '가사'에 표시돼요. (데모는 비워둬도 돼요)`, `Write the lyrics — shown on the song's album page. (Optional for demos.)`)}"></textarea>
          <div class="form-note">${_i18n('가사를 적으면 노래와 함께 우리들의 벽에 자동 게시됩니다. 발매(마스터)는 가사가 필수예요.', 'Lyrics auto-post to the wall with your track; required for releases (masters).')}</div>
        </div>
        <div class="form-group">
          <label><i class="ri-disc-line" style="color:var(--brand-color);"></i> ${_i18n('장르', 'Genre')} <span style="color:var(--text-secondary); font-weight:normal; font-size:12px;">${_i18n('(곡 색이 정해져요)', '(sets your color)')}</span></label>
          <div style="display:flex; align-items:center; gap:10px;">
            <select class="form-control" id="up-genre" onchange="window.uwGenrePreview && uwGenrePreview(this.value)" style="flex:1;">
              <option value="">${_i18n('장르 선택 (선택 안 함)', 'Pick a genre (optional)')}</option>
              ${GENRES.map(G => `<option value="${G.key}">${_i18n(G.key, G.en)}</option>`).join('')}
            </select>
            <span id="up-genre-swatch" style="width:30px; height:30px; border-radius:50%; flex:0 0 auto; background:#333; border:2px solid rgba(255,255,255,.15);"></span>
          </div>
          <div class="form-note">${_i18n('도형·플레이어·커버 색이 장르 색으로 떠요. 안 골라도 돼요(곡별 색).', 'Shape, player & cover color follow the genre. Optional.')}</div>
        </div>
        <div class="form-group">
          <label><i class="ri-hashtag" style="color:var(--brand-color);"></i> ${_i18n('태그', 'Tags')} <span style="color:#ff6b6b;">${_i18n('(필수)', '(required)')}</span></label>
          <input type="text" class="form-control" id="up-tags" placeholder="${_t('예: #1982년 느낌 #funky #고2 기타과 음악', 'e.g. #1982 vibe #funky #11thGradeGuitar')}" oninput="window.uwTagsPreview && uwTagsPreview(this.value)" required>
          <div class="form-note">${_i18n('무드·학년·연도 등 자유롭게(도형에 떠요). #은 자동으로 붙어요. 장르는 위에서 선택.', 'Mood, year, etc. (shown on the shape). # auto-added. Pick genre above.')}</div>
        </div>

        <!-- Distribution metadata — shown only when uploading a master -->
        <div id="distribution-section" style="display:block;">
          <hr style="border-color: var(--divider); margin: 20px 0;">
          <h2 style="font-size: 18px; color: var(--brand-color); margin-bottom: 4px;"><i class="ri-folder-zip-line"></i> 유통 정보 (Distribution info)</h2>
          <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">${_i18n('유통사 제출용 정보. 비워두면 활동명 + 오늘 날짜로 들어가요.', 'For distribution — defaults to your artist name + today.')}</p>
          <div class="form-group">
            <label>발매일 (Release date)</label>
            <input type="date" class="form-control" id="up-release-date">
          </div>
          <div class="form-group">
            <label>${_i18n('유통용 아티스트명', 'Distribution artist name')} <span style="color:var(--text-secondary); font-weight:normal; font-size:12px;">${_i18n('(실명/예명 — 활동명과 다를 때만)', '(only if different from display name)')}</span></label>
            <input type="text" class="form-control" id="up-dist-artist" placeholder="${_t('비워두면 활동명 사용', 'Defaults to display name')}">
          </div>
          <div class="form-group">
            <label>콜라보 아티스트 (Collaborators) <span style="color:var(--text-secondary); font-weight:normal; font-size:12px;">(콤마로 구분 / comma-separated)</span></label>
            <input type="text" class="form-control" id="up-collaborators" placeholder="예: 김작곡, 박보컬">
          </div>
        </div>

        <hr style="border-color: var(--divider); margin: 20px 0;">
        <h2 style="font-size: 18px; color: var(--brand-color); margin-bottom: 4px;"><i class="ri-shapes-fill"></i> ${_i18n('발견 도형 미리보기', 'Discover shape preview')}</h2>
        <p id="up-graffiti-note" style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">${_i18n('위에 적은 태그가 발견 도형에 이렇게 떠요 (앞 3개).', 'Your tags above appear on the Discover shape (first 3).')}</p>
        <div class="uw-prevwrap"><span class="uw-pcap">${_i18n('미리보기', 'Preview')}</span><div class="uw-prev" id="uwPrev" style="width:150px;height:150px;border-radius:50%;background:#FF4081;"><div class="uw-pt"><span id="uwP1"></span><span id="uwP2"></span><span id="uwP3"></span></div></div></div>
        <!-- 도형 모양 선택 제거 — 발견 도형이 전부 '원'으로 통일됨(사용자 요청). up-shape는 circle 고정(제출/줄수제한 호환). -->
        <select class="form-control" id="up-shape" style="display:none"><option value="circle" selected>${_t('원', 'Circle')}</option></select>
        <div class="form-group">
          <label>${_i18n('도형 색상', 'Color')}</label>
          <div class="uw-cols" id="uwCols">
            <span class="uw-col uw-sel" data-color="#FF4081" style="background:#FF4081" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#FFC107" style="background:#FFC107" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#7F77DD" style="background:#7F77DD" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#1D9E75" style="background:#1D9E75" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#378ADD" style="background:#378ADD" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#FF6B6B" style="background:#FF6B6B" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#26C6DA" style="background:#26C6DA" onclick="uwPickColor(this)"></span>
            <span class="uw-col" data-color="#FFFFFF" style="background:#FFFFFF" onclick="uwPickColor(this)"></span>
          </div>
          <input type="color" class="form-control" id="up-shape-color" value="#FF4081" style="display:none">
        </div>

        <hr style="border-color: var(--divider); margin: 30px 0;">

        <h2 style="font-size: 18px; color: var(--brand-color);">${_i18n('이용 약관', 'Terms')}</h2>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">${_i18n('Off-Stage 플랫폼 업로드 및 재생에 관한 동의서입니다.', 'Off-Stage upload & playback agreement.')}</p>

        <div class="agreement-box">
          <strong>제 1조 (목적) / Article 1 (Purpose)</strong><br>
          본 합의는 Off-Stage를 통해 업로드된 음원에 대해 플랫폼 내 스트리밍 및 공유에 필요한 권한을 부여함을 목적으로 합니다.<br>
          <em style="color:var(--text-secondary);">This agreement grants Off-Stage the rights needed to stream and share music uploaded through the platform.</em><br><br>
          <strong>제 2조 (저작권 및 이용 허락) / Article 2 (Copyright & License)</strong><br>
          업로더는 창작한 곡에 대한 모든 저작권을 소유하며, Off-Stage는 해당 곡을 플랫폼 스트리밍 및 공유를 위해 재생산·배포할 수 있는 비독점적 권한을 가집니다.<br>
          <em style="color:var(--text-secondary);">The uploader retains all copyright. Off-Stage holds a non-exclusive right to reproduce and distribute the track for streaming and sharing on the platform.</em><br><br>
          <strong>제 3조 (외부 유통 연계) / Article 3 (External Distribution)</strong><br>
          유통을 신청한 곡은 플랫폼의 검수를 거친 뒤, 파트너 유통사와의 정식 발매 계약으로 연결될 수 있습니다. 계약 체결 시 별도 서면 계약이 요구될 수 있습니다.<br>
          <em style="color:var(--text-secondary);">Tracks submitted for distribution may, after platform review, be connected to formal release contracts with partner distributors. A separate written contract may be required.</em>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="up-agree" required>
            ${_i18n('위 음원 유통 및 서비스 이용 약관에 동의합니다. (필수)', 'I agree to the upload & playback terms above. (required)')}
          </label>
        </div>

        <button type="submit" class="btn-primary" style="width: 100%; padding: 14px; font-size: 16px;">
          ${_i18n('동의하고 업로드 완료하기', 'Agree & Upload')}
        </button>
      </form>
    </div>
      </div>
    </div>
  `;

  // ====== Two-tier upload type toggle behavior ======
  let _myProjects = [];
  const verLabelInput = document.getElementById('up-version-label');
  const titleInput = document.getElementById('up-title');
  const titleHint = document.getElementById('up-title-hint');
  const projectSelect = document.getElementById('up-project-id');
  const verInfo = document.getElementById('existing-version-info');
  const projSubstep = document.getElementById('project-substep');
  const existingPicker = document.getElementById('existing-project-picker');
  const distSection = document.getElementById('distribution-section');

  // Resolve which mode/choice/version is selected from the live radios
  function getUploadState() {
    // master_solo 는 현재 "준비중" 으로 막혀있음 — checked radio 없으면 project 로 fallback.
    const mode    = (document.querySelector('input[name="up-mode"]:checked') || {}).value || 'project';
    const choice  = (document.querySelector('input[name="up-proj-choice"]:checked') || {}).value || 'new';
    const verType = (document.querySelector('input[name="up-version-type"]:checked') || {}).value || 'demo';
    // master_solo always uploads a master; project mode follows verType
    const isFinal = mode === 'master_solo' || verType === 'master';
    return { mode, choice, verType, isFinal };
  }

  async function loadMyProjects() {
    if (!window.Tracks) return;
    _myProjects = await window.Tracks.listMyProjects();
    if (!_myProjects.length) {
      projectSelect.innerHTML = '<option value="">아직 시작한 Demo 가 없어요 — "새 Demo"로 첫 곡 올려보세요 (No demos yet — start a new one)</option>';
      return;
    }
    projectSelect.innerHTML = _myProjects.map(p =>
      `<option value="${p.projectId}">${(p.title||'무제').replace(/"/g,'&quot;')} · 데모 (Demo) ${p.demoCount}${p.hasFinal?' · 발매됨 (Released)':''}</option>`
    ).join('');
    refreshExistingInfo();
  }
  function refreshExistingInfo() {
    if (!projectSelect || !verInfo) return;
    const pid = projectSelect.value;
    const p = _myProjects.find(x => x.projectId === pid);
    if (!p) { verInfo.innerHTML = ''; return; }
    const next = p.nextDemoNum || (p.demoCount + 1);
    verInfo.innerHTML = `<strong>${p.title}</strong> — 데모 ${p.demoCount}개${p.hasFinal?' + 발매':''}. 다음 데모 (Next demo): <strong>Demo ${next}</strong>`;
    if (titleInput && !titleInput.dataset.userTyped) {
      titleInput.value = p.title;
      titleHint.textContent = '(Demo 제목 자동 반영)';
    }
    syncVersionLabel();
  }

  // Auto-fill version label + show/hide distribution metadata section
  function syncVersionLabel() {
    if (verLabelInput.dataset.userTyped === '1') return;  // respect manual edits
    const s = getUploadState();
    if (s.isFinal) {
      verLabelInput.value = 'Final';
    } else if (s.mode === 'project' && s.choice === 'existing') {
      const p = _myProjects.find(x => x.projectId === projectSelect.value);
      verLabelInput.value = 'Demo ' + (p ? (p.nextDemoNum || p.demoCount + 1) : 1);
    } else {
      verLabelInput.value = 'Demo 1';
    }
  }
  function syncDistributionSection() {
    const s = getUploadState();
    if (distSection) distSection.style.display = s.isFinal ? 'block' : 'none';
  }
  // 데모 모드면 제목/커버 칸을 숨기고 제목 required도 떼어준다.
  // (데모는 자동으로 프로젝트 제목 또는 1줄 낙서를 제목으로 쓰고, 커버는 Coming Soon 포스트잇)
  function syncMasterFields() {
    const s = getUploadState();
    const isDemo = !s.isFinal;
    const form = document.getElementById('upload-form');
    if (form) form.classList.toggle('demo-mode', isDemo);
    if (titleInput) {
      if (isDemo) titleInput.removeAttribute('required');
      else titleInput.setAttribute('required', '');
    }
  }

  // Generic toggle: clicking a label updates the group's active class + checks its radio.
  // .is-disabled 옵션은 클릭/탭/터치 무시 (현재 "발매 단독" 이 준비중으로 막힘).
  function wireToggleGroup(groupSelector, afterChange) {
    document.querySelectorAll(groupSelector + ' .upload-type-opt').forEach(opt => {
      opt.addEventListener('click', (ev) => {
        if (opt.classList.contains('is-disabled')) {
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof showToast === 'function') showToast(_t('"발매 단독" 은 준비중이에요. 곧 열려요!', '"Release only" is coming soon. Stay tuned!'));
          return;
        }
        opt.parentElement.querySelectorAll('.upload-type-opt').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        const radio = opt.querySelector('input[type=radio]');
        if (radio) radio.checked = true;
        if (afterChange) afterChange();
      });
    });
  }
  // Tier 1 — mode
  wireToggleGroup('.card > .upload-type-toggle:not(.compact)', () => {
    const s = getUploadState();
    if (s.mode === 'project') {
      projSubstep.style.display = 'block';
      // If 기존 already selected, ensure list is loaded
      if (s.choice === 'existing') loadMyProjects();
    } else {
      projSubstep.style.display = 'none';
      if (titleHint) titleHint.textContent = '';
    }
    syncVersionLabel();
    syncDistributionSection();
    syncMasterFields();
  });
  // Tier 2a — new vs existing project
  wireToggleGroup('#project-substep .upload-type-toggle.compact:first-of-type', () => {
    const s = getUploadState();
    if (s.choice === 'existing') {
      existingPicker.style.display = 'block';
      loadMyProjects();
    } else {
      existingPicker.style.display = 'none';
      // Clear auto-filled title when switching to new project
      if (titleInput && !titleInput.dataset.userTyped) {
        titleInput.value = '';
        if (titleHint) titleHint.textContent = '';
      }
    }
    syncVersionLabel();
    syncDistributionSection();
    syncMasterFields();
  });
  // Tier 2b — demo vs master version type
  wireToggleGroup('#project-substep .upload-type-toggle.compact:last-of-type', () => {
    syncVersionLabel();
    syncDistributionSection();
    syncMasterFields();
  });
  // 초기 한 번 — 이제 첫 진입은 project + demo (master_solo 가 준비중으로 막힘).
  // syncMasterFields() 가 demo-mode 클래스를 form 에 붙여 제목/커버 칸 자동 처리.
  syncMasterFields();
  syncVersionLabel();
  syncDistributionSection();

  // 아티스트 페이지 '+ DEMO N 추가' 카드에서 넘어왔다면: 프로젝트+기존+데모로 자동 세팅 + 대상 프로젝트 선택
  (async function applyPendingUploadState() {
    if (!window.__pendingUploadProjectId && !window.__pendingUploadVersionType) return;
    const pendingProjectId = window.__pendingUploadProjectId;
    const pendingVerType   = window.__pendingUploadVersionType || 'demo';
    window.__pendingUploadProjectId = null;
    window.__pendingUploadVersionType = null;
    try {
      // 1) Tier1: 프로젝트 모드로
      const projModeOpt = document.querySelector('.card > .upload-type-toggle:not(.compact) .upload-type-opt[data-mode="project"]');
      if (projModeOpt) projModeOpt.click();
      // 2) Tier2a: 기존 프로젝트
      const existingOpt = document.querySelector('#project-substep .upload-type-toggle.compact:first-of-type .upload-type-opt[data-proj-choice="existing"]');
      if (existingOpt) existingOpt.click();
      // 3) Tier2b: 데모
      if (pendingVerType === 'demo') {
        const demoOpt = document.querySelector('#project-substep .upload-type-toggle.compact:last-of-type .upload-type-opt[data-version-type="demo"]');
        if (demoOpt) demoOpt.click();
      }
      // 4) 프로젝트 목록 로딩 후 해당 프로젝트 선택
      await loadMyProjects();
      if (pendingProjectId && projectSelect && projectSelect.querySelector(`option[value="${pendingProjectId}"]`)) {
        projectSelect.value = pendingProjectId;
        refreshExistingInfo();
      }
      // 위저드: '+ DEMO 추가'로 넘어왔으면 키오스크 건너뛰고 바로 폼으로
      window.__uwFormBack = 'dchoice';
      if (typeof window.uwUpGo === 'function') window.uwUpGo('form');
    } catch (e) { console.warn('[upload] applyPendingUploadState', e); }
  })();

  if (projectSelect) projectSelect.addEventListener('change', refreshExistingInfo);
  if (titleInput) titleInput.addEventListener('input', () => { titleInput.dataset.userTyped = '1'; });
  if (verLabelInput) verLabelInput.addEventListener('input', () => { verLabelInput.dataset.userTyped = '1'; });

  // ===== 도형 낙서 글자수 제한 — 모양별 한 줄 글자수(공백 제외) 제한 =====
  // 도형이 좁으면 글씨가 삐져나오므로, 모양별로 한 줄에 들어갈 글자수를 다르게 잡는다.
  // 띄어쓰기(공백)는 글자수에 포함하지 않는다.
  const SHAPE_LINE_LIMIT = {
    circle: 12,   // 원 — 가장 좁음
    hexagon: 12,  // 육각형
    oval: 13,     // 타원
    rect: 13,     // 둥근 사각형
    pill: 15,     // 알약
    wide: 18      // 직사각형 — 가장 넓음
  };
  // 도형 낙서 입력 제거 — 발견 도형은 이제 '태그 앞 3개'를 표시(태그 통합, 사용자 요청).
  //   줄수제한/노트 덮어쓰기 셋업 불필요. 미리보기는 #up-tags 의 uwTagsPreview 가 갱신.

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type=submit]');
    const setStatus = (msg) => { if (submitBtn) submitBtn.textContent = msg; };
    if (submitBtn) { submitBtn.disabled = true; }

    try {
      const coverFile = document.getElementById('up-cover').files[0];
      const audioFile = document.getElementById('up-audio').files[0];

      if (!audioFile) throw new Error('오디오 파일을 선택해주세요.');
      if (audioFile.size > 50 * 1024 * 1024) throw new Error('오디오 파일은 50MB 이하만 업로드 가능해요.');
      if (coverFile && coverFile.size > 5 * 1024 * 1024) throw new Error('커버 이미지는 5MB 이하만 가능해요.');

      const db = window.DB.get();
      const user = window.__currentUser || db.currentUser;
      if (!user) throw new Error('로그인이 필요해요');

      // 필수 입력 검증 (오디오 업로드 전에 먼저 막아서 시간 낭비 방지)
      if (!((document.getElementById('up-description').value || '').trim()))
        throw new Error('곡 소개 및 코멘트를 적어주세요. (필수)');
      if (!((document.getElementById('up-tags').value || '').trim()))
        throw new Error('태그를 한 개 이상 적어주세요. (필수)');
      if (getUploadState().isFinal && !((document.getElementById('up-lyrics')?.value || '').trim()))
        throw new Error('발매(마스터)는 가사가 필요해요. 데모는 비워둬도 됩니다. (가사는 곡 페이지에 표시돼요)');

      // Determine upload type from new two-tier state
      const state = getUploadState();
      const isFinal = state.isFinal;
      // 발매(마스터)는 아직 런칭 전 — 어떤 경로로 와도 차단(데모만 허용).
      if (isFinal) {
        if (typeof showToast === 'function') showToast(_t('발매는 아직 준비 중이에요 🛠️ 지금은 데모만 올릴 수 있어요', 'Release is coming soon — demos only for now'));
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '동의하고 업로드 완료하기'; }
        return;
      }
      const versionLabel = (verLabelInput.value || '').trim() || (isFinal ? 'Final' : 'Demo 1');

      // master_solo  → no project context, brand new projectId
      // project+new  → brand new projectId, isFinal follows version-type
      // project+existing → reuse existing projectId, demote old final if needed
      let existingProject = null;
      const usingExistingProject = (state.mode === 'project' && state.choice === 'existing');
      if (usingExistingProject) {
        const pid = projectSelect.value;
        if (!pid) throw new Error('기존 Demo 를 선택해주세요.');
        existingProject = _myProjects.find(p => p.projectId === pid);
        if (!existingProject) throw new Error('선택한 Demo 를 찾을 수 없어요.');
        if (isFinal && existingProject.hasFinal) {
          if (!confirm('이 프로젝트는 이미 발매본이 있어요. 기존 발매본은 이전 버전으로 밀려나고 이 곡이 새 발매본이 돼요. 계속할까요?')) {
            throw new Error('취소됨');
          }
        }
      }

      // Upload files to Supabase Storage
      let coverUrl;
      let audioUrl = '';

      if (!window.Tracks) throw new Error('Supabase가 준비되지 않았어요.');

      setStatus('오디오 업로드 중…');
      audioUrl = await window.Tracks.uploadFile(audioFile, 'audio');
      // 커버는 데모·발매 모두 '선택'. 올리면 그걸 쓰고, 없으면 기존 프로젝트 커버 → 둘 다 없으면
      // Coming Soon. (예전엔 데모=무조건 Coming Soon, 발매=업로드 스톡사진 기본 — 사용자 요청으로 통일)
      if (coverFile) {
        setStatus('커버 업로드 중…');
        coverUrl = await window.Tracks.uploadFile(coverFile, 'covers');
      } else if (existingProject && existingProject.cover && existingProject.cover !== COMING_SOON_COVER) {
        coverUrl = existingProject.cover;
      } else {
        coverUrl = COMING_SOON_COVER;
      }

      const tagsRaw = document.getElementById('up-tags').value || '';
      // 태그 파싱 — # 기준 분리. 콤마도 호환 (기존 사용자 데이터 호환).
      // 예: '#1982년 느낌 #funky' → ['1982년 느낌', 'funky']
      //     'rock, lofi'           → ['rock', 'lofi']
      //     '#rock,lofi #emo'      → ['rock', 'lofi', 'emo']
      const messageTags = tagsRaw
        .split(/[#,]/)                    // # 또는 , 로 split
        .map(s => s.trim())               // 공백 정리
        .filter(Boolean);                 // 빈 토큰 제외
      // 장르(드롭다운) — 태그 맨 앞에 저장(색·알고리즘용). 도형 글(lines)에는 안 들어감.
      const genreVal = (document.getElementById('up-genre')?.value || '').trim();
      const tags = genreVal
        ? [genreVal].concat(messageTags.filter(t => t.toLowerCase() !== genreVal.toLowerCase()))
        : messageTags;
      const description = document.getElementById('up-description').value;
      const lyrics = (document.getElementById('up-lyrics')?.value || '').trim();
      const line1 = (document.getElementById('up-line1') || {}).value || '';
      const line2 = (document.getElementById('up-line2') || {}).value || '';
      const line3 = (document.getElementById('up-line3') || {}).value || '';
      // 데모는 제목 칸이 안 보이므로 자동으로 채운다.
      // - 기존 프로젝트의 새 데모면 그 프로젝트 제목을 이어 받음.
      // - 새 프로젝트의 첫 데모면 그냥 'Demo 1' (versionLabel) — 1줄 낙서를 제목으로 쓰지 않음.
      let title = (titleInput.value || '').trim();
      if (!isFinal) {
        if (usingExistingProject && existingProject) {
          title = (existingProject.title || '').trim() || versionLabel || 'Demo 1';
        } else {
          title = versionLabel || 'Demo 1';
        }
      }
      const shapeEl = document.getElementById('up-shape');
      const colorEl = document.getElementById('up-shape-color');

      // Version & project
      let version, projectId;
      if (usingExistingProject) {
        projectId = existingProject.projectId;
        version = isFinal
          ? 'final'
          : 'demo' + (existingProject.nextDemoNum || (existingProject.demoCount + 1));
      } else {
        // master_solo or project+new — DB generates a fresh project_id
        projectId = undefined;
        version = isFinal ? 'final' : 'demo1';
      }

      // Distribution metadata — only meaningful when uploading a master.
      // Backend columns are optional, so empty strings/null are fine for demos.
      const distArtist    = isFinal ? ((document.getElementById('up-dist-artist')?.value || '').trim()) : '';
      const releaseDate   = isFinal ? ((document.getElementById('up-release-date')?.value || '').trim()) : '';
      const collabRaw     = isFinal ? ((document.getElementById('up-collaborators')?.value || '').trim()) : '';
      const collaborators = collabRaw
        ? collabRaw.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name }))
        : [];

      setStatus('트랙 저장 중…');
      // Auto-promote listener → artist on first upload (idempotent)
      if (user.role === 'listener' && window.supabase) {
        try {
          await window.supabase.from('profiles').update({ role: 'artist' }).eq('id', user.id);
          if (window.__currentUser) window.__currentUser.role = 'artist';
        } catch (e) { console.warn('[upload] promote role', e); }
      }

      // If adding final to project that already has one, demote the old one
      if (usingExistingProject && isFinal && existingProject.hasFinal) {
        const oldFinal = existingProject.versions.find(v => v.version === 'final' && !v.isDemo);
        if (oldFinal && window.supabase) {
          await window.supabase.from('tracks').update({
            version: 'demo_retired',
            version_label: (oldFinal.label || 'Final') + ' (이전)',
            is_demo: true
          }).eq('id', oldFinal.id);
        }
      }

      // 낙서 3줄 — # 안 붙었으면 자동으로 붙이고, 이미 #이면 그대로.
      const _hashLine = (s) => { s = (s || '').trim(); return s ? (s.startsWith('#') ? s : '#' + s) : s; };

      // DB INSERT — 20초 안에 응답 없으면 강제 실패 (영구 "저장 중…" 방지)
      const inserted = await Promise.race([
        window.Tracks.insert({
          title,
          description,
          // 업로드 폼의 "곡 소개 및 코멘트" 가 사실상 일지(artistNote). 데모 카드에
          // 노출되는 필드가 artistNote이라서 동일 값으로 같이 저장.
          artistNote: description,
          lyrics,   // 가사 → 앨범(곡) 페이지 가사 섹션에 표시
          audioUrl,
          cover: coverUrl,
          projectId,
          version,
          versionLabel,
          isDemo: !isFinal,
          tags,
          shape: shapeEl ? shapeEl.value : 'circle',
          shapeColor: colorEl ? colorEl.value : '#FF4081',
          lines: messageTags.slice(0, 3).map(_hashLine),   // 도형 글 = 메시지 태그 앞 3개(장르 제외)
          genre: genreVal || undefined,   // 로컬 편의(저장은 tags[0]). 색·알고리즘은 genreOfTrack 이 tags 로도 해석
          // Distribution metadata (admin ZIP uses these). Empty for demos.
          distArtist,
          releaseDate,
          collaborators
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB 저장 타임아웃 (20초). RLS 정책 또는 네트워크 확인 필요.')), 20000))
      ]);

      showToast(isFinal ? _t('발매 완료! (Released)', 'Released!') : _t('데모 업로드 완료 (Demo uploaded)', 'Demo uploaded'));
      // refreshInto는 백그라운드 — 여기서 await하면 느릴 때 또 멈춤
      Promise.resolve(window.Tracks.refreshInto(db)).catch(e => console.warn('[upload] refreshInto bg', e));
      // 가사 → 우리들의 벽(주절주절) 자동 게시는 사용자 요청으로 비활성화.
      //   이제 가사는 곡(앨범) 페이지의 '가사' 섹션에만 표시되고, 주절주절에는 자동으로 안 올라감.
      // 업로드 완료 → 가사가 벽에 게시됐음을 알리는 모달.
      _afterUploadPrompt(inserted, user.name);
    } catch (err) {
      alert('업로드 실패: ' + (err.message || err));
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '동의하고 업로드 완료하기'; }
    }
  });
}

// 업로드 완료 후 — '이 곡의 첫 음악일기를 우리들의 벽에 써볼까요?' 권유 모달.
// 쓰기 누르면 우리들의 벽 작성창이 곡 첨부된 채로 열림.
function _afterUploadPrompt(track, artistName) {
  track = track || {};
  const cover = track.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=300';
  const title = (track.title || '내 곡').replace(/</g, '&lt;');
  const goArtist = () => navigateTo('artist:' + encodeURIComponent(artistName || ''));
  const goAlbum = () => navigateTo('album:' + encodeURIComponent(track.projectId || ('proj_' + track.id)));

  const ov = document.createElement('div');
  ov.className = 'upload-done-modal';
  ov.innerHTML = `
    <div class="upload-done-card">
      <img class="upload-done-cover" src="${cover}" alt="" draggable="false">
      <h2 class="upload-done-title">${_i18n('업로드 완료!', 'Upload complete!')}</h2>
      <p class="upload-done-sub">${_i18n(`「${title}」 가 무대 뒤에 올라왔어요.<br>적은 가사는 <b>곡 페이지</b>에서 볼 수 있어요 🎵`, `「${title}」 is up backstage.<br>Your lyrics show on the <b>song page</b> 🎵`)}</p>
      <div class="upload-done-actions">
        <button class="btn-primary upload-done-write"><i class="ri-disc-line"></i> ${_i18n('곡 페이지 보기', 'See song')}</button>
        <button class="upload-done-later">${_i18n('내 페이지', 'My page')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));

  const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); };

  ov.querySelector('.upload-done-write').onclick = () => { close(); navigateTo('song:' + encodeURIComponent(track.id || '')); };
  ov.querySelector('.upload-done-later').onclick = () => { close(); goArtist(); };
  ov.onclick = (e) => { if (e.target === ov) { close(); goArtist(); } };
}

// (Studio booking feature removed)

// ===================== 5. PROFILE & SETTINGS =====================

// ===== 곡 상세 (응원 루프 + 진화 기록) — 청취자 디자인 Screen 2. 라우트 song:<id> =====
function _sdStyle() {
  return `<style id="sd-style">
.sd-page{position:relative;min-height:100%;padding:48px 0 calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 28px);background:#0B0B11;color:#F4F4F7;font-family:'Pretendard',sans-serif;overflow-x:hidden;}
.sd-page *{box-sizing:border-box;}
.sd-inner{padding:0 16px;max-width:430px;margin:0 auto;}
.sd-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#8B8B9A;font-weight:600;padding:8px 2px 4px;cursor:pointer;}
.sd-back i{font-size:18px;}
.sd-cover{position:relative;border-radius:22px;height:200px;overflow:hidden;margin:8px 0 16px;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 100% at 50% 20%,rgba(72,224,139,.28),transparent 62%),#15151F;border:1px solid rgba(72,224,139,.2);cursor:pointer;}
.sd-orb{width:104px;height:104px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 38% 32%,#7DF7AE,#36C977 60%,#1f9a57);box-shadow:0 0 40px rgba(72,224,139,.5);color:#06140C;font-size:30px;}
.sd-head .who{font-size:13px;color:#8B8B9A;font-weight:600;}
.sd-head .ti{font-size:24px;font-weight:800;margin-top:2px;}
.sd-stg{display:inline-flex;align-items:center;gap:8px;margin:12px 2px 0;font-size:13px;font-weight:800;}
.sd-stg .now{color:#48E08B;background:rgba(72,224,139,.14);padding:4px 11px;border-radius:999px;}
.sd-stg .left{color:#8B8B9A;}
.sd-tl{margin:20px 4px 6px;position:relative;padding-left:8px;}
.sd-tlrow{display:flex;align-items:flex-start;gap:13px;position:relative;padding-bottom:16px;}
.sd-tlrow:last-child{padding-bottom:0;}
.sd-tlrow::before{content:"";position:absolute;left:8px;top:20px;bottom:-2px;width:2px;background:rgba(255,255,255,.08);}
.sd-tlrow:last-child::before{display:none;}
.sd-tlrow.fill::before{background:linear-gradient(180deg,#36C977,rgba(54,201,119,.25));}
.sd-dot{width:18px;height:18px;border-radius:50%;flex:0 0 auto;z-index:1;display:flex;align-items:center;justify-content:center;}
.sd-dot.done{background:linear-gradient(135deg,#7DF7AE,#36C977);}
.sd-dot.done i{font-size:10px;color:#06140C;}
.sd-dot.now{background:#0B0B11;border:2px solid #48E08B;}
.sd-dot.now i{width:7px;height:7px;border-radius:50%;background:#48E08B;display:block;}
.sd-dot.lock{background:#15151F;border:1.5px dashed rgba(255,255,255,.18);}
.sd-dot.lock i{font-size:9px;color:#5E5E6E;}
.sd-tt{font-size:13.5px;font-weight:700;}
.sd-tt.mut{color:#5E5E6E;}
.sd-td{font-size:11px;color:#8B8B9A;margin-top:1px;}
.sd-supp{display:flex;align-items:center;gap:10px;margin:18px 2px;padding:13px;background:#15151F;border:1px solid rgba(255,255,255,.06);border-radius:15px;}
.sd-avs{display:flex;flex:0 0 auto;}
.sd-avs span{width:25px;height:25px;border-radius:50%;border:2px solid #15151F;margin-left:-8px;font-size:10px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;}
.sd-avs span:first-child{margin-left:0;}
.sd-supp .cnt{font-size:12.5px;color:#8B8B9A;font-weight:600;}
.sd-supp .cnt b{color:#F4F4F7;}
.sd-cheer{width:100%;border:none;border-radius:16px;padding:16px;cursor:pointer;background:linear-gradient(95deg,#FB6F92,#F472B6);color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 10px 26px rgba(251,111,146,.32);font-family:inherit;}
.sd-cheer i{font-size:19px;}
.sd-cheer:active{transform:scale(.98);}
.sd-csub{text-align:center;font-size:11.5px;color:#8B8B9A;margin:10px 0 4px;}
.sd-listen{width:100%;border:1px solid rgba(255,255,255,.12);background:#15151F;color:#F4F4F7;border-radius:14px;padding:11px;font-family:inherit;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:3px;margin-top:10px;cursor:pointer;}
.sd-listen:active{transform:scale(.99);}
.sd-listen-main{font-size:14px;display:flex;align-items:center;gap:8px;}
.sd-listen-sub{font-size:11px;color:#9DE0B4;font-weight:600;}
.sd-story{margin:20px 2px 0;padding:15px;background:#15151F;border:1px solid rgba(255,255,255,.06);border-radius:15px;}
.sd-story .lab{font-size:11px;font-weight:800;color:#8B8B9A;letter-spacing:.3px;margin-bottom:8px;}
.sd-story p{font-size:13.5px;line-height:1.6;}
.sd-story .lyr{color:#8B8B9A;font-size:13px;margin-top:9px;line-height:1.7;white-space:pre-line;}
@media(min-width:769px){.sd-inner{max-width:460px;}}
</style>`;
}

// '같이 듣기' — 곡 재생 + 응원하며 듣는 사람 수를 토스트로(커뮤니티 느낌). 실시간 동기화는 아님.
// 카운트는 라이브 값(window.__sdSupCount)을 우선 사용하고, 없으면 렌더 시 넘긴 n 사용.
window._sdListenAlong = function (id, n) {
  try { playTrack(id); } catch (_) {}
  var cnt = (typeof window.__sdSupCount === 'number') ? window.__sdSupCount : (n || 0);
  if (typeof showToast === 'function') {
    showToast((cnt > 0)
      ? _t(cnt + '명과 함께 듣는 중 🎧', 'Listening with ' + cnt + ' others 🎧')
      : _t('이 곡 듣는 중 🎧', 'Now playing 🎧'));
  }
};

// 곡 상세 — 실제 응원 수(cheers 테이블)를 비동기로 읽어 화면 갱신.
// track.likes/plays(가짜 수) 대신 진짜 '키운 사람 수'를 표시한다. 응원 직후에도 호출.
window._sdRefreshSupporters = async function (trackId) {
  if (!window.supabase || !window.Cheers || !window.Cheers.fetchForTrack) return;
  if (String(window.__currentSongId) !== String(trackId)) return;
  var rows = [];
  try { rows = await window.Cheers.fetchForTrack(trackId, 60); } catch (_) { return; }
  if (String(window.__currentSongId) !== String(trackId)) return; // 그새 페이지 이동
  // 고유 응원자만
  var seen = {}, sup = [];
  rows.forEach(function (r) {
    var k = r.supporter_id || r.supporter_name || r.id;
    if (!seen[k]) { seen[k] = 1; sup.push(r); }
  });
  var n = sup.length;
  window.__sdSupCount = n;
  var _esc = function (s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var avCol = ['#7C6FF0', '#FB6F92', '#36C977', '#FBBF24', '#54E0CE', '#5AA9FF', '#B06BFF'];
  var avEl = document.getElementById('sd-avs');
  if (avEl) {
    avEl.innerHTML = n > 0
      ? sup.slice(0, 5).map(function (r, i) {
          return '<span style="background:' + avCol[i % avCol.length] + '">' + _esc((r.supporter_name || '♥').trim().charAt(0) || '♥') + '</span>';
        }).join('')
      : '';
  }
  var cntEl = document.getElementById('sd-cnt');
  if (cntEl) {
    cntEl.innerHTML = n > 0
      ? '<b>' + n + '</b>' + _t('명이 이 곡을 키우는 중', ' raising this song')
      : _t('첫 응원의 주인공이 되어보세요', 'Be the first to cheer');
  }
  var csubEl = document.getElementById('sd-csub');
  if (csubEl) {
    csubEl.textContent = _t('이 곡의 성장을 응원해요', 'Support this song') + (n > 0 ? ' · ' + (n + 1) + _t('번째 응원', 'th cheer') : '');
  }
  var lsubEl = document.getElementById('sd-listen-sub');
  if (lsubEl) {
    lsubEl.textContent = n > 0
      ? _t(n + '명이 응원하며 듣고 있어요 🎧', n + ' fans listening along 🎧')
      : _t('이 곡을 들어보세요 🎧', 'Give it a listen 🎧');
  }
};

function renderSongDetail(trackId) {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && String(t.id) === String(trackId));
  if (!track) { navigateTo('shapes'); return; }
  const esc = (s) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clean = (s) => (s || '무제').replace(/\s*\(.*\)$/, '');
  let ti = clean(track.title);
  if (ti === '무제' || /^demo\s*\d*$/i.test(ti)) ti = track.artist || ti;

  // 같은 프로젝트의 모든 데모 (진화 기록)
  const pid = track.projectId || ('proj_' + track.id);
  const vs = (db.tracks || []).filter(t => t && (t.projectId || ('proj_' + t.id)) === pid).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const demos = vs.filter(v => v && v.isDemo);
  const hasFinal = vs.some(v => v && !v.isDemo && v.version === 'final');
  const _md = (d) => { const dt = new Date(d || 0); return dt.getTime() ? (String(dt.getMonth() + 1).padStart(2, '0') + '.' + String(dt.getDate()).padStart(2, '0')) : ''; };

  // 진화 타임라인
  let tlRows = '';
  demos.forEach((d, i) => {
    const isCur = (i === demos.length - 1) && !hasFinal;
    const cls = isCur ? 'now' : 'done';
    const note = d.artistNote || d.description || (i === 0 ? _t('첫 스케치', 'First sketch') : _t('데모 업데이트', 'Demo update'));
    tlRows += `<div class="sd-tlrow${cls === 'done' ? ' fill' : ''}"><span class="sd-dot ${cls}">${cls === 'done' ? '<i class="ri-check-line"></i>' : '<i></i>'}</span>`
      + `<div><div class="sd-tt"${isCur ? ' style="color:#48E08B"' : ''}>데모 ${i + 1}${isCur ? ' · ' + _t('지금 여기', 'You are here') : ' ' + _t('올림', 'uploaded')}</div><div class="sd-td">${esc(_md(d.createdAt))} · ${esc(note)}</div></div></div>`;
  });
  tlRows += `<div class="sd-tlrow"><span class="sd-dot ${hasFinal ? 'done' : 'lock'}">${hasFinal ? '<i class="ri-check-line"></i>' : '<i class="ri-lock-2-line"></i>'}</span>`
    + `<div><div class="sd-tt${hasFinal ? '' : ' mut'}">${_t('마스터 발매', 'Master release')}</div><div class="sd-td">${hasFinal ? _t('발매 완료 🎉', 'Released 🎉') : _t('응원이 모이면 잠금 해제', 'Unlocks as cheers gather')}</div></div></div>`;

  // 라이브(Supabase)면 실제 응원 수를 비동기로 채운다 → 시작값 0(가짜 재생수 안 씀).
  // 오프라인/데모면 track.likes/plays 로 활기있게 보이기.
  const _supaLive = !!(window.supabase && window.Cheers && window.Cheers.fetchForTrack);
  const supN = _supaLive ? 0 : (track.likes || track.plays || 0);
  const story = track.description || track.artistNote || '';
  const lyrics = track.lyrics || '';
  const curStage = hasFinal ? _t('발매', 'Released') : ('데모 ' + demos.length);
  const leftTxt = hasFinal ? _t('정규 발매', 'Released') : _t('마스터까지 1단계', '1 step to master');
  const avInit = ['서', '민', '지', '하', '윤'];
  const avCol = ['#7C6FF0', '#FB6F92', '#36C977', '#FBBF24', '#54E0CE'];
  const avs = supN > 0 ? avCol.slice(0, Math.min(supN, 5)).map((c, i) => `<span style="background:${c}">${avInit[i] || '♥'}</span>`).join('') : '';

  appContent.innerHTML = `${_sdStyle()}
    <div class="sd-page"><div class="sd-inner">
      <div class="sd-back" onclick="(window.goBack&&goBack())||navigateTo('profile')"><i class="ri-arrow-left-s-line"></i> ${_t('뒤로', 'Back')}</div>
      <div class="sd-cover" onclick="playTrack('${track.id}')"><div class="sd-orb"><i class="ri-play-fill"></i></div></div>
      <div class="sd-head"><div class="who">${esc(track.artist || '')}</div><div class="ti">${esc(ti)}</div>
        <div class="sd-stg"><span class="now">${esc(curStage)}</span><span class="left">${leftTxt}</span></div>
      </div>
      <div class="sd-tl">${tlRows}</div>
      <div class="sd-supp">
        <div class="sd-avs" id="sd-avs">${avs}</div>
        <span class="cnt" id="sd-cnt">${supN > 0 ? `<b>${supN}</b>${_t('명이 이 곡을 키우는 중', ' raising this song')}` : _t('첫 응원의 주인공이 되어보세요', 'Be the first to cheer')}</span>
      </div>
      <button class="sd-cheer" data-tid="${esc(track.id)}" data-tt="${esc(ti)}" data-an="${esc(track.artist || '')}" onclick="mhCheer(this)"><i class="ri-heart-3-fill"></i> ${_t('응원하기', 'Cheer')}</button>
      <div class="sd-csub" id="sd-csub">${_t('이 곡의 성장을 응원해요', 'Support this song')}${supN > 0 ? ` · ${supN + 1}${_t('번째 응원', 'th cheer')}` : ''}</div>
      <button class="sd-listen" onclick="window._sdListenAlong('${track.id}', ${supN})">
        <div class="sd-listen-main"><i class="ri-headphone-fill"></i> ${_t('같이 듣기', 'Listen along')}</div>
        <div class="sd-listen-sub" id="sd-listen-sub">${supN > 0 ? _t(supN + '명이 응원하며 듣고 있어요 🎧', supN + ' fans listening along 🎧') : _t('이 곡을 들어보세요 🎧', 'Give it a listen 🎧')}</div>
      </button>
      ${(story || lyrics) ? `<div class="sd-story"><div class="lab">${_t('이 곡 이야기', 'About this song')}</div>${story ? `<p>${esc(story)}</p>` : ''}${lyrics ? `<div class="lyr">${esc(lyrics)}</div>` : ''}</div>` : ''}
    </div></div>`;
  window.__currentSongId = trackId;
  window.__sdSupCount = supN;
  // 실제 응원 수(cheers)를 비동기로 읽어 카운트·아바타·서브문구 갱신.
  try { window._sdRefreshSupporters(trackId); } catch (_) {}
}

// 내 계정 = '내 기획사' 디자인 스코프 CSS (.ag-*) — <style> 자체 포함.
function _agStyle() {
  return `<style id="ag-style">
.ag-page{position:relative;min-height:100%;padding:46px 0 calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 28px);background:radial-gradient(800px 500px at 18% -5%,rgba(139,124,246,.10),transparent 60%),radial-gradient(700px 460px at 96% 8%,rgba(255,201,77,.06),transparent 55%),#070710;color:#F5F5F8;font-family:'Pretendard',sans-serif;overflow-x:hidden;}
.ag-page *{box-sizing:border-box;}
.ag-inner{padding:0 16px;max-width:440px;margin:0 auto;}
.ag-top{display:flex;align-items:center;justify-content:space-between;padding:4px 2px 12px;}
.ag-id{display:flex;align-items:center;gap:10px;}
.ag-id-av{width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.1);}
.ag-id-nm{font-size:15px;font-weight:800;}
.ag-set{width:32px;height:32px;border-radius:50%;background:#15151F;border:1px solid rgba(255,255,255,.08);color:#8C8C9E;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;}
.ag-dash{position:relative;border-radius:18px;padding:16px;overflow:hidden;margin:2px 2px 6px;background:linear-gradient(135deg,rgba(139,124,246,.16),rgba(251,111,146,.10)),#15151F;border:1px solid rgba(139,124,246,.28);}
.ag-dl{font-size:11px;font-weight:800;color:#8B7CF6;letter-spacing:.4px;}
.ag-dt{font-size:20px;font-weight:900;margin:3px 0 2px;}
.ag-ds{font-size:12px;color:#8C8C9E;}
.ag-stats{display:flex;margin-top:13px;background:rgba(0,0,0,.25);border-radius:12px;overflow:hidden;}
.ag-stat{flex:1;text-align:center;padding:9px 4px;border-right:1px solid rgba(255,255,255,.08);}
.ag-stat:last-child{border-right:none;}
.ag-stat b{display:block;font-size:17px;font-weight:900;}
.ag-stat span{font-size:10.5px;color:#8C8C9E;font-weight:600;}
.ag-tier{display:flex;align-items:center;justify-content:space-between;margin:22px 2px 11px;}
.ag-tier h2{font-size:15px;font-weight:900;display:flex;align-items:center;gap:8px;}
.ag-step{font-size:9.5px;font-weight:900;color:#06140C;padding:2px 7px;border-radius:6px;}
.ag-s1{background:#FFC94D;}.ag-s2{background:#7FA8FF;}.ag-s3{background:#9DE0B4;}
.ag-ct{font-size:12px;color:#8C8C9E;}
.ag-roster{--tc:#46E08B;border-radius:18px;padding:14px;background:#15151F;border:1px solid rgba(255,255,255,.14);position:relative;margin-bottom:12px;}
.ag-rtop{display:flex;align-items:center;gap:13px;}
.ag-portrait{width:54px;height:54px;border-radius:16px;flex:0 0 auto;position:relative;background:radial-gradient(circle at 38% 32%,color-mix(in srgb,var(--tc) 55%,#fff),var(--tc) 60%,color-mix(in srgb,var(--tc) 50%,#000));box-shadow:0 0 24px color-mix(in srgb,var(--tc) 45%,transparent);}
.ag-portrait img{width:100%;height:100%;border-radius:16px;object-fit:cover;}
.ag-seal{position:absolute;bottom:-6px;right:-6px;font-size:9px;font-weight:900;color:#06140C;background:#FFC94D;padding:3px 7px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.ag-rmid{flex:1;min-width:0;}
.ag-rname{font-size:16px;font-weight:900;}
.ag-rsub{font-size:11.5px;color:#8C8C9E;margin-top:2px;}
.ag-rcheer{display:flex;align-items:center;gap:4px;font-size:12px;font-weight:800;color:#FB6F92;flex:0 0 auto;}
.ag-rcheer i{font-size:14px;}
.ag-alert{display:flex;align-items:center;gap:7px;margin-top:12px;padding:9px 11px;border-radius:11px;background:rgba(255,201,77,.12);border:1px solid rgba(255,201,77,.3);font-size:12px;font-weight:700;color:#FFE39A;}
.ag-alert .dot{width:7px;height:7px;border-radius:50%;background:#FFC94D;flex:0 0 auto;}
.ag-cascade{margin-top:13px;padding-left:14px;position:relative;}
.ag-cascade::before{content:"";position:absolute;left:3px;top:-2px;bottom:14px;width:2px;background:linear-gradient(180deg,color-mix(in srgb,var(--tc) 60%,transparent),transparent);}
.ag-cazlab{font-size:10.5px;color:#8C8C9E;font-weight:700;margin-bottom:9px;}
.ag-cazlab b{color:var(--tc);}
.ag-songrow{display:flex;gap:9px;overflow-x:auto;margin:0 -14px;padding:0 14px 4px;scrollbar-width:none;}
.ag-songrow::-webkit-scrollbar{display:none;}
.ag-scard{--tc:#46E08B;flex:0 0 108px;border-radius:13px;padding:3px;cursor:pointer;background:linear-gradient(150deg,color-mix(in srgb,var(--tc) 58%,#fff),var(--tc) 42%,color-mix(in srgb,var(--tc) 50%,#000));}
.ag-scin{background:linear-gradient(180deg,#101019,#0B0B12);border-radius:10px;padding:8px;position:relative;overflow:hidden;}
.ag-sart{height:54px;border-radius:8px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 100% at 50% 25%,color-mix(in srgb,var(--tc) 40%,transparent),#0c0c14 60%);}
.ag-sorb{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 38% 32%,color-mix(in srgb,var(--tc) 60%,#fff),var(--tc) 60%);box-shadow:0 0 14px color-mix(in srgb,var(--tc) 55%,transparent);}
.ag-sholo{position:absolute;inset:0;mix-blend-mode:color-dodge;opacity:.5;background:repeating-linear-gradient(108deg,rgba(255,40,140,.6),rgba(255,196,0,.55) 8%,rgba(40,255,170,.55) 16%,rgba(40,170,255,.6) 24%,rgba(180,40,255,.6) 32%);background-size:220% 220%;animation:agFoil 6s linear infinite;}
@keyframes agFoil{0%{background-position:0 0}100%{background-position:220% 220%}}
.ag-sn{font-size:11.5px;font-weight:800;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ag-sstg{font-size:9.5px;font-weight:800;color:var(--tc);margin-top:2px;}
.ag-sstg.holo{color:#FFC94D;}
.ag-watch{display:flex;align-items:center;gap:12px;padding:11px;border-radius:14px;background:#15151F;border:1px solid rgba(255,255,255,.08);margin-bottom:9px;}
.ag-wp{width:42px;height:42px;border-radius:12px;flex:0 0 auto;}
.ag-wmid{flex:1;min-width:0;}
.ag-wname{font-size:14px;font-weight:800;}
.ag-wsub{font-size:11px;color:#8C8C9E;margin-top:2px;}
.ag-signbtn{flex:0 0 auto;font-family:inherit;font-size:12px;font-weight:800;color:#06140C;cursor:pointer;background:#FFC94D;border:none;padding:9px 13px;border-radius:11px;display:flex;align-items:center;gap:5px;}
.ag-signbtn i{font-size:14px;}
.ag-cab{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;}
.ag-cabcard{--tc:#5AA9FF;border-radius:12px;padding:3px;cursor:pointer;background:linear-gradient(150deg,color-mix(in srgb,var(--tc) 55%,#fff),var(--tc) 42%,color-mix(in srgb,var(--tc) 50%,#000));}
.ag-cabin{background:linear-gradient(180deg,#101019,#0B0B12);border-radius:9px;padding:6px;overflow:hidden;}
.ag-cabart{height:46px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 100% at 50% 25%,color-mix(in srgb,var(--tc) 38%,transparent),#0c0c14 60%);}
.ag-caborb{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 38% 32%,color-mix(in srgb,var(--tc) 60%,#fff),var(--tc) 60%);box-shadow:0 0 12px color-mix(in srgb,var(--tc) 50%,transparent);}
.ag-cabn{font-size:10.5px;font-weight:800;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ag-cabs{font-size:9px;color:#8C8C9E;margin-top:1px;}
.ag-empty{font-size:12px;color:#5A5A6C;padding:12px 2px;text-align:center;}
@media(min-width:769px){.ag-inner{max-width:470px;}}
</style>`;
}

// 계정 프로필(청취자 디자인) 스코프 CSS — <style> 자체 포함. (현재 미사용 — '내 기획사' 디자인으로 대체)
function _apStyle() {
  return `<style id="ap-style">
.ap-page{position:relative;min-height:100%;padding:48px 0 calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 28px);background:#0B0B11;color:#F4F4F7;font-family:'Pretendard',sans-serif;overflow-x:hidden;}
.ap-page *{box-sizing:border-box;}
.ap-inner{position:relative;z-index:1;padding:0 16px;max-width:430px;margin:0 auto;}
.ap-id{display:flex;align-items:center;gap:11px;margin-bottom:18px;}
.ap-id-av{width:46px;height:46px;border-radius:50%;padding:2px;background:linear-gradient(135deg,#48E08B,#FB6F92);flex:0 0 auto;}
.ap-id-av img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}
.ap-id-tx{flex:1;min-width:0;}
.ap-id-nm{font-size:16px;font-weight:800;}
.ap-id-sub{font-size:11.5px;color:#8B8B9A;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ap-id-set{width:34px;height:34px;border-radius:50%;background:#15151F;border:1px solid rgba(255,255,255,.08);color:#8B8B9A;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;flex:0 0 auto;}
.ap-lab{font-size:12px;color:#8B8B9A;font-weight:600;margin:2px 2px 9px;}
.ap-chips{display:flex;gap:7px;overflow-x:auto;padding:0 16px 4px;margin:0 -16px;scrollbar-width:none;}
.ap-chips::-webkit-scrollbar{display:none;}
.ap-chip{flex:0 0 auto;font-size:13px;font-weight:600;color:#8B8B9A;background:#15151F;border:1px solid rgba(255,255,255,.07);padding:7px 13px;border-radius:999px;white-space:nowrap;cursor:pointer;}
.ap-chip.on{color:#F4F4F7;background:rgba(139,124,246,.16);border-color:rgba(139,124,246,.5);}
.ap-slab{display:flex;align-items:center;justify-content:space-between;margin:22px 2px 11px;}
.ap-slab h2{font-size:15px;font-weight:800;display:flex;align-items:center;gap:7px;margin:0;}
.ap-live{font-size:10px;font-weight:800;color:#48E08B;background:rgba(72,224,139,.13);padding:3px 8px;border-radius:999px;}
.ap-hero{position:relative;border-radius:22px;padding:20px 18px 18px;overflow:hidden;background:radial-gradient(120% 90% at 50% -10%,rgba(72,224,139,.22),transparent 60%),#15151F;border:1px solid rgba(72,224,139,.22);}
.ap-orbwrap{display:flex;justify-content:center;margin:4px 0 14px;}
.ap-orb{width:108px;height:108px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:radial-gradient(circle at 38% 32%,#7DF7AE,#36C977 60%,#1f9a57);box-shadow:0 0 40px rgba(72,224,139,.5),inset 0 -8px 22px rgba(0,0,0,.25);color:#06140C;font-size:33px;}
.ap-orb:active{transform:scale(.96);}
.ap-hmeta{text-align:center;margin-bottom:14px;}
.ap-hmeta .who{font-size:12.5px;color:#8B8B9A;font-weight:600;}
.ap-hmeta .ti{font-size:21px;font-weight:800;margin-top:2px;}
.ap-evo{margin:4px 4px 6px;}
.ap-evo-track{display:flex;align-items:center;}
.ap-evo-node{width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;}
.ap-evo-node.done{background:linear-gradient(135deg,#7DF7AE,#36C977);color:#06140C;}
.ap-evo-node.done i{font-size:12px;}
.ap-evo-node.now{background:#0B0B11;border:2px solid #48E08B;color:#48E08B;box-shadow:0 0 10px rgba(72,224,139,.5);}
.ap-evo-node.lock{background:#15151F;border:1.5px dashed rgba(255,255,255,.18);color:#5E5E6E;}
.ap-evo-node.lock i{font-size:10px;}
.ap-evo-seg{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.08);margin:0 3px;}
.ap-evo-seg.fill{background:linear-gradient(90deg,#36C977,#48E08B);}
.ap-evo-lab{display:flex;justify-content:space-between;margin-top:9px;}
.ap-evo-lab span{font-size:10px;color:#5E5E6E;font-weight:600;flex:1;text-align:center;}
.ap-evo-lab span:first-child{text-align:left;}.ap-evo-lab span:last-child{text-align:right;}
.ap-evo-go{text-align:center;font-size:12.5px;font-weight:700;color:#48E08B;margin-top:10px;}
.ap-supp{display:flex;align-items:center;justify-content:center;gap:9px;margin:14px 0 15px;}
.ap-avs{display:flex;}
.ap-avs span{width:25px;height:25px;border-radius:50%;border:2px solid #15151F;margin-left:-8px;font-size:10px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;}
.ap-avs span:first-child{margin-left:0;}
.ap-supp .cnt{font-size:12.5px;color:#8B8B9A;font-weight:600;}
.ap-supp .cnt b{color:#F4F4F7;}
.ap-acts{display:flex;gap:9px;}
.ap-btn{flex:1;border:none;border-radius:14px;padding:13px;font-size:14.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;font-family:inherit;}
.ap-btn.play{background:#fff;color:#0B0B11;}
.ap-btn.cheer{background:rgba(251,111,146,.15);color:#FB6F92;border:1px solid rgba(251,111,146,.45);}
.ap-btn:active{transform:scale(.98);}
.ap-benefit{text-align:center;font-size:11.5px;color:#8B8B9A;margin-top:11px;}
.ap-shelf{display:flex;gap:11px;overflow-x:auto;margin:0 -16px;padding:0 16px 4px;scrollbar-width:none;}
.ap-shelf::-webkit-scrollbar{display:none;}
.ap-rcard{flex:0 0 116px;background:#15151F;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:13px 12px 12px;position:relative;cursor:pointer;}
.ap-ring{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 9px;}
.ap-ring i{width:44px;height:44px;border-radius:50%;background:#15151F;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-style:normal;}
.ap-rn{font-size:12.5px;font-weight:700;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ap-rs{font-size:10.5px;color:#8B8B9A;text-align:center;margin-top:2px;}
.ap-badge{position:absolute;top:8px;right:8px;font-size:9px;font-weight:800;color:#06140C;background:#48E08B;padding:2px 6px;border-radius:999px;}
.ap-empty{font-size:12px;color:#5E5E6E;padding:8px 2px;}
.ap-feed{margin-top:2px;}
.ap-frow{display:flex;align-items:center;gap:12px;padding:11px 2px;border-top:1px solid rgba(255,255,255,.06);cursor:pointer;}
.ap-frow:first-child{border-top:none;}
.ap-thumb{width:48px;height:48px;border-radius:13px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:rgba(0,0,0,.55);font-size:18px;}
.ap-finfo{flex:1;min-width:0;}
.ap-ft{font-size:14px;font-weight:700;display:flex;align-items:center;gap:7px;}
.ap-ft .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ap-stg{font-size:10px;font-weight:800;color:#FBBF24;background:rgba(251,191,36,.14);padding:2px 7px;border-radius:999px;flex:0 0 auto;}
.ap-fw{font-size:12px;color:#8B8B9A;margin-top:3px;}
.ap-ftags{font-size:11px;color:#5E5E6E;margin-top:3px;}
.ap-flike{display:flex;flex-direction:column;align-items:center;gap:2px;color:#FB6F92;font-size:11px;font-weight:700;flex:0 0 auto;}
.ap-flike i{font-size:18px;}
@media(min-width:769px){.ap-inner{max-width:460px;}}
</style>`;
}

async function renderProfile() {
  try {
    return await _renderProfileImpl();
  } catch (err) {
    console.error('[renderProfile] fatal', err);
    appContent.innerHTML = `
      <div style="max-width:600px; margin:60px auto; padding:24px; background:#3a1010; color:#ff8080; border:1px solid #6b1818; border-radius:8px;">
        <h2 style="margin-top:0;">⚠️ 프로필을 불러오지 못했어요</h2>
        <pre style="white-space:pre-wrap; word-break:break-word; font-size:12px; color:#ffb0b0; background:#2a0808; padding:12px; border-radius:6px; max-height:240px; overflow:auto;">${(err && (err.stack || err.message || String(err))).replace(/</g,'&lt;')}</pre>
        <button class="btn-primary" onclick="navigateTo('shapes')" style="margin-top:12px;">홈으로</button>
      </div>
    `;
  }
}

async function _renderProfileImpl() {
  const db = window.DB.get();
  if (!db || !db.currentUser) {
    navigateTo('auth');
    return;
  }
  // Pre-fetch listener data (followed artists, bookmarked notes, playlists)
  let followedArtists = [];
  let bookmarkedNotes = [];
  let myPlaylists = [];
  try {
    if (window.Follows && window.Follows.fetchMyArtists) followedArtists = await window.Follows.fetchMyArtists();
  } catch (e) { console.warn('[profile] followed', e); }
  // Merge localStorage mock follows (onboarding picks) — these don't have Supabase IDs
  try {
    const mock = (typeof window._getMockFollows === 'function') ? window._getMockFollows() : [];
    if (Array.isArray(mock) && mock.length > 0) {
      const existingNames = new Set((followedArtists || []).map(a => a.name));
      mock.forEach(m => { if (!existingNames.has(m.name)) followedArtists.push(m); });
    }
  } catch (e) { console.warn('[profile] mock follows', e); }
  try {
    if (window.Walls && window.Walls.fetchMyBookmarks) bookmarkedNotes = await window.Walls.fetchMyBookmarks();
  } catch (e) { console.warn('[profile] bookmarks', e); }
  try {
    if (window.Playlists && window.Playlists.fetchMine) myPlaylists = await window.Playlists.fetchMine();
  } catch (e) { console.warn('[profile] playlists', e); }
  // Cheers I've sent — drives the 세모(응원하는곡) tab
  let mySentCheers = [];
  try {
    if (window.Cheers && window.Cheers.fetchMySent) mySentCheers = await window.Cheers.fetchMySent();
  } catch (e) { console.warn('[profile] cheers', e); }

  // Defensive defaults — never crash if db arrays are missing
  if (!Array.isArray(followedArtists)) followedArtists = [];
  if (!Array.isArray(bookmarkedNotes)) bookmarkedNotes = [];
  if (!Array.isArray(myPlaylists)) myPlaylists = [];
  if (!Array.isArray(mySentCheers)) mySentCheers = [];

  const allTracks = Array.isArray(db.tracks) ? db.tracks : [];
  const allNotes = Array.isArray(db.notes) ? db.notes : [];
  const userTracks = allTracks.filter(t => t && t.artist === db.currentUser.name);
  const userNotes = allNotes.filter(n => n && n.author === db.currentUser.name);
  const sns = db.currentUser.sns || {};
  const snsHtml = generateSnsLinks(sns);

  // Group user's tracks by projectId
  const projects = {};
  userTracks.forEach(t => {
    const pid = t.projectId || 'proj_' + t.id;
    if (!projects[pid]) projects[pid] = [];
    projects[pid].push(t);
  });
  // My sticky notes strip
  let notesHtml = '';
  if (userNotes.length > 0) {
    notesHtml = userNotes.map(note => {
      const c = NOTE_COLORS[note.color] || NOTE_COLORS.yellow;
      const rot = note.rotation || (Math.random() * 6 - 3);
      const safeText = (note.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      return `<div class="artist-note" style="background:${c.bg}; color:${c.text}; --rot:${rot}deg;" onclick="openNoteDetail('${note.id}')"><div class="note-body">${safeText}</div></div>`;
    }).join('');
  }

  // Project boxes (demo on top, master on bottom)
  let projectsHtml = '';
  Object.entries(projects).forEach(([pid, versions]) => {
    projectsHtml += renderProjectBox(pid, versions);
  });

  // Pre-compute myBackings here (used in header KPIs + later STO section)
  const myBackings = (typeof window._getMyBackings === 'function') ? window._getMyBackings() : [];

  // ===== 내 계정 — 깔끔 버전 (나 + 응원한 곡(데모 성장) + 팔로우한 아티스트) — 2026-06-25 =====
  // 마이페이지(아티스트 홈)와 별개. 계약/기획사 메타포 제거, 핵심만. 곡 행 → 곡 상세(song:).
  {
    const maEsc = (s) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const MA_COLORS = ['#8B7CF6','#FB6F92','#46E08B','#54E0CE','#FFC94D','#5AA9FF','#B06BFF','#FF9F45'];
    const maColor = (s) => MA_COLORS[(_hashSeed(s || 'x') >>> 0) % MA_COLORS.length];
    const maClean = (s) => (s || '무제').replace(/\s*\(.*\)$/, '');
    const maTitle = (raw, artist) => { const ti = maClean(raw); return (ti === '무제' || /^demo\s*\d*$/i.test(ti)) ? (artist || ti) : ti; };
    const maMe = db.currentUser;
    const maAvatar = maMe.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(maMe.name || 'user'));

    const maProjMap = {};
    allTracks.forEach(t => { if (!t) return; const pid = t.projectId || ('proj_' + t.id); (maProjMap[pid] = maProjMap[pid] || []).push(t); });
    const maProjOf = (track) => {
      const pid = track.projectId || ('proj_' + track.id);
      const vs = (maProjMap[pid] || [track]).slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      const demos = vs.filter(v => v && v.isDemo);
      const hasFinal = vs.some(v => v && !v.isDemo && v.version === 'final');
      const rep = vs.find(v => v && !v.isDemo) || vs[vs.length - 1] || vs[0];
      return { demoCount: demos.length, hasFinal, rep: rep || track };
    };

    // 응원한 곡 + 데모 성장 정보 (응원 후 얼마나 자랐나 = 같이 기뻐할 거리)
    const supported = mySentCheers.map(c => {
      const t = allTracks.find(x => x && x.id === (c && c.track_id));
      const artist = (c && (c.artist_name || c.artist)) || (t && t.artist) || '';
      const title = maTitle((c && (c.track_title || c.title)) || (t && t.title), artist);
      const cheerAt = new Date((c && c.created_at) || 0).getTime();
      let demoCount = 1, hasFinal = false, repId = (c && c.track_id) || '', grew = 0;
      if (t) {
        const pid = t.projectId || ('proj_' + t.id);
        const vs = (maProjMap[pid] || [t]).slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        const demos = vs.filter(v => v && v.isDemo);
        demoCount = demos.length || 1;
        hasFinal = vs.some(v => v && !v.isDemo && v.version === 'final');
        repId = ((vs.find(v => v && !v.isDemo) || demos[demos.length - 1] || t)).id;
        if (cheerAt) grew = vs.filter(v => new Date(v.createdAt || 0).getTime() > cheerAt).length;
      }
      return { title, artist, demoCount, hasFinal, repId, grew, color: maColor(title) };
    });
    const celebrated = supported.filter(s => s.hasFinal);   // 발매 = 함께 이룬 것
    const growing = supported.filter(s => !s.hasFinal);     // 자라는 중

    // 덕질 시작일
    const cheerTimes = mySentCheers.map(c => new Date((c && c.created_at) || 0).getTime()).filter(n => n > 0);
    let sinceLabel = '';
    if (cheerTimes.length) { const d = new Date(Math.min(...cheerTimes)); sinceLabel = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0'); }

    // 🎉 함께 이룬 발매 (데모 때부터 응원한 곡이 발매됨)
    const celebHtml = celebrated.map(s => `<div class="ma-celeb" onclick="navigateTo('song:${s.repId}')">
      <div class="ma-celeb-orb" style="background:linear-gradient(135deg,${s.color},#FFC94D)">🎉</div>
      <div class="ma-celeb-tx"><div class="ma-celeb-t">${maEsc(s.title)}</div><div class="ma-celeb-s">${_t('발매 완료 — 데모 때부터 응원했어요!','Released — you cheered since the demo!')}</div></div>
      <i class="ri-arrow-right-s-line"></i>
    </div>`).join('');

    // 🃏 내 바인더 (응원한 곡 = 모은 카드. 발매 = 홀로 카드. 진화는 카드 누르면 곡 상세에서)
    const binderCards = supported.length ? supported.map(s => {
      const holo = s.hasFinal;
      return `<div class="ma-card${holo ? ' holo' : ''}" style="--cc:${holo ? '#FFC94D' : s.color}" onclick="navigateTo('song:${s.repId}')">
        <div class="ma-card-in"><div class="ma-card-art"><span class="ma-card-orb"></span>${holo ? '<span class="ma-card-foil"></span>' : ''}</div>
        <div class="ma-card-n">${maEsc(s.title)}</div><div class="ma-card-s">${holo ? '★ ' + _t('발매','Out') : '데모 ' + s.demoCount}</div></div>
      </div>`;
    }).join('') : `<div class="ma-empty">${_t('응원해서 첫 카드를 모아보세요 🃏','Cheer a song to collect your first card 🃏')}</div>`;

    // 💜 내 아티스트 (팔로우)
    const folCards = followedArtists.length ? followedArtists.map(a => {
      const nm = (a && a.name) || '';
      const av = (a && a.avatar) || ('https://i.pravatar.cc/100?u=' + encodeURIComponent(nm));
      return `<div class="ma-artist" onclick="navigateTo('artist:${encodeURIComponent(nm)}')"><img class="ma-aav" src="${maEsc(av)}" alt=""><div class="ma-an">${maEsc(nm)}</div></div>`;
    }).join('') : `<div class="ma-empty">${_t('관심 아티스트를 팔로우해보세요','Follow artists you like')}</div>`;

    // 🔥 모을 카드 = 취향 기반 추천 (응원·팔로우한 장르/태그/아티스트 점수화). 폴백=팔로우 아티스트 데모.
    const cheeredTrackIds = new Set(mySentCheers.map(c => c && c.track_id).filter(Boolean));
    let newDemos = [];
    try {
      newDemos = window.recommendDemos(allTracks, mySentCheers, followedArtists, { limit: 6, myName: (maMe && maMe.name) || null });
    } catch (e) { console.warn('[profile] recommend', e); }
    if (!newDemos.length) {
      const followedNameSet = new Set(followedArtists.map(a => a && a.name).filter(Boolean));
      const newSeen = {};
      newDemos = allTracks
        .filter(t => t && t.isDemo && followedNameSet.has(t.artist))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .filter(t => { const pid = t.projectId || ('proj_' + t.id); if (newSeen[pid]) return false; newSeen[pid] = 1; return true; })
        .slice(0, 6);
    }
    const collectCards = newDemos.map(t => {
      const ti = maTitle(t.title, t.artist);
      const p = maProjOf(t);
      const already = cheeredTrackIds.has(t.id);
      return `<div class="ma-card" style="--cc:${genreColorOf(t)}" onclick="navigateTo('song:${t.id}')">
        <div class="ma-card-in"><div class="ma-card-art"><span class="ma-card-orb"></span></div>
        <div class="ma-card-n">${maEsc(ti)}</div><div class="ma-card-s" style="color:${already ? '#9DE0B4' : '#FB6F92'}">${already ? '🌱 ' + _t('응원 중','Cheering') : '💗 ' + _t('응원','Cheer')}</div></div>
      </div>`;
    }).join('');

    const headSub = (followedArtists.length ? `🌱 ${followedArtists.length}${_t('명과 함께 자라는 중','artists growing with you')}` : `🌱 ${_t('아티스트의 성장을 함께해요','Grow together with artists')}`)
      + (sinceLabel ? ` · ${_t('덕질','Fan since')} ${sinceLabel}${_t('부터','')}` : '');

    appContent.innerHTML = `<style id="ma-style">
.ma-page{position:relative;min-height:100vh;min-height:100dvh;padding:46px 0 calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 28px);background:#0B0B12;color:#F4F4F7;font-family:'Pretendard',sans-serif;overflow-x:hidden;}
.ma-page *{box-sizing:border-box;}
.ma-inner{padding:0 18px;max-width:440px;margin:0 auto;}
.ma-head{display:flex;align-items:center;gap:13px;padding:6px 2px 4px;}
.ma-av{width:58px;height:58px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.1);flex:0 0 auto;}
.ma-info{flex:1;min-width:0;}
.ma-nm{font-size:19px;font-weight:800;}
.ma-sub{font-size:12px;color:#9DE0B4;margin-top:3px;font-weight:600;}
.ma-set{width:36px;height:36px;border-radius:50%;background:#17171F;border:1px solid rgba(255,255,255,.08);color:#8B8B9A;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;flex:0 0 auto;}
.ma-sec{margin-top:24px;}
.ma-sec-t{font-size:14px;font-weight:800;display:flex;align-items:center;gap:7px;margin:0 0 12px 2px;}
.ma-sec-t .ct{font-size:12px;font-weight:600;color:#8B8B9A;margin-left:auto;}
.ma-celeb{display:flex;align-items:center;gap:13px;padding:13px;border-radius:16px;cursor:pointer;background:linear-gradient(120deg,rgba(255,201,77,.16),rgba(251,111,146,.12)),#15151E;border:1px solid rgba(255,201,77,.32);margin-bottom:9px;}
.ma-celeb-orb{width:44px;height:44px;border-radius:13px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:21px;box-shadow:0 0 18px rgba(255,201,77,.4);}
.ma-celeb-tx{flex:1;min-width:0;}
.ma-celeb-t{font-size:14.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ma-celeb-s{font-size:11.5px;color:#FFE39A;margin-top:2px;}
.ma-celeb i{color:#8B8B9A;font-size:20px;flex:0 0 auto;}
.ma-list{display:flex;flex-direction:column;gap:9px;}
.ma-row{display:flex;align-items:center;gap:13px;padding:11px;border-radius:15px;background:#15151E;border:1px solid rgba(255,255,255,.06);cursor:pointer;}
.ma-cover{width:46px;height:46px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#0b0b12;font-weight:800;font-size:13px;overflow:hidden;}
.ma-cover img{width:100%;height:100%;object-fit:cover;}
.ma-rmid{flex:1;min-width:0;}
.ma-rt{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ma-rby{font-size:11px;color:#8B8B9A;font-weight:600;}
.ma-rnote{font-size:11px;color:#9DE0B4;font-weight:600;margin-top:3px;}
.ma-bar{height:4px;border-radius:4px;background:rgba(255,255,255,.08);margin-top:7px;overflow:hidden;}
.ma-bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#8B7CF6,#FB6F92);}
.ma-stage{flex:0 0 auto;font-size:11px;font-weight:800;color:#C9C4F5;text-align:right;}
.ma-stage span{color:#5A5A6C;font-weight:600;}
.ma-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.ma-card{--cc:#8B7CF6;border-radius:13px;padding:3px;cursor:pointer;background:linear-gradient(150deg,color-mix(in srgb,var(--cc) 58%,#fff),var(--cc) 42%,color-mix(in srgb,var(--cc) 50%,#000));}
.ma-card:active{transform:scale(.97);}
.ma-card-in{background:linear-gradient(180deg,#101019,#0B0B12);border-radius:10px;padding:7px;overflow:hidden;}
.ma-card-art{height:60px;border-radius:8px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 100% at 50% 25%,color-mix(in srgb,var(--cc) 40%,transparent),#0c0c14 60%);}
.ma-card-orb{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 38% 32%,color-mix(in srgb,var(--cc) 60%,#fff),var(--cc) 60%);box-shadow:0 0 14px color-mix(in srgb,var(--cc) 55%,transparent);}
.ma-card-foil{position:absolute;inset:0;mix-blend-mode:color-dodge;opacity:.5;background:repeating-linear-gradient(108deg,rgba(255,40,140,.6),rgba(255,196,0,.55) 8%,rgba(40,255,170,.55) 16%,rgba(40,170,255,.6) 24%,rgba(180,40,255,.6) 32%);background-size:220% 220%;animation:maFoil 7s linear infinite;}
@keyframes maFoil{0%{background-position:0 0}100%{background-position:220% 220%}}
.ma-card-n{font-size:11.5px;font-weight:800;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ma-card-s{font-size:10px;font-weight:800;color:var(--cc);margin-top:2px;}
.ma-card.holo .ma-card-s{color:#FFC94D;}
@media (prefers-reduced-motion:reduce){.ma-card-foil{animation:none;}}
.ma-artists{display:flex;flex-wrap:wrap;gap:16px 12px;padding-bottom:4px;}
.ma-artist{display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer;flex:0 0 auto;width:68px;}
.ma-aav{width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.1);}
.ma-an{font-size:11.5px;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68px;}
.ma-empty{font-size:12.5px;color:#7A7A8C;padding:16px;text-align:center;background:#15151E;border:1px solid rgba(255,255,255,.05);border-radius:14px;line-height:1.5;}
@media(min-width:769px){.ma-inner{max-width:470px;}}
</style>
      <div class="ma-page"><div class="ma-inner">
        <div class="ma-head">
          <img class="ma-av" src="${maEsc(maAvatar)}" alt="">
          <div class="ma-info"><div class="ma-nm">${maEsc(maMe.name || '')}</div><div class="ma-sub">${headSub}</div></div>
          <button class="ma-set" onclick="editProfile()" aria-label="${_t('설정','Settings')}"><i class="ri-settings-3-line"></i></button>
        </div>
        <div class="ma-sec">
          <div class="ma-sec-t"><i class="ri-folder-music-fill" style="color:#8B7CF6"></i> ${_t('내 바인더','My binder')} <span class="ct">${supported.length}${_t('장','')}</span></div>
          <div class="ma-grid">${binderCards}</div>
        </div>
        ${collectCards ? `<div class="ma-sec">
          <div class="ma-sec-t"><i class="ri-add-circle-fill" style="color:#FB6F92"></i> ${_t('모을 카드','Cards to collect')} <span class="ct">✨ ${_t('취향 추천','For you')}</span></div>
          <div class="ma-grid">${collectCards}</div>
        </div>` : ''}
        <div class="ma-sec">
          <div class="ma-sec-t"><i class="ri-user-heart-fill" style="color:#FB6F92"></i> ${_t('내 아티스트','My artists')} <span class="ct">${followedArtists.length}</span></div>
          <div class="ma-artists">${folCards}</div>
        </div>
      </div></div>`;
    return;
  }

  // Own notes grid — show all
  const notesGridHtml = userNotes.map((n, i) => {
    const col = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
    const rot = n.rotation || ((i % 2 === 0 ? -1 : 1) * (Math.random() * 3 + 0.5));
    const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    return `
      <div class="artist-postit" style="background:${col.bg}; color:${col.text}; --rot:${rot}deg;" onclick="openNoteDetail('${n.id}')">
        <div class="artist-postit-body">${safeTxt}</div>
      </div>
    `;
  }).join('');

  // Determine role: artist (admin/artist/student) vs listener (default).
  // /me is now a unified personal page — same content for everyone (no
  // artist-vs-listener split). Anything that's specifically artist-y
  // (uploads, track list with project boxes) lives on /artist:<myname>.
  const role = db.currentUser.role;
  const naturalIsArtist = role === 'admin' || role === 'artist' || role === 'student';
  const isArtist = false;
  const roleLabel = role === 'admin' ? '관리자' : (naturalIsArtist ? '아티스트' : '리스너');

  // === Build section blocks as variables, then compose by role order ===

  // 🎤 헤더 strip
  const safeAvatar = db.currentUser.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(db.currentUser.name || 'user'));
  const safeName = (db.currentUser.name || '이름 없음').replace(/</g,'&lt;');
  // Compute earned SPO (received backings on my own demos)
  const earnedKrw = (() => {
    let sum = 0;
    userTracks.filter(t => t && t.isDemo).forEach(t => {
      const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(t) : null;
      if (cfg && cfg.raisedKrw) sum += cfg.raisedKrw;
    });
    return sum;
  })();
  const fmtEarned = (n) => n >= 10000 ? `${Math.floor(n/10000)}만원` : `${n.toLocaleString()}원`;

  const headerSection = isArtist ? `
    <div class="artist-strip reveal">
      <div class="artist-id">
        <img src="${safeAvatar}" class="artist-avatar">
        <div class="artist-id-text">
          <h1>${safeName}</h1>
          <div class="artist-stats" style="margin-top:6px;">
            <span>${Object.keys(projects).length} 프로젝트</span>
            <span class="stat-dot">·</span>
            <span>${userNotes.length} 포스트잇</span>
          </div>
          <button class="btn-primary" onclick="editProfile()" style="margin-top:10px; padding:6px 16px; font-size:12px;"><i class="ri-settings-4-line"></i> 설정</button>
        </div>
      </div>
    </div>
    <!-- 후원/SPO KPI 박스 — 임시 숨김 (사용자 요청) -->
  ` : `
    <!-- Listener: Y2K bubble title + small settings affordance -->
    <div class="reveal listener-mini-header">
      <div class="listener-y2k-title">
        <span class="y2k-title-main">My<span class="y2k-title-dot">.</span>Page</span>
        <span class="y2k-title-sub">🎧 ${safeName}</span>
      </div>
      <button class="listener-settings-btn" onclick="editProfile()" aria-label="설정"><i class="ri-settings-4-line"></i></button>
    </div>
  `;

  // 📝 내 포스트잇 (작성한 것)
  const myNotesSection = userNotes.length > 0 ? `
    <div class="reveal artist-postit-section" style="margin-top:36px;">
      <h2 class="section-title"><i class="ri-sticky-note-fill"></i> 내 포스트잇 <span class="section-count">${userNotes.length}</span></h2>
      <div class="artist-postit-grid">
        ${notesGridHtml}
      </div>
    </div>
  ` : '';

  // 🎵 my music — split into 청취곡 (master) + 데모곡 (demo) for artist
  // Group projects by released vs demo-only
  const myReleasedProjects = {};
  const myDemoOnlyProjects = {};
  Object.entries(projects).forEach(([pid, versions]) => {
    const hasMaster = versions.some(v => !v.isDemo);
    if (hasMaster) myReleasedProjects[pid] = versions;
    else myDemoOnlyProjects[pid] = versions;
  });
  let myReleasedHtml = '';
  Object.entries(myReleasedProjects).forEach(([pid, versions]) => {
    myReleasedHtml += renderProjectBox(pid, versions);
  });
  let myDemoHtml = '';
  Object.entries(myDemoOnlyProjects).forEach(([pid, versions]) => {
    myDemoHtml += renderProjectBox(pid, versions);
  });
  const myReleasedCount = Object.keys(myReleasedProjects).length;
  const myDemoCount = Object.keys(myDemoOnlyProjects).length;

  // Action grid — every user can upload, write diary, manage SPO
  const myDemoCountForActions = userTracks.filter(t => t && t.isDemo).length;
  const totalRaisedForArtist = (() => {
    const myTrackIds = new Set(userTracks.filter(t => t && t.isDemo).map(t => t.id));
    let sum = 0;
    try {
      const list = JSON.parse(localStorage.getItem('offstage_my_backings') || '[]') || [];
      list.forEach(b => { if (myTrackIds.has(b.trackId)) sum += Number(b.amount) || 0; });
    } catch (_) {}
    userTracks.filter(t => t && t.isDemo).forEach(t => {
      const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(t) : null;
      if (cfg && cfg.raisedKrw) sum += cfg.raisedKrw;
    });
    return sum;
  })();
  const fmtMoneyShort = (n) => n >= 10000 ? `${Math.floor(n/10000)}만` : `${n.toLocaleString()}`;

  const uploadCard = `
    <div class="reveal artist-actions-grid">
      <div class="artist-action-card upload-action" onclick="navigateTo('upload')">
        <div class="artist-action-icon"><i class="ri-upload-cloud-2-fill"></i></div>
        <div class="artist-action-title">${_i18n('새 음악 올리기', 'Upload music')}</div>
        <div class="artist-action-sub">${_i18n('데모 / 마스터', 'Demo / Master')}</div>
      </div>
      <div class="artist-action-card diary-action" onclick="openArtistDiary()">
        <div class="artist-action-icon"><i class="ri-quill-pen-fill"></i></div>
        <div class="artist-action-title">${_i18n('작업일지 / 미션', 'Work log / Mission')}</div>
        <div class="artist-action-sub">${_i18n('우리들의 벽에 글쓰기', 'Write on Our Wall')}</div>
      </div>
      <!-- SPO 관리 카드 임시 숨김 (사용자 요청) -->
    </div>
  `;

  // Instagram-style grid for own tracks (master / demo separated)
  const _renderIgTile = (t) => {
    const cover = t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500';
    const title = (t.title || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const isDemo = !!t.isDemo;
    return `
      <div class="ig-tile" onclick="playTrack('${t.id}')">
        <img src="${cover}" alt="${title}" loading="lazy">
        <div class="ig-tile-overlay">
          <div class="ig-tile-title">${title}</div>
          <div class="ig-tile-meta">
            <span><i class="ri-headphone-fill"></i> ${t.plays || 0}</span>
            <span><i class="ri-heart-fill"></i> ${t.likes || 0}</span>
          </div>
        </div>
        ${isDemo ? '<span class="ig-tile-tag">DEMO</span>' : '<span class="ig-tile-tag ig-tile-tag-master">MASTER</span>'}
        <button class="ig-tile-play" onclick="event.stopPropagation(); playTrack('${t.id}')" aria-label="재생">
          <i class="ri-play-fill"></i>
        </button>
      </div>
    `;
  };

  const myMasters = userTracks.filter(t => t && !t.isDemo);
  const myDemos = userTracks.filter(t => t && t.isDemo);

  const releasedSection = myMasters.length > 0 ? `
    <div class="reveal" style="margin-top:24px;">
      <h2 class="section-title section-music"><i class="ri-disc-fill" style="color:var(--brand-color);"></i> 청취곡 <span class="section-count">${myMasters.length}</span></h2>
      <div class="ig-grid">
        ${myMasters.map(_renderIgTile).join('')}
      </div>
    </div>
  ` : '';

  const demoSection = myDemos.length > 0 ? `
    <div class="reveal" style="margin-top:24px;">
      <h2 class="section-title"><i class="ri-edit-2-fill" style="color:#FF8A65;"></i> 데모곡 <span class="section-count">${myDemos.length}</span></h2>
      <div class="ig-grid">
        ${myDemos.map(_renderIgTile).join('')}
      </div>
    </div>
  ` : '';

  // me 모드에서는 절대 액션/청취곡/데모곡 안 보임 (artist studio 전용)
  const myMusicSection = isArtist ? `${uploadCard}${releasedSection}${demoSection}` : '';

  // 📊 STO 포트폴리오 — 함께 만들기 후원 내역 (myBackings already computed above)
  const totalBacked = myBackings.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  const fmtMoney = (n) => n >= 10000 ? `${(n/10000).toFixed(0)}만원` : `${n.toLocaleString()}원`;
  let stoSection;
  if (myBackings.length === 0) {
    // Empty state — show sample polaroids so listener understands what fills here
    // Sample polaroids: link to real demo tracks if they exist, so user can preview card page
    const sampleTrackIds = ['t6d1', 't8d1', 't11d1']; // 엔젤노이즈 / 루시드 베어 / 오프스테이지 demos
    const sampleHtml = sampleTrackIds.map((sid, i) => {
      const sTrack = (db.tracks || []).find(t => t && t.id === sid);
      if (!sTrack) return '';
      const safeArtist = (sTrack.artist || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      const safeTitle = (sTrack.title || '').replace(/</g,'&lt;');
      const cv = sTrack.cover || `https://i.pravatar.cc/300?u=${encodeURIComponent(sTrack.artist || sid)}`;
      const rot = ((i % 2 === 0) ? -1 : 1) * (1.5 + (i % 3));
      // Same _serial fn as polaroid.js
      let h = 0;
      for (let k = 0; k < sid.length; k++) h = ((h << 5) - h) + sid.charCodeAt(k);
      h = Math.abs(h);
      const stoNum = `1-${String(800 + (h % 200)).padStart(3,'0')}-${String(((h>>12) % 10000)).padStart(4,'0')}`;
      return `
        <div class="sto-polaroid sto-polaroid-sample" style="--rot:${rot}deg;" onclick="navigateTo('card:${sid}')">
          <div class="sto-polaroid-photo">
            <img src="${cv}" alt="" loading="lazy">
            <div class="sto-polaroid-amt">💎 예시</div>
            <div class="sto-polaroid-serial">${stoNum}</div>
          </div>
          <div class="sto-polaroid-caption">
            <div class="sto-polaroid-artist">${safeArtist}</div>
            <div class="sto-polaroid-track">「${safeTitle}」</div>
            <div class="sto-polaroid-date">SAMPLE</div>
          </div>
        </div>
      `;
    }).join('');
    stoSection = `
      <div class="reveal" style="margin-top:36px;">
        <h2 class="section-title"><i class="ri-instance-fill" style="color:#FF6B9D;"></i> 내 폴라로이드 컬렉션</h2>
        <p style="font-size:12px; color:rgba(0,0,0,0.6); font-weight:600; margin:-6px 0 14px; letter-spacing:0.2px;">데모에서 <strong>💎 함께 만들기</strong>를 누르면 폴라로이드로 모여요 — 아래는 예시</p>
        <div class="sto-polaroid-gallery">${sampleHtml}</div>
      </div>
    `;
  } else {
    // Generate Poolsuite-style serial number from track id (matches polaroid.js _stoSerial)
    const _serial = (id) => {
      let h = 0; const s = String(id || '');
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
      h = Math.abs(h);
      const a = String(800 + (h % 200)).padStart(3, '0');
      const c = String(((h >> 12) % 10000)).padStart(4, '0');
      return `1-${a}-${c}`;
    };
    // Poolsuite-style polaroid cards for each backing — STO 컬렉션 = 폴라로이드 갤러리
    const backingsHtml = myBackings.slice(0, 24).map((b, i) => {
      const safeArtist = (b.artistName || '아티스트').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      const safeTitle = (b.trackTitle || '데모').replace(/</g,'&lt;');
      const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
      const t = (db.tracks || []).find(x => x && x.id === b.trackId);
      const cover = (t && t.cover) || `https://i.pravatar.cc/300?u=${encodeURIComponent(b.artistName || 'artist')}`;
      const amt = Number(b.amount) || 0;
      const rot = ((i % 2 === 0) ? -1 : 1) * (1.5 + (i % 3));
      const trackId = (t && t.id) || b.trackId || '';
      const stoNum = _serial(b.trackId || b.id || ('b'+i));
      return `
        <div class="sto-polaroid" style="--rot:${rot}deg;" onclick="${trackId ? `navigateTo('card:${trackId}')` : ''}">
          <div class="sto-polaroid-photo">
            <img src="${cover}" alt="${safeArtist}" loading="lazy">
            <div class="sto-polaroid-play"><i class="ri-play-fill"></i></div>
            <div class="sto-polaroid-amt">💎 ${fmtMoney(amt)}</div>
            <div class="sto-polaroid-serial">${stoNum}</div>
          </div>
          <div class="sto-polaroid-caption">
            <div class="sto-polaroid-artist">${safeArtist}</div>
            <div class="sto-polaroid-track">「${safeTitle}」</div>
            <div class="sto-polaroid-date">${dateStr}</div>
          </div>
        </div>
      `;
    }).join('');
    stoSection = `
      <div class="reveal" style="margin-top:36px;">
        <h2 class="section-title"><i class="ri-instance-fill" style="color:#FF6B9D;"></i> 내 폴라로이드 컬렉션 <span class="section-count">${myBackings.length}</span></h2>
        <p style="font-size:12px; color:rgba(0,0,0,0.6); font-weight:600; margin:-6px 0 14px; letter-spacing:0.2px;">함께 만든 곡들이 폴라로이드로 모여요 · 카드 탭하면 큰 카드 + 저장/공유</p>
        <div class="sto-summary">
          <div class="sto-summary-block">
            <div class="sto-summary-label">총 함께 만든 금액</div>
            <div class="sto-summary-value">${fmtMoney(totalBacked)}</div>
          </div>
          <div class="sto-summary-block">
            <div class="sto-summary-label">참여 데모</div>
            <div class="sto-summary-value">${myBackings.length}곡</div>
          </div>
          <div class="sto-summary-block">
            <div class="sto-summary-label">아티스트</div>
            <div class="sto-summary-value">${new Set(myBackings.map(b => b.artistName)).size}명</div>
          </div>
        </div>
        <div class="sto-polaroid-gallery">${backingsHtml}</div>
        <div class="sto-mini-footer" style="margin-top:8px; opacity:0.7;">🤝 하나증권 SPO 연동 준비 중 · 모의 거래</div>
      </div>
    `;
  }

  // 🌱 함께 만드는 아티스트 — 다마고치 카드 컬렉션
  // 데이터: 스트리밍 수 + SPO 참여자 수 (현재 미연동 상태는 mock)
  // Cache for modal access
  window.__followedArtistsCache = followedArtists;
  const tamaCardsHtml = followedArtists.map(a => {
    // 데이터: 실제 스트림/SPO 카운트가 a 객체에 있으면 사용, 없으면 0
    const streams = Number(a.streamCount || a.streams || 0);
    const backers = Number(a.spoBackers || a.backers || 0);
    const stage = getTamaStage(streams, backers);
    const safeAName = (a.name || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const subLabel = a.role === 'admin' ? '관리자' : (a.role === 'artist' || a.role === 'student' ? '아티스트' : 'Collection');
    const progressPct = Math.round(stage.progress * 100);
    const formatN = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
    return `
      <div class="tama-card" data-tier="${stage.level}" style="--tama-color:${stage.color}; --tama-color-2:${stage.color2};" onclick="openTamaCardModal('${encodeURIComponent(a.name)}')">
        <div class="tama-card-shimmer"></div>
        <div class="tama-card-header">
          <span class="tama-card-level">Lv.${stage.level} ${stage.name}</span>
          <span class="tama-card-stage-emoji">${stage.emoji}</span>
        </div>
        <div class="tama-card-photo">
          <img src="${a.avatar}" alt="${safeAName}" loading="lazy">
        </div>
        <div class="tama-card-info">
          <div class="tama-card-name">${safeAName}</div>
          <div class="tama-card-sub">${subLabel}</div>
        </div>
        <div class="tama-card-stats">
          <span class="tama-stat" title="스트리밍 30%"><i class="ri-headphone-fill"></i> ${formatN(streams)}</span>
          <span class="tama-stat" title="SPO 참여자 70%"><i class="ri-shield-star-fill"></i> ${formatN(backers)}</span>
        </div>
        <div class="tama-card-progress">
          <div class="tama-card-progress-fill" style="width:${progressPct}%;"></div>
        </div>
        <div class="tama-card-next">
          ${stage.isMax
            ? `<span class="tama-next-emoji">✨</span> 최고 단계 도달`
            : `다음: <span class="tama-next-emoji">${stage.nextEmoji}</span> ${stage.nextName} (${progressPct}%)`}
        </div>
      </div>
    `;
  }).join('');

  // Sample preview cards for empty state — demonstrates the 5 stages
  const sampleArtists = [
    { name: '엔젤노이즈',    avatar: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&q=80&w=400', streamCount: 0,     spoBackers: 0,   role: 'artist' },
    { name: '루시드 베어',  avatar: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&q=80&w=400', streamCount: 12000, spoBackers: 8,   role: 'artist' },
    { name: '오프스테이지', avatar: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=400', streamCount: 80000, spoBackers: 95,  role: 'artist' }
  ];
  const renderSampleCard = (a) => {
    const stage = getTamaStage(a.streamCount, a.spoBackers);
    const safeAName = (a.name || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const subLabel = '예시 카드';
    const progressPct = Math.round(stage.progress * 100);
    const formatN = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
    const sampleArgs = `'${encodeURIComponent(a.name)}', {sample:true, avatar:'${a.avatar}', streams:${a.streamCount}, backers:${a.spoBackers}, role:'${a.role}'}`;
    return `
      <div class="tama-card tama-card-sample" data-tier="${stage.level}" style="--tama-color:${stage.color}; --tama-color-2:${stage.color2};" onclick="openTamaCardModal(${sampleArgs})">
        <div class="tama-card-shimmer"></div>
        <div class="tama-card-sample-badge">SAMPLE</div>
        <div class="tama-card-header">
          <span class="tama-card-level">Lv.${stage.level} ${stage.name}</span>
          <span class="tama-card-stage-emoji">${stage.emoji}</span>
        </div>
        <div class="tama-card-photo">
          <img src="${a.avatar}" alt="${safeAName}" loading="lazy">
        </div>
        <div class="tama-card-info">
          <div class="tama-card-name">${safeAName}</div>
          <div class="tama-card-sub">${subLabel}</div>
        </div>
        <div class="tama-card-stats">
          <span class="tama-stat" title="스트리밍 30%"><i class="ri-headphone-fill"></i> ${formatN(a.streamCount)}</span>
          <span class="tama-stat" title="SPO 참여자 70%"><i class="ri-shield-star-fill"></i> ${formatN(a.spoBackers)}</span>
        </div>
        <div class="tama-card-progress">
          <div class="tama-card-progress-fill" style="width:${progressPct}%;"></div>
        </div>
        <div class="tama-card-next">
          ${stage.isMax
            ? `<span class="tama-next-emoji">✨</span> 최고 단계 도달`
            : `다음: <span class="tama-next-emoji">${stage.nextEmoji}</span> ${stage.nextName} (${progressPct}%)`}
        </div>
      </div>
    `;
  };
  const sampleCardsHtml = sampleArtists.map(renderSampleCard).join('');

  // "함께 만드는 아티스트" (다마고치 카드 / 후원자 컬렉션) — 임시 숨김 (사용자 요청)
  // followingSection은 아래쪽에서 팔로우 리스트 그리드로 다시 선언함 (commit 35eead7).

  // 수집한 포스트잇 grid moved to 내 우주 (universe) page — no duplicate here.
  // Profile still surfaces the count in the data-gram tile (which links to /universe).
  const bookmarkedSection = '';

  // 🎵 내 음악 폴더 (Spotify-folder-style: 즐겨듣기 / 투자하고픈 / 애는 된다 + 사용자 폴더)
  const playlistTitleByName = (s) => (s || '').toLowerCase();
  const userFolderTitles = new Set((myPlaylists || []).map(p => playlistTitleByName(p.title)));

  // Default template folders (only shown if user hasn't created them yet)
  const defaultFolders = [
    { title: '즐겨듣기',     emoji: '⭐', desc: '자주 듣는 음악',           color: '#FFE082', color2: '#FFD54F' },
    { title: '투자하고픈',   emoji: '💎', desc: '함께 만들고픈 곡',         color: '#CE93D8', color2: '#BA68C8' },
    { title: '애는 된다',    emoji: '🔥', desc: '주목하는 아티스트',        color: '#FFAB91', color2: '#FF8A65' }
  ].filter(f => !userFolderTitles.has(playlistTitleByName(f.title)));

  const renderUserPlaylistCard = (p) => {
    const title = (p.title || '무제').replace(/</g,'&lt;');
    const count = (p.trackIds || []).length;
    return `
      <div class="folder-card" onclick="openMyPlaylist('${p.id}')">
        <div class="folder-card-cover-stack">
          <img src="${p.cover}" alt="${title.replace(/"/g,'&quot;')}" loading="lazy">
        </div>
        <div class="folder-card-body">
          <div class="folder-card-title">${title}</div>
          <div class="folder-card-meta">${count}곡</div>
        </div>
      </div>
    `;
  };
  const renderDefaultFolderCard = (f) => `
    <div class="folder-card folder-card-template" style="--folder-color:${f.color}; --folder-color-2:${f.color2};" onclick="createDefaultPlaylist('${f.title.replace(/'/g,"\\'")}')">
      <div class="folder-card-cover-stack folder-card-cover-template">
        <span class="folder-card-template-emoji">${f.emoji}</span>
      </div>
      <div class="folder-card-body">
        <div class="folder-card-title">${f.title}</div>
        <div class="folder-card-meta-template">${f.desc} · 만들기 +</div>
      </div>
    </div>
  `;

  const userFolderCardsHtml = (myPlaylists || []).map(renderUserPlaylistCard).join('');
  const defaultFolderCardsHtml = defaultFolders.map(renderDefaultFolderCard).join('');

  // Music folders — show default templates only when no user folders yet
  const showDefaultFolders = myPlaylists.length === 0;
  const playlistSection = (myPlaylists.length > 0 || showDefaultFolders) ? `
    <div class="reveal" style="margin-top:36px;">
      <h2 class="section-title"><i class="ri-folder-music-fill"></i> ${_i18n('내 음악 폴더', 'My music folders')}${myPlaylists.length > 0 ? ` <span class="section-count">${myPlaylists.length}</span>` : ''}</h2>
      <div class="folder-grid">
        ${userFolderCardsHtml}
        ${showDefaultFolders ? defaultFolderCardsHtml : ''}
        <div class="folder-card folder-card-new" onclick="promptNewPlaylist()">
          <div class="folder-card-cover-stack folder-card-cover-new">
            <i class="ri-add-line"></i>
          </div>
          <div class="folder-card-body">
            <div class="folder-card-title">${_t('새 폴더', 'New folder')}</div>
          </div>
        </div>
      </div>
    </div>
  ` : '';

  // (removed listener shape universe — text section titles speak for themselves)

  // === Body composition by mode ===
  // Listener (me): top support card + 4-tab layout (cards / folders / notes / data)
  // Artist (studio): full studio + collection underneath
  const mePostitsSection = (userNotes.length > 0 || bookmarkedNotes.length > 0)
    ? `${myNotesSection}${bookmarkedSection}`
    : '';

  // === LISTENER MODE: tab structure ===
  let listenerBody = '';
  if (!isArtist) {
    // Serial generator (matches polaroid.js _stoSerial)
    const _stoSerial = (id) => {
      let h = 0; const s = String(id || '');
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
      h = Math.abs(h);
      return `1-${String(800 + (h % 200)).padStart(3,'0')}-${String(((h >> 12) % 10000)).padStart(4,'0')}`;
    };

    // ── Tab 1: STO trading-card collection (replaces polaroid) ──
    const stoTradingCardsHtml = myBackings.slice(0, 30).map((b, i) => {
      const safeArtist = (b.artistName || '아티스트').replace(/</g,'&lt;');
      const safeTitle = (b.trackTitle || '데모').replace(/</g,'&lt;');
      const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
      const t = (db.tracks || []).find(x => x && x.id === b.trackId);
      const cover = (t && t.cover) || `https://i.pravatar.cc/300?u=${encodeURIComponent(b.artistName || 'artist')}`;
      const amt = Number(b.amount) || 0;
      const trackId = (t && t.id) || b.trackId || '';
      const stoNum = _stoSerial(b.trackId || b.id || ('b'+i));
      return `
        <div class="spo-card" onclick="${trackId ? `navigateTo('card:${trackId}')` : ''}">
          <div class="spo-card-header">
            <span class="spo-card-no">${stoNum}</span>
            <span class="spo-card-amt">💎 ${fmtMoney(amt)}</span>
          </div>
          <div class="spo-card-photo"><img src="${cover}" alt="${safeArtist}" loading="lazy"></div>
          <div class="spo-card-meta">
            <div class="spo-card-artist">${safeArtist}</div>
            <div class="spo-card-title">「${safeTitle}」</div>
            <div class="spo-card-date">${dateStr}</div>
          </div>
        </div>
      `;
    }).join('');
    const stoCardsTabContent = myBackings.length > 0
      ? `<div class="spo-card-grid">${stoTradingCardsHtml}</div>`
      : `<div class="empty-tab-message">아직 함께 만든 곡이 없어요.<br>아티스트 페이지에서 💎 함께 만들기를 눌러보세요.</div>`;

    // Stats for data tab
    // Unified "함께하는 아티스트" = union of followed + backed (no duplicate concept)
    const backedArtistNames = new Set(myBackings.map(b => b.artistName));
    const followedNames = new Set((followedArtists || []).map(a => a.name));
    const allInteractedArtists = new Set([...backedArtistNames, ...followedNames]);
    const totalPlaylistTracks = (myPlaylists || []).reduce((sum, p) => sum + ((p.trackIds || []).length), 0);

    // ── Tab 1 (▲ 세모): 응원하는 곡 — tracks the user has cheered ──
    const _escC = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cheeredSongsHtml = mySentCheers.map(c => {
      const t = (db.tracks || []).find(x => x && x.id === c.track_id);
      const cover = (t && t.cover)
        || `https://i.pravatar.cc/200?u=${encodeURIComponent(c.artist_name || 'artist')}`;
      const dateStr = c.created_at
        ? new Date(c.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
        : '';
      const playable = !!t;
      return `
        <div class="cheered-song-card" ${playable ? `onclick="playTrack('${c.track_id}')"` : ''}>
          <img src="${cover}" alt="" class="cheered-song-cover" loading="lazy">
          <div class="cheered-song-info">
            <div class="cheered-song-title">${_escC(c.track_title) || '곡'}</div>
            <div class="cheered-song-artist">${_escC(c.artist_name) || '아티스트'}${dateStr ? ` · ${dateStr}` : ''}</div>
            <div class="cheered-song-msg"><i class="ri-heart-3-fill"></i> ${_escC(c.message)}</div>
          </div>
        </div>`;
    }).join('');
    const tab1Content = `
      ${followingSection}
    `;

    // ── Tab 4: Data dashboard — LG gram card grid style ──
    // Each big card: gradient bg + illustrated emoji + big number + label
    const dataTabContent = `
      <div class="data-gram-grid">
        <div class="data-gram-card data-gram-pink">
          <div class="data-gram-art">💎</div>
          <div class="data-gram-tag">#함께만들기</div>
          <div class="data-gram-meta">By NewListener · OFF-STAGE</div>
          <div class="data-gram-num">${fmtMoney(totalBacked)}</div>
          <div class="data-gram-label">총 함께 만든 금액</div>
        </div>
        <div class="data-gram-card data-gram-yellow">
          <div class="data-gram-art">🎵</div>
          <div class="data-gram-tag">#함께만든곡</div>
          <div class="data-gram-meta">By NewListener · OFF-STAGE</div>
          <div class="data-gram-num">${myBackings.length}<span class="data-gram-unit">곡</span></div>
          <div class="data-gram-label">함께 만든 곡</div>
        </div>
        <div class="data-gram-card data-gram-cyan">
          <div class="data-gram-art">🌱</div>
          <div class="data-gram-tag">#함께하는아티스트</div>
          <div class="data-gram-meta">By NewListener · OFF-STAGE</div>
          <div class="data-gram-num">${allInteractedArtists.size}<span class="data-gram-unit">명</span></div>
          <div class="data-gram-label">함께하는 아티스트</div>
        </div>
        <div class="data-gram-card data-gram-mint">
          <div class="data-gram-art">🎧</div>
          <div class="data-gram-tag">#즐겨듣기</div>
          <div class="data-gram-meta">By NewListener · OFF-STAGE</div>
          <div class="data-gram-num">${totalPlaylistTracks}<span class="data-gram-unit">곡</span></div>
          <div class="data-gram-label">즐겨듣는 곡</div>
        </div>
        <div class="data-gram-card data-gram-pink">
          <div class="data-gram-art">✏</div>
          <div class="data-gram-tag">#내포스트잇</div>
          <div class="data-gram-meta">By NewListener · OFF-STAGE</div>
          <div class="data-gram-num">${userNotes.length}<span class="data-gram-unit">개</span></div>
          <div class="data-gram-label">내가 쓴 포스트잇</div>
        </div>
        <div class="data-gram-card data-gram-yellow" style="cursor:pointer;" onclick="navigateTo('universe')" title="내 우주에서 보기">
          <div class="data-gram-art">📌</div>
          <div class="data-gram-tag">#수집포스트잇</div>
          <div class="data-gram-meta">By NewListener · OFF-STAGE</div>
          <div class="data-gram-num">${bookmarkedNotes.length}<span class="data-gram-unit">개</span></div>
          <div class="data-gram-label">수집한 포스트잇 →</div>
        </div>
      </div>
    `;

    // ── Assemble listener body — 2 tabs: 세모(응원하는곡) + 동그라미(즐겨듣기) ──
    listenerBody = `
      <div class="reveal listener-tabs" role="tablist">
        <button class="listener-tab active" data-tab="cards" onclick="switchListenerTab('cards')" role="tab" title="함께하는 아티스트">
          <i class="ri-triangle-fill"></i>
        </button>
        <button class="listener-tab" data-tab="folders" onclick="switchListenerTab('folders')" role="tab" title="즐겨듣기">
          <i class="ri-circle-fill"></i>
        </button>
      </div>
      <div class="reveal listener-tab-panels">
        <div class="tab-panel active" data-tab="cards">${tab1Content}</div>
        <div class="tab-panel" data-tab="folders">${playlistSection || '<div class="empty-tab-message">아직 폴더가 없어요.</div>'}</div>
      </div>
    `;
  }

  // 팔로우 중인 아티스트 — 내 페이지에 작은 카드 그리드로 노출
  const followingSection = (followedArtists && followedArtists.length > 0) ? `
    <div class="reveal" style="margin-bottom:24px;">
      <h2 class="section-title" style="display:flex; align-items:center; gap:8px; margin:0 0 14px;">
        <i class="ri-user-heart-fill" style="color:#FF4081;"></i>
        ${_i18n('팔로우 중인 아티스트', 'Artists you follow')} <span class="section-count">${followedArtists.length}</span>
      </h2>
      <div class="follow-list-grid">
        ${followedArtists.map(a => {
          const safeAName = (a.name || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
          const encAName = encodeURIComponent(a.name || '');
          const subLabel = a.role === 'admin' ? '관리자' : (a.role === 'artist' || a.role === 'student' ? '아티스트' : 'Listener');
          const aAvatar = a.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(a.name || ''));
          return `
            <div class="follow-list-card" onclick="navigateTo('artist:${encAName}')">
              <img src="${aAvatar}" alt="${safeAName}" class="follow-list-avatar" loading="lazy">
              <div class="follow-list-name">${safeAName}</div>
              <div class="follow-list-role">${subLabel}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  // 내 페이지 — 팔로우 중 + 내 음악 폴더 노출. 나머지 섹션은 플랫폼 성숙 후 켤 예정.
  const playlistOrEmpty = playlistSection || '<div class="empty-tab-message">아직 음악 폴더가 없어요.<br>곡에 ❤를 눌러서 폴더에 모아보세요.</div>';
  const body = followingSection + playlistOrEmpty;

  // Listener: 덕질 다락방 (paper + tape + pins, 따뜻한 손글씨 톤)
  // Artist: standard lavender canvas
  const wrapperClass = isArtist ? 'artist-canvas' : 'artist-canvas listener-attic';
  appContent.innerHTML = `
    <div class="${wrapperClass}">
      <div class="artist-bg-deco"></div>
      <div class="sub-page artist-page">
        ${headerSection}
        ${body}
      </div>
    </div>
  `;
  // renderProfile is async — re-run reveal observer now that DOM is in place,
  // since navigateTo's initial setTimeout(observeReveals, 20) fires before this completes
  try { if (typeof observeReveals === 'function') observeReveals(); } catch (_) {}
  // Fallback: force visibility after 100ms in case IntersectionObserver doesn't fire
  setTimeout(() => {
    document.querySelectorAll('#app-content .reveal:not(.in-view)').forEach(el => el.classList.add('in-view'));
  }, 100);
}

window.editProfile = function () {
  const db = window.DB.get();
  const sns = db.currentUser.sns || {};

  appContent.innerHTML = `
    <div style="max-width: 500px; margin: 40px auto;" class="card">
      <h1 style="margin-bottom: 24px;"><i class="ri-settings-4-fill"></i> ${_i18n('프로필 설정', 'Profile settings')}</h1>
      <form id="edit-profile-form">
        <div class="form-group">
          <label>${_i18n('활동명', 'Artist name')}</label>
          <input type="text" class="form-control" id="edit-name" value="${db.currentUser.name}" required>
        </div>
        <div class="form-group">
          <label>${_i18n('프로필 이미지 (URL 또는 파일 업로드)', 'Profile image (URL or file upload)')}</label>
          <input type="text" class="form-control" id="edit-avatar-url" value="${db.currentUser.avatar}" placeholder="${_t('이미지 URL (예: https://...)', 'Image URL (e.g. https://...)')}">
          <div style="text-align: center; margin: 12px 0; color: var(--text-secondary); font-size: 13px;">&mdash; ${_i18n('또는', 'or')} &mdash;</div>
          <input type="file" class="form-control" id="edit-avatar-file" accept="image/*">
          <div class="form-note">${_i18n('파일을 업로드하면 입력된 URL보다 우선 적용됩니다.', 'An uploaded file takes priority over the URL.')}</div>
        </div>

        <div class="form-group">
          <label>${_i18n('자기소개', 'Bio')} <span style="color:var(--text-secondary); font-weight:400; font-size:12px;">${_i18n('— 100자까지, 아티스트 페이지에 표시', '— up to 100 chars, shown on your page')}</span></label>
          <textarea class="form-control" id="edit-bio" maxlength="100" rows="3"
            style="resize:vertical;"
            placeholder="${_t('자유롭게 — 어떤 음악 하는지, 무엇을 좋아하는지', 'Anything — what music you make, what you love')}">${((db.currentUser.bio || '')).replace(/</g,'&lt;').replace(/"/g,'&quot;')}</textarea>
          <div class="form-note">
            <span id="edit-bio-counter">${(db.currentUser.bio || '').length} / 100</span>
          </div>
        </div>

        <!-- SNS 계정 연동 — 임시 숨김 (사용자 요청). 데이터는 보존됨. -->
        <div style="display:none;" aria-hidden="true">
          <h2 style="font-size: 18px; border-bottom: 1px solid var(--divider); padding-bottom: 10px; margin: 30px 0 20px;">SNS 계정 연동</h2>
          <div class="form-group">
            <label><i class="ri-instagram-line" style="color:#E4405F;"></i> Instagram</label>
            <input type="url" class="form-control" id="edit-sns-instagram" value="${sns.instagram || ''}" placeholder="https://instagram.com/...">
          </div>
          <div class="form-group">
            <label><i class="ri-youtube-fill" style="color:#FF0000;"></i> YouTube</label>
            <input type="url" class="form-control" id="edit-sns-youtube" value="${sns.youtube || ''}" placeholder="https://youtube.com/@...">
          </div>
          <div class="form-group">
            <label><i class="ri-tiktok-fill"></i> TikTok</label>
            <input type="url" class="form-control" id="edit-sns-tiktok" value="${sns.tiktok || ''}" placeholder="https://tiktok.com/@...">
          </div>
          <div class="form-group">
            <label><i class="ri-twitter-fill" style="color:#1DA1F2;"></i> Twitter / X</label>
            <input type="url" class="form-control" id="edit-sns-twitter" value="${sns.twitter || ''}" placeholder="https://x.com/...">
          </div>
        </div>

        <h2 style="font-size: 18px; border-bottom: 1px solid var(--divider); padding-bottom: 10px; margin: 30px 0 20px;">${_i18n('계정 설정', 'Account')}</h2>

        <div class="form-group">
          <label>${_i18n('이메일', 'Email')}</label>
          <input type="text" class="form-control" value="${db.currentUser.email || '-'}" disabled style="opacity: 0.5; background: var(--bg-color);">
          <div class="form-note">${_i18n('이메일은 변경할 수 없습니다.', 'Email cannot be changed.')}</div>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 30px;">
          <button type="submit" class="btn-primary" style="flex: 1;">${_i18n('변경사항 저장', 'Save changes')}</button>
          <button type="button" class="btn-primary" style="flex: 1; background: #333;" onclick="navigateTo('profile')">${_i18n('취소', 'Cancel')}</button>
        </div>
      </form>
    </div>
  `;

  // bio 글자수 실시간 카운터
  try {
    const _bioTa = document.getElementById('edit-bio');
    const _bioCt = document.getElementById('edit-bio-counter');
    if (_bioTa && _bioCt) {
      _bioTa.addEventListener('input', () => {
        _bioCt.textContent = _bioTa.value.length + ' / 100';
      });
    }
  } catch (_) {}

  document.getElementById('edit-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중…'; }

    // Inline error banner above buttons (more visible than alert on some mobile browsers)
    const showInlineError = (msg) => {
      let bar = document.getElementById('edit-error-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'edit-error-bar';
        bar.style.cssText = 'background:#3a1010; color:#ff8080; padding:12px 16px; border-radius:6px; margin:12px 0; font-size:13px; line-height:1.5; word-break:break-word; border:1px solid #6b1818;';
        const buttons = e.target.querySelector('div[style*="display: flex"]');
        if (buttons) buttons.parentNode.insertBefore(bar, buttons);
      }
      bar.innerText = '⚠️ ' + msg;
    };
    const clearError = () => { const b = document.getElementById('edit-error-bar'); if (b) b.remove(); };

    // ── 헬퍼: 모든 await 에 타임아웃 — 네트워크 끊김/Supabase 멈춤이 사용자를 안 잡게.
    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error((label || '작업') + ' 시간초과 (' + ms + 'ms)')), ms))
    ]);

    let step = 'init';
    try {
      clearError();
      console.log('[edit-profile] start');

      // ── 1) 세션 — 무조건 refresh 가 아니라 만료 임박일 때만, 그것도 백그라운드로.
      //     getSession() 은 로컬 캐시만 읽으므로 hang 없음.
      step = 'session check';
      let liveSession = null;
      if (window.supabase) {
        try {
          const { data: { session } } = await withTimeout(window.supabase.auth.getSession(), 4000, 'getSession');
          if (!session) throw new Error('로그인 세션이 없어요. 다시 로그인해주세요.');
          if (!session.user) throw new Error('세션은 있지만 user 정보가 비었어요. 다시 로그인해주세요.');
          liveSession = session;
          console.log('[edit-profile] session user.id:', session.user.id);
          // 만료 2분 이내일 때만 백그라운드 refresh — 결과 안 기다림
          if (session.expires_at && session.expires_at - Math.floor(Date.now()/1000) < 120) {
            window.supabase.auth.refreshSession().catch(e => console.warn('[edit-profile] bg refresh', e));
          }
        } catch (e) { throw new Error('세션 확인 실패: ' + (e.message || e)); }
      }

      // ── 2) profiles 행 보장 — 타임아웃 짧게, 실패해도 진행
      step = 'ensure profile row';
      if (window.Auth && window.Auth.ensureProfileRow) {
        try {
          await withTimeout(window.Auth.ensureProfileRow(), 4000, 'ensureProfileRow');
        } catch (e) { console.warn('[edit-profile] ensureProfileRow skipped:', e.message); }
      }

      step = 'read fields';
      const newName = document.getElementById('edit-name').value.trim();
      const avatarUrl = document.getElementById('edit-avatar-url').value.trim();
      const avatarFile = document.getElementById('edit-avatar-file').files[0];

      if (!newName) throw new Error('활동명은 비워둘 수 없어요');

      let finalAvatarUrl = avatarUrl || db.currentUser.avatar;

      if (avatarFile) {
        step = 'upload avatar';
        console.log('[edit-profile] avatar file:', avatarFile.name, avatarFile.size, 'bytes');
        if (avatarFile.size > 5 * 1024 * 1024) throw new Error('아바타는 5MB 이하만 가능 (현재 ' + (avatarFile.size/1048576).toFixed(1) + 'MB)');
        if (submitBtn) submitBtn.textContent = '아바타 업로드 중…';
        if (!window.Tracks || !window.Tracks.uploadFile) throw new Error('업로더 준비 안됨');
        finalAvatarUrl = await window.Tracks.uploadFile(avatarFile, 'avatars');
        console.log('[edit-profile] avatar URL:', finalAvatarUrl);
      }

      step = 'update profile';
      // SNS 필드는 현재 UI 숨김 — 인풋이 DOM 에 있으면 읽고, 없으면 기존 값 유지
      const _readInput = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : (fallback || '');
      };
      const _sns = db.currentUser.sns || {};
      const sns = {
        instagram: _readInput('edit-sns-instagram', _sns.instagram),
        youtube:   _readInput('edit-sns-youtube',   _sns.youtube),
        tiktok:    _readInput('edit-sns-tiktok',    _sns.tiktok),
        twitter:   _readInput('edit-sns-twitter',   _sns.twitter)
      };

      if (window.supabase && window.__currentUser) {
        if (submitBtn) submitBtn.textContent = '프로필 저장 중…';
        // 세션 user.id 기준으로 업데이트 — __currentUser.id 가 stale 할 가능성 대비
        const targetId = (liveSession && liveSession.user && liveSession.user.id) || window.__currentUser.id;
        console.log('[edit-profile] update targetId:', targetId, '   __currentUser.id:', window.__currentUser.id);
        if (targetId !== window.__currentUser.id) {
          console.warn('[edit-profile] __currentUser.id 와 session user.id 가 다름 — 세션 user.id 사용');
        }

        // 자기소개 (bio) 도 함께 저장 — 같은 폼에서 처리
        const newBio = (function () {
          const el = document.getElementById('edit-bio');
          return el ? el.value.trim().slice(0, 100) : (db.currentUser.bio || '');
        })();

        // .select('id, name, avatar_url') 로 진짜 업데이트된 row 를 받아온다.
        // RLS 가 막아도 error 가 안 나오므로, data 가 빈 배열이면 0행 매치 → 진단 가능.
        const { data: updRows, error: upErr } = await withTimeout(
          window.supabase
            .from('profiles')
            .update({
              name: newName,
              avatar_url: finalAvatarUrl,
              bio: newBio || null,
              sns_instagram: sns.instagram || null,
              sns_youtube:   sns.youtube || null,
              sns_tiktok:    sns.tiktok || null,
              sns_twitter:   sns.twitter || null
            })
            .eq('id', targetId)
            .select('id, name, avatar_url, bio'),
          8000, 'profile update');
        if (upErr) {
          console.error('[edit-profile] update error full object:', upErr);
          throw new Error('DB 업데이트 실패: ' + (upErr.message || JSON.stringify(upErr)) +
                          (upErr.hint ? ' (힌트: ' + upErr.hint + ')' : '') +
                          (upErr.code ? ' [code:' + upErr.code + ']' : ''));
        }
        if (!Array.isArray(updRows) || updRows.length === 0) {
          // ⚠️ 가장 흔한 silent failure: RLS 가 매치를 거부했거나 행이 없음
          console.error('[edit-profile] update 0 rows — targetId:', targetId,
                        'session.uid:', liveSession && liveSession.user && liveSession.user.id);
          // 한 번 더 RPC 로 행을 만들고 재시도
          try {
            await window.supabase.rpc('ensure_my_profile');
          } catch (rpcErr) { console.warn('[edit-profile] ensure_my_profile RPC', rpcErr); }
          const { data: retryRows, error: retryErr } = await window.supabase
            .from('profiles')
            .update({
              name: newName,
              avatar_url: finalAvatarUrl,
              bio: newBio || null,
              sns_instagram: sns.instagram || null,
              sns_youtube:   sns.youtube || null,
              sns_tiktok:    sns.tiktok || null,
              sns_twitter:   sns.twitter || null
            })
            .eq('id', targetId)
            .select('id, name, avatar_url, bio');
          if (retryErr) throw new Error('재시도 DB 업데이트 실패: ' + retryErr.message);
          if (!Array.isArray(retryRows) || retryRows.length === 0) {
            throw new Error('프로필 행이 매치되지 않았어요. id=' + targetId +
              ' / auth.uid=' + (liveSession && liveSession.user && liveSession.user.id) +
              ' — 콘솔에서 자세한 로그 확인 부탁드려요.');
          }
          console.log('[edit-profile] retry succeeded:', retryRows);
        } else {
          console.log('[edit-profile] update succeeded:', updRows);
        }

        // 이전 이름 기억해뒀다 cached.tracks / cached.notes 갱신할 때 사용
        const oldName = (window.__currentUser && window.__currentUser.name) || (db.currentUser && db.currentUser.name);

        // 메모리/로컬 캐시 동기화
        if (window.__currentUser) {
          window.__currentUser.id = targetId;
          window.__currentUser.name = newName;
          window.__currentUser.avatar = finalAvatarUrl;
          window.__currentUser.avatar_url = finalAvatarUrl;
          window.__currentUser.bio = newBio;
          window.__currentUser.sns = sns;
        }
        try {
          const cached = window.DB.get();
          if (cached && cached.currentUser) {
            cached.currentUser.id = targetId;
            cached.currentUser.name = newName;
            cached.currentUser.avatar = finalAvatarUrl;
            cached.currentUser.bio = newBio;
            cached.currentUser.sns = sns;
          }
          // ── 이 사용자가 올린 트랙들 — artist 이름/아바타 새로 반영
          //    (Tracks.refreshInto 가 백그라운드로 갈아끼우긴 하지만, navigateTo 가
          //     그 전에 먼저 렌더하므로 옛 값을 보고 화면이 그려지던 문제)
          if (cached && Array.isArray(cached.tracks)) {
            cached.tracks.forEach(t => {
              if (!t) return;
              const match = (t.artistId && t.artistId === targetId) || (oldName && t.artist === oldName);
              if (match) {
                t.artist = newName;
                t.artistAvatar = finalAvatarUrl;
                if (t.artistId == null) t.artistId = targetId;
              }
            });
          }
          // 우리들의 벽 메모도 동일하게 — 작성자 이름/아바타
          if (cached && Array.isArray(cached.notes)) {
            cached.notes.forEach(n => {
              if (!n) return;
              const match = (n.authorId && n.authorId === targetId) || (oldName && n.author === oldName);
              if (match) {
                n.author = newName;
                n.authorAvatar = finalAvatarUrl;
                if (n.authorId == null) n.authorId = targetId;
              }
            });
          }
          window.DB.save(cached);
          // 다른 메모리 캐시들도 (window.__wallNotes, window.__tracks 등)
          if (Array.isArray(window.__wallNotes)) {
            window.__wallNotes.forEach(n => {
              if (!n) return;
              const match = (n.authorId && n.authorId === targetId) || (oldName && n.author === oldName);
              if (match) { n.author = newName; n.authorAvatar = finalAvatarUrl; }
            });
          }
          if (Array.isArray(window.__tracks)) {
            window.__tracks.forEach(t => {
              if (!t) return;
              const match = (t.artistId && t.artistId === targetId) || (oldName && t.artist === oldName);
              if (match) { t.artist = newName; t.artistAvatar = finalAvatarUrl; }
            });
          }
        } catch (_) {}

        // 백그라운드로 다른 캐시도 갱신
        step = 'sync caches (background)';
        if (window.Auth && window.Auth.bootstrap) {
          window.Auth.bootstrap().catch(e => console.warn('[edit-profile] bootstrap bg', e));
        }
        if (window.Tracks && window.Tracks.refreshInto) {
          window.Tracks.refreshInto(window.DB.get()).catch(e => console.warn('[edit-profile] tracks bg', e));
        }
      } else {
        // Fallback (no Supabase) — write localStorage
        db.currentUser.name = newName;
        db.currentUser.avatar = finalAvatarUrl;
        db.currentUser.sns = sns;
        window.DB.save(db);
      }

      console.log('[edit-profile] done');
      updateHeaderAuth();
      showToast(_t('프로필 저장 완료 ✨', 'Profile saved ✨'));
      // 저장 후 본인 아티스트 페이지로 — 새 아바타/이름이 거기 헤더에 바로 보임.
      navigateTo('artist:' + encodeURIComponent(newName || ''));
    } catch (err) {
      console.error('[edit-profile] failed at step', step, err);
      showInlineError('[' + step + '] ' + (err.message || err));
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '변경사항 저장'; }
    }
  });
}

// ===================== VERSION GROUP HELPERS =====================
function formatFullDate(iso) {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch (e) { return ''; }
}

// Keep daysAgo for timeline but use absolute dates in project box
function daysAgo(iso) { return formatFullDate(iso); }

// Snake/cycle layout: 4 cols, alternating direction
// index 0→1→2→3, then ↓, then 4←5←6←7, etc.
function snakePos(i, cols) {
  const row = Math.floor(i / cols);
  const colInRow = i % cols;
  const col = (row % 2 === 0) ? colInRow : (cols - 1 - colInRow);
  return { row: row + 1, col: col + 1, colInRow };
}
function snakeArrow(i, total, cols) {
  if (i >= total - 1) return '';
  const { colInRow, row } = snakePos(i, cols);
  if (colInRow === cols - 1) return 'down';
  return (row % 2 === 0) ? 'right' : 'left';
}

function renderProjectBox(pid, versions) {
  // Sort demos: parse "demoN" → N. demo_retired (ex-finals) sort to end.
  // Tiebreaker: createdAt ascending so newer demos come after.
  const demoNum = (v) => {
    const m = /^demo(\d+)$/.exec(v.version || '');
    if (m) return parseInt(m[1], 10);
    if (v.version === 'demo_retired') return 99999;
    return 0;
  };
  const demos = versions.filter(v => v.version !== 'final')
    .sort((a, b) => {
      const da = demoNum(a), dbn = demoNum(b);
      if (da !== dbn) return da - dbn;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
  const final = versions.find(v => v.version === 'final');

  const primary = final || versions[versions.length - 1];
  const projectTitle = (primary.title || '').replace(/\s*\(Demo.*\)$/i, '');
  const safeTitle = projectTitle.replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const db = window.DB.get();
  const canEditArtist = db.currentUser && db.currentUser.name === primary.artist;

  // Desktop layout uses a snake-flow grid of demos. Mobile carousel doesn't
  // use these columns at all (.project-pages flex overrides CSS grid).
  // Original behaviour: <560px = 1 col, otherwise 2 cols.
  // 본인 페이지면 맨 끝에 '+ 데모 추가' 빈 카드를 한 칸 더 잡아둠.
  const _w = (typeof window !== 'undefined') ? window.innerWidth : 1024;
  const _baseCols = _w < 560 ? 1 : 2;
  const _totalCards = demos.length + (canEditArtist ? 1 : 0);
  const cols = Math.min(_baseCols, Math.max(1, _totalCards || 1));

  // Master info — 발매일 + 참여 인원
  const masterDate = final ? formatFullDate(final.createdAt) : '';
  // 참여 인원: Supabase backer count 우선, 없으면 stoConfig.raisedKrw / unitMin 으로 추정
  const participantCount = (() => {
    const sumFromBackers = versions.reduce((s, v) => {
      const c = (window.__backerCounts && window.__backerCounts.get(v.id)) || 0;
      return s + c;
    }, 0);
    if (sumFromBackers > 0) return sumFromBackers;
    // mock 추정: 프로젝트 전체 raisedKrw / 평균 unitMin
    const sumRaised = versions.reduce((s, v) => {
      const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(v) : null;
      return s + ((cfg && cfg.raisedKrw) || 0);
    }, 0);
    const avgUnit = versions.reduce((s, v) => {
      const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(v) : null;
      return s + ((cfg && cfg.unitMin) || 10000);
    }, 0) / Math.max(1, versions.length);
    return sumRaised > 0 ? Math.max(1, Math.floor(sumRaised / Math.max(10000, avgUnit))) : 0;
  })();

  // 댓글 권한 — 로그인된 사용자 누구나 가능 (후원자/아티스트 제한 해제)
  const canComment = !!(db.currentUser || window.__currentUser);

  // 발매 글소개 — 카드 옆/아래의 노란 포스트잇은 사용자 요청으로 제거.
  // 대신 마스터 커버 클릭 시 openSongInfoModal(트랙ID) 가 곡소개 모달을 띄움.
  const releaseNoteHtml = '';

  // Snake cards — DEMOS ONLY (with 함께만들기 progress badge per demo)
  // 모두 collapsed 상태로 시작 — 클릭해야 일지·댓글·입력 노출 (사용자 요청)
  const cardsHtml = demos.map((v, i) => {
    const label = (v.versionLabel || v.version || 'Version').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const dateLabel = formatFullDate(v.createdAt);
    const pos = snakePos(i, cols);
    const arrow = snakeArrow(i, demos.length, cols);
    const cls = [
      'demo-card',
      'is-demo',
      arrow ? 'arrow-' + arrow : ''
    ].join(' ');
    // 함께 만들기(STO) 후원 기능 — UI 숨김. 백엔드 데이터는 유지하지만 카드엔 표시 안 함.
    const stoBadgeHtml = '';
    // "메인 노출 도형 선택" 버튼 폐기 — 이제 모든 데모가 자동으로 도형 페이지에 표시됨.
    const shapeOpenBtnHtml = '';

    // PC — 11:33 (c968cc7) 시점 디자인 복귀:
    // snake-grid, compact 카드, 마지막 2 댓글 inline + "탭해서 모두 보기", input + send.
    const noteRaw = (v.artistNote || '').trim();
    const noteEsc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // 줄바꿈 기준 자르지 않고 전체 다 넣음 — CSS line-clamp(3) 이 시각적으로 잘라서
    // 자연스럽게 끝에 "…" 표시. 더보기 버튼은 사용자 요청으로 제거.
    const noteLines = noteRaw ? noteRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
    const noteHtml = noteLines.length > 0
      ? `<div class="demo-card-note" data-track-id="${v.id}" ${canEditArtist ? `onclick="event.stopPropagation(); editArtistNote('${v.id}')"` : ''} ${canEditArtist ? 'style="cursor: pointer;"' : ''}>
           ${noteLines.map(l => `<span class="demo-card-note-line">${noteEsc(l)}</span>`).join('')}
           ${canEditArtist ? '<i class="ri-pencil-line demo-card-note-edit"></i>' : ''}
         </div>`
      : canEditArtist
        ? `<div class="demo-card-note-empty" onclick="event.stopPropagation(); editArtistNote('${v.id}')">
             <i class="ri-edit-2-line"></i> 탭해서 일지 적기
           </div>`
        : '';

    // ── 카드 내부 인라인 댓글 + 입력 ──
    const cmList = v.trackComments || [];
    const PC_INLINE = 1;     // 인라인 댓글 1개만 (예전 2개 → 사용자 요청으로 축소)
    const cmVisible = cmList.slice(-PC_INLINE);
    const _myId = (window.__currentUser && window.__currentUser.id) || null;
    const _myName = (window.__currentUser && window.__currentUser.name) || '';
    const demoLiked = isTrackLiked(v.id);
    // 댓글: 최신 1개만 표시. 작성자 이름은 빼고 → 그 자리(우측)에 "...더보기" (사용자 요청).
    //   더보기 누르면 우리들의 벽 모달. 인라인 입력칸 없음 — 댓글은 모달 안에서만.
    //   카드 어디를 눌러도 재생. 더보기/삭제/하트 버튼만 stopPropagation 으로 예외.
    const moreLabel = cmList.length > 0 ? _t('...더보기', '...more') : _t('💬 댓글 달기', '💬 Comment');
    const moreBtnHtml = `<button class="demo-card-more" onclick="event.stopPropagation(); event.preventDefault(); openDemoWallModal('${v.id}')">${moreLabel}</button>`;
    const cmInlineHtml = cmVisible.map(cm => {
      const cmSafe = noteEsc(cm.text || '');
      const isMine = (_myId && cm.authorId && cm.authorId === _myId)
                  || (!cm.authorId && _myName && cm.author === _myName);
      const delBtn = isMine ? `<button class="cm-del-btn" onclick="event.stopPropagation(); deleteTrackComment('${v.id}','${cm.id}')" title="댓글 삭제"><i class="ri-close-line"></i></button>` : '';
      // 작성자 이름 자리에 "...더보기" 링크.
      return `<div class="demo-card-cm-line"><span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${cmSafe}</span>${moreBtnHtml}${delBtn}</div>`;
    }).join('');
    // 댓글 있으면 줄 안에 더보기, 없으면 단독 "댓글 달기" 버튼.
    const cmBlockHtml = `
        <div class="demo-card-cm-list">
          ${cmInlineHtml || moreBtnHtml}
        </div>`;
    return `
      <div class="${cls} page-demo ${v.pinned ? 'is-pinned' : ''}" data-track-id="${v.id}" data-project="${pid}"
           style="grid-row:${pos.row}; grid-column:${pos.col};"
           onclick="selectProjectVersion('${pid}','${v.id}'); playTrack('${v.id}', 'demo')">
        <div class="demo-card-top">
          <span class="demo-tag">DEMO ${i+1}</span>
          <span class="demo-card-date">· ${dateLabel}</span>
          ${canEditArtist ? `
            <button class="demo-card-delete" onclick="event.stopPropagation(); event.preventDefault(); deleteMyTrack('${v.id}', '${(v.title||'').replace(/'/g,"\\'")}')" title="삭제">
              <i class="ri-delete-bin-line"></i>
            </button>
          ` : ''}
          <button class="demo-card-like ${demoLiked ? 'is-liked' : ''}" onclick="event.stopPropagation(); event.preventDefault(); toggleTrackHeart('${v.id}', this)" title="내 우주에 모으기">
            <i class="${demoLiked ? 'ri-heart-fill' : 'ri-heart-line'}"></i>
          </button>
        </div>
        ${noteHtml}
        ${cmBlockHtml}
      </div>
    `;
  }).join('') + (canEditArtist ? (() => {
    // 빈 포스트잇(+ 데모 추가) — 데모 카드들 끝에 한 칸. 본인 페이지에서만 보임.
    // 누르면 그 프로젝트의 다음 데모로 바로 업로드 폼이 세팅됨.
    const nextIdx = demos.length;
    const pos = snakePos(nextIdx, cols);
    return `
      <div class="demo-card demo-card-add" data-project="${pid}"
           style="grid-row:${pos.row}; grid-column:${pos.col};"
           onclick="quickUploadDemoToProject('${pid}')"
           title="이 프로젝트에 다음 데모 올리기">
        <i class="ri-add-line"></i>
        <span class="demo-card-add-label">DEMO ${nextIdx + 1} 추가</span>
      </div>
    `;
  })() : '');

  // Shape options shared by version-panel below
  const SHAPE_OPTIONS = [
    { key: 'circle',        icon: 'ri-circle-fill',                label: '원' },
    { key: 'oval',          icon: 'ri-checkbox-blank-circle-fill', label: '타원' },
    { key: 'rect',          icon: 'ri-checkbox-blank-fill',        label: '사각' },
    { key: 'triangle',      icon: 'ri-triangle-fill',              label: '세모' },
    { key: 'star',          icon: 'ri-star-fill',                  label: '별' },
    { key: 'diamond',       icon: 'ri-rhombus-fill',               label: '다이아' },
    { key: 'hexagon',       icon: 'ri-shape-2-fill',               label: '육각' },
    { key: 'parallelogram', icon: 'ri-parking-box-fill',           label: '평행' }
  ];

  // Build ordered for panels: demos + master (panels for all)
  const ordered = [...demos, ...(final ? [final] : [])];

  // Detail panels (one per version). Only the first is visible initially.
  const panelsHtml = ordered.map((v, i) => {
    const isDemo = v.version !== 'final';
    const artistNote = v.artistNote || '';
    const safeNote = artistNote.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const comments = v.trackComments || [];
    const commentsHtml = comments.length === 0
      ? '<div class="no-comments">ㄴ 아직 조용해... 첫 낙서 남겨봐 ✍️</div>'
      : comments.map((cm, ci) => {
          const cmSafe = (cm.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const cmAuth = (cm.author || '익명').replace(/</g,'&lt;');
          return `
            <div class="comment-line">
              <span class="comment-arrow">ㄴ</span><span class="comment-text">${cmSafe}</span><span class="comment-author">— ${cmAuth}</span>
            </div>
          `;
        }).join('');

    const diaryBlock = artistNote
      ? `<div class="demo-diary">
           <div class="diary-label">📝 ${v.artist}의 기록</div>
           <div class="diary-body">${safeNote}</div>
           ${canEditArtist ? `<button class="diary-edit" onclick="event.stopPropagation(); editArtistNote('${v.id}')" title="수정"><i class="ri-pencil-line"></i></button>` : ''}
         </div>`
      : canEditArtist
        ? `<div class="demo-diary-empty" onclick="editArtistNote('${v.id}')">
             <i class="ri-edit-2-line"></i> 이 ${isDemo ? '데모' : '마스터'}에 대한 생각 적기...
           </div>`
        : `<div class="demo-diary-empty-silent">📝 아직 기록 없음</div>`;

    const cmCount = comments.length;
    return `
      <div class="version-panel ${i === 0 ? 'active' : ''}" data-track-id="${v.id}" data-project="${pid}">
        ${diaryBlock}
        <button class="comments-toggle" type="button"
                onclick="event.stopPropagation(); this.closest('.version-panel').classList.toggle('comments-open'); this.querySelector('i').classList.toggle('ri-arrow-down-s-line'); this.querySelector('i').classList.toggle('ri-arrow-up-s-line');">
          <span>💬 댓글 ${cmCount}개 ${cmCount > 0 ? '보기' : '쓰기'}</span>
          <i class="ri-arrow-down-s-line"></i>
        </button>
        <div class="demo-comments">
          <div class="scribble-title">✎ ${_t(`이 ${isDemo ? '데모' : '마스터'}에 낙서`, `Scribble on this ${isDemo ? 'demo' : 'master'}`)} <span class="scribble-title-hint">${_t('— 후원한 분만', '— supporters only')}</span></div>
          ${commentsHtml}
          ${canComment ? `
            <div class="scribble-input-row">
              <input type="text" id="tca-${v.id}" class="scribble-input scribble-name-input" placeholder="${_t('이름 (없어도 됨)', 'Name (optional)')}" value="${db.currentUser?.name || ''}">
              <input type="text" id="tct-${v.id}" class="scribble-input" placeholder="${_t('ㄴ 하고 싶은 말 적어봐...', 'ㄴ Say something...')}" onkeypress="if(event.key==='Enter') submitTrackComment('${v.id}')">
              <button class="scribble-send" onclick="submitTrackComment('${v.id}')">${_t('남기기', 'Post')}</button>
            </div>
          ` : `
            <div class="scribble-locked">
              <div class="scribble-locked-text">${_t('로그인하면 댓글을 남길 수 있어요', 'Sign in to leave a comment')}</div>
              <button class="scribble-locked-cta" onclick="event.stopPropagation(); navigateTo('auth')">${_t('로그인하기 →', 'Sign in →')}</button>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  const demoCount = demos.length;
  const journeyLabel = demoCount > 0 && final
    ? `데모 ${demoCount}개 → 마스터`
    : demoCount > 0
      ? `Coming Soon... · 데모 ${demoCount}개`
      : '마스터';

  // Edit cover button — only for project owner with Supabase tracks
  const canEditCover = canEditArtist && primary.__supabase;
  const editCoverBtn = canEditCover ? `
    <button class="cover-edit-btn" onclick="event.stopPropagation(); changeProjectCover('${pid}')" title="커버 사진 바꾸기">
      <i class="ri-image-edit-line"></i>
    </button>
  ` : '';

  // ⭐️ 사진이 없으면 포스트잇 fallback (필기체로 제목) — 사용자 요청.
  //    hasCustomCover (cover_url 있음) 일 때만 실제 사진. 아니면 노란 포스트잇.
  const finalHasCover = final && final.hasCustomCover;
  const primaryHasCover = primary && primary.hasCustomCover;
  // 발매일 칩 — 사진 좌상단 (사용자 요청). 발매일 있으면 "발매 · YYYY.MM.DD", 없으면 "발매"
  const _finalReleaseRaw = (final && (final.releaseDate || '').trim()) || '';
  const _finalReleaseChipText = /^\d{4}-\d{2}-\d{2}/.test(_finalReleaseRaw)
    ? `발매 · ${_finalReleaseRaw.slice(0, 10).replace(/-/g, '.')}`
    : (final && masterDate ? `발매 · ${masterDate}` : '발매');
  const coverHtml = final ? (finalHasCover ? `
    <div class="project-cover-wrap" onclick="playTrack('${final.id}'); selectProjectVersion('${pid}','${final.id}'); openSongInfoModal('${final.id}');" title="탭하면 곡 소개 + 재생">
      <img src="${final.cover}" class="project-cover-large" alt="${safeTitle}" loading="lazy">
      <span class="project-release-chip">${_finalReleaseChipText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
      <div class="project-play-overlay"><i class="ri-play-fill"></i></div>
      <div class="project-master-badge">발매</div>
      ${editCoverBtn}
    </div>
  ` : (() => {
    // 사진 없는 발매 — 발매일 있으면 "YYYY.MM coming", 없으면 "coming soon" 필기체
    const _rd = (final.releaseDate || '').trim();
    const _ym = _rd ? _rd.slice(0,7).replace('-','.') : '';
    return `
    <div class="project-cover-wrap is-postit" onclick="playTrack('${final.id}'); selectProjectVersion('${pid}','${final.id}')" title="마스터 재생">
      <div class="cover-postit ${_ym ? 'cover-postit-coming-date' : 'cover-postit-script'}">
        ${_ym ? `<div class="cover-postit-date">${_ym}</div><div class="cover-postit-coming-text">coming</div>` : `<div class="cover-postit-script-text">coming<br>soon</div>`}
      </div>
      <div class="project-play-overlay"><i class="ri-play-fill"></i></div>
      ${editCoverBtn}
    </div>
  `;})()) : (primaryHasCover ? `
    <div class="project-cover-wrap no-master">
      <img src="${primary.cover}" class="project-cover-large" alt="${safeTitle}" loading="lazy">
      ${editCoverBtn}
    </div>
  ` : (() => {
    // 발매 없음 + 사진 없음 — 가장 빠른 데모의 release_date 또는 빈 → coming soon 필기체
    const _rd = (primary && primary.releaseDate || '').trim();
    const _ym = _rd ? _rd.slice(0,7).replace('-','.') : '';
    return `
    <div class="project-cover-wrap no-master is-postit">
      <div class="cover-postit ${_ym ? 'cover-postit-coming-date' : 'cover-postit-script'}">
        ${_ym ? `<div class="cover-postit-date">${_ym}</div><div class="cover-postit-coming-text">coming</div>` : `<div class="cover-postit-script-text">coming<br>soon</div>`}
      </div>
      ${editCoverBtn}
    </div>
  `;})());

  // 응원하기 — cheers the master (or primary) track. Hidden on your own work.
  const cheerTarget = final || primary;
  const cheerBtnHtml = ''; // 응원 기능 미사용 (안 쓰기로 함)

  // version-panels는 데모 카드 안으로 흡수됨 — 하단 MEMO & COMMENTS 섹션 제거
  // Master content (diary + comments + input) — shown on the cover page
  // when there's a final master track. This is the "master page" the user
  // expects at the front of the carousel.
  const noteEscG = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const masterContentHtml = final ? (() => {
    const note = (final.artistNote || '').trim();
    const noteLines = note ? note.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 6) : [];
    const masterNoteHtml = noteLines.length > 0
      ? `<div class="demo-card-note master-note">${noteLines.map(l => `<span class="demo-card-note-line">${noteEscG(l)}</span>`).join('')}</div>`
      : '';
    const masterCms = final.trackComments || [];
    const masterCmHtml = masterCms.slice(0, 10).map(cm => {
      const cmSafe = noteEscG(cm.text || '');
      const cmAuth = noteEscG(cm.author || '익명');
      return `<div class="demo-card-cm-line"><span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${cmSafe}</span><span class="demo-card-cm-author">— ${cmAuth}</span></div>`;
    }).join('');
    const masterInput = canComment ? `
      <div class="demo-card-cm-input" onclick="event.stopPropagation();">
        <input type="text" id="tct-${final.id}" class="demo-card-cm-input-field" placeholder="${_t('댓글 남기기…', 'Leave a comment…')}" onkeypress="if(event.key==='Enter'){ event.preventDefault(); submitTrackComment('${final.id}'); }">
        <button class="demo-card-cm-send" onclick="event.stopPropagation(); submitTrackComment('${final.id}')" aria-label="남기기"><i class="ri-arrow-right-line"></i></button>
      </div>` : '';
    return `${masterNoteHtml}<div class="demo-card-cm-list">${masterCmHtml}</div>${masterInput}`;
  })() : '';

  // Total carousel pages = cover (always) + each demo. Dots only show on
  // mobile when there's more than one page.
  const totalPages = 1 + demos.length;
  const masterDotTitle = final ? '마스터 음원' : '앨범 커버';
  const projectDotsHtml = totalPages > 1 ? `
    <div class="project-dots" data-page-count="${totalPages}">
      <span class="project-dot active" data-page="0" data-master="${final ? '1' : '0'}" title="${masterDotTitle}"></span>
      ${demos.map((_, i) => `<span class="project-dot" data-page="${i + 1}" title="DEMO ${i + 1}"></span>`).join('')}
    </div>
  ` : '';

  // Master page — yellow sticky-note style, same shape as the demo pages.
  // 마스터가 아직 안 올라온 프로젝트는 제목/아티스트 모두 'Coming Soon' 으로.
  const masterLiked = final ? isTrackLiked(final.id) : false;
  const coverImg = (final && final.cover) || primary.cover || '';
  const _displayTitle = final ? safeTitle : 'Coming Soon';
  const _artistRaw = (final && final.artist) || (primary && primary.artist) || '';
  const _displayArtist = final ? _artistRaw : 'Coming Soon';
  const _safeArtist = (_displayArtist || '').replace(/</g,'&lt;');
  const _badgeText = final ? '✦ MASTER' : 'Coming Soon...';
  const masterPageHtml = `
    <div class="project-page page-cover ${final ? 'has-master' : ''}" data-track-id="${final ? final.id : (primary && primary.id || '')}">
      <div class="demo-card-top">
        <span class="demo-tag master-badge">${_badgeText}</span>
        ${final ? `
          <button class="demo-card-like ${masterLiked ? 'is-liked' : ''}" onclick="event.stopPropagation(); event.preventDefault(); toggleTrackHeart('${final.id}', this)" title="내 우주에 모으기">
            <i class="${masterLiked ? 'ri-heart-fill' : 'ri-heart-line'}"></i>
          </button>
        ` : ''}
      </div>
      <div class="master-head-row" ${final ? `onclick="event.stopPropagation(); playTrack('${final.id}')"` : ''}>
        <div class="master-cover-thumb ${final ? '' : 'no-master'}">
          <img src="${coverImg}" alt="${_displayTitle}" loading="lazy">
          ${final ? '<i class="ri-play-fill master-cover-play"></i>' : ''}
        </div>
        <div class="master-head-info">
          <div class="master-head-title">「${_displayTitle}」</div>
          <div class="master-head-artist">${_safeArtist}</div>
          ${masterDate && final ? `<div class="master-head-meta">발매 · ${masterDate}</div>` : ''}
          ${participantCount > 0 ? `<div class="master-head-meta master-head-cheers"><i class="ri-heart-pulse-fill"></i> ${participantCount}명 응원</div>` : ''}
        </div>
      </div>
      ${cheerBtnHtml}
      ${masterContentHtml}
    </div>
  `;

  // PC ↔ Mobile split:
  //   - Mobile (≤768): the new swipe carousel (master + each demo as pages)
  //   - Desktop: the original layout — big square cover at top of the box,
  //     title + cheer below, demos stacked in a 1-col grid underneath
  // Decided at render time. Resize → user navigates or refreshes to flip.
  const _isMobile = (typeof window !== 'undefined') && window.innerWidth <= 768;

  if (_isMobile) {
    // ───── 사용자 요청 (2026-06-XX): 모바일 새 레이아웃 ─────
    //   Row 1: [MASTER]  [           ]      ← 마스터 좌상단 (Demo 4 바로 위), 우상단 빈
    //   Row 2: [Demo 4]  [Demo 3]
    //   Row 3: [Demo 1]  [Demo 2]
    // 모두 1:1 정사각, 둥근 포스트잇 (접힌 코너 X), 노란색.
    // 데모 슬롯 4개 사전 배치 — 안 올라온 슬롯은 점선+큰 + (탭→그 번호로 업로드).
    // demos.length > 4 면 그 다음 행에 snake 로 추가됨.
    const SNAKE_COLS = 2;
    // i=0 → Demo 1 (row N, col 1)
    // i=1 → Demo 2 (row N, col 2)
    // i=2 → Demo 3 (row N-1, col 2)
    // i=3 → Demo 4 (row N-1, col 1)
    // i=4 → Demo 5 (row N-2, col 1)  ← 다시 좌→우 시작 (마스터는 row 0 col 1 차지)
    // demos 4 개까지는 row 1(master) / row 2(D4,D3) / row 3(D1,D2)
    // 5번째부터는 마스터 위 row 0 인데 col 1 이 차있음 → col 2 (마스터 옆) 부터 시작.
    // 일단 간단하게: demos i 의 row/col 계산 — Demo 1,2 = row=totalDemoRows, Demo 3,4 = row=totalDemoRows-1, ...
    const demoRows = Math.max(2, Math.ceil(Math.max(4, demos.length) / SNAKE_COLS));
    const snakeUpPos = (i) => {
      const pairIdx = Math.floor(i / SNAKE_COLS);
      const pairOffset = i % SNAKE_COLS;
      // 데모 grid 안에서의 row (1-based; 1 = 가장 위, demoRows = 가장 아래)
      const innerRow = demoRows - pairIdx;
      const col = (pairIdx % 2 === 0) ? (pairOffset + 1) : (SNAKE_COLS - pairOffset);
      // 전체 grid 에서는 row 1 이 master. demo 는 row 2 부터.
      return { row: innerRow + 1, col };
    };

    // 2x2 snake-grid (사용자 요청: "마스터카드 / 데모1 > 데모2 / 데모4 < 데모3 이거야~ 맘대로 키우지마")
    const noteEscM = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const mobileCardsHtml = demos.map((v, i) => {
      const pos = snakeUpPos(i);
      const noteRaw = (v.artistNote || '').trim();
      // 카드 작아서 노트 2줄까지만 미리보기 (모달에서 다 봄)
      const noteLines = noteRaw ? noteRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 2) : [];
      const mNoteHtml = noteLines.length > 0
        ? `<div class="demo-card-note" ${canEditArtist ? `onclick="event.stopPropagation(); editArtistNote('${v.id}')" style="cursor: pointer;"` : ''}>
             ${noteLines.map(l => `<span class="demo-card-note-line">${noteEscM(l)}</span>`).join('')}
             ${canEditArtist ? '<i class="ri-pencil-line demo-card-note-edit"></i>' : ''}
           </div>`
        : canEditArtist
          ? `<div class="demo-card-note-empty" onclick="event.stopPropagation(); editArtistNote('${v.id}')">
               <i class="ri-edit-2-line"></i> 탭해서 일지 적기
             </div>`
          : '';
      const cmList = v.trackComments || [];
      // 작은 카드 — 마지막 1개만 미리보기 (모달에서 다 봄, 사용자 요청).
      const cmVisible = cmList.slice(-1);
      const _myIdM = (window.__currentUser && window.__currentUser.id) || null;
      const _myNameM = (window.__currentUser && window.__currentUser.name) || '';
      const cmLinesHtml = cmVisible.map(cm => {
        const cmSafe = noteEscM(cm.text || '');
        const cmAuth = noteEscM(cm.author || '익명');
        const isMine = (_myIdM && cm.authorId && cm.authorId === _myIdM)
                    || (!cm.authorId && _myNameM && cm.author === _myNameM);
        const delBtn = isMine ? `<button class="cm-del-btn" onclick="event.stopPropagation(); deleteTrackComment('${v.id}','${cm.id}')" title="댓글 삭제"><i class="ri-close-line"></i></button>` : '';
        return `<div class="demo-card-cm-line"><span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${cmSafe}</span><span class="demo-card-cm-author">— ${cmAuth}</span>${delBtn}</div>`;
      }).join('');
      // 댓글 영역 — 탭하면 우리들의 벽 모달.
      const mCmHtml = cmList.length > 0
        ? `<div class="demo-card-cm-list" onclick="event.stopPropagation(); openDemoWallModal('${v.id}')" title="${_t('댓글 모두 보기', 'View all comments')}">${cmLinesHtml}</div>`
        : `<div class="demo-card-cm-list demo-card-cm-empty" onclick="event.stopPropagation(); openDemoWallModal('${v.id}')" title="${_t('댓글 보기', 'View comments')}"><div class="demo-card-cm-hint-tap"><i class="ri-chat-3-line"></i> ${_t('첫 댓글 남기기', 'Be the first to comment')}</div></div>`;
      // 입력칸 — 클릭(is-selected) 했을 때만 보임. 줄 스타일 (no box).
      const mInputHtml = canComment ? `
        <div class="demo-card-cm-input" onclick="event.stopPropagation();">
          <input type="text" id="tct-${v.id}" class="demo-card-cm-input-field" placeholder="${_t('댓글 남기기…', 'Leave a comment…')}"
                 onkeyup="if(event.key==='Enter' && !event.isComposing){ submitTrackComment('${v.id}'); }">
        </div>` : '';
      const demoLiked = isTrackLiked(v.id);
      // 카드 탭 = 선택 (is-selected) + 재생. 댓글 영역 탭 = 모달 (cm-list 의 onclick).
      // 인라인 input 은 stopPropagation 으로 카드 onclick 안 타게.
      // 모바일 — 작은 정사각 포스트잇. 본문은 5줄까지 + 클릭하면 모달.
      // grid-row/column 은 CSS 변수로 (--gr/--gc) — 기존 .demo-card 의
      // `grid-row: auto !important` override 를 우회.
      return `
        <div class="demo-card demo-postit-sq is-demo ${v.pinned ? 'is-pinned' : ''}"
             data-track-id="${v.id}" data-project="${pid}"
             style="--gr:${pos.row}; --gc:${pos.col};"
             onclick="selectProjectVersion('${pid}','${v.id}'); playTrack('${v.id}', 'demo'); openDemoWallModal('${v.id}');">
          <div class="demo-postit-tag">DEMO ${i+1}</div>
          ${mNoteHtml || `<div class="demo-postit-body-empty">탭해서 듣기</div>`}
          ${canEditArtist ? `
            <button class="demo-postit-del" onclick="event.stopPropagation(); event.preventDefault(); deleteMyTrack('${v.id}', '${(v.title||'').replace(/'/g,"\\'")}')" title="삭제">
              <i class="ri-close-line"></i>
            </button>
          ` : ''}
          ${mInputHtml}
        </div>
      `;
    }).join('');

    // 빈 슬롯 — 본인 + 방문자 모두 렌더, 그러나 + 표시는 본인의 "바로 다음 슬롯"에만.
    //   · 본인 + 다음 슬롯 (i === filledCount): .is-empty + 큰 + + 클릭→업로드
    //   · 본인 + 그 뒤 슬롯들 (i > filledCount): 방문자 style (점선만)
    //   · 방문자: 모든 빈 슬롯이 점선만
    // 이유: 사용자 요청 — Demo 1 만 올렸으면 Demo 2 만 +, Demo 3/4 는 점선만.
    //       skip 방지 + 다음 단계 명확.
    // grid-row/column 은 CSS 변수 (--gr/--gc) 로 — 기존 !important override 회피.
    const emptySlotsHtml = (() => {
      let html = '';
      const filledCount = demos.length;
      for (let i = filledCount; i < 4; i++) {
        const pos = snakeUpPos(i);
        const nextDemoNum = i + 1;
        const isNextUploadSlot = canEditArtist && (i === filledCount);
        if (isNextUploadSlot) {
          html += `
            <div class="demo-card demo-postit-sq is-empty"
                 style="--gr:${pos.row}; --gc:${pos.col};"
                 onclick="quickUploadDemoToProject('${pid}')"
                 title="DEMO ${nextDemoNum} 업로드">
              <i class="ri-add-line demo-postit-plus"></i>
              <div class="demo-postit-plus-label">DEMO ${nextDemoNum}</div>
            </div>
          `;
        } else {
          html += `
            <div class="demo-card demo-postit-sq is-empty-visitor"
                 style="--gr:${pos.row}; --gc:${pos.col};"
                 aria-hidden="true">
              <div class="demo-postit-vlabel">DEMO ${nextDemoNum}</div>
            </div>
          `;
        }
      }
      return html;
    })();

    // 마스터 — 정사각 카드 (좌상단, Demo 4 위). 사진 있으면 그대로, 없으면 검정 + 필기체 coming soon.
    const finalMobileCover = final && final.cover ? final.cover : '';
    const masterChipDate = (final && masterDate) ? `발매 · ${masterDate}` : '';
    const masterMobileHtml = `
      <div class="master-postit-sq ${final ? 'has-cover' : 'no-cover'} ${final && finalHasCover ? '' : 'no-img'}"
           style="--gr:1; --gc:1;"
           ${final ? `onclick="event.stopPropagation(); playTrack('${final.id}'); openSongInfoModal('${final.id}');"` : ''}
           ${final ? `title="탭하면 곡 소개 + 재생"` : ''}>
        ${final && finalHasCover
          ? `<img src="${finalMobileCover}" alt="${safeTitle}" loading="lazy">`
          : `<div class="m-coming-script">coming<br>soon</div>`}
        ${masterChipDate ? `<span class="m-chip-date">${masterChipDate}</span>` : ''}
      </div>
    `;
    // 마스터 옆 (row 1, col 2) — 제목 + 아티스트 + 발매일 작은 메타 박스.
    // 사용자 요청: 마스터 옆 빈 공간에 [제목] [발매일] 같이 표시.
    const masterMetaHtml = `
      <div class="master-meta-sq" style="--gr:1; --gc:2;"
           ${final ? `onclick="event.stopPropagation(); openSongInfoModal('${final.id}');" title="곡 소개 보기"` : ''}>
        <div class="mm-title">${final ? `「${safeTitle}」` : '「Coming Soon」'}</div>
        ${final ? `<div class="mm-artist">${((final.artist || primary.artist || '').replace(/</g,'&lt;'))}</div>` : ''}
        ${masterDate && final ? `<div class="mm-date">${masterDate}</div>` : ''}
        ${final ? `<div class="mm-tag">발매 (Release)</div>` : `<div class="mm-tag mm-tag-coming">준비중</div>`}
      </div>
    `;

    return `
      <div class="project-box reveal project-box-mobile" data-project="${pid}">
        <div class="mobile-demo-grid">
          ${masterMobileHtml}
          ${masterMetaHtml}
          ${mobileCardsHtml}
          ${emptySlotsHtml}
        </div>
      </div>
    `;
  }

  // Desktop — release card (cover + meta) 묶음 + 글소개 포스트잇이 옆에 (사용자 요청).
  // 응원하기 button intentionally hidden (user request) until the platform
  // is past early-stage.
  return `
    <div class="project-box reveal" data-project="${pid}">
      <div class="project-header">
        <div class="project-album-card">
          <div class="release-card-block">
            ${coverHtml}
            <div class="project-album-meta">
              <h3 class="project-title">「${final ? safeTitle : 'Coming Soon'}」</h3>
              <div class="project-artist-line">${final ? ((final.artist || primary.artist || '').replace(/</g,'&lt;')) : 'Coming Soon'}</div>
              ${/* 발매일 검정 띠 — 사진 좌상단으로 이동했으므로 여기선 제거 (사용자 요청) */ ''}
              ${participantCount > 0 ? `<div class="project-participants project-cheers"><i class="ri-heart-pulse-fill"></i> ${participantCount}명이 응원해</div>` : ''}
            </div>
          </div>
          ${releaseNoteHtml}
        </div>
      </div>
      ${(demos.length > 0 || canEditArtist) ? `
        <div class="demo-path" style="grid-template-columns: repeat(${cols}, 1fr);">
          ${cardsHtml}
        </div>
      ` : ''}
    </div>
  `;
}

// ===================== DEMO SHAPE SELECTOR — 도형 선택 = 메인 노출 핀 =====================
// Tap a shape: pin this demo on main + set the shape it shows as
// Tap same shape again: unpin (no main exposure)
// Tap different shape: switch to new shape (still pinned)
// One-per-project rule: only one demo per project can be pinned
window.selectDemoShape = function(trackId, projectId, shapeKey) {
  if (!trackId || !projectId || !shapeKey) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) return;
  const isAlreadyActive = track.pinned && track.shape === shapeKey;
  if (isAlreadyActive) {
    // Unpin
    track.pinned = false;
    window.DB.save(db);
    showToast(_t('메인 노출 해제', 'Removed from main'));
  } else {
    // Unpin all other demos in this project first
    (db.tracks || []).forEach(t => {
      if (t && t.projectId === projectId && t.isDemo && t.id !== trackId) {
        t.pinned = false;
      }
    });
    track.pinned = true;
    track.shape = shapeKey;
    window.DB.save(db);
    showToast(_t(`${shapeKey === 'star' ? '⭐' : shapeKey === 'circle' ? '●' : shapeKey === 'triangle' ? '▲' : shapeKey === 'diamond' ? '◆' : '🔷'} 메인 노출 도형 변경됨`, `${shapeKey === 'star' ? '⭐' : shapeKey === 'circle' ? '●' : shapeKey === 'triangle' ? '▲' : shapeKey === 'diamond' ? '◆' : '🔷'} Main shape changed`));
  }
  if (typeof renderProfile === 'function' && currentView === 'profile') renderProfile();
};
// Backwards compat
window.toggleDemoPin = window.toggleDemoPin || function() {};

// Shape picker modal — clean upload-like flow
window.openShapePicker = function(trackId, projectId) {
  if (!trackId || !projectId) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) return;
  const SHAPE_OPTIONS = [
    { key: 'circle',        icon: 'ri-circle-fill',                label: '원' },
    { key: 'oval',          icon: 'ri-checkbox-blank-circle-fill', label: '타원' },
    { key: 'rect',          icon: 'ri-checkbox-blank-fill',        label: '사각' },
    { key: 'triangle',      icon: 'ri-triangle-fill',              label: '세모' },
    { key: 'star',          icon: 'ri-star-fill',                  label: '별' },
    { key: 'diamond',       icon: 'ri-rhombus-fill',               label: '다이아' },
    { key: 'hexagon',       icon: 'ri-shape-2-fill',               label: '육각' },
    { key: 'parallelogram', icon: 'ri-parking-box-fill',           label: '평행' }
  ];
  const safeTitle = (track.title || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const isPinnedNow = !!track.pinned;
  const currentShapeLabel = (SHAPE_OPTIONS.find(o => o.key === track.shape) || {label:'—'}).label;

  const content = document.getElementById('sto-mini-content');
  if (!content) return;

  const optionsGrid = SHAPE_OPTIONS.map(opt => {
    const isActive = isPinnedNow && track.shape === opt.key;
    return `
      <button class="shape-pick-card ${isActive ? 'is-active' : ''}"
              onclick="event.stopPropagation(); selectDemoShape('${trackId}','${projectId}','${opt.key}'); closeStoMini();">
        <i class="${opt.icon}"></i>
        <span>${opt.label}</span>
      </button>
    `;
  }).join('');

  content.innerHTML = `
    <button class="sto-mini-close" onclick="closeStoMini()" aria-label="닫기"><i class="ri-close-line"></i></button>
    <div class="sto-mini-card">
      <div class="sto-mini-banner" style="background: linear-gradient(135deg, #FFE082, #FFD600); color: #111;">
        <span class="sto-mini-banner-emoji">🔷</span>
        <div class="sto-mini-banner-text">
          <div class="sto-mini-eyebrow" style="color:#111;">메인 노출 도형</div>
          <div class="sto-mini-title" style="color:#111; text-shadow:none;">「${safeTitle}」</div>
        </div>
      </div>
      <p class="sto-mini-desc">
        ${isPinnedNow
          ? `현재 <strong>${currentShapeLabel}</strong> 모양으로 메인 페이지에 노출 중이에요.`
          : '도형을 고르면 메인(도형/디스커버) 페이지에 그 모양으로 노출돼요.'}
        <br>같은 프로젝트의 다른 데모는 자동으로 빠져요.
      </p>
      <div class="shape-pick-grid">
        ${optionsGrid}
      </div>
      ${isPinnedNow ? `
        <div style="padding: 0 18px 14px;">
          <button class="btn-primary" style="width:100%; padding:10px; background:#111; color:#fff; border:2px solid #111; border-radius:6px;"
                  onclick="selectDemoShape('${trackId}','${projectId}','${track.shape || 'circle'}'); closeStoMini();">
            메인 노출 해제
          </button>
        </div>
      ` : ''}
      <div class="sto-mini-footer">한 프로젝트당 1개 데모만 메인에 노출돼요</div>
    </div>
  `;
  const modal = document.getElementById('sto-mini-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

// ===================== Per-demo SPO config =====================
// 각 데모마다 다른 SPO 설정 (목표/단위/혜택)
function getStoConfigForTrack(track) {
  if (!track) return null;
  if (track.stoConfig) return track.stoConfig;
  // Auto-generate based on demo number + popularity (mock for demo)
  const verNum = parseInt((track.version || 'demo1').replace(/[^0-9]/g, '') || '1', 10);
  const goalKrw = [500000, 1000000, 2000000][Math.min(verNum-1, 2)] || 500000;
  const unitMin = [10000, 30000, 50000][Math.min(verNum-1, 2)] || 10000;
  const sharePercent = [8, 12, 18][Math.min(verNum-1, 2)] || 8;
  // Mock raised based on engagement
  const raisedKrw = Math.min(goalKrw, Math.floor((track.likes || 0) * 1500 + (track.plays || 0) * 30));
  const perksByVer = [
    ['엔딩 크레딧 이름 게재', '✨ STO 지분 적립', '데모 발전 과정 공유'],
    ['엔딩 크레딧 이름 게재', '비공개 마스터 선공개', '✨ STO 지분 + 우선 청취권'],
    ['엔딩 크레딧 이름 게재', '비공개 마스터 선공개', '오프라인 공감홀 초대권 🎤']
  ];
  return {
    goalKrw,
    unitMin,
    raisedKrw,
    sharePercent,
    perks: perksByVer[Math.min(verNum-1, 2)] || perksByVer[0]
  };
}
window.getStoConfigForTrack = getStoConfigForTrack;

// ===================== POLL WIDGET — 곡 결정 투표 (후원자 2x 가중치) =====================
// localStorage 기반 mock — 추후 Supabase track_polls / track_poll_votes 테이블로 이전
function _getMyVotes() {
  try { return JSON.parse(localStorage.getItem('offstage_my_votes') || '{}') || {}; }
  catch (_) { return {}; }
}
function _saveMyVotes(votes) {
  try { localStorage.setItem('offstage_my_votes', JSON.stringify(votes)); } catch (_) {}
}
function _hasBackedTrack(trackId) {
  if (typeof window._getMyBackings !== 'function') return false;
  return (window._getMyBackings() || []).some(b => b.trackId === trackId);
}

function renderPollWidget(track) {
  const poll = track.poll;
  if (!poll) return '';
  const myVotes = _getMyVotes();
  const myChoice = myVotes[track.id];
  const isBacker = _hasBackedTrack(track.id);
  // Total weighted votes: each backer vote counts 2x
  const totalWeighted = poll.options.reduce((sum, o) => sum + (o.votes || 0) + (o.backerVotes || 0), 0);
  const safeQ = (poll.question || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const optionsHtml = poll.options.map(o => {
    const weighted = (o.votes || 0) + (o.backerVotes || 0); // backer votes already separate counted
    const pct = totalWeighted > 0 ? Math.round((weighted / totalWeighted) * 100) : 0;
    const safeLabel = (o.label || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const isMine = myChoice === o.key;
    return `
      <button class="poll-option ${isMine ? 'is-mine' : ''}" onclick="event.stopPropagation(); window.votePoll('${track.id}', '${o.key}')">
        <div class="poll-option-fill" style="width:${pct}%;"></div>
        <div class="poll-option-content">
          <span class="poll-option-label">${safeLabel}</span>
          <span class="poll-option-pct">${pct}%</span>
        </div>
        <div class="poll-option-meta">
          ${o.backerVotes || 0} 후원자 · ${o.votes || 0} 청취자${isMine ? ' · <strong>내 표</strong>' : ''}
        </div>
      </button>
    `;
  }).join('');

  return `
    <div class="poll-widget" data-track-id="${track.id}">
      <div class="poll-header">
        <span class="poll-icon">🗳</span>
        <span class="poll-question">${safeQ}</span>
        <span class="poll-tag">${isBacker ? '후원자 (2× 가중치)' : '청취자 1표'}</span>
      </div>
      <div class="poll-options">
        ${optionsHtml}
      </div>
      <div class="poll-footer">
        <span>총 ${totalWeighted}표</span>
        ${myChoice ? '<span>· 내 표 반영됨 ✓</span>' : '<span>· 클릭해서 투표</span>'}
      </div>
    </div>
  `;
}

window.votePoll = function(trackId, optionKey) {
  if (!trackId || !optionKey) return;
  const db = window.DB.get();
  if (!db.currentUser) {
    showToast(_t('로그인 후 투표 가능', 'Sign in to vote'));
    return;
  }
  const myVotes = _getMyVotes();
  const prevChoice = myVotes[trackId];
  if (prevChoice === optionKey) {
    // Toggle off — remove vote
    delete myVotes[trackId];
  } else {
    myVotes[trackId] = optionKey;
  }
  _saveMyVotes(myVotes);

  // Update the track's poll counts (mock — add/remove from option counts)
  const isBacker = _hasBackedTrack(trackId);
  const track = (db.tracks || []).find(t => t.id === trackId);
  if (track && track.poll) {
    track.poll.options.forEach(o => {
      // Remove previous
      if (prevChoice && o.key === prevChoice) {
        if (isBacker) o.backerVotes = Math.max(0, (o.backerVotes||0) - 1);
        else o.votes = Math.max(0, (o.votes||0) - 1);
      }
      // Add new
      if (optionKey !== prevChoice && o.key === optionKey) {
        if (isBacker) o.backerVotes = (o.backerVotes||0) + 1;
        else o.votes = (o.votes||0) + 1;
      }
    });
    window.DB.save(db);
  }

  // Re-render the poll widget in place
  const widget = document.querySelector(`.poll-widget[data-track-id="${trackId}"]`);
  if (widget && track) {
    widget.outerHTML = renderPollWidget(track);
  }
  if (myVotes[trackId]) {
    showToast(isBacker ? _t('🗳 후원자 표 반영됨 (2×)', '🗳 Backer vote counted (2×)') : _t('🗳 표 반영됨', '🗳 Vote counted'));
  } else {
    showToast(_t('표 취소됨', 'Vote canceled'));
  }
};

// Stage advance handler
window.setProjectStageHandler = async function(projectId, stage) {
  if (!window.Tracks) return;
  try {
    await window.Tracks.setProjectStage(projectId, stage);
    showToast(_t('단계 변경됨 ✨', 'Stage changed ✨'));
    // Re-render lightly: just update the timeline classes in DOM
    const box = document.querySelector(`.project-box[data-project="${projectId}"]`);
    if (box) {
      const tl = box.querySelector('.stage-timeline');
      if (tl) tl.dataset.current = stage;
      // Easiest: re-render the page to ensure consistent state
      if (currentView === 'artist') {
        const h = document.querySelector('.artist-strip h1');
        if (h) renderArtistProfile(h.textContent.trim());
      } else if (currentView === 'profile') {
        renderProfile();
      }
    }
  } catch (e) {
    alert('단계 변경 실패: ' + (e.message || e));
  }
};

// Load backer strip for visible projects
async function loadVisibleBackerStrips() {
  if (!window.Tracks || !window.Tracks.fetchProjectBackerStrip) return;
  const stripEls = document.querySelectorAll('[data-project-backers]');
  for (const el of stripEls) {
    const pid = el.dataset.projectBackers;
    if (!pid) continue;
    try {
      const { backers, total } = await window.Tracks.fetchProjectBackerStrip(pid, 8);
      const avatarsEl = document.getElementById('backer-strip-' + pid);
      const countEl = document.getElementById('backer-strip-count-' + pid);
      if (avatarsEl) {
        avatarsEl.innerHTML = backers.slice(0, 6).map(b =>
          `<img src="${b.avatar}" class="backer-strip-avatar" title="${(b.name||'').replace(/"/g,'&quot;')}" alt="">`
        ).join('');
      }
      if (countEl) {
        countEl.textContent = total > 0 ? `${total}명` : '아직 아무도 — 첫 번째가 되어봐';
      }
    } catch (e) { /* silent */ }
  }
}

// ===== Project version selection =====
// Re-render artist/profile pages on resize — but only when cols threshold changes
// (prevents iOS Safari URL-bar hide/show from triggering constant re-renders)
let _snakeResizeTimer = null;
let _snakeLastCols = null;
function _colsFor(w) { return w < 560 ? 2 : (w < 860 ? 3 : 4); }
window.addEventListener('resize', () => {
  if (currentView !== 'artist' && currentView !== 'profile' && currentView !== 'tag') return;
  const newCols = _colsFor(window.innerWidth);
  if (_snakeLastCols === null) { _snakeLastCols = newCols; return; }
  if (newCols === _snakeLastCols) return;
  _snakeLastCols = newCols;
  clearTimeout(_snakeResizeTimer);
  _snakeResizeTimer = setTimeout(() => {
    if (currentView === 'artist') {
      const h = document.querySelector('.artist-strip h1');
      if (h) renderArtistProfile(h.textContent.trim());
    } else if (currentView === 'profile') {
      renderProfile();
    }
    // tag page uses track grid not snake — no re-render needed
  }, 220);
});

window.selectProjectVersion = async function(projectId, trackId) {
  const box = document.querySelector(`.project-box[data-project="${projectId}"]`);
  if (!box) return;
  box.querySelectorAll('.demo-card').forEach(c => c.classList.toggle('is-selected', c.dataset.trackId === trackId));
  box.querySelectorAll('.version-panel').forEach(p => p.classList.toggle('active', p.dataset.trackId === trackId));

  // For Supabase tracks, fetch fresh comments once per session
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t.id === trackId);
  if (track && track.__supabase && !track._commentsLoaded && window.Tracks) {
    track._commentsLoaded = true;  // prevent re-fetch loop
    try {
      const comments = await window.Tracks.fetchComments(trackId);
      track.trackComments = comments;
      // Re-render quietly (don't loop) — directly update panel HTML
      const panel = box.querySelector(`.version-panel[data-track-id="${trackId}"]`);
      if (panel) {
        const listEl = panel.querySelector('.demo-comments');
        if (listEl && comments.length) {
          // Re-render just the comment list region
          const title = listEl.querySelector('.scribble-title')?.outerHTML || '';
          const inputRow = listEl.querySelector('.scribble-input-row')?.outerHTML || '';
          listEl.innerHTML = title + comments.map((cm, ci) => {
            const cmSafe = (cm.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const cmAuth = (cm.author || '익명').replace(/</g,'&lt;');
            return `<div class="comment-line" style="padding-left:${Math.min(ci,4)*14+4}px;"><span class="comment-arrow">ㄴ</span><span class="comment-text">${cmSafe}</span><span class="comment-author">— ${cmAuth}</span></div>`;
          }).join('') + inputRow;
        }
      }
    } catch (e) {
      console.warn('[selectProjectVersion] fetchComments', e);
    }
  }
};

// ===== Version expand + comment + edit-note handlers =====
window.toggleVersion = function(trackId) {
  const wrap = document.getElementById('vw-' + trackId);
  if (!wrap) return;
  wrap.classList.toggle('open');
};

window.submitTrackComment = async function(trackId) {
  const authEl = document.getElementById('tca-' + trackId);
  const txtEl = document.getElementById('tct-' + trackId);
  if (!txtEl) return;
  const text = (txtEl.value || '').trim();
  if (!text) return;
  // Prefer form input, then current user profile, then OAuth metadata fallbacks
  const profileName = (window.__currentUser && window.__currentUser.name) || '';
  const authorName = ((authEl && authEl.value) || profileName || '').trim();
  const sendBtn = document.querySelector(`#exp-${trackId} .scribble-send, .version-panel[data-track-id="${trackId}"] .scribble-send`);
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '남기는 중…'; }

  const db = window.DB.get();
  const track = db.tracks.find(t => t.id === trackId);
  const isSupabaseTrack = track && track.__supabase;
  const myId = (window.__currentUser && window.__currentUser.id) || null;

  // ── OPTIMISTIC UPDATE ── 사용자 요청: 즉시 반응 + 모달 실시간 동기.
  //   1) 임시 ID 로 즉시 local cache + DOM 업데이트 → UI 즉시 응답
  //   2) 백그라운드로 네트워크 전송 (await)
  //   3) 성공: 임시 id 를 real id 로 교체  /  실패: rollback
  const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const tempComment = {
    id: tempId,
    author: authorName || '익명',
    authorId: myId,
    text,
    createdAt: new Date().toISOString(),
    __optimistic: true
  };
  // ⚠ window.DB.get() 는 매번 새 parse → 다른 reference. window.__tracks 가
  //   진짜 in-memory 단일 진실원이므로 거기에도 반드시 push.
  //   + localStorage 에도 즉시 save → 다음 DB.get() 호출도 최신 데이터 봄.
  if (Array.isArray(window.__tracks)) {
    const tMem = window.__tracks.find(t => t && t.id === trackId);
    if (tMem) {
      if (!Array.isArray(tMem.trackComments)) tMem.trackComments = [];
      tMem.trackComments.push(tempComment);
    }
  }
  if (track) {
    if (!Array.isArray(track.trackComments)) track.trackComments = [];
    track.trackComments.push(tempComment);
    try { window.DB.save(db); } catch (_) {}    // localStorage 즉시 반영
  }
  if (txtEl) txtEl.value = '';        // 입력칸 즉시 비우기
  // 모든 곳 DOM 업데이트 (inline + 모든 모달)
  _refreshTrackCommentUI(trackId);

  // 백그라운드 — 실제 저장
  let newComment = null;
  try {
    if (isSupabaseTrack && window.Tracks) {
      newComment = await window.Tracks.addComment(trackId, { text, authorName });
    } else {
      newComment = {
        id: 'tc' + Date.now(),
        author: authorName || '익명',
        authorId: myId,
        text,
        createdAt: new Date().toISOString()
      };
      // ⚠ DB.addTrackComment 호출 금지 — 그 함수는 자체 DB.get() (temp 포함된
      //   localStorage) 에 real 을 또 push + save 해서 [temp, real] 중복을 만든다.
      //   아래 _replaceTmp + DB.save 가 temp→real 교체를 한 번에 처리.
    }
    // 임시 → real 교체 (id 만 다름) — window.__tracks 와 db.tracks 양쪽 다
    const _replaceTmp = (arr) => {
      if (!Array.isArray(arr)) return;
      // temp 제거 후, real 이 아직 없을 때만 추가. (Tracks.addComment 가 window.__tracks 에
      // real 을 이미 push 했을 수 있어서 — 안 그러면 같은 id 댓글이 2개가 됨 → 삭제 시 둘 다 삭제)
      const ti = arr.findIndex(c => c && c.id === tempId);
      if (ti >= 0) arr.splice(ti, 1);
      if (newComment && !arr.some(c => c && c.id === newComment.id)) arr.push(newComment);
    };
    if (Array.isArray(window.__tracks)) {
      const tMem = window.__tracks.find(t => t && t.id === trackId);
      if (tMem) _replaceTmp(tMem.trackComments);
    }
    if (track) {
      _replaceTmp(track.trackComments);
      // localStorage 의 temp id 를 real id 로 영구화 — 안 하면 새로고침 후
      // tmp_ id 댓글이 남아 삭제 버튼이 서버에 없는 id 로 삭제 시도함.
      try { window.DB.save(db); } catch (_) {}
    }
    // real id 로 갱신된 DOM (삭제 버튼 onclick 의 commentId 가 바뀜)
    _refreshTrackCommentUI(trackId);
  } catch (e) {
    // rollback — window.__tracks + db.tracks 양쪽에서 임시 제거
    const _filterOut = (arr) => Array.isArray(arr)
      ? arr.filter(c => c && c.id !== tempId) : arr;
    if (Array.isArray(window.__tracks)) {
      const tMem = window.__tracks.find(t => t && t.id === trackId);
      if (tMem) tMem.trackComments = _filterOut(tMem.trackComments);
    }
    if (track) {
      track.trackComments = _filterOut(track.trackComments);
      try { window.DB.save(db); } catch (_) {}   // localStorage 의 temp 도 제거
    }
    _refreshTrackCommentUI(trackId);
    alert('댓글 저장 실패: ' + (e.message || e));
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '남기기'; }
    if (txtEl) txtEl.value = text;    // 입력 복원
    return;
  }

  // 최종 DOM 동기화 — optimistic update 후 real id 받은 상태에서 재호출
  // (deleteBtn 의 commentId 가 real id 로 정확히 들어가야 함)
  try { _refreshTrackCommentUI(trackId); } catch (_) {}
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '남기기'; }
  showToast(_t('낙서 남겼어요', 'Scribble posted'));
};

// ===================== 댓글 UI 동기 helper (single source of truth) =====================
// trackId 의 모든 댓글 표시 영역을 track.trackComments 기준으로 재구성.
// - 인라인 카드 (.demo-card-cm-list)
// - openDemoWallModal (#demo-wall-modal #dwm-cm-list + .dwm-cm-count)
// - openTrackCommentsModal (#track-comments-modal #tcm-list + count)
// 호출: submit/delete/optimistic insert 후 어디서든.
window._refreshTrackCommentUI = function (trackId) {
  // ⚠ window.DB.get() 는 localStorage 에서 매번 새로 parse → 다른 reference.
  //   해결: window.__tracks (in-memory) 우선, 둘 다 검사 후 댓글 합집합 사용.
  //   이렇게 하면 push 가 어느 한쪽만 됐어도 최신 데이터가 보임.
  const cmsByDriver = [];
  if (Array.isArray(window.__tracks)) {
    const t = window.__tracks.find(t => t && t.id === trackId);
    if (t && Array.isArray(t.trackComments)) cmsByDriver.push(t.trackComments);
  }
  try {
    const db = window.DB.get();
    const t = (db.tracks || []).find(t => t && t.id === trackId);
    if (t && Array.isArray(t.trackComments)) cmsByDriver.push(t.trackComments);
  } catch (_) {}
  // 가장 긴 배열 = 가장 최신 (둘 다 동일이면 동일).
  let allCms = [];
  cmsByDriver.forEach(arr => { if (arr.length > allCms.length) allCms = arr; });
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const myId   = (window.__currentUser && window.__currentUser.id) || null;
  const myName = (window.__currentUser && window.__currentUser.name) || '';
  const isMineFn = (cm) => (myId && cm.authorId && cm.authorId === myId)
                       || (!cm.authorId && myName && cm.author === myName);

  // 1) 인라인 카드 (데모/마스터) — 마지막 1개만 (사용자 요청)
  try {
    const INLINE = 1;
    const visible = allCms.slice(-INLINE);
    const linesHtml = visible.map(cm => {
      const t = esc(cm.text || '');
      const a = esc(cm.author || '익명');
      return `<div class="demo-card-cm-line"><span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${t}</span><span class="demo-card-cm-author">— ${a}</span></div>`;
    }).join('');
    const hintHtml = '';      // 빨간 "댓글 N개 · 탭해서 모두 보기" 제거 (사용자 요청)
    document.querySelectorAll(
      `.demo-card[data-track-id="${trackId}"] .demo-card-cm-list, .project-master-mobile[data-track-id="${trackId}"] .demo-card-cm-list`
    ).forEach(l => { l.innerHTML = linesHtml + hintHtml; });
  } catch (_) {}

  // 2) 우리들의 벽 모달 (openDemoWallModal) — 인플레이스 갱신.
  //    실패하면 fallback: 모달 통째로 재오픈 (input focus 잃지만 데이터는 최신).
  let wallUpdated = false;
  try {
    const wallModal = document.getElementById('demo-wall-modal');
    if (wallModal) {
      const wallList = wallModal.querySelector('#dwm-cm-list');
      if (wallList) {
        wallList.innerHTML = allCms.map(cm => {
          const ct = esc(cm.text || '');
          const ca = esc(cm.author || '익명');
          const isMine = isMineFn(cm);
          const dBtn = isMine ? `<button class="dwm-cm-del" type="button" onclick="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true); return false;" ontouchend="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true);" title="댓글 삭제" aria-label="댓글 삭제"><i class="ri-close-line"></i></button>` : '';
          return `<div class="dwm-cm-line"><span class="dwm-cm-arrow">ㄴ</span><span class="dwm-cm-text">${ct}</span><span class="dwm-cm-auth">— ${ca}</span>${dBtn}</div>`;
        }).join('');
        wallList.scrollTop = wallList.scrollHeight;
        wallUpdated = true;
      }
      const cnt = wallModal.querySelector('.dwm-cm-count');
      if (cnt) cnt.textContent = allCms.length;
    }
  } catch (e) { console.warn('[_refreshTrackCommentUI] wallModal', e); }
  // Fallback — wall 모달 있는데 list 가 안 찾혔으면 모달 통째로 재오픈
  if (!wallUpdated && document.getElementById('demo-wall-modal') && typeof window.openDemoWallModal === 'function') {
    try { window.openDemoWallModal(trackId); } catch (_) {}
  }

  // 3) 트랙 댓글 모달 (openTrackCommentsModal) — 마스터/모바일 카드에서 사용
  try {
    const tcm = document.getElementById('track-comments-modal');
    if (tcm) {
      const tcmList = tcm.querySelector('#tcm-list, .tcm-list');
      if (tcmList) {
        tcmList.innerHTML = allCms.map(cm => {
          const ct = esc(cm.text || '');
          const ca = esc(cm.author || '익명');
          const isMine = isMineFn(cm);
          const dBtn = isMine ? `<button class="tcm-cm-del" type="button" onclick="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true); return false;" title="댓글 삭제" aria-label="댓글 삭제"><i class="ri-close-line"></i></button>` : '';
          return `<div class="tcm-cm-line"><span class="tcm-cm-arrow">ㄴ</span><span class="tcm-cm-text">${ct}</span><span class="tcm-cm-auth">— ${ca}</span>${dBtn}</div>`;
        }).join('');
        tcmList.scrollTop = tcmList.scrollHeight;
      }
      const tcmCnt = tcm.querySelector('.tcm-count, #tcm-count');
      if (tcmCnt) tcmCnt.textContent = allCms.length;
    }
  } catch (_) {}
};

// ===================== 댓글 삭제 (PC + 모바일 + 모달 공용) =====================
// 사용자 보고: 삭제 후 새로고침 해야 적용되는 이슈.
// 원인:
//   1) db.tracks / window.__tracks 의 트랙 객체 reference 가 다른 경우 한쪽만 변경됨
//   2) 인라인 부분 DOM 갱신 로직이 stale 한 슬라이스(-2) 사용 + 마스터/데모 컨테이너 차이
//   3) renderProjectBox 가 IIFE 안에서 cmList 캡처 → 객체 자체를 바꿔도 미리 캡처한 게 stale
// 해결: 1) 양쪽 캐시 모두 명시 갱신  2) 트랙이 속한 페이지 전체를 다시 렌더 (최대한 robust)
window.deleteTrackComment = async function(trackId, commentId, fromModal) {
  if (!trackId || !commentId) return;
  if (!confirm('이 댓글을 지울까요?')) return;
  // local ids: 'tc<timestamp>' / optimistic 임시: 'tmp_..' — 둘 다 서버 삭제 시도 금지
  const _cid = String(commentId);
  const isSupabaseComment = !_cid.startsWith('tc') && !_cid.startsWith('tmp_');
  try {
    // 1) Supabase 삭제 (네트워크)
    if (window.Tracks && window.Tracks.deleteComment && isSupabaseComment) {
      await window.Tracks.deleteComment(commentId, trackId);
    }

    // 2) 양쪽 인메모리 캐시 (window.__tracks, db.tracks) 의 trackComments 모두 갱신.
    //    같은 객체 reference 면 한번에 끝나지만, 다른 reference 일 때를 대비.
    const _filterOut = (arr) => Array.isArray(arr) ? arr.filter(c => c && c.id !== commentId) : arr;
    if (Array.isArray(window.__tracks)) {
      const t = window.__tracks.find(x => x && x.id === trackId);
      if (t && Array.isArray(t.trackComments)) t.trackComments = _filterOut(t.trackComments);
    }
    const db = window.DB.get();
    if (db && Array.isArray(db.tracks)) {
      const t2 = db.tracks.find(x => x && x.id === trackId);
      if (t2 && Array.isArray(t2.trackComments)) t2.trackComments = _filterOut(t2.trackComments);
      try { window.DB.save(db); } catch (_) {}
    }

    showToast(_t('댓글 삭제됨', 'Comment deleted'));

    // 3) 모달 열려있으면 모달 다시 그리기 (최신 댓글 리스트로).
    //    note-detail-modal (벽 스타일) 도 같은 식으로 갱신.
    if (fromModal) {
      if (document.getElementById('demo-wall-modal') && typeof window.openDemoWallModal === 'function') {
        window.openDemoWallModal(trackId);
      } else if (document.getElementById('note-detail-modal') && typeof window.openDemoWallModal === 'function') {
        // 호환 — 벽 모달이라면 다시 그리기 시도
        window.openDemoWallModal(trackId);
      }
    }

    // 4) 인라인 카드 갱신 — 현재 보고 있는 페이지를 통째로 다시 렌더.
    //    부분 DOM 패치는 PC_INLINE/마스터/벽 등 컨텍스트마다 셀렉터가 달라서 부정확.
    //    Re-render 가 가장 robust 하고 다른 곳(우리들의 벽 등) 에도 일관 반영.
    try {
      const view = (typeof currentView !== 'undefined') ? currentView : '';
      if (view === 'artist' && typeof renderArtistProfile === 'function') {
        const m = (window.location.hash || '').match(/#\/artist:([^/?]+)/);
        if (m) renderArtistProfile(decodeURIComponent(m[1]));
      } else if (view === 'profile' && typeof renderProfile === 'function') {
        renderProfile();
      } else if (view === 'wall' && typeof renderWall === 'function') {
        renderWall();
      } else if (view === 'shapes' && typeof renderShapes === 'function') {
        // 도형 페이지 — 트랙 카드는 없지만 데모 댓글 변경이 다른 페이지에 영향 줄 일 적음.
        // (혹시 모를 inline 표시 보장)
      }
    } catch (e) { console.warn('[deleteTrackComment] re-render fail', e); }
  } catch (e) {
    alert('댓글 삭제 실패: ' + (e.message || e));
  }
};

// Toggle 참여하기 on a demo/master
window.toggleJoinTrack = async function(trackId) {
  if (!window.Backers) return;
  const user = window.__currentUser;
  if (!user) {
    if (confirm('참여하려면 로그인이 필요해요. 로그인 할까요?')) navigateTo('auth');
    return;
  }
  const btn = document.querySelector(`.join-btn[data-join-track-id="${trackId}"]`);
  if (btn) btn.disabled = true;
  try {
    const { backing } = await window.Backers.toggle(trackId);
    refreshJoinUI(trackId);
    showToast(backing ? _t('참여했어요 🤝', 'Joined 🤝') : _t('참여 취소됐어요', 'Left'));
  } catch (e) {
    alert(e.message || '참여 실패');
  } finally {
    if (btn) btn.disabled = false;
  }
};

// Update join button + count for a track in current DOM
function refreshJoinUI(trackId) {
  const btn = document.querySelector(`.join-btn[data-join-track-id="${trackId}"]`);
  const count = (window.__backerCounts && window.__backerCounts.get(trackId)) || 0;
  const isBacking = window.Backers && window.Backers.isBacking(trackId);
  if (btn) {
    btn.classList.toggle('is-joined', isBacking);
    const labelEl = btn.querySelector('.join-label');
    if (labelEl) labelEl.textContent = isBacking ? '참여 중' : '참여하기';
    const iconEl = btn.querySelector('i');
    if (iconEl) iconEl.className = isBacking ? 'ri-hand-heart-fill' : 'ri-hand-heart-line';
  }
  document.querySelectorAll(`#join-count-${trackId}`).forEach(el => {
    el.textContent = count > 0 ? `· ${count}명 참여 중` : '';
  });
}

// Load backer counts for all visible Supabase tracks in the current DOM
async function loadVisibleBackerCounts() {
  if (!window.Backers || !window.Backers.fetchCountsBulk) return;
  const trackIds = Array.from(document.querySelectorAll('[data-join-track]'))
    .map(el => el.dataset.joinTrack)
    .filter(Boolean);
  if (!trackIds.length) return;
  await window.Backers.fetchCountsBulk(trackIds);
  trackIds.forEach(refreshJoinUI);
}

window.changeProjectCover = async function(projectId) {
  if (!window.Tracks) return;
  // Trigger hidden file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('커버 이미지는 5MB 이하만 가능해요.'); return; }
    showToast(_t('커버 업로드 중…', 'Uploading cover…'));
    try {
      const url = await window.Tracks.uploadFile(file, 'covers');
      await window.Tracks.setProjectCover(projectId, url);
      // Refresh cache + re-render current view
      await window.Tracks.refreshInto(window.DB.get());
      showToast(_t('커버 바꿨어요 ✨', 'Cover updated ✨'));
      if (currentView === 'artist') {
        const h = document.querySelector('.artist-strip h1');
        if (h) renderArtistProfile(h.textContent.trim());
      } else if (currentView === 'profile') {
        renderProfile();
      }
    } catch (err) {
      alert('커버 변경 실패: ' + (err.message || err));
    }
  };
  input.click();
};

window.promoteDemoToFinal = async function(trackId) {
  if (!window.Tracks) return;
  const db = window.DB.get();
  const t = db.tracks.find(x => x.id === trackId);
  if (!t) return;
  const msg = `이 데모를 프로젝트의 마스터(완성본)로 승격할까요?\n\n"${t.versionLabel || t.title}" → ✦ MASTER\n\n기존 마스터가 있으면 자동으로 이전 버전으로 밀려납니다.`;
  if (!confirm(msg)) return;
  try {
    await window.Tracks.promoteToFinal(trackId);
    await window.Tracks.refreshInto(db);
    showToast(_t('🎉 마스터로 승격됐어요!', '🎉 Promoted to master!'));
    if (currentView === 'artist') {
      const h = document.querySelector('.artist-strip h1');
      if (h) renderArtistProfile(h.textContent.trim());
    } else if (currentView === 'profile') {
      renderProfile();
    }
  } catch (e) {
    alert('승격 실패: ' + (e.message || e));
  }
};

// Delete a track the current user owns. Confirms by title to avoid mishaps.
window.deleteMyTrack = async function(trackId, trackTitle) {
  if (!trackId) return;
  const ok = confirm(`「${trackTitle || '이 곡'}」 정말 삭제할까요?\n복구할 수 없어요.`);
  if (!ok) return;

  try {
    if (window.Tracks && typeof window.Tracks.delete === 'function') {
      await window.Tracks.delete(trackId);
    }
    // Also drop from local cache so the UI updates immediately
    const db = window.DB.get();
    if (Array.isArray(db.tracks)) {
      db.tracks = db.tracks.filter(t => t.id !== trackId);
      window.DB.save(db);
    }
    // __tracks(별도 캐시)에도 남아있으면 발견/즐겨찾기 등에서 되살아나므로 같이 제거.
    if (Array.isArray(window.__tracks)) window.__tracks = window.__tracks.filter(t => t && t.id !== trackId);
    showToast(_t('삭제 완료', 'Deleted'));
    // Re-render current view. Artist page needs the artist name to
    // re-render, so we re-trigger the router by re-navigating to the
    // current hash. Other views just call their render fn directly.
    if (currentView === 'artist') {
      try {
        // Force a re-render by replaying the current hash route.
        const h = window.location.hash || '#/shapes';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        // Fallback: extract artist name and call renderArtistProfile
        const m = h.match(/#\/artist:([^/?]+)/);
        if (m && typeof renderArtistProfile === 'function') {
          renderArtistProfile(decodeURIComponent(m[1]));
        }
      } catch (e) {
        console.warn('[deleteMyTrack] re-render artist', e);
      }
    }
    else if (currentView === 'shapes' && typeof renderShapes === 'function') renderShapes();
    else if (currentView === 'profile' && typeof renderProfile === 'function') renderProfile();
    else if (currentView === 'myhome' && typeof renderMyHome === 'function') renderMyHome();   // 마이페이지(데모 노드)에서 삭제 → 즉시 다시 그림
    else if (currentView === 'album') {
      // 앨범 페이지에서 데모 삭제 → 즉시 다시 그려 사라지게(예전엔 album 케이스가 없어 새로고침해야 사라졌음).
      try {
        const h = window.location.hash || '';
        const m = h.match(/#\/album:([^/?]+)/);
        const pid = m ? decodeURIComponent(m[1]) : null;
        const dbNow = window.DB.get();
        const remain = pid ? (dbNow.tracks || []).filter(t => t && (t.projectId || ('proj_' + t.id)) === pid) : [];
        if (pid && remain.length && typeof window.renderAlbum === 'function') {
          window.renderAlbum(pid);   // 남은 버전으로 앨범 다시 그림
        } else if (typeof window.goBack === 'function') {
          window.goBack();           // 마지막 버전까지 지웠으면 뒤로
        } else {
          navigateTo('my-artist');
        }
      } catch (e) { console.warn('[deleteMyTrack] re-render album', e); }
    }
  } catch (e) {
    alert('삭제 실패: ' + (e.message || e));
  }
};

window.editArtistNote = async function(trackId) {
  const db = window.DB.get();
  const t = db.tracks.find(x => x.id === trackId);
  if (!t) return;
  const current = t.artistNote || '';
  const next = prompt('이 데모/마스터에 대한 생각을 적어봐:\n(개행은 Enter 대신 \\n 사용)', current);
  if (next === null) return;
  const cleanedNote = next.replace(/\\n/g, '\n');

  try {
    if (t.__supabase && window.Tracks) {
      await window.Tracks.setArtistNote(trackId, cleanedNote);
      // Tracks.setArtistNote는 window.__tracks(메모리)만 업데이트함.
      // localStorage db도 같이 저장해야 다음 DB.get()이 stale을 안 읽음(=새로고침 전에 안 보이던 버그).
      t.artistNote = cleanedNote;
      try { window.DB.save(db); } catch (_) {}
    } else {
      window.DB.setArtistNote(trackId, cleanedNote);
    }
  } catch (e) {
    alert('저장 실패: ' + (e.message || e));
    return;
  }

  // 즉시 다시 그려서 변경이 바로 보이게 — 아티스트 이름은 URL hash에서 가져옴(.artist-strip이 없는 페이지에서도 동작)
  if (currentView === 'artist') {
    const m = (window.location.hash || '').match(/#\/artist:([^/?]+)/);
    const artistName = m ? decodeURIComponent(m[1]) : null;
    if (artistName && typeof renderArtistProfile === 'function') {
      renderArtistProfile(artistName);
      setTimeout(() => {
        const wrap = document.getElementById('vw-' + trackId);
        if (wrap) wrap.classList.add('open');
      }, 50);
    }
  } else if (currentView === 'profile') {
    renderProfile();
    setTimeout(() => {
      const wrap = document.getElementById('vw-' + trackId);
      if (wrap) wrap.classList.add('open');
    }, 50);
  }
};

// ===================== ARTIST PROFILE (public) =====================

function _renderArtistProfileV2_unused(artistName) {
  window.__currentArtistName = artistName;
  const db = window.DB.get();

  // ── Tracks & projects ────────────────────────────────────
  const allTracks = (db.tracks || []).filter(t => t && t.artist === artistName);
  const masters = allTracks.filter(t => !t.isDemo);
  const demos   = allTracks.filter(t =>  t.isDemo);
  // Group by projectId → 싱글 (master only, no demos) vs 프로젝트 (demos in flight)
  const byProject = {};
  allTracks.forEach(t => {
    const pid = t.projectId || t.id;
    if (!byProject[pid]) byProject[pid] = { demos: [], master: null };
    if (t.isDemo) byProject[pid].demos.push(t);
    else byProject[pid].master = t;
  });
  const projectsArr = Object.values(byProject);
  const singleCount  = projectsArr.filter(p => p.master && p.demos.length === 0).length;
  const projectCount = projectsArr.filter(p => p.demos.length > 0).length;
  const albumCount   = 0; // 명시적 앨범 컨셉 없음 — 향후 확장

  // ── Artist's own wall notes (top-right strip) ────────────
  const myNotes = (db.notes || []).filter(n => n && n.author === artistName).slice(0, 4);

  // ── Try to grab avatar / bio / sns (Supabase profile lookup async; fall back to first track) ──
  let avatar = (allTracks[0] && allTracks[0].artistAvatar) || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(artistName));
  let bio = '';
  let sns = {};
  // Try the cached profile (synchronous best-effort)
  if (window.__currentUser && window.__currentUser.name === artistName) {
    avatar = window.__currentUser.avatar || avatar;
    bio = window.__currentUser.bio || '';
    sns = window.__currentUser.sns || {};
  }
  // Async refresh (re-render if we find more details)
  if (window.fetchProfileByName && !window.__artistProfileFetched) {
    window.__artistProfileFetched = artistName;
    window.fetchProfileByName(artistName).then(p => {
      window.__artistProfileFetched = null;
      if (!p) return;
      if (currentView !== 'artist' || window.__currentArtistName !== artistName) return;
      // Stash on a side map so subsequent renders pick it up
      window.__artistProfileCache = window.__artistProfileCache || {};
      window.__artistProfileCache[artistName] = p;
      renderArtistProfile(artistName);
    }).catch(()=>{ window.__artistProfileFetched = null; });
  }
  const cached = (window.__artistProfileCache || {})[artistName];
  if (cached) {
    avatar = cached.avatar_url || avatar;
    bio = cached.bio || bio;
  }

  // ── Tabs ─────────────────────────────────────────────────
  const tab = window.__artistTab || 'all';
  let visibleTracks = masters;
  if (tab === 'popular') {
    visibleTracks = [...masters].sort((a,b) => (b.likes||0) - (a.likes||0));
  } else if (tab === 'collab') {
    visibleTracks = masters.filter(t => Array.isArray(t.collaborators) && t.collaborators.length > 0);
  }
  // 'all' = masters in default order (sorted by createdAt desc)
  if (tab === 'all') {
    visibleTracks = [...masters].sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
  }

  // ── HTML helpers ─────────────────────────────────────────
  const safeName = (artistName || '').replace(/</g,'&lt;');

  const noteCardsHtml = myNotes.map(n => {
    const c = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
    const txt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    return `
      <div class="artist-mini-postit" style="background:${c.bg}; color:${c.text};" onclick="openNoteDetail('${n.id}')">
        <div class="artist-mini-postit-body">${txt}</div>
      </div>`;
  }).join('');

  const trackCardHtml = (t) => {
    const cover = t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500';
    const title = (t.title || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    return `
      <div class="artist-track-card" onclick="playTrack('${t.id}')">
        <img src="${cover}" alt="${title}" loading="lazy">
        <div class="artist-track-title">${title}</div>
        ${typeof t.likes === 'number' && t.likes > 0 ? `<div class="artist-track-likes"><i class="ri-heart-fill"></i> ${t.likes}</div>` : ''}
      </div>`;
  };

  const aboutHtml = `
    <div class="artist-about">
      ${bio ? `<p class="artist-bio">${bio.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p>` : '<p class="artist-bio-empty">아직 소개가 없어요.</p>'}
      ${generateSnsLinks(sns) || ''}
    </div>`;

  const bodyHtml = tab === 'about'
    ? aboutHtml
    : (visibleTracks.length > 0
        ? `<div class="artist-tracks-grid">${visibleTracks.map(trackCardHtml).join('')}</div>`
        : `<div class="artist-tracks-empty">${tab === 'collab' ? '아직 콜라보한 곡이 없어요.' : tab === 'popular' ? '좋아요 받은 곡이 아직 없어요.' : '아직 올린 곡이 없어요.'}</div>`);

  appContent.innerHTML = `
    <div class="sub-page artist-page-v2">
      <!-- Top row: name + 내 포스트잇 -->
      <div class="artist-top-row">
        <div class="artist-name-card">
          <img class="artist-name-avatar" src="${avatar}" alt="${safeName}" loading="lazy">
          <h1 class="artist-name-title">${safeName}</h1>
        </div>
        ${myNotes.length > 0 ? `
          <div class="artist-postits-card">
            <div class="artist-postits-title">소식</div>
            <div class="artist-postits-row">
              ${noteCardsHtml}
            </div>
          </div>` : ''}
      </div>

      <!-- Info card: counts + track grid + tabs -->
      <div class="artist-info-card">
        <div class="artist-counts">
          <div class="artist-count-row"><strong>${albumCount}</strong> 앨범 <span class="artist-count-sub">예라 = 누납</span></div>
          <div class="artist-count-row"><strong>${projectCount}</strong> 프로젝트 <span class="artist-count-sub">데모 ${demos.length}</span></div>
          <div class="artist-count-row"><strong>${singleCount}</strong> 싱글 <span class="artist-count-sub">단독 마스터</span></div>
        </div>
        <div class="artist-tabs">
          <button class="artist-tab ${tab==='all' ? 'active' : ''}" onclick="switchArtistTab('all')">All tracks <span class="artist-tab-count">${masters.length}</span></button>
          <button class="artist-tab ${tab==='popular' ? 'active' : ''}" onclick="switchArtistTab('popular')">인기</button>
          <button class="artist-tab ${tab==='collab' ? 'active' : ''}" onclick="switchArtistTab('collab')">콜라보</button>
          <button class="artist-tab ${tab==='about' ? 'active' : ''}" onclick="switchArtistTab('about')">About</button>
        </div>
        <div class="artist-body">${bodyHtml}</div>
      </div>
    </div>
  `;
}

// ============================================================
// 소식 핀-스택 — 포스트잇이 핀에 박힌 더미. 고정(pin)한 게 앞(최대 4),
//   나머지는 뒤에 겹쳐 보임. 스와이프(좌/우)로 한 장씩 넘김. 탭 → 상세.
//   고정한 게 없으면 최신 1장이 앞 + 뒤로 몇 장 peek (여러 장처럼).
// ============================================================
function _soshikPinKey(artistName) { return 'soshikpin:' + (artistName || ''); }
function _soshikGetPins(artistName) {
  try { const a = JSON.parse(localStorage.getItem(_soshikPinKey(artistName)) || '[]'); return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}
window.toggleSoshikPin = function (noteId, artistName) {
  if (!noteId) return;
  let pins = _soshikGetPins(artistName);
  if (pins.includes(noteId)) pins = pins.filter(id => id !== noteId);
  else { pins = [noteId, ...pins.filter(id => id !== noteId)]; if (pins.length > 4) pins = pins.slice(0, 4); }
  try { localStorage.setItem(_soshikPinKey(artistName), JSON.stringify(pins)); } catch (_) {}
  if (typeof showToast === 'function') showToast(pins.includes(noteId) ? _t('소식 고정됨 📌', 'Pinned 📌') : _t('고정 해제됨', 'Unpinned'));
  // 현재 아티스트 페이지 다시 그리기
  try { if (typeof renderArtistProfile === 'function' && currentView === 'artist') renderArtistProfile(artistName); } catch (_) {}
};

function _soshikStackHtml(notes, isSelf, artistName) {
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  // 최신순 정렬 (rest 용)
  const sorted = [...notes].sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));
  const pins = _soshikGetPins(artistName);
  const byId = new Map(sorted.map(n => [n.id, n]));
  const pinnedNotes = pins.map(id => byId.get(id)).filter(Boolean).slice(0, 4);
  const pinnedSet = new Set(pinnedNotes.map(n => n.id));
  const rest = sorted.filter(n => !pinnedSet.has(n.id));
  const ordered = [...pinnedNotes, ...rest];

  // 소식이 없을 때 — 예전처럼 투명 포스트잇 + 카드 (본인만). 방문자는 빈 화면. (사용자 요청)
  if (ordered.length === 0) {
    if (!isSelf) return '';
    return `<div class="soshik-stack soshik-stack-empty" id="soshik-stack" data-idx="0">
      <div class="soshik-add-postit" onclick="goAddSoshik()" title="${_t('새 소식 쓰기','New post')}" role="button" tabindex="0">
        <i class="ri-add-line"></i>
        <span class="soshik-add-postit-label">${_i18n('소식','Post')}</span>
      </div>
    </div>`;
  }

  const cardsHtml = ordered.map((n) => {
    const c = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
    const isPin = pinnedSet.has(n.id);
    const pinBtn = isSelf
      ? `<button class="soshik-pin-btn ${isPin ? 'on' : ''}" onclick="event.stopPropagation(); toggleSoshikPin('${n.id}','${(artistName||'').replace(/'/g,"\\'")}')" title="${isPin ? _t('고정 해제','Unpin') : _t('고정','Pin')}"><i class="ri-pushpin-${isPin ? '2-fill' : 'line'}"></i></button>`
      : '';
    const chip = (typeof _renderNoteTrackChip === 'function') ? _renderNoteTrackChip(n) : '';
    return `<div class="soshik-card" data-note-id="${n.id}" style="background:${c.bg}; color:${c.text};">
      ${pinBtn}
      <div class="soshik-card-body">${esc(n.text)}</div>
      ${chip}
    </div>`;
  }).join('');

  const addBtn = isSelf
    ? `<button class="soshik-add" onclick="goAddSoshik()" title="${_t('새 소식 쓰기','New post')}"><i class="ri-add-line"></i> ${_i18n('소식','Post')}</button>`
    : '';
  const multi = ordered.length > 1;
  const dots = multi ? `<div class="soshik-dots">${ordered.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>` : '';
  const hint = multi ? `<div class="soshik-stack-hint"><i class="ri-arrow-left-right-line"></i> ${_t('넘겨보기','swipe')}</div>` : '';
  const emptyMsg = ordered.length === 0 ? `<div class="soshik-empty">${_t('첫 소식을 남겨보세요','Post your first update')}</div>` : '';
  // 카드가 1~2장이라도 '여러 장 쌓인' 더미처럼 보이게 뒤에 빈 peek 레이어.
  const peeks = ordered.length >= 1
    ? `<div class="soshik-peek soshik-peek-2"></div><div class="soshik-peek soshik-peek-1"></div>`
    : '';

  return `<div class="soshik-stack ${multi ? 'is-multi' : ''}" id="soshik-stack" data-idx="0">
    <div class="soshik-pin-deco"><i class="ri-pushpin-2-fill"></i></div>
    <div class="soshik-cards">${peeks}${cardsHtml}${emptyMsg}</div>
    ${dots}
    <div class="soshik-foot">${hint}${addBtn}</div>
  </div>`;
}

// 스택 레이아웃 — data-idx 기준 각 카드 depth 계산해 transform 적용.
window._layoutSoshikStack = function (stack) {
  if (!stack) return;
  const cards = Array.from(stack.querySelectorAll('.soshik-card'));
  const N = cards.length;
  if (!N) return;
  const idx = ((parseInt(stack.dataset.idx || '0', 10) % N) + N) % N;
  cards.forEach((card, i) => {
    const d = (i - idx + N) % N;                      // 0 = 맨 앞
    card.style.zIndex = String(100 - d);
    card.style.transition = 'transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.28s';
    if (d === 0) {
      card.style.transform = 'translateX(0) translateY(0) scale(1) rotate(0deg)';
      card.style.opacity = '1';
      card.classList.add('is-front');
    } else if (d <= 3) {
      const rot = (d % 2 ? 1 : -1) * (1.5 + d);
      card.style.transform = `translateY(${d * 9}px) scale(${1 - d * 0.05}) rotate(${rot}deg)`;
      card.style.opacity = String(Math.max(0.35, 1 - d * 0.22));
      card.classList.remove('is-front');
    } else {
      card.style.transform = `translateY(30px) scale(0.84) rotate(0deg)`;
      card.style.opacity = '0';
      card.classList.remove('is-front');
    }
  });
  const dots = stack.querySelectorAll('.soshik-dots span');
  dots.forEach((dot, i) => dot.classList.toggle('on', i === idx));
};

// 데스크탑 — 소식 핀을 헤더 둘째 열에서 'DEMO 2' 칸 위로 정렬 (사용자 요청).
// 이름 길이/화면폭에 안 휘둘리게 DEMO 2 의 실제 위치를 측정해 margin-left 로 맞춤.
window._alignSoshikAboveDemo2 = function () {
  const stack = document.querySelector('.artist-postit-aside .soshik-stack');
  if (!stack) return;
  const aside = stack.parentElement;
  // 모바일(≤960) — aside 가 full-width 라 인라인 정렬 제거 → CSS 중앙 유지.
  if (window.innerWidth <= 960) {
    stack.style.removeProperty('margin-left');
    stack.style.removeProperty('margin-right');
    return;
  }
  const demoPath = document.querySelector('.projects-grid .demo-path');
  if (!demoPath) return;
  const demos = demoPath.querySelectorAll(':scope > .demo-card');
  const target = demos[1] || demos[0];                 // DEMO 2 우선, 없으면 DEMO 1
  if (!target) return;
  const a = aside.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  let ml = Math.round(t.left - a.left);
  const maxMl = Math.max(0, Math.round(a.width - stack.offsetWidth));  // aside 밖으로 안 나가게
  ml = Math.min(Math.max(0, ml), maxMl);
  stack.style.setProperty('margin-left', ml + 'px', 'important');
  stack.style.setProperty('margin-right', 'auto', 'important');
};

// 스와이프(좌/우)로 스택 넘기기 + 탭 → 상세. 모바일 터치 + 마우스.
window._initSoshikStack = function (stack) {
  if (!stack || stack._soshikWired) return;
  stack._soshikWired = true;
  window._layoutSoshikStack(stack);
  const N = () => stack.querySelectorAll('.soshik-card').length;
  let sx = 0, sy = 0, drag = false, moved = false, front = null;

  const onStart = (x, y, target) => {
    if (target && target.closest && target.closest('.soshik-pin-btn, .soshik-add, button, a, input, form')) return;
    front = stack.querySelector('.soshik-card.is-front');
    if (!front) return;
    sx = x; sy = y; drag = true; moved = false;
    front.style.transition = 'none';
  };
  const onMove = (x, y, ev) => {
    if (!drag || !front) return;
    const dx = x - sx, dy = y - sy;
    if (Math.abs(dx) < Math.abs(dy)) { return; }       // 세로 우세 → 페이지 스크롤 양보
    if (Math.abs(dx) > 5) moved = true;
    front.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    if (ev && ev.cancelable) ev.preventDefault();
  };
  const onEnd = (x) => {
    if (!drag || !front) { drag = false; return; }
    drag = false;
    const dx = x - sx;
    const n = N();
    const outgoing = front;     // setTimeout 에서 쓸 카드 — 지역 캡처 (front 는 곧 null)
    front = null;
    outgoing.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
    if (n > 1 && Math.abs(dx) > 64) {
      const dir = dx < 0 ? 1 : -1;
      outgoing.style.transform = `translateX(${dx < 0 ? -150 : 150}%) rotate(${dx < 0 ? -14 : 14}deg)`;
      setTimeout(() => {
        const cur = parseInt(stack.dataset.idx || '0', 10);
        stack.dataset.idx = String(((cur + dir) % n + n) % n);
        outgoing.style.transition = 'none';
        window._layoutSoshikStack(stack);
      }, 270);
    } else {
      window._layoutSoshikStack(stack);                // 스냅백
    }
  };

  stack.addEventListener('click', (e) => {
    if (moved) { moved = false; return; }
    const card = e.target.closest('.soshik-card.is-front');
    if (card && card.dataset.noteId && !e.target.closest('.soshik-pin-btn')) {
      // 스택 카드 순서(고정 우선 → 최신)를 시퀀스로 넘겨, 상세에서도 좌/우 스와이프로 넘김
      const ids = Array.from(stack.querySelectorAll('.soshik-card')).map(c => c.dataset.noteId);
      const idx = Math.max(0, ids.indexOf(card.dataset.noteId));
      openNoteDetail(card.dataset.noteId, { seq: ids, idx });
    }
  });
  stack.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) onStart(t.clientX, t.clientY, e.target); }, { passive: true });
  stack.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY, e); }, { passive: false });
  stack.addEventListener('touchend', (e) => onEnd((e.changedTouches[0] || {}).clientX != null ? e.changedTouches[0].clientX : sx));
  // 마우스 — 드래그 중에만 window 리스너 (누수 방지)
  const wm = (e) => onMove(e.clientX, e.clientY, e);
  const wu = (e) => { window.removeEventListener('mousemove', wm); window.removeEventListener('mouseup', wu); onEnd(e.clientX); };
  stack.addEventListener('mousedown', (e) => { onStart(e.clientX, e.clientY, e.target); if (drag) { window.addEventListener('mousemove', wm); window.addEventListener('mouseup', wu); } });
};

// ============================================================
// 스토리 — 인스타식 24h 휘발. 프로필 사진 탭 → 올리기/보기.
//   포스트잇으로 감정 한마디 + 노래 첨부. 풀화면 뷰어(탭 넘기기/스와이프 닫기).
//   저장: localStorage 'offstage_stories' = { [artist]: [ {id,text,color,song,createdAt} ] }
//   24h 지난 건 읽을 때 자동 prune.
// ============================================================
const _STORY_TTL = 24 * 60 * 60 * 1000;
function _storyAllData() {
  try { return JSON.parse(localStorage.getItem('offstage_stories') || '{}') || {}; } catch (_) { return {}; }
}
function _storySave(d) { try { localStorage.setItem('offstage_stories', JSON.stringify(d)); } catch (_) {} }
function _storyNow() { return new Date().getTime(); }
function _getStories(artist) {
  const all = _storyAllData();
  const list = Array.isArray(all[artist]) ? all[artist] : [];
  const now = _storyNow();
  const active = list.filter(s => s && (now - (s.createdAt || 0)) < _STORY_TTL);
  if (active.length !== list.length) {           // prune 만료분
    if (active.length) all[artist] = active; else delete all[artist];
    _storySave(all);
  }
  return active.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
window._hasActiveStory = function (artist) { return _getStories(artist).length > 0; };

// 프로필 사진 탭 라우팅 — 스토리 있으면 보기, 없고 본인이면 올리기.
window.openStoryFor = function (artist, isSelf) {
  if (_getStories(artist).length > 0) { window.openStoryViewer(artist, isSelf); return; }
  if (isSelf) window.openStoryComposer(artist);
};

// ── 컴포저 (풀화면 포스트잇 + 노래) ──
window.openStoryComposer = function (artist) {
  const user = window.__currentUser || (window.DB.get() && window.DB.get().currentUser);
  if (!user) { showToast(_t('로그인이 필요해요', 'Sign-in required')); navigateTo('auth'); return; }
  window.__storyAttachedSong = null;
  window.__songAttachTarget = 'story';
  const keys = Object.keys(NOTE_COLORS);
  const prev = document.getElementById('story-composer');
  if (prev) prev.remove();
  const el = document.createElement('div');
  el.id = 'story-composer';
  el.className = 'story-composer';
  el.innerHTML = `
    <div class="story-composer-top">
      <button class="story-x" onclick="closeStoryComposer()" aria-label="닫기"><i class="ri-close-line"></i></button>
      <div class="story-composer-title">${_t('스토리 올리기', 'Add story')}</div>
      <button class="story-post-btn" onclick="submitStory('${(artist||'').replace(/'/g,"\\'")}')">${_t('올리기', 'Post')}</button>
    </div>
    <div class="story-composer-card" id="story-card" style="background:${NOTE_COLORS[keys[0]].bg}; color:${NOTE_COLORS[keys[0]].text};">
      <textarea id="story-text" maxlength="120" placeholder="${_t('지금 기분을 한마디로 ✍️', 'Your mood in a word ✍️')}"></textarea>
      <div id="story-attach-preview" class="story-attach-preview" hidden></div>
    </div>
    <div class="story-composer-tools">
      <div class="story-colors">
        ${keys.map((k, i) => `<button class="story-color ${i === 0 ? 'on' : ''}" data-color="${k}" style="background:${NOTE_COLORS[k].bg}; border-color:${NOTE_COLORS[k].border};" onclick="_pickStoryColor('${k}')"></button>`).join('')}
      </div>
      <button class="story-attach" onclick="openSongAttacher('story')"><i class="ri-music-2-fill"></i> ${_t('노래', 'Song')}</button>
    </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const ta = document.getElementById('story-text'); if (ta) ta.focus(); }, 60);
  requestAnimationFrame(() => el.classList.add('open'));
};
window._pickStoryColor = function (k) {
  const card = document.getElementById('story-card');
  if (card && NOTE_COLORS[k]) { card.style.background = NOTE_COLORS[k].bg; card.style.color = NOTE_COLORS[k].text; }
  document.querySelectorAll('.story-color').forEach(b => b.classList.toggle('on', b.dataset.color === k));
};
window.closeStoryComposer = function () {
  const el = document.getElementById('story-composer');
  if (!el) return;
  el.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { if (el.parentNode) el.remove(); }, 200);
};
window.submitStory = function (artist) {
  const ta = document.getElementById('story-text');
  const text = (ta && ta.value || '').trim();
  const song = window.__storyAttachedSong || null;
  if (!text && !song) { showToast(_t('한마디 적거나 노래를 붙여줘', 'Write something or attach a song')); return; }
  const activeColorBtn = document.querySelector('.story-color.on');
  const color = (activeColorBtn && activeColorBtn.dataset.color) || Object.keys(NOTE_COLORS)[0];
  const all = _storyAllData();
  if (!Array.isArray(all[artist])) all[artist] = [];
  all[artist].push({ id: 'st' + _storyNow() + Math.random().toString(36).slice(2, 6), text, color, song, createdAt: _storyNow() });
  _storySave(all);
  window.__storyAttachedSong = null;
  closeStoryComposer();
  showToast(_t('스토리 올렸어요 ✨ (24시간 후 사라져요)', 'Story posted ✨ (gone in 24h)'));
  try { if (currentView === 'artist' && typeof renderArtistProfile === 'function') renderArtistProfile(artist); } catch (_) {}
};

// ── 뷰어 (풀화면, 진행바 + 탭 넘기기 + 스와이프 닫기) ──
window.__storyTimer = null;
window.openStoryViewer = function (artist, isSelf) {
  const stories = _getStories(artist);
  if (!stories.length) { if (isSelf) window.openStoryComposer(artist); return; }
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const prev = document.getElementById('story-viewer');
  if (prev) prev.remove();
  const el = document.createElement('div');
  el.id = 'story-viewer';
  el.className = 'story-viewer';
  el.dataset.artist = artist;
  el.dataset.idx = '0';
  el._stories = stories;
  el._isSelf = !!isSelf;
  el.innerHTML = `
    <div class="story-bars">${stories.map((_, i) => `<div class="story-bar"><span></span></div>`).join('')}</div>
    <div class="story-head">
      <div class="story-author">${esc(artist)}</div>
      ${isSelf ? `<button class="story-del" onclick="_deleteCurrentStory()" title="${_t('삭제','Delete')}"><i class="ri-delete-bin-line"></i></button>` : ''}
      ${isSelf ? `<button class="story-add-more" onclick="openStoryComposer('${(artist||'').replace(/'/g,"\\'")}')" title="${_t('추가','Add')}"><i class="ri-add-line"></i></button>` : ''}
      <button class="story-x" onclick="closeStoryViewer()" aria-label="닫기"><i class="ri-close-line"></i></button>
    </div>
    <div class="story-stage" id="story-stage"></div>
    <button class="story-nav story-prev" onclick="_storyStep(-1)" aria-label="이전"></button>
    <button class="story-nav story-next" onclick="_storyStep(1)" aria-label="다음"></button>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  // 스와이프 다운 → 닫기 (엔진 재활용)
  try { window._attachSwipeDismiss(el, { onClose: () => closeStoryViewer(), exclude: '.story-nav, .story-x, .story-del, .story-add-more, button, a, .note-track-chip' }); } catch (_) {}
  requestAnimationFrame(() => el.classList.add('open'));
  _renderStoryAt(0);
};
function _renderStoryAt(idx) {
  const el = document.getElementById('story-viewer');
  if (!el) return;
  const stories = el._stories || [];
  if (idx < 0) idx = 0;
  if (idx >= stories.length) { closeStoryViewer(); return; }
  el.dataset.idx = String(idx);
  const s = stories[idx];
  const c = NOTE_COLORS[s.color] || NOTE_COLORS.yellow;
  const esc = (t) => (t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  // 노래 칩
  let songChip = '';
  if (s.song) {
    if (s.song.kind === 'track') {
      const t = (window.DB.get().tracks || []).find(x => x.id === s.song.id);
      if (t) songChip = `<button class="story-song" onclick="event.stopPropagation(); playTrack('${t.id}')"><img src="${t.cover||''}" alt=""><span class="story-song-t">${esc(t.title)}</span> <i class="ri-play-circle-fill"></i></button>`;
    } else if (s.song.kind === 'url') {
      songChip = `<a class="story-song" href="${(s.song.url||'').replace(/"/g,'&quot;')}" target="_blank" rel="noopener" onclick="event.stopPropagation();"><i class="ri-link"></i> <span class="story-song-t">${esc((s.song.url||'').replace(/^https?:\/\//,''))}</span></a>`;
    }
  }
  const stage = document.getElementById('story-stage');
  stage.innerHTML = `<div class="story-postit" style="background:${c.bg}; color:${c.text};">
      <div class="story-postit-text">${esc(s.text) || ''}</div>
      ${songChip}
    </div>`;
  // 진행바
  const bars = el.querySelectorAll('.story-bar');
  bars.forEach((bar, i) => {
    const fill = bar.querySelector('span');
    if (i < idx) { fill.style.transition = 'none'; fill.style.width = '100%'; }
    else if (i > idx) { fill.style.transition = 'none'; fill.style.width = '0%'; }
    else {
      fill.style.transition = 'none'; fill.style.width = '0%';
      // 다음 프레임에 6초 동안 채우기
      requestAnimationFrame(() => { fill.style.transition = 'width 6s linear'; fill.style.width = '100%'; });
    }
  });
  if (window.__storyTimer) clearTimeout(window.__storyTimer);
  window.__storyTimer = setTimeout(() => _storyStep(1), 6000);
}
window._storyStep = function (delta) {
  const el = document.getElementById('story-viewer');
  if (!el) return;
  const idx = parseInt(el.dataset.idx || '0', 10) + delta;
  _renderStoryAt(idx);
};
window._deleteCurrentStory = function () {
  const el = document.getElementById('story-viewer');
  if (!el) return;
  const artist = el.dataset.artist;
  const idx = parseInt(el.dataset.idx || '0', 10);
  const stories = el._stories || [];
  const target = stories[idx];
  if (!target) return;
  if (!confirm(_t('이 스토리를 지울까요?', 'Delete this story?'))) return;
  const all = _storyAllData();
  all[artist] = (all[artist] || []).filter(x => x.id !== target.id);
  if (!all[artist].length) delete all[artist];
  _storySave(all);
  showToast(_t('스토리 삭제됨', 'Story deleted'));
  closeStoryViewer();
  try { if (currentView === 'artist') renderArtistProfile(artist); } catch (_) {}
};
window.closeStoryViewer = function () {
  if (window.__storyTimer) { clearTimeout(window.__storyTimer); window.__storyTimer = null; }
  const el = document.getElementById('story-viewer');
  if (!el) return;
  el.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { if (el.parentNode) el.remove(); }, 200);
};

// === Active artist profile (restored) ===
// ===================== MY HOME (아티스트 홈 — 데모 타임라인) =====================
// my-artist 라우트 전용. 사용자가 공유한 "SMHS Artist Home Redesign" 디자인을
// 앱 스택(자체 CSS + Remixicon + Nanum Pen Script)으로 재현하고 실데이터를 연결한다.
// 디자인의 폰목업 크롬(상태바/가짜 헤더/하단 플레이어)은 빼고, 곡 재생은 앱의 실제
// 플레이어(playTrack)로 위임 — 이중 플레이어 방지.
window.__mhState = window.__mhState || {};   // { [projectId]: 선택된 데모 idx }

function _mhYM(d) {
  const dt = new Date(d || 0);
  if (!dt.getTime()) return '';
  return dt.getFullYear() + '.' + String(dt.getMonth() + 1).padStart(2, '0');
}
function _mhYMD(d) {
  const dt = new Date(d || 0);
  if (!dt.getTime()) return '';
  return dt.getFullYear() + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + String(dt.getDate()).padStart(2, '0');
}

window.mhSelectDemo = function (pid, idx, trackId, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  window.__mhState[pid] = idx;
  if (trackId) { try { playTrack(trackId); } catch (_) {} }   // 데모 노드 누르면 그 버전 재생
  // 현재 보고 있는 아티스트 페이지(내 페이지/남 페이지 공용)를 다시 그림 (renderMyHome 고정이면 남 페이지서 내 페이지로 튐)
  try { renderArtistHome(window.__currentArtistName); } catch (e) { console.warn('[myhome] reselect', e); }
};

// ════════ 프로듀싱 = 데모 진화 라운드 투표 (마이페이지 데모 노드 패널) ════════
// 선택된 데모 아래에 패널: 본인&라운드없음→만들기 / 진행중→(본인)공개·(청취자)투표 / 마감→결과.
// 백엔드 window.Producing (supabase.js). 테이블 없으면 fetch가 빈값→슬롯 비움(graceful).
var PC_TOPICS = [
  ['🎵 편곡', '후렴 편곡, 어디로?', '몽환 신스', '펑키 기타'],
  ['👕 MV 의상', 'MV에 뭐 입을까?', '사복', '교복'],
  ['✍️ 제목', '곡 제목 뭐로?', '', ''],
  ['🎬 MV 장소', 'MV 어디서 찍을까?', '옥상', '노래방'],
  ['💡 직접', '', '', '']
];
function pcEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function _pcColor(seed) { var pal = ['#8B7CF6', '#FB6F92', '#36C977', '#5B8DEF', '#FF9F45', '#2EE6C0']; var h = 0, s = String(seed || 'x'); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return pal[h % pal.length]; }

function _pcStyle() {
  if (document.getElementById('pc-style')) return;
  var st = document.createElement('style'); st.id = 'pc-style';
  st.textContent = `
  .pc-slot:empty{display:none;}
  .pc-box{margin-top:12px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);padding:14px;color:#fff;}
  .pc-flag{display:inline-block;font-size:9.5px;font-weight:900;color:#06140C;background:#C9C4F5;padding:3px 9px;border-radius:999px;margin-bottom:11px;}
  .pc-flag.live{background:#FB6F92;color:#fff;} .pc-flag.done{background:#36C977;color:#06140C;}
  .pc-empty{text-align:center;padding:4px 2px;} .pc-empty-ic{font-size:28px;} .pc-empty-t{font-size:13px;font-weight:800;margin:7px 0 3px;} .pc-empty-s{font-size:11px;color:rgba(255,255,255,.5);line-height:1.5;margin-bottom:13px;}
  .pc-cta,.pc-open{width:100%;border:none;border-radius:12px;padding:12px;font-family:inherit;font-size:13px;font-weight:800;color:#06140C;background:linear-gradient(135deg,#C9C4F5,#8B7CF6);cursor:pointer;}
  .pc-topics{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;} .pc-topic{font-family:inherit;font-size:11.5px;font-weight:700;color:#E8E6F5;background:#1A1A24;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:6px 11px;cursor:pointer;} .pc-topic.on{background:rgba(201,196,245,.18);border-color:#C9C4F5;color:#fff;}
  .pc-lab{font-size:11px;font-weight:800;color:rgba(255,255,255,.65);margin:12px 0 6px;}
  .pc-box input{width:100%;background:#15151E;border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:10px 12px;color:#fff;font-family:inherit;font-size:12.5px;} .pc-box input::placeholder{color:rgba(255,255,255,.32);}
  .pc-ab{display:flex;gap:8px;} .pc-c-slot:not(:empty){margin-top:8px;}
  .pc-addc{width:100%;margin-top:9px;border:1px dashed rgba(255,255,255,.2);background:transparent;color:rgba(255,255,255,.55);border-radius:11px;padding:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;}
  .pc-days{display:flex;gap:8px;} .pc-day{flex:1;border:1px solid rgba(255,255,255,.12);background:#15151E;color:rgba(255,255,255,.7);border-radius:10px;padding:9px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;} .pc-day.on{background:rgba(201,196,245,.16);border-color:#C9C4F5;color:#fff;}
  .pc-form-btns{display:flex;gap:8px;margin-top:16px;} .pc-ghost{flex:0 0 90px;border:1px solid rgba(255,255,255,.15);background:transparent;color:rgba(255,255,255,.7);border-radius:12px;padding:12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;} .pc-form-btns .pc-open{flex:1;}
  .pc-q{font-size:14.5px;font-weight:900;text-align:center;margin-bottom:3px;} .pc-qsub{font-size:10.5px;color:rgba(255,255,255,.45);text-align:center;margin-bottom:14px;}
  .pc-vs{display:flex;gap:9px;align-items:stretch;margin-bottom:7px;} .pc-card{flex:1;border-radius:15px;padding:15px 9px;text-align:center;cursor:pointer;border:2px solid transparent;transition:all .18s;position:relative;} .pc-card.a{background:rgba(139,124,246,.12);} .pc-card.b{background:rgba(251,111,146,.12);} .pc-card.c{background:rgba(54,201,119,.12);}
  .pc-card.a.on{border-color:#8B7CF6;background:rgba(139,124,246,.24);} .pc-card.b.on{border-color:#FB6F92;background:rgba(251,111,146,.24);} .pc-card.c.on{border-color:#36C977;background:rgba(54,201,119,.24);}
  .pc-badge{font-size:10px;font-weight:900;color:#fff;padding:2px 9px;border-radius:999px;display:inline-block;margin-bottom:7px;} .pc-card.a .pc-badge{background:#8B7CF6;} .pc-card.b .pc-badge{background:#FB6F92;} .pc-card.c .pc-badge{background:#36C977;color:#06140C;}
  .pc-name{font-size:13.5px;font-weight:800;word-break:break-word;} .pc-mine{position:absolute;top:7px;right:7px;font-size:9px;font-weight:900;color:#06140C;background:#fff;padding:2px 7px;border-radius:999px;}
  .pc-vs-mid{display:flex;align-items:center;font-size:12px;font-weight:900;color:rgba(255,255,255,.4);}
  .pc-blind{display:flex;align-items:center;justify-content:center;gap:5px;font-size:10.5px;color:rgba(255,255,255,.4);margin:10px 0 15px;} .pc-blind i{color:#C9C4F5;}
  .pc-cmt-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;margin:14px 0 4px;color:rgba(255,255,255,.8);} .pc-cmt-hint{margin-left:auto;font-size:9.5px;font-weight:700;color:#FB6F92;}
  .pc-cmt{display:flex;gap:9px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);margin-bottom:7px;align-items:center;} .pc-cmt.on{border-color:rgba(251,111,146,.5);background:rgba(251,111,146,.07);} .pc-cmt.won{border-color:rgba(255,209,102,.45);background:rgba(255,209,102,.07);}
  .pc-cmt-av{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;}
  .pc-cmt-b{flex:1;min-width:0;text-align:left;} .pc-cmt-u{font-size:10px;font-weight:700;color:rgba(255,255,255,.55);} .pc-cmt-t{font-size:12.5px;font-weight:600;margin-top:1px;word-break:break-word;}
  .pc-cmt-like{display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;flex-shrink:0;padding:2px 4px;} .pc-cmt-like i{font-size:17px;color:rgba(255,255,255,.4);} .pc-cmt.on .pc-cmt-like i,.pc-cmt-like.liked i{color:#FB6F92;} .pc-cmt-like b{font-size:10px;font-weight:800;}
  .pc-cmt-add{display:flex;gap:7px;margin-top:5px;} .pc-cmt-add input{flex:1;} .pc-cmt-add button{flex:0 0 auto;border:none;border-radius:11px;background:#2a2438;color:#C9C4F5;font-weight:800;padding:0 14px;font-family:inherit;font-size:12px;cursor:pointer;}
  .pc-banner{text-align:center;font-size:11.5px;font-weight:700;color:#9DE0B4;background:rgba(157,224,180,.1);border:1px solid rgba(157,224,180,.25);border-radius:11px;padding:10px;margin-top:12px;}
  .pc-stat{text-align:center;font-size:11.5px;color:rgba(255,255,255,.6);margin:12px 0;} .pc-stat b{color:#fff;}
  .pc-reveal{width:100%;border:none;border-radius:12px;padding:12px;font-family:inherit;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(135deg,#FB6F92,#C9456E);cursor:pointer;}
  .pc-row{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:13px;margin-bottom:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden;} .pc-row.win{border-color:rgba(255,209,102,.55);background:rgba(255,209,102,.08);}
  .pc-bar{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.05);z-index:0;} .pc-row.win .pc-bar{background:rgba(255,209,102,.13);} .pc-row>*{position:relative;z-index:1;}
  .pc-rtag{font-size:9px;font-weight:900;padding:2px 7px;border-radius:6px;color:#fff;flex-shrink:0;} .pc-rtag.a{background:#8B7CF6;} .pc-rtag.b{background:#FB6F92;} .pc-rtag.c{background:#5B8DEF;}
  .pc-rname{flex:1;font-size:13px;font-weight:700;min-width:0;word-break:break-word;} .pc-rname small{display:block;font-size:10px;font-weight:600;color:rgba(255,255,255,.45);}
  .pc-figs{text-align:left;min-width:48px;flex-shrink:0;} .pc-num{font-size:13px;font-weight:900;} .pc-pct{font-size:10px;color:rgba(255,255,255,.5);} .pc-crown{font-size:15px;}
  .pc-out{text-align:center;margin:14px 0;padding:13px;border-radius:14px;background:linear-gradient(135deg,rgba(255,209,102,.14),rgba(251,111,146,.1));border:1px solid rgba(255,209,102,.3);} .pc-out-big{font-size:15px;font-weight:900;color:#FFD166;} .pc-out-s{font-size:11px;color:rgba(255,255,255,.7);margin-top:3px;}
  .pc-prod-h{font-size:12px;font-weight:800;margin:16px 0 9px;display:flex;align-items:center;gap:6px;} .pc-prod-h i{color:#FFD166;}
  .pc-prod{display:flex;flex-wrap:wrap;gap:7px;} .pc-pill{display:flex;align-items:center;gap:6px;background:rgba(255,209,102,.1);border:1px solid rgba(255,209,102,.25);border-radius:999px;padding:5px 11px 5px 5px;font-size:11px;font-weight:700;} .pc-pill-av{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0;}
  .pc-pill-me{background:linear-gradient(135deg,#FFD166,#FF9F45);color:#06140C;border:none;} .pc-pill-more{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.6);padding:5px 11px;}
  `;
  document.head.appendChild(st);
}

// 카드에 렌더된 빈 .pc-slot 들을 채움 (renderArtistHome 직후 호출)
window._pcRenderAll = function () {
  if (!window.Producing) return;
  _pcStyle();
  document.querySelectorAll('.pc-slot').forEach(function (slot) {
    _pcRenderSlot(slot, slot.dataset.pid, slot.dataset.track, slot.dataset.self === '1');
  });
};
function _pcRefreshSlot(slot) { if (slot) _pcRenderSlot(slot, slot.dataset.pid, slot.dataset.track, slot.dataset.self === '1'); }

async function _pcRenderSlot(slot, pid, trackId, isSelf) {
  if (!slot || !window.Producing) return;
  try {
    var rounds = await window.Producing.fetchForProject(pid);
    if (rounds === null) { slot.innerHTML = ''; return; }   // 기능 비활성(테이블 없음 등) → 슬롯 비움
    var mine = rounds.filter(function (r) { return String(r.track_id) === String(trackId); });
    var round = mine.length ? mine[mine.length - 1] : null;
    if (!round) { slot.innerHTML = isSelf ? _pcCreateCta(pid, trackId) : ''; return; }
    var detail = await window.Producing.fetchDetail(round.id);
    slot.innerHTML = _pcPanel(round, detail, isSelf);
  } catch (e) { console.warn('[pc] renderSlot', e); slot.innerHTML = ''; }
}

function _pcCreateCta(pid, trackId) {
  return '<div class="pc-box pc-empty">'
    + '<div class="pc-empty-ic">🎬</div>'
    + '<div class="pc-empty-t">' + _t('프로듀싱 라운드 만들기', 'Start a producing round') + '</div>'
    + '<div class="pc-empty-s">' + _t('다음 데모 방향을 청취자 투표로 정해요. A·B 두 안만 정하면 시작!', 'Let listeners vote on your next demo — just set A and B.') + '</div>'
    + '<button class="pc-cta" onclick="pcOpenForm(this,\'' + pcEsc(pid) + '\',\'' + pcEsc(trackId) + '\')"><i class="ri-rocket-2-line"></i> ' + _t('라운드 만들기', 'Create round') + '</button>'
    + '</div>';
}

function _pcForm(pid, trackId) {
  var chips = PC_TOPICS.map(function (t, i) { return '<button type="button" class="pc-topic" onclick="pcFillTopic(this,' + i + ')">' + t[0] + '</button>'; }).join('');
  return '<div class="pc-box">'
    + '<div class="pc-flag">🎬 ' + _t('라운드 만들기', 'Create round') + '</div>'
    + '<div class="pc-topics">' + chips + '</div>'
    + '<div class="pc-lab">' + _t('뭘 정할까요?', 'What to decide?') + '</div><input class="pc-q-in" maxlength="200" placeholder="' + _t('예: 후렴 편곡 / MV 의상…', 'e.g. hook arrangement / outfit…') + '">'
    + '<div class="pc-lab">' + _t('두 안 (A · B)', 'Two options (A · B)') + '</div><div class="pc-ab"><input class="pc-a-in" maxlength="80" placeholder="A"><input class="pc-b-in" maxlength="80" placeholder="B"></div>'
    + '<div class="pc-c-slot"></div><button type="button" class="pc-addc" onclick="pcAddC(this)"><i class="ri-add-line"></i> ' + _t('안 하나 더 (C)', 'Add option C') + '</button>'
    + '<div class="pc-lab">' + _t('마감', 'Closes in') + '</div><div class="pc-days"><button type="button" class="pc-day" data-day="1" onclick="pcPickDay(this)">' + _t('1일', '1d') + '</button><button type="button" class="pc-day on" data-day="3" onclick="pcPickDay(this)">' + _t('3일', '3d') + '</button><button type="button" class="pc-day" data-day="7" onclick="pcPickDay(this)">' + _t('7일', '7d') + '</button></div>'
    + '<div class="pc-form-btns"><button type="button" class="pc-ghost" onclick="pcCancelForm(this,\'' + pcEsc(pid) + '\',\'' + pcEsc(trackId) + '\')">' + _t('취소', 'Cancel') + '</button><button type="button" class="pc-open" onclick="pcCreate(this,\'' + pcEsc(pid) + '\',\'' + pcEsc(trackId) + '\')"><i class="ri-rocket-2-line"></i> ' + _t('라운드 열기', 'Open round') + '</button></div>'
    + '</div>';
}

function _pcCardHtml(key, name, on, roundId, clickable) {
  return '<div class="pc-card ' + key + (on ? ' on' : '') + '"' + (clickable ? ' onclick="pcVote(this,\'' + roundId + '\',\'' + key + '\')"' : '') + '>'
    + (on ? '<span class="pc-mine">' + _t('내 선택', 'Mine') + '</span>' : '')
    + '<span class="pc-badge">' + key.toUpperCase() + '</span><div class="pc-name">' + pcEsc(name) + '</div></div>';
}

function _pcPanel(round, detail, isSelf) {
  if (round.status === 'closed') return _pcResult(round, detail);
  return isSelf ? _pcArtistLive(round, detail) : _pcVote(round, detail);
}

function _pcVote(round, detail) {
  var cands = round.candidates || [], my = detail.myChoice;
  var vs = '<div class="pc-vs">';
  cands.slice(0, 2).forEach(function (c, i) { if (i === 1) vs += '<div class="pc-vs-mid">VS</div>'; vs += _pcCardHtml(c.key, c.name, my === c.key, round.id, true); });
  vs += '</div>';
  if (cands[2]) vs += '<div class="pc-vs" style="margin-top:9px;">' + _pcCardHtml(cands[2].key, cands[2].name, my === cands[2].key, round.id, true) + '</div>';
  var comments = (detail.comments || []).map(function (c) {
    var likes = detail.tally[c.id] || 0, on = my === c.id, nm = c.user_name || _t('익명', 'Anon');
    return '<div class="pc-cmt' + (on ? ' on' : '') + '"><div class="pc-cmt-av" style="background:' + _pcColor(nm) + '">' + pcEsc(nm.charAt(0)) + '</div>'
      + '<div class="pc-cmt-b"><div class="pc-cmt-u">' + pcEsc(nm) + '</div><div class="pc-cmt-t">' + pcEsc(c.body) + '</div></div>'
      + '<div class="pc-cmt-like" onclick="pcVote(this,\'' + round.id + '\',\'' + c.id + '\')"><i class="' + (on ? 'ri-heart-3-fill' : 'ri-heart-3-line') + '"></i><b>' + likes + '</b></div></div>';
  }).join('');
  var banner = my ? '<div class="pc-banner"><i class="ri-check-double-line"></i> ' + _t('참여 완료! 한 표는 한 곳에만 — 결과는 마감 때 공개', 'Voted! One token only — results at close') + '</div>' : '';
  return '<div class="pc-box">'
    + '<div class="pc-flag live">🎬 ' + _t('프로듀싱 · 투표', 'Producing · Vote') + '</div>'
    + '<div class="pc-q">' + pcEsc(round.question) + '</div>'
    + '<div class="pc-qsub">' + _t('A·B 중 하나 고르거나, 댓글에 추천(❤️) — 한 표만!', 'Pick A/B or back a comment — one token!') + '</div>'
    + vs
    + '<div class="pc-blind"><i class="ri-eye-off-line"></i> ' + _t('A·B 표는 가려져 있어요', 'A/B votes are hidden') + '</div>'
    + '<div class="pc-cmt-h">💬 ' + _t('다른 의견', 'Other ideas') + '<span class="pc-cmt-hint">' + _t('추천 많으면 이걸로!', 'Most-backed wins!') + '</span></div>'
    + comments
    + '<div class="pc-cmt-add"><input class="pc-newcmt" maxlength="300" placeholder="' + _t('내 의견 추가…', 'Add your idea…') + '"><button onclick="pcAddComment(this,\'' + round.id + '\')">' + _t('올리기', 'Post') + '</button></div>'
    + banner + '</div>';
}

function _pcArtistLive(round, detail) {
  var cands = round.candidates || [], a = cands[0] || {}, b = cands[1] || {};
  return '<div class="pc-box">'
    + '<div class="pc-flag live">🎬 ' + _t('진행 중 · 투표 중', 'Live · Voting') + '</div>'
    + '<div class="pc-q">' + pcEsc(round.question) + '</div>'
    + '<div class="pc-qsub">' + _t('표는 지금 안 보여요 (블라인드 · 마감 때 공개)', 'Votes hidden until you reveal') + '</div>'
    + '<div class="pc-vs"><div class="pc-card a"><span class="pc-badge">A</span><div class="pc-name">' + pcEsc(a.name || 'A') + '</div></div><div class="pc-vs-mid">VS</div><div class="pc-card b"><span class="pc-badge">B</span><div class="pc-name">' + pcEsc(b.name || 'B') + '</div></div></div>'
    + '<div class="pc-stat">🙋 <b>' + (detail.total || 0) + '</b> ' + _t('참여', 'votes') + ' · 💬 <b>' + (detail.comments.length) + '</b></div>'
    + '<button class="pc-reveal" onclick="pcClose(this,\'' + round.id + '\')"><i class="ri-lock-unlock-line"></i> ' + _t('지금 공개하기 (마감)', 'Reveal now (close)') + '</button>'
    + '</div>';
}

function _pcResult(round, detail) {
  var cands = round.candidates || [];
  var items = cands.map(function (c) { return { key: c.key, name: c.name, sub: c.key.toUpperCase() + _t('안', ''), v: detail.tally[c.key] || 0, isC: false }; });
  (detail.comments || []).forEach(function (c) { items.push({ key: c.id, name: c.body, sub: '💬 ' + (c.user_name || _t('익명', 'Anon')), v: detail.tally[c.id] || 0, isC: true }); });
  var total = items.reduce(function (s, it) { return s + it.v; }, 0) || 1;
  var max = items.reduce(function (m, it) { return Math.max(m, it.v); }, 0);
  items.sort(function (x, y) { return y.v - x.v; });
  var winner = items[0] || { name: '-', v: 0, key: null, isC: false };
  var rows = items.map(function (it) {
    var win = it.v === max && max > 0, pct = Math.round(it.v / total * 100);
    return '<div class="pc-row' + (win ? ' win' : '') + '"><div class="pc-bar" style="width:' + pct + '%"></div>'
      + '<span class="pc-rtag ' + (it.isC ? 'c' : it.key) + '">' + (it.isC ? 'C' : it.key.toUpperCase()) + '</span>'
      + '<div class="pc-rname">' + pcEsc(it.name) + '<small>' + pcEsc(it.sub) + '</small></div>'
      + (win ? '<span class="pc-crown">👑</span>' : '') + '<div class="pc-figs"><div class="pc-num">' + it.v + '</div><div class="pc-pct">' + pct + '%</div></div></div>';
  }).join('');
  var winKey = winner.key, myId = (window.__currentUser && window.__currentUser.id) || null;
  var iWon = detail.myChoice != null && String(detail.myChoice) === String(winKey) && max > 0;
  var prods = (detail.votes || []).filter(function (v) { return String(v.choice) === String(winKey) && v.user_id !== myId; });
  var meBadge = iWon ? '<div class="pc-pill pc-pill-me"><div class="pc-pill-av" style="background:#06140C">' + _t('나', 'Me') + '</div><span>' + _t('나 🎉', 'Me 🎉') + '</span></div>' : '';
  var pills = prods.slice(0, 6).map(function (v) { var nm = v.user_name || _t('익명', 'Anon'); return '<div class="pc-pill"><div class="pc-pill-av" style="background:' + _pcColor(nm) + '">' + pcEsc(nm.charAt(0)) + '</div><span>' + pcEsc(nm) + '</span></div>'; }).join('');
  var more = prods.length > 6 ? '<div class="pc-pill pc-pill-more">+' + (prods.length - 6) + '</div>' : '';
  var prodEmpty = (!meBadge && !pills) ? '<span style="font-size:11px;color:rgba(255,255,255,.4);">' + _t('아직 없어요', 'None yet') + '</span>' : '';
  var cmtThread = (detail.comments && detail.comments.length)
    ? '<div class="pc-cmt-h">💬 ' + _t('댓글', 'Comments') + ' ' + detail.comments.length + '</div>'
      + detail.comments.slice().sort(function (a, b) { return (detail.tally[b.id] || 0) - (detail.tally[a.id] || 0); }).slice(0, 2).map(function (c) {
          var won = String(winKey) === String(c.id), nm = c.user_name || _t('익명', 'Anon');
          return '<div class="pc-cmt' + (won ? ' won' : '') + '"><div class="pc-cmt-av" style="background:' + _pcColor(nm) + '">' + pcEsc(nm.charAt(0)) + '</div><div class="pc-cmt-b"><div class="pc-cmt-u">' + pcEsc(nm) + (won ? ' · 👑' : '') + '</div><div class="pc-cmt-t">' + pcEsc(c.body) + '</div></div><div class="pc-cmt-like liked"><i class="ri-heart-3-fill"></i><b>' + (detail.tally[c.id] || 0) + '</b></div></div>';
        }).join('')
    : '';
  return '<div class="pc-box">'
    + '<div class="pc-flag done">🎬 ' + _t('결과 공개', 'Results') + '</div>'
    + '<div class="pc-q">' + pcEsc(round.question) + '</div>'
    + rows
    + (max > 0 ? '<div class="pc-out"><div class="pc-out-big">👑 ' + pcEsc(winner.name) + '</div><div class="pc-out-s">' + (winner.isC ? _t('댓글이 이겼어요! 다음 데모는 이 의견대로 🎬', 'A comment won! Next demo follows it 🎬') : _t('이걸로 다음 데모 갑니다 🎬', 'This goes to the next demo 🎬')) + '</div></div>' : '<div class="pc-stat">' + _t('아직 표가 없어요', 'No votes yet') + '</div>')
    + cmtThread
    + '<div class="pc-prod-h"><i class="ri-medal-line"></i> ' + _t('이번 데모의 프로듀서', 'Producers') + (iWon ? _t(' — 나도 포함!', ' — incl. me!') : '') + '</div><div class="pc-prod">' + meBadge + pills + more + prodEmpty + '</div>'
    + '</div>';
}

window.pcOpenForm = function (el, pid, trackId) { var slot = el.closest('.pc-slot'); if (slot) slot.innerHTML = _pcForm(pid, trackId); };
window.pcCancelForm = function (el, pid, trackId) { var slot = el.closest('.pc-slot'); if (slot) slot.innerHTML = _pcCreateCta(pid, trackId); };
window.pcFillTopic = function (el, i) { var slot = el.closest('.pc-slot'), t = PC_TOPICS[i]; if (!slot || !t) return; slot.querySelectorAll('.pc-topic').forEach(function (c) { c.classList.remove('on'); }); el.classList.add('on'); slot.querySelector('.pc-q-in').value = t[1]; slot.querySelector('.pc-a-in').value = t[2]; slot.querySelector('.pc-b-in').value = t[3]; };
window.pcPickDay = function (el) { var slot = el.closest('.pc-slot'); slot.querySelectorAll('.pc-day').forEach(function (c) { c.classList.remove('on'); }); el.classList.add('on'); };
window.pcAddC = function (el) { var slot = el.closest('.pc-slot'); slot.querySelector('.pc-c-slot').innerHTML = '<input class="pc-c-in" maxlength="80" placeholder="C (' + _t('선택', 'optional') + ')">'; el.style.display = 'none'; };

window.pcCreate = async function (el, pid, trackId) {
  var slot = el.closest('.pc-slot'); if (!slot) return;
  if (!window.__currentUser || !window.__currentUser.id) { alert(_t('로그인이 필요해요', 'Login required')); return; }
  var q = (slot.querySelector('.pc-q-in').value || '').trim();
  var a = (slot.querySelector('.pc-a-in').value || '').trim();
  var b = (slot.querySelector('.pc-b-in').value || '').trim();
  if (!a || !b) { alert(_t('A·B 두 안을 적어주세요', 'Enter both A and B')); return; }
  var cEl = slot.querySelector('.pc-c-in'), cVal = cEl ? (cEl.value || '').trim() : '';
  var dayBtn = slot.querySelector('.pc-day.on'), days = dayBtn ? parseInt(dayBtn.dataset.day, 10) : 3;
  var candidates = [{ key: 'a', name: a }, { key: 'b', name: b }]; if (cVal) candidates.push({ key: 'c', name: cVal });
  el.disabled = true; var old = el.innerHTML; el.innerHTML = '...';
  try {
    await window.Producing.create({ projectId: pid, trackId: trackId, question: q || _t('다음 데모, 어디로?', 'Where next?'), candidates: candidates, closesAt: new Date(Date.now() + days * 86400000).toISOString() });
    if (typeof showToast === 'function') showToast(_t('라운드가 열렸어요! 🎬', 'Round opened! 🎬'));
    _pcRefreshSlot(slot);
  } catch (e) { alert(_t('실패: ', 'Failed: ') + (e.message || e)); el.disabled = false; el.innerHTML = old; }
};

window.pcVote = async function (el, roundId, choice) {
  var slot = el.closest('.pc-slot'); if (!slot) return;
  if (!window.__currentUser || !window.__currentUser.id) { alert(_t('로그인하면 투표할 수 있어요', 'Log in to vote')); return; }
  try { await window.Producing.vote(roundId, choice); _pcRefreshSlot(slot); }
  catch (e) { alert(_t('실패: ', 'Failed: ') + (e.message || e)); }
};

window.pcAddComment = async function (el, roundId) {
  var slot = el.closest('.pc-slot'); if (!slot) return;
  var inp = slot.querySelector('.pc-newcmt'), v = (inp.value || '').trim(); if (!v) return;
  if (!window.__currentUser || !window.__currentUser.id) { alert(_t('로그인하면 댓글을 달 수 있어요', 'Log in to comment')); return; }
  el.disabled = true;
  try { var c = await window.Producing.addComment(roundId, v); try { await window.Producing.vote(roundId, c.id); } catch (_) {} _pcRefreshSlot(slot); }
  catch (e) { alert(_t('실패: ', 'Failed: ') + (e.message || e)); el.disabled = false; }
};

window.pcClose = async function (el, roundId) {
  if (!confirm(_t('지금 공개할까요? 마감하면 투표가 닫혀요.', 'Reveal now? Voting will close.'))) return;
  var slot = el.closest('.pc-slot'); el.disabled = true;
  try { await window.Producing.close(roundId); _pcRefreshSlot(slot); }
  catch (e) { alert(_t('실패: ', 'Failed: ') + (e.message || e)); el.disabled = false; }
};

function _mhStyle() {
  return `<style id="mh-style">
.mh-page{position:relative;min-height:100%;padding:56px 0 calc(var(--player-height,60px) + env(safe-area-inset-bottom) + 28px);background:radial-gradient(circle at 50% 8%,#170b3b 0%,#050213 58%,#03000d 100%);color:#fff;font-family:'Pretendard',sans-serif;overflow-x:hidden;}
.mh-page *{box-sizing:border-box;}
.mh-stars{position:absolute;inset:0;pointer-events:none;opacity:.26;background-image:radial-gradient(#fff,rgba(255,255,255,.2) 1.4px,transparent 38px),radial-gradient(#fff,rgba(255,255,255,.14) 1px,transparent 28px);background-size:340px 340px,220px 220px;background-position:0 0,40px 60px;}
.mh-inner{position:relative;z-index:1;padding:0 18px;}
.mh-hand{font-family:'Nanum Pen Script',cursive;line-height:1.05;}
.mh-glass{background:rgba(255,255,255,.035);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.07);}
.mh-prof{display:flex;flex-direction:column;align-items:center;text-align:center;}
.mh-avatar{position:relative;width:72px;height:72px;border-radius:50%;padding:2px;background:linear-gradient(135deg,#facc15,#7c3aed);margin-bottom:10px;box-shadow:0 8px 24px rgba(124,58,237,.18);}
.mh-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}
.mh-avatar .mh-dot{position:absolute;bottom:1px;right:1px;width:14px;height:14px;background:#10b981;border:2px solid #03000d;border-radius:50%;}
.mh-name-row{display:flex;align-items:center;gap:8px;}
.mh-name{font-size:21px;font-weight:800;margin:0;}
.mh-editbtn{font-size:11px;font-weight:700;color:#fff;background:rgba(124,58,237,.9);padding:4px 11px;border-radius:999px;display:inline-flex;align-items:center;gap:3px;border:none;cursor:pointer;}
.mh-followbtn.is-following{background:rgba(255,255,255,.1);color:rgba(255,255,255,.78);}
.mh-cheer{border-radius:22px;padding:16px;}
.mh-cheer-row{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.mh-cheer-avs{display:flex;}
.mh-cheer-avs span{width:26px;height:26px;border-radius:50%;border:2px solid #0b0b11;margin-left:-8px;font-size:10px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;}
.mh-cheer-avs span:first-child{margin-left:0;}
.mh-cheer-cnt{font-size:12.5px;color:rgba(255,255,255,.7);font-weight:600;}
.mh-cheer-cnt b{color:#fff;}
.mh-cheer-btn{width:100%;border:none;border-radius:14px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;background:linear-gradient(95deg,#FB6F92,#F472B6);color:#fff;box-shadow:0 10px 24px rgba(251,111,146,.28);}
.mh-cheer-btn:active{transform:scale(.98);}
.mh-cheer-benefit{text-align:center;font-size:11.5px;color:rgba(255,255,255,.5);margin:11px 0 0;}
.mh-evo{border-radius:18px;padding:14px 16px;margin-top:10px;}
.mh-evo-track{display:flex;align-items:center;}
.mh-evo-node{width:22px;height:22px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;}
.mh-evo-node.done{background:linear-gradient(135deg,#7DF7AE,#36C977);color:#06140C;}
.mh-evo-node.done i{font-size:13px;}
.mh-evo-node.now{background:#0b0b11;border:2px solid #48E08B;color:#48E08B;box-shadow:0 0 10px rgba(72,224,139,.5);}
.mh-evo-node.lock{background:rgba(255,255,255,.05);border:1.5px dashed rgba(255,255,255,.2);color:rgba(255,255,255,.4);}
.mh-evo-node.lock i{font-size:10px;}
.mh-evo-seg{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.1);margin:0 3px;}
.mh-evo-seg.fill{background:linear-gradient(90deg,#36C977,#48E08B);}
.mh-evo-labels{display:flex;justify-content:space-between;margin-top:8px;}
.mh-evo-labels span{font-size:9px;color:rgba(255,255,255,.42);font-weight:600;flex:1;text-align:center;}
.mh-evo-labels span:first-child{text-align:left;}
.mh-evo-labels span:last-child{text-align:right;}
.mh-evo-go{text-align:center;font-size:12px;font-weight:700;color:#48E08B;margin-top:9px;}
.mh-shelf{display:flex;gap:11px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;}
.mh-shelf::-webkit-scrollbar{display:none;}
.mh-shelf-empty{font-size:12px;color:rgba(255,255,255,.4);padding:6px 2px;}
.mh-rcard{flex:0 0 116px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:12px;cursor:pointer;}
.mh-rcover{width:100%;height:68px;border-radius:11px;display:flex;align-items:center;justify-content:center;margin-bottom:9px;overflow:hidden;}
.mh-rcover .mh-hand{color:#000;font-weight:800;font-size:20px;}
.mh-rn{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.mh-rs{font-size:10.5px;color:rgba(255,255,255,.5);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.mh-bio{font-size:11.5px;color:rgba(255,255,255,.55);max-width:280px;line-height:1.55;margin:6px 0 0;}
.mh-stats{display:flex;gap:6px;margin-top:13px;flex-wrap:wrap;justify-content:center;}
.mh-stat{font-size:10.5px;font-weight:700;padding:4px 10px;border-radius:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);}
.mh-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:14px;justify-content:center;}
.mh-tag{font-size:10px;color:rgba(255,255,255,.6);background:rgba(255,255,255,.05);padding:4px 11px;border-radius:999px;}
.mh-fancard{width:100%;margin-top:16px;background:#fbbf24;color:#000;border-radius:18px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 8px 24px rgba(251,191,36,.08);}
.mh-fancard .lbl{font-size:8px;font-weight:800;color:rgba(0,0,0,.5);letter-spacing:.12em;text-transform:uppercase;display:block;line-height:1;}
.mh-fancard .val{font-size:13px;font-weight:900;display:block;margin-top:2px;}
.mh-fancard .rgt{width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.1);display:flex;align-items:center;justify-content:center;color:#000;font-size:15px;}
.mh-sec{padding:0 18px;margin-top:24px;position:relative;z-index:1;}
.mh-sec-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;gap:8px;}
.mh-sec-title{font-size:12px;font-weight:700;color:rgba(255,255,255,.42);display:flex;align-items:center;gap:5px;margin:0;}
.mh-sec-sub{font-size:9px;color:rgba(255,255,255,.3);margin:0;text-align:right;}
.mh-cover{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;padding:6px;text-align:center;flex-shrink:0;position:relative;overflow:hidden;}
.mh-cover.big{width:64px;height:64px;border-radius:18px;}
.mh-cover::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,0,0,.18),transparent);}
.mh-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;}
.mh-cover .ln{color:#000;font-weight:800;font-size:16px;position:relative;z-index:2;}
.mh-cover-lines{position:relative;z-index:2;color:rgba(0,0,0,.82);font-weight:800;font-size:7.5px;line-height:1.22;text-align:center;padding:3px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}
.mh-cover.big .mh-cover-lines{font-size:9px;line-height:1.25;}
.mh-latest{border-radius:26px;padding:14px;display:flex;gap:12px;align-items:center;justify-content:space-between;border:1px solid rgba(244,63,94,.2);box-shadow:0 12px 30px rgba(244,63,94,.05);}
.mh-latest .meta{display:flex;gap:12px;align-items:center;min-width:0;}
.mh-chip-demo{font-size:9px;background:rgba(244,63,94,.2);color:#fda4af;font-weight:700;padding:1px 6px;border-radius:6px;}
.mh-play{width:40px;height:40px;border-radius:50%;background:#1db954;color:#000;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-size:18px;transition:transform .15s;}
.mh-play:active{transform:scale(.94);}
.mh-track{border-radius:28px;padding:14px;border:1px solid rgba(255,255,255,.05);margin-bottom:11px;}
.mh-track-head{display:flex;align-items:center;gap:12px;}
.mh-track-open{display:flex;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer;}
.mh-track-open:active{opacity:.7;}
.mh-state{font-size:8px;font-weight:800;padding:1px 6px;border-radius:6px;border:1px solid;white-space:nowrap;}
.mh-track-title{font-size:12px;font-weight:900;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mh-track-note{font-size:10px;color:rgba(255,255,255,.5);margin:4px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mh-pbtn{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-size:15px;transition:transform .15s;}
.mh-pbtn:active{transform:scale(.9);}
.mh-nodes{margin-top:11px;padding:11px 8px 0;border-top:1px solid rgba(255,255,255,.05);display:flex;align-items:center;justify-content:space-between;}
.mh-node{display:flex;flex-direction:column;align-items:center;cursor:pointer;flex-shrink:0;}
.mh-node-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;transition:all .25s;}
.mh-node-date{font-size:8px;margin-top:4px;transition:color .2s;}
.mh-node-bar{flex:1;height:1.5px;background:rgba(255,255,255,.1);margin:-12px 4px 0;}
.mh-node-add .mh-add-dot{background:rgba(167,139,250,.08);border:1.5px dashed rgba(167,139,250,.55);color:#a78bfa;}
.mh-node-add .mh-add-dot i{font-size:13px;}
.mh-node-add:hover .mh-add-dot{background:rgba(167,139,250,.2);border-color:#a78bfa;box-shadow:0 0 10px rgba(167,139,250,.4);}
.mh-node-add .mh-node-date{color:rgba(167,139,250,.75)!important;}
.mh-manage{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:11px;border-top:1px dashed rgba(255,255,255,.07);}
.mh-manage-label{flex:1;min-width:0;font-size:10.5px;color:rgba(255,255,255,.42);display:flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mh-manage-label i{color:#6ee7b7;font-size:12px;}
.mh-node-del{flex-shrink:0;display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:#f87171;border-radius:9px;padding:5px 11px;font-size:10.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:background .15s;}
.mh-node-del:active{background:rgba(239,68,68,.22);}
.mh-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:48px 0;}
@media(min-width:769px){.mh-page{max-width:520px;margin:0 auto;}}
</style>`;
}

// 내 페이지(my-artist)용 얇은 래퍼 — 로그인 사용자 이름으로 홈 디자인 렌더.
function renderMyHome() {
  const me = window.__currentUser || (window.DB.get() || {}).currentUser;
  if (!me || !me.name) { navigateTo('auth'); return; }
  renderArtistHome(me.name);
}

// 팔로우 버튼 → toggleFollowArtist(id, name) (data-속성으로 안전 전달, JS 문자열 이스케이프 회피)
window.mhFollow = function (btn) {
  if (!btn) return;
  try { toggleFollowArtist(btn.dataset.aid || '', btn.dataset.aname || ''); }
  catch (e) { console.warn('[myhome] follow', e); }
};

// 응원 버튼 → openCheerModal(트랙id, 제목, 아티스트) (data-속성으로 안전 전달)
window.mhCheer = function (btn) {
  if (!btn) return;
  try { openCheerModal(btn.dataset.tid || '', btn.dataset.tt || '', btn.dataset.an || ''); }
  catch (e) { console.warn('[myhome] cheer', e); }
};

// 플레이어 구간 건너뛰기 — 현재 곡 내에서 delta초 앞/뒤로 (후렴/벌스 점프 대용).
window.playerSeek = function (delta) {
  const a = window.audioElement;
  if (!a || !a.duration || isNaN(a.duration)) return;
  a.currentTime = Math.max(0, Math.min(a.duration - 0.3, (a.currentTime || 0) + delta));
  try { if (typeof updateProgress === 'function') updateProgress(); } catch (_) {}
};

// 아티스트 홈(데모 타임라인) — 내 페이지(my-artist)와 남의 아티스트 페이지(artist:) 공용.
// isSelf 면 편집, 아니면 팔로우 버튼. 데이터는 db.tracks(해당 아티스트)에서 그대로.
function renderArtistHome(artistName) {
  if (typeof artistName === 'string' && artistName.indexOf('%') >= 0) {
    try { artistName = decodeURIComponent(artistName); } catch (_) {}
  }
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  const db = window.DB.get();
  const me = window.__currentUser || (db && db.currentUser);
  if (!artistName) { if (me && me.name) artistName = me.name; else { navigateTo('auth'); return; } }
  const isSelf = !!(me && me.name === artistName);
  const myName = artistName;
  const myId = isSelf ? me.id : null;
  const esc = (s) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const COLORS = ['#FF2EA0','#00E5FF','#B14BFF','#FF9100','#76FF03','#FF4D6D','#2EE6D6','#9D4EDD','#FFD166','#4D9DFF'];
  const colorFor = (s) => COLORS[(_hashSeed(s || 'x') >>> 0) % COLORS.length];

  const artistData = (db.following || []).find(a => a && a.name === artistName) || {};
  const myTracks = (db.tracks || []).filter(t => t && (t.artist === myName || (myId && t.artistId === myId)));
  const artistSupaId = (myTracks.find(t => t && t.artistId) || {}).artistId || artistData.id || '';
  const isFollowing = (!isSelf && window._isFollowingName) ? window._isFollowingName(artistName) : false;
  const avatar = (isSelf && me.avatar) || (myTracks[0] && myTracks[0].artistAvatar) || artistData.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(myName));
  const bio = (isSelf && me.bio) || artistData.bio
            || (isSelf ? _t('아직 소개가 없어요. 프로필 편집에서 한 줄 남겨보세요 🎧', 'No bio yet — add a line in profile settings 🎧')
                       : _t('아직 소개가 없어요', 'No bio yet'));
  const cleanTitle = (s) => (s || '무제').replace(/\s*\(.*\)$/, '');

  // 프로젝트(곡) 단위로 묶기 → 각 프로젝트의 versions = 데모 타임라인
  const projMap = {};
  myTracks.forEach(t => {
    const pid = t.projectId || ('proj_' + t.id);
    (projMap[pid] = projMap[pid] || []).push(t);
  });

  const tracks = Object.entries(projMap).map(([pid, versions]) => {
    const vs = versions.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const hasFinal = vs.some(v => v && !v.isDemo && v.version === 'final');
    const rep = vs.find(v => !v.isDemo) || vs[vs.length - 1];
    const title = cleanTitle(rep.title);
    const demos = vs.map((v, i) => {
      const m = /^demo(\d+)$/.exec(v.version || '');
      const isFinal = (v.version === 'final' && !v.isDemo);
      return {
        id: v.id,
        label: isFinal ? '★' : (m ? ('D' + m[1]) : ('D' + (i + 1))),
        date: _mhYMD(v.createdAt),
        verLabel: v.versionLabel || (isFinal ? _t('정규 발매','Release') : ('Demo ' + (m ? m[1] : (i + 1)))),
        desc: v.artistNote || v.description || '',
        isFinal
      };
    });
    let idx = window.__mhState[pid];
    if (idx == null || idx >= demos.length || idx < 0) idx = demos.length - 1;
    const lastTime = new Date(vs[vs.length - 1].createdAt || 0).getTime();
    return { pid, title, hasFinal, color: genreColorOf(rep), cover: rep.cover || '', lines: rep.lines || [], demos, currentDemoIdx: idx, lastTime };
  }).sort((a, b) => b.lastTime - a.lastTime);

  // 통계
  const albumCount = tracks.length;
  const demoTotal = myTracks.filter(t => t.isDemo).length;
  const releasedCount = tracks.filter(t => t.hasFinal).length;
  const times = myTracks.map(t => new Date(t.createdAt || 0).getTime()).filter(n => n > 0);
  const sinceLabel = times.length ? _mhYM(new Date(Math.min(...times))) : '';

  // 태그 클라우드 (트랙 태그 집계 상위 4)
  const tagCount = {};
  myTracks.forEach(t => (Array.isArray(t.tags) ? t.tags : []).forEach(tg => { if (tg) tagCount[tg] = (tagCount[tg] || 0) + 1; }));
  const topTags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]).slice(0, 4);

  // 최신 활성 데모
  const sortedDesc = myTracks.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const latest = sortedDesc.find(t => t.isDemo) || sortedDesc[0] || null;

  // 데모 기본 커버('Coming Soon' 노란 포스트잇, fill #FFF59D)는 도형에 쓴 글(lines)로 대체 — 발견 도형처럼.
  const _isCSCover = (c) => typeof c === 'string' && (c.indexOf('FFF59D') >= 0 || /Coming\s*Soon/i.test(c));
  const coverTile = (cls, color, cover, title, lines) => {
    if (cover && !_isCSCover(cover)) return `<div class="mh-cover ${cls}" style="background:${color}"><img src="${esc(cover)}" alt=""></div>`;
    const _ln = (Array.isArray(lines) ? lines : []).map(l => (l || '').trim()).filter(Boolean).slice(0, 3);
    const inner = _ln.length
      ? `<span class="mh-cover-lines">${_ln.map(l => esc(l)).join('<br>')}</span>`
      : `<span class="mh-hand ln">${esc((title || '').slice(0, 4))}</span>`;
    return `<div class="mh-cover ${cls}" style="background:${color}">${inner}</div>`;
  };

  // === 최신 활성 데모 위젯 ===
  let latestHtml = '';
  if (latest) {
    const lt = cleanTitle(latest.title);
    const lc = genreColorOf(latest);
    const _dmL = /^demo\s*(\d+)$/i.exec((latest.version || '').trim()) || /demo\s*(\d+)/i.exec((latest.versionLabel || '').trim());
    const lLabel = _dmL ? _t('데모 ' + _dmL[1], 'Demo ' + _dmL[1]) : (latest.isDemo ? _t('데모', 'Demo') : 'MASTER');
    latestHtml = `
      <div class="mh-sec">
        <div class="mh-sec-head">
          <h2 class="mh-sec-title"><i class="ri-fire-fill" style="color:#f43f5e"></i> ${_t('최신 활성 데모','Latest active demo')}</h2>
        </div>
        <div class="mh-latest mh-glass">
          <div class="meta">
            ${coverTile('big', lc, latest.cover, lt, latest.lines)}
            <div style="min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="mh-chip-demo">${esc(lLabel)}</span>
                <span style="font-size:9px;color:rgba(255,255,255,.4);">${_mhYM(latest.createdAt)}</span>
              </div>
              <h3 style="font-size:14px;font-weight:900;margin:4px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(lt)}</h3>
              <p style="font-size:10px;color:rgba(255,255,255,.5);margin:2px 0 0;">${esc(myName)}</p>
            </div>
          </div>
          <button class="mh-play" onclick="playTrack('${latest.id}')" aria-label="play"><i class="ri-play-fill"></i></button>
        </div>
      </div>`;
  }

  // === 음악 히스토리 ===
  let histHtml = '';
  if (tracks.length) {
    const cards = tracks.map(tr => {
      const cur = tr.demos[tr.currentDemoIdx] || tr.demos[tr.demos.length - 1];
      const stateLabel = tr.hasFinal ? _t('발매완료','Released') : _t('미발매','Unreleased');
      const stBg = tr.hasFinal ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.05)';
      const stCol = tr.hasFinal ? '#34d399' : 'rgba(255,255,255,.6)';
      const stBd = tr.hasFinal ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.1)';
      const nodes = tr.demos.map((d, i) => {
        const on = (i === tr.currentDemoIdx);
        return `<div class="mh-node ${on ? 'active' : ''}" onclick="mhSelectDemo('${tr.pid}',${i},'${d.id}',event)">`
          + `<div class="mh-node-dot" style="background:${on ? tr.color : 'rgba(255,255,255,.15)'};color:${on ? '#000' : 'rgba(255,255,255,.7)'};box-shadow:${on ? '0 0 10px ' + tr.color : 'none'};">${d.label}</div>`
          + `<span class="mh-node-date" style="color:${on ? '#fff' : 'rgba(255,255,255,.4)'};">${d.date}</span></div>`;
      }).join('<div class="mh-node-bar"></div>');
      // 본인 페이지면 마지막에 '+' 노드(D{다음번호}) — 그 곡의 다음 데모 올리기. 미발매(데모 단계)일 때만.
      // 보는 사람에겐 안 보임(지금처럼 D1·D2만).
      let addNode = '';
      if (isSelf && !tr.hasFinal) {
        const _dnums = tr.demos.filter(d => !d.isFinal).map(d => { const mm = /^D(\d+)$/.exec(d.label); return mm ? parseInt(mm[1], 10) : 0; });
        const nextNum = (_dnums.length ? Math.max(..._dnums) : 0) + 1;
        addNode = '<div class="mh-node-bar"></div>'
          + `<div class="mh-node mh-node-add" onclick="event.stopPropagation(); quickUploadDemoToProject('${esc(tr.pid)}')" title="${_t('다음 데모 올리기','Upload next demo')}">`
          + '<div class="mh-node-dot mh-add-dot"><i class="ri-add-line"></i></div>'
          + `<span class="mh-node-date">D${nextNum}</span></div>`;
      }
      // 본인 페이지: 선택된 데모 관리(삭제). 예전엔 앨범 페이지에서 삭제했지만, 앨범 입구를 숨기면서 노드 쪽으로 옮김.
      // 노드를 탭하면 그 데모가 선택(재생)되고 아래 줄의 삭제 버튼이 그 데모를 가리킴.
      const manageHtml = isSelf
        ? `<div class="mh-manage">
             <span class="mh-manage-label"><i class="ri-checkbox-circle-line"></i> ${esc(cur.verLabel)} ${_t('선택됨','selected')}</span>
             <button class="mh-node-del" onclick="event.stopPropagation(); deleteMyTrack('${cur.id}','${(tr.title || '').replace(/'/g, "\\'")} ${esc(cur.verLabel)}')" title="${_t('이 데모 삭제','Delete this demo')}"><i class="ri-delete-bin-line"></i> ${_t('이 데모 삭제','Delete demo')}</button>
           </div>`
        : '';
      return `
        <div class="mh-track mh-glass">
          <div class="mh-track-head">
            <div class="mh-track-open" onclick="playTrack('${cur.id}')" title="${_t('재생','Play')}">
              ${coverTile('', tr.color, tr.cover, tr.title, tr.lines)}
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="mh-state" style="background:${stBg};color:${stCol};border-color:${stBd};">${stateLabel}</span>
                  <h3 class="mh-track-title">${esc(tr.title)}</h3>
                </div>
                <p class="mh-track-note"><strong style="color:${tr.color};">${esc(cur.verLabel)} ${_t('에디션','edit')}</strong>${cur.desc ? ' · ' + esc(cur.desc) : ''}</p>
              </div>
            </div>
            <button class="mh-pbtn" onclick="playTrack('${cur.id}')" aria-label="play"><i class="ri-play-fill"></i></button>
          </div>
          <div class="mh-nodes">${nodes}${addNode}</div>
          ${manageHtml}
          <div class="pc-slot" data-pid="${esc(tr.pid)}" data-track="${esc(cur.id)}" data-self="${isSelf ? '1' : '0'}"></div>
        </div>`;
    }).join('');
    histHtml = `
      <div class="mh-sec">
        <div class="mh-sec-head">
          <h2 class="mh-sec-title"><i class="ri-music-2-line" style="color:#a78bfa"></i> ${_t('음악 히스토리','Music history')} (${tracks.length})</h2>
          <p class="mh-sec-sub">${_t('데모 단계를 탭해 들어보세요','Tap a demo stage to listen')}</p>
        </div>
        ${cards}
      </div>`;
  } else {
    histHtml = `
      <div class="mh-sec">
        <div class="mh-empty">
          <i class="ri-disc-line" style="font-size:32px;opacity:.4;"></i>
          <p style="margin:10px 0 0;font-size:13px;color:rgba(255,255,255,.6);">${_t('아직 올린 곡이 없어요','No tracks yet')}</p>
          ${isSelf ? `<button class="mh-editbtn" style="margin-top:12px;" onclick="navigateTo('upload')"><i class="ri-add-line"></i> ${_t('곡 올리기','Upload a track')}</button>` : ''}
        </div>
      </div>`;
  }

  const tagsHtml = topTags.length
    ? `<div class="mh-tags">${topTags.map(tg => `<span class="mh-tag">#${esc(tg)}</span>`).join('')}</div>`
    : '';

  const fanHtml = sinceLabel ? `
    <div class="mh-fancard">
      <div style="display:flex;align-items:center;gap:8px;text-align:left;">
        <i class="ri-heart-3-fill" style="color:#e11d48;font-size:16px;"></i>
        <div>
          <span class="lbl">${_t('작업 타임라인','Studio timeline')}</span>
          <span class="val">${sinceLabel} ~ Present</span>
        </div>
      </div>
      <span class="rgt"><i class="ri-arrow-right-s-line"></i></span>
    </div>` : '';

  appContent.innerHTML = `${_mhStyle()}
    <div class="mh-page">
      <div class="mh-stars"></div>
      <div class="mh-inner">
        <section class="mh-prof">
          <div class="mh-avatar"><img src="${esc(avatar)}" alt=""><span class="mh-dot"></span></div>
          <div class="mh-name-row">
            <h1 class="mh-name">${esc(myName)}</h1>
            ${isSelf
              ? `<button class="mh-editbtn" onclick="editProfile()"><i class="ri-settings-3-line"></i> ${_t('편집','Edit')}</button>`
              : `<button class="mh-editbtn mh-followbtn${isFollowing ? ' is-following' : ''}" data-aid="${esc(artistSupaId)}" data-aname="${esc(artistName)}" onclick="mhFollow(this)"><i class="ri-${isFollowing ? 'user-follow-fill' : 'user-add-line'}"></i> ${isFollowing ? _t('팔로잉','Following') : _t('팔로우','Follow')}</button>`}
          </div>
          <p class="mh-bio">${esc(bio)}</p>
          <div class="mh-stats">
            <span class="mh-stat" style="color:#c4b5fd;">${_t('앨범','Albums')} ${albumCount}</span>
            <span class="mh-stat" style="color:#fcd34d;">${_t('데모','Demos')} ${demoTotal}</span>
            <span class="mh-stat" style="color:#6ee7b7;">${_t('발매','Released')} ${releasedCount}</span>
            ${sinceLabel ? `<span class="mh-stat" style="color:rgba(255,255,255,.4);">${esc(sinceLabel.slice(0,4))}~</span>` : ''}
          </div>
          ${tagsHtml}
          ${fanHtml}
        </section>
        ${latestHtml}
        ${histHtml}
      </div>
    </div>`;

  window.__currentArtistName = artistName;
  // 데모 노드 아래 프로듀싱 패널을 비동기로 채움(테이블 없으면 graceful 무시)
  setTimeout(function () { try { window._pcRenderAll && window._pcRenderAll(); } catch (e) { console.warn('[pc] renderAll', e); } }, 0);
}

function renderArtistProfile(artistName) {
  // 통일(2026-06-25): 아티스트 페이지도 홈 디자인(데모 타임라인)으로 렌더.
  // renderArtistHome 가 self/남(편집/팔로우)·데이터·비동기를 모두 처리.
  // ↓ 아래 옛 단일스크롤 렌더는 이제 호출 안 됨(dead code, 참조용 보존).
  return renderArtistHome(artistName);
  // Defensive decode — if the caller passed a URL-encoded name like
  // "%EA%B9%80..." we want to display "김주형" in the header instead.
  if (typeof artistName === 'string' && artistName.indexOf('%') >= 0) {
    try { artistName = decodeURIComponent(artistName); } catch (_) {}
  }
  const db = window.DB.get();
  const artistTracks = db.tracks.filter(t => t.artist === artistName);
  // 아티스트의 프로필 ID 셋 — 이름이 바뀌었거나 매칭이 안 맞아도 author_id 로 잡힌다.
  // (이게 빠져 있어서 "소식이랑 우리들의 벽 연동 안되는" 케이스가 생김)
  const _artistProfileIds = new Set();
  artistTracks.forEach(t => { if (t && t.artistId) _artistProfileIds.add(t.artistId); });
  if (window.__currentUser && window.__currentUser.name === artistName && window.__currentUser.id) {
    _artistProfileIds.add(window.__currentUser.id);
  }
  const artistNotes = (db.notes || []).filter(n => {
    if (!n) return false;
    if (n.author === artistName) return true;
    if (n.authorId && _artistProfileIds.has(n.authorId)) return true;
    return false;
  });
  const artistData = (db.following || []).find(a => a.name === artistName) || {};
  const isSelf = (window.__currentUser && window.__currentUser.name === artistName) ||
                 (db.currentUser && db.currentUser.name === artistName);
  // 본인이면 막 저장된 __currentUser 가 가장 최신 — 캐시된 트랙 아바타보다 우선.
  // (옛 아바타로 캐시된 트랙 데이터가 새로 저장한 아바타를 덮어버리는 문제 방지)
  const avatar = (isSelf && window.__currentUser && window.__currentUser.avatar)
              ? window.__currentUser.avatar
              : (artistTracks[0]?.artistAvatar || artistData.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(artistName)));
  const sns = (isSelf && window.__currentUser && window.__currentUser.sns) || artistData.sns || {};
  const snsHtml = generateSnsLinks(sns);

  // === Role detection ===
  // Heuristic: declared role > track count > name prefix
  // - artistData.role (from following/onboarding mock)
  // - artistTracks.length > 0 → 아티스트
  // - name starts with "청취자" → 리스너
  // Unified artist page — no more listener-vs-artist branching. Every
  // /artist:<name> page shows the same layout (header + 소식 + tracks +
  // 응원 wall) regardless of whether the person has uploaded tracks yet.
  let role = artistData.role || (artistTracks.length > 0 ? 'artist' : 'listener');
  const isArtistRole = true;
  const roleLabel = role === 'admin' ? '관리자' : '아티스트';

  // Attempt to get artist ID from an already-loaded Supabase track (no network). Look up by name later, async.
  const firstSupabaseTrack = artistTracks.find(t => t.__supabase && t.artistId);
  let artistSupabaseId = firstSupabaseTrack ? firstSupabaseTrack.artistId : null;
  let fanCount = artistSupabaseId && window.__fanCounts ? (window.__fanCounts.get(artistSupabaseId) || 0) : 0;
  let iFollow = artistSupabaseId && window.__followed ? window.__followed.has(artistSupabaseId) : false;

  // 자기소개(bio): 본인이면 __currentUser.bio 즉시, 다른 사람이면 fetchProfileByName 비동기로 채움
  let initialBio = '';
  if (isSelf && window.__currentUser && window.__currentUser.bio) {
    initialBio = window.__currentUser.bio;
  } else if (!isSelf && artistData && artistData.bio) {
    initialBio = artistData.bio;
  }

  // Group tracks by projectId
  const projects = {};
  artistTracks.forEach(t => {
    const pid = t.projectId || 'proj_' + t.id;
    if (!projects[pid]) projects[pid] = [];
    projects[pid].push(t);
  });

  // Notes strip
  let notesHtml = '';
  if (artistNotes.length > 0) {
    notesHtml = artistNotes.map(note => {
      const c = NOTE_COLORS[note.color] || NOTE_COLORS.yellow;
      const rot = note.rotation || (Math.random() * 6 - 3);
      const safeText = (note.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      return `<div class="artist-note" style="background:${c.bg}; color:${c.text}; --rot:${rot}deg;" onclick="openNoteDetail('${note.id}')"><div class="note-body">${safeText}</div></div>`;
    }).join('');
  }

  // Split projects: 청취곡 (마스터 있음) vs 데모곡 (데모만 있음)
  const releasedProjects = {}; // has at least one final/master
  const demoOnlyProjects = {}; // demos only, no master yet
  Object.entries(projects).forEach(([pid, versions]) => {
    const hasMaster = versions.some(v => !v.isDemo);
    if (hasMaster) releasedProjects[pid] = versions;
    else demoOnlyProjects[pid] = versions;
  });

  let releasedHtml = '';
  Object.entries(releasedProjects).forEach(([pid, versions]) => {
    releasedHtml += renderProjectBox(pid, versions);
  });

  let demoHtml = '';
  Object.entries(demoOnlyProjects).forEach(([pid, versions]) => {
    demoHtml += renderProjectBox(pid, versions);
  });

  const releasedCount = Object.keys(releasedProjects).length;
  const demoCount = Object.keys(demoOnlyProjects).length;

  // === 새 단일스크롤 레이아웃 데이터: 최신 데모 hero + 앨범 카드 + 주절주절 피드 ===
  const _esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _sortedTracks = artistTracks.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const latestTrack = _sortedTracks[0] || null;
  // 앨범(프로젝트) 카드 — 프로젝트별 대표(마스터 우선, 없으면 최신 데모) + 데모 수.
  const albumCards = Object.entries(projects).map(([pid, versions]) => {
    const vs = versions.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const master = versions.find(v => !v.isDemo);
    const rep = master || vs[0];
    const demoN = versions.filter(v => v.isDemo).length;
    return {
      pid,
      id: rep.id,
      title: (rep.title || '').replace(/\s*\(Demo.*\)$/i, ''),
      cover: rep.cover || '',
      meta: master
        ? (demoN ? _t('정규 · 데모 ' + demoN, 'Release · ' + demoN + ' demos') : _t('정규', 'Release'))
        : _t('데모 ' + demoN + '개', demoN + (demoN === 1 ? ' demo' : ' demos')),
      latestTime: new Date(vs[0].createdAt || 0).getTime()
    };
  }).sort((a, b) => b.latestTime - a.latestTime);
  // 주절주절 피드 — 이 아티스트의 노트(소식)를 스레드 포스트로.
  const _meU = window.__currentUser || db.currentUser || null;
  const _myId2 = _meU && _meU.id;
  const artistFeedPosts = artistNotes
    .slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map(n => ({
      id: n.id, name: n.author || artistName, avatar: avatar,
      time: _threadTimeAgo(n.createdAt), text: n.text || '', image: n.imageUrl || null,
      track: n.trackId ? _threadTrackOf(n.trackId) : null,
      comments: (n.comments || []).length, isMine: !!(_myId2 && n.authorId === _myId2),
      collected: !!(window.Walls && window.Walls.isBookmarked && window.Walls.isBookmarked(n.id)),
      liked: _isNoteLiked(n.id),
      likeCount: (window.Walls && window.Walls.favoriteCount) ? window.Walls.favoriteCount(n.id) : 0
    }));

  // Legacy combined html (still used as fallback when split has nothing)
  let projectsHtml = releasedHtml + demoHtml;

  const safeName = artistName.replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Build activity timeline: notes + tracks merged chronologically (newest first)
  const activity = [];
  artistNotes.forEach(n => activity.push({ type: 'note', time: n.createdAt, data: n }));
  artistTracks.forEach(t => activity.push({ type: 'track', time: t.createdAt, data: t }));
  activity.sort((a, b) => new Date(b.time) - new Date(a.time));
  const recentActivity = activity.slice(0, 6);

  const timelineHtml = recentActivity.map(item => {
    const dateLabel = daysAgo(item.time);
    if (item.type === 'note') {
      const txt = (item.data.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').split('\n')[0];
      return `
        <div class="timeline-item" onclick="openNoteDetail('${item.data.id}')">
          <div class="timeline-icon note-icon"><i class="ri-sticky-note-fill"></i></div>
          <div class="timeline-content">
            <div class="timeline-meta">${dateLabel} · 포스트잇</div>
            <div class="timeline-text">${txt}</div>
          </div>
        </div>
      `;
    } else {
      const t = item.data;
      const isDemo = t.version && t.version !== 'final';
      const icon = isDemo ? 'ri-draft-line' : 'ri-music-2-fill';
      const badge = isDemo ? '<span class="demo-chip">DEMO</span>' : '<span class="final-chip">✦ MASTER</span>';
      return `
        <div class="timeline-item" onclick="playTrack('${t.id}')">
          <div class="timeline-icon ${isDemo ? 'demo-icon' : 'master-icon'}"><i class="${icon}"></i></div>
          <div class="timeline-content">
            <div class="timeline-meta">${dateLabel} · ${isDemo ? '데모 공개' : '마스터 완성'}</div>
            <div class="timeline-text">${badge} ${(t.versionLabel || t.title || '').replace(/</g,'&lt;')}</div>
          </div>
        </div>
      `;
    }
  }).join('');

  // Artist notes grid — show all, wrapping
  const _meForCm = window.__currentUser || (window.DB.get && window.DB.get().currentUser);
  const notesGridCards = artistNotes.map((n, i) => {
    const col = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
    const rot = n.rotation || ((i % 2 === 0 ? -1 : 1) * (Math.random() * 3 + 0.5));
    const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    // 댓글 목록 — 최근 3개. submitInlineComment 가 여기에 바로 한 줄 추가함.
    const _escCm = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _noteCms = Array.isArray(n.comments) ? n.comments : [];
    const cmListHtml = `<div class="artist-postit-cm-list">${_noteCms.slice(-1).map(c => `<div class="artist-postit-cm-line">ㄴ ${_escCm(c.text)} <span class="artist-postit-cm-auth">— ${_escCm(c.author || '익명')}</span></div>`).join('')}</div>`;
    // 인라인 댓글 입력 — 로그인 시에만, 클릭 없이도 바로 보임
    const inlineCm = _meForCm ? `
      <form class="note-inline-form" onclick="event.stopPropagation();" onsubmit="event.preventDefault(); event.stopPropagation(); submitInlineComment('${n.id}', this);">
        <input type="text" class="note-inline-input" maxlength="200" placeholder="${_t('ㄴ 댓글 남기기', 'ㄴ Leave a comment')}" onclick="event.stopPropagation();">
      </form>
    ` : '';
    return `
      <div class="artist-postit" style="background:${col.bg}; color:${col.text}; --rot:${rot}deg;" onclick="openNoteDetail('${n.id}')">
        <div class="artist-postit-body">${safeTxt}</div>
        ${cmListHtml}
        ${inlineCm}
      </div>
    `;
  }).join('');
  // 본인이면 데모처럼 그리드 끝에 빈 포스트잇(+) 카드 — 누르면 글 쓰기로
  const addCard = isSelf ? `
    <div class="artist-postit artist-postit-add-card" onclick="goAddSoshik()" title="새 소식 쓰기">
      <i class="ri-add-line"></i>
    </div>
  ` : '';
  const notesGridHtml = notesGridCards + addCard;

  appContent.innerHTML = `
    <div class="artist-canvas cosmic">
      <div class="artist-bg-deco"></div>

      <div class="sub-page artist-page">
        ${isSelf ? `
          <button class="artist-constellation-btn" onclick="openFollowerConstellation()" title="${_t('팔로워 별자리 보기', 'View follower constellation')}" aria-label="${_t('팔로워 별자리', 'Follower constellation')}">
            <i class="ri-sparkling-2-line"></i>
          </button>
          <button class="artist-settings-gear" onclick="editProfile()" title="${_t('설정 / 프로필 편집', 'Settings / Edit profile')}" aria-label="${_t('설정', 'Settings')}">
            <i class="ri-settings-3-line"></i>
          </button>
        ` : ''}
        <div class="artist-header-row reveal">
          <div class="artist-strip">
            <div class="artist-id">
              <button type="button" class="artist-avatar-wrap ${window._hasActiveStory && window._hasActiveStory(artistName) ? 'has-story' : ''} ${isSelf ? 'is-self-avatar' : ''}"
                      onclick="openStoryFor('${(artistName||'').replace(/'/g,"\\'")}', ${isSelf ? 'true' : 'false'})"
                      title="${isSelf ? _t('스토리 올리기/보기','Add / view story') : _t('스토리 보기','View story')}">
                <img src="${avatar}" class="artist-avatar" alt="${safeName}">
                ${isSelf && !(window._hasActiveStory && window._hasActiveStory(artistName)) ? `<span class="artist-avatar-plus"><i class="ri-add-line"></i></span>` : ''}
              </button>
              <div class="artist-id-text">
                ${(() => {
                  // 이름 옆에 인라인 팔로우 알약 — 다른 사람 + isArtistRole 일 때만.
                  // (사용자 요청: 큰 검은 버튼 줄 제거 → 이름 옆 작은 알약 + 메시지 칩 row 통합)
                  if (isArtistRole && !isSelf) {
                    const isFollowingNow = artistSupabaseId
                      ? iFollow
                      : (typeof window._isFollowingName === 'function' && window._isFollowingName(artistName));
                    const followArg = artistSupabaseId
                      ? `'${artistSupabaseId}', '${safeName.replace(/'/g,"\\'")}'`
                      : `null, '${safeName.replace(/'/g,"\\'")}'`;
                    return `
                    <div class="artist-name-row">
                      <h1>${safeName}</h1>
                      <button class="follow-btn-inline ${isFollowingNow ? 'is-following' : ''}" type="button" onclick="toggleFollowArtist(${followArg})">
                        ${isFollowingNow ? '<i class="ri-user-follow-fill"></i> ' + _t('팔로잉', 'Following') : '<i class="ri-user-add-line"></i> ' + _t('팔로우', 'Follow')}
                      </button>
                    </div>`;
                  }
                  return `<h1>${safeName}</h1>`;
                })()}
                <!-- 팔로워 / 팔로잉 + 메세지 칩 row. 본인이면 받은 메세지함, 다른 사람이면 DM.
                     실제 클릭 핸들러는 렌더 후 addEventListener 로 바인딩. -->
                <div class="artist-follow-chips" id="artist-follow-chips">
                  <button class="follow-chip" id="follow-chip-followers" type="button">
                    <i class="ri-group-line"></i> ${_i18n('팔로워', 'Followers')} <strong id="follow-chip-fans-n">${fanCount || 0}</strong>
                  </button>
                  <button class="follow-chip" id="follow-chip-followings" type="button">
                    <i class="ri-user-3-line"></i> ${_i18n('팔로잉', 'Following')} <strong id="follow-chip-followings-n">0</strong>
                  </button>
                  ${isSelf ? `
                    <button class="follow-chip follow-chip-msg" type="button" title="${_t('받은 메세지 보기', 'View inbox')}">
                      <i class="ri-mail-fill"></i> ${_i18n('메세지', 'Messages')}
                    </button>
                  ` : `
                    <button class="follow-chip follow-chip-msg follow-chip-msg-dm" type="button"
                            data-target-name="${safeName.replace(/"/g,'&quot;')}"
                            data-target-avatar="${(avatar||'').replace(/"/g,'&quot;')}"
                            title="${_t(`${safeName} 에게 메시지 보내기`, `Message ${safeName}`)}">
                      <i class="ri-mail-send-fill"></i> ${_i18n('메시지', 'Message')}
                    </button>
                  `}
                </div>
                <!-- 역할 라벨('아티스트') 숨김 — 사용자 요청. id/style은 유지해 다른 코드 안 깨지게. -->
                <div style="display:none;" aria-hidden="true">
                  <i class="ri-user-star-line"></i> ${roleLabel}
                </div>
                <!-- 통계 줄(곡/프로젝트/포스트잇/팔로워) 임시 숨김 (사용자 요청) — fan-count-inline id 유지해야 mountCheerHeart 가 안전하게 작동 -->
                <div class="artist-stats" style="display:none;" aria-hidden="true">
                  ${artistSupabaseId ? `<span class="fan-count-inline">❤ <strong id="fan-count-inline">${fanCount}</strong> 팔로워</span>` : ''}
                </div>
                <!-- 자기소개 인라인 (칩 아래) — 작성됐으면 표시, 본인 + 비어있으면 안내.
                     텍스트를 .artist-bio-text 로 감싸서 박스(자체 너비)와 텍스트(왼쪽 정렬)를 명확히 분리. -->
                ${isSelf ? `
                  <div id="artist-bio-line" class="artist-bio-inline" onclick="editProfile()" title="프로필 설정에서 수정">
                    ${initialBio
                      ? `<span class="artist-bio-text">${initialBio.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</span>`
                      : `<span class="artist-bio-inline-empty"><i class="ri-edit-line"></i> ${_i18n('자신을 소개해보아요', 'Introduce yourself')}</span>`
                    }
                  </div>
                ` : (initialBio ? `
                  <div id="artist-bio-line" class="artist-bio-inline">
                    <span class="artist-bio-text">${initialBio.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</span>
                  </div>
                ` : `<div id="artist-bio-line" class="artist-bio-inline" hidden></div>`)}
              </div>
            </div>
          </div>
          ${'' /* counts box (앨범/프로젝트/싱글) hidden for now — will surface later when there are many songs */}
          ${'' /* 소식 핀-스택 제거 — 노트(소식)는 아래 '주절주절' 피드로 통합됨 (단일스크롤 레이아웃) */}
        </div>

        ${'' /* 기존 별도 postit-section은 프로필 옆으로 이동됨 */ ? `<div class="reveal artist-postit-section">
            <h2 class="section-title"><i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> ${safeName}${isArtistRole ? '의 포스트잇' : '이(가) 남긴 포스트잇'} <span class="section-count">${artistNotes.length}</span></h2>
            <div class="artist-postit-grid">
              ${notesGridHtml}
            </div>
          </div>
        ` : ''}

        ${isArtistRole ? `
          <!-- Artist content tabs: 음악 / 통계(본인만). 메세지함 탭은 자기소개프로필 옆 버튼으로 이동. -->
          <div class="artist-content-tabs reveal" style="margin-top: 28px;">
            <button type="button" class="content-tab active" data-content-tab="music" onclick="switchArtistContentTab('music')">
              <i class="ri-music-2-fill"></i> ${_i18n('음악', 'Music')}
            </button>
            ${isSelf ? `
              <button type="button" class="content-tab" data-content-tab="stats" onclick="switchArtistContentTab('stats')">
                <i class="ri-bar-chart-2-fill"></i> ${_i18n('통계', 'Stats')}
              </button>
            ` : ''}
          </div>

          <div class="artist-content-pane" data-content-tab="music">
            <div class="atl-page">
            <!-- 최신 데모 (위, 크게) — 탭하면 앨범 페이지 -->
            ${latestTrack ? `
              <div class="atl-section-head" style="margin-top:18px;">
                <div class="atl-section-title"><i class="ri-fire-fill" style="color:#ff6b6b;"></i> ${_i18n('최신 데모', 'Latest demo')}</div>
              </div>
              <div class="atl-hero reveal" onclick="navigateTo('song:'+encodeURIComponent('${String(latestTrack.id).replace(/'/g, "\\'")}'))">
                <img class="atl-hero-cover" src="${latestTrack.cover || ''}" alt="">
                <div class="atl-hero-info">
                  <span class="atl-hero-badge">${_esc(latestTrack.versionLabel || (latestTrack.isDemo ? 'DEMO' : 'MASTER'))}</span>
                  <div class="atl-hero-title">${_esc((latestTrack.title || '').replace(/\s*\(Demo.*\)$/i, ''))}</div>
                  <div class="atl-hero-sub">${safeName}</div>
                  <div class="atl-hero-actions">
                    <button class="atl-hero-play" type="button" onclick="event.stopPropagation(); playTrack('${latestTrack.id}','wall')" aria-label="${_t('재생', 'Play')}"><i class="ri-play-fill"></i></button>
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- 음악(앨범) — 데모 단위 카드, 탭하면 앨범 페이지 -->
            ${albumCards.length ? `
              <div class="atl-section-head">
                <div class="atl-section-title"><i class="ri-album-fill" style="color:var(--brand-color);"></i> ${_i18n('음악', 'Music')}</div>
                ${albumCards.length > 6 ? `<button class="atl-more-btn" type="button" onclick="var g=this.closest('.artist-content-pane').querySelector('.atl-albums'); if(g) g.classList.add('show-all'); this.remove();">${_i18n('음원 더보기', 'More')} <i class="ri-arrow-right-s-line"></i></button>` : ''}
              </div>
              <div class="atl-albums reveal">
                ${albumCards.map(a => `
                  <div class="atl-album" onclick="navigateTo('song:'+encodeURIComponent('${String(a.id).replace(/'/g, "\\'")}'))">
                    <img class="atl-album-cover" src="${a.cover}" alt="" loading="lazy">
                    <div class="atl-album-title">${_esc(a.title)}</div>
                    <div class="atl-album-meta">${_esc(a.meta)}</div>
                  </div>`).join('')}
              </div>
            ` : (isSelf ? `
              <div class="atl-section-head" style="margin-top:18px;">
                <div class="atl-section-title"><i class="ri-album-fill" style="color:var(--brand-color);"></i> ${_i18n('음악', 'Music')}</div>
              </div>
              <div class="atl-albums">
                <div class="atl-album atl-album-add" onclick="navigateTo('upload')" title="${_t('첫 곡 업로드하기', 'Upload your first track')}">
                  <div class="atl-album-cover atl-album-add-cover"><i class="ri-add-line"></i></div>
                  <div class="atl-album-title">${_i18n('첫 곡 올리기', 'Upload')}</div>
                  <div class="atl-album-meta">${_i18n('데모부터 시작', 'Start with a demo')}</div>
                </div>
              </div>
            ` : '')}
            <div id="artist-section-albums" style="scroll-margin-top:80px;"></div>

            <!-- 주절주절 피드 — 이 아티스트의 소식 -->
            <div class="atl-divider"></div>
            <div class="atl-feed-head"><i class="ri-chat-smile-2-line" style="color:var(--brand-color);"></i> ${_i18n('주절주절', 'blah blah')}</div>
            ${isSelf ? `
              <div class="thread-composer" onclick="openThreadComposer()">
                <img class="thread-avatar" src="${avatar}" alt="">
                <div class="thread-composer-hint">${_t('무슨 생각 중이에요? · 노래·사진 올리기', "What's on your mind?")}</div>
                <button class="thread-composer-go" type="button" aria-label="${_t('새 글', 'New')}"><i class="ri-add-line"></i></button>
              </div>
            ` : ''}
            ${artistFeedPosts.length
              ? artistFeedPosts.map(_threadPostHtml).join('')
              : `<div class="atl-feed-empty">${isSelf ? _t('첫 주절주절을 남겨보세요!', 'Post your first one!') : _t('아직 주절주절이 없어요.', 'Nothing here yet.')}</div>`}
            </div><!-- /.atl-page -->
          </div>

          <!-- '받은 응원' 섹션 제거 (사용자 요청). mountCheerHeart 가 안전하게
               끝나도록 빈 placeholder 만 둠 — 본인/타인 모두 hidden. -->
          <div id="cheer-heart-mount" hidden></div>

          ${isSelf ? `
            <div class="artist-content-pane" data-content-tab="stats" hidden>
              <div id="artist-stats-mount" style="margin-top: 20px;">
                <p style="color: var(--text-secondary); font-size: 13px; padding: 14px;">탭을 누르면 통계가 로드돼요.</p>
              </div>
            </div>
          ` : ''}
        ` : `
          <!-- 🌱 listener mode -->
          <div class="reveal" style="margin-top:36px;">
            <h2 class="section-title"><i class="ri-headphone-fill" style="color:#9C27B0;"></i> ${safeName}의 음악 라이프</h2>
            <p style="color:var(--text-secondary); font-size:13px; padding:12px 0;">청취자라 직접 곡을 올리진 않지만, 좋아하는 아티스트와 함께 만들어가요 🌱</p>
          </div>
        `}
      </div>
    </div>
  `;

  // Force-show reveal elements after 100ms in case IntersectionObserver misses them
  setTimeout(() => {
    document.querySelectorAll('#app-content .reveal:not(.in-view)').forEach(el => el.classList.add('in-view'));
  }, 100);
  // Re-run observer too
  try { if (typeof observeReveals === 'function') observeReveals(); } catch (_) {}

  // Mobile demo swipe: wire up scroll-snap carousels + dot indicators.
  // Safe at any viewport — observers do nothing if dots aren't visible (CSS).
  try { _initDemoSwipe(); } catch (e) { console.warn('[demoSwipe]', e); }

  // 📌 소식 핀-스택 — 스와이프 넘기기 + 탭 상세 바인딩
  try { window._initSoshikStack(document.getElementById('soshik-stack')); } catch (e) { console.warn('[soshikStack]', e); }
  // 소식 핀을 DEMO 2 칸 위로 정렬 (데스크탑). 레이아웃 끝난 뒤 한 번 더.
  try {
    window._alignSoshikAboveDemo2();
    setTimeout(() => { try { window._alignSoshikAboveDemo2(); } catch (_) {} }, 80);
    if (!window.__soshikAlignWired) {
      window.__soshikAlignWired = true;
      window.addEventListener('resize', () => {
        clearTimeout(window.__soshikAlignTimer);
        window.__soshikAlignTimer = setTimeout(() => { try { window._alignSoshikAboveDemo2(); } catch (_) {} }, 120);
      });
    }
  } catch (_) {}

  // Async: fill the 응원 하트 wall (cheers received by this artist)
  if (isArtistRole && typeof window.mountCheerHeart === 'function') {
    window.mountCheerHeart(artistName);
  }

  // Async: 다른 사람 프로필이면 bio 를 백그라운드로 가져와서 자리 채움
  if (!isSelf && !initialBio && typeof window.fetchProfileByName === 'function') {
    window.fetchProfileByName(artistName).then(p => {
      if (p && p.bio) {
        const el = document.getElementById('artist-bio-line');
        if (el) {
          el.innerHTML = p.bio.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
          el.hidden = false;
        }
      }
    }).catch(_ => {});
  }

  // 안전 바인딩 — 모든 핵심 버튼을 렌더 직후 addEventListener 로 직접 묶음.
  // (인라인 onclick 이 이스케이프/CSP 등으로 안 먹는 케이스 회피)
  try {
    // 본인 페이지에선 __currentUser.id 가 가장 정확 (트랙 없는 사용자도 OK)
    const _selfId = (isSelf && window.__currentUser && window.__currentUser.id) || '';
    const _initialId = artistSupabaseId || _selfId || '';
    // 팔로워/팔로잉 칩 — 즉시(synchronous) 1차 바인딩. 아래 async 가 finalize.
    const _chipFs = document.getElementById('follow-chip-followers');
    const _chipFi = document.getElementById('follow-chip-followings');
    if (_chipFs) _chipFs.onclick = (e) => { e.preventDefault(); openFollowListModal('followers', artistName, _initialId); };
    if (_chipFi) _chipFi.onclick = (e) => { e.preventDefault(); openFollowListModal('followings', artistName, _initialId); };

    // 메시지 칩 — 본인이면 받은 메세지함, 다른 사람이면 DM 보내기.
    // (다른 사람용은 .follow-chip-msg-dm 클래스 추가로 구분)
    const _msgChip = document.querySelector('#artist-follow-chips .follow-chip-msg');
    if (_msgChip) {
      _msgChip.onclick = (e) => {
        e.preventDefault();
        if (_msgChip.classList.contains('follow-chip-msg-dm')) {
          // 다른 사람에게 DM
          const targetName = _msgChip.getAttribute('data-target-name') || artistName;
          const targetAvatar = _msgChip.getAttribute('data-target-avatar') || '';
          if (typeof window.openDmModal === 'function') {
            window.openDmModal(targetName, targetAvatar);
          } else {
            console.warn('[msg-chip-dm] openDmModal 함수 없음');
          }
        } else {
          // 본인 받은 메세지함
          if (typeof window.openDmInboxModal === 'function') {
            window.openDmInboxModal();
          } else {
            console.warn('[msg-chip] openDmInboxModal 함수 없음');
          }
        }
      };
    }
    // 팔로우 / DM 보내기 버튼 (다른 사람 페이지) 도 안전 바인딩
    // 새 인라인 팔로우 알약 (.follow-btn-inline) — 이름 옆에 위치.
    const _followBtn = document.querySelector('.artist-name-row .follow-btn-inline');
    if (_followBtn && !isSelf) {
      _followBtn.onclick = (e) => {
        e.preventDefault();
        if (typeof window.toggleFollowArtist === 'function') {
          window.toggleFollowArtist(artistSupabaseId || null, artistName);
        } else {
          console.warn('[follow-btn] toggleFollowArtist 함수 없음');
        }
      };
    }
    const _dmBtn = document.querySelector('.artist-action-row .dm-btn-v2');
    if (_dmBtn && !isSelf) {
      _dmBtn.onclick = (e) => {
        e.preventDefault();
        if (typeof window.openDmModal === 'function') {
          window.openDmModal(artistName, avatar);
        } else {
          console.warn('[dm-btn] openDmModal 함수 없음');
        }
      };
    }
  } catch (e) { console.warn('[artist-page] safe-bind', e); }

  // Async: 팔로우 카운트 칩 — 팔로워(fanCount) + 팔로잉(followingCount) 채우기
  (async () => {
    try {
      let aid = artistSupabaseId;
      // 본인 페이지면 __currentUser.id 즉시 사용 — 트랙 없는 사용자도 정확한 ID 보장.
      // (트랙 lookup 만으론 aid 가 null 일 수 있고, getArtistIdByName 은 동명이인
      //  / 이름 정확히 안 맞는 케이스에서 실패할 수 있음)
      if (!aid && isSelf && window.__currentUser && window.__currentUser.id) {
        aid = window.__currentUser.id;
      }
      if (!aid && window.Follows && window.Follows.getArtistIdByName) {
        aid = await window.Follows.getArtistIdByName(artistName);
      }
      if (!aid) return;
      // 칩에 artistId 채워 넣기 (모달 열 때 다시 못 찾는 경우 대비) — addEventListener 로 바인딩
      const chipFollowers = document.getElementById('follow-chip-followers');
      const chipFollowings = document.getElementById('follow-chip-followings');
      if (chipFollowers) {
        chipFollowers.onclick = (e) => { e.preventDefault(); openFollowListModal('followers', artistName, aid); };
      }
      if (chipFollowings) {
        chipFollowings.onclick = (e) => { e.preventDefault(); openFollowListModal('followings', artistName, aid); };
      }

      if (window.Follows && window.Follows.fanCount) {
        const fc = await window.Follows.fanCount(aid);
        const n = document.getElementById('follow-chip-fans-n');
        if (n) n.textContent = fc;
      }
      if (window.Follows && window.Follows.followingCount) {
        const fc = await window.Follows.followingCount(aid);
        const n = document.getElementById('follow-chip-followings-n');
        if (n) n.textContent = fc;
      }
    } catch (e) { console.warn('[follow chips]', e); }
  })();

  // Async upgrade: if we don't yet know the Supabase artist id, look it up
  // and update fan count + follow button in the DOM (non-blocking).
  // Skip for listener role — listeners aren't followable artists.
  if (window.Follows && !isSelf && isArtistRole) {
    (async () => {
      try {
        let aid = artistSupabaseId;
        if (!aid) aid = await window.Follows.getArtistIdByName(artistName);
        if (!aid) return;
        const [count] = await Promise.all([window.Follows.fanCount(aid)]);
        const following = window.Follows.isFollowing(aid);
        // Patch DOM
        const statsEl = document.querySelector('.artist-id-text .artist-stats');
        const existingChip = statsEl && statsEl.querySelector('.fan-count-inline');
        if (statsEl && !existingChip) {
          statsEl.insertAdjacentHTML('beforeend', `<span class="stat-dot">·</span><span class="fan-count-inline">❤ <strong id="fan-count-inline">${count}</strong> 팔로워</span>`);
        } else if (existingChip) {
          const strong = existingChip.querySelector('strong');
          if (strong) strong.textContent = String(count);
        }
        // 팔로우 버튼 — 이미 이름 옆 인라인 알약(.follow-btn-inline) 으로 렌더됨.
        // 비어있을 때만 (artistSupabaseId 가 초기 렌더 시점에 없었던 경우) fallback 으로
        // 추가하되, 옛날 큰 검은 .follow-btn-v2 가 아니라 새 .follow-btn-inline 을 이름 옆에.
        const idText = document.querySelector('.artist-id-text');
        const alreadyHas = idText && (
          idText.querySelector('.follow-btn-inline') ||
          idText.querySelector('.follow-btn-v2')
        );
        if (idText && !alreadyHas) {
          const h1El = idText.querySelector('h1');
          if (h1El) {
            // h1 을 .artist-name-row 로 감싸고 알약 추가
            const row = document.createElement('div');
            row.className = 'artist-name-row';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'follow-btn-inline' + (following ? ' is-following' : '');
            btn.innerHTML = following ? '<i class="ri-user-follow-fill"></i> ' + _t('팔로잉', 'Following') : '<i class="ri-user-add-line"></i> ' + _t('팔로우', 'Follow');
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              if (typeof window.toggleFollowArtist === 'function') {
                window.toggleFollowArtist(aid, artistName);
              }
            });
            h1El.parentNode.insertBefore(row, h1El);
            row.appendChild(h1El);
            row.appendChild(btn);
          }
        }
        // 그리고 메시지 칩(다른 사람용) 이 빠져있으면 추가 (artistSupabaseId 늦게 채워진 케이스)
        const chipsRow = document.getElementById('artist-follow-chips');
        if (chipsRow && !chipsRow.querySelector('.follow-chip-msg')) {
          const msgBtn = document.createElement('button');
          msgBtn.type = 'button';
          msgBtn.className = 'follow-chip follow-chip-msg follow-chip-msg-dm';
          msgBtn.title = _t(artistName + ' 에게 메시지 보내기', 'Message ' + artistName);
          msgBtn.innerHTML = '<i class="ri-mail-send-fill"></i> ' + _t('메시지', 'Message');
          msgBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.openDmModal === 'function') {
              const av = document.querySelector('.artist-id .artist-avatar');
              window.openDmModal(artistName, (av && av.src) || '');
            }
          });
          chipsRow.appendChild(msgBtn);
        }
      } catch (e) { console.warn('[artist] upgrade fan info', e); }
    })();
  }
}

// Simple toast helper
function _renderError(err, what) {
  console.error('[render error]', what, err);
  try {
    appContent.innerHTML = `
      <div style="padding: 40px 24px; color: var(--text-primary);">
        <h2 style="font-size:18px; margin-bottom:12px;">페이지 렌더링 중 오류</h2>
        <p style="color:var(--text-secondary); font-size:13px; margin-bottom:16px;">${(what||'').replace(/</g,'&lt;')} — ${(err && err.message || err || '').toString().replace(/</g,'&lt;')}</p>
        <button class="btn-primary" onclick="navigateTo('home')">홈으로</button>
      </div>
    `;
  } catch (_) {}
}

function showToast(msg) {
  // EN 모드일 때 알려진 한국어 메시지 자동 번역 (사전 기반, _msgEn)
  if (typeof window._msgEn === 'function') msg = window._msgEn(msg);
  let t = document.getElementById('os-toast');
  if (t) t.remove();
  t = document.createElement('div');
  t.id = 'os-toast';
  t.className = 'os-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ===================== 6. EVENTS =====================

function renderEvents() {
  const db = window.DB.get();

  let html = `
    <h1>Community Events</h1>
    <p style="color:var(--text-secondary); margin-bottom: 30px;">
      현재 플랫폼에 총 <strong style="color:white">${db.tracks.length}</strong>곡의 음원이 업로드 되었습니다!<br>
      일정 곡 수가 모이면 오프라인 콘서트를 기획합니다.
    </p>
    ${(db.currentUser && db.currentUser.role === 'admin') ? `<button class="btn-primary" style="margin-bottom: 30px;" onclick="alert('관리자 이벤트 등록 에디터가 열립니다.')"><i class="ri-calendar-todo-fill"></i> 새 이벤트 등록하기</button>` : ''}
    <div style="max-width: 700px;">
  `;

  db.events.forEach(ev => {
    html += `
      <div class="event-card">
        <img src="${ev.banner}" class="event-cover">
        <div class="event-body">
          <div class="event-date"><i class="ri-calendar-event-fill"></i> ${ev.date}</div>
          <h2 style="margin-bottom: 8px;">${ev.title}</h2>
          <p style="color: var(--text-secondary); line-height: 1.6;">${ev.description}</p>
          <button class="btn-primary" style="margin-top: 20px;">자세히 보기</button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  appContent.innerHTML = html;
}

// ===================== 7. LIBRARY =====================

window.currentLibraryTab = 'overview';
window.renderLibrary = function (tab = window.currentLibraryTab) {
  window.currentLibraryTab = tab;
  const db = window.DB.get();
  if (!db.currentUser) {
    navigateTo('auth');
    return;
  }

  const likedIds = db.currentUser.likedTracks || [];
  const historyIds = db.currentUser.history || [];

  const likedTracks = likedIds.map(id => db.tracks.find(t => t.id === id)).filter(Boolean);
  const historyTracks = historyIds.map(id => db.tracks.find(t => t.id === id)).filter(Boolean);

  const getTabStyle = (t) => tab === t
    ? 'color: var(--text-primary); font-weight: bold; border-bottom: 2px solid var(--brand-color); padding-bottom: 12px; margin-right: 24px; text-decoration: none;'
    : 'color: var(--text-secondary); font-weight: 500; border-bottom: 2px solid transparent; padding-bottom: 12px; margin-right: 24px; text-decoration: none; transition: color 0.2s ease;';

  let html = `
    <div style="max-width: 900px;">
      <h1 style="margin-bottom: 30px; font-size: 32px;"><i class="ri-stack-fill text-brand"></i> Library</h1>

      <div style="display: flex; border-bottom: 1px solid var(--divider); margin-bottom: 40px; font-size: 15px; overflow-x: auto; white-space: nowrap;">
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('overview')" style="${getTabStyle('overview')}">Overview</a>
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('likes')" style="${getTabStyle('likes')}">Likes</a>
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('playlists')" style="${getTabStyle('playlists')}">Playlists</a>
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('albums')" style="${getTabStyle('albums')}">Albums</a>
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('stations')" style="${getTabStyle('stations')}">Stations</a>
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('following')" style="${getTabStyle('following')}">Following</a>
        <a href="#" onclick="event.preventDefault(); window.renderLibrary('history')" style="${getTabStyle('history')}">History</a>
      </div>
  `;

  if (tab === 'overview') {
    html += `
      <div style="margin-bottom: 50px;">
        <h2 style="font-size: 20px; margin-bottom: 20px;">Likes</h2>
        <div class="track-grid">
          ${likedTracks.length > 0 ? likedTracks.map(window.generateTrackCard).join('') : '<p style="color:var(--text-secondary);">아직 좋아요를 누른 곡이 없습니다.</p>'}
        </div>
      </div>
      <div style="margin-bottom: 50px;">
        <h2 style="font-size: 20px; margin-bottom: 20px;">History</h2>
        <div class="track-grid">
          ${historyTracks.length > 0 ? historyTracks.map(window.generateTrackCard).join('') : '<p style="color:var(--text-secondary);">최근 재생한 곡이 없습니다.</p>'}
        </div>
      </div>
    `;
  } else if (tab === 'likes') {
    html += `
      <div style="margin-bottom: 50px;">
        <div class="track-grid">
          ${likedTracks.length > 0 ? likedTracks.map(window.generateTrackCard).join('') : '<p style="color:var(--text-secondary);">아직 좋아요를 누른 곡이 없습니다.</p>'}
        </div>
      </div>
    `;
  } else if (tab === 'history') {
    html += `
      <div style="margin-bottom: 50px;">
        <div class="track-grid">
          ${historyTracks.length > 0 ? historyTracks.map(window.generateTrackCard).join('') : '<p style="color:var(--text-secondary);">최근 재생한 곡이 없습니다.</p>'}
        </div>
      </div>
    `;
  } else if (tab === 'playlists') {
    html += `
      <div style="margin-bottom: 50px;">
        <div class="track-grid">
          ${(db.playlists || []).length > 0 ? (db.playlists || []).map(p => window.generateCollectionCard(p, `${(p.trackIds||[]).length} tracks`)).join('') : '<p style="color:var(--text-secondary);">생성된 플레이리스트가 없습니다.</p>'}
        </div>
      </div>
    `;
  } else if (tab === 'albums') {
    html += `
      <div style="margin-bottom: 50px;">
        <div class="track-grid">
          ${(db.albums || []).length > 0 ? (db.albums || []).map(a => window.generateCollectionCard(a, a.artist, `<div style="font-size: 12px; color:var(--text-secondary); margin-top:4px;">${a.year}</div>`)).join('') : '<p style="color:var(--text-secondary);">저장된 앨범이 없습니다.</p>'}
        </div>
      </div>
    `;
  } else if (tab === 'stations') {
    html += `
      <div style="margin-bottom: 50px;">
        <div class="track-grid">
          ${(db.stations || []).length > 0 ? (db.stations || []).map(s => window.generateCollectionCard(s, s.type)).join('') : '<p style="color:var(--text-secondary);">사용 가능한 스테이션이 없습니다.</p>'}
        </div>
      </div>
    `;
  } else if (tab === 'following') {
    html += `
      <div style="margin-bottom: 50px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 24px;">
          ${(db.following || []).length > 0 ? (db.following || []).map(window.generateArtistCard).join('') : '<p style="color:var(--text-secondary);">팔로우 중인 아티스트가 없습니다.</p>'}
        </div>
      </div>
    `;
  } else {
    html += `
      <div style="padding: 100px 0; text-align: center; color: var(--text-secondary);">
        <i class="ri-tools-fill" style="font-size: 48px; margin-bottom: 16px; display: block; color: var(--brand-color);"></i>
        <h2 style="font-size: 20px; margin-bottom: 8px;">준비 중인 기능입니다.</h2>
        <p>현재는 프로토타입 단계입니다.</p>
      </div>
    `;
  }

  html += `</div>`;
  appContent.innerHTML = html;
}

// ===================== LIKE / UNLIKE =====================

window.toggleLike = async function (trackId, btnEl) {
  const db = window.DB.get();
  if (!db.currentUser) {
    alert("로그인 후 이용 가능합니다!");
    navigateTo('auth');
    return;
  }

  if (!db.currentUser.likedTracks) db.currentUser.likedTracks = [];
  const idx = db.currentUser.likedTracks.indexOf(trackId);

  const track = db.tracks.find(t => t.id === trackId);

  // Optimistic local update
  if (idx > -1) {
    db.currentUser.likedTracks.splice(idx, 1);
    if (track) track.likes = Math.max(0, (track.likes || 0) - 1);
  } else {
    db.currentUser.likedTracks.push(trackId);
    if (track) track.likes = (track.likes || 0) + 1;
  }

  const nowLiked = db.currentUser.likedTracks.indexOf(trackId) > -1;
  if (btnEl) { const _ic = btnEl.querySelector('i'); if (_ic) _ic.className = nowLiked ? 'ri-heart-fill' : 'ri-heart-line'; }

  // 담기(CollectedTracks) 저장소도 동기화 — isTrackLiked 1순위라 안 맞추면 우주/담기에서 '해제 안 되는' 하트 발생
  if (window.CollectedTracks) {
    if (nowLiked) window.CollectedTracks.add(trackId);
    else window.CollectedTracks.remove(trackId);
  }

  window.DB.save(db);
  // 플레이어 바 담기 버튼도 같은 곡이면 즉시 반영
  if (typeof _updatePlayerCollectState === 'function' && trackId === window.currentPlayingTrack) _updatePlayerCollectState();

  // Persist to Supabase Favorites if available (server-side source of truth)
  if (window.Favorites && window.Favorites.toggle) {
    try {
      const res = await window.Favorites.toggle(trackId);
      // Sync local likedTracks with server state in case of mismatch
      if (res.favorited && db.currentUser.likedTracks.indexOf(trackId) === -1) {
        db.currentUser.likedTracks.push(trackId);
        if (window.CollectedTracks) window.CollectedTracks.add(trackId);
        window.DB.save(db);
      } else if (!res.favorited && db.currentUser.likedTracks.indexOf(trackId) !== -1) {
        db.currentUser.likedTracks = db.currentUser.likedTracks.filter(id => id !== trackId);
        if (window.CollectedTracks) window.CollectedTracks.remove(trackId);
        window.DB.save(db);
      }
      if (typeof showToast === 'function') {
        showToast(res.favorited ? _t('⭐ 즐겨찾기에 추가', '⭐ Added to favorites') : _t('☆ 즐겨찾기에서 제거', '☆ Removed from favorites'));
      }
    } catch (e) {
      console.warn('[toggleLike] Favorites sync', e);
    }
  }

  if (currentView === 'home') renderHome();
  else if (currentView === 'library') window.renderLibrary();
  else if (currentView === 'profile') renderProfile();
  else if (currentView === 'artist' && typeof renderArtistProfile === 'function' && window.__currentArtistName) renderArtistProfile(window.__currentArtistName);
}

// ===================== PLAYLIST MODAL =====================

window.openPlaylistModal = function(trackId) {
  const db = window.DB.get();
  if (!db.currentUser) {
    alert("로그인 후 이용 가능합니다!");
    navigateTo('auth');
    return;
  }
  window._pendingPlaylistTrackId = trackId;
  const modal = document.getElementById('playlist-modal');
  const list = document.getElementById('playlist-modal-list');

  list.innerHTML = (db.playlists || []).map(p => {
    const alreadyIn = (p.trackIds || []).includes(trackId);
    return `
      <div class="playlist-item" onclick="addToPlaylist('${p.id}')">
        <img src="${p.cover}" style="width:44px;height:44px;border-radius:4px;object-fit:cover;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${(p.trackIds||[]).length} tracks</div>
        </div>
        ${alreadyIn ? '<i class="ri-check-line" style="color:var(--brand-color);font-size:20px;"></i>' : '<i class="ri-add-line" style="color:var(--text-secondary);font-size:18px;"></i>'}
      </div>
    `;
  }).join('');

  modal.style.display = 'flex';
  // 아래로 스와이프 → 닫기 (모바일). 영구 요소라 한 번만 배선(중복배선 가드).
  try {
    const _pc = modal.querySelector('.playlist-modal-content');
    if (_pc && window._attachSwipeDismiss) window._attachSwipeDismiss(_pc, {
      direction: 'down', backdrop: modal, grabber: 'dark', scrollGuard: '#playlist-modal-list',
      onClose: () => closePlaylistModal()
    });
  } catch (_) {}
}

window.closePlaylistModal = function() {
  document.getElementById('playlist-modal').style.display = 'none';
  window._pendingPlaylistTrackId = null;
}

window.addToPlaylist = async function(playlistId) {
  const trackId = window._pendingPlaylistTrackId;
  if (!trackId) return;
  // 이미 담긴 곡이면 "추가됨" 거짓 토스트 대신 안내만
  try {
    const _pl = (window.DB.get().playlists || []).find(p => p.id === playlistId);
    if (_pl && Array.isArray(_pl.trackIds) && _pl.trackIds.includes(trackId)) {
      closePlaylistModal();
      showToast(_t('이미 담긴 곡이에요', 'Already in this playlist'));
      return;
    }
  } catch (_) {}
  try {
    if (window.Playlists) {
      await window.Playlists.addTrack(playlistId, trackId);
      await window.Playlists.refreshInto(window.DB.get());
    } else {
      window.DB.addTrackToPlaylist(playlistId, trackId);
    }
    closePlaylistModal();
    renderSidebarPlaylists();
    showToast(_t('플레이리스트에 추가됐어요!', 'Added to playlist!'));
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || _t('추가 실패', 'Add failed')); else alert('추가 실패: ' + (e.message || e));
  }
};

// ===================== MOCK FOLLOWS (localStorage 기반) =====================
// 데모용: 청취자가 mock 아티스트를 함께하기 할 때 localStorage 저장
function _getMockFollows() {
  try { return JSON.parse(localStorage.getItem('offstage_mock_follows') || '[]') || []; }
  catch (_) { return []; }
}
function _saveMockFollows(list) {
  try { localStorage.setItem('offstage_mock_follows', JSON.stringify(list)); } catch (_) {}
}
window._getMockFollows = _getMockFollows;
window.addMockFollow = function(artist) {
  if (!artist || !artist.name) return;
  const list = _getMockFollows();
  if (list.some(a => a.name === artist.name)) return;
  list.unshift({
    id: artist.id || ('mock_' + Date.now()),
    name: artist.name,
    avatar: artist.avatar,
    role: artist.role || 'artist',
    streamCount: artist.streamCount || 0,
    spoBackers: artist.spoBackers || 0,
    followedAt: new Date().toISOString(),
    __mock: true
  });
  _saveMockFollows(list);
};
window.removeMockFollow = function(name) {
  const list = _getMockFollows().filter(a => a.name !== name);
  _saveMockFollows(list);
};

// ===================== ONBOARDING — 첫 로그인 시 3명 함께하기 =====================
function _hasSeenOnboarding() {
  try { return localStorage.getItem('offstage_onboarded') === '1'; } catch (_) { return false; }
}
function _markOnboarded() {
  try { localStorage.setItem('offstage_onboarded', '1'); } catch (_) {}
}
window._onboardingPicked = new Set();

window.maybeShowOnboarding = async function() {
  // ⛔ 온보딩 일시 OFF (사용자 요청). 나중에 '곡 미리듣기 + 팔로우' 형태로
  //    다시 만들 때 이 한 줄만 지우면 됨. (아래 로직/모달 코드는 그대로 보존)
  return;
  // Guard: only show once per device, and only if user is logged in & has 0 follows (real + mock)
  if (_hasSeenOnboarding()) return;
  const db = window.DB.get();
  if (!db || !db.currentUser) return;
  // Has Supabase follows?
  let realFollows = 0;
  try {
    if (window.Follows && window.Follows.fetchMyArtists) {
      const arts = await window.Follows.fetchMyArtists();
      realFollows = (arts || []).length;
    }
  } catch (_) {}
  if (realFollows > 0) { _markOnboarded(); return; }
  if (_getMockFollows().length > 0) { _markOnboarded(); return; }
  showOnboardingModal();
};

function showOnboardingModal() {
  const db = window.DB.get();
  const list = (db && Array.isArray(db.onboardingArtists)) ? db.onboardingArtists : [];
  if (!list.length) return;
  const content = document.getElementById('onboarding-content');
  if (!content) return;
  window._onboardingPicked = new Set();

  const cardsHtml = list.map(a => {
    const safeName = (a.name || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const tag = (a.tagline || '').replace(/</g,'&lt;');
    return `
      <div class="onboarding-card" data-name="${safeName}" onclick="window.toggleOnboardingPick('${safeName}')">
        <img src="${a.avatar}" class="onboarding-avatar" alt="${safeName}" loading="lazy">
        <div class="onboarding-name">${safeName}</div>
        <div class="onboarding-tag">${tag}</div>
        <div class="onboarding-check"><i class="ri-check-line"></i></div>
      </div>
    `;
  }).join('');

  content.innerHTML = `
    <button class="onboarding-skip" onclick="finishOnboarding(true)">스킵</button>
    <div class="onboarding-eyebrow">처음 오신 걸 환영해요 ✨</div>
    <h1 class="onboarding-title">함께 만들고 싶은<br>아티스트를 골라봐</h1>
    <p class="onboarding-sub">마음에 드는 아티스트 <strong>3명 이상</strong> 골라줘.<br>카드로 모이고, 시간이 지날수록 자라나요 🌱</p>
    <div class="onboarding-grid">${cardsHtml}</div>
    <button class="onboarding-start" id="onboarding-start-btn" disabled onclick="finishOnboarding(false)">
      <span id="onboarding-start-label">3명 이상 골라줘</span>
    </button>
    <div class="onboarding-footer">언제든지 다른 아티스트도 추가할 수 있어요</div>
  `;

  const modal = document.getElementById('onboarding-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

window.toggleOnboardingPick = function(name) {
  if (!name) return;
  if (window._onboardingPicked.has(name)) {
    window._onboardingPicked.delete(name);
  } else {
    window._onboardingPicked.add(name);
  }
  // Update visual state
  const card = document.querySelector(`.onboarding-card[data-name="${name.replace(/"/g, '\\"')}"]`);
  if (card) card.classList.toggle('is-picked', window._onboardingPicked.has(name));
  // Update CTA
  const btn = document.getElementById('onboarding-start-btn');
  const label = document.getElementById('onboarding-start-label');
  const count = window._onboardingPicked.size;
  if (btn && label) {
    if (count >= 3) {
      btn.disabled = false;
      label.textContent = `${count}명과 함께 시작하기 →`;
    } else {
      btn.disabled = true;
      label.textContent = `${count}/3 골라줘`;
    }
  }
};

window.finishOnboarding = function(skip) {
  const db = window.DB.get();
  if (!skip) {
    const list = (db && Array.isArray(db.onboardingArtists)) ? db.onboardingArtists : [];
    Array.from(window._onboardingPicked).forEach(name => {
      const a = list.find(x => x.name === name);
      if (a) window.addMockFollow(a);
    });
    if (window._onboardingPicked.size > 0) {
      showToast(_t(`✨ ${window._onboardingPicked.size}명과 함께 시작! 카드는 내 페이지에서 확인`, `✨ Started with ${window._onboardingPicked.size} artists! Find their cards on your page`));
    }
  }
  _markOnboarded();
  const modal = document.getElementById('onboarding-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  // Navigate to profile so user sees the cards
  if (!skip && window._onboardingPicked.size > 0) {
    setTimeout(() => navigateTo('profile'), 200);
  }
};

// ===================== DM — 아티스트와 메시지 (mock chat) =====================
// localStorage 기반 mock 메시지 — 추후 실제 messaging 백엔드 연결 시 대체
function _getDmThread(artistName) {
  try {
    const all = JSON.parse(localStorage.getItem('offstage_dm_threads') || '{}') || {};
    return Array.isArray(all[artistName]) ? all[artistName] : [];
  } catch (_) { return []; }
}
function _saveDmThread(artistName, msgs) {
  try {
    const all = JSON.parse(localStorage.getItem('offstage_dm_threads') || '{}') || {};
    all[artistName] = msgs;
    localStorage.setItem('offstage_dm_threads', JSON.stringify(all));
  } catch (_) {}
}

// Canned artist auto-replies (mock for demo)
const _DM_CANNED_REPLIES = [
  '안녕하세요! 메시지 잘 받았어요 ❤️',
  '응원 정말 감사해요. 다음 곡도 기대해주세요 🎵',
  '오 ! 저도 그 부분 신경 쓴 곳이에요. 알아주셔서 감동 ✨',
  '와 진짜요? 저도 그 곡 작업할 때 같은 느낌이었어요!',
  '곧 합주실에서 더 다듬을게요. 데모 들어주셔서 감사해요 🙏',
  '함께 만드는 분들 덕분에 이 곡이 살아나고 있어요. 고마워요!'
];

window.openDmModal = async function(artistName, artistAvatar) {
  if (!artistName) return;
  const db = window.DB.get();
  if (!db || !db.currentUser) {
    alert('로그인 후 메시지를 보낼 수 있어요');
    navigateTo('auth');
    return;
  }

  const safeName = artistName.replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const safeAvatar = (artistAvatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(artistName))).replace(/"/g,'&quot;');

  const modal = document.getElementById('dm-modal');
  const content = document.getElementById('dm-content');
  if (!modal || !content) return;

  // Show modal with loading shell
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  content.innerHTML = `
    <div class="dm-card">
      <div class="dm-header">
        <button class="dm-close-btn" onclick="closeDmModal()" aria-label="닫기"><i class="ri-arrow-left-line"></i></button>
        <img src="${safeAvatar}" class="dm-header-avatar" alt="${safeName}">
        <div class="dm-header-text">
          <div class="dm-header-name">${safeName}</div>
          <div class="dm-header-status"><span class="dm-status-dot"></span> ${_t('답장 가능', 'Online')}</div>
        </div>
      </div>
      <div class="dm-messages"><div class="dm-empty"><div class="dm-empty-text">${_t('메시지 불러오는 중…', 'Loading messages…')}</div></div></div>
    </div>
  `;

  // Resolve other user's id and the conversation. If they don't have a
  // Supabase profile (mock follow / sample artist), gracefully tell user.
  let otherUserId = null;
  let conversationId = null;
  try {
    if (window.DM) {
      otherUserId = await window.DM.resolveUserIdByName(artistName);
      if (otherUserId) {
        conversationId = await window.DM.getOrCreateConversation(otherUserId);
      }
    }
  } catch (e) { console.warn('[DM] open', e); }

  // Stash on window for sendDmMessage to read
  window._currentDmConvId = conversationId;
  window._currentDmAvatar = safeAvatar;
  window._currentDmName   = artistName;

  // Fetch messages
  let messages = [];
  if (conversationId && window.DM) {
    try {
      messages = await window.DM.fetchMessages(conversationId);
      window.DM.markRead(conversationId);
    } catch (e) { console.warn('[DM] fetch', e); }
  }

  // Re-render with real data
  const { data: { user } } = (window.supabase ? await window.supabase.auth.getUser() : { data: { user: null } });
  const myId = (user && user.id) || (db.currentUser && db.currentUser.id);

  let messagesHtml;
  if (!otherUserId) {
    messagesHtml = `
      <div class="dm-empty">
        <div class="dm-empty-emoji">📭</div>
        <div class="dm-empty-text">${_t(`${safeName}님은 아직 메시지를 받을 수 없어요`, `${safeName} can't receive messages yet`)}</div>
        <div class="dm-empty-sub">${_t('상대방이 로그인 후 프로필을 생성하면 가능해요', 'Available once they sign in and create a profile')}</div>
      </div>`;
  } else if (messages.length === 0) {
    messagesHtml = `
      <div class="dm-empty">
        <div class="dm-empty-emoji">💌</div>
        <div class="dm-empty-text">${_t(`${safeName}에게 첫 메시지를 보내봐`, `Send the first message to ${safeName}`)}</div>
        <div class="dm-empty-sub">${_t('응원 · 의견 · 협업 제안 — 뭐든 환영', 'Cheer · feedback · collab — anything')}</div>
      </div>`;
  } else {
    messagesHtml = messages.map(m => {
      const safeText = (m.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
      const isMe = m.sender_id === myId;
      if (isMe) {
        return `
          <div class="dm-row dm-row-me">
            <div class="dm-bubble dm-bubble-me">${safeText}</div>
            <div class="dm-time">${time}</div>
          </div>`;
      } else {
        return `
          <div class="dm-row dm-row-them">
            <img src="${safeAvatar}" class="dm-avatar" alt="">
            <div class="dm-bubble-wrap">
              <div class="dm-bubble dm-bubble-them">${safeText}</div>
              <div class="dm-time">${time}</div>
            </div>
          </div>`;
      }
    }).join('');
  }

  const canSend = !!conversationId;
  const inputDisabled = canSend ? '' : 'disabled';
  const placeholder = canSend
    ? _t(`${safeName}에게 메시지...`, `Message ${safeName}...`)
    : _t('메시지를 보낼 수 없는 상대예요', `Can't message this user`);

  content.innerHTML = `
    <div class="dm-card">
      <div class="dm-header">
        <button class="dm-close-btn" onclick="closeDmModal()" aria-label="닫기"><i class="ri-arrow-left-line"></i></button>
        <img src="${safeAvatar}" class="dm-header-avatar" alt="${safeName}">
        <div class="dm-header-text">
          <div class="dm-header-name">${safeName}</div>
          <div class="dm-header-status"><span class="dm-status-dot"></span> ${_t('답장 가능', 'Online')}</div>
        </div>
      </div>
      <div class="dm-messages">
        ${messagesHtml}
      </div>
      <div class="dm-input-row">
        <textarea id="dm-input" class="dm-input" placeholder="${placeholder}" rows="1" ${inputDisabled}
                  onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); window.sendDmMessage();}"></textarea>
        <button class="dm-send-btn" onclick="window.sendDmMessage()" ${inputDisabled}>
          <i class="ri-send-plane-fill"></i>
        </button>
      </div>
    </div>
  `;

  // Auto-scroll to bottom + focus input
  setTimeout(() => {
    const msgs = content.querySelector('.dm-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const input = document.getElementById('dm-input');
    if (input && canSend) input.focus();
    // 📱 아래로 스와이프 → 닫기 (.dm-card 가 실제 카드)
    const card = content.querySelector('.dm-card') || content;
    window._attachSwipeDismiss(card, {
      onClose: () => window.closeDmModal(),
      scrollGuard: 'auto', grabber: 'light',
      backdrop: document.getElementById('dm-modal'),
      exclude: 'input, textarea, button, a, .dm-input-row, [contenteditable="true"]'
    });
  }, 100);
};

window.closeDmModal = function() {
  const modal = document.getElementById('dm-modal');
  if (modal) modal.style.display = 'none';
  const content = document.getElementById('dm-content');
  if (content) content.innerHTML = '';
  document.body.style.overflow = '';
};

window.sendDmMessage = async function() {
  const input = document.getElementById('dm-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) return;
  const convId = window._currentDmConvId;
  if (!convId || !window.DM) {
    alert('대화방을 찾을 수 없어요');
    return;
  }
  const btn = document.querySelector('.dm-send-btn');
  if (btn) btn.disabled = true;
  input.value = '';

  try {
    const msg = await window.DM.send(convId, text);
    // Append to DOM (optimistic — Supabase already accepted)
    const msgsEl = document.querySelector('#dm-content .dm-messages');
    if (msgsEl) {
      const empty = msgsEl.querySelector('.dm-empty');
      if (empty) empty.remove();
      const safeText = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const time = new Date(msg && msg.created_at ? msg.created_at : Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      msgsEl.insertAdjacentHTML('beforeend', `
        <div class="dm-row dm-row-me">
          <div class="dm-bubble dm-bubble-me">${safeText}</div>
          <div class="dm-time">${time}</div>
        </div>
      `);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  } catch (e) {
    alert('메시지 전송 실패: ' + (e.message || e));
    input.value = text;  // restore for retry
  } finally {
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
};

// ===================== STO MINI — 함께 만들기 (데모 후원) =====================
// localStorage 기반 mock backings — 추후 실제 SPO 연결 시 대체
function _getMyBackings() {
  try {
    const raw = localStorage.getItem('offstage_my_backings');
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch (_) { return []; }
}
function _saveMyBackings(list) {
  try { localStorage.setItem('offstage_my_backings', JSON.stringify(list)); } catch (_) {}
}

window.openStoMini = function(trackId, trackTitle, artistName) {
  const db = window.DB.get();
  if (!db.currentUser) {
    alert('로그인 후 함께 만들 수 있어요');
    navigateTo('auth');
    return;
  }
  const safeTitle = (trackTitle || '데모').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const safeArtist = (artistName || '아티스트').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const content = document.getElementById('sto-mini-content');
  if (!content) return;

  // Pull per-track SPO config (each demo can have different goal/unit/perks/sharePercent)
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  const cfg = getStoConfigForTrack(track) || { goalKrw: 500000, unitMin: 10000, raisedKrw: 0, perks: [], sharePercent: 5 };
  const progressPct = Math.min(100, Math.round((cfg.raisedKrw / cfg.goalKrw) * 100));
  const fmt = (n) => n >= 10000 ? `${(n/10000).toFixed(0)}만원` : `${n.toLocaleString()}원`;
  const sharePct = cfg.sharePercent || 5;

  // Compute amount tiers as multiples of unitMin: 1x / 3x / 10x
  const tier1 = cfg.unitMin;
  const tier2 = cfg.unitMin * 3;
  const tier3 = cfg.unitMin * 10;

  const perksHtml = cfg.perks.map(p => `<li>${p.replace(/</g,'&lt;')}</li>`).join('');

  content.innerHTML = `
    <button class="sto-mini-close" onclick="closeStoMini()" aria-label="닫기"><i class="ri-close-line"></i></button>
    <div class="sto-mini-card">
      <div class="sto-mini-banner">
        <span class="sto-mini-banner-emoji">💎</span>
        <div class="sto-mini-banner-text">
          <div class="sto-mini-eyebrow">함께 만들기 — 데모 STO</div>
          <div class="sto-mini-title">${safeArtist}의 「${safeTitle}」</div>
        </div>
      </div>

      <div class="sto-progress-block">
        <div class="sto-progress-head">
          <span class="sto-progress-raised">${fmt(cfg.raisedKrw)} <span class="sto-progress-of">/ ${fmt(cfg.goalKrw)}</span></span>
          <span class="sto-progress-pct">${progressPct}%</span>
        </div>
        <div class="sto-progress-bar"><div class="sto-progress-fill" style="width:${progressPct}%;"></div></div>
        <div class="sto-progress-foot">최소 단위 ${fmt(cfg.unitMin)} · 이 데모 전용 SPO</div>
      </div>

      <div class="sto-share-block">
        <div class="sto-share-head">
          <span class="sto-share-emoji">💎</span>
          <span class="sto-share-num">${sharePct}%</span>
          <span class="sto-share-label">아티스트가 STO 지분을 청취자들에게 분배</span>
        </div>
        <div class="sto-share-foot">마스터 발매 후 음원 수익의 ${sharePct}%가 후원 지분에 따라 분배돼요</div>
      </div>

      ${cfg.perks.length > 0 ? `
        <div class="sto-perks-block">
          <div class="sto-perks-title">🎁 참여 혜택</div>
          <ul class="sto-perks-list">${perksHtml}</ul>
        </div>
      ` : ''}

      <div class="sto-mini-amounts">
        <button class="sto-mini-amount" onclick="submitStoMini('${trackId}', ${tier1}, '${safeArtist.replace(/'/g, "\\'")}', '${safeTitle.replace(/'/g, "\\'")}')">
          <div class="sto-amt-num">${fmt(tier1)}</div>
          <div class="sto-amt-sub">씨앗</div>
        </button>
        <button class="sto-mini-amount sto-amount-recommended" onclick="submitStoMini('${trackId}', ${tier2}, '${safeArtist.replace(/'/g, "\\'")}', '${safeTitle.replace(/'/g, "\\'")}')">
          <div class="sto-amt-badge">인기</div>
          <div class="sto-amt-num">${fmt(tier2)}</div>
          <div class="sto-amt-sub">새싹</div>
        </button>
        <button class="sto-mini-amount" onclick="submitStoMini('${trackId}', ${tier3}, '${safeArtist.replace(/'/g, "\\'")}', '${safeTitle.replace(/'/g, "\\'")}')">
          <div class="sto-amt-num">${fmt(tier3)}</div>
          <div class="sto-amt-sub">활짝</div>
        </button>
      </div>
      <div class="sto-mini-custom-row">
        <input type="number" id="sto-mini-custom" class="sto-mini-custom-input" placeholder="직접 입력 (최소 ${fmt(cfg.unitMin)})" min="${cfg.unitMin}" step="${cfg.unitMin}">
        <button class="sto-mini-custom-btn" onclick="submitStoMiniCustom('${trackId}', '${safeArtist.replace(/'/g, "\\'")}', '${safeTitle.replace(/'/g, "\\'")}')">
          함께하기
        </button>
      </div>
      <div class="sto-mini-footer">
        🤝 하나증권 SPO와 연동 준비 중 · 모의 거래
      </div>
    </div>
  `;
  const modal = document.getElementById('sto-mini-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeStoMini = function() {
  const modal = document.getElementById('sto-mini-modal');
  if (modal) modal.style.display = 'none';
  const content = document.getElementById('sto-mini-content');
  if (content) content.innerHTML = '';
  document.body.style.overflow = '';
};

window.submitStoMini = function(trackId, amount, artistName, trackTitle) {
  if (!trackId || !amount || amount < 10000) {
    alert('1만원 이상부터 가능해요');
    return;
  }
  const list = _getMyBackings();
  list.unshift({
    id: 'b_' + Date.now(),
    trackId,
    artistName,
    trackTitle,
    amount: Number(amount),
    createdAt: new Date().toISOString(),
    mock: true
  });
  _saveMyBackings(list);

  // Boost the artist's spoBackers count by 1 (mock); each backing = 1 SPO participant
  try {
    const mockFollows = window._getMockFollows();
    const idx = mockFollows.findIndex(a => a.name === artistName);
    if (idx >= 0) {
      mockFollows[idx].spoBackers = (mockFollows[idx].spoBackers || 0) + 1;
      // Bigger amount = more streams equivalent (mock boost)
      mockFollows[idx].streamCount = (mockFollows[idx].streamCount || 0) + Math.floor(amount / 100);
      localStorage.setItem('offstage_mock_follows', JSON.stringify(mockFollows));
    }
  } catch (_) {}

  closeStoMini();
  showToast(_t(`✨ ${(Number(amount)/10000).toFixed(0)}만원 함께 만들기 신청 완료!`, `✨ Signed up to co-create with ${(Number(amount)/10000).toFixed(0)}0,000 KRW!`));

  // Check for level-up celebration after a short delay (after toast)
  setTimeout(() => {
    if (typeof window.checkAndCelebrateLevelUp === 'function') {
      window.checkAndCelebrateLevelUp(artistName);
    }
  }, 800);

  // Refresh profile if currently visible
  if (currentView === 'profile') setTimeout(() => renderProfile(), 100);
};

window.submitStoMiniCustom = function(trackId, artistName, trackTitle) {
  const input = document.getElementById('sto-mini-custom');
  const amt = parseInt(input?.value || '0', 10);
  if (!amt || amt < 10000) {
    alert('1만원 이상부터 가능해요');
    return;
  }
  window.submitStoMini(trackId, amt, artistName, trackTitle);
};

// Expose backings for renderProfile to use
window._getMyBackings = _getMyBackings;

// ===================== LEVEL-UP TOAST — 카드 단계 상승 알림 =====================
// 후원 / follow 시 점수 변화 → 단계 상승 감지 → 화려한 토스트
window.checkAndCelebrateLevelUp = function(artistName) {
  if (!artistName) return;
  const mockFollows = (typeof window._getMockFollows === 'function') ? window._getMockFollows() : [];
  const artist = mockFollows.find(a => a.name === artistName);
  if (!artist) return;
  const prevLevel = Number(artist._lastLevel || 0);
  const stage = getTamaStage(artist.streamCount || 0, artist.spoBackers || 0);
  if (stage.level > prevLevel) {
    artist._lastLevel = stage.level;
    // Save updated _lastLevel back
    try {
      const list = window._getMockFollows();
      const idx = list.findIndex(a => a.name === artistName);
      if (idx >= 0) {
        list[idx]._lastLevel = stage.level;
        localStorage.setItem('offstage_mock_follows', JSON.stringify(list));
      }
    } catch (_) {}
    showLevelUpToast(artistName, stage);
  }
};

function showLevelUpToast(artistName, stage) {
  const el = document.getElementById('levelup-toast');
  if (!el) return;
  el.style.background = `linear-gradient(135deg, ${stage.color}, ${stage.color2})`;
  el.innerHTML = `
    <div class="levelup-card" data-tier="${stage.level}">
      <div class="levelup-emoji">${stage.emoji}</div>
      <div class="levelup-eyebrow">LEVEL UP!</div>
      <div class="levelup-title">${(artistName || '').replace(/</g,'&lt;')}가<br><strong>${stage.name}</strong>(으)로 자랐어요!</div>
      <div class="levelup-sub">Lv.${stage.level} ${stage.emoji} · 성장 점수 ${stage.score}/100</div>
      <button class="levelup-share" onclick="window.openShareCard('${(artistName||'').replace(/'/g,"\\'")}')">
        <i class="ri-share-2-line"></i> 자랑하기
      </button>
      <button class="levelup-dismiss" onclick="closeLevelUpToast()">닫기</button>
    </div>
    <div class="levelup-confetti" aria-hidden="true">${_buildConfetti(40)}</div>
  `;
  el.style.display = 'flex';
  // Auto-dismiss after 8s
  clearTimeout(window._levelupTimer);
  window._levelupTimer = setTimeout(() => closeLevelUpToast(), 8000);
}

function _buildConfetti(n) {
  const colors = ['#E63946', '#FFB703', '#1D3557', '#4ECDC4', '#FF6B9D', '#FFD600'];
  let html = '';
  for (let i = 0; i < n; i++) {
    const c = colors[i % colors.length];
    const left = Math.random() * 100;
    const dur = 2 + Math.random() * 2;
    const delay = Math.random() * 0.6;
    const rot = Math.random() * 720 - 360;
    const size = 6 + Math.random() * 10;
    html += `<span class="confetti-piece" style="background:${c}; left:${left}%; width:${size}px; height:${size}px; animation-duration:${dur}s; animation-delay:${delay}s; --rot:${rot}deg;"></span>`;
  }
  return html;
}

window.closeLevelUpToast = function() {
  const el = document.getElementById('levelup-toast');
  if (el) el.style.display = 'none';
  if (window._levelupTimer) clearTimeout(window._levelupTimer);
};

// ===================== SHARE CARD — Canvas PNG 생성 =====================
window.openShareCard = function(artistName) {
  if (!artistName) return;
  const mockFollows = (typeof window._getMockFollows === 'function') ? window._getMockFollows() : [];
  const artist = mockFollows.find(a => a.name === artistName);
  if (!artist) {
    showToast(_t('카드 정보를 못 찾았어요', "Couldn't find card info"));
    return;
  }
  const stage = getTamaStage(artist.streamCount || 0, artist.spoBackers || 0);
  _drawAndShareCard(artist, stage);
};

async function _drawAndShareCard(artist, stage) {
  const W = 720, H = 1080; // vertical 2:3 for IG/카톡 stories
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // BG gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, stage.color);
  grad.addColorStop(1, stage.color2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Bauhaus stripes top
  ctx.fillStyle = '#E63946'; ctx.fillRect(0, 0, W/3, 24);
  ctx.fillStyle = '#FFB703'; ctx.fillRect(W/3, 0, W/3, 24);
  ctx.fillStyle = '#1D3557'; ctx.fillRect(2*W/3, 0, W/3, 24);

  // White card body
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#0A0A0A';
  ctx.lineWidth = 8;
  const cardX = 60, cardY = 90, cardW = W - 120, cardH = H - 180;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.strokeRect(cardX, cardY, cardW, cardH);

  // Header bar inside card
  const headerY = cardY;
  const headerH = 90;
  ctx.fillStyle = stage.color2;
  ctx.fillRect(cardX, headerY, cardW, headerH);
  ctx.beginPath();
  ctx.moveTo(cardX, headerY + headerH);
  ctx.lineTo(cardX + cardW, headerY + headerH);
  ctx.stroke();

  // Header text
  ctx.fillStyle = '#0A0A0A';
  ctx.font = 'bold 32px "Archivo Black", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Lv.${stage.level} ${stage.name.toUpperCase()}`, cardX + 30, headerY + headerH/2);
  ctx.font = '60px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(stage.emoji, cardX + cardW - 30, headerY + headerH/2 + 6);
  ctx.textAlign = 'left';

  // Avatar (load image)
  await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const photoY = headerY + headerH + 24;
      const photoH = 380;
      ctx.save();
      ctx.beginPath();
      const px = cardX + 40, py = photoY, pw = cardW - 80, ph = photoH;
      ctx.rect(px, py, pw, ph);
      ctx.clip();
      // cover-fit
      const ratio = Math.max(pw / img.width, ph / img.height);
      const drawW = img.width * ratio, drawH = img.height * ratio;
      ctx.drawImage(img, px + (pw - drawW)/2, py + (ph - drawH)/2, drawW, drawH);
      ctx.restore();
      ctx.lineWidth = 5;
      ctx.strokeRect(px, py, pw, ph);
      resolve();
    };
    img.onerror = () => {
      // Fallback: solid rect with initial
      const photoY = headerY + headerH + 24;
      const photoH = 380;
      ctx.fillStyle = '#ddd';
      ctx.fillRect(cardX + 40, photoY, cardW - 80, photoH);
      ctx.fillStyle = '#0A0A0A';
      ctx.font = 'bold 200px "Archivo Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((artist.name || '?')[0], cardX + cardW/2, photoY + photoH/2 + 70);
      ctx.textAlign = 'left';
      resolve();
    };
    img.src = artist.avatar || 'https://i.pravatar.cc/600?u=' + encodeURIComponent(artist.name);
  });

  // Artist name
  ctx.fillStyle = '#0A0A0A';
  ctx.font = 'bold 56px "Archivo Black", "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(artist.name || '아티스트', W/2, 600);

  // Eyebrow
  ctx.font = '24px "Bebas Neue", "Inter", sans-serif';
  ctx.fillStyle = '#6B46C1';
  ctx.fillText('함께 만드는 아티스트', W/2, 645);

  // Stats row
  const statY = 730;
  ctx.fillStyle = '#0A0A0A';
  ctx.font = 'bold 36px "Archivo Black", sans-serif';
  ctx.fillText(`🎵 ${_fmtN(artist.streamCount || 0)}`, W/2 - 130, statY);
  ctx.fillText(`💎 ${_fmtN(artist.spoBackers || 0)}`, W/2 + 130, statY);
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#6e6478';
  ctx.fillText('스트리밍', W/2 - 130, statY + 38);
  ctx.fillText('SPO 참여', W/2 + 130, statY + 38);

  // Score block
  const scoreY = 850;
  ctx.fillStyle = '#0A0A0A';
  ctx.font = 'bold 80px "Archivo Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${stage.score}/100`, W/2, scoreY);
  ctx.font = '24px sans-serif';
  ctx.fillStyle = '#6e6478';
  ctx.fillText('성장 점수', W/2, scoreY + 36);

  // Bottom branding
  ctx.fillStyle = '#0A0A0A';
  ctx.fillRect(cardX, cardY + cardH - 80, cardW, 80);
  ctx.fillStyle = '#FFB703';
  ctx.font = 'bold 32px "Archivo Black", sans-serif';
  ctx.fillText('OFF-STAGE', W/2, cardY + cardH - 38);
  ctx.fillStyle = '#fff';
  ctx.font = '16px "Bebas Neue", sans-serif';
  ctx.fillText('무대 뒤에서 만나', W/2, cardY + cardH - 12);

  // Trigger download + show share modal
  canvas.toBlob((blob) => {
    if (!blob) { showToast(_t('이미지 생성 실패', 'Image creation failed')); return; }
    const url = URL.createObjectURL(blob);
    _showShareModal(url, artist.name, stage);
  }, 'image/png');
}

function _fmtN(n) { return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }

function _showShareModal(imgUrl, artistName, stage) {
  const modal = document.getElementById('tama-modal');
  const content = document.getElementById('tama-modal-content');
  if (!modal || !content) return;
  content.innerHTML = `
    <button class="tama-modal-close" onclick="closeTamaModal(); URL.revokeObjectURL('${imgUrl}')" aria-label="닫기"><i class="ri-close-line"></i></button>
    <div style="background:#fff; border:3px solid #0A0A0A; border-radius:14px; padding:18px; box-shadow:5px 5px 0 #0A0A0A;">
      <div style="font-family:'Archivo Black',sans-serif; font-size:18px; letter-spacing:-0.5px; color:#0A0A0A; margin-bottom:10px; text-align:center;">자랑하기 ✨</div>
      <img src="${imgUrl}" style="width:100%; border:2px solid #0A0A0A; border-radius:8px; display:block; margin-bottom:14px;" alt="${(artistName||'').replace(/"/g,'&quot;')} 카드">
      <div style="display:flex; gap:8px;">
        <a href="${imgUrl}" download="offstage-${(artistName||'card').replace(/[^\\w가-힣]/g,'_')}-${stage.name}.png" class="btn-primary" style="flex:1; text-align:center; text-decoration:none;">
          <i class="ri-download-2-line"></i> 다운로드
        </a>
        <button class="btn-primary" style="flex:1; background:#1D3557;" onclick="window.copyShareText('${(artistName||'').replace(/'/g,"\\'")}', '${stage.name}')">
          <i class="ri-clipboard-line"></i> 텍스트 복사
        </button>
      </div>
      <p style="margin-top:10px; font-size:11px; color:#6e6478; text-align:center; font-weight:700;">
        다운로드 후 카톡/인스타에 올려서 함께한 아티스트 자랑해봐 🎉
      </p>
    </div>
  `;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

window.copyShareText = function(artistName, stageName) {
  const text = `🎵 ${artistName}와 함께 만들고 있어요!\n현재 단계: ${stageName} ⭐\n\n#OffStage #함께만드는아티스트\nhttps://off-stage-weld.vercel.app`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast(_t('📋 텍스트 복사됨!', '📋 Text copied!'))).catch(() => alert(text));
  } else {
    alert(text);
  }
};


// ===================== TAMA CARD MODAL =====================
window.openTamaCardModal = function(artistName, opts) {
  if (!artistName) return;
  const decoded = decodeURIComponent(artistName);
  const db = window.DB.get();
  const allTracks = Array.isArray(db.tracks) ? db.tracks : [];
  const artistTracks = allTracks.filter(t => t && t.artist === decoded);
  const allNotes = Array.isArray(db.notes) ? db.notes : [];
  // Look up follow info from cached followedArtists if available
  const cachedFollowed = window.__followedArtistsCache || [];
  const followedRow = cachedFollowed.find(f => f.name === decoded);
  const isSample = !!(opts && opts.sample);
  const avatar = (opts && opts.avatar) || (followedRow && followedRow.avatar) ||
    (artistTracks[0] && artistTracks[0].artistAvatar) ||
    ('https://i.pravatar.cc/300?u=' + encodeURIComponent(decoded));
  const role = (followedRow && followedRow.role) || (opts && opts.role) || 'artist';
  const roleLabel = role === 'admin' ? '관리자' : (role === 'artist' || role === 'student' ? '아티스트' : '리스너');

  // Stream / SPO numbers (use cached if available, else fall back to opts/track count)
  let streams = (followedRow && followedRow.streamCount) || (opts && opts.streams) || (artistTracks.length * 100);
  let backers = (followedRow && followedRow.spoBackers) || (opts && opts.backers) || 0;
  if (isSample) {
    streams = (opts && opts.streams) || 0;
    backers = (opts && opts.backers) || 0;
  }
  const stage = getTamaStage(streams, backers);
  const progressPct = Math.round(stage.progress * 100);
  const formatN = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
  const safeName = decoded.replace(/</g,'&lt;').replace(/"/g,'&quot;');

  // Following state
  let isFollowing = false;
  let artistSupabaseId = null;
  if (window.Follows && followedRow) {
    artistSupabaseId = followedRow.id;
    isFollowing = window.Follows.isFollowing(artistSupabaseId);
  }

  // Track preview (max 4)
  const previewTracks = artistTracks.slice(0, 4);
  const tracksHtml = previewTracks.length > 0 ? previewTracks.map(t => {
    const cover = t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=200';
    const title = (t.title || '무제').replace(/</g,'&lt;');
    const sub = (t.versionLabel || (t.isDemo ? 'Demo' : 'Final')).replace(/</g,'&lt;');
    return `
      <div class="tama-big-track-row" onclick="event.stopPropagation(); window.playTrack('${t.id}')">
        <img src="${cover}" class="tama-big-track-cover" alt="">
        <div class="tama-big-track-info">
          <div class="tama-big-track-title">${title}</div>
          <div class="tama-big-track-meta">${sub}</div>
        </div>
        <div class="tama-big-track-play"><i class="ri-play-fill"></i></div>
      </div>
    `;
  }).join('') : `<div class="tama-big-empty-row">아직 발매된 곡이 없어요 🎵</div>`;

  const followBtnHtml = isSample
    ? `<button class="tama-big-action-follow" onclick="event.stopPropagation(); showToast(_t('예시 카드입니다 ✨', 'This is a sample card ✨'))">🌱 함께하기</button>`
    : (artistSupabaseId
        ? `<button class="tama-big-action-follow ${isFollowing ? 'is-following' : ''}" onclick="event.stopPropagation(); toggleFollowArtist('${artistSupabaseId}', '${safeName}'); setTimeout(closeTamaModal, 200);">
            ${isFollowing ? '<i class="ri-seedling-fill"></i> 함께하는 중' : '<i class="ri-seedling-line"></i> 함께하기'}
          </button>`
        : `<button class="tama-big-action-follow" onclick="event.stopPropagation(); navigateTo('artist:${encodeURIComponent(decoded)}'); closeTamaModal();">프로필에서 함께하기 →</button>`
      );

  const profileBtnHtml = isSample
    ? '' // no profile link for sample cards
    : `<button class="tama-big-action-profile" onclick="event.stopPropagation(); navigateTo('artist:${encodeURIComponent(decoded)}'); closeTamaModal();">전체 프로필 →</button>`;

  const shareBtnHtml = isSample
    ? ''
    : `<button class="tama-big-action-profile" onclick="event.stopPropagation(); closeTamaModal(); setTimeout(() => window.openShareCard('${decoded.replace(/'/g,"\\'")}'), 250);" title="자랑하기">
        <i class="ri-share-2-line"></i> 자랑
      </button>`;

  const content = document.getElementById('tama-modal-content');
  if (!content) return;
  content.innerHTML = `
    <button class="tama-modal-close" onclick="closeTamaModal()" aria-label="닫기"><i class="ri-close-line"></i></button>
    <div class="tama-big-card" data-tier="${stage.level}" style="--tama-color:${stage.color}; --tama-color-2:${stage.color2};">
      <div class="tama-big-card-header">
        <span class="tama-big-level">Lv.${stage.level} ${stage.name}</span>
        <span class="tama-big-emoji">${stage.emoji}</span>
      </div>
      <div class="tama-big-photo">
        <img src="${avatar}" alt="${safeName}">
        <div class="tama-big-name-overlay">
          ${safeName}
          <span class="tama-big-name-overlay-sub">${isSample ? '예시 카드' : roleLabel}</span>
        </div>
      </div>
      <div class="tama-big-body">
        <div class="tama-big-stats-row">
          <div class="tama-big-stat">
            <span class="tama-big-stat-icon">🎵</span>
            <span class="tama-big-stat-num">${formatN(streams)}</span>
            <span class="tama-big-stat-label">스트리밍</span>
            <span class="tama-big-stat-weight">30%</span>
          </div>
          <div class="tama-big-stat">
            <span class="tama-big-stat-icon">💎</span>
            <span class="tama-big-stat-num">${formatN(backers)}</span>
            <span class="tama-big-stat-label">SPO 참여</span>
            <span class="tama-big-stat-weight">70%</span>
          </div>
        </div>

        <div class="tama-big-progress-block">
          <div class="tama-big-progress-label">
            <span>성장 점수</span>
            <span>${stage.score}/100</span>
          </div>
          <div class="tama-big-progress-bar">
            <div class="tama-big-progress-fill" style="width:${progressPct}%;"></div>
          </div>
          <div class="tama-big-progress-next">
            ${stage.isMax ? '✨ 최고 단계 도달' : `다음: ${stage.nextEmoji} ${stage.nextName} (${progressPct}%)`}
          </div>
        </div>

        <div class="tama-big-tracks">
          <div class="tama-big-section-title">🎧 미리듣기 ${artistTracks.length > 0 ? `(${artistTracks.length})` : ''}</div>
          ${tracksHtml}
        </div>

        <div class="tama-big-actions">
          ${followBtnHtml}
          ${profileBtnHtml}
          ${shareBtnHtml}
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById('tama-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeTamaModal = function() {
  const modal = document.getElementById('tama-modal');
  if (modal) modal.style.display = 'none';
  const content = document.getElementById('tama-modal-content');
  if (content) content.innerHTML = '';
  document.body.style.overflow = '';
};

// ESC key closes the tama modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('tama-modal');
    if (modal && modal.style.display !== 'none') {
      window.closeTamaModal();
    }
  }
});

// Cache followed artists info so modal can read latest data
window.__followedArtistsCache = window.__followedArtistsCache || [];

// Profile folder helpers
window.promptNewPlaylist = async function() {
  const name = prompt(_t('새 폴더 이름을 정해줘 ✨', 'Name your new folder ✨'), '');
  if (!name || !name.trim()) return;
  try {
    if (window.Playlists) {
      await window.Playlists.create(name.trim());
      await window.Playlists.refreshInto(window.DB.get());
    } else {
      window.DB.createPlaylist(name.trim());
    }
    renderSidebarPlaylists();
    showToast(_t('폴더 만들었어요 ✨', 'Folder created ✨'));
    if (currentView === 'profile') renderProfile();
    else if (currentView === 'universe' && window.renderUniverse) window.renderUniverse();
  } catch (e) {
    alert('만들기 실패: ' + (e.message || e));
  }
};

// 즐겨찾기 폴더 삭제 — 폴더(플레이리스트)만 지움. 담은 곡/메모는 그대로(각자 테이블).
window.deletePlaylistFolder = async function(folderId) {
  if (!folderId) return;
  if (!confirm(_t('이 폴더를 삭제할까요?\n(담은 곡·메모는 사라지지 않아요)', 'Delete this folder?\n(Saved songs/notes are kept)'))) return;
  try {
    if (window.Playlists && window.Playlists.deletePlaylist) {
      await window.Playlists.deletePlaylist(folderId);
      if (window.Playlists.refreshInto) await window.Playlists.refreshInto(window.DB.get());
    } else if (window.DB && window.DB.deletePlaylist) {
      window.DB.deletePlaylist(folderId);
    }
    if (typeof showToast === 'function') showToast(_t('폴더 삭제됐어요', 'Folder deleted'));
    if (currentView === 'universe' && window.renderUniverse) window.renderUniverse();
    else if (currentView === 'profile' && typeof renderProfile === 'function') renderProfile();
    if (typeof renderSidebarPlaylists === 'function') renderSidebarPlaylists();
  } catch (e) {
    alert(_t('삭제 실패: ', 'Delete failed: ') + (e.message || e));
  }
};

window.createDefaultPlaylist = async function(title) {
  if (!title) return;
  try {
    if (window.Playlists) {
      await window.Playlists.create(title);
      await window.Playlists.refreshInto(window.DB.get());
    } else {
      window.DB.createPlaylist(title);
    }
    renderSidebarPlaylists();
    showToast(_t(`"${title}" 폴더 시작! 🎵`, `"${title}" folder started! 🎵`));
    if (currentView === 'profile') renderProfile();
    else if (currentView === 'universe' && window.renderUniverse) window.renderUniverse();
  } catch (e) {
    alert('만들기 실패: ' + (e.message || e));
  }
};

window.openMyPlaylist = function(playlistId) {
  if (!playlistId) return;
  navigateTo('playlist:' + encodeURIComponent(playlistId));
};

// 폴더 헤더 — 내 우주 헤더 그대로(제목 '내 우주') + 아래에 폴더명·곡수·포스트잇수.
// 뒤로가기는 좌상단 글로벌 백버튼이 담당, 쇼츠는 아이템 클릭으로 진입.
function _folderHeadHtml(folderId, built, title) {
  return `
    <h1 style="font-size:22px; margin-bottom:4px;"><i class="ri-star-smile-fill" style="color:#FFC107;"></i> ${_t('즐겨찾기', 'Favorites')}</h1>
    <p style="font-size:13px; color:var(--text-secondary);">📁 ${title} · ${_t('곡', 'tracks')} ${built.trackCount} · ${_t('포스트잇', 'notes')} ${built.noteCount}</p>`;
}

// 내 우주 '안'에서 폴더 내용을 그린다(별도 페이지 X). 새로고침/쇼츠 복귀 등에 사용.
function _renderFolderUniverse(folderId) {
  const db = window.DB.get();
  let pl = (db.playlists || []).find(p => p.id === folderId)
        || (Array.isArray(window.__playlists) ? window.__playlists.find(p => p.id === folderId) : null);
  const title = _shEsc((pl && pl.title) || '폴더');
  const built = _folderItemsHtml(folderId);
  if (built.total === 0) { window.__universeFolderId = null; window.renderUniverse(); return; }
  const deco = _buildStarfield('universe-sky', 160, 15);
  appContent.innerHTML = `
    <div id="universe-head" style="padding:20px 24px 8px; text-align:center;">
      ${_folderHeadHtml(folderId, built, title)}
    </div>
    <div class="shapes-universe my-universe" style="height:${built.height}px;">
      ${deco}
      ${built.html}
    </div>`;
  // 폴더 안 아이템도 드래그로 옮길 수 있게 (탭은 인라인 onclick=쇼츠가 처리)
  if (typeof initShapeDrag === 'function') initShapeDrag();
  try { if (typeof _fitDpUnivText === 'function') _fitDpUnivText(appContent); } catch (_) {}
}

// 폴더에서 빠져나와 전체 내 우주로
window.exitFolderToUniverse = function() {
  const uni = document.querySelector('.shapes-universe.my-universe');
  if (!uni) {
    window.__universeFolderId = null;
    window.__universeFolderHistoryPushed = false;
    if (typeof window.renderUniverse === 'function') window.renderUniverse(true);
    return;
  }

  // 단일 크로스페이드 — 폴더 내용 페이드아웃 → 전체 우주 렌더 → 페이드인. (들어갈 때와 같은 모션 하나.)
  window.__universeFolderEntering = true;
  uni.style.transition = 'opacity 0.18s ease';
  uni.style.opacity = '0';
  setTimeout(() => {
    window.__universeFolderId = null;
    window.__universeFolderHistoryPushed = false;
    if (typeof window.renderUniverse === 'function') window.renderUniverse(true);
    const nu = document.querySelector('.shapes-universe.my-universe');
    if (nu) {
      nu.style.opacity = '0';
      nu.style.transition = 'opacity 0.24s ease';
      requestAnimationFrame(() => requestAnimationFrame(() => { nu.style.opacity = '1'; }));
    }
    window.__universeFolderEntering = false;
  }, 180);
};

// 폴더 진입 — 페이지 이동 없이 그 자리에서 폴더 모드로. 모션은 '단일 크로스페이드'(페이드 하나).
// (예전엔 방향성 팬: 원래 애들 슬라이드 아웃 + 폴더 애들 위에서 날아옴 → floatDrift 와 겹쳐 어색 →
//  사용자 요청대로 페이드 하나로 통일.)
window.enterFolderWithAnim = function(folderId, anchorEl) {
  // ⚠️ 진입 페이드 도중 백그라운드 refresh 의 renderUniverse 재렌더를 막는 가드(완료 후 끔).
  window.__universeFolderEntering = true;
  // history 엔트리 push → 네이티브 뒤로가기(오른쪽 스와이프)가 이전 탭으로 새지 않고 폴더만 나가게.
  // (popstate 핸들러가 __universeFolderId 보고 exitFolderToUniverse 처리.)
  try {
    if (typeof history !== 'undefined' && history.pushState) {
      history.pushState({ route: 'universe', folder: folderId }, '', location.hash || '#/universe');
      window.__universeFolderHistoryPushed = true;
    }
  } catch (_) {}
  // 폴더 줄(상단 고정)은 .shapes-universe 캔버스 바깥 형제라 진입 애니에 안 딸려감 →
  // 폴더에 들어가면 폴더들도 같이 사라지도록 페이드아웃 후 제거(나갈 때 renderUniverse 가 새로 그림).
  const _frow = document.querySelector('.universe-folder-row');
  if (_frow) { _frow.style.transition = 'opacity 0.18s ease'; _frow.style.opacity = '0'; }
  const uni = document.querySelector('.shapes-universe.my-universe');
  const built = (typeof _folderItemsHtml === 'function') ? _folderItemsHtml(folderId) : null;
  if (!uni || !built || !built.html) {
    window.__universeFolderId = folderId;
    window.__universeFolderEntering = false;
    if (typeof window.renderUniverse === 'function') window.renderUniverse(true);
    return;
  }

  // 단일 크로스페이드 — 현재 우주 페이드아웃 → 폴더 우주 렌더(_renderFolderUniverse, 헤더 포함) → 페이드인.
  uni.style.transition = 'opacity 0.18s ease';
  uni.style.opacity = '0';
  setTimeout(() => {
    window.__universeFolderId = folderId;
    if (typeof _renderFolderUniverse === 'function') _renderFolderUniverse(folderId);
    const nu = document.querySelector('.shapes-universe.my-universe');
    if (nu) {
      nu.style.opacity = '0';
      nu.style.transition = 'opacity 0.24s ease';
      requestAnimationFrame(() => requestAnimationFrame(() => { nu.style.opacity = '1'; }));
    }
    window.__universeFolderEntering = false;
  }, 180);
};

window.createAndAddPlaylist = async function() {
  const nameInput = document.getElementById('new-playlist-name');
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    let newPl;
    if (window.Playlists) {
      newPl = await window.Playlists.create(name);
      if (window._pendingPlaylistTrackId) {
        try { await window.Playlists.addTrack(newPl.id, window._pendingPlaylistTrackId); } catch (_) {}
      }
      await window.Playlists.refreshInto(window.DB.get());
    } else {
      newPl = window.DB.createPlaylist(name);
      if (window._pendingPlaylistTrackId) window.DB.addTrackToPlaylist(newPl.id, window._pendingPlaylistTrackId);
    }
    nameInput.value = '';
    closePlaylistModal();
    renderSidebarPlaylists();
    showToast(_t('플레이리스트 만들었어요 ✨', 'Playlist created ✨'));
  } catch (e) {
    alert('생성 실패: ' + (e.message || e));
  }
};

/* =========================================================
   AUDIO PLAYER
========================================================= */

// ============================================================
// 🎵 Play queue — 즐겨찾기 / 도형 / 쇼츠에서 재생 시 자동으로 다음 곡 이어가는 큐.
// "하나씩 일일이 누르지 말고 플레이리스트처럼 흐르게" 가 핵심.
// ============================================================
function _buildPlayQueue(currentTrackId, source) {
  const db = window.DB.get();
  let ids = [];
  if (source === 'universe') {
    // 사용자 요청: 폴더 안 트랙은 그 폴더 안에서만 / 폴더 외부 트랙은 외부끼리 자동재생.
    // 트랙이 어느 폴더에도 안 속하면 "loose 트랙" → 모든 loose 트랙끼리 큐.
    const playlists = (Array.isArray(window.__playlists) && window.__playlists.length)
      ? window.__playlists
      : (db.playlists || []);
    let homeFolder = null;
    for (const pl of playlists) {
      if (pl && Array.isArray(pl.trackIds) && pl.trackIds.includes(currentTrackId)) {
        homeFolder = pl;
        break;
      }
    }
    if (homeFolder && Array.isArray(homeFolder.trackIds)) {
      // 폴더 안 트랙 → 그 폴더만
      ids = homeFolder.trackIds.slice();
    } else {
      // 폴더 외부 (loose) 트랙 → 어느 폴더에도 안 속한 모든 모은-곡 끼리
      const allCollected = new Set();
      if (db.currentUser && Array.isArray(db.currentUser.likedTracks)) {
        db.currentUser.likedTracks.forEach(id => allCollected.add(id));
      }
      if (window.__favoritedTracks && window.__favoritedTracks.forEach) {
        window.__favoritedTracks.forEach(id => allCollected.add(id));
      }
      if (window.CollectedTracks && window.CollectedTracks.all) {
        window.CollectedTracks.all().forEach(id => allCollected.add(id));
      }
      // 어느 폴더에도 속하지 않은 트랙만 추출
      const inAnyFolder = new Set();
      playlists.forEach(pl => {
        if (pl && Array.isArray(pl.trackIds)) pl.trackIds.forEach(id => inAnyFolder.add(id));
      });
      ids = Array.from(allCollected).filter(id => !inAnyFolder.has(id)).sort();
      // 클릭한 트랙이 빠져있으면 (방어) 추가
      if (!ids.includes(currentTrackId)) ids.unshift(currentTrackId);
    }
  } else if (source === 'shorts') {
    // 폴더 쇼츠 — 현재 쇼츠 컨텍스트의 트랙들 (note 제외, 순서 유지)
    const st = window.__shorts;
    if (st && Array.isArray(st.items)) {
      ids = st.items.filter(it => it && it.kind === 'track').map(it => it.id);
    }
  } else if (source === 'shape' || source === 'shapes' || source === 'shapeshorts') {
    // 도형 / 쇼츠 — 도형 페이지에 보이는 모든 곡.
    // 큐 순서를 도형 페이지의 시각 순서(createdAt ASC)와 일치시켜 자연스러운 흐름:
    //   현재 곡 끝나면 다음(시간순)으로 자동 진행.
    const st = window.__shapeShorts;
    if (source === 'shapeshorts' && st && Array.isArray(st.tracks)) {
      ids = st.tracks.map(t => t && t.id).filter(Boolean);
    } else {
      ids = (db.tracks || [])
        .filter(t => t && t.version !== 'demo_retired')
        .slice()
        .sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime() || 0;
          const tb = new Date(b.createdAt || 0).getTime() || 0;
          if (ta !== tb) return ta - tb;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        })
        .map(t => t.id);
    }
  } else if (source === 'playlist' || source === 'folder') {
    // 폴더 안에서 재생 — 그 폴더의 곡들만
    const pid = window.__universeFolderId;
    if (pid) {
      const pl = (window.__playlists || (db.playlists || [])).find(p => p && p.id === pid);
      if (pl && Array.isArray(pl.trackIds)) ids = pl.trackIds.slice();
    }
  }
  // 빈 큐 (또는 source 가 단일 곡) — 자기 자신만
  if (!ids.length) ids = [currentTrackId];
  if (!ids.includes(currentTrackId)) ids.unshift(currentTrackId);
  // 셔플(랜덤) ON — 현재 곡은 맨 앞 고정, 나머지를 무작위로 섞음 (Fisher–Yates).
  if (window.__shuffle && ids.length > 2) {
    const rest = ids.filter(id => id !== currentTrackId);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    ids = [currentTrackId, ...rest];
  }
  const idx = ids.indexOf(currentTrackId);
  return { tracks: ids, idx: Math.max(0, idx), source: source || 'other' };
}

// 셔플(랜덤 재생) 토글 — 버튼 + 큐 재구성. 사용자 요청 ("랜덤 표시").
window.__shuffle = (() => { try { return localStorage.getItem('off-stage-shuffle') === '1'; } catch (_) { return false; } })();
window.toggleShuffle = function () {
  window.__shuffle = !window.__shuffle;
  try { localStorage.setItem('off-stage-shuffle', window.__shuffle ? '1' : '0'); } catch (_) {}
  _syncShuffleBtn();
  if (typeof showToast === 'function') {
    showToast(window.__shuffle ? _t('🔀 랜덤 재생 켜짐', '🔀 Shuffle on') : _t('➡️ 순서대로 재생', '➡️ Shuffle off'));
  }
  // 지금 재생 중이면 현재 곡 기준으로 큐를 다시 구성 (즉시 반영).
  const cur = window.currentPlayingTrack;
  if (cur && window.__playQueue) {
    window.__playQueue = _buildPlayQueue(cur, window.__playQueue.source);
  }
};
function _syncShuffleBtn() {
  const btn = document.getElementById('shuffle-btn');
  if (btn) btn.classList.toggle('on', !!window.__shuffle);
}
window._syncShuffleBtn = _syncShuffleBtn;

window.playTrack = function (trackId, source) {
  // 대기 중인 자동다음곡 타이머 취소 — 수동 재생/스킵과 겹쳐 2곡 점프 방지
  if (window.__autoNextTimer) {
    clearTimeout(window.__autoNextTimer);
    window.__autoNextTimer = null;
  }
  const db = window.DB.get();
  const track = db.tracks.find(t => t.id === trackId);
  if (!track) return;

  if (currentPlayingTrack === track.id) {
    // 같은 트랙 다시 클릭 — 카드 영역 클릭은 안 꺼지게 (사용자 요청).
    // 단, 'wall' (우리들의 벽 노트의 ▶/⏸ 썸네일 버튼) 은 명시적 토글 버튼이라 제외.
    // togglePlay 는 명시적 play/pause 버튼 (wall 썸네일, 헤더) 에서만 작동.
    const isCardLikeSource = source === 'demo' || source === 'shape' || source === 'shapes'
                          || source === 'universe' || source === 'shapeshorts'
                          || source === 'shorts';
    if (isCardLikeSource) {
      // 일시정지 상태였으면 다시 재생 (안 꺼지게)
      if (audioElement.paused) {
        try { audioElement.play(); } catch (_) {}
        const icon = playBtn.querySelector('i');
        if (icon) icon.className = 'ri-pause-circle-fill';
      }
      return;
    }
    // 'wall' / 'other' / undefined → 명시적 토글 (재생 중이면 정지, 정지 중이면 재생)
    togglePlay();
    return;
  }

  currentPlayingTrack = track.id;
  window.currentPlayingTrack = currentPlayingTrack;
  try { if (typeof _pushRecent === 'function') _pushRecent(track.id); } catch(_){}   // 플레이리스트 '최근 들은 노래'

  // 큐 갱신 — universe / shape / shapeshorts / folder 에서 시작하면 그 컨텍스트의 곡들을
  // 이어서 자동 재생. 다른 곳 (wall, 검색 등) 은 단일 곡만 — 자동 진행 X.
  // 단, 큐 내부 곡으로 이동 (next 버튼/ended) 한 경우엔 큐를 다시 빌드하지 않음 —
  // _qNav flag 로 자기 자신을 호출했음을 표시.
  if (!window.__playTrackFromQueue) {
    window.__playQueue = _buildPlayQueue(track.id, source);
  } else {
    // 큐 내부 이동 — 큐는 그대로, idx 만 동기화
    const q = window.__playQueue;
    if (q && Array.isArray(q.tracks)) {
      const i = q.tracks.indexOf(track.id);
      if (i >= 0) q.idx = i;
    }
  }

  // Analytics: fire 'start' event (also wraps up the previous track's 'end').
  // source is used to count "shape clicks" vs other play surfaces.
  if (window.Analytics && window.Analytics.trackPlayStart) {
    const dur = track && track.duration ? track.duration : 0;
    window.Analytics.trackPlayStart(track.id, source || 'other', dur).catch(()=>{});
  }

  if (db.currentUser) {
    if (!db.currentUser.history) db.currentUser.history = [];
    db.currentUser.history = db.currentUser.history.filter(id => id !== track.id);
    db.currentUser.history.unshift(track.id);
    if (db.currentUser.history.length > 20) db.currentUser.history.pop();
    window.DB.save(db);
  }

  globalPlayer.classList.add('active');

  // 커버 이미지 대신 '곡 색 디스크'로 통일 (Coming Soon 등 대체).
  // 색 = 장르 색(있으면) / 없으면 트랙 id 해시 — 발견 도형과 동일(genreColorOf). --player-color 로 디스크/펄스.
  const _discColor = genreColorOf(track);
  globalPlayer.style.setProperty('--player-color', _discColor);
  const _coverEl = document.getElementById('player-cover');
  _coverEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';   // 1x1 투명 → CSS 배경(디스크)만 보이게
  // 도형에 '쓴 글'(track.lines) — 발견 도형의 .shape-text 와 동일 소스. (track.tags 키워드가 아님!)
  // 풀스크린 원 안(#pfs-tags)으로 복사돼 도형처럼 보임. 글 없으면 비움.
  const _esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _lines = (Array.isArray(track.lines) ? track.lines : []).map(l => (l || '').trim()).filter(Boolean).slice(0, 4);
  const _tagsEl = document.getElementById('player-tags');
  if (_tagsEl) _tagsEl.innerHTML = _lines.map(l => `<span>${_esc(l)}</span>`).join('');
  // 타이틀 = 데모 버전("데모 N"), 마스터(발매)는 곡 제목. 'Coming Soon' 은 표시 안 함.
  // 미니 서브 = 도형에 쓴 글(없으면 아티스트). 풀스크린 원 = 도형 글, 서브 = 아티스트.
  const _dm = /^demo\s*(\d+)$/i.exec((track.version || '').trim()) || /demo\s*(\d+)/i.exec((track.versionLabel || '').trim());
  const _demoLabel = _dm ? _t('데모 ' + _dm[1], 'Demo ' + _dm[1]) : (track.isDemo ? _t('데모', 'Demo') : '');
  const _stripCS = (s) => (s || '').replace(/coming\s*soon\.*/ig, '').trim();
  const _cleanTitle = _stripCS(track.title), _cleanArtist = _stripCS(track.artist);
  const _linesText = _lines.join(' ');
  document.getElementById('player-title').innerText = _demoLabel || _cleanTitle || _t('데모', 'Demo');
  document.getElementById('player-artist').innerText = _linesText || _cleanArtist || '';
  window.__playerArtistName = track.artist;   // 표시와 무관 — 제목/아티스트 클릭 시 이동 대상
  window.__nowPlayingId = track.id;            // 자동재생(라디오) 이 끝난 곡을 알기 위해
  if (typeof _updatePlayerCollectState === 'function') _updatePlayerCollectState();
  if (window.syncPlayerFs) window.syncPlayerFs();   // 풀스크린 카드도 현재 곡으로 갱신

  // MediaSession API — iOS 락스크린/컨트롤센터 위젯 + 미디어 볼륨 라우팅.
  // 이게 있어야 iOS 컨트롤센터 볼륨 슬라이더가 "벨소리" 가 아니라 "미디어" 로 인식됨.
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '제목 없음',
        artist: track.artist || '',
        album: 'Off-Stage',
        artwork: track.cover ? [
          { src: track.cover, sizes: '96x96',   type: 'image/png' },
          { src: track.cover, sizes: '192x192', type: 'image/png' },
          { src: track.cover, sizes: '512x512', type: 'image/png' }
        ] : []
      });
      navigator.mediaSession.playbackState = 'playing';
      // 액션 핸들러 — 락스크린/AirPods/자동차 컨트롤에서 호출됨
      try { navigator.mediaSession.setActionHandler('play', () => { try { audioElement.play(); } catch(_){} }); } catch(_){}
      try { navigator.mediaSession.setActionHandler('pause', () => { try { audioElement.pause(); } catch(_){} }); } catch(_){}
      try { navigator.mediaSession.setActionHandler('previoustrack', () => {
        const q = window.__playQueue;
        if (q && Array.isArray(q.tracks) && q.idx > 0) {
          const prevId = q.tracks[q.idx - 1];
          window.__playTrackFromQueue = true;
          try { window.playTrack(prevId, q.source); } finally { window.__playTrackFromQueue = false; }
        }
      }); } catch(_){}
      try { navigator.mediaSession.setActionHandler('nexttrack', () => {
        const q = window.__playQueue;
        if (q && Array.isArray(q.tracks) && q.idx < q.tracks.length - 1) {
          const nextId = q.tracks[q.idx + 1];
          window.__playTrackFromQueue = true;
          try { window.playTrack(nextId, q.source); } finally { window.__playTrackFromQueue = false; }
        }
      }); } catch(_){}
      // 진행도 동기화 (Chromium 만 — iOS Safari 도 점차 지원 중)
      try {
        if ('setPositionState' in navigator.mediaSession && audioElement.duration && !isNaN(audioElement.duration)) {
          navigator.mediaSession.setPositionState({
            duration: audioElement.duration,
            playbackRate: audioElement.playbackRate || 1,
            position: audioElement.currentTime || 0
          });
        }
      } catch(_) {}
    }
  } catch (e) { console.warn('[mediaSession]', e); }

  const icon = playBtn.querySelector('i');
  icon.className = 'ri-pause-circle-fill';

  // Audio src change — 이전 play() promise abort 방지 차원에서 pause 후 src 교체
  try { audioElement.pause(); } catch (_) {}
  audioElement.src = track.audioUrl;
  // 트랙 ID 보존 (race 방지 — 빠른 연속 클릭 시 마지막 트랙만 재생)
  const intendedId = track.id;
  audioElement._intendedId = intendedId;
  const playPromise = audioElement.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(e => {
      // AbortError는 src 변경 시 정상 — 사용자가 빠르게 다른 트랙 클릭한 경우
      if (e && (e.name === 'AbortError' || /aborted|interrupt/i.test(e.message || ''))) return;
      // 오토플레이 정책 차단(NotAllowedError)은 조용히 — 다음 사용자 제스처에 재생됨
      if (e && e.name === 'NotAllowedError') return;
      // 같은 트랙 의도로 시작했을 때만 진짜 에러로 표시 (404/디코드 등 소스 실패)
      if (audioElement._intendedId === intendedId) {
        console.warn('[playTrack] failed:', e.message || e);
        if (typeof showToast === 'function') showToast(_t('이 곡을 재생할 수 없어요 · 잠시 후 다시 시도해주세요', "Can't play this track · try again later"));
      }
    });
  }
}

function togglePlay() {
  const icon = playBtn.querySelector('i');
  if (audioElement.paused) {
    audioElement.play();
    icon.className = 'ri-pause-circle-fill';
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; } catch(_){}
  } else {
    audioElement.pause();
    icon.className = 'ri-play-circle-fill';
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; } catch(_){}
  }
  if (typeof window.syncNoteTrackThumbIcons === 'function') window.syncNoteTrackThumbIcons();
}

function updateProgress() {
  if (window.__seeking) return;   // 드래그(스크럽) 중엔 스크러버가 직접 미리보기 — 덮어쓰기 방지
  const { duration, currentTime } = audioElement;
  const progressPercent = (currentTime / duration) * 100;

  document.getElementById('progress-fill').style.width = `${progressPercent}%`;

  document.getElementById('time-current').innerText = formatTime(currentTime);
  if (duration) {
    document.getElementById('time-total').innerText = formatTime(duration);
  }
  // 풀스크린 카드 진행바/시간도 동기화
  const _pf = document.getElementById('pfs-fill');
  if (_pf) _pf.style.width = `${progressPercent || 0}%`;
  const _pc = document.getElementById('pfs-cur'); if (_pc) _pc.innerText = formatTime(currentTime);
  const _pt = document.getElementById('pfs-tot'); if (_pt && duration) _pt.innerText = formatTime(duration);
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// 시크바 = 스포티파이식 드래그 스크러버 (터치/마우스). 탭·드래그 모두 시크. 미니바 + 풀스크린 둘 다.
function _attachSeek(barEl){
  if (!barEl || barEl.__seek) return; barEl.__seek = true;
  var fill = barEl.querySelector('.progress-fill, .pfs-fill');
  function fracAt(cx){ var r=barEl.getBoundingClientRect(); return r.width>0 ? Math.max(0, Math.min(1, (cx-r.left)/r.width)) : 0; }
  function preview(f){ if(fill) fill.style.width=(f*100)+'%'; var d=audioElement.duration; if(d&&isFinite(d)){ var t=formatTime(f*d); var a=document.getElementById('time-current'); if(a)a.innerText=t; var b=document.getElementById('pfs-cur'); if(b)b.innerText=t; } }
  var down=false;
  barEl.addEventListener('pointerdown', function(e){ if(e.button&&e.button!==0) return; down=true; window.__seeking=true; barEl.classList.add('seeking'); preview(fracAt(e.clientX)); e.preventDefault(); });
  window.addEventListener('pointermove', function(e){ if(down) preview(fracAt(e.clientX)); });
  window.addEventListener('pointerup', function(e){ if(!down) return; down=false; barEl.classList.remove('seeking'); var f=fracAt(e.clientX); preview(f); var d=audioElement.duration; if(d&&isFinite(d)) audioElement.currentTime=f*d; window.__seeking=false; });
  window.addEventListener('pointercancel', function(){ if(!down) return; down=false; barEl.classList.remove('seeking'); window.__seeking=false; });
}
_attachSeek(document.getElementById('progress-bar'));
_attachSeek(document.querySelector('#player-fs .pfs-track'));

// Boot
window.onload = init;

// ===================== ADMIN DASHBOARD =====================

window.renderAdmin = async function () {
  // 부팅 직후엔 auth 가 아직 도착 안 했을 수 있음 — 잠깐 (최대 2초) 기다렸다 검사.
  // 그래도 없으면 진짜 로그인 필요. 이게 빠지면 직접 URL 접근/새로고침 케이스에서
  // 권한 없음만 뜨고 영원히 그대로 → 새로고침을 또 해야만 정상.
  let user = window.__currentUser || window.DB.get().currentUser;
  if (!user) {
    appContent.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-secondary);">로딩 중…</div>`;
    const start = Date.now();
    while (!user && Date.now() - start < 2000) {
      await new Promise(r => setTimeout(r, 100));
      user = window.__currentUser || window.DB.get().currentUser;
      // 사용자가 화면 이동했으면 더 이상 의미 없음 — 빠져나옴
      if (currentView !== 'admin') return;
    }
  }
  if (!user || user.role !== 'admin') {
    appContent.innerHTML = `<h2 style="text-align:center; padding: 100px 0; color: var(--brand-color);">접근 권한이 없습니다.</h2>`;
    return;
  }

  appContent.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-secondary);">로딩 중…</div>`;

  // Per-fetch 5s timeout so one slow/missing endpoint can't lock the page on
  // "로딩 중…". Each promise resolves to a safe default instead of hanging.
  const withTimeout = (p, fallback, ms = 5000) =>
    Promise.race([
      p.catch(e => { console.warn('[admin] fetch err', e); return fallback; }),
      new Promise(r => setTimeout(() => r(fallback), ms))
    ]);

  let recentNotes = [], recentTracks = [], allUsers = [];
  let overallStats = null, topTracks = [];
  // ⚡ Admin 데이터와 Analytics 데이터를 따로 await 하면 (5s + 5s) 최악 10초
  //    걸림 → 둘을 한 번에 병렬로 받아서 최악 5초로 줄임. (한번씩 느린 원인)
  const adminReady = !!window.Admin;
  const anaReady   = !!window.Analytics;
  const [
    _notes, _tracks, _users, _overall, _top
  ] = await Promise.all([
    adminReady ? withTimeout(window.Admin.listRecentNotes(50), []) : Promise.resolve([]),
    adminReady ? withTimeout(window.Admin.listRecentTracks(50), []) : Promise.resolve([]),
    adminReady && window.Admin.listUsers ? withTimeout(window.Admin.listUsers(200), []) : Promise.resolve([]),
    anaReady ? withTimeout(window.Analytics.getAdminOverall(), null) : Promise.resolve(null),
    anaReady ? withTimeout(window.Analytics.getAdminTopTracks(10), []) : Promise.resolve([])
  ]);
  recentNotes = _notes; recentTracks = _tracks; allUsers = _users;
  overallStats = _overall; topTracks = _top;

  // User may have navigated away while we waited for Supabase — bail before
  // overwriting whatever page they're now on.
  if (currentView !== 'admin') return;

  const renderTrackRow = (t) => `
    <div class="admin-row">
      <img src="${t.cover || ''}" alt="" class="admin-row-cover">
      <div class="admin-row-body">
        <div class="admin-row-title">${(t.title||'').replace(/</g,'&lt;')}</div>
        <div class="admin-row-meta">
          ${(t.artist||'').replace(/</g,'&lt;')} · ${formatFullDate(t.createdAt)}
          · ${t.version || 'final'}
        </div>
      </div>
      <button class="admin-zip-btn" data-zip-id="${t.id}" onclick="adminDownloadZip('${t.id}')" title="유통용 ZIP 다운로드"><i class="ri-folder-zip-line"></i> ZIP</button>
      <button class="admin-del-btn" onclick="adminDeleteTrack('${t.id}')"><i class="ri-delete-bin-line"></i> 삭제</button>
    </div>
  `;
  const trackRows = recentTracks.map(renderTrackRow).join('');

  const renderNoteRow = (n) => `
    <div class="admin-row">
      <div class="admin-note-preview" style="background:${(NOTE_COLORS[n.color]||NOTE_COLORS.yellow).bg}; color:${(NOTE_COLORS[n.color]||NOTE_COLORS.yellow).text};">
        ${(n.text||'').replace(/</g,'&lt;').slice(0, 80)}
      </div>
      <div class="admin-row-body">
        <div class="admin-row-meta">
          by ${(n.author||'').replace(/</g,'&lt;')} · ${formatFullDate(n.createdAt)}
        </div>
      </div>
      <button class="admin-del-btn" onclick="adminDeleteNote('${n.id}')"><i class="ri-delete-bin-line"></i> 삭제</button>
    </div>
  `;
  const noteRows = recentNotes.map(renderNoteRow).join('');

  // Stash on window for filter handlers
  window.__adminTracks = recentTracks;
  window.__adminNotes = recentNotes;
  window.__adminRenderTrackRow = renderTrackRow;
  window.__adminRenderNoteRow = renderNoteRow;

  const roleBadge = (role) => {
    // 'listener' role 폐지 — 모두 아티스트로 표시 (admin 만 별도)
    const map = {
      admin:    { bg:'#9C27B0', label:'관리자' },
      artist:   { bg:'#FF9800', label:'아티스트' },
      listener: { bg:'#FF9800', label:'아티스트' }   // legacy → 아티스트로 매핑
    };
    const m = map[role] || map.artist;
    return `<span style="display:inline-block; padding:2px 8px; background:${m.bg}; color:#fff; border-radius:10px; font-size:11px; font-weight:600;">${m.label}</span>`;
  };

  // Provider badge → readable label
  const providerLabel = (p) => {
    const map = { google: 'Google', kakao: 'Kakao', email: '이메일', '': '—' };
    return map[p] || p;
  };
  const esc = (s) => (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // SNS chip icons — only renders ones that have a value
  const snsIcons = (sns) => {
    const items = [
      { key:'instagram', icon:'ri-instagram-line', color:'#E4405F' },
      { key:'youtube',   icon:'ri-youtube-fill',   color:'#FF0000' },
      { key:'tiktok',    icon:'ri-tiktok-fill',    color:'#fff' },
      { key:'twitter',   icon:'ri-twitter-x-fill', color:'#fff' }
    ];
    const present = items.filter(it => sns && sns[it.key]);
    if (!present.length) return '<span style="color:var(--text-secondary); font-size:11px;">SNS 없음</span>';
    return present.map(it =>
      `<span title="${esc(sns[it.key])}" style="color:${it.color}; display:inline-flex; align-items:center; gap:4px; font-size:11px;">
         <i class="${it.icon}"></i>${esc(sns[it.key])}
       </span>`
    ).join('<span style="color:var(--divider); margin:0 4px;">·</span>');
  };

  // Build the row HTML for a single user — used by both initial render and live filtering.
  const renderUserRow = (u) => {
    const isSelf = u.id === user.id;
    const lastSignIn = u.lastSignInAt ? formatFullDate(u.lastSignInAt) : '—';
    const provider = providerLabel(u.provider);
    const hasBio = !!(u.bio && u.bio.trim());
    return `
    <div class="admin-row admin-user-row" data-user-name="${esc((u.name||'').toLowerCase())}" data-user-role="${u.role}">
      <img src="${u.avatar}" alt="" class="admin-row-cover" style="border-radius:50%;">
      <div class="admin-row-body">
        <div class="admin-row-title">
          ${esc(u.name)} ${roleBadge(u.role)}
          ${isSelf ? '<span style="color:var(--text-secondary); font-size:11px; margin-left:6px;">(나)</span>' : ''}
        </div>
        <div class="admin-row-meta">
          ${u.email ? `<span title="이메일">📧 ${esc(u.email)}</span> · ` : ''}
          가입 ${formatFullDate(u.createdAt)} · 마지막 로그인 ${lastSignIn} · ${provider} · 트랙 ${u.trackCount} · 포스트잇 ${u.noteCount}
        </div>
        <div class="admin-user-extra" id="adm-extra-${u.id}" style="display:none; margin-top:8px; padding-top:8px; border-top:1px dashed var(--divider);">
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">📝 자기소개</div>
          <div style="font-size:13px; margin-bottom:8px; white-space:pre-wrap;">${hasBio ? esc(u.bio) : '<span style="color:var(--text-secondary);">(없음)</span>'}</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">🔗 SNS</div>
          <div style="display:flex; flex-wrap:wrap; gap:2px; align-items:center;">${snsIcons(u.sns)}</div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
        <select onchange="adminSetUserRole('${u.id}', this.value, this)" ${isSelf ? 'disabled' : ''} style="background:#222; color:#fff; border:1px solid var(--divider); border-radius:6px; padding:6px 8px; font-size:12px;">
          <option value="artist" ${(u.role==='artist' || u.role==='listener')?'selected':''}>아티스트</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>관리자</option>
        </select>
        <button class="admin-chip" onclick="adminToggleUserExtra('${u.id}', this)" style="padding:4px 10px; font-size:11px;">상세 ▼</button>
      </div>
    </div>`;
  };

  const userRows = allUsers.map(renderUserRow).join('');

  // Stash list + renderer on window so the filter handler can access them after innerHTML wipes scope
  window.__adminUsers = allUsers;
  window.__adminRenderUserRow = renderUserRow;

  // ── 통계 섹션 (Analytics) ───────────────────────────────────
  // Build a quick KPI grid + top tracks table. Both are computed from the
  // play_events / note_views tables via admin_overall_stats / admin_top_tracks RPCs.
  const _fmtSec = (s) => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  };
  // Map track_id → track for showing titles
  const _trackById = new Map(recentTracks.map(t => [t.id, t]));
  const topTracksRows = (topTracks || []).map((row, i) => {
    const tr = _trackById.get(row.track_id);
    const title = tr ? tr.title : ('(id ' + (row.track_id || '').slice(0, 8) + '…)');
    const artist = tr ? (tr.artist || '') : '';
    return `
      <div class="stats-row">
        <span class="stats-rank">${i + 1}</span>
        <div class="stats-row-body">
          <div class="stats-row-title">${(title || '').replace(/</g,'&lt;')}</div>
          <div class="stats-row-meta">${(artist || '').replace(/</g,'&lt;')}</div>
        </div>
        <div class="stats-row-num"><strong>${row.plays}</strong><small>재생</small></div>
        <div class="stats-row-num"><strong>${row.listeners_30s}</strong><small>30초↑</small></div>
      </div>
    `;
  }).join('');
  const statsSectionHtml = `
    <div class="admin-section">
      <h2 class="admin-section-title">
        <i class="ri-bar-chart-2-fill" style="color:#4FC3F7;"></i> 전체 통계
      </h2>
      ${overallStats ? `
        <div class="stats-kpi-grid">
          <div class="stats-kpi"><div class="stats-kpi-num">${overallStats.total_plays || 0}</div><div class="stats-kpi-label">총 재생수</div></div>
          <div class="stats-kpi"><div class="stats-kpi-num">${overallStats.total_listeners || 0}</div><div class="stats-kpi-label">총 청취자(고유)</div></div>
          <div class="stats-kpi"><div class="stats-kpi-num">${overallStats.total_listeners_30s || 0}</div><div class="stats-kpi-label">30초+ 청취자</div></div>
          <div class="stats-kpi"><div class="stats-kpi-num">${overallStats.total_note_views || 0}</div><div class="stats-kpi-label">포스트잇 조회수</div></div>
          <div class="stats-kpi"><div class="stats-kpi-num">${overallStats.events_today || 0}</div><div class="stats-kpi-label">오늘 활동</div></div>
        </div>
      ` : '<div class="admin-empty">통계 데이터 아직 없어요 (SQL 마이그레이션 적용 후 발생하는 이벤트부터 집계됩니다)</div>'}
      ${topTracksRows ? `
        <h3 style="margin: 22px 0 10px; font-size: 14px; color: var(--text-secondary);">🔥 인기 트랙 TOP ${topTracks.length}</h3>
        <div class="stats-rows">${topTracksRows}</div>
      ` : ''}
    </div>
  `;

  appContent.innerHTML = `
    <div style="max-width: 1000px; margin: 0 auto; padding: 32px;">
      <h1 style="margin-bottom: 12px;"><i class="ri-dashboard-2-fill text-brand"></i> 관리자 대시보드</h1>
      <p style="color: var(--text-secondary); margin-bottom: 32px;">사용자·트랙·포스트잇을 관리할 수 있어요. 삭제·역할변경은 되돌릴 수 없으니 주의하세요.</p>

      ${statsSectionHtml}

      <div class="admin-section" style="margin-top: 40px;">
        <h2 class="admin-section-title">
          <i class="ri-user-line" style="color:#64B5F6;"></i> 사용자 목록
          <span class="admin-count" id="admin-user-count">${allUsers.length}</span>
        </h2>
        ${allUsers.length ? `
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; align-items:center;">
          <input type="text" id="admin-user-search" placeholder="이름으로 검색…" oninput="adminFilterUsers()"
                 style="flex:1; min-width:200px; background:#222; color:#fff; border:1px solid var(--divider); border-radius:6px; padding:8px 12px; font-size:13px;">
          <div id="admin-role-chips" style="display:flex; gap:6px;">
            <button type="button" data-role-filter="all"      class="admin-chip active" onclick="adminFilterByRole('all', this)">전체</button>
            <button type="button" data-role-filter="admin"    class="admin-chip"        onclick="adminFilterByRole('admin', this)">관리자</button>
            <button type="button" data-role-filter="artist"   class="admin-chip"        onclick="adminFilterByRole('artist', this)">아티스트</button>
          </div>
        </div>
        ` : ''}
        <div class="admin-list" id="admin-user-list">
          ${allUsers.length ? userRows : '<div class="admin-empty">사용자 없음 (RLS 정책 미적용 가능성)</div>'}
        </div>
        <div id="admin-user-empty" class="admin-empty" style="display:none;">검색 결과 없음</div>
      </div>

      <div class="admin-section" style="margin-top: 40px;">
        <h2 class="admin-section-title">
          <i class="ri-music-2-line" style="color:var(--brand-color);"></i> 최근 트랙
          <span class="admin-count" id="admin-track-count">${recentTracks.length}</span>
        </h2>
        ${recentTracks.length ? `
        <input type="text" id="admin-track-search" placeholder="제목·아티스트로 검색…" oninput="adminFilterTracks()"
               style="width:100%; background:#222; color:#fff; border:1px solid var(--divider); border-radius:6px; padding:8px 12px; font-size:13px; margin-bottom:14px;">
        ` : ''}
        <div class="admin-list" id="admin-track-list">
          ${recentTracks.length ? trackRows : '<div class="admin-empty">최근 업로드된 트랙 없음</div>'}
        </div>
        <div id="admin-track-empty" class="admin-empty" style="display:none;">검색 결과 없음</div>
      </div>

      <div class="admin-section" style="margin-top: 40px;">
        <h2 class="admin-section-title">
          <i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> 최근 포스트잇
          <span class="admin-count" id="admin-note-count">${recentNotes.length}</span>
        </h2>
        ${recentNotes.length ? `
        <input type="text" id="admin-note-search" placeholder="내용·작성자로 검색…" oninput="adminFilterNotes()"
               style="width:100%; background:#222; color:#fff; border:1px solid var(--divider); border-radius:6px; padding:8px 12px; font-size:13px; margin-bottom:14px;">
        ` : ''}
        <div class="admin-list" id="admin-note-list">
          ${recentNotes.length ? noteRows : '<div class="admin-empty">최근 포스트잇 없음</div>'}
        </div>
        <div id="admin-note-empty" class="admin-empty" style="display:none;">검색 결과 없음</div>
      </div>
    </div>
  `;
};

window.adminFilterTracks = function() {
  const tracks = window.__adminTracks || [];
  const render = window.__adminRenderTrackRow;
  if (!render) return;
  const q = (document.getElementById('admin-track-search')?.value || '').trim().toLowerCase();
  const filtered = !q ? tracks : tracks.filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.artist || '').toLowerCase().includes(q)
  );
  const listEl  = document.getElementById('admin-track-list');
  const emptyEl = document.getElementById('admin-track-empty');
  const countEl = document.getElementById('admin-track-count');
  if (listEl)  listEl.innerHTML = filtered.map(render).join('');
  if (emptyEl) emptyEl.style.display = filtered.length ? 'none' : 'block';
  if (countEl) countEl.textContent = filtered.length === tracks.length ? tracks.length : `${filtered.length}/${tracks.length}`;
};

window.adminFilterNotes = function() {
  const notes = window.__adminNotes || [];
  const render = window.__adminRenderNoteRow;
  if (!render) return;
  const q = (document.getElementById('admin-note-search')?.value || '').trim().toLowerCase();
  const filtered = !q ? notes : notes.filter(n =>
    (n.text || '').toLowerCase().includes(q) ||
    (n.author || '').toLowerCase().includes(q)
  );
  const listEl  = document.getElementById('admin-note-list');
  const emptyEl = document.getElementById('admin-note-empty');
  const countEl = document.getElementById('admin-note-count');
  if (listEl)  listEl.innerHTML = filtered.map(render).join('');
  if (emptyEl) emptyEl.style.display = filtered.length ? 'none' : 'block';
  if (countEl) countEl.textContent = filtered.length === notes.length ? notes.length : `${filtered.length}/${notes.length}`;
};

// ── Admin user list filter state ─────────────────────────────
window.__adminUserRoleFilter = 'all';

window.adminFilterUsers = function() {
  const users = window.__adminUsers || [];
  const renderUserRow = window.__adminRenderUserRow;
  if (!renderUserRow) return;

  const q = (document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
  const roleFilter = window.__adminUserRoleFilter || 'all';

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (q && !(u.name || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const listEl  = document.getElementById('admin-user-list');
  const emptyEl = document.getElementById('admin-user-empty');
  const countEl = document.getElementById('admin-user-count');
  if (listEl)  listEl.innerHTML = filtered.map(renderUserRow).join('');
  if (emptyEl) emptyEl.style.display = filtered.length ? 'none' : 'block';
  if (countEl) countEl.textContent = filtered.length === users.length ? users.length : `${filtered.length}/${users.length}`;
};

window.adminToggleUserExtra = function(userId, btnEl) {
  const el = document.getElementById('adm-extra-' + userId);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (btnEl) btnEl.textContent = open ? '상세 ▼' : '닫기 ▲';
};

window.adminFilterByRole = function(role, btnEl) {
  window.__adminUserRoleFilter = role;
  document.querySelectorAll('#admin-role-chips .admin-chip').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  window.adminFilterUsers();
};

window.adminSetUserRole = async function(userId, newRole, selectEl) {
  const prevRole = selectEl ? (selectEl.getAttribute('data-prev') || '') : '';
  if (!confirm(`이 사용자의 역할을 "${newRole}"로 바꿀까요?`)) {
    if (selectEl && prevRole) selectEl.value = prevRole;
    return;
  }
  try {
    await window.Admin.setUserRole(userId, newRole);
    showToast(_t('역할이 변경됐어요', 'Role changed'));
    renderAdmin();
  } catch (e) {
    alert('변경 실패: ' + (e.message || e));
    renderAdmin();
  }
};

window.adminDeleteTrack = async function(id) {
  if (!confirm('이 트랙을 영구 삭제할까요?')) return;
  try {
    await window.Admin.deleteTrack(id);
    if (Array.isArray(window.__tracks)) window.__tracks = window.__tracks.filter(t => t.id !== id);
    showToast(_t('트랙 삭제됨', 'Track deleted'));
    renderAdmin();
  } catch (e) {
    alert('삭제 실패: ' + (e.message || e));
  }
};

// ── Distribution ZIP ─────────────────────────────────────────
// Bundles audio + cover + metadata JSON into a ZIP for handoff to a distributor.
// Admin-only. The actual zip/fetch logic lives in js/distribute.js (window.Distribute).
window.adminDownloadZip = async function(trackId) {
  const t = (window.__tracks || []).find(x => x.id === trackId)
    || (await window.Admin.listRecentTracks(200)).find(x => x.id === trackId);
  if (!t) { alert('트랙을 찾을 수 없습니다.'); return; }
  if (!window.Distribute) { alert('Distribute 모듈이 로드되지 않았어요 (JSZip 또는 js/distribute.js 누락).'); return; }

  const btn = document.querySelector(`[data-zip-id="${trackId}"]`);
  const setBtn = (txt, disabled) => { if (btn) { btn.innerHTML = txt; btn.disabled = !!disabled; } };
  const originalLabel = '<i class="ri-folder-zip-line"></i> ZIP';
  setBtn('<i class="ri-loader-4-line"></i> 준비…', true);

  try {
    const result = await window.Distribute.tryGenerateZipFromUrls(
      {
        artist: t.distArtist || t.artist,
        title: t.title,
        releaseDate: t.releaseDate || '',
        description: t.description,
        tags: t.tags,
        language: '한국어'
      },
      t.cover, t.audioUrl,
      {
        onStage: s => setBtn(
          s === 'fetch' ? '<i class="ri-download-cloud-line"></i> 받는중…'
                        : '<i class="ri-folder-zip-line"></i> 압축…', true),
        onProgress: m => setBtn(`<i class="ri-folder-zip-line"></i> ${m.percent.toFixed(0)}%`, true)
      }
    );
    if (result && result.skipped) {
      alert('ZIP 생성 불가: ' + result.reason);
    } else if (result) {
      showToast(_t(`📦 ${result.name} (${(result.sizeBytes/1048576).toFixed(1)}MB) 다운로드됨`, `📦 ${result.name} (${(result.sizeBytes/1048576).toFixed(1)}MB) downloaded`));
    }
  } catch (e) {
    alert('ZIP 실패: ' + (e.message || e));
  } finally {
    setBtn(originalLabel, false);
  }
};

window.adminDeleteNote = async function(id) {
  if (!confirm('이 포스트잇을 영구 삭제할까요?')) return;
  try {
    await window.Admin.deleteNote(id);
    if (Array.isArray(window.__wallNotes)) window.__wallNotes = window.__wallNotes.filter(n => n.id !== id);
    showToast(_t('포스트잇 삭제됨', 'Note deleted'));
    renderAdmin();
  } catch (e) {
    alert('삭제 실패: ' + (e.message || e));
  }
};

/* =========================================================
   AUTH VIEW
========================================================= */
function renderAuth() {
  const supabaseReady = !!window.supabase && !!window.Auth;
  const notice = supabaseReady
    ? ''
    : `<div style="background:#3a2200; color:#FFB74D; padding:10px 14px; border-radius:6px; font-size:13px; margin-bottom:16px;">
         ⚠️ Supabase 키가 아직 설정되지 않았어요. 관리자가 환경변수를 채우면 정상 동작합니다.
       </div>`;

  appContent.innerHTML = `
    <div style="max-width: 420px; margin: 40px auto;" class="card">
      <h1 style="text-align: center; margin-bottom: 8px;">${_i18n('시작하기', 'Get started')}</h1>
      <p style="text-align:center; color:var(--text-secondary); font-size:13px; margin-bottom: 24px;">
        ${_i18n('가입 없이도 곡 감상은 가능해요.<br>좋아요·댓글·업로드는 로그인이 필요합니다.', 'Listen without an account.<br>Likes, comments, and uploads require sign-in.')}
      </p>
      ${notice}

      <!-- ── Consent ────────────────────────────────────────── -->
      <div style="background:#111; border:1px solid var(--divider); border-radius:8px; padding:14px; margin-bottom:18px;">
        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; font-size:14px; line-height:1.5;">
          <input type="checkbox" id="auth-consent" style="margin-top:3px; flex-shrink:0;">
          <span>
            ${_i18n('<strong>(필수)</strong> 개인정보 수집·이용 및 서비스 이용약관에 동의합니다.', '<strong>(Required)</strong> I agree to privacy collection and the terms of service.')}
            <a href="#" id="show-terms" style="color: var(--brand-color); margin-left:6px; font-size:13px;">${_i18n('자세히 ▼', 'Details ▼')}</a>
          </span>
        </label>
        <div id="terms-detail" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid var(--divider); font-size:12.5px; color:var(--text-secondary); line-height:1.7; max-height:240px; overflow-y:auto;">
          <strong style="color:var(--brand-color);">개인정보 수집·이용 동의</strong><br>
          • 수집 항목: 이메일, 닉네임, 프로필 사진<br>
          • 이용 목적: 회원 식별 및 서비스 제공 (곡 업로드/댓글/팔로우 등)<br>
          • 보관 기간: 회원 탈퇴 시까지 (탈퇴 즉시 파기)<br>
          • 동의 거부 시 회원 가입이 제한됩니다.<br><br>
          <strong style="color:var(--brand-color);">서비스 이용약관 (요약)</strong><br>
          <strong>제1조</strong> 본 약관은 본 플랫폼 이용에 관한 권리·의무를 규정합니다.<br>
          <strong>제2조 (음원 권리)</strong> 업로더는 창작물에 대한 모든 저작권을 소유하며, 본 플랫폼은 플랫폼 내 스트리밍·공유를 위한 비독점 권한만 가집니다.<br>
          <strong>제3조 (외부 유통)</strong> 유통 신청 곡은 검수 후 파트너 유통사와 정식 발매 계약으로 연결될 수 있습니다.<br>
          <strong>제4조 (금지 행위)</strong> 타인의 권리 침해, 허위 정보, 욕설/혐오 표현은 사전 통보 없이 삭제될 수 있습니다.
        </div>
      </div>

      <!-- ── Google (primary) ───────────────────────────────── -->
      <button type="button" id="google-btn" disabled style="width:100%; padding:14px; background:#fff; color:#3c4043; border:1px solid #dadce0; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; opacity:0.4; transition: opacity 0.15s; margin-bottom:8px;">
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
        ${_i18n('Google로 계속하기', 'Continue with Google')}
      </button>

      <!-- Kakao login removed — provider not configured. Re-add when OAuth is set up. -->

      <!-- ── Divider ────────────────────────────────────────── -->
      <div style="display:flex; align-items:center; gap:10px; margin:18px 0; color:var(--text-secondary); font-size:12px;">
        <div style="flex:1; height:1px; background:var(--divider);"></div>
        <span>${_i18n('또는', 'or')}</span>
        <div style="flex:1; height:1px; background:var(--divider);"></div>
      </div>

      <!-- ── Magic link ─────────────────────────────────────── -->
      <form id="magic-form">
        <div class="form-group" style="margin-bottom:10px;">
          <input type="email" class="form-control" id="magic-email" required autocomplete="email" placeholder="${_t('이메일 주소', 'Email address')}">
        </div>
        <button type="submit" id="magic-btn" disabled class="btn-primary" style="width:100%; opacity:0.4; transition: opacity 0.15s;">
          ${_i18n('이메일로 로그인 링크 받기', 'Send me a sign-in link')}
        </button>
        <p style="font-size:12px; color:var(--text-secondary); margin-top:8px; text-align:center;">
          ${_i18n('비밀번호 없이 메일에 도착한 링크로 로그인돼요.', 'No password — sign in via the link sent to your email.')}
        </p>
      </form>

      <!-- ── Legacy email+password (collapsed) ──────────────── -->
      <div style="margin-top:24px; padding-top:16px; border-top:1px solid var(--divider); text-align:center;">
        <a href="#" id="show-legacy" style="color:var(--text-secondary); font-size:12px;">${_i18n('기존 비밀번호로 로그인 ▼', 'Sign in with password ▼')}</a>
      </div>
      <form id="legacy-login" style="display:none; margin-top:12px;">
        <div class="form-group">
          <input type="email" class="form-control" id="legacy-email" required autocomplete="email" placeholder="${_t('이메일', 'Email')}">
        </div>
        <div class="form-group">
          <input type="password" class="form-control" id="legacy-pw" required autocomplete="current-password" placeholder="${_t('비밀번호', 'Password')}">
        </div>
        <button type="submit" class="btn-primary" style="width:100%;">${_i18n('로그인', 'Sign in')}</button>
      </form>
    </div>
  `;

  // ── Consent gating ─────────────────────────────────────────
  const consent = document.getElementById('auth-consent');
  const googleBtn = document.getElementById('google-btn');
  const magicBtn = document.getElementById('magic-btn');
  function syncConsent() {
    const ok = consent.checked;
    [googleBtn, magicBtn].forEach(b => {
      if (!b) return;
      b.disabled = !ok;
      b.style.opacity = ok ? '1' : '0.4';
      b.style.cursor = ok ? 'pointer' : 'not-allowed';
    });
  }
  consent.addEventListener('change', syncConsent);

  document.getElementById('show-terms').onclick = (e) => {
    e.preventDefault();
    const det = document.getElementById('terms-detail');
    det.style.display = det.style.display === 'none' ? 'block' : 'none';
    // _t() 를 클릭 시점에 평가 — 현재 언어로 라벨 교체
    e.target.textContent = det.style.display === 'none'
      ? _t('자세히 ▼', 'Details ▼') : _t('접기 ▲', 'Collapse ▲');
  };

  document.getElementById('show-legacy').onclick = (e) => {
    e.preventDefault();
    const f = document.getElementById('legacy-login');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
    e.target.textContent = f.style.display === 'none'
      ? _t('기존 비밀번호로 로그인 ▼', 'Sign in with password ▼')
      : _t('기존 비밀번호로 로그인 ▲', 'Sign in with password ▲');
  };

  // ── 인앱 브라우저(카톡/인스타 등) 감지 — 구글 OAuth 는 인앱 웹뷰에서 차단됨(엑세스 거부) ──
  window._inAppBrowser = function () {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (/kakaotalk/.test(ua)) return 'kakaotalk';
    if (/instagram/.test(ua)) return 'instagram';
    if (/fban|fbav|fb_iab/.test(ua)) return 'facebook';
    if (/line\//.test(ua)) return 'line';
    if (/naver\(|naver\//.test(ua) || /whale/.test(ua)) return 'naver';
    if (/daumapps/.test(ua)) return 'daum';
    if (/band\//.test(ua)) return 'band';
    if (/; wv\)/.test(ua)) return 'webview';  // Android 일반 웹뷰
    return null;
  };
  window._openInExternalBrowser = function () {
    const app = window._inAppBrowser();
    const url = window.location.href;
    if (app === 'kakaotalk') { window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url); return true; }
    if (app === 'line') { window.location.href = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'openExternalBrowser=1'; return true; }
    try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (_) {}
    return false;  // 자동 탈출 불가 — 안내문으로 처리
  };
  function _showInAppLoginHelp(app) {
    const names = { kakaotalk: '카카오톡', instagram: '인스타그램', facebook: '페이스북', line: '라인', naver: '네이버 앱', daum: '다음 앱', band: '밴드', webview: '인앱 브라우저' };
    const nm = names[app] || '인앱 브라우저';
    const canEscape = (app === 'kakaotalk' || app === 'line');
    const ex = document.getElementById('inapp-login-help'); if (ex) ex.remove();
    const ov = document.createElement('div');
    ov.id = 'inapp-login-help';
    ov.style.cssText = 'position:fixed; inset:0; z-index:7000; background:rgba(0,0,0,0.6); display:flex; align-items:flex-end; justify-content:center;';
    ov.innerHTML = `
      <div style="width:100%; max-width:480px; background:var(--bg-color); border:1px solid var(--divider); border-bottom:none; border-radius:18px 18px 0 0; padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));">
        <div style="font-size:17px; font-weight:800; color:var(--text-primary); margin-bottom:8px;">${nm}에서는 구글 로그인이 막혀요</div>
        <p style="font-size:13.5px; color:var(--text-secondary); line-height:1.5; margin-bottom:16px;">구글 보안 정책상 ${nm} 안의 브라우저에서는 구글 로그인이 차단돼요(엑세스 거부). 아래 방법을 써주세요.</p>
        ${canEscape
          ? `<button id="inapp-open-ext" style="width:100%; padding:13px; background:var(--brand-color); color:#fff; border:none; border-radius:10px; font-weight:800; font-size:15px; cursor:pointer; margin-bottom:10px;"><i class="ri-external-link-line"></i> 크롬/사파리로 열기</button>`
          : `<div style="background:var(--surface-color); border:1px solid var(--divider); border-radius:10px; padding:12px; font-size:13px; color:var(--text-primary); margin-bottom:10px;">오른쪽 위 <b>⋯ 메뉴 → '다른 브라우저로 열기'</b> 로 크롬/사파리에서 열어주세요.</div>`}
        <button id="inapp-use-email" style="width:100%; padding:12px; background:var(--surface-color); color:var(--text-primary); border:1px solid var(--divider); border-radius:10px; font-weight:700; font-size:14px; cursor:pointer; margin-bottom:6px;"><i class="ri-mail-line"></i> 그냥 여기서 이메일로 로그인하기</button>
        <button id="inapp-cancel" style="width:100%; padding:10px; background:none; color:var(--text-secondary); border:none; font-size:13px; cursor:pointer;">닫기</button>
      </div>`;
    document.body.appendChild(ov);
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    const ext = ov.querySelector('#inapp-open-ext'); if (ext) ext.onclick = () => { window._openInExternalBrowser(); };
    ov.querySelector('#inapp-use-email').onclick = () => { ov.remove(); const em = document.getElementById('magic-email'); if (em) { em.focus(); em.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
    ov.querySelector('#inapp-cancel').onclick = () => ov.remove();
  }
  // 인앱이면 구글 버튼 위에 미리 경고 배너
  const _inAppNow = window._inAppBrowser();
  if (_inAppNow && googleBtn && googleBtn.parentNode && !document.getElementById('inapp-banner')) {
    const banner = document.createElement('div');
    banner.id = 'inapp-banner';
    banner.style.cssText = 'background:rgba(255,170,0,0.12); border:1px solid rgba(255,170,0,0.4); color:#ffce7a; border-radius:10px; padding:10px 12px; font-size:12.5px; line-height:1.45; margin-bottom:10px;';
    banner.innerHTML = `<b>⚠️ 인앱 브라우저예요.</b> 구글 로그인이 막혀 있어요 — 아래 <u>이메일 로그인</u>을 쓰거나 외부 브라우저로 열어주세요.`;
    googleBtn.parentNode.insertBefore(banner, googleBtn);
  }

  // ── Google ─────────────────────────────────────────────────
  googleBtn.onclick = async () => {
    if (!supabaseReady) { alert('Supabase 키가 설정되지 않았어요.'); return; }
    if (!consent.checked) { alert('약관 동의가 필요해요.'); return; }
    // 인앱 브라우저면 구글 OAuth 가 막히므로(엑세스 거부) 미리 안내
    const inApp = window._inAppBrowser();
    if (inApp) { _showInAppLoginHelp(inApp); return; }
    const _origGoogleHtml = googleBtn.innerHTML;
    googleBtn.disabled = true;
    googleBtn.innerHTML = '<span>이동 중…</span>';
    try {
      await window.Auth.signInWithGoogle();
    } catch (err) {
      alert('Google 로그인 시작 실패: ' + (err.message || err));
      googleBtn.disabled = false;
      googleBtn.innerHTML = _origGoogleHtml;
    }
  };

  // Kakao login handler removed — button no longer rendered.

  // ── Magic link ─────────────────────────────────────────────
  document.getElementById('magic-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!supabaseReady) { alert('Supabase 키가 설정되지 않았어요.'); return; }
    if (!consent.checked) { alert('약관 동의가 필요해요.'); return; }
    const email = document.getElementById('magic-email').value.trim();
    magicBtn.disabled = true;
    magicBtn.textContent = '메일 보내는 중…';
    try {
      await window.Auth.signInWithMagicLink(email);
      magicBtn.textContent = '✅ 메일을 확인해주세요';
      showToast(_t(`${email} 로 로그인 링크를 보냈어요. 메일함을 확인해주세요!`, `Sent a sign-in link to ${email}. Check your inbox!`));
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/rate limit|too many/i.test(msg)) {
        alert('메일을 너무 자주 보냈어요. 잠시 후 다시 시도해주세요.');
      } else {
        alert('메일 발송 실패: ' + msg);
      }
      magicBtn.disabled = false;
      magicBtn.textContent = '이메일로 로그인 링크 받기';
    }
  };

  // ── Legacy email+password (existing accounts only) ─────────
  document.getElementById('legacy-login').onsubmit = async (e) => {
    e.preventDefault();
    if (!supabaseReady) { alert('Supabase 키가 설정되지 않았어요.'); return; }
    const email = document.getElementById('legacy-email').value.trim();
    const password = document.getElementById('legacy-pw').value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '로그인 중...';
    try {
      await window.Auth.signIn({ email, password });
      updateHeaderAuth();
      renderSidebarPlaylists();
      showToast(_t('다시 만나서 반가워요! 🎵', 'Welcome back! 🎵'));
      navigateTo('shapes');
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/invalid login credentials/i.test(msg)) {
        alert('이메일 또는 비밀번호가 맞지 않아요.');
      } else {
        alert('로그인 실패: ' + msg);
      }
    } finally {
      btn.disabled = false; btn.textContent = '로그인';
    }
  };
}

// ===================== TRACK SEGMENT HEATMAP =====================
// Toggle (open/close) the per-segment heatmap below a track row on /stats.
// Buckets are 5s wide (matches the analytics heartbeat).
window.toggleTrackSegments = async function (trackId, rowEl, bucketSec) {
  if (!rowEl) return;
  bucketSec = bucketSec || 15;  // default to 15s buckets — comfortable read
  // If already open, just close.
  const next = rowEl.nextElementSibling;
  if (next && next.classList && next.classList.contains('stats-track-segments')
      && next.dataset.trackId === trackId) {
    next.remove();
    rowEl.classList.remove('open');
    return;
  }
  // Close any other open expansion first
  document.querySelectorAll('.stats-track-segments').forEach(el => el.remove());
  document.querySelectorAll('.stats-row-track.open').forEach(el => el.classList.remove('open'));

  // Insert loading placeholder
  const wrap = document.createElement('div');
  wrap.className = 'stats-track-segments';
  wrap.dataset.trackId = trackId;
  wrap.dataset.bucketSec = String(bucketSec);
  wrap.innerHTML = '<div class="seg-loading">분석 중…</div>';
  rowEl.insertAdjacentElement('afterend', wrap);
  rowEl.classList.add('open');

  await _renderSegmentHeatmap(wrap, trackId, bucketSec);
};

// Re-render the heatmap inside the expanded wrap at a different bucket size.
// Called by the 5초 / 15초 / 30초 selector buttons.
window.changeSegmentBucket = async function (btn, bucketSec) {
  const wrap = btn.closest('.stats-track-segments');
  if (!wrap) return;
  const trackId = wrap.dataset.trackId;
  if (!trackId) return;
  wrap.dataset.bucketSec = String(bucketSec);
  await _renderSegmentHeatmap(wrap, trackId, bucketSec);
};

// Shared renderer for the segment heatmap. Builds the bucket tabs +
// continuous bar chart + peak-segment caption inside the given wrap.
async function _renderSegmentHeatmap(wrap, trackId, bucketSec) {
  if (!wrap || !wrap.isConnected) return;
  wrap.innerHTML = '<div class="seg-loading">분석 중…</div>';

  let segments = [];
  try {
    if (window.Analytics && window.Analytics.getTrackSegments) {
      segments = await window.Analytics.getTrackSegments(trackId, bucketSec);
    }
  } catch (e) { console.warn('[segments]', e); }

  if (!wrap.isConnected) return;

  const bucketTabs = `
    <div class="seg-bucket-tabs">
      ${[5, 15, 30].map(s => `
        <button type="button" class="seg-bucket-btn ${s === bucketSec ? 'active' : ''}"
                onclick="event.stopPropagation(); changeSegmentBucket(this, ${s})">
          ${s}초
        </button>
      `).join('')}
    </div>
  `;

  if (!segments || segments.length === 0) {
    wrap.innerHTML = `
      ${bucketTabs}
      <div class="seg-empty">아직 청취 데이터가 없어요. (누군가 들으면 ${bucketSec}초 단위로 집계돼요)</div>
    `;
    return;
  }

  const bucketMap = new Map(segments.map(s => [s.bucket_start, s]));
  const maxBucket = Math.max(...segments.map(s => s.bucket_start));
  const maxListeners = Math.max(...segments.map(s => s.listeners), 1);

  // Label cadence: every 30s no matter the bucket size (avoids crowded labels at 5s).
  const labelStep = 30;

  const bars = [];
  for (let b = 0; b <= maxBucket; b += bucketSec) {
    const s = bucketMap.get(b);
    const listeners = s ? s.listeners : 0;
    const pct = Math.round((listeners / maxListeners) * 100);
    const m = Math.floor(b / 60), r = b % 60;
    const tlabel = `${m}:${r < 10 ? '0' : ''}${r}`;
    const showLabel = (b % labelStep === 0);
    bars.push(`
      <div class="segment-bar" title="${tlabel} → ${listeners}명 청취">
        <div class="segment-bar-fill" style="height:${pct}%; background: hsl(${200 + Math.round(pct/2)}, 80%, ${Math.max(30, 30 + Math.round(pct/3))}%);"></div>
        ${showLabel ? `<div class="segment-bar-label">${tlabel}</div>` : ''}
      </div>
    `);
  }

  // Peak segment caption
  let peakBucket = 0, peakListeners = 0;
  segments.forEach(s => { if (s.listeners > peakListeners) { peakListeners = s.listeners; peakBucket = s.bucket_start; } });
  const pm = Math.floor(peakBucket / 60), pr = peakBucket % 60;
  const peakLabel = `${pm}:${pr < 10 ? '0' : ''}${pr}`;

  wrap.innerHTML = `
    ${bucketTabs}
    <div class="seg-title">
      📈 구간별 청취 (${bucketSec}초 단위) · 가장 많이 들은 구간: <strong>${peakLabel}</strong> (${peakListeners}명)
    </div>
    <div class="segment-heatmap">${bars.join('')}</div>
    <div class="seg-note">💡 막대 높이 = 그 ${bucketSec}초 구간을 들은 사람 수 · 마우스 올리면 정확한 숫자</div>
  `;
}

// ===================== MY STATS PAGE (/stats) =====================
// Fetches the current user's analytics and fills the element identified by
// containerId. Used by the /stats route AND by the 통계 tab on the artist
// page (self only). Containers should be empty divs.
window.mountMyStatsInto = async function (containerId) {
  const mount = document.getElementById(containerId);
  if (!mount) return;
  mount.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-secondary);">통계 불러오는 중…</div>`;

  const user = window.__currentUser || (window.DB.get() && window.DB.get().currentUser);
  if (!user) { mount.innerHTML = '<div class="admin-empty">로그인이 필요해요.</div>'; return; }

  let myTrackStats = [];
  let myNotesViews = [];
  try {
    if (window.Analytics) {
      [myTrackStats, myNotesViews] = await Promise.all([
        window.Analytics.getMyTracksStats(),
        window.Analytics.getMyNotesViews()
      ]);
    }
  } catch (e) { console.warn('[stats] fetch', e); }

  // User may have navigated away or closed the tab — bail
  const mount2 = document.getElementById(containerId);
  if (!mount2) return;

  const db = window.DB.get();
  const myTracks = (db.tracks || []).filter(t => t && t.artist === user.name);
  const myNotes  = (db.notes  || []).filter(n => n && n.author === user.name);

  const trackStatsMap = new Map((myTrackStats || []).map(r => [r.track_id, r]));
  const noteViewsMap  = new Map((myNotesViews  || []).map(r => [r.note_id, r.views]));

  let totalPlays = 0, totalListeners30 = 0;
  (myTrackStats || []).forEach(r => {
    totalPlays      += r.plays_total || 0;
    totalListeners30 += r.listeners_30s || 0;
  });
  const totalNoteViews = (myNotesViews || []).reduce((s, r) => s + (r.views || 0), 0);

  const trackRows = myTracks.map(t => {
    const s = trackStatsMap.get(t.id);
    const plays = s ? s.plays_total : 0;
    const uniq  = s ? s.unique_listeners : 0;
    const l30   = s ? s.listeners_30s : 0;
    const avg   = s ? Math.round(Number(s.avg_listened_sec || 0)) : 0;
    return `
      <div class="stats-row stats-row-track" data-track-id="${t.id}" onclick="toggleTrackSegments('${t.id}', this)" title="구간별 청취 보기">
        <img src="${t.cover || ''}" alt="" class="stats-row-cover" loading="lazy">
        <div class="stats-row-body">
          <div class="stats-row-title">${(t.title || '').replace(/</g,'&lt;')}</div>
          <div class="stats-row-meta">${(t.version || '').replace(/</g,'&lt;')}</div>
        </div>
        <div class="stats-row-num"><strong>${plays}</strong><small>재생</small></div>
        <div class="stats-row-num"><strong>${uniq}</strong><small>고유</small></div>
        <div class="stats-row-num"><strong>${l30}</strong><small>30초↑</small></div>
        <div class="stats-row-num"><strong>${window.Analytics ? window.Analytics.fmtSeconds(avg) : avg+'s'}</strong><small>평균</small></div>
        <span class="stats-expand-chev"><i class="ri-arrow-down-s-line"></i></span>
      </div>
    `;
  }).join('');

  const sortedNotes = myNotes.slice().sort((a, b) => (noteViewsMap.get(b.id) || 0) - (noteViewsMap.get(a.id) || 0));
  const noteRows = sortedNotes.map(n => {
    const c = (typeof NOTE_COLORS !== 'undefined' && NOTE_COLORS[n.color]) || { bg:'#FFE082', text:'#3E2723' };
    const text = (n.text || '').replace(/</g,'&lt;').slice(0, 80);
    const views = noteViewsMap.get(n.id) || 0;
    return `
      <div class="stats-row stats-row-note" onclick="openNoteDetail('${n.id}')">
        <div class="stats-note-thumb" style="background:${c.bg}; color:${c.text};">${text}</div>
        <div class="stats-row-body">
          <div class="stats-row-meta">${formatFullDate ? formatFullDate(n.createdAt) : (n.createdAt || '').slice(0,10)}</div>
        </div>
        <div class="stats-row-num"><strong>${views}</strong><small>조회</small></div>
      </div>
    `;
  }).join('');

  mount2.innerHTML = `
    <p style="color: var(--text-secondary); margin-bottom: 18px; font-size: 13px;">
      내 트랙이 얼마나 재생됐는지, 내 포스트잇이 몇 번 열렸는지 볼 수 있어요. 익명 방문자도 포함돼요.
    </p>
    <div class="stats-kpi-grid" style="margin-bottom: 24px;">
      <div class="stats-kpi"><div class="stats-kpi-num">${totalPlays}</div><div class="stats-kpi-label">내 트랙 총 재생수</div></div>
      <div class="stats-kpi"><div class="stats-kpi-num">${totalListeners30}</div><div class="stats-kpi-label">30초+ 청취 (고유)</div></div>
      <div class="stats-kpi"><div class="stats-kpi-num">${totalNoteViews}</div><div class="stats-kpi-label">내 포스트잇 조회수</div></div>
      <div class="stats-kpi"><div class="stats-kpi-num">${myTracks.length}</div><div class="stats-kpi-label">내 트랙 수</div></div>
      <div class="stats-kpi"><div class="stats-kpi-num">${myNotes.length}</div><div class="stats-kpi-label">내 포스트잇 수</div></div>
    </div>

    <div class="admin-section">
      <h2 class="admin-section-title">
        <i class="ri-music-2-line" style="color:var(--brand-color);"></i> 트랙별 통계
        <span class="admin-count">${myTracks.length}</span>
      </h2>
      ${trackRows ? `<p style="font-size:12px; color:var(--text-secondary); margin: -4px 0 10px;">트랙 행을 누르면 구간별 청취 그래프가 펼쳐져요 📈</p>` : ''}
      ${trackRows
        ? `<div class="stats-rows">${trackRows}</div>`
        : '<div class="admin-empty">업로드한 트랙이 없어요.</div>'}
    </div>

    <div class="admin-section" style="margin-top: 28px;">
      <h2 class="admin-section-title">
        <i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> 포스트잇별 조회수
        <span class="admin-count">${myNotes.length}</span>
      </h2>
      ${noteRows
        ? `<div class="stats-rows">${noteRows}</div>`
        : '<div class="admin-empty">아직 작성한 포스트잇이 없어요.</div>'}
    </div>

    <p style="margin-top: 20px; font-size: 11px; color: var(--text-secondary); line-height: 1.6;">
      🔒 개별 방문자 정보(누가 봤는지)는 저장하지 않아요. 카운트만 익명으로 집계됩니다.
    </p>
  `;
};

// /stats route — kept as a fallback / shareable URL. The primary entry
// point for stats is now the "통계" tab on the artist page (self only).
window.renderStats = async function () {
  const user = window.__currentUser || (window.DB.get() && window.DB.get().currentUser);
  if (!user) { navigateTo('auth'); return; }
  appContent.innerHTML = `
    <div style="max-width: 1000px; margin: 0 auto; padding: 32px 28px 60px;">
      <h1 style="margin-bottom: 6px;"><i class="ri-bar-chart-2-fill" style="color:#4FC3F7;"></i> 내 활동 통계</h1>
      <div id="stats-route-mount"></div>
    </div>
  `;
  await window.mountMyStatsInto('stats-route-mount');
};

// ===================== 응원 (CHEER) — donation-style message =====================
// LocalStorage cache of track IDs the user has already cheered, so the
// "한 번만" rule gives instant feedback without a network round-trip.
function _getCheeredSet() {
  try { return new Set(JSON.parse(localStorage.getItem('offstage_cheered') || '[]')); }
  catch (_) { return new Set(); }
}
function _addCheered(trackId) {
  const s = _getCheeredSet();
  s.add(trackId);
  try { localStorage.setItem('offstage_cheered', JSON.stringify([...s])); } catch (_) {}
}
window.hasCheeredLocal = function (trackId) {
  return _getCheeredSet().has(trackId);
};

// Open the cheer composer. Shows the once-only toast if already cheered.
window.openCheerModal = function (trackId, trackTitle, artistName) {
  const user = window.__currentUser || (window.DB.get() && window.DB.get().currentUser);
  if (!user) {
    showToast(_t('로그인하고 응원해보세요 💌', 'Sign in to send some love 💌'));
    navigateTo('auth');
    return;
  }
  // Already cheered (local cache) → just a toast, no modal
  if (_getCheeredSet().has(trackId)) {
    showToast(_t('이미 응원했어요 💝', 'You already cheered 💝'));
    return;
  }
  const existing = document.getElementById('cheer-modal');
  if (existing) existing.remove();

  const safeTitle  = (trackTitle  || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const safeArtist = (artistName  || '아티스트').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const argT = (trackId   || '').replace(/'/g,"\\'");
  const argTi= (trackTitle|| '').replace(/'/g,"\\'");
  const argA = (artistName|| '').replace(/'/g,"\\'");

  const html = `
    <div id="cheer-modal" class="cheer-modal" onclick="if(event.target===this) closeCheerModal()">
      <div class="cheer-modal-card">
        <button class="cheer-modal-close" onclick="closeCheerModal()" aria-label="닫기"><i class="ri-close-line"></i></button>
        <div class="cheer-modal-icon">💌</div>
        <h3 class="cheer-modal-title">${safeArtist}에게 응원 보내기</h3>
        <div class="cheer-modal-track"><i class="ri-music-2-line"></i> 「${safeTitle}」</div>
        <p class="cheer-modal-hint">딱 한 번 보낼 수 있어요.<br>마음을 담아 적어주세요 ✨</p>
        <textarea id="cheer-message-input" class="cheer-modal-textarea" maxlength="300" rows="4"
                  placeholder="이 곡 정말 좋아요! 다음 곡도 기대할게요 💛"></textarea>
        <div class="cheer-modal-count"><span id="cheer-char-count">0</span>/300</div>
        <button class="cheer-modal-send" id="cheer-send-btn"
                onclick="submitCheer('${argT}', '${argTi}', '${argA}')">
          💝 응원 보내기
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const ta = document.getElementById('cheer-message-input');
  if (ta) {
    ta.addEventListener('input', () => {
      const c = document.getElementById('cheer-char-count');
      if (c) c.textContent = ta.value.length;
    });
    setTimeout(() => ta.focus(), 80);
  }
  // 아래로 스와이프 → 닫기 (모바일). textarea/버튼은 기본 exclude 라 입력 방해 없음.
  try {
    const _cc = document.querySelector('#cheer-modal .cheer-modal-card');
    const _co = document.getElementById('cheer-modal');
    if (_cc && window._attachSwipeDismiss) window._attachSwipeDismiss(_cc, {
      direction: 'down', backdrop: _co, grabber: false,
      onClose: () => closeCheerModal()
    });
  } catch (_) {}
};

window.closeCheerModal = function () {
  const m = document.getElementById('cheer-modal');
  if (m) m.remove();
};

// 응원 직후 — 지금 보고 있는 곡 상세면 응원 수를 다시 읽어 갱신.
function _sdBumpAfterCheer(trackId) {
  if (!window.__currentSongId || String(window.__currentSongId) !== String(trackId)) return;
  if (!window._sdRefreshSupporters) return;
  setTimeout(function () { try { window._sdRefreshSupporters(trackId); } catch (_) {} }, 250);
}

window.submitCheer = async function (trackId, trackTitle, artistName) {
  const ta = document.getElementById('cheer-message-input');
  const msg = (ta && ta.value || '').trim();
  if (!msg) {
    showToast(_t('응원 메시지를 적어주세요 ✍️', 'Write a cheer message ✍️'));
    if (ta) ta.focus();
    return;
  }
  const btn = document.getElementById('cheer-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = '보내는 중…'; }
  try {
    if (window.Cheers) {
      await window.Cheers.send(trackId, msg);
    } else {
      throw new Error('Cheers 모듈 없음');
    }
    _addCheered(trackId);
    closeCheerModal();
    _showCheerSuccess(artistName);
    _sdBumpAfterCheer(trackId);
  } catch (e) {
    if (e && e.message === 'ALREADY_CHEERED') {
      _addCheered(trackId);
      closeCheerModal();
      showToast(_t('이미 응원했어요 💝', 'You already cheered 💝'));
      _sdBumpAfterCheer(trackId);
    } else {
      console.warn('[cheer] send failed', e && (e.message || e));
      // 'cheers' 테이블 미적용(PGRST205) 등 — 사용자에겐 부드러운 토스트, 상세는 콘솔.
      const _missing = /find the table|does not exist|PGRST205|schema cache/i.test((e && e.message) || '');
      showToast(_missing
        ? _t('응원 기능 준비 중이에요 🙏', 'Cheers coming soon 🙏')
        : _t('응원 전송에 실패했어요. 잠시 후 다시 시도해주세요', 'Cheer failed — please try again'));
      if (btn) { btn.disabled = false; btn.textContent = '💝 응원 보내기'; }
    }
  }
};

// ===================== SONG INFO MODAL (곡 소개 모달) =====================
// 마스터(발매) 카드 커버 클릭 시 뜨는 곡 소개 모달.
// 디자인: 크림 노란 배경, 좌상단 발매일 핑크 칩, 우상단 검정 ✕,
//        큰 제목「..」, 우측 정렬 — 아티스트, 구분선, 본문 설명.
window.openSongInfoModal = function (trackId) {
  if (!trackId) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) { if (typeof showToast === 'function') showToast(_t('곡을 찾을 수 없어요', 'Song not found')); return; }

  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeTitle  = esc(track.title || '제목 없음');
  const safeArtist = esc(track.artist || '');
  const desc       = (track.description || '').trim();
  const safeDesc   = esc(desc).replace(/\n/g, '<br>');

  // 발매일 칩 — track.releaseDate (YYYY-MM-DD) → "발매 · YYYY.MM.DD" 포맷
  const _rel = _t('발매', 'Released');
  const rd = (track.releaseDate || '').trim();
  let badgeText = _rel;
  if (rd && /^\d{4}-\d{2}-\d{2}/.test(rd)) {
    badgeText = _rel + ' · ' + rd.slice(0, 10).replace(/-/g, '.');
  } else if (track.createdAt) {
    try {
      const d = new Date(track.createdAt);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        badgeText = `${_rel} · ${y}.${m}.${dy}`;
      }
    } catch (_) {}
  }

  // 기존 모달이 떠있으면 먼저 닫기
  const prev = document.getElementById('song-info-modal');
  if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

  const modal = document.createElement('div');
  modal.id = 'song-info-modal';
  modal.className = 'song-info-modal';
  modal.innerHTML = `
    <div class="song-info-paper" role="dialog" aria-modal="true">
      <span class="song-info-badge">${esc(badgeText)}</span>
      <button type="button" class="song-info-close" aria-label="닫기" onclick="closeSongInfoModal()">
        <i class="ri-close-line"></i>
      </button>
      <h2 class="song-info-title">「${safeTitle}」</h2>
      <p class="song-info-artist">— ${safeArtist || _t('익명', 'Anonymous')}</p>
      <div class="song-info-divider"></div>
      <div class="song-info-body">${safeDesc || `<em style="opacity:0.5;">${_t('아직 소개글이 없어요.', 'No description yet.')}</em>`}</div>
    </div>
  `;
  // 백드롭 클릭 시 닫기 (모달 내부 클릭은 stop)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSongInfoModal();
  });
  document.body.appendChild(modal);
  // ESC 닫기
  if (!window.__songInfoEscWired) {
    window.__songInfoEscWired = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('song-info-modal')) closeSongInfoModal();
    });
  }
  // 애니메이션을 위해 다음 프레임에 .open 추가
  requestAnimationFrame(() => modal.classList.add('open'));
  // 📱 아래로 스와이프 → 닫기
  const paper = modal.querySelector('.song-info-paper');
  if (paper) window._attachSwipeDismiss(paper, {
    onClose: () => window.closeSongInfoModal(),
    scrollGuard: 'auto', grabber: 'dark', backdrop: modal
  });
};
window.closeSongInfoModal = function () {
  const m = document.getElementById('song-info-modal');
  if (!m) return;
  m.classList.remove('open');
  setTimeout(() => { if (m.parentNode) m.parentNode.removeChild(m); }, 180);
};

// ===================== DEMO WALL MODAL (우리들의 벽 스타일 풀모달) =====================
// 사용자 요청: 데모 카드 탭 → 우리들의 벽 모달 같은 풀-사이즈 노란 포스트잇 모달.
// 위에는 노트 (DEMO 태그 / 제목 / 일지), 아래는 댓글 리스트 + 입력칸.
window.openDemoWallModal = function (trackId) {
  if (!trackId) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) { showToast(_t('곡을 찾을 수 없어요', 'Song not found')); return; }

  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeTitle = esc(track.title || '제목 없음');
  const safeArtist = esc(track.artist || '');
  const safeNote = esc((track.artistNote || '').trim()).replace(/\n/g, '<br>');
  const verLabel = track.isDemo ? (track.versionLabel || 'Demo') : '발매 (Release)';
  const cms = Array.isArray(track.trackComments) ? track.trackComments : [];
  const user = window.__currentUser || (window.DB.get() && window.DB.get().currentUser);
  const canComment = !!user;

  const _myDwmId = (window.__currentUser && window.__currentUser.id) || null;
  const _myDwmName = (window.__currentUser && window.__currentUser.name) || '';
  const cmsHtml = cms.length === 0
    ? `<div class="dwm-empty">${_t('아직 댓글이 없어요 · 첫 댓글을 남겨보세요', 'No comments yet · Be the first')}</div>`
    : cms.map(cm => {
        const isMine = (_myDwmId && cm.authorId && cm.authorId === _myDwmId)
                    || (!cm.authorId && _myDwmName && cm.author === _myDwmName);
        const delBtn = isMine ? `<button class="dwm-cm-del" type="button" onclick="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true); return false;" ontouchend="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true);" title="댓글 삭제" aria-label="댓글 삭제"><i class="ri-close-line"></i></button>` : '';
        return `
          <div class="dwm-cm-line">
            <span class="dwm-cm-arrow">ㄴ</span>
            <span class="dwm-cm-text">${esc(cm.text || '')}</span>
            <span class="dwm-cm-auth">— ${esc(cm.author || '익명')}</span>
            ${delBtn}
          </div>
        `;
      }).join('');

  // Enter 한 번 = 전송. 한글 IME 안전 (_safeEnterSubmit). 버튼 없음.
  const inputHtml = canComment ? `
    <div class="dwm-input-row">
      <input type="text" class="dwm-input" maxlength="200" placeholder="${_t('댓글 남기기…', 'Leave a comment…')}"
             onkeydown="if(event.key==='Enter'){ event.preventDefault(); window._safeEnterSubmit(this, () => submitDemoWallComment('${trackId}')); }">
    </div>
  ` : `<div class="dwm-loginhint">${_t('로그인하면 댓글을 남길 수 있어요', 'Sign in to leave a comment')}</div>`;

  const existing = document.getElementById('demo-wall-modal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', `
    <div id="demo-wall-modal" class="dwm-modal" onclick="if(event.target===this) closeDemoWallModal()">
      <div class="dwm-content dwm-paper">
        <button class="dwm-close" onclick="closeDemoWallModal()" aria-label="닫기"><i class="ri-close-line"></i></button>
        <div class="dwm-postit">
          <div class="dwm-eyebrow"><span class="dwm-verlabel">${verLabel}</span></div>
          <h2 class="dwm-title">「${safeTitle}」</h2>
          ${safeArtist ? `<div class="dwm-artist">— ${safeArtist}</div>` : ''}
          ${safeNote ? `<div class="dwm-divider"></div><div class="dwm-note">${safeNote}</div>` : ''}
        </div>
        <div class="dwm-comments">
          <div class="dwm-comments-title">${_i18n('댓글', 'Comments')} <span class="dwm-cm-count">${cms.length}</span></div>
          <div class="dwm-cm-list" id="dwm-cm-list">${cmsHtml}</div>
          ${inputHtml}
        </div>
      </div>
    </div>
  `);

  // Scroll to latest on open & focus input (PC 만)
  setTimeout(() => {
    const modal = document.getElementById('demo-wall-modal');
    if (!modal) return;
    const list = modal.querySelector('#dwm-cm-list');
    if (list) list.scrollTop = list.scrollHeight;
    const input = modal.querySelector('.dwm-input');
    const isMobile = window.innerWidth <= 768;
    if (input && canComment && !isMobile) input.focus();
    // 📱 아래로 스와이프 → 닫기
    const content = modal.querySelector('.dwm-content');
    if (content) window._attachSwipeDismiss(content, {
      onClose: () => window.closeDemoWallModal(),
      scrollGuard: 'auto', grabber: 'dark', backdrop: modal
    });
  }, 50);
};

window.closeDemoWallModal = function () {
  const m = document.getElementById('demo-wall-modal');
  if (m) m.remove();
};

// 모달 내부 댓글 전송 — optimistic + 모든 곳 sync via _refreshTrackCommentUI
window.submitDemoWallComment = async function (trackId) {
  const modal = document.getElementById('demo-wall-modal');
  if (!modal) return;
  const input = modal.querySelector('.dwm-input');
  const text = (input && input.value || '').trim();
  if (!text) return;

  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) { showToast(_t('곡을 찾을 수 없어요', 'Song not found')); return; }
  const profileName = (window.__currentUser && window.__currentUser.name) || '';
  const authorName = profileName || '익명';
  const myId = (window.__currentUser && window.__currentUser.id) || null;
  const isSupabaseTrack = !!track.__supabase;

  // Optimistic — 임시 ID 로 즉시 cache + DOM (window.__tracks 가 진짜 단일 진실원)
  const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const tempComment = {
    id: tempId, author: authorName, authorId: myId, text,
    createdAt: new Date().toISOString(), __optimistic: true
  };
  if (Array.isArray(window.__tracks)) {
    const tMem = window.__tracks.find(t => t && t.id === trackId);
    if (tMem) {
      if (!Array.isArray(tMem.trackComments)) tMem.trackComments = [];
      tMem.trackComments.push(tempComment);
    }
  }
  if (!Array.isArray(track.trackComments)) track.trackComments = [];
  track.trackComments.push(tempComment);
  try { window.DB.save(db); } catch (_) {}    // localStorage 즉시 반영
  if (input) input.value = '';
  try { _refreshTrackCommentUI(trackId); } catch (_) {}

  // 백그라운드 저장
  let newComment = null;
  try {
    if (isSupabaseTrack && window.Tracks) {
      newComment = await window.Tracks.addComment(trackId, { text, authorName });
    } else {
      newComment = { id: 'tc' + Date.now(), author: authorName, authorId: myId, text, createdAt: new Date().toISOString() };
      // ⚠ DB.addTrackComment 호출 금지 — temp 포함된 localStorage 에 real 을
      //   또 push 해서 [temp, real] 중복이 생긴다. 아래 교체 + save 로 충분.
    }
    // 임시 → real 교체 (양쪽 모두)
    const _replaceTmp = (arr) => {
      if (!Array.isArray(arr)) return;
      // temp 제거 후, real 이 아직 없을 때만 추가. (Tracks.addComment 가 window.__tracks 에
      // real 을 이미 push 했을 수 있어서 — 안 그러면 같은 id 댓글이 2개가 됨 → 삭제 시 둘 다 삭제)
      const ti = arr.findIndex(c => c && c.id === tempId);
      if (ti >= 0) arr.splice(ti, 1);
      if (newComment && !arr.some(c => c && c.id === newComment.id)) arr.push(newComment);
    };
    if (Array.isArray(window.__tracks)) {
      const tMem = window.__tracks.find(t => t && t.id === trackId);
      if (tMem) _replaceTmp(tMem.trackComments);
    }
    _replaceTmp(track.trackComments);
    try { window.DB.save(db); } catch (_) {}   // temp→real 영구화
  } catch (e) {
    // rollback — 양쪽에서 임시 제거
    const _filterOut = (arr) => Array.isArray(arr)
      ? arr.filter(c => c && c.id !== tempId) : arr;
    if (Array.isArray(window.__tracks)) {
      const tMem = window.__tracks.find(t => t && t.id === trackId);
      if (tMem) tMem.trackComments = _filterOut(tMem.trackComments);
    }
    track.trackComments = _filterOut(track.trackComments);
    try { window.DB.save(db); } catch (_) {}   // localStorage 의 temp 도 제거
    try { _refreshTrackCommentUI(trackId); } catch (_) {}
    alert('댓글 저장 실패: ' + (e.message || e));
    if (input) input.value = text;
    return;
  }
  try { _refreshTrackCommentUI(trackId); } catch (_) {}
  return;
};

// === 이전 duplicate update 코드 (아래는 안 도달함, 주석 처리 보존 위해 남김) ===
window.__submitDemoWallCommentLegacy = async function (trackId) {
  const modal = document.getElementById('demo-wall-modal');
  if (!modal) return;
  const input = modal.querySelector('.dwm-input');
  const text = (input && input.value || '').trim();
  if (!text) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) return;
  const profileName = (window.__currentUser && window.__currentUser.name) || '';
  const authorName = profileName || '익명';
  const isSupabaseTrack = !!track.__supabase;

  let newComment = null;
  try {
    if (isSupabaseTrack && window.Tracks) {
      newComment = await window.Tracks.addComment(trackId, { text, authorName });
    } else {
      newComment = { id: 'tc' + Date.now(), author: authorName, text, createdAt: new Date().toISOString() };
      window.DB.addTrackComment(trackId, newComment);
    }
    if (!Array.isArray(track.trackComments)) track.trackComments = [];
    track.trackComments.push(newComment);
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
    return;
  }
  if (input) input.value = '';

  // Refresh modal list — delete button 포함
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const list = modal.querySelector('#dwm-cm-list');
  if (list) {
    const _myId2 = (window.__currentUser && window.__currentUser.id) || null;
    const _myName2 = (window.__currentUser && window.__currentUser.name) || '';
    list.innerHTML = track.trackComments.map(cm => {
      const isMine = (_myId2 && cm.authorId && cm.authorId === _myId2)
                  || (!cm.authorId && _myName2 && cm.author === _myName2);
      const delBtn = isMine ? `<button class="dwm-cm-del" type="button" onclick="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true); return false;" ontouchend="event.stopPropagation(); event.preventDefault(); deleteTrackComment('${trackId}','${cm.id}', true);" title="댓글 삭제" aria-label="댓글 삭제"><i class="ri-close-line"></i></button>` : '';
      return `
        <div class="dwm-cm-line">
          <span class="dwm-cm-arrow">ㄴ</span>
          <span class="dwm-cm-text">${esc(cm.text || '')}</span>
          <span class="dwm-cm-auth">— ${esc(cm.author || '익명')}</span>
          ${delBtn}
        </div>
      `;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }
  const countEl = modal.querySelector('.dwm-cm-count');
  if (countEl) countEl.textContent = track.trackComments.length;

  // Inline 카드 댓글 리스트도 in-place 갱신 (마지막 1개만, 사용자 요청)
  try {
    const allCms = track.trackComments;
    const cmVisible = allCms.slice(-1);
    document.querySelectorAll(`.demo-card[data-track-id="${trackId}"] .demo-card-cm-list`).forEach(l => {
      const lines = cmVisible.map(cm => {
        const t = esc(cm.text || '');
        const a = esc(cm.author || '익명');
        return `<div class="demo-card-cm-line"><span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${t}</span><span class="demo-card-cm-author">— ${a}</span></div>`;
      }).join('');
      l.innerHTML = lines;     // hint 텍스트 제거 — 사용자 요청 ("빨간글 없애줘")
    });
  } catch (_) {}
};

// ===================== TRACK COMMENTS MODAL (legacy, 마스터/모바일 카드에서 사용) =====================
// One modal that shows every comment for a track (master OR demo) and lets
// the viewer drop a new one. Triggered from:
//   - master compact card tap (mobile)
//   - "+N개 더보기" on a demo card when comments exceed inline cap
window.openTrackCommentsModal = function (trackId) {
  if (!trackId) return;
  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) { showToast(_t('곡을 찾을 수 없어요', 'Song not found')); return; }

  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeTitle = esc(track.title || '');
  const cms = Array.isArray(track.trackComments) ? track.trackComments : [];
  const user = window.__currentUser || (window.DB.get() && window.DB.get().currentUser);
  const canComment = !!user;

  const cmsHtml = cms.length === 0
    ? `<div class="tcm-empty">${_t('아직 댓글이 없어요 · 첫 댓글을 남겨보세요 ✨', 'No comments yet · Be the first ✨')}</div>`
    : cms.map(cm => `
        <div class="tcm-line">
          <span class="tcm-arrow">ㄴ</span>
          <span class="tcm-text">${esc(cm.text || '')}</span>
          <span class="tcm-auth">— ${esc(cm.author || _t('익명', 'Anonymous'))}</span>
        </div>
      `).join('');

  const inputHtml = canComment ? `
    <div class="tcm-input-row">
      <input type="text" class="tcm-input" maxlength="200" placeholder="${_t('댓글 남기기…', 'Leave a comment…')}"
             onkeypress="if(event.key==='Enter'){event.preventDefault(); submitTrackCommentFromModal('${trackId}');}">
      <button class="tcm-send" onclick="submitTrackCommentFromModal('${trackId}')"><i class="ri-send-plane-fill"></i></button>
    </div>
  ` : `<div class="tcm-loginhint">로그인하면 댓글을 남길 수 있어요</div>`;

  const existing = document.getElementById('track-comments-modal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', `
    <div id="track-comments-modal" class="tcm-modal" onclick="if(event.target===this) closeTrackCommentsModal()">
      <div class="tcm-card">
        <button class="tcm-close" onclick="closeTrackCommentsModal()" aria-label="닫기"><i class="ri-close-line"></i></button>
        <div class="tcm-header">
          <div class="tcm-eyebrow">댓글</div>
          <div class="tcm-title">「${safeTitle}」</div>
          <div class="tcm-count">${cms.length}개</div>
        </div>
        <div class="tcm-list" id="tcm-list">${cmsHtml}</div>
        ${inputHtml}
      </div>
    </div>
  `);

  // Scroll to latest on open & focus the modal input
  setTimeout(() => {
    const modal = document.getElementById('track-comments-modal');
    if (!modal) return;
    const list = modal.querySelector('#tcm-list');
    if (list) list.scrollTop = list.scrollHeight;
    const input = modal.querySelector('.tcm-input');
    if (input && canComment) input.focus();
  }, 50);
};

window.closeTrackCommentsModal = function () {
  const m = document.getElementById('track-comments-modal');
  if (m) m.remove();
};

// Independent comment-insert path used by the modal — does NOT delegate to
// submitTrackComment (which assumes an inline #tct-<id> input that may not
// exist when the modal is opened from a master tap). Mirrors that function's
// Supabase + cache logic, then patches both the modal list and any inline
// demo cards currently rendered for the same track.
window.submitTrackCommentFromModal = async function (trackId) {
  const modal = document.getElementById('track-comments-modal');
  if (!modal) return;
  const input = modal.querySelector('.tcm-input');
  const sendBtn = modal.querySelector('.tcm-send');
  const text = (input && input.value || '').trim();
  if (!text) return;
  if (sendBtn) sendBtn.disabled = true;

  const db = window.DB.get();
  const track = (db.tracks || []).find(t => t && t.id === trackId);
  if (!track) {
    showToast(_t('곡을 찾을 수 없어요', 'Song not found'));
    if (sendBtn) sendBtn.disabled = false;
    return;
  }
  const profileName = (window.__currentUser && window.__currentUser.name) || '';
  const authorName = profileName || '익명';
  const isSupabaseTrack = !!track.__supabase;

  let newComment = null;
  try {
    if (isSupabaseTrack && window.Tracks) {
      newComment = await window.Tracks.addComment(trackId, { text, authorName });
    } else {
      newComment = {
        id: 'tc' + Date.now(),
        author: authorName,
        text,
        createdAt: new Date().toISOString()
      };
      window.DB.addTrackComment(trackId, newComment);
    }
    if (!Array.isArray(track.trackComments)) track.trackComments = [];
    track.trackComments.push(newComment);
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
    if (sendBtn) sendBtn.disabled = false;
    return;
  }

  if (input) input.value = '';
  if (sendBtn) sendBtn.disabled = false;

  // Refresh modal list
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const list = modal.querySelector('#tcm-list');
  if (list) {
    list.innerHTML = track.trackComments.map(cm => `
      <div class="tcm-line">
        <span class="tcm-arrow">ㄴ</span>
        <span class="tcm-text">${esc(cm.text || '')}</span>
        <span class="tcm-auth">— ${esc(cm.author || '익명')}</span>
      </div>
    `).join('');
    list.scrollTop = list.scrollHeight;
  }
  const countEl = modal.querySelector('.tcm-count');
  if (countEl) countEl.textContent = track.trackComments.length + '개';

  // Also patch the inline demo card if currently rendered
  try {
    const cmSafe = esc(newComment.text || '');
    const cmAuth = esc(newComment.author || '익명');
    document.querySelectorAll(`.demo-card[data-track-id="${trackId}"] .demo-card-cm-list`).forEach(l => {
      const lineEl = document.createElement('div');
      lineEl.className = 'demo-card-cm-line';
      lineEl.innerHTML = `<span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${cmSafe}</span><span class="demo-card-cm-author">— ${cmAuth}</span>`;
      l.appendChild(lineEl);
      l.scrollTop = l.scrollHeight;
    });
  } catch (_) {}
};

// Tab switcher for the artist page (음악 / 메세지함(응원함) / 통계).
// Stats + DM inbox are lazy-loaded on tab activation — RPCs only fire
// when the user actually opens that tab.
window.switchArtistContentTab = function (name) {
  document.querySelectorAll('.content-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.contentTab === name);
  });
  document.querySelectorAll('.artist-content-pane').forEach(p => {
    p.hidden = (p.dataset.contentTab !== name);
  });
  if (name === 'stats') {
    const mount = document.getElementById('artist-stats-mount');
    if (mount && typeof window.mountMyStatsInto === 'function') {
      window.mountMyStatsInto('artist-stats-mount');
    }
  }
  if (name === 'cheers') {
    // DM inbox only renders for self (the mount div is only emitted then)
    const inboxMount = document.getElementById('dm-inbox-mount');
    if (inboxMount && typeof window.mountDmInbox === 'function') {
      window.mountDmInbox('dm-inbox-mount');
    }
  }
};

// Fetch the current user's DM conversations and render a tappable list.
// Mounted into #dm-inbox-mount on the artist page's 메세지함 tab.
window.mountDmInbox = async function (containerId) {
  const mount = document.getElementById(containerId);
  if (!mount) return;
  mount.innerHTML = `<div class="dm-inbox-section"><div class="dm-inbox-header"><i class="ri-mail-fill"></i> ${_t('받은 메시지', 'Messages')}</div><div class="dm-inbox-empty">${_t('불러오는 중…', 'Loading…')}</div></div>`;

  let convs = [];
  try {
    if (window.DM && window.DM.fetchMyConversations) {
      convs = await window.DM.fetchMyConversations();
    }
  } catch (e) { console.warn('[DM inbox]', e); }

  const mount2 = document.getElementById(containerId);
  if (!mount2) return;

  if (!convs.length) {
    mount2.innerHTML = `
      <div class="dm-inbox-section">
        <div class="dm-inbox-header">
          <i class="ri-mail-fill"></i> ${_t('받은 메시지', 'Messages')}
        </div>
        <div class="dm-inbox-empty">
          ${_t('아직 받은 개인 메시지가 없어요.', 'No messages yet.')}<br>
          <small>${_t('누군가 메시지를 보내면 여기 쌓여요.', "They'll appear here when someone writes you.")}</small>
        </div>
      </div>
    `;
    return;
  }

  const totalUnread = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const rows = convs.map(c => {
    const avatar = c.other_avatar || ('https://i.pravatar.cc/100?u=' + encodeURIComponent(c.other_name || 'user'));
    const preview = esc(c.last_text || '(메시지 없음)').slice(0, 80);
    const time = c.last_at ? new Date(c.last_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
    const isUnread = (c.unread_count || 0) > 0;
    const argName = (c.other_name || '').replace(/'/g, "\\'");
    const argAvatar = (c.other_avatar || '').replace(/'/g, "\\'");
    return `
      <div class="dm-inbox-row ${isUnread ? 'is-unread' : ''}" onclick="openDmModal('${argName}', '${argAvatar}')">
        <img src="${avatar}" alt="" class="dm-inbox-avatar" loading="lazy">
        <div class="dm-inbox-body">
          <div class="dm-inbox-name">
            ${esc(c.other_name || '익명')}
            ${isUnread ? `<span class="dm-inbox-unread">${c.unread_count}</span>` : ''}
          </div>
          <div class="dm-inbox-preview">${preview}</div>
        </div>
        <div class="dm-inbox-time">${time}</div>
      </div>
    `;
  }).join('');

  mount2.innerHTML = `
    <div class="dm-inbox-section">
      <div class="dm-inbox-header">
        <i class="ri-mail-fill"></i> 받은 메시지
        <span class="dm-inbox-count">${convs.length}</span>
        ${totalUnread > 0 ? `<span class="dm-inbox-unread-total">새 메시지 ${totalUnread}</span>` : ''}
      </div>
      <div class="dm-inbox-rows">${rows}</div>
    </div>
  `;
};

// Mobile: each .project-pages becomes a horizontal scroll-snap carousel.
// Page 0 = the album cover (.page-cover), pages 1..N = each demo (.page-demo).
// An IntersectionObserver updates the .project-dot under the carousel to
// reflect which page is currently visible. Safe to call on every render.
function _initDemoSwipe() {
  const carousels = document.querySelectorAll('.projects-grid .project-pages');
  carousels.forEach(carousel => {
    const pages = carousel.querySelectorAll('.page-cover, .page-demo');
    if (pages.length < 2) return;
    const box = carousel.parentElement;
    const dotsContainer = box && box.querySelector('.project-dots');
    if (!dotsContainer) return;
    const dots = dotsContainer.querySelectorAll('.project-dot');
    // Observe each page; the dot for the most-visible page gets .active.
    const io = new IntersectionObserver((entries) => {
      let best = null;
      entries.forEach(e => {
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
      });
      if (best && best.isIntersecting && best.intersectionRatio > 0.5) {
        const idx = Array.from(pages).indexOf(best.target);
        if (idx >= 0) {
          dots.forEach((d, i) => d.classList.toggle('active', i === idx));
        }
      }
    }, { root: carousel, threshold: [0.5, 0.75, 1.0] });
    pages.forEach(p => io.observe(p));
    // Tap a dot → jump to that page
    dots.forEach((d, i) => {
      d.addEventListener('click', () => {
        const target = pages[i];
        if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      });
    });
  });
}

// ── 응원 하트 월 (cheer heart wall) ─────────────────────────────────
// Heart-masked panel holding cheer messages as little post-its.
// Shown on the artist page (both the artist's own and visitors').
const _CHEER_POSTIT_COLORS = [
  { bg: '#FFE082', text: '#5D4037' },
  { bg: '#F8BBD0', text: '#880E4F' },
  { bg: '#C5E1A5', text: '#33691E' },
  { bg: '#B3E5FC', text: '#01579B' },
  { bg: '#FFCCBC', text: '#BF360C' },
  { bg: '#E1BEE7', text: '#4A148C' }
];

function _cheerHeartHtml(artistName, cheers) {
  const safeName = (artistName || '아티스트').replace(/</g,'&lt;');
  const list = Array.isArray(cheers) ? cheers : [];
  const VISIBLE = 14;
  const shown = list.slice(0, VISIBLE);
  const extra = Math.max(0, list.length - shown.length);

  let inner;
  if (list.length === 0) {
    inner = `<div class="cheer-heart-empty">아직 응원이 없어요.<br>첫 응원을 기다리고 있어요 💛</div>`;
  } else {
    const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    inner = `<div class="cheer-heart-cluster">
      ${shown.map((c, i) => {
        const col = _CHEER_POSTIT_COLORS[i % _CHEER_POSTIT_COLORS.length];
        const rot = ((i * 37) % 13) - 6;  // deterministic -6..+6
        return `
          <div class="cheer-postit" style="background:${col.bg}; color:${col.text}; --rot:${rot}deg;">
            <div class="cheer-postit-msg">${esc(c.message)}</div>
            <div class="cheer-postit-from">— ${esc(c.supporter_name || '익명')}</div>
          </div>`;
      }).join('')}
      ${extra > 0 ? `<div class="cheer-postit cheer-postit-more" style="--rot:3deg;">+${extra}개<br>더</div>` : ''}
    </div>`;
  }

  return `
    <div class="cheer-heart-section reveal">
      <div class="cheer-heart-header">
        <span class="cheer-heart-emblem">💝</span>
        <div>
          <h2 class="cheer-heart-title">${safeName} 응원함</h2>
          <div class="cheer-heart-sub">${list.length > 0 ? `${list.length}개의 응원이 쌓였어요` : '응원을 기다리는 중'}</div>
        </div>
      </div>
      <div class="cheer-heart-wall">${inner}</div>
    </div>
  `;
}

// Fetch this artist's cheers and fill the #cheer-heart-mount placeholder.
window.mountCheerHeart = async function (artistName) {
  const mount = document.getElementById('cheer-heart-mount');
  if (!mount) return;
  let cheers = [];
  try {
    if (window.Cheers && window.Cheers.fetchForArtistByName) {
      cheers = await window.Cheers.fetchForArtistByName(artistName, 120);
    }
  } catch (e) { console.warn('[cheerHeart]', e); }
  // User may have navigated away during the fetch
  if (currentView !== 'artist') return;
  const m2 = document.getElementById('cheer-heart-mount');
  if (!m2) return;
  m2.innerHTML = _cheerHeartHtml(artistName, cheers);
  try { document.querySelectorAll('#cheer-heart-mount .reveal').forEach(el => el.classList.add('in-view')); } catch (_) {}
};

// Brief celebratory overlay after a cheer is sent.
function _showCheerSuccess(artistName) {
  const safeArtist = (artistName || '아티스트').replace(/</g,'&lt;');
  const overlay = document.createElement('div');
  overlay.className = 'cheer-success';
  overlay.innerHTML = `
    <div class="cheer-success-burst">
      <div class="cheer-success-heart">💝</div>
      <div class="cheer-success-text">응원이 도착했어요!</div>
      <div class="cheer-success-sub">${safeArtist}님의 하트에 차곡차곡 쌓였어요</div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Float a few hearts
  for (let i = 0; i < 8; i++) {
    const h = document.createElement('span');
    h.className = 'cheer-float-heart';
    h.textContent = ['💛','💝','💗','✨'][i % 4];
    h.style.left = (10 + Math.random() * 80) + '%';
    h.style.animationDelay = (Math.random() * 0.5) + 's';
    overlay.appendChild(h);
  }
  setTimeout(() => { overlay.classList.add('fade-out'); }, 1700);
  setTimeout(() => { overlay.remove(); }, 2300);
}

