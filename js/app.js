// App Logic and Routing
const appContent = document.getElementById('app-content');
const audioElement = document.getElementById('audio-element');
const globalPlayer = document.getElementById('global-player');
const playBtn = document.getElementById('player-play-btn');

let currentView = 'home';
let currentPlayingTrack = null;

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

// Native back/forward handler — re-render the view encoded in the new URL
window.addEventListener('popstate', (e) => {
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
const _ROOT_ROUTES = new Set(['shapes', 'home']);
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
  // Hide on root pages. Also hide when there's no history yet.
  const isRoot = _ROOT_ROUTES.has(route);
  const hasHistory = window.__navStack.length > 1;
  btn.hidden = isRoot || !hasHistory;
}

// Public: try to close any open overlay first, otherwise pop the nav stack.
window.goBack = function () {
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

  // 1) Bootstrap auth (must run first — other fetches may need user.id)
  try {
    if (window.Auth) await window.Auth.bootstrap();
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

  // Don't block main render — fire and forget; re-render header/sidebar when done
  Promise.all(fetches).then(() => {
    try { updateHeaderAuth(); renderSidebarPlaylists(); } catch (_) {}
    // Re-render current view if it depends on Supabase data
    try {
      if (currentView === 'profile' && typeof renderProfile === 'function') renderProfile();
      else if (currentView === 'wall' && typeof renderWall === 'function') renderWall();
    } catch (_) {}
  });

  // Onboarding — first-login pick 3 artists (non-blocking, runs after main load)
  try {
    setTimeout(() => { if (window.maybeShowOnboarding) window.maybeShowOnboarding(); }, 1500);
  } catch (_) {}

  // Notification badge — count unread
  try { setTimeout(() => { if (window.refreshNotifBadge) window.refreshNotifBadge(); }, 800); } catch (_) {}
  // Backers/함께만드는중 UI removed — keep backend tables for later

  // Keep UI in sync if auth state changes (sign-out in another tab, session expire, etc.)
  try {
    if (window.Auth) window.Auth.onAuthChange(() => {
      updateHeaderAuth();
      renderSidebarPlaylists();
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
  });

  // Load Initial View — honor URL hash so refreshing /#/admin lands on admin
  const initialRoute = _hashToRoute(location.hash) || 'shapes';
  navigateTo(initialRoute);
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
  showToast('로그아웃 되었어요');
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
function navigateTo(route) {
  closeMenu();
  // Maintain internal back-nav stack (skipped during goBack to avoid loops).
  _pushNavStep(route);
  // Sync the URL hash + browser history. Skip when this nav was itself triggered
  // by a popstate (the browser already updated history for us).
  if (!_routerInPopstate && route) _pushRouteHash(route);
  currentView = route;
  // Toggle global back button visibility based on the new route.
  _updateBackButton(route);
  appContent.innerHTML = '';
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

  try {
    switch (route) {
      case 'shapes': renderShapes(); break;
      case 'home': renderHome(); break;
      case 'upload': renderUpload(); break;
      case 'library': window.renderLibrary(); break;
      case 'universe': window.renderUniverse(); break;
      case 'tags': renderTags(); break;
      case 'wall': renderWall(); break;
      case 'events': renderEvents(); break;
      case 'auth': renderAuth(); break;
      // Profile routes — three modes share renderProfile():
      //   profile  = auto (legacy, picks listener/artist by role)
      //   me       = forced listener view (any user)
      //   studio   = forced artist view (listener users see upgrade prompt)
      case 'profile': window.__profileMode = null; renderProfile(); break;
      case 'me':      window.__profileMode = 'me'; renderProfile(); break;
      case 'studio':  window.__profileMode = 'studio'; renderProfile(); break;
      case 'search': window.renderSearch(''); break;
      case 'admin': renderAdmin(); break;
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

// ===================== NOTIFICATIONS — 🔔 (mock) =====================
// Mock activity feed + notifications. Generates plausible events from existing data
// (followed artists' new demos, backings, level-ups, DM, postit replies).
function _genNotifications() {
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

  // Backing acknowledgements (artist thank-you messages)
  try {
    const myBackings = (typeof window._getMyBackings === 'function') ? window._getMyBackings() : [];
    myBackings.slice(0, 3).forEach((b, i) => {
      items.push({
        id: 'n_thanks_' + b.id,
        kind: 'thanks',
        icon: '💌',
        color: '#FFD600',
        title: `${b.artistName}이(가) 감사 메시지를 보냈어요`,
        body: `${(b.amount/10000).toFixed(0)}만원 후원 — 「${b.trackTitle}」`,
        time: new Date(b.createdAt).getTime() + 30000,
        onClickRoute: 'artist:' + encodeURIComponent(b.artistName)
      });
    });
  } catch(_) {}

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
  try { localStorage.setItem('offstage_notif_read', JSON.stringify(Array.from(set))); } catch(_) {}
}

window.openNotifPanel = function() {
  const panel = document.getElementById('notif-panel');
  const drawer = document.getElementById('notif-drawer');
  if (!panel || !drawer) return;
  const items = _genNotifications();
  const readSet = _getNotifReadSet();
  const fmtTime = (t) => {
    if (!t) return '';
    const diff = Date.now() - t;
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff/60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff/3600000) + '시간 전';
    return Math.floor(diff/86400000) + '일 전';
  };

  drawer.innerHTML = `
    <div class="notif-head">
      <button class="notif-close" onclick="closeNotifPanel()" aria-label="닫기"><i class="ri-close-line"></i></button>
      <div class="notif-title">알림</div>
      <button class="notif-mark-all" onclick="window.markAllNotifsRead()">모두 읽음</button>
    </div>
    <div class="notif-list">
      ${items.length === 0 ? `
        <div class="notif-empty">
          <i class="ri-notification-off-line"></i>
          <p>새 알림이 없어요</p>
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
  panel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
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
  set.add(id);
  _saveNotifReadSet(set);
  window.refreshNotifBadge();
};

window.markAllNotifsRead = function() {
  const items = _genNotifications();
  const set = _getNotifReadSet();
  items.forEach(n => set.add(n.id));
  _saveNotifReadSet(set);
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

  // Recent backings
  (db.tracks || []).filter(t => t && t.isDemo).slice(0, 6).forEach((t, i) => {
    const cfg = (typeof getStoConfigForTrack === 'function') ? getStoConfigForTrack(t) : null;
    if (!cfg || !cfg.raisedKrw) return;
    const supporter = mockListeners[i % mockListeners.length];
    const amt = Math.floor((cfg.raisedKrw / Math.max(3, i+2)) / 10000) * 10000;
    if (amt < 10000) return;
    events.push({
      kind: 'backing',
      who: supporter,
      whoAvatar: 'https://i.pravatar.cc/100?u=' + encodeURIComponent(supporter),
      action: '함께 만들기',
      target: `${t.artist}의 「${t.title}」 데모에 ${(amt/10000).toFixed(0)}만원`,
      time: Date.now() - (i+1) * 1800000 * 3,
      cover: t.cover,
      onClick: `playTrack('${t.id}')`
    });
  });

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
  showToast('🎤 작업일지가 우리들의 벽에 올라갔어요!');
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
  showToast('💎 SPO 설정 저장됨');
  // Re-open manager to show updated values
  window.openStoManager();
};

// ===================== MOBILE PLAYER EXPAND TOGGLE =====================
window.togglePlayerExpand = function(e) {
  // Only on mobile
  if (window.innerWidth > 720) return;
  const player = document.getElementById('global-player');
  if (!player) return;
  // Skip if click was on a control button
  const target = e && e.target;
  if (target && target.closest('.control-btn, .progress-bar, .progress-container')) return;
  player.classList.toggle('expanded');
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
        <input type="text" id="search-page-input" placeholder="아티스트 · 곡 · #태그 · 응원글 검색" value="${(query||'').replace(/"/g,'&quot;')}"
               oninput="window.searchOnInput()" onkeypress="if(event.key==='Enter') window.doSearch()">
        ${q ? `<button class="search-clear-btn" onclick="document.getElementById('search-page-input').value=''; window.renderSearch('');"><i class="ri-close-circle-fill"></i></button>` : ''}
      </div>
  `;

  if (!q) {
    // Empty state — trending tags + popular tracks
    html += `
      <div class="search-section">
        <h3 class="search-section-title"><i class="ri-fire-fill" style="color:#FF6B9D;"></i> 인기 태그</h3>
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
          <h3 class="search-section-title"><i class="ri-music-2-fill" style="color:var(--brand-color);"></i> 인기 곡</h3>
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
        <p>"${(query||'').replace(/</g,'&lt;')}" 에 대한 결과가 없어요</p>
        <p class="search-empty-sub">다른 키워드로 검색해보세요</p>
      </div>
    `;
  } else {
    html += `<div class="search-result-count">"${(query||'').replace(/</g,'&lt;')}" — ${totalResults}개 결과</div>`;

    if (matchedArtists.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-section-title"><i class="ri-user-3-fill" style="color:#7C4DFF;"></i> 아티스트 <span class="search-count">${matchedArtists.length}</span></h3>
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
          <h3 class="search-section-title"><i class="ri-music-2-fill" style="color:var(--brand-color);"></i> 곡 <span class="search-count">${matchedTracks.length}</span></h3>
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
          <h3 class="search-section-title"><i class="ri-hashtag" style="color:#4ECDC4;"></i> 태그 <span class="search-count">${matchedTags.length}</span></h3>
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
          <h3 class="search-section-title"><i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> 응원글 <span class="search-count">${matchedNotes.length}</span></h3>
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
    const role = user.role || 'listener';
    const roleLabel = role === 'admin' ? '관리자'
                    : (role === 'artist' || role === 'student') ? '아티스트'
                    : 'Collection';
    const isArtist = role === 'admin' || role === 'artist' || role === 'student';
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; cursor:pointer;" onclick="navigateTo('profile')">
        <img src="${user.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" alt="${(user.name||'').replace(/"/g,'&quot;')}">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user.name}</div>
          <div style="font-size:11px;color:var(--text-secondary);">${roleLabel}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-primary" style="padding:6px 14px;font-size:12px;" onclick="navigateTo('profile')"><i class="ri-user-3-line"></i> 내 페이지</button>
        ${isArtist ? `<button class="btn-primary" style="padding:6px 14px;font-size:12px;background:#333;" onclick="navigateTo('upload')"><i class="ri-upload-2-line"></i> Upload</button>` : `<button style="padding:6px 12px;font-size:11px; background:transparent; border:1px solid var(--divider); color:var(--text-secondary); border-radius:14px;" onclick="if(confirm('아티스트로 전환하면 음악을 올릴 수 있어요. 계속할까요?')) navigateTo('upload')"><i class="ri-add-line"></i> 음악 올리기</button>`}
        ${role === 'admin' ? `<button class="btn-primary" style="padding:6px 14px;font-size:12px;background:#9C27B0;" onclick="navigateTo('admin')"><i class="ri-dashboard-fill"></i> Admin</button>` : ''}
        <button style="color:var(--text-secondary);font-size:12px;padding:6px 8px;" onclick="logout()">로그아웃</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn-primary" style="width:100%;padding:10px;font-size:13px;" onclick="navigateTo('auth')">로그인 / 가입</button>
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
  // Supabase ID 있으면 백엔드 + 로컬 모두 갱신, 없으면 로컬만
  if (artistId && window.Follows && window.__currentUser) {
    try {
      const { following } = await window.Follows.toggle(artistId);
      // localStorage 즐겨찾기 set 동기화 (메인 페이지 등에서 사용)
      const names = window._getFollowedNames();
      if (following) names.add(artistName); else names.delete(artistName);
      window._setFollowedNames(names);
      showToast(following ? `${artistName} 팬 추가 💚` : `${artistName} 팬 해제`);
      renderArtistProfile(artistName);
      return;
    } catch (e) {
      console.warn('[follow] supabase fail, fallback to local', e);
    }
  }
  // 로컬 전용 토글 (mock 아티스트 / 로그아웃 상태)
  const nowFollowing = window._toggleFollowName(artistName);
  showToast(nowFollowing ? `${artistName} 팬 추가 💚` : `${artistName} 팬 해제`);
  renderArtistProfile(artistName);
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
        <button class="add-to-playlist-btn" onclick="event.stopPropagation(); openPlaylistModal('${track.id}')" title="Add to Playlist">
          <i class="ri-add-line"></i>
        </button>
      </div>
      <div class="track-info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div class="track-title" style="flex:1;">${track.title}</div>
          <button onclick="event.stopPropagation(); window.toggleLike('${track.id}')" style="background:none; border:none; color:var(--text-primary); font-size:18px; cursor:pointer; padding:0;">
            ${likeIcon}
          </button>
        </div>
        <div class="track-artist">
          <img src="${track.artistAvatar}" style="width:16px;height:16px;border-radius:50%">
          ${track.artist}
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
  if (!sns) return '';
  const links = [];
  if (sns.instagram) links.push(`<a href="${sns.instagram}" target="_blank" onclick="event.stopPropagation()"><i class="ri-instagram-line"></i></a>`);
  if (sns.youtube) links.push(`<a href="${sns.youtube}" target="_blank" onclick="event.stopPropagation()"><i class="ri-youtube-fill"></i></a>`);
  if (sns.tiktok) links.push(`<a href="${sns.tiktok}" target="_blank" onclick="event.stopPropagation()"><i class="ri-tiktok-fill"></i></a>`);
  if (sns.twitter) links.push(`<a href="${sns.twitter}" target="_blank" onclick="event.stopPropagation()"><i class="ri-twitter-fill"></i></a>`);
  if (links.length === 0) return '';
  return `<div class="sns-links" style="margin-top:10px;">${links.join('')}</div>`;
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
      <div class="tags-page-header reveal">
        <h1><i class="ri-hashtag" style="color:var(--brand-color);"></i> Tags</h1>
      </div>
      <div style="text-align:center; padding: 80px 0; color:var(--text-secondary);">
        <i class="ri-price-tag-3-line" style="font-size: 48px; margin-bottom: 16px; display:block;"></i>
        아직 태그가 없습니다. 곡을 업로드할 때 태그를 달아보세요!
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
    <div class="tags-page-header reveal">
      <h1><i class="ri-hashtag" style="color:var(--brand-color);"></i> Tags</h1>
      <span class="count">총 ${tagList.length}개의 태그 · ${totalTracks}곡</span>
    </div>
    <p class="reveal" style="color:var(--text-secondary); margin-bottom: 16px; font-size:14px; line-height:1.6;">
      학생들이 직접 만든 음악 분류. 태그를 클릭해서 비슷한 느낌의 곡들을 탐색해보세요.
    </p>
    <div class="tags-cloud reveal-scale">
      ${cloudHtml}
    </div>
  `;
}

function renderTagDetail(tag) {
  const db = window.DB.get();
  // Masters only — one final per project
  const masters = db.tracks.filter(t =>
    (t.tags || []).includes(tag) && (t.version === 'final' || !t.isDemo)
  );
  // Deduplicate by projectId (take final if multiple)
  const seenProject = new Set();
  const matched = [];
  masters.forEach(t => {
    const pid = t.projectId || t.id;
    if (seenProject.has(pid)) return;
    seenProject.add(pid);
    matched.push(t);
  });
  // Sort by createdAt desc
  matched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const safeTag = tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (matched.length === 0) {
    appContent.innerHTML = `
      <div class="artist-canvas">
        <div class="artist-bg-deco"></div>
        <div class="sub-page artist-page">
          <div class="reveal" style="margin-bottom:14px;">
            <a href="#" onclick="event.preventDefault(); navigateTo('tags')">
              <i class="ri-arrow-left-line"></i> 모든 태그
            </a>
          </div>
          <div class="tag-hero">
            <h1 class="tag-hero-title">#${safeTag}</h1>
          </div>
          <p style="color:#2a2240; margin-top: 40px; text-align:center; font-weight:600;">이 태그를 가진 곡이 아직 없어요.</p>
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
    <div class="artist-canvas">
      <div class="artist-bg-deco"></div>
      <div class="sub-page artist-page">
        <div class="reveal" style="margin-bottom:14px;">
          <a href="#" onclick="event.preventDefault(); navigateTo('tags')">
            <i class="ri-arrow-left-line"></i> 모든 태그
          </a>
        </div>

        <div class="tag-hero reveal">
          <h1 class="tag-hero-title">#${safeTag}</h1>
          <div class="tag-hero-stats">
            <span>${matched.length} 마스터 곡</span>
            <span class="stat-dot">·</span>
            <span>${uniqueArtists.length} 아티스트</span>
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
  yellow: { bg: '#FFF9C4', border: '#FFD54F', text: '#5D4037' },
  blue:   { bg: '#BBDEFB', border: '#64B5F6', text: '#1A237E' },
  pink:   { bg: '#F8BBD0', border: '#F06292', text: '#880E4F' },
  green:  { bg: '#C8E6C9', border: '#66BB6A', text: '#1B5E20' },
  orange: { bg: '#FFE0B2', border: '#FFA726', text: '#BF360C' },
  purple: { bg: '#E1BEE7', border: '#AB47BC', text: '#4A148C' }
};

// Wall state: pagination + search + sort
let _wallPage = 1;
const _WALL_PAGE_SIZE = 60;
let _wallSearch = '';
let _wallSort = 'new'; // 'new' | 'old' | 'random'

// Renders the small attached-song chip beneath a wall note. Returns empty
// string when the note has no song link.
function _renderNoteTrackChip(note) {
  if (!note) return '';
  if (note.trackId) {
    const t = (window.DB.get().tracks || []).find(x => x && x.id === note.trackId);
    if (!t) return '';
    const cover = t.cover || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=300';
    const title = (t.title || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const artist = (t.artist || '').replace(/</g,'&lt;');
    return `
      <div class="note-track-chip" onclick="event.stopPropagation(); playTrack('${t.id}')" title="${title} — 재생">
        <img src="${cover}" alt="" loading="lazy">
        <div class="note-track-chip-info">
          <div class="note-track-chip-title">${title}</div>
          <div class="note-track-chip-sub">${artist}</div>
        </div>
        <i class="ri-play-circle-fill note-track-chip-play"></i>
      </div>`;
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
    return `
      <a class="note-track-chip note-track-chip-ext" href="${safeUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" title="${provider}로 열기">
        <i class="${icon}"></i>
        <div class="note-track-chip-info">
          <div class="note-track-chip-title">${provider}</div>
          <div class="note-track-chip-sub" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeUrl}</div>
        </div>
        <i class="ri-arrow-right-up-line"></i>
      </a>`;
  }
  return '';
}

async function renderWall() {
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

  // Scatter notes
  const cols = 4;
  const boardH = Math.max(700, Math.ceil(visibleNotes.length / cols) * 200 + 260);

  let notesHtml = visibleNotes.map((note, i) => {
    const c = NOTE_COLORS[note.color] || NOTE_COLORS.yellow;
    // Seeded jitter from note id so positions don't reshuffle on every reload
    const seed = _hashSeed(note.id);
    const rot = note.rotation != null ? note.rotation : ((((seed >>> 2) % 60) - 30) / 10);
    const safeText = (note.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const safeAuthor = (note.author || '').replace(/</g,'&lt;');
    const isOwner = user && user.name === note.author;
    const deleteBtn = isOwner ? `<button class="note-delete" onclick="event.stopPropagation(); deleteWallNote('${note.id}')" title="삭제"><i class="ri-close-line"></i></button>` : '';

    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 2 + col * 22 + (seed % 10);
    const yPx = 130 + row * 190 + ((seed >>> 8) % 40);

    const bookmarked = window.Walls && window.Walls.isBookmarked && window.Walls.isBookmarked(note.id);
    const bookmarkBtn = user ? `
      <button class="note-bookmark ${bookmarked ? 'is-bookmarked' : ''}" onclick="event.stopPropagation(); toggleBookmark('${note.id}')" title="수집하기">
        <i class="${bookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line'}"></i>
      </button>
    ` : '';

    return `
      <div class="wall-note" data-note-id="${note.id}" data-author="${safeAuthor}" style="background:${c.bg}; color:${c.text}; left:${x}%; top:${yPx}px; --rot:${rot}deg;" title="낙서·댓글 보기">
        ${deleteBtn}
        ${bookmarkBtn}
        <div class="note-body">${safeText}</div>
        <div class="note-author">— ${safeAuthor}</div>
        ${_renderNoteTrackChip(note)}
      </div>
    `;
  }).join('');

  // Write composer — hidden in a popover panel toggled by a FAB button
  const writeComposer = user ? `
    <div class="wall-compose-panel" id="wall-compose-panel" hidden>
      <textarea id="wall-text" class="form-control" rows="3" placeholder="하고 싶은 말을 자유롭게 ✍️" style="resize:none; margin-bottom:10px;"></textarea>
      <!-- Attached song preview (hidden until a track or URL is picked) -->
      <div id="wall-attach-preview" class="wall-attach-preview" hidden></div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="display:flex; gap:6px;" id="wall-color-picker">
          ${colorKeys.map((key,i) => `<button class="color-dot ${i===0?'active':''}" data-color="${key}" style="background:${NOTE_COLORS[key].bg}; border:2px solid ${NOTE_COLORS[key].border};" onclick="document.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('active')); this.classList.add('active');"></button>`).join('')}
        </div>
        <button type="button" class="wall-attach-btn" onclick="openSongAttacher()" title="노래 첨부"><i class="ri-music-2-fill"></i> 노래</button>
        <button class="btn-primary" onclick="submitWallNote()" style="margin-left:auto; padding:8px 18px; font-size:13px;">붙이기 📌</button>
      </div>
    </div>
  ` : '';

  const writeFab = user
    ? `<button class="wall-fab" onclick="toggleWallCompose()" title="벽에 남기기"><i class="ri-add-line"></i> 남기기</button>`
    : `<button class="wall-fab" onclick="navigateTo('auth')" title="로그인하고 글 남기기"><i class="ri-login-box-line"></i> 로그인</button>`;

  // Compact toolbar (count only; search/sort only when there are many notes)
  const showAdvancedControls = allNotes.length > 12 || q;
  const toolbar = `
    <div class="wall-toolbar-v2">
      <div class="wall-count-v2">
        ${q ? `"${q}" · <strong>${total}</strong>개` : `총 <strong>${allNotes.length}</strong>개`}
        ${total > 0 && shown < total ? ` · 보는 중 ${shown}` : ''}
      </div>
      ${showAdvancedControls ? `
        <button class="wall-toolbtn" onclick="document.getElementById('wall-advanced').hidden = !document.getElementById('wall-advanced').hidden"><i class="ri-search-line"></i></button>
      ` : ''}
    </div>
    <div class="wall-advanced" id="wall-advanced" ${showAdvancedControls && q ? '' : 'hidden'}>
      <div class="wall-search-v2">
        <i class="ri-search-line"></i>
        <input type="text" id="wall-search-input" placeholder="검색 (내용 / 작성자)" value="${q.replace(/"/g,'&quot;')}"
               oninput="wallSetSearch(this.value)"
               onkeydown="if(event.key==='Enter'){event.target.blur();}">
        ${q ? `<button class="wall-search-clear" onclick="wallSetSearch('')"><i class="ri-close-line"></i></button>` : ''}
      </div>
      <div class="wall-sort-v2">
        <button class="wall-sort-btn ${_wallSort==='new'?'active':''}" onclick="wallSetSort('new')">최신</button>
        <button class="wall-sort-btn ${_wallSort==='old'?'active':''}" onclick="wallSetSort('old')">오래된</button>
        <button class="wall-sort-btn ${_wallSort==='random'?'active':''}" onclick="wallSetSort('random')">랜덤</button>
      </div>
    </div>
  `;

  const loadMoreBtn = hasMore ? `
    <div class="wall-load-more">
      <button onclick="wallLoadMore()" class="btn-primary" style="font-size:14px; padding:10px 28px;">
        <i class="ri-arrow-down-line"></i> 더 보기 (${total - shown}개 더)
      </button>
    </div>
  ` : '';

  const emptyMsg = total === 0
    ? (q
        ? `<div class="wall-empty">"${q}" 검색 결과가 없어요 🔍</div>`
        : `<div class="wall-empty">아직 아무도 안 적었어.<br>첫 번째가 되어봐! 🖊️</div>`
      )
    : '';

  appContent.innerHTML = `
    <div class="wall-board" style="height:${total > 0 ? boardH : 600}px;">
      <div class="wall-header-v2">
        <div class="wall-title-row">
          <h1><i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> 우리들의 벽</h1>
          ${toolbar}
        </div>
        <p class="wall-hint">포스트잇을 드래그해서 움직여봐 · 탭하면 작성자 프로필 ✋</p>
      </div>
      ${writeFab}
      ${writeComposer}
      ${notesHtml}
      ${emptyMsg}
      ${loadMoreBtn}
    </div>
  `;

  initNoteDrag();
}

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

window.toggleWallCompose = function() {
  const panel = document.getElementById('wall-compose-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const ta = document.getElementById('wall-text');
    if (ta) ta.focus();
  }
};

// ── Song attacher (wall compose) ────────────────────────────────────────
// Picks an Off-Stage track OR an external URL (YouTube / Spotify / Apple Music)
// and stashes the result on window.__wallAttachedSong for submitWallNote.
window.__wallAttachedSong = null;

function _detectProvider(url) {
  const u = (url || '').toLowerCase();
  if (/youtube\.com\/|youtu\.be\//.test(u))   return { provider: 'youtube', label: 'YouTube' };
  if (/open\.spotify\.com\//.test(u))          return { provider: 'spotify', label: 'Spotify' };
  if (/music\.apple\.com\//.test(u))           return { provider: 'apple',   label: 'Apple Music' };
  if (/soundcloud\.com\//.test(u))             return { provider: 'soundcloud', label: 'SoundCloud' };
  return null;
}

function _renderAttachPreview() {
  const preview = document.getElementById('wall-attach-preview');
  if (!preview) return;
  const a = window.__wallAttachedSong;
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
  } else {
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
  window.__wallAttachedSong = null;
  _renderAttachPreview();
};

window.openSongAttacher = function() {
  const existing = document.getElementById('wall-song-modal');
  if (existing) existing.remove();
  const myTracks = (window.DB.get().tracks || [])
    .filter(t => t && t.title)
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
        <h3 style="margin:0; font-size:16px;">노래 첨부</h3>
        <button class="wall-song-close" onclick="closeSongAttacher()" aria-label="닫기"><i class="ri-close-line"></i></button>
      </div>
      <div class="wall-song-tabs">
        <button class="wall-song-tab active" data-tab="track" onclick="_switchSongAttachTab('track')"><i class="ri-music-2-line"></i> Off-Stage 곡</button>
        <button class="wall-song-tab"        data-tab="url"   onclick="_switchSongAttachTab('url')"><i class="ri-link"></i> URL</button>
      </div>
      <div class="wall-song-pane" data-pane="track">
        <input type="text" class="form-control" placeholder="곡 제목·아티스트 검색" oninput="_filterAttachTracks(this.value)" style="margin-bottom:10px;">
        <div class="wall-song-list" id="wall-song-list">${trackList || '<div style="text-align:center; padding:24px; color:var(--text-secondary);">아직 곡이 없어요</div>'}</div>
      </div>
      <div class="wall-song-pane" data-pane="url" style="display:none;">
        <input type="url" id="wall-song-url" class="form-control" placeholder="YouTube · Spotify · Apple Music URL" style="margin-bottom:12px;">
        <button class="btn-primary" style="width:100%;" onclick="pickAttachedUrl()">첨부</button>
        <p style="font-size:11px; color:var(--text-secondary); margin-top:10px;">지원: youtube.com · open.spotify.com · music.apple.com</p>
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

window.pickAttachedTrack = function(trackId) {
  window.__wallAttachedSong = { kind: 'track', id: trackId };
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
  window.__wallAttachedSong = { kind: 'url', url };
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
  const textEl = document.getElementById('wall-text');
  const text = (textEl && textEl.value || '').trim();
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
      await window.Walls.insert({ text, color, rotation, trackId, externalUrl });
    } else {
      window.DB.addNote({ id: 'n' + Date.now(), author: user.name, text, color, rotation, createdAt: new Date().toISOString() });
    }
    if (textEl) textEl.value = '';
    window.__wallAttachedSong = null;
    const preview = document.getElementById('wall-attach-preview');
    if (preview) { preview.innerHTML = ''; preview.hidden = true; }
    const panel = document.getElementById('wall-compose-panel');
    if (panel) panel.hidden = true;
    await renderWall();
    showToast('벽에 붙었어요 📌');
  } catch (e) {
    alert('저장 실패: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '붙이기 📌'; }
  }
};

window.toggleBookmark = async function(noteId) {
  if (!window.Walls || !window.Walls.toggleBookmark) return;
  const user = window.__currentUser;
  if (!user) {
    if (confirm('포스트잇을 수집하려면 로그인이 필요해요. 로그인할까요?')) navigateTo('auth');
    return;
  }
  try {
    const { bookmarked } = await window.Walls.toggleBookmark(noteId);
    // Update icon in DOM in-place
    document.querySelectorAll(`.wall-note[data-note-id="${noteId}"] .note-bookmark, #note-detail-modal .note-bookmark[data-note-id="${noteId}"]`).forEach(btn => {
      btn.classList.toggle('is-bookmarked', bookmarked);
      const i = btn.querySelector('i');
      if (i) i.className = bookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line';
    });
    showToast(bookmarked ? '수집했어요 📌' : '수집 취소됐어요');
  } catch (e) {
    alert(e.message || '수집 실패');
  }
};

