// =============================================================================
// Off-Stage — Polaroid Track Card (share / save / story)
//
// Public surface (all attached to `window`):
//   navigateTo('card:<trackId>')      — full-page card view (legacy router)
//   window.openTrackCard(trackId)     — programmatic open
//   window.renderCardPage(trackId)    — router calls this for `card:` route
//   window.savePolaroidImage(trackId, opts)
//   window.shareTrackCard(trackId)
//   window.copyTrackLink(trackId)
//   window.toggleCardActions(trackId) — show/hide ⋯ menu
//
// External libraries (lazy-loaded once per session, cached on window):
//   html-to-image  — DOM → PNG (better Korean/font handling than html2canvas)
//   qrcode         — QR data URL generator
// =============================================================================
(function () {
  'use strict';

  // -- Configuration ----------------------------------------------------------
  // Public origin used for QR + 링크 복사. Update when production domain changes.
  const OFFSTAGE_BASE_URL = 'https://off-stage.com';
  const HTI_CDN  = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.min.js';
  const QR_CDN   = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';

  const STORY_W = 1080;   // Instagram story canvas width
  const STORY_H = 1920;   // Instagram story canvas height
  const CARD_PIXEL_RATIO = 2; // 2× DPI for crisp PNG

  // -- Helpers ----------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeFilename(s) {
    return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'track';
  }
  function trackUrl(trackId) {
    return `${OFFSTAGE_BASE_URL}/?t=${encodeURIComponent(trackId)}`;
  }
  function dataURLtoBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/:(.*?);/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function isMobile() {
    return window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
  }
  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Avoid double-load
      if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  async function ensureLibs() {
    const tasks = [];
    if (!window.htmlToImage) tasks.push(loadScript(HTI_CDN));
    if (!window.QRCode)      tasks.push(loadScript(QR_CDN));
    if (tasks.length) await Promise.all(tasks);
  }

  // -- Track lookup -----------------------------------------------------------
  function findTrack(trackId) {
    try {
      const db = window.DB && window.DB.get && window.DB.get();
      if (!db || !Array.isArray(db.tracks)) return null;
      return db.tracks.find(t => t && t.id === trackId) || null;
    } catch (_) { return null; }
  }

  // Stable rotation per track (so cards don't jiggle on every render)
  function pseudoRot(seed) {
    let h = 0;
    const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    const r = ((Math.abs(h) % 70) / 10) - 3.5; // -3.5 ~ +3.5
    return Math.max(-3, Math.min(3, r));
  }

  // -- Polaroid markup --------------------------------------------------------
  // Returns INNER HTML of a `.polaroid-card` element.
  function polaroidInner(track, opts) {
    opts = opts || {};
    const cover = track.cover || track.artistAvatar || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500';
    const artist = escapeHtml(track.artist || '익명 아티스트');
    const title  = escapeHtml(track.title  || '제목 없음');
    const showActions = !opts.captureMode;
    return `
      <div class="polaroid-frame">
        <div class="polaroid-photo">
          <img class="polaroid-cover" src="${escapeHtml(cover)}" alt="${title}" crossorigin="anonymous" referrerpolicy="no-referrer">
          <div class="polaroid-music-mark" aria-hidden="true"><i class="ri-play-fill"></i></div>
          ${showActions ? `<button class="polaroid-play-btn" type="button" aria-label="재생/일시정지" onclick="event.stopPropagation(); window.playTrack && window.playTrack('${escapeHtml(track.id)}')"><i class="ri-play-fill"></i></button>` : ''}
        </div>
        <div class="polaroid-caption">
          <div class="polaroid-caption-text">
            <div class="polaroid-artist">${artist}</div>
            <div class="polaroid-title">${title}</div>
          </div>
          ${opts.captureMode ? `<img class="polaroid-qr" alt="QR" src="${escapeHtml(opts.qrDataUrl || '')}">` : ''}
        </div>
        ${showActions ? `
          <button class="polaroid-action-btn" type="button" aria-label="액션 메뉴" onclick="event.stopPropagation(); window.toggleCardActions('${escapeHtml(track.id)}')">
            <i class="ri-more-2-fill"></i>
          </button>` : ''}
        <div class="polaroid-watermark" aria-hidden="true">
          <span class="polaroid-dot"></span>Off-Stage
        </div>
      </div>
    `;
  }

  function buildPolaroidCard(track, opts) {
    opts = opts || {};
    const rot = (opts.captureMode || opts.flat) ? 0 : pseudoRot(track.id);
    const el = document.createElement('div');
    el.className = 'polaroid-card' + (opts.captureMode ? ' polaroid-capture' : '');
    el.dataset.trackId = track.id;
    el.style.setProperty('--rot', rot + 'deg');
    el.innerHTML = polaroidInner(track, opts);
    if (!opts.captureMode) {
      el.addEventListener('click', (e) => {
        // Body tap = play/pause toggle, but don't intercept buttons
        const tgt = e.target;
        if (tgt && tgt.closest('.polaroid-play-btn, .polaroid-action-btn, .polaroid-actions-menu, a, input, button')) return;
        if (window.playTrack) window.playTrack(track.id);
      });
      attachLongPress(el, () => savePolaroidImage(track.id));
    }
    return el;
  }

  // Long-press on mobile = quick save
  function attachLongPress(el, onLongPress) {
    let timer = null;
    let startX = 0, startY = 0, moved = false;
    const start = (e) => {
      if (e.target && e.target.closest('.polaroid-play-btn, .polaroid-action-btn')) return;
      const t = (e.touches && e.touches[0]) || e;
      startX = t.clientX; startY = t.clientY; moved = false;
      timer = setTimeout(() => {
        if (!moved) {
          if (navigator.vibrate) navigator.vibrate(20);
          onLongPress();
        }
      }, 600);
    };
    const move = (e) => {
      const t = (e.touches && e.touches[0]) || e;
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) {
        moved = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
    };
    const end = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove',  move,  { passive: true });
    el.addEventListener('touchend',   end);
    el.addEventListener('touchcancel', end);
  }

  // -- Action menu (⋯) --------------------------------------------------------
  function closeAllMenus() {
    document.querySelectorAll('.polaroid-actions-menu').forEach(m => m.remove());
    document.querySelectorAll('.polaroid-actions-sheet').forEach(m => m.remove());
    document.body.classList.remove('polaroid-sheet-open');
  }

  window.toggleCardActions = function (trackId) {
    const existing = document.querySelector(`.polaroid-actions-menu[data-for="${trackId}"], .polaroid-actions-sheet[data-for="${trackId}"]`);
    if (existing) { closeAllMenus(); return; }
    closeAllMenus();
    if (isMobile()) openActionSheet(trackId);
    else openActionPopover(trackId);
  };

  function actionItemsHtml(trackId) {
    return `
      <button type="button" class="polaroid-action-item" onclick="closeCardActions(); window.savePolaroidImage('${escapeHtml(trackId)}')">
        <i class="ri-download-2-line"></i><span>이미지 저장</span>
      </button>
      <button type="button" class="polaroid-action-item" onclick="closeCardActions(); window.savePolaroidImage('${escapeHtml(trackId)}', { story: true })">
        <i class="ri-instagram-line"></i><span>스토리 사이즈로 저장 (9:16)</span>
      </button>
      <button type="button" class="polaroid-action-item" onclick="closeCardActions(); window.shareTrackCard('${escapeHtml(trackId)}')">
        <i class="ri-share-forward-line"></i><span>공유</span>
      </button>
      <button type="button" class="polaroid-action-item" onclick="closeCardActions(); window.copyTrackLink('${escapeHtml(trackId)}')">
        <i class="ri-link"></i><span>링크 복사</span>
      </button>
    `;
  }
  window.closeCardActions = closeAllMenus;

  function openActionPopover(trackId) {
    const card = document.querySelector(`.polaroid-card[data-track-id="${trackId}"]`);
    if (!card) return;
    const menu = document.createElement('div');
    menu.className = 'polaroid-actions-menu';
    menu.dataset.for = trackId;
    menu.innerHTML = actionItemsHtml(trackId);
    card.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { once: true });
    }, 0);
    function onDocClick(e) {
      if (!menu.contains(e.target) && !e.target.closest('.polaroid-action-btn')) closeAllMenus();
    }
  }

  function openActionSheet(trackId) {
    const sheet = document.createElement('div');
    sheet.className = 'polaroid-actions-sheet';
    sheet.dataset.for = trackId;
    sheet.innerHTML = `
      <div class="polaroid-sheet-backdrop" onclick="closeCardActions()"></div>
      <div class="polaroid-sheet-panel" role="dialog" aria-label="카드 액션">
        <div class="polaroid-sheet-handle" aria-hidden="true"></div>
        <div class="polaroid-sheet-title">트랙 카드</div>
        ${actionItemsHtml(trackId)}
        <button type="button" class="polaroid-sheet-cancel" onclick="closeCardActions()">취소</button>
      </div>
    `;
    document.body.appendChild(sheet);
    document.body.classList.add('polaroid-sheet-open');
  }

  // -- Capture pipeline -------------------------------------------------------
  // Build an off-screen "capture clone" of the polaroid with QR + watermark + ▶ mark,
  // rotation forced to 0, fonts inlined-friendly. Returns a detached DOM node and
  // a cleanup function that removes it from the document.
  async function buildCaptureClone(track) {
    await ensureLibs();
    const qrDataUrl = await window.QRCode.toDataURL(trackUrl(track.id), {
      width: 240,
      margin: 0,
      color: { dark: '#111111', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    });
    const stage = document.createElement('div');
    stage.className = 'polaroid-capture-stage';
    // Position OFF-screen but still rendered (display:none breaks measurements)
    stage.style.cssText = 'position:fixed;left:-99999px;top:0;width:auto;height:auto;pointer-events:none;z-index:-1;background:transparent;';
    const card = buildPolaroidCard(track, { captureMode: true, qrDataUrl });
    stage.appendChild(card);
    document.body.appendChild(stage);

    // Wait for the cover image to load (avoid blank capture)
    const cover = card.querySelector('.polaroid-cover');
    if (cover && !cover.complete) {
      await new Promise(res => {
        cover.onload = res;
        cover.onerror = res;
        // Hard timeout — don't hang forever on a slow CDN
        setTimeout(res, 4000);
      });
    }

    return {
      node: card,
      cleanup() { try { stage.remove(); } catch (_) {} }
    };
  }

  async function capturePngDataUrl(node, options) {
    options = options || {};
    if (!window.htmlToImage) await ensureLibs();
    return await window.htmlToImage.toPng(node, {
      pixelRatio: CARD_PIXEL_RATIO,
      cacheBust: true,
      backgroundColor: options.bg || null,
      // Skip elements we don't want in the capture (defensive — ⋯ button shouldn't
      // appear in capture mode anyway)
      filter: (n) => !(n.classList && (n.classList.contains('polaroid-action-btn') || n.classList.contains('polaroid-actions-menu')))
    });
  }

  // Compose the captured polaroid PNG onto a 1080×1920 story canvas with a soft
  // gradient background. Returns a data URL.
  async function composeStoryCanvas(polaroidDataUrl, track) {
    const img = await loadImage(polaroidDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = STORY_W;
    canvas.height = STORY_H;
    const ctx = canvas.getContext('2d');

    // Soft vertical gradient — tuned to feel like a stage / dim room
    const grad = ctx.createLinearGradient(0, 0, 0, STORY_H);
    grad.addColorStop(0,    '#1a0f2b');
    grad.addColorStop(0.5,  '#0a0612');
    grad.addColorStop(1,    '#1f1024');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, STORY_W, STORY_H);

    // Subtle vignette
    const radial = ctx.createRadialGradient(STORY_W / 2, STORY_H / 2, STORY_W * 0.25, STORY_W / 2, STORY_H / 2, STORY_W * 0.75);
    radial.addColorStop(0, 'rgba(0,0,0,0)');
    radial.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, STORY_W, STORY_H);

    // Fit polaroid centered, max 84% of width
    const maxW = STORY_W * 0.84;
    const scale = Math.min(maxW / img.width, (STORY_H * 0.78) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (STORY_W - w) / 2;
    const y = (STORY_H - h) / 2 - 20;
    // Soft shadow under polaroid
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 30;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();

    // Caption strip below
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Off-Stage', STORY_W / 2, STORY_H - 110);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '500 26px Inter, sans-serif';
    const sub = (track && track.artist) ? `@${track.artist}` : '';
    if (sub) ctx.fillText(sub, STORY_W / 2, STORY_H - 70);

    return canvas.toDataURL('image/png');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // -- Public actions ---------------------------------------------------------
  window.savePolaroidImage = async function (trackId, opts) {
    opts = opts || {};
    const track = findTrack(trackId);
    if (!track) { toast('트랙을 찾을 수 없어요'); return; }
    let cleanupFn = null;
    try {
      toast(opts.story ? '스토리 카드 만드는 중…' : '카드 만드는 중…');
      const built = await buildCaptureClone(track);
      cleanupFn = built.cleanup;
      const polaroidPng = await capturePngDataUrl(built.node, { bg: '#ffffff' });
      const finalPng = opts.story ? await composeStoryCanvas(polaroidPng, track) : polaroidPng;
      const blob = dataURLtoBlob(finalPng);
      const fname = `offstage-${safeFilename(track.artist)}-${safeFilename(track.title)}${opts.story ? '-story' : ''}.png`;
      downloadBlob(blob, fname);
      toast('이미지 저장 완료 ✨');
    } catch (e) {
      console.warn('[polaroid] save failed', e);
      toast('이미지 저장 실패 — 잠시 뒤 다시 시도해 주세요');
    } finally {
      if (cleanupFn) cleanupFn();
    }
  };

  window.shareTrackCard = async function (trackId) {
    const track = findTrack(trackId);
    if (!track) { toast('트랙을 찾을 수 없어요'); return; }
    const url = trackUrl(trackId);
    const shareText = `${track.artist} — ${track.title} | Off-Stage`;
    let cleanupFn = null;
    try {
      // Build the image first so canShare can vet the file
      toast('공유 카드 준비 중…');
      const built = await buildCaptureClone(track);
      cleanupFn = built.cleanup;
      const dataUrl = await capturePngDataUrl(built.node, { bg: '#ffffff' });
      const blob = dataURLtoBlob(dataUrl);
      const file = new File([blob], `offstage-${safeFilename(track.artist)}-${safeFilename(track.title)}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, url });
        return;
      }
      // Fallback: download + clipboard
      downloadBlob(blob, file.name);
      try { await navigator.clipboard.writeText(`${shareText} ${url}`); } catch (_) {}
      toast('이미지 저장 + 링크 복사 완료. 인스타에 붙여넣기!');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled native share
      console.warn('[polaroid] share failed', e);
      try { await navigator.clipboard.writeText(`${shareText} ${url}`); toast('링크만 복사했어요 (이미지 생성 실패)'); }
      catch (_) { toast('공유 실패'); }
    } finally {
      if (cleanupFn) cleanupFn();
    }
  };

  window.copyTrackLink = async function (trackId) {
    const url = trackUrl(trackId);
    try {
      await navigator.clipboard.writeText(url);
      toast('링크를 복사했어요 🔗');
    } catch (_) {
      // Older browsers fallback
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('링크를 복사했어요 🔗'); }
      catch (_) { toast('복사 실패 — ' + url); }
      finally { ta.remove(); }
    }
  };

  window.openTrackCard = function (trackId) {
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('card:' + encodeURIComponent(trackId));
    }
  };

  // -- Full-page card view (#card route) -------------------------------------
  // Generate a stable, Poolsuite-style "STO serial" from track id
  function _stoSerial(trackId) {
    let h = 0;
    const s = String(trackId || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    h = Math.abs(h);
    const a = String(800 + (h % 200)).padStart(3, '0');
    const b = String(((h >> 4) % 1000)).padStart(3, '0');
    const c = String(((h >> 12) % 10000)).padStart(4, '0');
    return `1-${a}-${b}-${c}`;
  }

  window.renderCardPage = function (trackId) {
    const app = document.getElementById('app-content');
    if (!app) return;
    const track = findTrack(trackId);
    if (!track) {
      app.innerHTML = `
        <div class="sub-page" style="max-width:520px; margin:80px auto; text-align:center;">
          <div style="font-size:42px; margin-bottom:10px;">🎴</div>
          <h2 style="margin:0 0 8px;">카드를 만들 트랙을 찾지 못했어요</h2>
          <p style="color:var(--text-secondary); font-size:14px;">트랙이 삭제되었거나 ID가 잘못되었을 수 있어요.</p>
          <button class="btn-primary" style="margin-top:18px;" onclick="navigateTo('shapes')">홈으로</button>
        </div>`;
      return;
    }

    const safeId = escapeHtml(trackId);
    const sto = _stoSerial(trackId);
    const safeArtist = escapeHtml(track.artist || '익명 아티스트');
    const safeTitle  = escapeHtml(track.title  || '제목 없음');
    const fileLabel  = (track.audioUrl || '').split('/').pop() || (track.id + '.mp3');
    const safeFile   = escapeHtml(fileLabel.length > 30 ? fileLabel.slice(0,30) + '...' : fileLabel);

    app.innerHTML = `
      <div class="card-page card-page-poolsuite">
        <div class="poolsuite-window">
          <!-- Window chrome: title bar -->
          <div class="poolsuite-titlebar">
            <span class="poolsuite-titlebar-icons">
              <button class="poolsuite-tb-btn" onclick="window.goBack ? window.goBack() : navigateTo('shapes')" aria-label="닫기"><i class="ri-close-line"></i></button>
              <button class="poolsuite-tb-btn"><i class="ri-checkbox-blank-line"></i></button>
              <button class="poolsuite-tb-btn"><i class="ri-subtract-line"></i></button>
            </span>
            <span class="poolsuite-titlebar-brand">OFF — STAGE</span>
          </div>
          <!-- Pink screen: BIG polaroid with serial OVER the photo -->
          <div class="poolsuite-screen">
            <div class="poolsuite-screen-label">CARD <i class="ri-broadcast-line"></i></div>
            <div class="card-page-stage" id="card-page-stage">
              <!-- The polaroid is injected here with: big photo + serial overlay on top + thin caption below -->
            </div>
          </div>
          <!-- Minimal bottom transport — Play / Save / Next -->
          <div class="poolsuite-transport poolsuite-transport-min">
            <button class="poolsuite-tx-btn" onclick="window.playTrack && window.playTrack('${safeId}')" aria-label="재생">
              <i class="ri-play-fill"></i>
            </button>
            <button class="poolsuite-tx-btn poolsuite-tx-save" onclick="window.savePolaroidImage('${safeId}')" aria-label="이미지 저장">
              <i class="ri-download-2-fill"></i>
              <span>SAVE</span>
            </button>
            <button class="poolsuite-tx-btn" onclick="window.nextTrack && window.nextTrack()" aria-label="다음 곡">
              <i class="ri-skip-forward-fill"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    const stage = document.getElementById('card-page-stage');
    if (stage) {
      // Build custom big polaroid: serial overlay ON photo, photo fills frame, single white strip below
      const cover = track.cover || track.artistAvatar || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=800';
      stage.innerHTML = `
        <div class="card-big-polaroid">
          <div class="card-big-photo">
            <img src="${escapeHtml(cover)}" alt="${safeTitle}" referrerpolicy="no-referrer">
            <div class="card-big-serial">${sto}</div>
          </div>
          <div class="card-big-strip">
            <div class="card-big-strip-text">
              <div class="card-big-artist">${safeArtist}</div>
              <div class="card-big-title">${safeTitle}</div>
            </div>
          </div>
        </div>
      `;
    }
  };

  // Close menus on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllMenus();
  });

  // Close popovers on route change (best-effort)
  window.addEventListener('hashchange', closeAllMenus);

  /* ---------------------------------------------------------------------------
     [SCHEMA SUGGESTION — DO NOT RUN AS-IS]
     Future "user-saved cards" gallery. Add when there's product demand.

     create table if not exists public.track_cards (
       id          uuid primary key default uuid_generate_v4(),
       track_id    uuid not null references public.tracks(id) on delete cascade,
       user_id     uuid references public.profiles(id) on delete set null,
       image_url   text,                       -- optional CDN cache (Supabase storage)
       layout      text default 'polaroid',    -- polaroid | story | future variants
       created_at  timestamptz not null default now()
     );
     create index on public.track_cards(track_id);
     create index on public.track_cards(user_id, created_at desc);
     -- alter table public.track_cards enable row level security;
     -- create policy "track_cards_public_read"  on public.track_cards for select using (true);
     -- create policy "track_cards_owner_write" on public.track_cards for all using (auth.uid() = user_id);
     --------------------------------------------------------------------------- */
})();
