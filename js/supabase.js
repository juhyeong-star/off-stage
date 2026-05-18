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
    if (!profile && authUser) {
      const meta = authUser.user_metadata || {};
      return {
        id: authUser.id,
        name: meta.name || meta.full_name || meta.nickname
              || (authUser.email ? authUser.email.split('@')[0] : '익명'),
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
    return {
      id: profile.id,
      name: profile.name || (authUser && authUser.email ? authUser.email.split('@')[0] : '익명'),
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
      .select('id, name, avatar_url, hero_url')
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

  async function syncCurrentUser() {
    if (!window.supabase) { window.__currentUser = null; return null; }
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session || !session.user) { window.__currentUser = null; return null; }
    const profile = await fetchProfile(session.user.id);
    const mapped = mapProfile(profile, session.user);
    window.__currentUser = mapped;
    // Mirror into legacy localStorage so existing code paths still work
    try {
      const db = window.DB.get();
      db.currentUser = mapped;
      window.DB.save(db);
    } catch (_) {}
    return mapped;
  }

  // 외부에 노출
  window.fetchProfileByName = fetchProfileByName;

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
      text: row.text || '',
      color: row.color || 'yellow',
      rotation: (typeof row.rotation === 'number') ? row.rotation : 0,
      createdAt: row.created_at,
      comments: Array.isArray(comments) ? comments.map(mapCommentRow) : []
    };
  }
  function mapCommentRow(row) {
    return {
      id: row.id,
      author: row.author_name || '익명',
      authorId: row.author_id || null,
      text: row.text || '',
      createdAt: row.created_at
    };
  }

  window.__wallNotes = null; // in-memory cache

  window.Walls = {
    async fetchAll(limit) {
      if (!window.supabase) return [];
      const { data: notes, error: e1 } = await window.supabase
        .from('wall_notes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 200);
      if (e1) { console.warn('[Walls] fetchAll', e1.message); return []; }
      if (!notes || notes.length === 0) return [];

      // Fetch all comments for these notes in one query
      const ids = notes.map(n => n.id);
      const { data: comments, error: e2 } = await window.supabase
        .from('wall_note_comments')
        .select('*')
        .in('note_id', ids)
        .order('created_at', { ascending: true });
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
      const { data, error } = await window.supabase
        .from('wall_note_comments')
        .select('*')
        .eq('note_id', noteId)
        .order('created_at', { ascending: true });
      if (error) { console.warn('[Walls] fetchComments', error.message); return []; }
      return (data || []).map(mapCommentRow);
    },

    async insert({ text, color, rotation }) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      const profile = window.__currentUser;
      const author_name = (profile && profile.name) || (user.email ? user.email.split('@')[0] : '익명');
      const payload = {
        author_id: user.id,
        author_name,
        text: (text || '').slice(0, 500),
        color: color || 'yellow',
        rotation: (typeof rotation === 'number') ? rotation : 0
      };
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

    async addComment(noteId, { text, authorName }) {
      if (!window.supabase) throw new Error('Supabase SDK not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      const profile = window.__currentUser;
      const name = (authorName && authorName.trim())
        || (profile && profile.name)
        || (user && user.email ? user.email.split('@')[0] : '익명');
      const payload = {
        note_id: noteId,
        author_id: user ? user.id : null,
        author_name: name,
        text: (text || '').slice(0, 500)
      };
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

    // Refresh the cache + mirror into legacy db.notes so sync code paths keep working
    async refreshInto(db) {
      const notes = await this.fetchAll();
      window.__wallNotes = notes;
      if (db && typeof db === 'object') {
        db.notes = notes;
        try { window.DB.save(db); } catch (_) {}
      }
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

    async toggleFavorite(noteId) {
      if (!window.supabase) throw new Error('Supabase not ready');
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요해요');
      if (!window.__favoritedNotes) window.__favoritedNotes = new Set();
      const isOn = window.__favoritedNotes.has(noteId);
      if (isOn) {
        const { error } = await window.supabase
          .from('note_favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('note_id', noteId);
        if (error) throw error;
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
      version: row.version || 'final',
      versionLabel: row.version_label || 'Final',
      isDemo: !!row.is_demo,
      artistNote: row.artist_note || '',
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
      const { data, error } = await window.supabase
        .from('tracks')
        .insert(payload)
        .select('*, profiles(id, name, avatar_url)')
        .single();
      if (error) throw error;
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
      const profile = window.__currentUser;
      const name = (authorName && authorName.trim())
        || (profile && profile.name)
        || (user && user.email ? user.email.split('@')[0] : '익명');
      const payload = {
        track_id: trackId,
        author_id: user ? user.id : null,
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

    // Merge Supabase tracks with existing db.tracks (Supabase at top).
    // Keeps localStorage mock so the site never looks empty; Supabase uploads appear first.
    async refreshInto(db) {
      const supabaseTracks = await this.fetchAll();
      // Eagerly fetch comments per track? Too expensive. Defer to when modal opens.
      window.__tracks = supabaseTracks;
      if (db && typeof db === 'object') {
        const mockTracks = (db.tracks || []).filter(t => !t.__supabase);
        db.tracks = [...supabaseTracks, ...mockTracks];
        try { window.DB.save(db); } catch (_) {}
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
      if (db && typeof db === 'object') {
        // Replace legacy mock playlists with Supabase ones
        db.playlists = playlists;
        try { window.DB.save(db); } catch (_) {}
      }
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
    // List all users with track/note counts. Admin-only (RLS enforces).
    async listUsers(limit) {
      if (!window.supabase) return [];
      const { data: profiles, error } = await window.supabase
        .from('profiles')
        .select('id, name, avatar_url, role, created_at')
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

      return profiles.map(p => ({
        id: p.id,
        name: p.name || '익명',
        avatar: p.avatar_url || ('https://i.pravatar.cc/150?u=' + p.id),
        role: p.role || 'listener',
        createdAt: p.created_at,
        trackCount: trackCount[p.id] || 0,
        noteCount: noteCount[p.id] || 0
      }));
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
