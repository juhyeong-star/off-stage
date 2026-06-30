// Off-Stage — Supabase Auth wrapper
// Exposes window.Auth with methods for signup/login/logout/session.
// Profile shape matches the existing `currentUser` object so legacy code in app.js keeps working.

(function () {
  'use strict';

  // Cached in-memory profile after getSession. Synchronous code reads window.__currentUser.
  window.__currentUser = null;

  function mapProfile(profile, authUser) {
    // Synthesize from auth metadata if the profiles row hasn't been written yet
    // (e.g. trigger race on first OAuth signup). Caller still tries fetchProfile
    // again on next syncCurrentUser, so this is just a safe fallback.
    // Best-effort name extraction across providers:
    //   Google: full_name / name / picture
    //   Kakao:  user_name / nickname / preferred_username
    //   Manual: name from signup
    function pickName(meta, authUser) {
      const m = meta || {};
      return (m.name || m.full_name || m.nickname || m.user_name
              || m.preferred_username || m.display_name
              || (authUser && authUser.email ? authUser.email.split('@')[0] : '익명'));
    }
    if (!profile && authUser) {
      const meta = authUser.user_metadata || {};
      return {
        id: authUser.id,
        name: pickName(meta, authUser),
        role: 'listener',
        avatar: meta.avatar_url || meta.picture
              || ('https://i.pravatar.cc/150?u=' + authUser.id),
        heroUrl: '',
        likedTracks: [],
        history: [],
        sns: { instagram: '', youtube: '', tiktok: '', twitter: '' },
        email: authUser.email || ''
      };
    }
    if (!profile) return null;
    // If DB profile name is blank or fallback '익명', upgrade with auth metadata when possible
    const dbName = (profile.name || '').trim();
    const useDbName = dbName && dbName !== '익명';
    return {
      id: profile.id,
      name: useDbName ? dbName : pickName(authUser && authUser.user_metadata, authUser),
      role: profile.role || 'listener',
      avatar: profile.avatar_url || ('https://i.pravatar.cc/150?u=' + profile.id),
      heroUrl: profile.hero_url || '',  // 아티스트 페이지 우측 대표 사진
      bio: profile.bio || '',            // 아티스트 자기소개 (About 탭)
      likedTracks: [],
      history: [],
      sns: {
        instagram: profile.sns_instagram || '',
        youtube:   profile.sns_youtube   || '',
        tiktok:    profile.sns_tiktok    || '',
        twitter:   profile.sns_twitter   || ''
      },
      email: authUser && authUser.email || ''
    };
  }

  // 다른 아티스트 페이지 띄울 때 한 번만 fetch — 본인 프로필이 아닌 경우 사용.
  async function fetchProfileByName(artistName) {
    if (!window.supabase || !artistName) return null;
    const { data } = await window.supabase
      .from('profiles')
      .select('id, name, avatar_url, hero_url, bio')
      .eq('name', artistName)
      .maybeSingle();
    return data || null;
  }

  async function fetchProfile(userId) {
    if (!window.supabase || !userId) return null;
    const { data, error } = await window.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) { console.warn('[Auth] fetchProfile', error.message); return null; }
    return data;
  }

  // ⚠️ 전 사용자 공통 — 곡/메모/댓글을 올리기 직전에 호출해서 profiles 행이 있는지 보장.
  //    profiles 가 없으면 author_id/artist_id FK 위반으로 INSERT 가 실패함(=올리기 안됨 증상).
  //    OAuth/매직링크로 가입한 사용자 중 트리거가 실패한 케이스를 클라 측에서 매번 복구함.
  async function ensureProfileRow() {
    if (!window.supabase) return false;
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) return false;
    // 이미 있으면 통과
    const { data: existing } = await window.supabase
      .from('profiles').select('id').eq('id', user.id).maybeSingle();
    if (existing) return true;
    // 1차 — 클라에서 직접 upsert (RLS 가 self-insert 허용해야 동작)
    const md = user.user_metadata || {};
    const fallbackName = md.name || md.full_name || md.user_name
      || (user.email ? user.email.split('@')[0] : '익명');
    const { error: upErr } = await window.supabase
      .from('profiles')
      .upsert({ id: user.id, name: fallbackName }, { onConflict: 'id' });
    if (!upErr) return true;
    console.warn('[ensureProfileRow] direct upsert failed, trying RPC fallback:', upErr.message);
    // 2차 — RPC 호출 (SECURITY DEFINER 로 RLS 우회 가능). 2026_06_01 마이그레이션 필요.
    try {
      const { error: rpcErr } = await window.supabase.rpc('ensure_my_profile');
      if (!rpcErr) {
        const { data: r2 } = await window.supabase
          .from('profiles').select('id').eq('id', user.id).maybeSingle();
        if (r2) return true;
      } else {
        console.error('[ensureProfileRow] RPC fallback failed:', rpcErr.message);
      }
    } catch (e) {
      console.error('[ensureProfileRow] RPC threw', e && e.message);
    }
    // 마지막 한 번 더 확인 (동시 생성 케이스)
    const { data: retry } = await window.supabase
      .from('profiles').select('id').eq('id', user.id).maybeSingle();
    return !!retry;
  }
  // 외부 인서트 경로에서도 쓸 수 있게 전역 노출
  window.ensureProfileRow = ensureProfileRow;

  async function syncCurrentUser() {
    if (!window.supabase) { window.__currentUser = null; return null; }
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session || !session.user) { window.__currentUser = null; return null; }
    let profile = await fetchProfile(session.user.id);
    // 프로필 행이 없으면 만들어준다 — 업로드가 FK 위반으로 막히는 가장 큰 원인.
    // (OAuth/매직링크는 우리의 signUp 경로를 거치지 않아 트리거에만 의존하므로,
    //  트리거가 어떤 이유로든 실패하면 영영 프로필이 안 생겨 업로드가 계속 실패함.)
    if (!profile) {
      try {
        const md = session.user.user_metadata || {};
        const fallbackName = md.name || md.full_name || md.user_name
          || (session.user.email ? session.user.email.split('@')[0] : '익명');
        await window.supabase
          .from('profiles')
          .upsert({ id: session.user.id, name: fallbackName }, { onConflict: 'id', ignoreDuplicates: true });
        profile = await fetchProfile(session.user.id);
      } catch (e) {
        console.warn('[Auth] auto-create profile failed', e && e.message);
      }
    }
    const mapped = mapProfile(profile, session.user);
    window.__currentUser = mapped;
    // Mirror into legacy localStorage so existing code paths still work.
    // IMPORTANT: the Supabase profile row does NOT carry user-curated local
    // state (collected tracks, playlists/folders). Without preserving it,
    // every auth refresh / token refresh / tab-focus would wipe what the user
    // just collected. So merge the previous local values forward.
    try {
      const db = window.DB.get();
      const prev = db.currentUser || {};
      if (Array.isArray(prev.likedTracks) && prev.likedTracks.length) {
        mapped.likedTracks = prev.likedTracks.slice();
      }
      if (Array.isArray(prev.playlists) && prev.playlists.length) {
        mapped.playlists = prev.playlists;
      }
      if (Array.isArray(prev.history) && prev.history.length) {
        mapped.history = prev.history;
      }
      window.__currentUser = mapped;
      db.currentUser = mapped;
      window.DB.save(db);
    } catch (_) {}
    // PC 간 동기화 — 위치 + 알림 읽음 상태 클라우드에서 받아와 localStorage 에 합침.
    // 백그라운드 호출 (await 안 함) — 로그인 흐름은 늦추지 않음.
    try {
      if (window.Positions && typeof window.Positions.hydrateFromCloud === 'function') {
        window.Positions.hydrateFromCloud().then(n => {
          if (n > 0) {
            // 위치가 새로 들어왔으면 현재 보고 있는 도형/우주 페이지를 다시 그림.
            // currentView 는 app.js 의 let 이라 window 에 직접 안 매달려 있을 수 있어 fallback.
            const view = (typeof window.currentView !== 'undefined') ? window.currentView
                       : (window.__currentView || null);
            if (view === 'shapes' && typeof window.renderShapes === 'function') {
              try { window.renderShapes(); } catch (_) {}
            } else if (view === 'universe' && typeof window.renderUniverse === 'function') {
              try { window.renderUniverse(); } catch (_) {}
            }
          }
        }).catch(_ => {});
      }
      if (window._hydrateNotifReadsFromCloud) {
        window._hydrateNotifReadsFromCloud();
      }
    } catch (_) {}
    return mapped;
  }

  // 외부에 노출
  window.fetchProfileByName = fetchProfileByName;

  // ────────────────────────────────────────────────────────────
  // 알림 읽음 상태 — PC 간 동기화 (2026_06_02 마이그레이션 필요)
  // 로컬 캐시(localStorage 'offstage_notif_read')는 그대로 두고, 클라우드에 mirror.
  // ────────────────────────────────────────────────────────────
  window.NotifReads = {
    async fetchAll() {
      if (!window.supabase || !window.__currentUser) return [];
      try {
        const { data, error } = await window.supabase
          .from('notification_reads')
          .select('notif_id')
          .eq('user_id', window.__currentUser.id);
        if (error) { console.warn('[NotifReads.fetchAll]', error.message); return []; }
        return (data || []).map(r => r.notif_id);
      } catch (e) { console.warn('[NotifReads.fetchAll]', e); return []; }
    },
    async markRead(notifId) {
      if (!notifId || !window.supabase || !window.__currentUser) return;
      try {
        await window.supabase
          .from('notification_reads')
          .upsert({ user_id: window.__currentUser.id, notif_id: notifId }, { onConflict: 'user_id,notif_id' });
      } catch (e) { console.warn('[NotifReads.markRead]', e); }
    },
    async markManyRead(notifIds) {
      if (!Array.isArray(notifIds) || !notifIds.length) return;
      if (!window.supabase || !window.__currentUser) return;
      try {
        const rows = notifIds.map(id => ({ user_id: window.__currentUser.id, notif_id: id }));
        await window.supabase
          .from('notification_reads')
          .upsert(rows, { onConflict: 'user_id,notif_id' });
      } catch (e) { console.warn('[NotifReads.markManyRead]', e); }
    }
  };

  // ────────────────────────────────────────────────────────────
  // 오브제(도형/우주/폴더) 위치 — PC 간 동기화
  // 기존 localStorage 키('shapepos:', 'unipos:', 'plpos:')는 빠른 캐시로 유지,
  // Supabase 는 cross-device 동기화 용도.
  // ────────────────────────────────────────────────────────────
  window.Positions = {
    async fetchAll() {
      if (!window.supabase || !window.__currentUser) return [];
      try {
        const { data, error } = await window.supabase
          .from('user_object_positions')
          .select('scope, scope_id, item_id, pass, x_pct, y_px')
          .eq('user_id', window.__currentUser.id);
        if (error) { console.warn('[Positions.fetchAll]', error.message); return []; }
        return data || [];
      } catch (e) { console.warn('[Positions.fetchAll]', e); return []; }
    },
    async save(scope, scopeId, itemId, pass, xPct, yPx) {
      if (!scope || !itemId) return;
      if (!window.supabase || !window.__currentUser) return;
      try {
        await window.supabase
          .from('user_object_positions')
          .upsert({
            user_id: window.__currentUser.id,
            scope,
            scope_id: scopeId || '',
            item_id: String(itemId),
            pass: pass != null ? Number(pass) : 0,
            x_pct: Number(xPct) || 0,
            y_px: Number(yPx) || 0,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,scope,scope_id,item_id,pass' });
      } catch (e) { console.warn('[Positions.save]', e); }
    },
    // 부팅 직후 한 번 호출해서 클라우드 데이터를 localStorage 에 반영.
    // 이렇게 하면 기존 렌더 코드는 그대로 localStorage 만 읽으면 됨.
    async hydrateFromCloud() {
      const rows = await window.Positions.fetchAll();
      if (!rows.length) return 0;
      let n = 0;
      rows.forEach(r => {
        let key;
        if (r.scope === 'shape') {
          key = 'shapepos:' + r.item_id + ':' + (r.pass != null ? r.pass : '0');
        } else if (r.scope === 'universe') {
          key = 'unipos:' + r.item_id;
        } else if (r.scope === 'playlist') {
          key = 'plpos:' + (r.scope_id || '') + ':' + r.item_id;
        } else { return; }
        try {
          localStorage.setItem(key, JSON.stringify({ xPct: r.x_pct, yPx: r.y_px }));
          n++;
        } catch (_) {}
      });
      return n;
    }
  };

  window.Auth = {
    // Returns the current session (from Supabase)
    async getSession() {
      if (!window.supabase) return null;
      const { data: { session } } = await window.supabase.auth.getSession();
      return session;
    },

    // Returns mapped profile (matches legacy currentUser shape). Cached in window.__currentUser.
    async currentProfile() {
      if (window.__currentUser) return window.__currentUser;
      return await syncCurrentUser();
    },

    async signUp({ email, password, name, role }) {
      if (!window.supabase) throw new Error('Supabase SDK가 로드되지 않았어요.');
      const metadata = {};
      if (name) metadata.name = name;
      if (role) metadata.role = role;
      const { data, error } = await window.supabase.auth.signUp({
        email, password,
        options: { data: metadata }
      });
      if (error) throw error;

      // If no session was returned (email confirmation ON), call our serverless
      // /api/auto-confirm to verify the user immediately, then sign them in.
      if (data.user && !data.session) {
        try {
          console.log('[signUp] no session — calling auto-confirm');
          const resp = await fetch('/api/auto-confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const body = await resp.json().catch(() => ({}));
          if (resp.ok && body.ok) {
            console.log('[signUp] auto-confirmed, signing in');
            const { data: signInData, error: signInErr } = await window.supabase.auth.signInWithPassword({ email, password });
            if (!signInErr && signInData.session) {
              data.session = signInData.session;
              data.user = signInData.user || data.user;
            }
          } else {
            console.warn('[signUp] auto-confirm failed:', body.error);
          }
        } catch (e) {
          console.warn('[signUp] auto-confirm threw', e);
        }
      }

      // If we have a session now, upsert profile properly
      if (data.user && data.session) {
        const payload = {
          id: data.user.id,
          name: name || (email && email.split('@')[0]) || '이름 없음',
          role: role || 'listener'
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          const { error: upErr } = await window.supabase
            .from('profiles')
            .upsert(payload, { onConflict: 'id' });
          if (!upErr) break;
          console.warn('[Auth] signUp upsert profile attempt ' + (attempt+1), upErr.message);
          await new Promise(r => setTimeout(r, 250));
        }
        // Final correction: ensure role landed right
        const { data: profRow } = await window.supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();
        if (profRow && profRow.role !== payload.role) {
          await window.supabase
            .from('profiles')
            .update({ role: payload.role, name: payload.name })
            .eq('id', data.user.id);
        }
      }
      await syncCurrentUser();
      return data;
    },

    async signIn({ email, password }) {
      if (!window.supabase) throw new Error('Supabase SDK가 로드되지 않았어요.');
      const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await syncCurrentUser();
      return data;
    },

    // OAuth — Google. No 비즈앱 hassle, used as primary social login.
    async signInWithGoogle() {
      if (!window.supabase) throw new Error('Supabase SDK가 로드되지 않았어요.');
      // No hash in redirectTo — Supabase appends #access_token=... and a second #
      // would prevent the fragment from being parsed.
      const redirectTo = window.location.origin + window.location.pathname;
      const { data, error } = await window.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) throw error;
      return data;
    },

    // OAuth — Kakao. Redirects out of the page; session is picked up on return
    // via detectSessionInUrl + onAuthStateChange. Throws on init error.
    async signInWithKakao() {
      if (!window.supabase) throw new Error('Supabase SDK가 로드되지 않았어요.');
      const redirectTo = window.location.origin + window.location.pathname;
      const { data, error } = await window.supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo,
          // Profile only — account_email requires Kakao 비즈앱 전환
          scopes: 'profile_nickname profile_image'
        }
      });
      if (error) throw error;
      return data;
    },

    // Passwordless — emails the user a one-time login link.
    // First-time email = automatic signup; existing email = login.
    async signInWithMagicLink(email) {
      if (!window.supabase) throw new Error('Supabase SDK가 로드되지 않았어요.');
      if (!email) throw new Error('이메일을 입력해주세요.');
      const emailRedirectTo = window.location.origin + window.location.pathname + '#/shapes';
      const { data, error } = await window.supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo }
      });
      if (error) throw error;
      return data;
    },

    async signOut() {
      if (!window.supabase) return;
      await window.supabase.auth.signOut();
      window.__currentUser = null;
      try {
        const db = window.DB.get();
        db.currentUser = null;
        window.DB.save(db);
      } catch (_) {}
    },

    // Subscribe to auth changes. cb receives (event, session).
    onAuthChange(cb) {
      if (!window.supabase) return () => {};
      const { data } = window.supabase.auth.onAuthStateChange(async (event, session) => {
        await syncCurrentUser();
        try { cb && cb(event, session); } catch (e) { console.warn('[Auth] onChange cb', e); }
      });
      return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
    },

    // Initial bootstrap — should be awaited once in init()
    async bootstrap() {
      if (!window.supabase) {
        console.warn('[Auth] Supabase SDK not ready — skipping auth bootstrap');
        return null;
      }
      return await syncCurrentUser();
    },

    // Force-refresh the session token + currentUser. Call on tab focus / visibility change.
    async refresh() {
      if (!window.supabase) return null;
      try {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session && session.expires_at) {
          const now = Math.floor(Date.now() / 1000);
          // If session expires within 5 min, refresh it
          if (session.expires_at - now < 300) {
            await window.supabase.auth.refreshSession();
          }
        }
        return await syncCurrentUser();
      } catch (e) {
        console.warn('[Auth] refresh failed', e);
        return null;
      }
    }
  };

  // Auto-refresh session/profile when tab becomes visible again
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && window.Auth && window.Auth.refresh) {
        window.Auth.refresh();
      }
    });
    window.addEventListener('focus', () => {
      if (window.Auth && window.Auth.refresh) window.Auth.refresh();
    });
  }

  // =====================================================================
  // Walls — 우리들의 벽 (wall_notes + wall_note_comments)
  // =====================================================================

  // Map Supabase row → legacy note shape
  function mapNoteRow(row, comments) {
    return {
      id: row.id,
      author: row.author_name || '익명',
      authorId: row.author_id || null,
      authorAvatar: (row.profiles && row.profiles.avatar_url) || '',  // 작성자 실제 프로필 사진(있으면)
      text: row.text || '',
      color: row.color || 'yellow',
      rotation: (typeof row.rotation === 'number') ? row.rotation : 0,
      createdAt: row.created_at,
      // Optional attached song link — Off-Stage track id OR external URL (YT/Spotify/Apple).
      trackId:     row.track_id     || null,
      externalUrl: row.external_url || '',
      // Optional attached photo (스레드 피드). image_url 컬럼이 없는 옛 스키마에선 undefined → ''.
      imageUrl:    row.image_url    || '',
      comments: Array.isArray(comments) ? comments.map(mapCommentRow) : []
    };
  }
  function mapCommentRow(row) {
    return {
      id: row.id,
      author: row.author_name || '익명',
      authorId: row.author_id || null,
      authorAvatar: (row.profiles && row.profiles.avatar_url) || '',  // 댓글 작성자 실제 프로필 사진(있으면)
      text: row.text || '',
      createdAt: row.created_at,
      // Optional attached song — Off-Stage track id OR external URL
      trackId:     row.track_id     || null,
      externalUrl: row.external_url || ''
    };
  }

  window.__wallNotes = null; // in-memory cache

  window.Walls = {
    async fetchAll(limit) {
      if (!window.supabase) return [];
      // 작성자 프로필 아바타까지 조인 (피드에 각자 실제 프로필 사진을 보여주려고).
      // 관계 추론이 안 되는 스키마면(에러) 조인 없이 재시도 → 피드는 안 깨짐.
      let notes, e1;
      ({ data: notes, error: e1 } = await window.supabase
        .from('wall_notes')
        .select('*, profiles(avatar_url)')
        .order('created_at', { ascending: false })
        .limit(limit || 200));
      if (e1) {
        ({ data: notes, error: e1 } = await window.supabase
          .from('wall_notes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit || 200));
      }
      if (e1) { console.warn('[Walls] fetchAll', e1.message); return []; }
      if (!notes || notes.length === 0) return [];

      // Fetch all comments for these notes in one query (작성자 아바타 조인, 실패 시 무조인)
      const ids = notes.map(n => n.id);
      let comments, e2;
      ({ data: comments, error: e2 } = await window.supabase
        .from('wall_note_comments')
        .select('*, profiles(avatar_url)')
        .in('note_id', ids)
        .order('created_at', { ascending: true }));
      if (e2) {
        ({ data: comments, error: e2 } = await window.supabase
          .from('wall_note_comments').select('*').in('note_id', ids).order('created_at', { ascending: true }));
      }
      if (e2) { console.warn('[Walls] fetchComments bulk', e2.message); }

      const byNote = {};
      (comments || []).forEach(c => {
        if (!byNote[c.note_id]) byNote[c.note_id] = [];
        byNote[c.note_id].push(c);
      });
      return notes.map(n => mapNoteRow(n, byNote[n.id] || []));
    },

    async fetchComments(noteId) {
      if (!window.supabase || !noteId) return [];
      let data, error;
      ({ data, error } = await window.supabase
        .from('wall_note_comments')
        .select('*, profiles(avatar_url)')
        .eq('note_id', noteId)
        .order('created_at', { ascending: true }));
      if (error) {
        ({ data, error } = await window.supabase
          .from('wall_note_comments').select('*').eq('note_id', noteId).order('created_at', { ascending: true }));
      }
      if (error) { console.warn('[Walls] fetchComments', error.message); return []; }
      return (data || []).map(mapCommentRow);
    },

    async insert({ text, color, rotation, trackId, externalUrl, imageUrl }) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      // ⚠️ wall_notes.author_id 는 profiles(id) 를 참조하는 FK — profiles 행 없으면 인서트 실패.
      // 사용자 중 일부(트리거 실패한 OAuth/매직링크) 가 영향받으므로 매번 보장.
      const ok = await ensureProfileRow();
      if (!ok) throw new Error('프로필 정보가 없어 글을 올릴 수 없어요. 로그아웃 후 다시 로그인 해주세요.');
      const profile = window.__currentUser;
      const author_name = (profile && profile.name) || (user.email ? user.email.split('@')[0] : '익명');
      const payload = {
        author_id: user.id,
        author_name,
        text: (text || '').slice(0, 500),
        color: color || 'yellow',
        rotation: (typeof rotation === 'number') ? rotation : 0
      };
      // Only include song-link columns when the user actually attached one,
      // so this still works on schemas that haven't run the migration yet.
      if (trackId)     payload.track_id     = trackId;
      if (externalUrl) payload.external_url = externalUrl;
      if (imageUrl)    payload.image_url    = imageUrl;
      const { data, error } = await window.supabase
        .from('wall_notes')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      const mapped = mapNoteRow(data, []);
      if (Array.isArray(window.__wallNotes)) window.__wallNotes.unshift(mapped);
      return mapped;
    },

    async delete(noteId) {
      if (!window.supabase) return;
      const { error } = await window.supabase
        .from('wall_notes')
        .delete()
        .eq('id', noteId);
      if (error) throw error;
      if (Array.isArray(window.__wallNotes)) {
        window.__wallNotes = window.__wallNotes.filter(n => n.id !== noteId);
      }
    },

    async addComment(noteId, { text, authorName, trackId, externalUrl }) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      // FK 보장: wall_note_comments.author_id → profiles(id)
      const ok = await ensureProfileRow();
      if (!ok) throw new Error('프로필 정보가 없어 댓글을 올릴 수 없어요. 로그아웃 후 다시 로그인 해주세요.');
      const profile = window.__currentUser;
      const name = (authorName && authorName.trim())
        || (profile && profile.name)
        || (user.email ? user.email.split('@')[0] : '익명');
      const payload = {
        note_id: noteId,
        author_id: user.id,
        author_name: name,
        text: (text || '').slice(0, 500)
      };
      // Only include song-link columns when the user actually attached one,
      // so this still works against schemas that haven't run the migration yet.
      if (trackId)     payload.track_id     = trackId;
      if (externalUrl) payload.external_url = externalUrl;
      const { data, error } = await window.supabase
        .from('wall_note_comments')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      const mapped = mapCommentRow(data);
      // Update cache
      if (Array.isArray(window.__wallNotes)) {
        const n = window.__wallNotes.find(x => x.id === noteId);
        if (n) {
          if (!Array.isArray(n.comments)) n.comments = [];
          n.comments.push(mapped);
        }
      }
      return mapped;
    },

    // Delete a comment (RLS only lets the author delete their own row).
    async deleteComment(commentId, noteId) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { error } = await window.supabase
        .from('wall_note_comments')
        .delete()
        .eq('id', commentId);
      if (error) throw error;
      // Update cache
      if (Array.isArray(window.__wallNotes) && noteId) {
        const n = window.__wallNotes.find(x => x.id === noteId);
        if (n && Array.isArray(n.comments)) {
          n.comments = n.comments.filter(c => c.id !== commentId);
        }
      }
    },

    // Refresh the cache + mirror into legacy db.notes so sync code paths keep working
    async refreshInto(db) {
      const notes = await this.fetchAll();
      window.__wallNotes = notes;
      // 호출자의 (오래됐을 수 있는) db 스냅샷에는 메모리 반영만.
      if (db && typeof db === 'object') db.notes = notes;
      // ⚠ TOCTOU 방지 — 저장은 "지금" 의 localStorage 를 새로 읽어 내 필드만 쓴다.
      //   stale 스냅샷을 통째로 save 하면 그 사이 다른 코드가 저장한
      //   댓글/트랙 등을 옛 데이터로 되돌려버림.
      try {
        const fresh = window.DB.get();
        fresh.notes = notes;
        window.DB.save(fresh);
      } catch (_) {}
      return notes;
    },

    // === Bookmarks (포스트잇 수집) ===
    async refreshMyBookmarks() {
      if (!window.supabase) return;
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) { window.__bookmarkedNotes = new Set(); return; }
      const { data, error } = await window.supabase
        .from('note_bookmarks')
        .select('note_id')
        .eq('user_id', user.id);
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Walls.bookmarks] refreshMine', error.message);
        }
        window.__bookmarkedNotes = new Set();
        return;
      }
      window.__bookmarkedNotes = new Set((data || []).map(r => r.note_id));
    },

    isBookmarked(noteId) {
      return !!(window.__bookmarkedNotes && window.__bookmarkedNotes.has(noteId));
    },

    async toggleBookmark(noteId) {
      if (!window.supabase) throw new Error('Supabase not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const has = window.__bookmarkedNotes && window.__bookmarkedNotes.has(noteId);
      if (has) {
        const { error } = await window.supabase
          .from('note_bookmarks')
          .delete()
          .eq('user_id', user.id)
          .eq('note_id', noteId);
        if (error) throw error;
        window.__bookmarkedNotes.delete(noteId);
        return { bookmarked: false };
      } else {
        const { error } = await window.supabase
          .from('note_bookmarks')
          .insert({ user_id: user.id, note_id: noteId });
        if (error) {
          if (/relation .* does not exist/.test(error.message || '')) {
            throw new Error('수집 테이블이 아직 만들어지지 않았어요. supabase/bookmarks.sql 실행 필요');
          }
          throw error;
        }
        if (!window.__bookmarkedNotes) window.__bookmarkedNotes = new Set();
        window.__bookmarkedNotes.add(noteId);
        return { bookmarked: true };
      }
    },

    async fetchMyBookmarks() {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      // Get bookmarks → join wall_notes
      const { data, error } = await window.supabase
        .from('note_bookmarks')
        .select('note_id, bookmarked_at, wall_notes(*)')
        .eq('user_id', user.id)
        .order('bookmarked_at', { ascending: false });
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Walls] fetchMyBookmarks', error.message);
        }
        return [];
      }
      return (data || [])
        .filter(r => r.wall_notes)
        .map(r => mapNoteRow(r.wall_notes, []));
    },

    // ── 포스트잇 좋아요 (공개) ─────────────────────────────────────
    // 누구나 포스트잇에 좋아요할 수 있고, 그 결과는 본인의 아티스트
    // 페이지 "내가 모은 글" 탭에 공개됨.

    // 현재 로그인 사용자가 좋아한 noteId Set을 메모리에 캐시
    async refreshMyFavorites() {
      if (!window.supabase) return new Set();
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) { window.__favoritedNotes = new Set(); return window.__favoritedNotes; }
      const { data, error } = await window.supabase
        .from('note_favorites')
        .select('note_id')
        .eq('user_id', user.id);
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Walls] refreshMyFavorites', error.message);
        }
        window.__favoritedNotes = new Set();
        return window.__favoritedNotes;
      }
      window.__favoritedNotes = new Set((data || []).map(r => r.note_id));
      return window.__favoritedNotes;
    },

    isFavorited(noteId) {
      return !!(window.__favoritedNotes && window.__favoritedNotes.has(noteId));
    },

    async toggleFavorite(noteId, want) {
      if (!window.supabase) throw new Error('Supabase not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      if (!window.__favoritedNotes) window.__favoritedNotes = new Set();
      // want(boolean) 명시되면 그 동작을 강제한다. 호출부(toggleNoteLike)가 낙관적으로
      // __favoritedNotes 를 미리 바꿔놓으므로, 여기서 그걸 보고 판단하면 거꾸로 동작(좋아요인데
      // 삭제)하던 버그가 있었음 → want 로 정확히 insert/delete. 미지정 시에만 기존 토글.
      const like = (typeof want === 'boolean') ? want : !window.__favoritedNotes.has(noteId);
      if (!like) {
        const { data, error } = await window.supabase
          .from('note_favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('note_id', noteId)
          .select();   // 실제 삭제된 행을 돌려받아 '조용한 0행 삭제'(RLS DELETE 정책 누락)를 감지
        if (error) throw error;
        if (!data || data.length === 0) {
          // 에러는 없지만 한 행도 안 지워짐 = note_favorites 에 본인 DELETE 를 허용하는 RLS
          // 정책이 없음(기본 거부). 예전엔 조용히 넘어가 화면만 흰색→새로고침 때 빨강으로
          // 되살아나 혼란스러웠음. 이제 명확히 실패로 던져 낙관적 표시를 되돌리고 토스트.
          throw new Error('NO_DELETE_POLICY');
        }
        window.__favoritedNotes.delete(noteId);
        return { favorited: false };
      } else {
        const { error } = await window.supabase
          .from('note_favorites')
          .insert({ user_id: user.id, note_id: noteId });
        if (error) {
          // 중복(이미 좋아함)도 정상 처리
          if (!/duplicate key|already exists/i.test(error.message || '')) throw error;
        }
        window.__favoritedNotes.add(noteId);
        return { favorited: true };
      }
    },

    // 노트별 좋아요 수(공개) — 전체 note_favorites 를 한 번 읽어 noteId→count 맵 구성.
    // note_favorites 는 public read 라 익명도 카운트 가능. 초기 규모엔 충분(많아지면 카운트 컬럼/뷰로 최적화).
    async refreshFavoriteCounts() {
      window.__noteFavCounts = window.__noteFavCounts || {};
      if (!window.supabase) return window.__noteFavCounts;
      const { data, error } = await window.supabase
        .from('note_favorites')
        .select('note_id');
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Walls] refreshFavoriteCounts', error.message);
        }
        return window.__noteFavCounts;
      }
      const counts = {};
      (data || []).forEach(r => { counts[r.note_id] = (counts[r.note_id] || 0) + 1; });
      window.__noteFavCounts = counts;
      return counts;
    },

    favoriteCount(noteId) {
      return (window.__noteFavCounts && window.__noteFavCounts[noteId]) || 0;
    },

    // 내가 좋아한 노트들 — 라이브러리에서 사용
    async fetchMyFavorites() {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await window.supabase
        .from('note_favorites')
        .select('note_id, favorited_at, wall_notes(*)')
        .eq('user_id', user.id)
        .order('favorited_at', { ascending: false });
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Walls] fetchMyFavorites', error.message);
        }
        return [];
      }
      return (data || [])
        .filter(r => r.wall_notes)
        .map(r => mapNoteRow(r.wall_notes, []));
    },

    // 특정 사용자(아티스트)가 좋아한 노트들을 가져옴 — 공개 표시용
    //   userId 우선, 없으면 artistName 으로 profile 조회 후 fetch.
    async fetchFavoritesByName(artistName) {
      if (!window.supabase || !artistName) return [];
      // 아티스트 name → user_id 매핑
      const { data: prof } = await window.supabase
        .from('profiles')
        .select('id')
        .eq('name', artistName)
        .maybeSingle();
      if (!prof) return [];
      const { data, error } = await window.supabase
        .from('note_favorites')
        .select('note_id, favorited_at, wall_notes(*)')
        .eq('user_id', prof.id)
        .order('favorited_at', { ascending: false });
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Walls] fetchFavoritesByName', error.message);
        }
        return [];
      }
      return (data || [])
        .filter(r => r.wall_notes)
        .map(r => mapNoteRow(r.wall_notes, []));
    }
  };

  // =====================================================================
  // Tracks — demos + masters, audio/cover Storage, diaries, comments
  // =====================================================================

  function mapTrackRow(row, authorProfile) {
    return {
      id: row.id,
      projectId: row.project_id || row.id,
      projectStage: row.project_stage || 'demo',  // 데모 / voting / released / concert
      artist: (authorProfile && authorProfile.name) || row.artist_name_cache || '알수없는 아티스트',
      artistId: row.artist_id,
      artistAvatar: (authorProfile && authorProfile.avatar_url) || ('https://i.pravatar.cc/150?u=' + row.artist_id),
      title: row.title || '',
      description: row.description || '',
      audioUrl: row.audio_url || '',
      cover: row.cover_url || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500',
      hasCustomCover: !!row.cover_url,        // ⭐️ 사진 첨부 여부 — 없으면 포스트잇 fallback
      version: row.version || 'final',
      versionLabel: row.version_label || 'Final',
      isDemo: !!row.is_demo,
      artistNote: row.artist_note || '',
      lyrics: row.lyrics || '',   // 가사 — 앨범(곡) 페이지에 표시. lyrics 컬럼 없는 옛 스키마면 ''.
      tags: Array.isArray(row.tags) ? row.tags : [],
      shape: row.shape || 'circle',
      shapeColor: row.shape_color || '#FF9800',
      lines: Array.isArray(row.lines) ? row.lines : [row.title || '', (authorProfile && authorProfile.name) || '', '클릭해서 들어봐!'],
      likes: row.likes_count || 0,
      plays: row.plays_count || 0,
      createdAt: row.created_at,
      // 유통사 제출용 메타 (관리자 ZIP 빌더에서 사용)
      distArtist: row.dist_artist || '',
      releaseDate: row.release_date || '',
      // 콜라보 아티스트 — [{name, userId?}, ...]
      collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
      trackComments: [],
      __supabase: true
    };
  }

  function mapTrackCommentRow(row) {
    return {
      id: row.id,
      author: row.author_name || '익명',
      authorId: row.author_id || null,
      text: row.text || '',
      createdAt: row.created_at
    };
  }

  window.__tracks = null;

  window.Tracks = {
    async fetchAll(limit) {
      if (!window.supabase) return [];
      // Join profiles to get artist name/avatar
      const { data, error } = await window.supabase
        .from('tracks')
        .select('*, profiles(id, name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(limit || 500);
      if (error) { console.warn('[Tracks] fetchAll', error.message); return []; }
      return (data || []).map(row => mapTrackRow(row, row.profiles));
    },

    async uploadFile(file, bucket) {
      if (!window.supabase || !file) throw new Error('Supabase or file missing');

      // Refresh session if it's about to expire (storage rejects expired tokens)
      try {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session && session.expires_at) {
          const now = Math.floor(Date.now() / 1000);
          if (session.expires_at - now < 120) {
            console.log('[upload] session near expiry, refreshing…');
            await window.supabase.auth.refreshSession();
          }
        }
      } catch (e) { console.warn('[upload] session refresh', e); }

      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인 세션이 끊어졌어요. 다시 로그인 해주세요.');
      const mb = (file.size / 1024 / 1024).toFixed(1);
      console.log(`[upload] ${file.name} (${mb}MB) → bucket:${bucket} as ${user.id}`);
      const ext = (file.name && file.name.split('.').pop()) || 'bin';
      const path = user.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;

      // Race upload against a 120-second timeout so it never hangs forever
      // cacheControl: 60s — short cache so new avatars/covers appear immediately on next load
      const uploadPromise = window.supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '60', upsert: false, contentType: file.type || undefined
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`업로드 타임아웃 (120초). 파일: ${mb}MB — 파일이 크거나 네트워크가 느려요.`)), 120000)
      );
      const result = await Promise.race([uploadPromise, timeoutPromise]);
      if (result.error) {
        console.error('[upload] storage error', result.error);
        const msg = result.error.message || '';
        if (/row-level security/i.test(msg) || /unauthorized/i.test(msg)) {
          throw new Error('권한 에러 — 로그아웃 후 다시 로그인 해주세요.');
        }
        if (/exceeded/i.test(msg) || /too large/i.test(msg) || /payload/i.test(msg)) {
          throw new Error(`파일이 너무 큼 (${mb}MB). Supabase 무료 플랜 50MB 제한.`);
        }
        throw new Error('스토리지 에러: ' + msg);
      }
      const { data: urlData } = window.supabase.storage.from(bucket).getPublicUrl(path);
      console.log('[upload] done →', urlData.publicUrl);
      return urlData.publicUrl;
    },

    async insert(track) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');

      // ⚠️ tracks.artist_id 는 profiles(id) 를 참조하는 FK다. 프로필 행이 없으면
      // 업로드가 FK 위반으로 실패한다(=어떤 사람은 되고 어떤 사람은 안 되는 원인).
      // ensureProfileRow가 없으면 만들고, 그래도 안 되면 에러로 빨리 알린다.
      const ok = await ensureProfileRow();
      if (!ok) {
        throw new Error('프로필 정보가 없어 업로드가 막혀요. 로그아웃 후 다시 로그인 해주세요.');
      }

      const payload = {
        artist_id: user.id,
        project_id: track.projectId || undefined,  // let DB default uuid if omitted
        title: track.title || '제목 없음',
        description: track.description || '',
        audio_url: track.audioUrl || '',
        cover_url: track.cover || '',
        version: track.version || 'final',
        version_label: track.versionLabel || 'Final',
        is_demo: !!track.isDemo,
        artist_note: track.artistNote || '',
        tags: Array.isArray(track.tags) ? track.tags : [],
        shape: track.shape || 'circle',
        shape_color: track.shapeColor || '#FF9800',
        lines: Array.isArray(track.lines) ? track.lines : [],
        // 유통사 제출용 메타 (학생이 업로드 폼에서 직접 입력)
        dist_artist: track.distArtist || null,
        release_date: track.releaseDate || null,
        // 콜라보 아티스트 [{name, userId?}, ...]
        collaborators: Array.isArray(track.collaborators) ? track.collaborators : []
      };
      // 가사 — 앨범(곡) 페이지에 표시. 값 있을 때만 포함(컬럼 없는 옛 스키마에도 안전).
      if (track.lyrics) payload.lyrics = track.lyrics;
      let { data, error } = await window.supabase
        .from('tracks')
        .insert(payload)
        .select('*, profiles(id, name, avatar_url)')
        .single();
      // lyrics 컬럼이 없는 스키마(마이그레이션 SQL 미실행)면 가사만 빼고 다시 시도 → 업로드 자체는 살림.
      if (error && payload.lyrics && /lyrics|column|schema|PGRST/i.test(error.message || '')) {
        console.warn('[Tracks.insert] lyrics 컬럼 없음 — 가사 제외하고 재시도');
        delete payload.lyrics;
        ({ data, error } = await window.supabase
          .from('tracks')
          .insert(payload)
          .select('*, profiles(id, name, avatar_url)')
          .single());
      }
      if (error) {
        const m = error.message || '';
        if (/foreign key|violates foreign key|not present in table "profiles"/i.test(m)) {
          throw new Error('프로필 정보가 없어 업로드가 막혔어요. 로그아웃 후 다시 로그인하면 자동으로 복구돼요.');
        }
        if (/row-level security/i.test(m)) {
          throw new Error('업로드 권한 에러 — 로그아웃 후 다시 로그인 해주세요.');
        }
        throw error;
      }
      const mapped = mapTrackRow(data, data.profiles);
      if (Array.isArray(window.__tracks)) window.__tracks.unshift(mapped);
      return mapped;
    },

    async delete(trackId) {
      if (!window.supabase) return;
      const { error } = await window.supabase.from('tracks').delete().eq('id', trackId);
      if (error) throw error;
      if (Array.isArray(window.__tracks)) window.__tracks = window.__tracks.filter(t => t.id !== trackId);
    },

    // List current user's projects grouped by project_id for the upload-to-existing flow
    async listMyProjects() {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await window.supabase
        .from('tracks')
        .select('id, project_id, title, cover_url, version, version_label, is_demo, created_at')
        .eq('artist_id', user.id)
        .order('created_at', { ascending: true });
      if (error) { console.warn('[Tracks] listMyProjects', error.message); return []; }
      const byProj = {};
      (data || []).forEach(r => {
        const pid = r.project_id || r.id;
        if (!byProj[pid]) {
          byProj[pid] = {
            projectId: pid,
            title: (r.title || '').replace(/\s*\(.*\)$/i, ''),
            cover: r.cover_url,
            versions: [],
            hasFinal: false,
            demoCount: 0,
            nextDemoNum: 1   // next demo number to suggest for upload
          };
        }
        byProj[pid].versions.push({ id: r.id, version: r.version, label: r.version_label, isDemo: r.is_demo });
        if (r.is_demo) byProj[pid].demoCount++;
        if (r.version === 'final' && !r.is_demo) byProj[pid].hasFinal = true;
        // Track highest demoN seen across active + retired demos
        const m = /^demo(\d+)$/.exec(r.version || '');
        if (m) {
          const n = parseInt(m[1], 10);
          if (n + 1 > byProj[pid].nextDemoNum) byProj[pid].nextDemoNum = n + 1;
        }
      });
      return Object.values(byProj);
    },

    // Promote a demo to the final/master of its project
    async promoteToFinal(trackId) {
      if (!window.supabase) throw new Error('Supabase not ready');
      // First check if project already has a final — if so, demote it to a demo
      const { data: track } = await window.supabase
        .from('tracks').select('project_id').eq('id', trackId).maybeSingle();
      if (track && track.project_id) {
        const { data: existingFinals } = await window.supabase
          .from('tracks').select('id, version_label')
          .eq('project_id', track.project_id).eq('version', 'final').neq('id', trackId);
        if (existingFinals && existingFinals.length) {
          for (const ef of existingFinals) {
            await window.supabase.from('tracks').update({
              version: 'demo_retired', version_label: (ef.version_label || 'Final') + ' (이전)', is_demo: true
            }).eq('id', ef.id);
          }
        }
      }
      const { error } = await window.supabase.from('tracks')
        .update({ version: 'final', version_label: 'Final', is_demo: false })
        .eq('id', trackId);
      if (error) throw error;
      if (Array.isArray(window.__tracks)) {
        const t = window.__tracks.find(x => x.id === trackId);
        if (t) { t.version = 'final'; t.versionLabel = 'Final'; t.isDemo = false; }
      }
    },

    // Update a track's cover URL (used to change project cover photo)
    async setCover(trackId, coverUrl) {
      if (!window.supabase) throw new Error('Supabase not ready');
      const { error } = await window.supabase
        .from('tracks')
        .update({ cover_url: coverUrl })
        .eq('id', trackId);
      if (error) throw error;
      if (Array.isArray(window.__tracks)) {
        const t = window.__tracks.find(x => x.id === trackId);
        if (t) t.cover = coverUrl;
      }
    },

    // Update cover for the entire project (all demos + master)
    async setProjectCover(projectId, coverUrl) {
      if (!window.supabase) throw new Error('Supabase not ready');
      const { error } = await window.supabase
        .from('tracks')
        .update({ cover_url: coverUrl })
        .eq('project_id', projectId);
      if (error) throw error;
      if (Array.isArray(window.__tracks)) {
        window.__tracks.forEach(t => { if (t.projectId === projectId) t.cover = coverUrl; });
      }
    },

    // Update project stage (#함께만드는중 단계: demo → voting → released → concert)
    async setProjectStage(projectId, stage) {
      if (!window.supabase) throw new Error('Supabase not ready');
      if (!['demo','voting','released','concert'].includes(stage)) throw new Error('잘못된 단계');
      const { error } = await window.supabase
        .from('tracks')
        .update({ project_stage: stage })
        .eq('project_id', projectId);
      if (error) {
        if (/column .* does not exist/.test(error.message || '')) {
          throw new Error('단계 컬럼이 아직 만들어지지 않았어요. supabase/stage.sql 실행 필요.');
        }
        throw error;
      }
      if (Array.isArray(window.__tracks)) {
        window.__tracks.forEach(t => { if (t.projectId === projectId) t.projectStage = stage; });
      }
    },

    // Fetch a strip of recent backers for a project (across all its tracks)
    async fetchProjectBackerStrip(projectId, limit) {
      if (!window.supabase || !projectId) return { backers: [], total: 0 };
      // First find all track ids in the project
      const { data: trackRows } = await window.supabase
        .from('tracks').select('id').eq('project_id', projectId);
      const ids = (trackRows || []).map(r => r.id);
      if (!ids.length) return { backers: [], total: 0 };
      const { data, count, error } = await window.supabase
        .from('track_backers')
        .select('backer_id, backed_at, profiles(name, avatar_url)', { count: 'exact' })
        .in('track_id', ids)
        .order('backed_at', { ascending: false })
        .limit(limit || 20);
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[backerStrip]', error.message);
        }
        return { backers: [], total: 0 };
      }
      // Dedupe by backer_id (latest backing per user wins)
      const seen = new Set();
      const backers = [];
      (data || []).forEach(r => {
        if (seen.has(r.backer_id)) return;
        seen.add(r.backer_id);
        backers.push({
          userId: r.backer_id,
          name: r.profiles?.name || '익명',
          avatar: r.profiles?.avatar_url || ('https://i.pravatar.cc/150?u=' + r.backer_id),
          backedAt: r.backed_at
        });
      });
      return { backers, total: count || backers.length };
    },

    async setArtistNote(trackId, note) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { error } = await window.supabase
        .from('tracks')
        .update({ artist_note: note || '' })
        .eq('id', trackId);
      if (error) throw error;
      if (Array.isArray(window.__tracks)) {
        const t = window.__tracks.find(x => x.id === trackId);
        if (t) t.artistNote = note || '';
      }
    },

    async fetchComments(trackId) {
      if (!window.supabase || !trackId) return [];
      const { data, error } = await window.supabase
        .from('track_comments')
        .select('*')
        .eq('track_id', trackId)
        .order('created_at', { ascending: true });
      if (error) { console.warn('[Tracks] fetchComments', error.message); return []; }
      return (data || []).map(mapTrackCommentRow);
    },

    async addComment(trackId, { text, authorName }) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      // FK 보장: track_comments.author_id → profiles(id)
      const ok = await ensureProfileRow();
      if (!ok) throw new Error('프로필 정보가 없어 댓글을 올릴 수 없어요. 로그아웃 후 다시 로그인 해주세요.');
      const profile = window.__currentUser;
      const name = (authorName && authorName.trim())
        || (profile && profile.name)
        || (user.email ? user.email.split('@')[0] : '익명');
      const payload = {
        track_id: trackId,
        author_id: user.id,
        author_name: name,
        text: (text || '').slice(0, 500)
      };
      const { data, error } = await window.supabase
        .from('track_comments')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      const mapped = mapTrackCommentRow(data);
      if (Array.isArray(window.__tracks)) {
        const t = window.__tracks.find(x => x.id === trackId);
        if (t) {
          if (!Array.isArray(t.trackComments)) t.trackComments = [];
          t.trackComments.push(mapped);
        }
      }
      return mapped;
    },

    // 댓글 삭제 — author_id 본인만 (RLS 가 검증)
    async deleteComment(commentId, trackId) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { error } = await window.supabase
        .from('track_comments')
        .delete()
        .eq('id', commentId);
      if (error) throw error;
      // 로컬 캐시도 동기화
      if (Array.isArray(window.__tracks) && trackId) {
        const t = window.__tracks.find(x => x.id === trackId);
        if (t && Array.isArray(t.trackComments)) {
          t.trackComments = t.trackComments.filter(c => c.id !== commentId);
        }
      }
    },

    // Batch fetch comments for all tracks — one query instead of N.
    // 댓글이 새로고침 후 사라지던 버그 (mapTrackRow 가 trackComments:[] 로 덮어쓰던 문제) 의 fix.
    async fetchAllComments() {
      if (!window.supabase) return new Map();
      const { data, error } = await window.supabase
        .from('track_comments')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) { console.warn('[Tracks] fetchAllComments', error.message); return new Map(); }
      const byTrack = new Map();
      (data || []).forEach(row => {
        const tid = row.track_id;
        if (!byTrack.has(tid)) byTrack.set(tid, []);
        byTrack.get(tid).push(mapTrackCommentRow(row));
      });
      return byTrack;
    },

    // Merge Supabase tracks with existing db.tracks (Supabase at top).
    // Keeps localStorage mock so the site never looks empty; Supabase uploads appear first.
    async refreshInto(db) {
      const supabaseTracks = await this.fetchAll();
      // ⭐️ 핵심 fix: 이전 캐시의 trackComments 와 _commentsLoaded 보존.
      //    안 그러면 매 refresh 마다 mapTrackRow 가 trackComments:[] 로 덮어써
      //    이미 fetch 한 댓글이 사라짐 → "새로고침하면 댓글이 없어져" 버그.
      const prevByID = new Map();
      if (Array.isArray(window.__tracks)) {
        window.__tracks.forEach(t => { if (t && t.id) prevByID.set(t.id, t); });
      }
      supabaseTracks.forEach(t => {
        const prev = prevByID.get(t.id);
        if (prev && Array.isArray(prev.trackComments) && prev.trackComments.length) {
          t.trackComments = prev.trackComments;
          t._commentsLoaded = prev._commentsLoaded;
        }
      });
      window.__tracks = supabaseTracks;
      // supabase 트랙 + (대상 db 의) mock 트랙 병합 — 공용 헬퍼
      const _mergeTracksInto = (target) => {
        if (!target || typeof target !== 'object') return;
        const mocks = (target.tracks || []).filter(t => t && !t.__supabase);
        target.tracks = [...supabaseTracks, ...mocks];
      };
      // 호출자의 (오래됐을 수 있는) db 스냅샷에는 메모리 반영만.
      _mergeTracksInto(db);
      // ⚠ TOCTOU 방지 — 저장은 fresh DB.get() 에 내 필드만. stale 스냅샷을
      //   통째로 save 하면 그 사이 저장된 댓글 등을 옛 데이터로 되돌림.
      try {
        const fresh = window.DB.get();
        _mergeTracksInto(fresh);
        window.DB.save(fresh);
      } catch (_) {}
      // 백그라운드로 모든 트랙의 댓글을 한 번에 가져와 cache 갱신 (1 query — N+1 회피).
      // 첫 로드 시 (캐시 없을 때) 도 댓글이 inline 으로 보이게 됨.
      try {
        const byTrack = await this.fetchAllComments();
        supabaseTracks.forEach(t => {
          const cms = byTrack.get(t.id);
          if (cms) { t.trackComments = cms; t._commentsLoaded = true; }
        });
        // 댓글 합쳐진 상태를 다시 fresh 스냅샷에 저장 (위와 같은 이유)
        try {
          const fresh2 = window.DB.get();
          _mergeTracksInto(fresh2);
          window.DB.save(fresh2);
        } catch (_) {}
      } catch (e) {
        console.warn('[Tracks] refreshInto fetchAllComments', e);
      }
      return supabaseTracks;
    }
  };

  // =====================================================================
  // Favorites — 곡 즐겨찾기 (별 표시)
  // =====================================================================

  window.__favoritedTracks = new Set(); // my favorited track IDs

  window.Favorites = {
    isFavorited(trackId) {
      return trackId && window.__favoritedTracks && window.__favoritedTracks.has(trackId);
    },

    async refreshMine() {
      if (!window.supabase) { window.__favoritedTracks = new Set(); return; }
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) { window.__favoritedTracks = new Set(); return; }
      const { data, error } = await window.supabase
        .from('track_favorites')
        .select('track_id')
        .eq('user_id', user.id);
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Favorites] refreshMine', error.message);
        }
        return;
      }
      window.__favoritedTracks = new Set((data || []).map(r => r.track_id));
    },

    async fetchMyFavorites() {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await window.supabase
        .from('track_favorites')
        .select('track_id, favorited_at, tracks(*, profiles(id, name, avatar_url))')
        .eq('user_id', user.id)
        .order('favorited_at', { ascending: false });
      if (error) {
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Favorites] fetchMyFavorites', error.message);
        }
        return [];
      }
      return (data || [])
        .filter(r => r.tracks)
        .map(r => mapTrackRow(r.tracks, r.tracks.profiles));
    },

    async toggle(trackId) {
      if (!window.supabase || !trackId) return { favorited: false };
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const isFav = window.__favoritedTracks && window.__favoritedTracks.has(trackId);
      if (isFav) {
        const { error } = await window.supabase
          .from('track_favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('track_id', trackId);
        if (error) throw error;
        window.__favoritedTracks.delete(trackId);
        return { favorited: false };
      } else {
        const { error } = await window.supabase
          .from('track_favorites')
          .insert({ user_id: user.id, track_id: trackId });
        if (error) {
          // unique violation = already favorited (race)
          if (!/duplicate/i.test(error.message || '')) throw error;
        }
        if (!window.__favoritedTracks) window.__favoritedTracks = new Set();
        window.__favoritedTracks.add(trackId);
        return { favorited: true };
      }
    }
  };

  // =====================================================================
  // Follows — 아티스트 팬 관계
  // =====================================================================

  window.__followed = new Set(); // my followed artist IDs
  window.__fanCounts = new Map(); // artistId -> number

  window.Follows = {
    // Look up an artist's profile id by display name (matches first profile row)
    async getArtistIdByName(name) {
      if (!window.supabase || !name) return null;
      const { data, error } = await window.supabase
        .from('profiles')
        .select('id')
        .eq('name', name)
        .limit(1)
        .maybeSingle();
      if (error) { console.warn('[Follows] getArtistIdByName', error.message); return null; }
      return data ? data.id : null;
    },

    async refreshMine() {
      if (!window.supabase) return;
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) { window.__followed = new Set(); return; }
      const { data, error } = await window.supabase
        .from('follows')
        .select('followed_id')
        .eq('follower_id', user.id);
      if (error) { console.warn('[Follows] refreshMine', error.message); return; }
      window.__followed = new Set((data || []).map(r => r.followed_id));
    },

    async fanCount(artistId) {
      if (!window.supabase || !artistId) return 0;
      if (window.__fanCounts.has(artistId)) return window.__fanCounts.get(artistId);
      const { count, error } = await window.supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('followed_id', artistId);
      if (error) { console.warn('[Follows] fanCount', error.message); return 0; }
      window.__fanCounts.set(artistId, count || 0);
      return count || 0;
    },

    isFollowing(artistId) {
      return artistId && window.__followed && window.__followed.has(artistId);
    },

    async fetchMyArtists() {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await window.supabase
        .from('follows')
        .select('followed_id, created_at')
        .eq('follower_id', user.id)
        .order('created_at', { ascending: false });
      // Bulk-fetch profiles for the followed ids (separate query — avoids FK alias quirks)
      if (error) { console.warn('[Follows] fetchMyArtists', error.message); return []; }
      const ids = (data || []).map(r => r.followed_id);
      if (!ids.length) return [];
      const { data: profs } = await window.supabase
        .from('profiles')
        .select('id, name, avatar_url, role')
        .in('id', ids);
      const byId = {};
      (profs || []).forEach(p => { byId[p.id] = p; });

      // Per-artist fan counts (temp stand-in for SPO 참여자 until Hana SPO is wired)
      const fanCountById = {};
      try {
        const fanCountPromises = ids.map(async (id) => {
          const { count } = await window.supabase
            .from('follows').select('*', { count: 'exact', head: true })
            .eq('followed_id', id);
          fanCountById[id] = count || 0;
        });
        await Promise.all(fanCountPromises);
      } catch (e) { console.warn('[Follows] fan counts', e); }

      // Per-artist track count (temp proxy for stream count until play tracking added)
      const trackCountById = {};
      try {
        const { data: trackRows } = await window.supabase
          .from('tracks').select('id, artist_id').in('artist_id', ids);
        (trackRows || []).forEach(t => { trackCountById[t.artist_id] = (trackCountById[t.artist_id] || 0) + 1; });
      } catch (e) { console.warn('[Follows] track counts', e); }

      return data.map(r => {
        const p = byId[r.followed_id] || {};
        const tracks = trackCountById[r.followed_id] || 0;
        const fans = fanCountById[r.followed_id] || 0;
        return {
          id: r.followed_id,
          name: p.name || '익명',
          avatar: p.avatar_url || ('https://i.pravatar.cc/150?u=' + r.followed_id),
          role: p.role || 'listener',
          followedAt: r.created_at,
          // 임시: 실제 스트림 미구현 → 트랙수×100을 mock 스트림으로
          streamCount: tracks * 100,
          // 임시: 실제 SPO 미연동 → 팬 수를 mock 참여자 수로
          spoBackers: fans
        };
      });
    },

    // 이 사람이 팔로우하고 있는 사람 수 — 내 페이지든 남의 페이지든 같음
    async followingCount(userId) {
      if (!window.supabase || !userId) return 0;
      const { count, error } = await window.supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', userId);
      if (error) { console.warn('[Follows] followingCount', error.message); return 0; }
      return count || 0;
    },

    // 이 아티스트(=userId)를 팔로우 중인 사람들 — 모달 리스트용
    async listFollowers(artistId, opts) {
      if (!window.supabase || !artistId) return [];
      const limit = (opts && opts.limit) || 100;
      const { data, error } = await window.supabase
        .from('follows')
        .select('follower_id, created_at')
        .eq('followed_id', artistId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) { console.warn('[Follows] listFollowers', error.message); return []; }
      const ids = (data || []).map(r => r.follower_id);
      if (!ids.length) return [];
      const { data: profs } = await window.supabase
        .from('profiles').select('id, name, avatar_url').in('id', ids);
      const byId = {};
      (profs || []).forEach(p => { byId[p.id] = p; });
      return data.map(r => ({
        id: r.follower_id,
        name: (byId[r.follower_id] && byId[r.follower_id].name) || '익명',
        avatar: (byId[r.follower_id] && byId[r.follower_id].avatar_url) || ('https://i.pravatar.cc/150?u=' + r.follower_id),
        followedAt: r.created_at
      }));
    },

    // 이 사람이 팔로우 중인 사람들 — 모달 리스트용 (남의 페이지에서도 봄)
    async listFollowings(userId, opts) {
      if (!window.supabase || !userId) return [];
      const limit = (opts && opts.limit) || 100;
      const { data, error } = await window.supabase
        .from('follows')
        .select('followed_id, created_at')
        .eq('follower_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) { console.warn('[Follows] listFollowings', error.message); return []; }
      const ids = (data || []).map(r => r.followed_id);
      if (!ids.length) return [];
      const { data: profs } = await window.supabase
        .from('profiles').select('id, name, avatar_url').in('id', ids);
      const byId = {};
      (profs || []).forEach(p => { byId[p.id] = p; });
      return data.map(r => ({
        id: r.followed_id,
        name: (byId[r.followed_id] && byId[r.followed_id].name) || '익명',
        avatar: (byId[r.followed_id] && byId[r.followed_id].avatar_url) || ('https://i.pravatar.cc/150?u=' + r.followed_id),
        followedAt: r.created_at
      }));
    },

    async toggle(artistId) {
      if (!window.supabase || !artistId) return { following: false };
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      if (user.id === artistId) throw new Error('자기 자신은 팔로우 할 수 없어요');
      const following = window.__followed.has(artistId);
      if (following) {
        const { error } = await window.supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('followed_id', artistId);
        if (error) throw error;
        window.__followed.delete(artistId);
        const c = window.__fanCounts.get(artistId) || 1;
        window.__fanCounts.set(artistId, Math.max(0, c - 1));
        return { following: false };
      } else {
        const { error } = await window.supabase
          .from('follows')
          .insert({ follower_id: user.id, followed_id: artistId });
        if (error) throw error;
        window.__followed.add(artistId);
        const c = window.__fanCounts.get(artistId) || 0;
        window.__fanCounts.set(artistId, c + 1);
        return { following: true };
      }
    }
  };

  // =====================================================================
  // Playlists
  // =====================================================================

  function mapPlaylistRow(row, trackIds) {
    return {
      id: row.id,
      title: row.title || '무제',
      cover: row.cover_url || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500',
      ownerId: row.owner_id,
      trackIds: Array.isArray(trackIds) ? trackIds : [],
      createdAt: row.created_at,
      __supabase: true
    };
  }

  window.__playlists = null;

  window.Playlists = {
    async fetchMine() {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      const { data: playlists, error: e1 } = await window.supabase
        .from('playlists')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      if (e1) { console.warn('[Playlists] fetchMine', e1.message); return []; }
      if (!playlists || playlists.length === 0) return [];
      const ids = playlists.map(p => p.id);
      const { data: pts, error: e2 } = await window.supabase
        .from('playlist_tracks')
        .select('playlist_id, track_id')
        .in('playlist_id', ids);
      if (e2) console.warn('[Playlists] fetchMine tracks', e2.message);
      const byPl = {};
      (pts || []).forEach(r => {
        if (!byPl[r.playlist_id]) byPl[r.playlist_id] = [];
        byPl[r.playlist_id].push(r.track_id);
      });
      // 폴더 포스트잇(playlist_notes) — 기기 간 동기화 (예전엔 localStorage 라 안 됐음).
      // 캐시 window.__folderNotes[playlistId] = Set(noteId) 로 app.js _getFolderNoteIds 가 읽음.
      const { data: pns, error: e3 } = await window.supabase
        .from('playlist_notes')
        .select('playlist_id, note_id')
        .in('playlist_id', ids);
      if (e3 && !/relation .* does not exist/.test(e3.message || '')) {
        console.warn('[Playlists] fetchMine notes', e3.message);
      }
      const notesByPl = {};
      (pns || []).forEach(r => { (notesByPl[r.playlist_id] = notesByPl[r.playlist_id] || []).push(r.note_id); });
      window.__folderNotes = {};
      playlists.forEach(p => { window.__folderNotes[p.id] = new Set(notesByPl[p.id] || []); });
      // 옛 localStorage 전용 폴더 노트 → 서버로 1회 올림(기기 마이그레이션, best-effort)
      this._reconcileFolderNotes(ids).catch(() => {});
      return playlists.map(p => mapPlaylistRow(p, byPl[p.id] || []));
    },

    async create(title) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const { data, error } = await window.supabase
        .from('playlists')
        .insert({ owner_id: user.id, title: title || '새 플레이리스트' })
        .select()
        .single();
      if (error) throw error;
      const mapped = mapPlaylistRow(data, []);
      if (Array.isArray(window.__playlists)) window.__playlists.unshift(mapped);
      return mapped;
    },

    async addTrack(playlistId, trackId) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      // Only adds Supabase-stored tracks (mock tracks have non-UUID ids)
      if (typeof trackId !== 'string' || !/^[0-9a-f-]{36}$/i.test(trackId)) {
        throw new Error('이 곡은 Supabase에 아직 올라오지 않아서 플레이리스트에 추가할 수 없어요');
      }
      const { error } = await window.supabase
        .from('playlist_tracks')
        .insert({ playlist_id: playlistId, track_id: trackId });
      if (error && !error.message.includes('duplicate')) throw error;
      if (Array.isArray(window.__playlists)) {
        const pl = window.__playlists.find(p => p.id === playlistId);
        if (pl && !pl.trackIds.includes(trackId)) pl.trackIds.push(trackId);
      }
    },

    async removeTrack(playlistId, trackId) {
      if (!window.supabase) return;
      const { error } = await window.supabase
        .from('playlist_tracks')
        .delete()
        .eq('playlist_id', playlistId)
        .eq('track_id', trackId);
      if (error) throw error;
      if (Array.isArray(window.__playlists)) {
        const pl = window.__playlists.find(p => p.id === playlistId);
        if (pl) pl.trackIds = pl.trackIds.filter(id => id !== trackId);
      }
    },

    // 폴더에 포스트잇 담기/빼기 — 서버 playlist_notes (기기 간 동기화). 캐시 __folderNotes 갱신.
    async addNote(playlistId, noteId) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      if (typeof noteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(noteId)) return; // 서버 노트(UUID)만
      const { error } = await window.supabase
        .from('playlist_notes')
        .insert({ playlist_id: playlistId, note_id: noteId });
      if (error && !/duplicate/i.test(error.message || '')) throw error;
      if (!window.__folderNotes) window.__folderNotes = {};
      (window.__folderNotes[playlistId] = window.__folderNotes[playlistId] || new Set()).add(noteId);
    },

    async removeNote(playlistId, noteId) {
      if (!window.supabase) return;
      const { error } = await window.supabase
        .from('playlist_notes')
        .delete()
        .eq('playlist_id', playlistId)
        .eq('note_id', noteId);
      if (error) throw error;
      if (window.__folderNotes && window.__folderNotes[playlistId]) {
        window.__folderNotes[playlistId].delete(noteId);
      }
    },

    // 옛 localStorage('folder_notes:<id>') 전용 폴더 노트를 서버로 한 번 올린다(기기 마이그레이션).
    // 세션당 1회. best-effort — 일부 실패(이미 삭제된 노트 FK 등)는 무시.
    async _reconcileFolderNotes(ids) {
      if (window.__folderNotesReconciled || !window.supabase) return;
      window.__folderNotesReconciled = true;
      try {
        const rows = [];
        (ids || []).forEach(pid => {
          let local = new Set();
          try { const raw = localStorage.getItem('folder_notes:' + pid); local = new Set(raw ? JSON.parse(raw) : []); } catch (_) {}
          const server = (window.__folderNotes && window.__folderNotes[pid]) || new Set();
          local.forEach(nid => {
            if (typeof nid === 'string' && /^[0-9a-f-]{36}$/i.test(nid) && !server.has(nid)) {
              rows.push({ playlist_id: pid, note_id: nid });
              server.add(nid);
            }
          });
          if (window.__folderNotes) window.__folderNotes[pid] = server;
        });
        if (rows.length) {
          await window.supabase.from('playlist_notes')
            .upsert(rows, { onConflict: 'playlist_id,note_id', ignoreDuplicates: true });
        }
      } catch (e) { console.warn('[Playlists] reconcileFolderNotes', e && e.message); }
    },

    async deletePlaylist(playlistId) {
      if (!window.supabase) return;
      const { error } = await window.supabase.from('playlists').delete().eq('id', playlistId);
      if (error) throw error;
      if (Array.isArray(window.__playlists)) {
        window.__playlists = window.__playlists.filter(p => p.id !== playlistId);
      }
    },

    async refreshInto(db) {
      const playlists = await this.fetchMine();
      window.__playlists = playlists;
      // 호출자 스냅샷엔 메모리 반영만 — 저장은 fresh 스냅샷에 내 필드만 (TOCTOU 방지)
      if (db && typeof db === 'object') db.playlists = playlists;
      try {
        const fresh = window.DB.get();
        fresh.playlists = playlists;
        window.DB.save(fresh);
      } catch (_) {}
      return playlists;
    }
  };

  // =====================================================================
  // Admin — list + delete any content (for role=admin only)
  // =====================================================================

  // =====================================================================
  // Backers — 함께하기 (Phase 1: free emotional support, Phase 2 ready for $)
  // =====================================================================

  window.__myBackings = new Set();    // track_ids I'm backing
  window.__backerCounts = new Map();  // track_id -> count

  window.Backers = {
    async refreshMine() {
      if (!window.supabase) return;
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) { window.__myBackings = new Set(); return; }
      const { data, error } = await window.supabase
        .from('track_backers')
        .select('track_id')
        .eq('backer_id', user.id);
      if (error) {
        // Table likely missing — silently ignore so app still works
        if (!/relation .* does not exist/.test(error.message || '')) {
          console.warn('[Backers] refreshMine', error.message);
        }
        return;
      }
      window.__myBackings = new Set((data || []).map(r => r.track_id));
    },

    isBacking(trackId) {
      return !!(window.__myBackings && window.__myBackings.has(trackId));
    },

    async fetchCount(trackId) {
      if (!window.supabase || !trackId) return 0;
      if (window.__backerCounts && window.__backerCounts.has(trackId)) {
        return window.__backerCounts.get(trackId);
      }
      const { count, error } = await window.supabase
        .from('track_backers')
        .select('*', { count: 'exact', head: true })
        .eq('track_id', trackId);
      if (error) return 0;
      const c = count || 0;
      window.__backerCounts.set(trackId, c);
      return c;
    },

    async fetchCountsBulk(trackIds) {
      if (!window.supabase || !trackIds || !trackIds.length) return new Map();
      const { data, error } = await window.supabase
        .from('track_backers')
        .select('track_id')
        .in('track_id', trackIds);
      const counts = new Map();
      trackIds.forEach(id => counts.set(id, 0));
      if (error) return counts;
      (data || []).forEach(r => {
        counts.set(r.track_id, (counts.get(r.track_id) || 0) + 1);
      });
      // Update cache
      counts.forEach((v, k) => window.__backerCounts.set(k, v));
      return counts;
    },

    async fetchBackers(trackId) {
      if (!window.supabase) return [];
      const { data, error } = await window.supabase
        .from('track_backers')
        .select('backer_id, backed_at, profiles(name, avatar_url)')
        .eq('track_id', trackId)
        .order('backed_at', { ascending: false });
      if (error) return [];
      return (data || []).map(r => ({
        userId: r.backer_id,
        name: r.profiles?.name || '익명',
        avatar: r.profiles?.avatar_url || ('https://i.pravatar.cc/150?u=' + r.backer_id),
        backedAt: r.backed_at
      }));
    },

    async toggle(trackId) {
      if (!window.supabase) throw new Error('Supabase not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const isCurrentlyBacking = window.__myBackings && window.__myBackings.has(trackId);
      if (isCurrentlyBacking) {
        const { error } = await window.supabase
          .from('track_backers')
          .delete()
          .eq('track_id', trackId)
          .eq('backer_id', user.id);
        if (error) throw error;
        window.__myBackings.delete(trackId);
        if (window.__backerCounts.has(trackId)) {
          window.__backerCounts.set(trackId, Math.max(0, window.__backerCounts.get(trackId) - 1));
        }
        return { backing: false };
      } else {
        const { error } = await window.supabase
          .from('track_backers')
          .insert({ track_id: trackId, backer_id: user.id });
        if (error) {
          if (/relation .* does not exist/.test(error.message || '')) {
            throw new Error('함께하기 테이블이 아직 만들어지지 않았어요. supabase/backers.sql을 실행해주세요.');
          }
          throw error;
        }
        if (!window.__myBackings) window.__myBackings = new Set();
        window.__myBackings.add(trackId);
        window.__backerCounts.set(trackId, (window.__backerCounts.get(trackId) || 0) + 1);
        return { backing: true };
      }
    }
  };

  // ── Cheers — 응원 (one-time supportive message per track) ──────────────
  window.Cheers = {
    // True if the current user already cheered this track.
    async hasCheered(trackId) {
      if (!window.supabase || !trackId) return false;
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return false;
      const { data } = await window.supabase
        .from('cheers')
        .select('id')
        .eq('supporter_id', user.id)
        .eq('track_id', trackId)
        .maybeSingle();
      return !!data;
    },

    // Send a cheer. Looks up the track's artist server-side.
    // Throws Error('ALREADY_CHEERED') if the unique index rejects it.
    async send(trackId, message) {
      if (!window.supabase) throw new Error('Supabase 준비 안 됨');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');

      const { data: track, error: te } = await window.supabase
        .from('tracks')
        .select('id, title, artist_id')
        .eq('id', trackId)
        .single();
      if (te || !track) throw new Error('트랙을 찾을 수 없어요');

      const profile = window.__currentUser;
      const supporterName = (profile && profile.name)
        || (user.email ? user.email.split('@')[0] : '익명');

      let artistName = '';
      try {
        const { data: ap } = await window.supabase
          .from('profiles').select('name').eq('id', track.artist_id).maybeSingle();
        artistName = ap ? ap.name : '';
      } catch (_) {}

      const payload = {
        artist_id:      track.artist_id,
        artist_name:    artistName,
        track_id:       trackId,
        track_title:    track.title,
        supporter_id:   user.id,
        supporter_name: supporterName,
        message:        (message || '').slice(0, 300)
      };
      const { data, error } = await window.supabase
        .from('cheers').insert(payload).select().single();
      if (error) {
        if (/duplicate|unique|cheers_once/i.test(error.message || '')) {
          throw new Error('ALREADY_CHEERED');
        }
        throw error;
      }
      return data;
    },

    // Cheers received by an artist (for the 응원 루프 — count + supporters).
    async fetchForArtist(artistId, limit) {
      if (!window.supabase || !artistId) return [];
      const { data, error } = await window.supabase
        .from('cheers')
        .select('id, supporter_id, supporter_name, message, created_at, track_title')
        .eq('artist_id', artistId)
        .order('created_at', { ascending: false })
        .limit(limit || 60);
      if (error) { console.warn('[Cheers] fetchForArtist', error.message); return []; }
      return data || [];
    },

    // Resolve an artist name → id, then fetch their cheers.
    async fetchForArtistByName(name, limit) {
      if (!window.supabase || !name) return [];
      const { data: prof } = await window.supabase
        .from('profiles').select('id').eq('name', name).limit(1).maybeSingle();
      if (!prof) return [];
      return this.fetchForArtist(prof.id, limit);
    },

    // Cheers for one track — count + supporters (곡 상세 '키우는 중' 수).
    async fetchForTrack(trackId, limit) {
      if (!window.supabase || !trackId) return [];
      const { data, error } = await window.supabase
        .from('cheers')
        .select('id, supporter_id, supporter_name, message, created_at')
        .eq('track_id', trackId)
        .order('created_at', { ascending: false })
        .limit(limit || 60);
      if (error) { console.warn('[Cheers] fetchForTrack', error.message); return []; }
      return data || [];
    },

    // Cheers the current user has sent (내가 키우는 곡 — 응원한 곡들).
    async fetchMySent(limit) {
      if (!window.supabase) return [];
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await window.supabase
        .from('cheers')
        .select('id, track_id, track_title, artist_name, created_at')
        .eq('supporter_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit || 30);
      if (error) { console.warn('[Cheers] fetchMySent', error.message); return []; }
      return data || [];
    },

    async remove(cheerId) {
      if (!window.supabase || !cheerId) return;
      const { error } = await window.supabase.from('cheers').delete().eq('id', cheerId);
      if (error) throw error;
    }
  };

  // ── Producing — 데모 진화 라운드 투표 (A/B 블라인드 + 댓글 추천, 한 사람 한 표) ──
  // 테이블(producing_rounds/_comments/_votes)이 없으면 fetch가 빈 결과를 돌려 기능이
  // 자동으로 숨겨짐(graceful). sql/producing.sql 실행 후 활성화됨.
  window.Producing = {
    // 한 프로젝트(곡)의 라운드들 — 각 데모 노드가 track_id 로 자기 라운드를 찾음
    async fetchForProject(projectId) {
      // null = 기능 비활성(테이블 없음/연결 X) → UI 완전 숨김. []  = 라운드 없음(본인은 만들기 CTA).
      if (!window.supabase || !projectId) return null;
      const { data, error } = await window.supabase
        .from('producing_rounds').select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) { console.warn('[Producing] fetchForProject', error.message); return null; }
      return data || [];
    },

    // 게시판 피드 — 진행중/마감 라운드 전부(최신순). status 생략 시 전체.
    async fetchBoard(status) {
      if (!window.supabase) return null;
      let q = window.supabase.from('producing_rounds').select('*').order('created_at', { ascending: false }).limit(80);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) { console.warn('[Producing] fetchBoard', error.message); return null; }
      return data || [];
    },

    // 한 라운드의 댓글 + 투표 집계(+내 선택). 테이블 없으면 빈 결과.
    async fetchDetail(roundId) {
      const empty = { comments: [], tally: {}, total: 0, myChoice: null, votes: [] };
      if (!window.supabase || !roundId) return empty;
      let myId = null;
      try { const { data: { user } } = await window.supabase.auth.getUser(); myId = user ? user.id : null; } catch (_) {}
      const [cRes, vRes] = await Promise.all([
        window.supabase.from('producing_comments').select('id,user_id,user_name,body,created_at').eq('round_id', roundId).order('created_at', { ascending: true }),
        window.supabase.from('producing_votes').select('user_id,user_name,choice').eq('round_id', roundId)
      ]);
      if (cRes.error) { console.warn('[Producing] fetchDetail', cRes.error.message); return empty; }
      const votes = vRes.data || [];
      const tally = {}; let total = 0; let myChoice = null;
      votes.forEach(function (v) { tally[v.choice] = (tally[v.choice] || 0) + 1; total++; if (myId && v.user_id === myId) myChoice = v.choice; });
      return { comments: cRes.data || [], tally: tally, total: total, myChoice: myChoice, votes: votes };
    },

    // 라운드 만들기 (아티스트). candidates = [{key:'a',name},{key:'b',name},...]
    async create(opts) {
      if (!window.supabase) throw new Error('연결이 필요해요');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      if (typeof window.ensureProfileRow === 'function') { try { await window.ensureProfileRow(); } catch (_) {} }
      const payload = {
        project_id: opts.projectId,
        track_id: opts.trackId || null,
        artist_id: user.id,
        artist_name: (window.__currentUser && window.__currentUser.name) || null,
        question: (opts.question || '').slice(0, 200),
        candidates: opts.candidates || [],
        status: 'open',
        closes_at: opts.closesAt || null
      };
      const { data, error } = await window.supabase.from('producing_rounds').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async addComment(roundId, body) {
      if (!window.supabase) throw new Error('연결이 필요해요');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      if (typeof window.ensureProfileRow === 'function') { try { await window.ensureProfileRow(); } catch (_) {} }
      const payload = { round_id: roundId, user_id: user.id, user_name: (window.__currentUser && window.__currentUser.name) || null, body: (body || '').slice(0, 300) };
      const { data, error } = await window.supabase.from('producing_comments').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    // 한 표(토큰): A/B/댓글 한 곳. 이미 던졌으면 그 표를 옮김(upsert).
    async vote(roundId, choice) {
      if (!window.supabase) throw new Error('연결이 필요해요');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const payload = { round_id: roundId, user_id: user.id, user_name: (window.__currentUser && window.__currentUser.name) || null, choice: String(choice) };
      const { data, error } = await window.supabase.from('producing_votes').upsert(payload, { onConflict: 'round_id,user_id' }).select().single();
      if (error) throw error;
      return data;
    },

    // 마감/공개 (아티스트)
    async close(roundId) {
      if (!window.supabase) throw new Error('연결이 필요해요');
      const { data, error } = await window.supabase.from('producing_rounds').update({ status: 'closed' }).eq('id', roundId).select().single();
      if (error) throw error;
      return data;
    }
  };

  // ── DM — 1:1 메시지 (Supabase-backed) ────────────────────────────────
  window.DM = {
    // Resolve an artist name to their profile id (needed when opening DM by
    // name from a profile page). Falls back to null if not found.
    async resolveUserIdByName(name) {
      if (!window.supabase || !name) return null;
      const { data } = await window.supabase
        .from('profiles').select('id').eq('name', name).limit(1).maybeSingle();
      return data ? data.id : null;
    },

    async getOrCreateConversation(otherUserId) {
      if (!window.supabase || !otherUserId) return null;
      const { data, error } = await window.supabase
        .rpc('dm_get_or_create_conv', { p_other_id: otherUserId });
      if (error) { console.warn('[DM] getOrCreate', error.message); return null; }
      return data;
    },

    async fetchMessages(conversationId, limit) {
      if (!window.supabase || !conversationId) return [];
      const { data, error } = await window.supabase
        .from('dm_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(limit || 200);
      if (error) { console.warn('[DM] fetchMessages', error.message); return []; }
      return data || [];
    },

    async send(conversationId, text) {
      if (!window.supabase || !conversationId || !text) return null;
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const { data, error } = await window.supabase
        .from('dm_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          text: text.slice(0, 2000)
        })
        .select().single();
      if (error) throw error;
      // Bump conversation last_message_at (best effort — RLS allows participants)
      try {
        await window.supabase
          .from('dm_conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversationId);
      } catch (_) {}
      return data;
    },

    async fetchMyConversations() {
      if (!window.supabase) return [];
      const { data, error } = await window.supabase.rpc('my_dm_conversations');
      if (error) { console.warn('[DM] fetchMyConversations', error.message); return []; }
      return data || [];
    },

    async markRead(conversationId) {
      if (!window.supabase || !conversationId) return;
      try { await window.supabase.rpc('dm_mark_read', { p_conversation_id: conversationId }); }
      catch (e) { console.warn('[DM] markRead', e.message); }
    },

    // Quick unread aggregate — used for badges later.
    async unreadTotal() {
      const convs = await this.fetchMyConversations();
      return convs.reduce((s, c) => s + (c.unread_count || 0), 0);
    }
  };

  window.Admin = {
    async listRecentNotes(limit) {
      if (!window.supabase) return [];
      const { data, error } = await window.supabase
        .from('wall_notes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 50);
      if (error) { console.warn('[Admin] notes', error.message); return []; }
      return (data || []).map(r => mapNoteRow(r, []));
    },
    async listRecentTracks(limit) {
      if (!window.supabase) return [];
      const { data, error } = await window.supabase
        .from('tracks')
        .select('*, profiles(id, name)')
        .order('created_at', { ascending: false })
        .limit(limit || 50);
      if (error) { console.warn('[Admin] tracks', error.message); return []; }
      return (data || []).map(r => mapTrackRow(r, r.profiles));
    },
    async deleteNote(id) {
      const { error } = await window.supabase.from('wall_notes').delete().eq('id', id);
      if (error) throw error;
    },
    async deleteTrack(id) {
      const { error } = await window.supabase.from('tracks').delete().eq('id', id);
      if (error) throw error;
    },

    // ── User management ──────────────────────────────────────
    // List all users with track/note counts + auth metadata (email/lastSignIn/provider).
    // Admin-only (RLS + RPC body re-checks). Returns full profile + counts + auth meta.
    async listUsers(limit) {
      if (!window.supabase) return [];
      const { data: profiles, error } = await window.supabase
        .from('profiles')
        .select('id, name, avatar_url, role, created_at, bio, sns_instagram, sns_youtube, sns_tiktok, sns_twitter')
        .order('created_at', { ascending: false })
        .limit(limit || 200);
      if (error) { console.warn('[Admin] listUsers', error.message); return []; }
      if (!profiles || !profiles.length) return [];

      const ids = profiles.map(p => p.id);

      // Bulk-fetch track + note counts (one query each)
      const trackCount = {};
      const noteCount = {};
      try {
        const { data: tRows } = await window.supabase
          .from('tracks').select('artist_id').in('artist_id', ids);
        (tRows || []).forEach(r => { trackCount[r.artist_id] = (trackCount[r.artist_id] || 0) + 1; });
      } catch (e) { console.warn('[Admin] trackCount', e); }
      try {
        const { data: nRows } = await window.supabase
          .from('wall_notes').select('author_id').in('author_id', ids);
        (nRows || []).forEach(r => { noteCount[r.author_id] = (noteCount[r.author_id] || 0) + 1; });
      } catch (e) { console.warn('[Admin] noteCount', e); }

      // Auth metadata via RPC (admin-only on the server side). If the RPC isn't
      // installed yet or caller isn't admin, just skip silently — rest still works.
      const authMeta = {};
      try {
        const { data: rpcRows, error: rpcErr } = await window.supabase.rpc('admin_list_auth_meta');
        if (rpcErr) {
          if (!/admin only|does not exist/i.test(rpcErr.message || '')) {
            console.warn('[Admin] auth meta rpc', rpcErr.message);
          }
        } else {
          (rpcRows || []).forEach(r => {
            authMeta[r.id] = {
              email: r.email || '',
              lastSignInAt: r.last_sign_in_at || null,
              provider: r.provider || ''
            };
          });
        }
      } catch (e) { console.warn('[Admin] auth meta rpc threw', e); }

      return profiles.map(p => {
        const am = authMeta[p.id] || {};
        return {
          id: p.id,
          name: p.name || '익명',
          avatar: p.avatar_url || ('https://i.pravatar.cc/150?u=' + p.id),
          role: p.role || 'listener',
          createdAt: p.created_at,
          trackCount: trackCount[p.id] || 0,
          noteCount: noteCount[p.id] || 0,
          // Profile-level extras
          bio: p.bio || '',
          sns: {
            instagram: p.sns_instagram || '',
            youtube:   p.sns_youtube   || '',
            tiktok:    p.sns_tiktok    || '',
            twitter:   p.sns_twitter   || ''
          },
          // Auth-level extras (may be blank if RPC unavailable)
          email: am.email || '',
          lastSignInAt: am.lastSignInAt || null,
          provider: am.provider || ''
        };
      });
    },

    // Change a user's role. Admin-only. Will fail via RLS if caller isn't admin.
    async setUserRole(userId, role) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      if (!['listener', 'artist', 'admin'].includes(role)) {
        throw new Error('Invalid role: ' + role);
      }
      const { error } = await window.supabase
        .from('profiles')
        .update({ role })
        .eq('id', userId);
      if (error) throw error;
    }
  };
})();
