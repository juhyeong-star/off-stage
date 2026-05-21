// ============================================================
// analytics.js — Off-Stage usage tracking
//
// What we log:
//   - play_events: start | progress (every 15s) | end. Plus, when the
//     play was triggered from a shape, source='shape' so it doubles as
//     a "shape click" counter.
//   - note_views: 1 row per (note, session) — counted when a post-it's
//     detail modal opens.
//
// Anonymous-friendly: every device has a session_id in localStorage,
// so visitors without an account still count.
//
// Helpers:
//   Analytics.trackPlayStart(trackId, source, durationSec)
//   Analytics.trackPlayEnd()   // call before next play, on track change
//   Analytics.noteView(noteId)
//   Analytics.getTrackStats(trackId)
//   Analytics.getNoteViewCount(noteId)
//   Analytics.getMyNotesViews()
//   Analytics.getMyTracksStats()
//   Analytics.getAdminOverall()
//   Analytics.getAdminTopTracks(limit)
// ============================================================
(function () {
  // ─── Session ID ────────────────────────────────────────────
  function getSessionId() {
    try {
      let sid = localStorage.getItem('offstage_session_id');
      if (!sid) {
        sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('offstage_session_id', sid);
      }
      return sid;
    } catch (_) {
      // localStorage blocked → in-memory fallback for this page lifetime
      if (!window.__sessionIdFallback) {
        window.__sessionIdFallback = 'sess_' + Math.random().toString(36).slice(2);
      }
      return window.__sessionIdFallback;
    }
  }

  // ─── Internal: current play session state ─────────────────
  // _current = { trackId, source, durationSec, listenedSec, lastTickAt, tickTimer, heartbeatTimer }
  let _current = null;

  async function _insertEvent(trackId, eventType, extras) {
    if (!window.supabase) return;
    try {
      const { data: { user } } = await window.supabase.auth.getUser();
      const payload = {
        track_id:     trackId || null,
        user_id:      user ? user.id : null,
        session_id:   getSessionId(),
        event_type:   eventType,
        position_sec: extras.positionSec != null ? extras.positionSec : null,
        listened_sec: extras.listenedSec != null ? extras.listenedSec : null,
        duration_sec: extras.durationSec != null ? extras.durationSec : null,
        source:       extras.source || null
      };
      await window.supabase.from('play_events').insert(payload);
    } catch (e) {
      console.warn('[analytics] insert', e && e.message);
    }
  }

  // Tick at 1Hz to accumulate listenedSec while audio actually plays.
  function _onTick() {
    if (!_current) return;
    const audio = document.getElementById('audio-element');
    if (!audio || audio.paused) {
      _current.lastTickAt = null;
      return;
    }
    const now = Date.now();
    if (_current.lastTickAt) {
      // Cap delta at 2s in case the timer drifted (tab backgrounded)
      const dt = Math.min(2, (now - _current.lastTickAt) / 1000);
      _current.listenedSec += dt;
    }
    _current.lastTickAt = now;
  }

  function _stopTimers() {
    if (!_current) return;
    if (_current.tickTimer)      { clearInterval(_current.tickTimer);      _current.tickTimer = null; }
    if (_current.heartbeatTimer) { clearInterval(_current.heartbeatTimer); _current.heartbeatTimer = null; }
  }

  async function trackPlayStart(trackId, source, durationSec) {
    // Close any prior session first so we don't double-count
    await trackPlayEnd();
    _current = {
      trackId,
      source: source || 'other',
      durationSec: durationSec || 0,
      listenedSec: 0,
      lastTickAt: null,
      tickTimer: null,
      heartbeatTimer: null
    };
    await _insertEvent(trackId, 'start', {
      source: source || 'other',
      durationSec: durationSec || 0,
      positionSec: 0,
      listenedSec: 0
    });
    // Accumulate listened time at 1Hz
    _current.tickTimer = setInterval(_onTick, 1000);
    // Heartbeat at 15s — sends an interim 'progress' row
    _current.heartbeatTimer = setInterval(async () => {
      if (!_current) return;
      const audio = document.getElementById('audio-element');
      const pos = audio ? Math.floor(audio.currentTime) : 0;
      await _insertEvent(_current.trackId, 'progress', {
        positionSec: pos,
        listenedSec: Math.floor(_current.listenedSec),
        durationSec: _current.durationSec
      });
    }, 15000);
  }

  async function trackPlayEnd() {
    if (!_current) return;
    const cur = _current;
    _current = null;
    _stopTimers.call({ _current: cur });  // best-effort
    if (cur.tickTimer)      clearInterval(cur.tickTimer);
    if (cur.heartbeatTimer) clearInterval(cur.heartbeatTimer);
    const audio = document.getElementById('audio-element');
    const pos = audio ? Math.floor(audio.currentTime) : 0;
    await _insertEvent(cur.trackId, 'end', {
      positionSec: pos,
      listenedSec: Math.floor(cur.listenedSec),
      durationSec: cur.durationSec
    });
  }

  // ─── Note views ────────────────────────────────────────────
  async function noteView(noteId) {
    if (!window.supabase || !noteId) return;
    try {
      const { data: { user } } = await window.supabase.auth.getUser();
      const payload = {
        note_id:    noteId,
        viewer_id:  user ? user.id : null,
        session_id: getSessionId()
      };
      // Same (note, session) again → ignored by the unique index
      await window.supabase
        .from('note_views')
        .upsert(payload, { onConflict: 'note_id,session_id', ignoreDuplicates: true });
    } catch (e) {
      console.warn('[analytics] noteView', e && e.message);
    }
  }

  // ─── Aggregate fetches (RPCs) ──────────────────────────────
  async function getTrackStats(trackId) {
    if (!window.supabase || !trackId) return null;
    const { data, error } = await window.supabase.rpc('track_stats', { p_track_id: trackId });
    if (error) { console.warn('[analytics] track_stats', error.message); return null; }
    return (data && data[0]) || null;
  }

  async function getNoteViewCount(noteId) {
    if (!window.supabase || !noteId) return 0;
    const { data, error } = await window.supabase.rpc('note_view_count', { p_note_id: noteId });
    if (error) { console.warn('[analytics] note_view_count', error.message); return 0; }
    return data || 0;
  }

  async function getMyNotesViews() {
    if (!window.supabase) return [];
    const { data, error } = await window.supabase.rpc('my_notes_views');
    if (error) { console.warn('[analytics] my_notes_views', error.message); return []; }
    return data || [];
  }

  async function getMyTracksStats() {
    if (!window.supabase) return [];
    const { data, error } = await window.supabase.rpc('my_tracks_stats');
    if (error) { console.warn('[analytics] my_tracks_stats', error.message); return []; }
    return data || [];
  }

  async function getAdminOverall() {
    if (!window.supabase) return null;
    const { data, error } = await window.supabase.rpc('admin_overall_stats');
    if (error) { console.warn('[analytics] admin_overall', error.message); return null; }
    return (data && data[0]) || null;
  }

  async function getAdminTopTracks(limit) {
    if (!window.supabase) return [];
    const { data, error } = await window.supabase.rpc('admin_top_tracks', { p_limit: limit || 20 });
    if (error) { console.warn('[analytics] admin_top_tracks', error.message); return []; }
    return data || [];
  }

  // ─── Last-ditch end on page unload ─────────────────────────
  window.addEventListener('beforeunload', () => {
    if (!_current) return;
    try {
      const cur = _current;
      const audio = document.getElementById('audio-element');
      const pos = audio ? Math.floor(audio.currentTime) : 0;
      // Fire and forget — async, no await on unload
      _insertEvent(cur.trackId, 'end', {
        positionSec: pos,
        listenedSec: Math.floor(cur.listenedSec),
        durationSec: cur.durationSec
      });
    } catch (_) {}
  });

  // ─── Format helpers exposed for convenience ────────────────
  function fmtSeconds(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function fmtPct(p) {
    return Math.round((p || 0) * 100) + '%';
  }

  window.Analytics = {
    sessionId: getSessionId,
    trackPlayStart,
    trackPlayEnd,
    noteView,
    getTrackStats,
    getNoteViewCount,
    getMyNotesViews,
    getMyTracksStats,
    getAdminOverall,
    getAdminTopTracks,
    fmtSeconds,
    fmtPct
  };
})();