window.deleteWallNote = async function(noteId) {
  if (!confirm('이 포스트잇을 지울까요?')) return;
  try {
    if (window.Walls) {
      await window.Walls.delete(noteId);
    } else {
      window.DB.deleteNote(noteId);
    }
    await renderWall();
    showToast('삭제됐어요');
  } catch (e) {
    alert('삭제 실패: ' + (e.message || e));
  }
};

// ===================== NOTE DETAIL MODAL (comments) =====================
window.openNoteDetail = async function(noteId) {
  const db = window.DB.get();
  let note = (db.notes || []).find(n => n.id === noteId);
  if (!note) return;

  // Refresh comments from Supabase (keeps note body from cache)
  if (window.Walls) {
    try {
      const freshComments = await window.Walls.fetchComments(noteId);
      note.comments = freshComments;
      if (Array.isArray(window.__wallNotes)) {
        const cached = window.__wallNotes.find(x => x.id === noteId);
        if (cached) cached.comments = freshComments;
      }
    } catch (e) { console.warn('[openNoteDetail] fetchComments', e); }
  }

  const c = NOTE_COLORS[note.color] || NOTE_COLORS.yellow;
  const safeText = (note.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const safeAuthor = (note.author || '').replace(/</g,'&lt;');
  const comments = note.comments || [];

  const commentsHtml = comments.length === 0
    ? '<div class="no-comments">ㄴ 아직 조용하네...<br>ㄴ 첫 낙서를 남겨봐 ✍️</div>'
    : comments.map((cm, i) => {
        const cmSafe = (cm.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const cmAuth = (cm.author || '익명').replace(/</g,'&lt;');
        return `
          <div class="comment-line" style="padding-left:${Math.min(i,5) * 18 + 4}px;">
            <span class="comment-arrow">ㄴ</span><span class="comment-text">${cmSafe}</span><span class="comment-author">— ${cmAuth}</span>
          </div>
        `;
      }).join('');

  const existingModal = document.getElementById('note-detail-modal');
  if (existingModal) existingModal.remove();

  const isBookmarked = window.Walls && window.Walls.isBookmarked && window.Walls.isBookmarked(noteId);
  const bookmarkBtnModal = db.currentUser ? `
    <button class="note-bookmark in-modal ${isBookmarked ? 'is-bookmarked' : ''}" data-note-id="${noteId}" onclick="event.stopPropagation(); toggleBookmark('${noteId}')" title="${isBookmarked ? '수집 취소' : '수집하기'}">
      <i class="${isBookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line'}"></i>
    </button>
  ` : '';

  const modalHtml = `
    <div id="note-detail-modal" class="note-detail-modal" onclick="if(event.target===this) closeNoteDetail()">
      <div class="note-detail-content">
        <button class="note-detail-close" onclick="closeNoteDetail()"><i class="ri-close-line"></i></button>
        <div class="note-detail-postit" style="background:${c.bg}; color:${c.text};">
          ${bookmarkBtnModal}
          <div class="note-body">${safeText}</div>
          <div class="note-author-line">
            — <a href="#" class="author-link" onclick="event.preventDefault(); closeNoteDetail(); navigateTo('artist:' + encodeURIComponent('${safeAuthor}'))">${safeAuthor}</a>
          </div>
        </div>
        ${_renderNoteTrackChip(note)}

        <div class="comments-scribble">
          <div class="scribble-title">✎ 낙서</div>
          ${commentsHtml}

          <div class="scribble-input-row">
            <input type="text" id="comment-author" class="scribble-input scribble-name-input" placeholder="이름 (없어도 됨)" value="${db.currentUser?.name || ''}">
            <input type="text" id="comment-text" class="scribble-input" placeholder="ㄴ 하고 싶은 말 적어봐..." onkeypress="if(event.key==='Enter') submitComment('${noteId}')">
            <button class="scribble-send" onclick="submitComment('${noteId}')">남기기</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  setTimeout(() => {
    const input = document.getElementById('comment-text');
    if (input) input.focus();
  }, 100);
};

window.closeNoteDetail = function() {
  const m = document.getElementById('note-detail-modal');
  if (m) m.remove();
};

window.submitComment = async function(noteId) {
  const textEl = document.getElementById('comment-text');
  const authorEl = document.getElementById('comment-author');
  const text = (textEl && textEl.value || '').trim();
  if (!text) return;
  const authorName = (authorEl && authorEl.value || '').trim();

  const btn = document.querySelector('#note-detail-modal .scribble-send');
  if (btn) { btn.disabled = true; btn.textContent = '남기는 중…'; }
  try {
    if (window.Walls) {
      await window.Walls.addComment(noteId, { text, authorName });
    } else {
      window.DB.addNoteComment(noteId, {
        id: 'c' + Date.now(), author: authorName || '익명', text, createdAt: new Date().toISOString()
      });
    }
    // Clear input and re-open modal (which now pulls fresh comments)
    if (textEl) textEl.value = '';
    await openNoteDetail(noteId);
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '남기기'; }
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
  // Short click/tap → open the note detail modal (낙서·댓글 보기).
  // Author name inside the modal still links to the artist page if wanted.
  if (!wasMoved) {
    const noteId = el.dataset.noteId;
    if (noteId && typeof window.openNoteDetail === 'function') {
      setTimeout(() => window.openNoteDetail(noteId), 10);
    }
  }
}

function initNoteDrag() {
  const notes = document.querySelectorAll('.wall-note');

  function down(e) {
    if (e.target.closest('.note-delete')) return;
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

const SHAPE_TYPES = ['circle', 'oval', 'rect', 'triangle', 'star', 'parallelogram', 'diamond', 'hexagon'];
const SHAPE_COLORS = ['#FF9800', '#FF4081', '#2979FF', '#76FF03', '#7C4DFF', '#FFD600', '#00E5FF', '#FF1744', '#69F0AE', '#EA80FC'];

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
    shape: t.shape || SHAPE_TYPES[0],
    color: t.shapeColor || SHAPE_COLORS[0],
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
      itemsHtml += `
        <div class="floating-shape shape-${item.shape} univ-shape" data-track-id="${item.id}"
             style="${bgStyle} ${posStyle}"
             onclick="playTrack('${item.id}')"
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
        <div class="univ-album" style="${posStyle}" onclick="playTrack('${item.id}')" title="${safeTitle} — ${safeArtist}">
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
  const artistNames = new Set(tracks.map(t => t.artist).filter(Boolean));
  const notes = allNotes.filter(n => artistNames.has(n.author)).slice(0, 18);

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
        <div class="univ-album" style="${posStyle}" onclick="playTrack('${it.id}')" title="${safeTitle} — ${safeArtist}">
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
      const shape = t.shape || SHAPE_TYPES[si % SHAPE_TYPES.length];
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
             onclick="playTrack('${t.id}')"
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
        <div class="pl-postit" style="background:${c.bg}; color:${c.text}; --rot:${rot}deg;" onclick="navigateTo('artist:${encAuth}')" title="${safeAuth} 프로필">
          <div class="pl-postit-body">${safeTxt}</div>
          <div class="pl-postit-sig">— ${safeAuth}</div>
        </div>
      `;
    }).join('');
    section3Html = `
      <section class="pl-section pl-section-notes">
        <h2 class="pl-section-title"><i class="ri-sticky-note-fill"></i> 응원 포스트잇 <span class="pl-count">${notes.length}</span></h2>
        <p class="pl-section-sub">이 아티스트들이 받은 마음</p>
        <div class="pl-postit-grid">${notesHtml}</div>
      </section>
    `;
  } else {
    section3Html = `
      <section class="pl-section pl-section-notes">
        <h2 class="pl-section-title"><i class="ri-sticky-note-fill"></i> 응원 포스트잇</h2>
        <p class="pl-section-empty">우리들의 벽에서 이 아티스트들에게 마음을 전하면 여기 모여요</p>
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

  appContent.innerHTML = `
    <div class="pl-page">
      <div class="pl-header">
        <button class="pl-back" onclick="navigateTo('profile')" aria-label="뒤로">
          <i class="ri-arrow-left-line"></i>
        </button>
        <div class="pl-title-block">
          <div class="pl-eyebrow">내 음악 폴더</div>
          <h1 class="pl-title">${safePlaylistTitle}</h1>
          <div class="pl-meta">🎵 ${masterItems.length} 마스터 · ✏ ${demoTracks.length} 데모 · 📝 ${notes.length} 포스트잇 · #${tagList.length}</div>
        </div>
      </div>
      ${tracks.length === 0 ? `
        <div class="pl-empty-page">
          <div style="font-size:48px; margin-bottom:18px;">🎵</div>
          <p>아직 이 폴더에 곡이 없어요.<br>다른 페이지의 트랙에서 ➕로 담아보세요.</p>
        </div>
      ` : `
        ${section1Html}
        ${section2Html}
        ${section3Html}
        ${section4Html}
      `}
    </div>
  `;

  if (tracks.length > 0) initDiscoverDrag();
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
  // Main exposure rule: master + pinned demo (1 per project) — Instagram pin style
  // 모든 도형이 우주에서 자유롭게 떠다님 — 청취자가 아티스트를 모으는 컨셉
  const allTracks = db.tracks || [];
  // Sort by id so the grid placement (col/row) is identical on every reload —
  // otherwise Supabase fetch order shuffles items into different cells even
  // though the seeded jitter is stable.
  const tracks = allTracks
    .filter(t => !t.isDemo || t.pinned)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Decorative floating shapes — seeded by index so they stay in the same spots across reloads
  let decoHtml = '';
  const decoShapes = ['border-radius:50%', 'border-radius:50%', 'border-radius:4px', 'clip-path:polygon(50% 0%,0% 100%,100% 100%)', 'clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%)', 'border-radius:50%'];
  for (let i = 0; i < 50; i++) {
    const seed = _hashSeed('deco-shapes:' + i);
    const size = 8 + (seed % 50);
    const x = (seed >>> 6) % 96;
    const y = (seed >>> 13) % 96;
    const color = SHAPE_COLORS[(seed >>> 20) % SHAPE_COLORS.length];
    const opacity = 0.15 + (((seed >>> 23) % 55) / 100);
    const dur = 8 + ((seed >>> 26) % 24);
    const shapeStyle = decoShapes[(seed >>> 29) % decoShapes.length];
    const dx = ((seed >>> 4) % 70) - 35;
    const dy = ((seed >>> 11) % 70) - 35;
    const rot = ((((seed >>> 17) % 80) - 40) / 10);
    decoHtml += `<div class="deco-shape" style="width:${size}px;height:${size}px;left:${x}%;top:${y}%;background:${color};opacity:${opacity};${shapeStyle};animation:floatDrift ${dur}s ease-in-out infinite;--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;"></div>`;
  }

  // Track shapes
  let shapesHtml = '';
  const totalShapes = tracks.length * 2;
  const cols = 3;
  const universeHeight = Math.max(900, Math.ceil(totalShapes / cols) * 300);

  // Build two passes (each track shown twice for fuller universe). Order is stable
  // so reloads don't reshuffle. Pass index goes into the seed so the same track's
  // two copies sit in different spots.
  const shapeEntries = [];
  tracks.forEach((track, i) => shapeEntries.push({ track, idx: i, pass: 0 }));
  tracks.forEach((track, i) => shapeEntries.push({ track, idx: i, pass: 1 }));

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
    const shape = track.shape || SHAPE_TYPES[idx % SHAPE_TYPES.length];
    const color = track.shapeColor || SHAPE_COLORS[idx % SHAPE_COLORS.length];
    const lines = track.lines || [track.title, track.artist, '클릭해서 들어봐!'];
    const safeLines = lines.map(l => (l || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

    const col = si % cols;
    const row = Math.floor(si / cols);
    // Seeded per-track-per-pass so positions are deterministic across reloads
    const seed = _hashSeed(track.id + ':' + pass);
    // Stored user drag overrides the seeded default
    const stored = _loadShapePos(track.id, pass);
    const xBase = stored ? stored.xPct : (2 + col * 30 + (seed % 18));
    const yPx   = stored ? stored.yPx  : (20 + row * 280 + ((seed >>> 5) % 60));
    const rot = ((((seed >>> 10) % 140) - 70) / 10);
    const dur = 10 + ((seed >>> 18) % 18);
    const dx = ((((seed >>> 22) % 50)) - 25);
    const dy = ((((seed >>> 26) % 50)) - 25);

    const isTriangle = shape === 'triangle';
    const bgStyle = isTriangle
      ? `border-bottom-color: ${color}; color: ${color}; --shape-bg: ${color};`
      : `background: ${color}; --shape-bg: ${color};`;

    const liked = isTrackLiked(track.id);
    shapesHtml += `
      <div class="floating-shape shape-${shape}" data-track-id="${track.id}" data-pass="${pass}" data-artist="${encodeURIComponent(track.artist || '')}"
           style="${bgStyle} left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;">
        <div class="shape-text">${safeLines.join('\n')}</div>
        <button class="shape-like-btn ${liked ? 'is-liked' : ''}" onclick="event.stopPropagation(); event.preventDefault(); toggleTrackHeart('${track.id}', this)" title="내 우주에 모으기">
          <i class="${liked ? 'ri-heart-fill' : 'ri-heart-line'}"></i>
        </button>
      </div>
    `;
  });

  // Inject activity feed below the shapes universe (logged-in only)
  const dbForFeed = window.DB.get();
  const showFeed = dbForFeed && dbForFeed.currentUser && (typeof window.renderActivityFeed === 'function');
  const feedHtml = showFeed ? window.renderActivityFeed() : '';

  // Random-play dice — fixed initial position: top-center.
  // User can long-press to drag it elsewhere within the session.
  const diceX = 50;     // % — horizontal center
  const diceY = 80;     // px from top of universe
  const diceDur = 14;
  const diceDx = 25;
  const diceDy = -15;
  const diceRot = 4;
  const initialFace = 1 + Math.floor(Math.random() * 6);
  const diceHtml = `
    <div class="dice-shape" id="random-dice"
         onmouseenter="diceHoverStart(this)"
         onmouseleave="diceHoverEnd(this)"
         onclick="diceBouncePlay(this)"
         title="마우스 올리면 굴리고, 클릭하면 랜덤 곡 재생"
         style="left:calc(${diceX}% - 34px); top:${diceY}px; animation: floatDrift ${diceDur}s ease-in-out infinite;
                --dx:${diceDx}px; --dy:${diceDy}px; --rot:${diceRot}deg;">
      <div class="die-face" data-face="${initialFace}">
        <span class="die-dot" data-pos="tl"></span>
        <span class="die-dot" data-pos="tm"></span>
        <span class="die-dot" data-pos="tr"></span>
        <span class="die-dot" data-pos="ml"></span>
        <span class="die-dot" data-pos="c"></span>
        <span class="die-dot" data-pos="mr"></span>
        <span class="die-dot" data-pos="bl"></span>
        <span class="die-dot" data-pos="bm"></span>
        <span class="die-dot" data-pos="br"></span>
      </div>
    </div>
  `;

  appContent.innerHTML = `
    <div class="shapes-universe" style="height: ${universeHeight}px;">
      ${decoHtml}
      ${shapesHtml}
      ${diceHtml}
    </div>
    ${feedHtml}
    <div class="upload-fab" onclick="navigateTo('upload')" title="음악 업로드">
      <i class="ri-add-line"></i>
    </div>
  `;

  initShapeDrag();
  initDiceDrag();
}

// ── Unified "like" for tracks (works for both Supabase tracks and mock tracks).
// Reads from window.__favoritedTracks (Supabase cache) or db.currentUser.likedTracks (legacy).
function isTrackLiked(trackId) {
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

// Set the visible face (1-6) by toggling data-face on the .die-face grid
function setDieFace(el, n) {
  const grid = el && el.querySelector('.die-face');
  if (grid) grid.setAttribute('data-face', String(n));
}

// Mouse over → fast-cycle faces (the dice "spins" while hovered).
window.diceHoverStart = function(el) {
  if (!el) return;
  el.classList.add('rolling');
  if (window.__diceFaceTimer) clearInterval(window.__diceFaceTimer);
  window.__diceFaceTimer = setInterval(() => {
    setDieFace(el, 1 + Math.floor(Math.random() * 6));
  }, 70);
};

window.diceHoverEnd = function(el) {
  if (window.__diceFaceTimer) { clearInterval(window.__diceFaceTimer); window.__diceFaceTimer = null; }
  if (el) el.classList.remove('rolling');
  // Keep the last face shown — feels like the dice "settled" wherever it stopped
};

// Click → bounce up once, play a random track. Avoids repeating the last pick.
window.diceBouncePlay = function(el) {
  if (!el) return;
  // Just finished dragging — swallow this synthetic click
  if (el.__suppressNextClick) { el.__suppressNextClick = false; return; }
  if (window.__diceFaceTimer) { clearInterval(window.__diceFaceTimer); window.__diceFaceTimer = null; }

  const db = window.DB.get();
  const pool = (db.tracks || []).filter(t => t && (!t.isDemo || t.pinned));
  if (!pool.length) {
    if (typeof showToast === 'function') showToast('재생할 곡이 없어요');
    return;
  }
  let pick;
  if (pool.length > 1 && window.__lastDiceTrackId) {
    const others = pool.filter(t => t.id !== window.__lastDiceTrackId);
    pick = others[Math.floor(Math.random() * others.length)];
  } else {
    pick = pool[Math.floor(Math.random() * pool.length)];
  }
  window.__lastDiceTrackId = pick.id;

  // Bounce: pause idle drift + remove rolling, then run bounce animation.
  el.classList.remove('rolling');
  el.classList.remove('bouncing');
  // Force reflow so re-adding the class restarts the animation
  void el.offsetWidth;
  el.classList.add('bouncing');
  // Change face at the apex of the bounce
  setTimeout(() => setDieFace(el, 1 + Math.floor(Math.random() * 6)), 230);
  setTimeout(() => el.classList.remove('bouncing'), 700);

  try { playTrack(pick.id); } catch (e) { console.warn('[dice] playTrack', e); }
};

// Back-compat: older onclick="rollRandomTrack(this)" still works
window.rollRandomTrack = function(el) { window.diceBouncePlay(el); };

// ============================================================
// 내 우주 — user's curated collection space
// Liked tracks (masters + demos) + bookmarked post-its, all
// floating in the same shapes-universe canvas. Drag to rearrange.
// ============================================================
window.renderUniverse = async function () {
  const db = window.DB.get();
  if (!db.currentUser) { navigateTo('auth'); return; }

  // Refresh strategy: render cached state first, refresh in background.
  // Only block briefly on first visit (when caches are empty) so we have *something* to show.
  const hasFavCache = window.__favoritedTracks && window.__favoritedTracks.size > 0;
  const hasBmkCache = window.__bookmarkedNotes && window.__bookmarkedNotes.size > 0;
  const refreshTasks = [];
  if (window.Walls && window.Walls.refreshMyBookmarks)   refreshTasks.push(window.Walls.refreshMyBookmarks().catch(()=>{}));
  if (window.Favorites && window.Favorites.refreshMine)  refreshTasks.push(window.Favorites.refreshMine().catch(()=>{}));
  if (refreshTasks.length) {
    if (hasFavCache || hasBmkCache) {
      // Have cached data — fire refresh in background and re-render only if changed
      const sigBefore = (Array.from(window.__favoritedTracks || []).join('|')) + '#'
                      + (Array.from(window.__bookmarkedNotes || []).join('|'));
      Promise.all(refreshTasks).then(() => {
        if (currentView !== 'universe') return;
        const sigAfter = (Array.from(window.__favoritedTracks || []).join('|')) + '#'
                      + (Array.from(window.__bookmarkedNotes || []).join('|'));
        if (sigAfter !== sigBefore) window.renderUniverse();
      });
    } else {
      // No cache — wait briefly so universe isn't empty on first visit; cap at 1.5s
      await Promise.race([
        Promise.all(refreshTasks),
        new Promise(r => setTimeout(r, 1500))
      ]);
      // Bail if user moved on while we were waiting
      if (currentView !== 'universe') return;
    }
  }

  // ── Liked tracks (masters + demos) ───────────────────────
  const likedIds = new Set(db.currentUser.likedTracks || []);
  // Also fold in Supabase favorites cache
  if (window.__favoritedTracks && window.__favoritedTracks.forEach) {
    window.__favoritedTracks.forEach(id => likedIds.add(id));
  }
  const allTracks = db.tracks || [];
  const likedTracks = allTracks.filter(t => t && likedIds.has(t.id));

  // ── Bookmarked notes ─────────────────────────────────────
  const allNotes = db.notes || [];
  let bookmarkedNotes = [];
  if (window.__bookmarkedNotes && window.__bookmarkedNotes.size) {
    const setIds = window.__bookmarkedNotes;
    bookmarkedNotes = allNotes.filter(n => n && setIds.has(n.id));
    // If Supabase has bookmarks for notes not in local cache, fetch them
    try {
      if (window.Walls && window.Walls.fetchMyBookmarks) {
        const fetched = await window.Walls.fetchMyBookmarks();
        const seen = new Set(bookmarkedNotes.map(n => n.id));
        (fetched || []).forEach(n => { if (n && !seen.has(n.id)) bookmarkedNotes.push(n); });
      }
    } catch (e) { console.warn('[universe] fetchMyBookmarks', e); }
  }

  // Empty state
  if (likedTracks.length === 0 && bookmarkedNotes.length === 0) {
    appContent.innerHTML = `
      <div style="max-width:560px; margin:80px auto; text-align:center; padding:0 24px;">
        <div style="font-size:64px; margin-bottom:16px;">🌌</div>
        <h1 style="font-size:24px; margin-bottom:12px;">아직 비어있어요</h1>
        <p style="color:var(--text-secondary); line-height:1.6; margin-bottom:28px;">
          도형 페이지에서 마음에 드는 곡에 <i class="ri-heart-line"></i> 를,<br>
          벽에서 마음에 든 글에 <i class="ri-bookmark-line"></i> 를 눌러보세요.<br>
          모은 것들이 이 우주에 떠다니게 돼요.
        </p>
        <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
          <button class="btn-primary" onclick="navigateTo('shapes')">도형으로 가기 →</button>
          <button class="btn-primary" style="background:#444;" onclick="navigateTo('wall')">우리들의 벽 →</button>
        </div>
      </div>
    `;
    return;
  }

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

  const allItems = [
    ...likedTracks.map(t => ({ kind: 'track', t, id: t.id })),
    ...bookmarkedNotes.map(n => ({ kind: 'note', n, id: n.id }))
  ];
  // Stable order: sort by item id so reloading doesn't rearrange the grid.
  allItems.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const cols = 3;
  const universeHeight = Math.max(900, Math.ceil(allItems.length / cols) * 280);

  // Decorative bg shapes — seeded by index so they stay put across reloads
  let decoHtml = '';
  const decoShapes = ['border-radius:50%', 'border-radius:4px', 'clip-path:polygon(50% 0%,0% 100%,100% 100%)'];
  for (let i = 0; i < 30; i++) {
    const seed = _hashSeed('deco-uni:' + i);
    const size = 8 + (seed % 36);
    const x = (seed >>> 6) % 96;
    const y = (seed >>> 13) % 96;
    const palette = (typeof SHAPE_COLORS !== 'undefined') ? SHAPE_COLORS : ['#FF9800'];
    const color = palette[(seed >>> 20) % palette.length];
    const opacity = 0.12 + (((seed >>> 23) % 40) / 100);
    const dur = 10 + ((seed >>> 26) % 24);
    const shapeStyle = decoShapes[(seed >>> 29) % decoShapes.length];
    const dx = ((seed >>> 4) % 50) - 25;
    const dy = ((seed >>> 11) % 50) - 25;
    const rot = ((((seed >>> 17) % 60) - 30) / 10);
    decoHtml += `<div class="deco-shape" style="width:${size}px;height:${size}px;left:${x}%;top:${y}%;background:${color};opacity:${opacity};${shapeStyle};animation:floatDrift ${dur}s ease-in-out infinite;--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;"></div>`;
  }

  // Item nodes
  let itemsHtml = '';
  allItems.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Per-item deterministic seed → stable jitter + drift animation
    const seed = _hashSeed(it.id);
    const stored = _loadUniversePos(it.id);
    const xBase = stored ? stored.xPct : (4 + col * 30 + (seed % 14));
    const yPx   = stored ? stored.yPx  : (30 + row * 260 + ((seed >>> 4) % 50));
    const rot   = stored && typeof stored.rot === 'number'
      ? stored.rot
      : ((((seed >>> 8) % 140) - 70) / 10);
    const dur = 10 + ((seed >>> 16) % 18);
    const dx  = (((seed >>> 12) % 50) - 25);
    const dy  = (((seed >>> 20) % 50) - 25);

    if (it.kind === 'track') {
      const t = it.t;
      const shape = t.shape || (typeof SHAPE_TYPES !== 'undefined' ? SHAPE_TYPES[i % SHAPE_TYPES.length] : 'circle');
      const color = t.shapeColor || (typeof SHAPE_COLORS !== 'undefined' ? SHAPE_COLORS[i % SHAPE_COLORS.length] : '#FF9800');
      const isTri = shape === 'triangle';
      const bgStyle = isTri
        ? `border-bottom-color:${color}; color:${color}; --shape-bg:${color};`
        : `background:${color}; --shape-bg:${color};`;
      const lines = t.lines || [t.title || '', t.artist || '', '클릭해서 들어봐!'];
      const safeLines = lines.map(l => (l||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
      const demoBadge = t.isDemo ? '<span class="universe-demo-badge">DEMO</span>' : '';
      itemsHtml += `
        <div class="floating-shape shape-${shape}" data-track-id="${t.id}" data-artist="${encodeURIComponent(t.artist || '')}"
             style="${bgStyle} left:${xBase}%; top:${yPx}px; animation: floatDrift ${dur}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${rot}deg;">
          ${demoBadge}
          <div class="shape-text">${safeLines.join('\n')}</div>
          <button class="shape-like-btn is-liked" onclick="event.stopPropagation(); event.preventDefault(); toggleTrackHeart('${t.id}', this); setTimeout(()=>renderUniverse(),250);" title="우주에서 빼기">
            <i class="ri-heart-fill"></i>
          </button>
        </div>
      `;
    } else {
      const n = it.n;
      const c = (typeof NOTE_COLORS !== 'undefined' ? NOTE_COLORS[n.color] : null) || { bg:'#FFF59D', text:'#1a1a1a' };
      const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const safeAuth = (n.author || '').replace(/</g,'&lt;');
      // Notes use the same seeded rotation as shapes for stability
      const noteRot = (typeof n.rotation === 'number') ? n.rotation : rot;
      itemsHtml += `
        <div class="universe-note floating-shape" data-note-id="${n.id}"
             style="left:${xBase}%; top:${yPx}px; background:${c.bg}; color:${c.text}; animation: floatDrift ${dur+4}s ease-in-out infinite; --dx:${dx}px; --dy:${dy}px; --rot:${noteRot}deg;">
          <div class="universe-note-body">${safeTxt}</div>
          <div class="universe-note-sig">— ${safeAuth}</div>
        </div>
      `;
    }
  });

  appContent.innerHTML = `
    <div style="padding:20px 24px 8px; text-align:center;">
      <h1 style="font-size:22px; margin-bottom:4px;"><i class="ri-galaxy-fill" style="color:#9C27B0;"></i> 내 우주</h1>
      <p style="font-size:13px; color:var(--text-secondary);">곡 ${likedTracks.length} · 포스트잇 ${bookmarkedNotes.length} — 끌어서 자리 옮길 수 있어요</p>
    </div>
    <div class="shapes-universe my-universe" style="height: ${universeHeight}px;">
      ${decoHtml}
      ${itemsHtml}
    </div>
  `;

  // Reuse the same drag system as the main shapes page
  if (typeof initShapeDrag === 'function') initShapeDrag();
};

// ===================== DRAG SYSTEM FOR FLOATING SHAPES =====================
function initShapeDrag() {
  const shapes = document.querySelectorAll('.floating-shape');
  let dragEl = null;
  let startX, startY, origLeft, origTop, moved;

  function pointerDown(e) {
    // Skip if clicking the resize handle
    if (e.target.closest('.shape-resize-handle')) return;
    // Skip drag/play handling when the user is clicking the heart button.
    // Without this, mouseup on the shape still fires playTrack on top of the heart toggle.
    if (e.target.closest('.shape-like-btn')) return;
    // Ignore if it's a touch with multiple fingers
    if (e.touches && e.touches.length > 1) return;

    const el = e.currentTarget;
    dragEl = el;
    moved = false;

    const ptr = e.touches ? e.touches[0] : e;
    startX = ptr.clientX;
    startY = ptr.clientY;

    // Pause CSS animation so we can freely position
    el.style.animation = 'none';
    // Read current rendered position
    const rect = el.getBoundingClientRect();
    const universe = el.parentElement.getBoundingClientRect();
    origLeft = rect.left - universe.left + el.parentElement.scrollLeft;
    origTop = rect.top - universe.top + el.parentElement.scrollTop;

    // Switch to px positioning
    el.style.left = origLeft + 'px';
    el.style.top = origTop + 'px';
    el.style.zIndex = '50';
    el.style.transition = 'none';
    el.classList.add('dragging');

    e.preventDefault();
  }

  function pointerMove(e) {
    if (!dragEl) return;
    const ptr = e.touches ? e.touches[0] : e;
    const dx = ptr.clientX - startX;
    const dy = ptr.clientY - startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

    dragEl.style.left = (origLeft + dx) + 'px';
    dragEl.style.top = (origTop + dy) + 'px';
    e.preventDefault();
  }

  function pointerUp(e) {
    if (!dragEl) return;
    const el = dragEl;
    dragEl = null;

    el.classList.remove('dragging');
    el.style.zIndex = '';
    el.style.transition = '';

    // Persist user-curated position on /universe and /shapes.
    // Saves a percentage for x (so it scales with width) and pixels for y.
    if (moved && (currentView === 'universe' || currentView === 'shapes')) {
      const itemId = el.dataset.trackId || el.dataset.noteId;
      if (itemId && el.parentElement) {
        const parentRect = el.parentElement.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const leftPx = elRect.left - parentRect.left;
        const topPx  = elRect.top  - parentRect.top;
        const xPct   = parentRect.width > 0 ? (leftPx / parentRect.width) * 100 : 0;
        const pass   = el.dataset.pass;
        const key    = currentView === 'universe'
          ? 'unipos:' + itemId
          : 'shapepos:' + itemId + ':' + (pass != null ? pass : '0');
        try { localStorage.setItem(key, JSON.stringify({ xPct, yPx: topPx })); }
        catch (_) {}
      }
    }

    // If barely moved, treat as click — first click on a shape plays the song,
    // a second click on the SAME shape (no time limit) navigates to artist page.
    // Clicking a different shape resets: that shape is now the "primed" one.
    if (!moved) {
      const trackId = el.dataset.trackId;
      const artistEnc = el.dataset.artist;
      if (window.__lastClickedShape === el && artistEnc) {
        window.__lastClickedShape = null;
        navigateTo('artist:' + artistEnc);
      } else {
        window.__lastClickedShape = el;
        if (trackId) playTrack(trackId);
      }
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
      pinchEl = e.currentTarget;
      pinchEl.style.animation = 'none';
      pinchStartDist = getPinchDist(e.touches);
      pinchStartScale = parseFloat(pinchEl.dataset.scale || '1');
      e.preventDefault();
    }
  }
  function touchMovePinch(e) {
    if (!pinchEl || e.touches.length < 2) return;
    const dist = getPinchDist(e.touches);
    let scale = pinchStartScale * (dist / pinchStartDist);
    scale = Math.min(3, Math.max(0.3, scale));
    pinchEl.dataset.scale = scale;
    pinchEl.style.transform = `scale(${scale})`;
    e.preventDefault();
  }
  function touchEndPinch(e) {
    if (pinchEl && e.touches.length < 2) pinchEl = null;
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
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', touchStartPinch, { passive: false });

    const handle = el.querySelector('.shape-resize-handle');
    if (handle) {
      handle.addEventListener('mousedown', resizeDown);
      handle.addEventListener('touchstart', resizeDown, { passive: false });
    }
  });

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
        <h3 style="font-size: 16px; margin-bottom: 16px;">More from ${track.artist}</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${artistTracks.map((t, idx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--surface-color); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--surface-hover)'" onmouseout="this.style.background='var(--surface-color)'" onclick="openTrackDetail('${t.id}')">
              <div style="display: flex; align-items: center; gap: 16px;">
                <img src="${t.cover}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">
                <div style="color: var(--text-secondary); font-size: 12px; width: 20px; text-align: center;">${idx + 1}</div>
                <div style="font-size: 14px; font-weight: 500;">${t.title}</div>
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
          <h1 style="font-size: 36px; line-height: 1.2; margin-bottom: 8px;">${track.title}</h1>
          <h2 style="font-size: 18px; color: var(--text-secondary); margin-bottom: 0;">${track.artist} <i class="ri-verified-badge-fill" style="color: var(--brand-color); font-size: 16px; vertical-align: middle;"></i></h2>
        </div>
      </div>
      <img src="${track.cover}" style="width: 220px; height: 220px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); object-fit: cover;">
    </div>

    <!-- Action Bar -->
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--divider); padding-bottom: 12px; margin-bottom: 24px;">
      <div style="display: flex; gap: 8px;">
        <button style="background: transparent; border: 1px solid var(--divider); color: var(--text-primary); padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; transition: border-color 0.2s;" onclick="window.toggleLike('${track.id}')" onmouseover="this.style.borderColor='white'" onmouseout="this.style.borderColor='var(--divider)'"><i class="ri-heart-line"></i> Like</button>
        <button style="background: transparent; border: 1px solid var(--divider); color: var(--text-primary); padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; transition: border-color 0.2s;" onmouseover="this.style.borderColor='white'" onmouseout="this.style.borderColor='var(--divider)'"><i class="ri-repeat-2-line"></i> Repost</button>
        <button style="background: linear-gradient(135deg,#FFD54F,#FF6F61); color:#111; border:none; padding: 8px 16px; font-size: 13px; font-weight:700; border-radius: 20px; cursor:pointer; transition: transform 0.2s, box-shadow 0.2s;" onclick="window.openTrackCard && window.openTrackCard('${track.id}')" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 14px rgba(255,111,97,0.35)'" onmouseout="this.style.transform=''; this.style.boxShadow=''"><i class="ri-image-line"></i> 카드 만들기</button>
        <button style="background: transparent; border: 1px solid var(--divider); color: var(--text-primary); padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; transition: border-color 0.2s;" onclick="window.shareTrackCard && window.shareTrackCard('${track.id}')" onmouseover="this.style.borderColor='white'" onmouseout="this.style.borderColor='var(--divider)'"><i class="ri-share-forward-line"></i> Share</button>
        <button style="background: var(--brand-color); color: white; padding: 8px 16px; font-size: 13px; border-radius: 20px; cursor:pointer; border:none; transition: background 0.2s;" onclick="openPlaylistModal('${track.id}')" onmouseover="this.style.background='var(--brand-hover)'" onmouseout="this.style.background='var(--brand-color)'"><i class="ri-add-line"></i> Playlist</button>
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
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px;">${track.artist}</div>
            ${snsHtml}
            <button class="btn-primary" style="padding: 6px 16px; font-size: 12px; margin-top: 8px;"><i class="ri-user-follow-line"></i> Follow</button>
          </div>
          <div style="flex-grow: 1;">
            ${track.description ? `<div style="line-height: 1.7; color: var(--text-secondary); padding-top: 10px; font-size: 14px; white-space: pre-line;">${track.description}</div>` : '<div style="line-height: 1.7; color: var(--text-secondary); padding-top: 10px; font-size: 14px; font-style: italic;">코멘트가 없습니다.</div>'}
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

function renderUpload() {
  const db = window.DB.get();
  if (!db.currentUser) {
    navigateTo('auth');
    return;
  }

  appContent.innerHTML = `
    <div style="max-width: 600px; margin: 0 auto; padding: 30px;" class="card">
      <h1 style="margin-bottom: 8px;">음원 업로드</h1>
      <p style="color:var(--text-secondary); font-size:13px; margin-bottom: 24px;">
        데모부터 마스터까지 — 한 프로젝트 안에 여러 버전을 차곡차곡 쌓을 수 있어요 🎵
      </p>

      <!-- Tier 1: 마스터 단독 vs 프로젝트 -->
      <div class="upload-type-toggle">
        <label class="upload-type-opt active" data-mode="master_solo">
          <input type="radio" name="up-mode" value="master_solo" checked>
          <div class="upload-type-icon">🎵</div>
          <div class="upload-type-label">마스터</div>
          <div class="upload-type-sub">완성된 단독 곡</div>
        </label>
        <label class="upload-type-opt" data-mode="project">
          <input type="radio" name="up-mode" value="project">
          <div class="upload-type-icon">✏️</div>
          <div class="upload-type-label">프로젝트</div>
          <div class="upload-type-sub">시리즈로 진행</div>
        </label>
      </div>

      <form id="upload-form">
        <!-- Tier 2: 프로젝트 하위 옵션 (mode=project일 때만 보임) -->
        <div id="project-substep" style="display:none;">
          <div class="form-group">
            <label>어느 프로젝트?</label>
            <div class="upload-type-toggle compact">
              <label class="upload-type-opt active" data-proj-choice="new">
                <input type="radio" name="up-proj-choice" value="new" checked>
                <div class="upload-type-icon" style="font-size:20px;">🆕</div>
                <div class="upload-type-label">새 프로젝트 시작</div>
              </label>
              <label class="upload-type-opt" data-proj-choice="existing">
                <input type="radio" name="up-proj-choice" value="existing">
                <div class="upload-type-icon" style="font-size:20px;">📁</div>
                <div class="upload-type-label">기존 프로젝트</div>
              </label>
            </div>
          </div>

          <div id="existing-project-picker" style="display:none;">
            <div class="form-group">
              <select class="form-control" id="up-project-id">
                <option value="">불러오는 중...</option>
              </select>
              <div id="existing-version-info" style="font-size:13px; color:var(--text-secondary); margin-top:6px;"></div>
            </div>
          </div>

          <div class="form-group">
            <label>이번 업로드는?</label>
            <div class="upload-type-toggle compact">
              <label class="upload-type-opt active" data-version-type="demo">
                <input type="radio" name="up-version-type" value="demo" checked>
                <div class="upload-type-icon" style="font-size:20px;">📝</div>
                <div class="upload-type-label">데모</div>
                <div class="upload-type-sub">진행 중 버전</div>
              </label>
              <label class="upload-type-opt" data-version-type="master">
                <input type="radio" name="up-version-type" value="master">
                <div class="upload-type-icon" style="font-size:20px;">⭐</div>
                <div class="upload-type-label">마스터</div>
                <div class="upload-type-sub">최종 완성본</div>
              </label>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>곡 제목 <span id="up-title-hint" style="color:var(--text-secondary); font-weight:normal;"></span></label>
          <input type="text" class="form-control" id="up-title" required placeholder="예: 한밤의 드라이브">
        </div>
        <div class="form-group">
          <label>버전 라벨</label>
          <input type="text" class="form-control" id="up-version-label" value="Final" placeholder="예: Final, Demo 1, Pre-master">
          <div class="form-note">카드에 표시될 이름. 자동으로 채워지지만 자유롭게 수정 가능.</div>
        </div>

        <div class="form-group">
          <label>커버 이미지 (선택)</label>
          <input type="file" class="form-control" id="up-cover" accept="image/*">
        </div>
        <div class="form-group">
          <label>오디오 파일 첨부 <span id="up-audio-size" style="color:var(--text-secondary); font-weight:normal;"></span></label>
          <input type="file" class="form-control" id="up-audio" accept="audio/*" required
                 onchange="(function(el){var f=el.files[0];if(!f)return;var mb=(f.size/1048576).toFixed(1);var lbl=document.getElementById('up-audio-size');if(lbl)lbl.textContent=' · '+mb+'MB'+(f.size>50*1048576?' ⚠️ 50MB 초과 - 거부됨':'');})(this)">
          <div class="form-note">최대 50MB · mp3/m4a/wav 지원 · 크면 업로드가 느림</div>
        </div>
        <div class="form-group">
          <label>유튜브 개인 채널 / M/V 링크 (선택)</label>
          <input type="text" class="form-control" id="up-youtube" placeholder="유튜브 영상 URL (예: https://youtube.com/watch?v=...)">
        </div>
        <div class="form-group">
          <label>곡 소개 및 코멘트 (선택)</label>
          <textarea class="form-control" id="up-description" rows="3" placeholder="이 곡에 얽힌 이야기나 리스너들에게 전하고 싶은 멘트를 자유롭게 적어주세요."></textarea>
        </div>
        <div class="form-group">
          <label><i class="ri-hashtag" style="color:var(--brand-color);"></i> 태그 (콤마로 구분, 선택)</label>
          <input type="text" class="form-control" id="up-tags" placeholder="예: 1982년 느낌, funky, 고2 기타과 음악">
          <div class="form-note">장르·무드·학년·연도 등 자유롭게. 다른 학생들이 #태그로 곡을 찾습니다.</div>
        </div>

        <!-- Distribution metadata — shown only when uploading a master -->
        <div id="distribution-section" style="display:block;">
          <hr style="border-color: var(--divider); margin: 20px 0;">
          <h2 style="font-size: 18px; color: var(--brand-color); margin-bottom: 4px;"><i class="ri-folder-zip-line"></i> 유통용 메타데이터</h2>
          <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">유통사 제출용 정보. 비워두면 활동명 + 오늘 날짜로 들어가요.</p>
          <div class="form-group">
            <label>발매일</label>
            <input type="date" class="form-control" id="up-release-date">
          </div>
          <div class="form-group">
            <label>유통용 아티스트명 <span style="color:var(--text-secondary); font-weight:normal; font-size:12px;">(실명/예명 — 활동명과 다를 때만)</span></label>
            <input type="text" class="form-control" id="up-dist-artist" placeholder="비워두면 활동명 사용">
          </div>
          <div class="form-group">
            <label>콜라보 아티스트 <span style="color:var(--text-secondary); font-weight:normal; font-size:12px;">(콤마로 구분)</span></label>
            <input type="text" class="form-control" id="up-collaborators" placeholder="예: 김작곡, 박보컬">
          </div>
        </div>

        <hr style="border-color: var(--divider); margin: 20px 0;">
        <h2 style="font-size: 18px; color: var(--brand-color); margin-bottom: 4px;"><i class="ri-shapes-fill"></i> 도형 낙서 (3줄)</h2>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">메인에 뜨는 도형에 적힐 내용. 아무거나 자유롭게!</p>
        <div class="form-group">
          <label>1줄</label>
          <input type="text" class="form-control" id="up-line1" placeholder="#my music is the best" maxlength="40">
        </div>
        <div class="form-group">
          <label>2줄</label>
          <input type="text" class="form-control" id="up-line2" placeholder="#고3이 작곡했어 들어봐라!" maxlength="40">
        </div>
        <div class="form-group">
          <label>3줄</label>
          <input type="text" class="form-control" id="up-line3" placeholder="#음원명: 청춘 장영찬 메롱" maxlength="40">
        </div>
        <div class="form-group">
          <label>도형 모양</label>
          <select class="form-control" id="up-shape">
            <option value="circle">⬤ 원</option>
            <option value="oval">⬮ 타원</option>
            <option value="rect">▬ 사각형</option>
            <option value="triangle">▲ 삼각형</option>
            <option value="star">★ 별</option>
            <option value="diamond">◆ 다이아</option>
            <option value="hexagon">⬡ 육각형</option>
            <option value="parallelogram">▱ 평행사변형</option>
          </select>
        </div>
        <div class="form-group">
          <label>도형 색상</label>
          <input type="color" class="form-control" id="up-shape-color" value="#FF4081" style="height:44px; padding:4px;">
        </div>

        <hr style="border-color: var(--divider); margin: 30px 0;">

        <h2 style="font-size: 18px; color: var(--brand-color);">음원 업로드 약관</h2>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">Off-Stage 플랫폼 업로드 및 재생에 관한 동의서입니다.</p>

        <div class="agreement-box">
          <strong>제 1조 (목적)</strong><br>
          본 합의는 Off-Stage를 통해 업로드된 음원에 대해 플랫폼 내 스트리밍 및 공유에 필요한 권한을 부여함을 목적으로 합니다.<br><br>
          <strong>제 2조 (저작권 및 이용 허락)</strong><br>
          업로더는 창작한 곡에 대한 모든 저작권을 소유하며, Off-Stage는 해당 곡을 플랫폼 스트리밍 및 공유를 위해 재생산·배포할 수 있는 비독점적 권한을 가집니다.<br><br>
          <strong>제 3조 (외부 유통 연계)</strong><br>
          유통을 신청한 곡은 플랫폼의 검수를 거친 뒤, 파트너 유통사와의 정식 발매 계약으로 연결될 수 있습니다. 계약 체결 시 별도 서면 계약이 요구될 수 있습니다.
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="up-agree" required>
            위 음원 유통 및 서비스 이용 약관에 동의합니다. (필수)
          </label>
        </div>

        <button type="submit" class="btn-primary" style="width: 100%; padding: 14px; font-size: 16px;">
          동의하고 업로드 완료하기
        </button>
      </form>
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
    const mode    = (document.querySelector('input[name="up-mode"]:checked') || {}).value || 'master_solo';
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
      projectSelect.innerHTML = '<option value="">아직 시작한 프로젝트가 없어요 — "새 프로젝트 시작"으로 첫 곡 올려보세요</option>';
      return;
    }
    projectSelect.innerHTML = _myProjects.map(p =>
      `<option value="${p.projectId}">${(p.title||'무제').replace(/"/g,'&quot;')} · 데모 ${p.demoCount}개${p.hasFinal?' · ✦ 완성됨':''}</option>`
    ).join('');
    refreshExistingInfo();
  }
  function refreshExistingInfo() {
    if (!projectSelect || !verInfo) return;
    const pid = projectSelect.value;
    const p = _myProjects.find(x => x.projectId === pid);
    if (!p) { verInfo.innerHTML = ''; return; }
    const next = p.nextDemoNum || (p.demoCount + 1);
    verInfo.innerHTML = `<strong>${p.title}</strong> — 데모 ${p.demoCount}개${p.hasFinal?' + 마스터':''}. 다음 데모: <strong>Demo ${next}</strong>`;
    if (titleInput && !titleInput.dataset.userTyped) {
      titleInput.value = p.title;
      titleHint.textContent = '(프로젝트 제목 자동 반영)';
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

  // Generic toggle: clicking a label updates the group's active class + checks its radio
  function wireToggleGroup(groupSelector, afterChange) {
    document.querySelectorAll(groupSelector + ' .upload-type-opt').forEach(opt => {
      opt.addEventListener('click', () => {
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
  });
  // Tier 2b — demo vs master version type
  wireToggleGroup('#project-substep .upload-type-toggle.compact:last-of-type', () => {
    syncVersionLabel();
    syncDistributionSection();
  });

  if (projectSelect) projectSelect.addEventListener('change', refreshExistingInfo);
  if (titleInput) titleInput.addEventListener('input', () => { titleInput.dataset.userTyped = '1'; });
  if (verLabelInput) verLabelInput.addEventListener('input', () => { verLabelInput.dataset.userTyped = '1'; });

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

      // Determine upload type from new two-tier state
      const state = getUploadState();
      const isFinal = state.isFinal;
      const versionLabel = (verLabelInput.value || '').trim() || (isFinal ? 'Final' : 'Demo 1');

      // master_solo  → no project context, brand new projectId
      // project+new  → brand new projectId, isFinal follows version-type
      // project+existing → reuse existing projectId, demote old final if needed
      let existingProject = null;
      const usingExistingProject = (state.mode === 'project' && state.choice === 'existing');
      if (usingExistingProject) {
        const pid = projectSelect.value;
        if (!pid) throw new Error('기존 프로젝트를 선택해주세요.');
        existingProject = _myProjects.find(p => p.projectId === pid);
        if (!existingProject) throw new Error('선택한 프로젝트를 찾을 수 없어요.');
        if (isFinal && existingProject.hasFinal) {
          if (!confirm('이 프로젝트는 이미 마스터가 있어요. 기존 마스터는 이전 버전으로 밀려나고 이 곡이 새 마스터가 돼요. 계속할까요?')) {
            throw new Error('취소됨');
          }
        }
      }

      // Upload files to Supabase Storage
      let coverUrl = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500';
      let audioUrl = '';

      if (!window.Tracks) throw new Error('Supabase가 준비되지 않았어요.');

      setStatus('오디오 업로드 중…');
      audioUrl = await window.Tracks.uploadFile(audioFile, 'audio');
      if (coverFile) {
        setStatus('커버 업로드 중…');
        coverUrl = await window.Tracks.uploadFile(coverFile, 'covers');
      } else if (existingProject && existingProject.cover) {
        coverUrl = existingProject.cover;
      }

      const tagsRaw = document.getElementById('up-tags').value || '';
      const tags = tagsRaw.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
      const title = titleInput.value;
      const description = document.getElementById('up-description').value;
      const line1 = (document.getElementById('up-line1') || {}).value || '';
      const line2 = (document.getElementById('up-line2') || {}).value || '';
      const line3 = (document.getElementById('up-line3') || {}).value || '';
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

      await window.Tracks.insert({
        title,
        description,
        audioUrl,
        cover: coverUrl,
        projectId,
        version,
        versionLabel,
        isDemo: !isFinal,
        tags,
        shape: shapeEl ? shapeEl.value : 'circle',
        shapeColor: colorEl ? colorEl.value : '#FF4081',
        lines: [
          line1 || '#' + title,
          line2 || '#' + user.name,
          line3 || '#클릭해서 들어봐!'
        ],
        // Distribution metadata (admin ZIP uses these). Empty for demos.
        distArtist,
        releaseDate,
        collaborators
      });

      await window.Tracks.refreshInto(db);

      showToast(isFinal ? '마스터 완성! ✨' : '데모 업로드 완료 🎵');
      navigateTo('profile');
    } catch (err) {
      alert('업로드 실패: ' + (err.message || err));
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '동의하고 업로드 완료하기'; }
    }
  });
}

// (Studio booking feature removed)

// ===================== 5. PROFILE & SETTINGS =====================

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

  // Defensive defaults — never crash if db arrays are missing
  if (!Array.isArray(followedArtists)) followedArtists = [];
  if (!Array.isArray(bookmarkedNotes)) bookmarkedNotes = [];
  if (!Array.isArray(myPlaylists)) myPlaylists = [];

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
  // window.__profileMode forces a specific view ('me' = listener, 'studio' = artist).
  // 'profile' (legacy) leaves it null → auto by role.
  const role = db.currentUser.role;
  const naturalIsArtist = role === 'admin' || role === 'artist' || role === 'student';
  const mode = window.__profileMode || null;

  // Listener tries to open the artist page → show upgrade card and stop.
  if (mode === 'studio' && !naturalIsArtist) {
    appContent.innerHTML = `
      <div class="sub-page" style="max-width:560px; margin:60px auto; padding:32px 24px; text-align:center;">
        <div style="font-size:48px; margin-bottom:14px;">🎤</div>
        <h2 style="margin:0 0 10px; font-size:22px;">아티스트 페이지는 아티스트 전용이에요</h2>
        <p style="color:var(--text-secondary); font-size:14px; line-height:1.6; margin:0 0 22px;">
          음악을 올리려면 아티스트로 전환해야 해요.<br>
          전환은 무료고, 청취자 기능은 그대로 유지돼요.
        </p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn-primary" onclick="if(confirm('아티스트로 전환할까요?')) navigateTo(\'upload\')"><i class="ri-upload-2-line"></i> 아티스트로 전환</button>
          <button class="btn-primary" style="background:#333;" onclick="navigateTo('me')"><i class="ri-headphone-fill"></i> 내 페이지(청취자)로</button>
        </div>
      </div>
    `;
    return;
  }

  const isArtist = (mode === 'studio') ? true
                 : (mode === 'me')     ? false
                 : naturalIsArtist;
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
        <div class="artist-action-title">새 음악 올리기</div>
        <div class="artist-action-sub">데모 / 마스터</div>
      </div>
      <div class="artist-action-card diary-action" onclick="openArtistDiary()">
        <div class="artist-action-icon"><i class="ri-quill-pen-fill"></i></div>
        <div class="artist-action-title">작업일지 / 미션</div>
        <div class="artist-action-sub">우리들의 벽에 글쓰기</div>
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
  const followingSection = '';

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
      <h2 class="section-title"><i class="ri-folder-music-fill"></i> 내 음악 폴더${myPlaylists.length > 0 ? ` <span class="section-count">${myPlaylists.length}</span>` : ''}</h2>
      <div class="folder-grid">
        ${userFolderCardsHtml}
        ${showDefaultFolders ? defaultFolderCardsHtml : ''}
        <div class="folder-card folder-card-new" onclick="promptNewPlaylist()">
          <div class="folder-card-cover-stack folder-card-cover-new">
            <i class="ri-add-line"></i>
          </div>
          <div class="folder-card-body">
            <div class="folder-card-title">새 폴더</div>
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

    // ── Tab 1 (▲ 투자): SPO trading cards + 함께 만드는 아티스트 (Pokemon-style tama cards) ──
    const tab1Content = `
      ${myBackings.length > 0 ? `
        <h3 class="tab-section-head"><i class="ri-coin-line"></i> 함께 만든 곡 <span class="section-count">${myBackings.length}</span></h3>
        <div class="spo-card-grid">${stoTradingCardsHtml}</div>
      ` : `
        <div class="empty-tab-message">아직 함께 만든 곡이 없어요.<br>아티스트 페이지에서 💎 함께 만들기를 눌러보세요.</div>
      `}
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

    // ── Assemble listener body — tabs (icons only) + panels ──
    listenerBody = `
      <div class="reveal listener-tabs" role="tablist">
        <button class="listener-tab active" data-tab="cards" onclick="switchListenerTab('cards')" role="tab" title="투자 카드">
          <i class="ri-triangle-fill"></i>
        </button>
        <button class="listener-tab" data-tab="folders" onclick="switchListenerTab('folders')" role="tab" title="즐겨듣기">
          <i class="ri-circle-fill"></i>
        </button>
        <button class="listener-tab" data-tab="notes" onclick="switchListenerTab('notes')" role="tab" title="포스트잇">
          <i class="ri-checkbox-blank-fill"></i>
        </button>
        <button class="listener-tab" data-tab="data" onclick="switchListenerTab('data')" role="tab" title="데이터">
          <i class="shape-diamond">◆</i>
        </button>
      </div>
      <div class="reveal listener-tab-panels">
        <div class="tab-panel active" data-tab="cards">${tab1Content}</div>
        <div class="tab-panel" data-tab="folders">${playlistSection || '<div class="empty-tab-message">아직 폴더가 없어요.</div>'}</div>
        <div class="tab-panel" data-tab="notes">${mePostitsSection || '<div class="empty-tab-message">아직 포스트잇이 없어요.</div>'}</div>
        <div class="tab-panel" data-tab="data">${dataTabContent}</div>
      </div>
    `;
  }

  const body = isArtist
    ? `${myMusicSection}${followingSection}${playlistSection}${bookmarkedSection}${myNotesSection}${stoSection}`
    : listenerBody;

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
      <h1 style="margin-bottom: 24px;"><i class="ri-settings-4-fill"></i> 프로필 설정</h1>
      <form id="edit-profile-form">
        <div class="form-group">
          <label>활동명 (Artist Name)</label>
          <input type="text" class="form-control" id="edit-name" value="${db.currentUser.name}" required>
        </div>
        <div class="form-group">
          <label>프로필 이미지 (URL 또는 파일 업로드)</label>
          <input type="text" class="form-control" id="edit-avatar-url" value="${db.currentUser.avatar}" placeholder="이미지 URL (예: https://...)">
          <div style="text-align: center; margin: 12px 0; color: var(--text-secondary); font-size: 13px;">&mdash; 또는 &mdash;</div>
          <input type="file" class="form-control" id="edit-avatar-file" accept="image/*">
          <div class="form-note">파일을 업로드하면 입력된 URL보다 우선 적용됩니다.</div>
        </div>

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

        <h2 style="font-size: 18px; border-bottom: 1px solid var(--divider); padding-bottom: 10px; margin: 30px 0 20px;">계정 설정</h2>

        <div class="form-group">
          <label>신분 (Role)</label>
          <input type="text" class="form-control" value="${db.currentUser.role === 'admin' ? '관리자 (Admin)' : (db.currentUser.role === 'artist' || db.currentUser.role === 'student') ? '아티스트 (Creator)' : 'Collection (Fan)'}" disabled style="opacity: 0.5; background: var(--bg-color);">
        </div>

        <div class="form-group">
          <label>이메일</label>
          <input type="text" class="form-control" value="${db.currentUser.email || '-'}" disabled style="opacity: 0.5; background: var(--bg-color);">
          <div class="form-note">이메일은 변경할 수 없습니다.</div>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 30px;">
          <button type="submit" class="btn-primary" style="flex: 1;">변경사항 저장</button>
          <button type="button" class="btn-primary" style="flex: 1; background: #333;" onclick="navigateTo('profile')">취소</button>
        </div>
      </form>
    </div>
  `;

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

    let step = 'init';
    try {
      clearError();
      console.log('[edit-profile] start');

      step = 'session check';
      // Refresh session in case it's about to expire
      if (window.supabase) {
        try {
          const { data: { session } } = await window.supabase.auth.getSession();
          if (!session) throw new Error('로그인 세션이 없어요. 다시 로그인해주세요.');
          if (session.expires_at && session.expires_at - Math.floor(Date.now()/1000) < 120) {
            console.log('[edit-profile] refreshing session');
            await window.supabase.auth.refreshSession();
          }
        } catch (e) { throw new Error('세션 확인 실패: ' + (e.message || e)); }
      }

      step = 'read fields';
      const newName = document.getElementById('edit-name').value.trim();
      const avatarUrl = document.getElementById('edit-avatar-url').value.trim();
      const avatarFile = document.getElementById('edit-avatar-file').files[0];

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
      const sns = {
        instagram: document.getElementById('edit-sns-instagram').value.trim(),
        youtube:   document.getElementById('edit-sns-youtube').value.trim(),
        tiktok:    document.getElementById('edit-sns-tiktok').value.trim(),
        twitter:   document.getElementById('edit-sns-twitter').value.trim()
      };

      if (window.supabase && window.__currentUser) {
        if (submitBtn) submitBtn.textContent = '프로필 저장 중…';
        console.log('[edit-profile] update profiles row id:', window.__currentUser.id);
        const { error: upErr } = await window.supabase
          .from('profiles')
          .update({
            name: newName,
            avatar_url: finalAvatarUrl,
            sns_instagram: sns.instagram || null,
            sns_youtube:   sns.youtube || null,
            sns_tiktok:    sns.tiktok || null,
            sns_twitter:   sns.twitter || null
          })
          .eq('id', window.__currentUser.id);
        if (upErr) throw new Error('DB 업데이트 실패: ' + upErr.message);

        step = 'sync caches';
        if (window.Auth && window.Auth.bootstrap) await window.Auth.bootstrap();
        if (window.Tracks && window.Tracks.refreshInto) await window.Tracks.refreshInto(window.DB.get());
      } else {
        // Fallback (no Supabase) — write localStorage
        db.currentUser.name = newName;
        db.currentUser.avatar = finalAvatarUrl;
        db.currentUser.sns = sns;
        window.DB.save(db);
      }

      console.log('[edit-profile] done');
      updateHeaderAuth();
      showToast('프로필 저장 완료 ✨');
      navigateTo('profile');
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

  // Responsive columns — 카드가 16:9 landscape 느낌으로 충분히 넓도록
  // 모바일 1, 태블릿 2, 데스크탑 2 (3·4 cols면 카드가 좁아서 portrait처럼 보임)
  const w = (typeof window !== 'undefined') ? window.innerWidth : 1024;
  const baseCols = w < 560 ? 1 : 2;
  const cols = Math.min(baseCols, Math.max(1, demos.length || 1));

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

  // Snake cards — DEMOS ONLY (with 함께만들기 progress badge per demo)
  const firstTrackId = (demos[0] || final || {}).id;
  const cardsHtml = demos.map((v, i) => {
    const label = (v.versionLabel || v.version || 'Version').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const dateLabel = formatFullDate(v.createdAt);
    const pos = snakePos(i, cols);
    const arrow = snakeArrow(i, demos.length, cols);
    const cls = [
      'demo-card',
      'is-demo',
      arrow ? 'arrow-' + arrow : '',
      v.id === firstTrackId ? 'is-selected' : ''
    ].join(' ');
    // 함께 만들기(STO) 후원 기능 — UI 숨김. 백엔드 데이터는 유지하지만 카드엔 표시 안 함.
    const stoBadgeHtml = '';
    // ⚙ Shape picker button — artist self only, opens modal
    const shapeOpenBtnHtml = canEditArtist ? `
      <button class="demo-shape-open-btn" title="메인 노출 도형 선택"
              onclick="event.stopPropagation(); openShapePicker('${v.id}','${pid}')">
        <i class="ri-shape-line"></i>
      </button>
    ` : '';

    // Artist note shown ON the demo card — # 라인 그대로 (최대 3줄)
    // 예: #드럼 연주했는데 아쉽다 / #다음 곡은 피아노까지 녹음해볼게
    const noteRaw = (v.artistNote || '').trim();
    const noteEsc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const noteLines = noteRaw ? noteRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 3) : [];
    const noteHtml = noteLines.length > 0
      ? `<div class="demo-card-note">${noteLines.map(l => `<span class="demo-card-note-line">${noteEsc(l)}</span>`).join('')}</div>`
      : '';

    // ── 카드 내부 인라인 댓글 + 입력 ── (안내 문구 없음, 덕질 컨셉)
    const cmList = v.trackComments || [];
    const cmInlineHtml = cmList.slice(0, 5).map(cm => {
      const cmSafe = noteEsc(cm.text || '');
      const cmAuth = noteEsc(cm.author || '익명');
      return `<div class="demo-card-cm-line"><span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${cmSafe}</span><span class="demo-card-cm-author">— ${cmAuth}</span></div>`;
    }).join('');

    // 후원자만 인라인 입력. 미후원자는 상단 우측 💎 뱃지가 단일 invest CTA — 하단엔 아무것도 표시 안 함
    const inputInlineHtml = canComment ? `
      <div class="demo-card-cm-input" onclick="event.stopPropagation();">
        <input type="text" id="tct-${v.id}" class="demo-card-cm-input-field" placeholder="" onkeypress="if(event.key==='Enter'){ event.preventDefault(); submitTrackComment('${v.id}'); }">
        <button class="demo-card-cm-send" onclick="event.stopPropagation(); submitTrackComment('${v.id}')" aria-label="남기기"><i class="ri-arrow-right-line"></i></button>
      </div>` : '';

    const demoLiked = isTrackLiked(v.id);
    return `
      <div class="${cls} ${v.pinned ? 'is-pinned' : ''}" data-track-id="${v.id}" data-project="${pid}"
           style="grid-row:${pos.row}; grid-column:${pos.col};"
           onclick="selectProjectVersion('${pid}','${v.id}'); playTrack('${v.id}')">
        <div class="demo-card-top">
          <span class="demo-tag">DEMO ${i+1}</span>
          ${shapeOpenBtnHtml}
          ${stoBadgeHtml}
          <button class="demo-card-like ${demoLiked ? 'is-liked' : ''}" onclick="event.stopPropagation(); event.preventDefault(); toggleTrackHeart('${v.id}', this)" title="내 우주에 모으기">
            <i class="${demoLiked ? 'ri-heart-fill' : 'ri-heart-line'}"></i>
          </button>
        </div>
        ${noteHtml}
        <div class="demo-card-cm-list">${cmInlineHtml}</div>
        ${inputInlineHtml}
      </div>
    `;
  }).join('');

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
          <div class="scribble-title">✎ 이 ${isDemo ? '데모' : '마스터'}에 낙서 <span class="scribble-title-hint">— 후원한 분만</span></div>
          ${commentsHtml}
          ${canComment ? `
            <div class="scribble-input-row">
              <input type="text" id="tca-${v.id}" class="scribble-input scribble-name-input" placeholder="이름 (없어도 됨)" value="${db.currentUser?.name || ''}">
              <input type="text" id="tct-${v.id}" class="scribble-input" placeholder="ㄴ 하고 싶은 말 적어봐..." onkeypress="if(event.key==='Enter') submitTrackComment('${v.id}')">
              <button class="scribble-send" onclick="submitTrackComment('${v.id}')">남기기</button>
            </div>
          ` : `
            <div class="scribble-locked">
              <div class="scribble-locked-text">💎 후원한 분만 낙서를 남길 수 있어요</div>
              <button class="scribble-locked-cta" onclick="event.stopPropagation(); openStoMini('${v.id}', '${(v.title||'').replace(/'/g,"\\'")}', '${(v.artist||'').replace(/'/g,"\\'")}')">함께 만들기 →</button>
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
      ? `작업 중 · 데모 ${demoCount}개`
      : '마스터';

  // Edit cover button — only for project owner with Supabase tracks
  const canEditCover = canEditArtist && primary.__supabase;
  const editCoverBtn = canEditCover ? `
    <button class="cover-edit-btn" onclick="event.stopPropagation(); changeProjectCover('${pid}')" title="커버 사진 바꾸기">
      <i class="ri-image-edit-line"></i>
    </button>
  ` : '';

  const coverHtml = final ? `
    <div class="project-cover-wrap" onclick="playTrack('${final.id}'); selectProjectVersion('${pid}','${final.id}')" title="마스터 재생">
      <img src="${final.cover || primary.cover}" class="project-cover-large" alt="${safeTitle}" loading="lazy">
      <div class="project-play-overlay"><i class="ri-play-fill"></i></div>
      <div class="project-master-badge">✦ MASTER</div>
      ${editCoverBtn}
    </div>
  ` : `
    <div class="project-cover-wrap no-master">
      <img src="${primary.cover}" class="project-cover-large" alt="${safeTitle}" loading="lazy">
      <div class="project-wip-badge">작업 중</div>
      ${editCoverBtn}
    </div>
  `;

  // version-panels는 데모 카드 안으로 흡수됨 — 하단 MEMO & COMMENTS 섹션 제거
  return `
    <div class="project-box reveal" data-project="${pid}">
      <div class="project-header">
        ${coverHtml}
        <div class="project-header-info">
          <h3 class="project-title">「${safeTitle}」</h3>
          ${masterDate ? `<div class="project-master-date">${final ? '발매' : '시작'} · ${masterDate}</div>` : ''}
          ${participantCount > 0 ? `<div class="project-participants project-cheers"><i class="ri-heart-pulse-fill"></i> ${participantCount}명이 응원해</div>` : ''}
        </div>
      </div>
      ${demos.length > 0 ? `
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
    showToast('메인 노출 해제');
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
    showToast(`${shapeKey === 'star' ? '⭐' : shapeKey === 'circle' ? '●' : shapeKey === 'triangle' ? '▲' : shapeKey === 'diamond' ? '◆' : '🔷'} 메인 노출 도형 변경됨`);
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
    showToast('로그인 후 투표 가능');
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
    showToast(isBacker ? '🗳 후원자 표 반영됨 (2×)' : '🗳 표 반영됨');
  } else {
    showToast('표 취소됨');
  }
};

// Stage advance handler
window.setProjectStageHandler = async function(projectId, stage) {
  if (!window.Tracks) return;
  try {
    await window.Tracks.setProjectStage(projectId, stage);
    showToast('단계 변경됨 ✨');
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

  let newComment = null;
  try {
    if (isSupabaseTrack && window.Tracks) {
      newComment = await window.Tracks.addComment(trackId, { text, authorName });
    } else {
      newComment = {
        id: 'tc' + Date.now(),
        author: authorName || '익명',
        text,
        createdAt: new Date().toISOString()
      };
      window.DB.addTrackComment(trackId, newComment);
    }
    // Sync into db.tracks cache so future renders show it
    if (track) {
      if (!Array.isArray(track.trackComments)) track.trackComments = [];
      track.trackComments.push(newComment);
    }
  } catch (e) {
    alert('댓글 저장 실패: ' + (e.message || e));
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '남기기'; }
    return;
  }
  if (txtEl) txtEl.value = '';

  // In-place DOM update — 데모 카드 내부의 .demo-card-cm-list 에 ㄴ 추가
  try {
    const cmSafe = (newComment.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cmAuth = (newComment.author || '익명').replace(/</g,'&lt;');

    // 새 구조: .demo-card[data-track-id] .demo-card-cm-list
    const card = document.querySelector(`.demo-card[data-track-id="${trackId}"]`);
    if (card) {
      const list = card.querySelector('.demo-card-cm-list');
      if (list) {
        const empty = list.querySelector('.demo-card-cm-empty');
        if (empty) empty.remove();
        const lineEl = document.createElement('div');
        lineEl.className = 'demo-card-cm-line';
        lineEl.innerHTML = `<span class="demo-card-cm-arrow">ㄴ</span><span class="demo-card-cm-text">${cmSafe}</span><span class="demo-card-cm-author">— ${cmAuth}</span>`;
        list.appendChild(lineEl);
      }
    }
    // 구 구조 호환 (혹시 다른 페이지에서 version-panel 사용 시)
    const panel = document.querySelector(`.version-panel[data-track-id="${trackId}"]`);
    if (panel) {
      const list = panel.querySelector('.demo-comments');
      const inputRow = panel.querySelector('.scribble-input-row');
      if (list && inputRow) {
        const noOne = list.querySelector('.no-comments');
        if (noOne) noOne.remove();
        const ci = list.querySelectorAll('.comment-line').length;
        const lineEl = document.createElement('div');
        lineEl.className = 'comment-line';
        lineEl.style.paddingLeft = (Math.min(ci, 4) * 14 + 4) + 'px';
        lineEl.innerHTML = `<span class="comment-arrow">ㄴ</span><span class="comment-text">${cmSafe}</span><span class="comment-author">— ${cmAuth}</span>`;
        inputRow.parentNode.insertBefore(lineEl, inputRow);
      }
    }
    showToast('낙서 남겼어요 ✍️');
  } catch (e) {
    console.warn('[submitTrackComment] in-place update', e);
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '남기기'; }
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
    showToast(backing ? '참여했어요 🤝' : '참여 취소됐어요');
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
    showToast('커버 업로드 중…');
    try {
      const url = await window.Tracks.uploadFile(file, 'covers');
      await window.Tracks.setProjectCover(projectId, url);
      // Refresh cache + re-render current view
      await window.Tracks.refreshInto(window.DB.get());
      showToast('커버 바꿨어요 ✨');
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
    showToast('🎉 마스터로 승격됐어요!');
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
      // Mirror into db.tracks
      t.artistNote = cleanedNote;
    } else {
      window.DB.setArtistNote(trackId, cleanedNote);
    }
  } catch (e) {
    alert('저장 실패: ' + (e.message || e));
    return;
  }

  // Re-render current view, keep version open
  if (currentView === 'artist') {
    const h = document.querySelector('.artist-strip h1');
    if (h) {
      renderArtistProfile(h.textContent.trim());
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

// === Active artist profile (restored) ===
function renderArtistProfile(artistName) {
  const db = window.DB.get();
  const artistTracks = db.tracks.filter(t => t.artist === artistName);
  // Include both: notes the artist wrote + notes that mention this artist (fan messages)
  const artistNotes = (db.notes || []).filter(n => {
    if (!n) return false;
    if (n.author === artistName) return true;
    const t = (n.text || '');
    // Listener응원 messages mention the artist by name in body
    return t.includes(artistName);
  });
  const artistData = (db.following || []).find(a => a.name === artistName) || {};
  const avatar = artistTracks[0]?.artistAvatar || artistData.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(artistName));
  const sns = artistData.sns || {};
  const snsHtml = generateSnsLinks(sns);
  const isSelf = (window.__currentUser && window.__currentUser.name === artistName) ||
                 (db.currentUser && db.currentUser.name === artistName);

  // === Role detection ===
  // Heuristic: declared role > track count > name prefix
  // - artistData.role (from following/onboarding mock)
  // - artistTracks.length > 0 → 아티스트
  // - name starts with "청취자" → 리스너
  // - default → 리스너 (safer for postit authors)
  let role = artistData.role;
  if (!role) {
    if (artistTracks.length > 0) role = 'artist';
    else if (/^청취자/.test(artistName)) role = 'listener';
    else role = 'listener';
  }
  const isArtistRole = role === 'admin' || role === 'artist' || role === 'student';
  const roleLabel = role === 'admin' ? '관리자' : (isArtistRole ? '아티스트' : '리스너');

  // Attempt to get artist ID from an already-loaded Supabase track (no network). Look up by name later, async.
  const firstSupabaseTrack = artistTracks.find(t => t.__supabase && t.artistId);
  let artistSupabaseId = firstSupabaseTrack ? firstSupabaseTrack.artistId : null;
  let fanCount = artistSupabaseId && window.__fanCounts ? (window.__fanCounts.get(artistSupabaseId) || 0) : 0;
  let iFollow = artistSupabaseId && window.__followed ? window.__followed.has(artistSupabaseId) : false;

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
  const notesGridHtml = artistNotes.map((n, i) => {
    const col = NOTE_COLORS[n.color] || NOTE_COLORS.yellow;
    const rot = n.rotation || ((i % 2 === 0 ? -1 : 1) * (Math.random() * 3 + 0.5));
    const safeTxt = (n.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    return `
      <div class="artist-postit" style="background:${col.bg}; color:${col.text}; --rot:${rot}deg;" onclick="openNoteDetail('${n.id}')">
        <div class="artist-postit-body">${safeTxt}</div>
      </div>
    `;
  }).join('');

  appContent.innerHTML = `
    <div class="artist-canvas">
      <div class="artist-bg-deco"></div>

      <div class="sub-page artist-page">
        <div class="reveal" style="margin-bottom:14px;">
          <a href="#" onclick="event.preventDefault(); navigateTo('wall')" style="color:var(--text-secondary); font-size:13px;">
            <i class="ri-arrow-left-line"></i> 우리들의 벽으로
          </a>
        </div>

        <div class="artist-header-row reveal">
          <div class="artist-strip">
            <div class="artist-id">
              <img src="${avatar}" class="artist-avatar" alt="${safeName}">
              <div class="artist-id-text">
                <h1>${safeName}</h1>
                <div style="color: var(--brand-color); font-weight: 600; font-size: 13px; margin-top:2px;">
                  <i class="ri-user-star-line"></i> ${roleLabel}
                </div>
                <div class="artist-stats" style="margin-top:4px;">
                  ${isArtistRole ? `<span>${artistTracks.length}곡</span><span class="stat-dot">·</span><span>${Object.keys(projects).length} 프로젝트</span><span class="stat-dot">·</span>` : ''}
                  <span>${artistNotes.length} 포스트잇</span>
                  ${artistSupabaseId ? `<span class="stat-dot">·</span><span class="fan-count-inline">❤ <strong id="fan-count-inline">${fanCount}</strong> 팬</span>` : ''}
                </div>
                ${isArtistRole && !isSelf ? (() => {
                  // Supabase ID 우선, 없으면 이름 기반 로컬 팔로우 상태
                  const isFollowingNow = artistSupabaseId
                    ? iFollow
                    : (typeof window._isFollowingName === 'function' && window._isFollowingName(artistName));
                  const followArg = artistSupabaseId
                    ? `'${artistSupabaseId}', '${safeName.replace(/'/g,"\\'")}'`
                    : `null, '${safeName.replace(/'/g,"\\'")}'`;
                  return `
                  <div class="artist-action-row" style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="follow-btn-v2 ${isFollowingNow ? 'is-following' : ''}" onclick="toggleFollowArtist(${followArg})">
                      ${isFollowingNow ? '<i class="ri-heart-fill"></i> 팬이에요' : '<i class="ri-heart-line"></i> 팬 되기'}
                    </button>
                    <button class="dm-btn-v2" onclick="openDmModal('${safeName.replace(/'/g,"\\'")}', '${(avatar||'').replace(/'/g,"\\'")}')">
                      <i class="ri-mail-send-fill"></i> 메시지
                    </button>
                  </div>
                  `;
                })() : ''}
              </div>
            </div>
          </div>
          ${artistNotes.length > 0 ? `
            <aside class="artist-postit-aside">
              <div class="artist-postit-aside-head">
                <i class="ri-sticky-note-fill"></i> 소식 <span class="artist-postit-count">${artistNotes.length}</span>
              </div>
              <div class="artist-postit-grid artist-postit-grid-aside">
                ${notesGridHtml}
              </div>
            </aside>
          ` : ''}
        </div>

        ${'' /* 기존 별도 postit-section은 프로필 옆으로 이동됨 */ ? `<div class="reveal artist-postit-section">
            <h2 class="section-title"><i class="ri-sticky-note-fill" style="color:#FFD54F;"></i> ${safeName}${isArtistRole ? '의 포스트잇' : '이(가) 남긴 포스트잇'} <span class="section-count">${artistNotes.length}</span></h2>
            <div class="artist-postit-grid">
              ${notesGridHtml}
            </div>
          </div>
        ` : ''}

        ${isArtistRole ? `
          <!-- 청취곡 (라벨 없음 — 카드만 노출) -->
          ${releasedCount > 0 ? `
            <div class="reveal" style="margin-top:36px;">
              ${releasedHtml}
            </div>
          ` : ''}
          <!-- 데모곡 (라벨 없음 — 카드만 노출) -->
          ${demoCount > 0 ? `
            <div class="reveal" style="margin-top:36px;">
              ${demoHtml}
            </div>
          ` : ''}
          ${(releasedCount + demoCount) === 0 ? `
            <div class="reveal" style="margin-top:36px;">
              <p style="color:var(--text-secondary);">아직 업로드한 곡이 없어요.</p>
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
          statsEl.insertAdjacentHTML('beforeend', `<span class="stat-dot">·</span><span class="fan-count-inline">❤ <strong id="fan-count-inline">${count}</strong> 팬</span>`);
        } else if (existingChip) {
          const strong = existingChip.querySelector('strong');
          if (strong) strong.textContent = String(count);
        }
        // Insert follow button if missing
        const idText = document.querySelector('.artist-id-text');
        if (idText && !idText.querySelector('.follow-btn-v2')) {
          const btnWrap = document.createElement('div');
          btnWrap.style.marginTop = '14px';
          btnWrap.innerHTML = `<button class="follow-btn-v2 ${following ? 'is-following' : ''}" onclick="toggleFollowArtist('${aid}', '${(artistName||'').replace(/'/g,"\\'")}')">${following ? '<i class="ri-seedling-fill"></i> 함께하는 중' : '<i class="ri-seedling-line"></i> 함께하기'}</button>`;
          idText.appendChild(btnWrap);
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

window.toggleLike = async function (trackId) {
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

  window.DB.save(db);

  // Persist to Supabase Favorites if available (server-side source of truth)
  if (window.Favorites && window.Favorites.toggle) {
    try {
      const res = await window.Favorites.toggle(trackId);
      // Sync local likedTracks with server state in case of mismatch
      if (res.favorited && db.currentUser.likedTracks.indexOf(trackId) === -1) {
        db.currentUser.likedTracks.push(trackId);
        window.DB.save(db);
      } else if (!res.favorited && db.currentUser.likedTracks.indexOf(trackId) !== -1) {
        db.currentUser.likedTracks = db.currentUser.likedTracks.filter(id => id !== trackId);
        window.DB.save(db);
      }
      if (typeof showToast === 'function') {
        showToast(res.favorited ? '⭐ 즐겨찾기에 추가' : '☆ 즐겨찾기에서 제거');
      }
    } catch (e) {
      console.warn('[toggleLike] Favorites sync', e);
    }
  }

  if (currentView === 'home') renderHome();
  else if (currentView === 'library') window.renderLibrary();
  else if (currentView === 'profile') renderProfile();
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
}

window.closePlaylistModal = function() {
  document.getElementById('playlist-modal').style.display = 'none';
  window._pendingPlaylistTrackId = null;
}

window.addToPlaylist = async function(playlistId) {
  const trackId = window._pendingPlaylistTrackId;
  if (!trackId) return;
  try {
    if (window.Playlists) {
      await window.Playlists.addTrack(playlistId, trackId);
      await window.Playlists.refreshInto(window.DB.get());
    } else {
      window.DB.addTrackToPlaylist(playlistId, trackId);
    }
    closePlaylistModal();
    renderSidebarPlaylists();
    showToast('플레이리스트에 추가됐어요!');
  } catch (e) {
    alert('추가 실패: ' + (e.message || e));
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
      showToast(`✨ ${window._onboardingPicked.size}명과 함께 시작! 카드는 내 페이지에서 확인`);
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

window.openDmModal = function(artistName, artistAvatar) {
  if (!artistName) return;
  const db = window.DB.get();
  if (!db || !db.currentUser) {
    alert('로그인 후 메시지를 보낼 수 있어요');
    navigateTo('auth');
    return;
  }
  const thread = _getDmThread(artistName);
  const safeName = artistName.replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const safeAvatar = (artistAvatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(artistName))).replace(/"/g,'&quot;');
  const myAvatar = (db.currentUser.avatar || 'https://i.pravatar.cc/150').replace(/"/g,'&quot;');

  const messagesHtml = thread.length === 0
    ? `<div class="dm-empty">
         <div class="dm-empty-emoji">💌</div>
         <div class="dm-empty-text">${safeName}에게 첫 메시지를 보내봐</div>
         <div class="dm-empty-sub">응원 / 곡 의견 / 합주 제안 — 뭐든 환영</div>
       </div>`
    : thread.map(m => {
        const safeText = (m.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
        const time = m.time ? new Date(m.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
        if (m.from === 'me') {
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

  const content = document.getElementById('dm-content');
  if (!content) return;
  content.innerHTML = `
    <div class="dm-card">
      <div class="dm-header">
        <button class="dm-close-btn" onclick="closeDmModal()" aria-label="닫기"><i class="ri-arrow-left-line"></i></button>
        <img src="${safeAvatar}" class="dm-header-avatar" alt="${safeName}">
        <div class="dm-header-text">
          <div class="dm-header-name">${safeName}</div>
          <div class="dm-header-status"><span class="dm-status-dot"></span> 답장 가능</div>
        </div>
      </div>
      <div class="dm-messages" id="dm-messages-${artistName.replace(/[^\w가-힣]/g,'_')}">
        ${messagesHtml}
      </div>
      <div class="dm-input-row">
        <textarea id="dm-input" class="dm-input" placeholder="${safeName}에게 메시지..." rows="1" onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); window.sendDmMessage('${safeName.replace(/'/g, "\\'")}');}"></textarea>
        <button class="dm-send-btn" onclick="window.sendDmMessage('${safeName.replace(/'/g, "\\'")}')">
          <i class="ri-send-plane-fill"></i>
        </button>
      </div>
      <div class="dm-footer-note">💌 메시지 곧 백엔드 연동 — 현재는 모의 답장</div>
    </div>
  `;

  const modal = document.getElementById('dm-modal');
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Auto-scroll to bottom
  setTimeout(() => {
    const msgs = content.querySelector('.dm-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const input = document.getElementById('dm-input');
    if (input) input.focus();
  }, 100);
};

window.closeDmModal = function() {
  const modal = document.getElementById('dm-modal');
  if (modal) modal.style.display = 'none';
  const content = document.getElementById('dm-content');
  if (content) content.innerHTML = '';
  document.body.style.overflow = '';
};

window.sendDmMessage = function(artistName) {
  const input = document.getElementById('dm-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) return;

  const thread = _getDmThread(artistName);
  thread.push({ from: 'me', text, time: new Date().toISOString() });
  _saveDmThread(artistName, thread);
  input.value = '';

  // Re-render the message list quickly
  const db = window.DB.get();
  const msgsEl = document.querySelector('#dm-content .dm-messages');
  if (msgsEl) {
    // append new message
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const safeText = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    // Remove empty state if present
    const empty = msgsEl.querySelector('.dm-empty');
    if (empty) empty.remove();
    msgsEl.insertAdjacentHTML('beforeend', `
      <div class="dm-row dm-row-me">
        <div class="dm-bubble dm-bubble-me">${safeText}</div>
        <div class="dm-time">${time}</div>
      </div>
    `);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // Mock typing indicator + canned reply after 1.5-2.5s
  setTimeout(() => {
    if (msgsEl) {
      msgsEl.insertAdjacentHTML('beforeend', `
        <div class="dm-row dm-row-them dm-typing-row">
          <div class="dm-bubble dm-bubble-them dm-typing">
            <span></span><span></span><span></span>
          </div>
        </div>
      `);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    setTimeout(() => {
      // Replace typing with actual canned reply
      const typing = document.querySelector('.dm-typing-row');
      if (typing) typing.remove();
      const reply = _DM_CANNED_REPLIES[Math.floor(Math.random() * _DM_CANNED_REPLIES.length)];
      const updatedThread = _getDmThread(artistName);
      updatedThread.push({ from: 'them', text: reply, time: new Date().toISOString() });
      _saveDmThread(artistName, updatedThread);
      const msgsEl2 = document.querySelector('#dm-content .dm-messages');
      if (msgsEl2) {
        const safeReply = reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const time2 = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const avatarEl = document.querySelector('#dm-content .dm-header-avatar');
        const avatar = avatarEl ? avatarEl.src : '';
        msgsEl2.insertAdjacentHTML('beforeend', `
          <div class="dm-row dm-row-them">
            <img src="${avatar}" class="dm-avatar" alt="">
            <div class="dm-bubble-wrap">
              <div class="dm-bubble dm-bubble-them">${safeReply}</div>
              <div class="dm-time">${time2}</div>
            </div>
          </div>
        `);
        msgsEl2.scrollTop = msgsEl2.scrollHeight;
      }
    }, 1400);
  }, 800);
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
  showToast(`✨ ${(Number(amount)/10000).toFixed(0)}만원 함께 만들기 신청 완료!`);

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
    showToast('카드 정보를 못 찾았어요');
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
    if (!blob) { showToast('이미지 생성 실패'); return; }
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
    navigator.clipboard.writeText(text).then(() => showToast('📋 텍스트 복사됨!')).catch(() => alert(text));
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
    ? `<button class="tama-big-action-follow" onclick="event.stopPropagation(); showToast('예시 카드입니다 ✨')">🌱 함께하기</button>`
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
  const name = prompt('새 폴더 이름을 정해줘 ✨', '');
  if (!name || !name.trim()) return;
  try {
    if (window.Playlists) {
      await window.Playlists.create(name.trim());
      await window.Playlists.refreshInto(window.DB.get());
    } else {
      window.DB.createPlaylist(name.trim());
    }
    renderSidebarPlaylists();
    showToast('폴더 만들었어요 ✨');
    if (currentView === 'profile') renderProfile();
  } catch (e) {
    alert('만들기 실패: ' + (e.message || e));
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
    showToast(`"${title}" 폴더 시작! 🎵`);
    if (currentView === 'profile') renderProfile();
  } catch (e) {
    alert('만들기 실패: ' + (e.message || e));
  }
};

window.openMyPlaylist = function(playlistId) {
  if (!playlistId) return;
  navigateTo('playlist:' + encodeURIComponent(playlistId));
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
    showToast('플레이리스트 만들었어요 ✨');
  } catch (e) {
    alert('생성 실패: ' + (e.message || e));
  }
};

/* =========================================================
   AUDIO PLAYER
========================================================= */

window.playTrack = function (trackId) {
  const db = window.DB.get();
  const track = db.tracks.find(t => t.id === trackId);
  if (!track) return;

  if (currentPlayingTrack === track.id) {
    togglePlay();
    return;
  }

  currentPlayingTrack = track.id;

  if (db.currentUser) {
    if (!db.currentUser.history) db.currentUser.history = [];
    db.currentUser.history = db.currentUser.history.filter(id => id !== track.id);
    db.currentUser.history.unshift(track.id);
    if (db.currentUser.history.length > 20) db.currentUser.history.pop();
    window.DB.save(db);
  }

  globalPlayer.classList.add('active');

  document.getElementById('player-cover').src = track.cover;
  document.getElementById('player-title').innerText = track.title;
  document.getElementById('player-artist').innerText = track.artist;

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
      // 같은 트랙 의도로 시작했을 때만 진짜 에러로 표시
      if (audioElement._intendedId === intendedId) {
        console.warn('[playTrack] failed:', e.message || e);
      }
    });
  }
}

function togglePlay() {
  const icon = playBtn.querySelector('i');
  if (audioElement.paused) {
    audioElement.play();
    icon.className = 'ri-pause-circle-fill';
  } else {
    audioElement.pause();
    icon.className = 'ri-play-circle-fill';
  }
}

function updateProgress() {
  const { duration, currentTime } = audioElement;
  const progressPercent = (currentTime / duration) * 100;

  document.getElementById('progress-fill').style.width = `${progressPercent}%`;

  document.getElementById('time-current').innerText = formatTime(currentTime);
  if (duration) {
    document.getElementById('time-total').innerText = formatTime(duration);
  }
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

document.getElementById('progress-bar').addEventListener('click', (e) => {
  // Use bounding rect so clicks on the inner track or transparent hit-area
  // both seek correctly (the outer wrap pads the hit area for fingers).
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const duration = audioElement.duration;
  if (duration && rect.width > 0) {
    audioElement.currentTime = (clickX / rect.width) * duration;
  }
});

// Boot
window.onload = init;

// ===================== ADMIN DASHBOARD =====================

window.renderAdmin = async function () {
  const user = window.__currentUser || window.DB.get().currentUser;
  if (!user || user.role !== 'admin') {
    appContent.innerHTML = `<h2 style="text-align:center; padding: 100px 0; color: var(--brand-color);">접근 권한이 없습니다.</h2>`;
    return;
  }

  appContent.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-secondary);">로딩 중…</div>`;

  let recentNotes = [], recentTracks = [], allUsers = [];
  try {
    if (window.Admin) {
      [recentNotes, recentTracks, allUsers] = await Promise.all([
        window.Admin.listRecentNotes(50),
        window.Admin.listRecentTracks(50),
        window.Admin.listUsers ? window.Admin.listUsers(200) : Promise.resolve([])
      ]);
    }
  } catch (e) { console.warn('[admin] list', e); }

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
    const map = {
      admin:    { bg:'#9C27B0', label:'관리자' },
      artist:   { bg:'#FF9800', label:'아티스트' },
      listener: { bg:'#555',    label:'리스너' }
    };
    const m = map[role] || map.listener;
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
          <option value="listener" ${u.role==='listener'?'selected':''}>리스너</option>
          <option value="artist" ${u.role==='artist'?'selected':''}>아티스트</option>
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

  appContent.innerHTML = `
    <div style="max-width: 1000px; margin: 0 auto; padding: 32px;">
      <h1 style="margin-bottom: 12px;"><i class="ri-dashboard-2-fill text-brand"></i> 관리자 대시보드</h1>
      <p style="color: var(--text-secondary); margin-bottom: 32px;">사용자·트랙·포스트잇을 관리할 수 있어요. 삭제·역할변경은 되돌릴 수 없으니 주의하세요.</p>

      <div class="admin-section">
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
            <button type="button" data-role-filter="listener" class="admin-chip"        onclick="adminFilterByRole('listener', this)">리스너</button>
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
    showToast('역할이 변경됐어요');
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
    showToast('트랙 삭제됨');
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
      showToast(`📦 ${result.name} (${(result.sizeBytes/1048576).toFixed(1)}MB) 다운로드됨`);
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
    showToast('포스트잇 삭제됨');
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
      <h1 style="text-align: center; margin-bottom: 8px;">시작하기</h1>
      <p style="text-align:center; color:var(--text-secondary); font-size:13px; margin-bottom: 24px;">
        가입 없이도 곡 감상은 가능해요.<br>좋아요·댓글·업로드는 로그인이 필요합니다.
      </p>
      ${notice}

      <!-- ── Consent ────────────────────────────────────────── -->
      <div style="background:#111; border:1px solid var(--divider); border-radius:8px; padding:14px; margin-bottom:18px;">
        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; font-size:14px; line-height:1.5;">
          <input type="checkbox" id="auth-consent" style="margin-top:3px; flex-shrink:0;">
          <span>
            <strong>(필수)</strong> 개인정보 수집·이용 및 서비스 이용약관에 동의합니다.
            <a href="#" id="show-terms" style="color: var(--brand-color); margin-left:6px; font-size:13px;">자세히 ▼</a>
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
        Google로 계속하기
      </button>

      <!-- ── Kakao (primary) ────────────────────────────────── -->
      <button type="button" id="kakao-btn" disabled style="width:100%; padding:14px; background:#FEE500; color:#191919; border:none; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; opacity:0.4; transition: opacity 0.15s;">
        <span style="font-size:18px;">💬</span> 카카오로 계속하기
      </button>

      <!-- ── Divider ────────────────────────────────────────── -->
      <div style="display:flex; align-items:center; gap:10px; margin:18px 0; color:var(--text-secondary); font-size:12px;">
        <div style="flex:1; height:1px; background:var(--divider);"></div>
        <span>또는</span>
        <div style="flex:1; height:1px; background:var(--divider);"></div>
      </div>

      <!-- ── Magic link ─────────────────────────────────────── -->
      <form id="magic-form">
        <div class="form-group" style="margin-bottom:10px;">
          <input type="email" class="form-control" id="magic-email" required autocomplete="email" placeholder="이메일 주소">
        </div>
        <button type="submit" id="magic-btn" disabled class="btn-primary" style="width:100%; opacity:0.4; transition: opacity 0.15s;">
          이메일로 로그인 링크 받기
        </button>
        <p style="font-size:12px; color:var(--text-secondary); margin-top:8px; text-align:center;">
          비밀번호 없이 메일에 도착한 링크로 로그인돼요.
        </p>
      </form>

      <!-- ── Legacy email+password (collapsed) ──────────────── -->
      <div style="margin-top:24px; padding-top:16px; border-top:1px solid var(--divider); text-align:center;">
        <a href="#" id="show-legacy" style="color:var(--text-secondary); font-size:12px;">기존 비밀번호로 로그인 ▼</a>
      </div>
      <form id="legacy-login" style="display:none; margin-top:12px;">
        <div class="form-group">
          <input type="email" class="form-control" id="legacy-email" required autocomplete="email" placeholder="이메일">
        </div>
        <div class="form-group">
          <input type="password" class="form-control" id="legacy-pw" required autocomplete="current-password" placeholder="비밀번호">
        </div>
        <button type="submit" class="btn-primary" style="width:100%;">로그인</button>
      </form>
    </div>
  `;

  // ── Consent gating ─────────────────────────────────────────
  const consent = document.getElementById('auth-consent');
  const googleBtn = document.getElementById('google-btn');
  const kakaoBtn = document.getElementById('kakao-btn');
  const magicBtn = document.getElementById('magic-btn');
  function syncConsent() {
    const ok = consent.checked;
    [googleBtn, kakaoBtn, magicBtn].forEach(b => {
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
    e.target.textContent = det.style.display === 'none' ? '자세히 ▼' : '접기 ▲';
  };

  document.getElementById('show-legacy').onclick = (e) => {
    e.preventDefault();
    const f = document.getElementById('legacy-login');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
    e.target.textContent = f.style.display === 'none' ? '기존 비밀번호로 로그인 ▼' : '기존 비밀번호로 로그인 ▲';
  };

  // ── Google ─────────────────────────────────────────────────
  googleBtn.onclick = async () => {
    if (!supabaseReady) { alert('Supabase 키가 설정되지 않았어요.'); return; }
    if (!consent.checked) { alert('약관 동의가 필요해요.'); return; }
    googleBtn.disabled = true;
    googleBtn.innerHTML = '<span>이동 중…</span>';
    try {
      await window.Auth.signInWithGoogle();
    } catch (err) {
      alert('Google 로그인 시작 실패: ' + (err.message || err));
      googleBtn.disabled = false;
      window.location.reload();
    }
  };

  // ── Kakao ──────────────────────────────────────────────────
  kakaoBtn.onclick = async () => {
    if (!supabaseReady) { alert('Supabase 키가 설정되지 않았어요.'); return; }
    if (!consent.checked) { alert('약관 동의가 필요해요.'); return; }
    kakaoBtn.disabled = true;
    kakaoBtn.innerHTML = '<span>이동 중…</span>';
    try {
      await window.Auth.signInWithKakao();
      // page redirects out — control returns to Kakao
    } catch (err) {
      alert('카카오 로그인 시작 실패: ' + (err.message || err));
      kakaoBtn.disabled = false;
      kakaoBtn.innerHTML = '<span style="font-size:18px;">💬</span> 카카오로 계속하기';
    }
  };

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
      showToast(`${email} 로 로그인 링크를 보냈어요. 메일함을 확인해주세요!`);
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
      showToast('다시 만나서 반가워요! 🎵');
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
