// ============================================================
// data.js — MOCK / SEED data
// 가짜 데이터 전부 정리. 예시용 1개 프로젝트(Peek: 마스터 + 데모1) +
// 예시 포스트잇 1개만 시드. 나머지는 빈 배열로 출발 — 실 사용 데이터는
// Supabase 모듈(Walls / Tracks / Cheers 등)이 채워줌.
// ============================================================
const MOCK_DATA = {
  currentUser: null,

  tracks: [
    // ──────────────────────────────────────────────────────────
    // 예시 #1 — Peek: 마스터
    // ──────────────────────────────────────────────────────────
    {
      id: 'tp1',
      title: 'kiss kiss kiss type',
      artist: 'Peek',
      artistAvatar: '/img/artists/peek.png',
      cover: '/img/artists/peek.png',
      audioUrl: '/audio/peek-kiss-kiss-kiss-type.mp3',
      likes: 0,
      plays: 0,
      createdAt: '2026-04-28T19:00:00Z',
      projectId: 'proj_peek_kkkt',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['bedroom pop', '예시'],
      shape: 'circle',
      shapeColor: '#A8E063',
      lines: ['#예시 마스터 곡', '#Peek kiss kiss kiss type 🐑'],
      artistNote: '예시 — 첫 마스터 곡',
      trackComments: []
    }
    // 예시 데모(tp1d1)는 제거 — 빈 플랫폼에 가짜 데모까지 떠다니는 게 어색해서.
    // 마스터 1개 예시만 노출. 사용자가 곡 업로드하면 자동으로 더 채워짐.
  ],

  reservations: [],
  events: [],
  playlists: [],
  albums: [],
  stations: [],

  notes: [
    {
      id: 'n_ex1',
      author: 'Peek',
      text: '예시 포스트잇이에요 ✨\n자유롭게 글 남겨주세요',
      color: 'yellow',
      rotation: -1,
      createdAt: '2026-04-28T19:30:00Z',
      comments: []
    }
  ],

  following: [
    {
      id: 'u_peek',
      name: 'Peek',
      avatar: '/img/artists/peek.png',
      followers: 0,
      role: 'artist',
      sns: { instagram: '', youtube: '', tiktok: '', twitter: '' }
    }
  ],

  onboardingArtists: [
    {
      id: 'mock_peek',
      name: 'Peek',
      avatar: '/img/artists/peek.png',
      tagline: '예시 아티스트 🐑',
      streamCount: 0,
      spoBackers: 0
    }
  ],

  fanLetters: []
};

// ============================================================
// LocalStorage Persistence Layer
// DATA_VERSION 을 올리면 다음 로드 때 stale 캐시가 자동 정리됨.
// 예전 버전엔 "라일락" 강제 시드 / 데모 트레일 / 응원 시드 등이
// 남아있을 수 있어서 같이 비워줌.
// ============================================================
const DATA_VERSION = '51';
if (localStorage.getItem('offstage_data_version') !== DATA_VERSION) {
  // Core data
  localStorage.removeItem('offstage_data');
  // Legacy seed artifacts
  localStorage.removeItem('offstage_my_backings');
  localStorage.removeItem('offstage_bookmarks');
  localStorage.removeItem('offstage_my_notes');
  localStorage.removeItem('offstage_followed_artists');
  // Any listener-seed markers from prior DATA_VERSIONs
  try {
    Object.keys(localStorage)
      .filter(k => k.indexOf('offstage_listener_seed_v') === 0)
      .forEach(k => localStorage.removeItem(k));
  } catch (_) {}
  localStorage.setItem('offstage_data_version', DATA_VERSION);
}

let currentData = localStorage.getItem('offstage_data');
if (!currentData) {
  localStorage.setItem('offstage_data', JSON.stringify(MOCK_DATA));
  currentData = localStorage.getItem('offstage_data');
}

{
  // Minimal migration — keep essential arrays/fields shaped correctly.
  // (Heavy seeding logic from earlier versions has been removed; this just
  // protects against missing keys on objects that were persisted earlier.)
  const parsed = JSON.parse(currentData);
  let changed = false;

  ['tracks', 'notes', 'playlists', 'albums', 'stations', 'reservations',
   'following', 'onboardingArtists', 'fanLetters', 'events'].forEach(key => {
    if (!Array.isArray(parsed[key])) {
      parsed[key] = Array.isArray(MOCK_DATA[key]) ? MOCK_DATA[key] : [];
      changed = true;
    }
  });

  parsed.tracks.forEach(t => {
    if (!Array.isArray(t.tags)) { t.tags = []; changed = true; }
    if (!t.projectId) { t.projectId = 'proj_' + t.id; changed = true; }
    if (!t.version) { t.version = 'final'; changed = true; }
    if (!t.versionLabel) { t.versionLabel = 'Final'; changed = true; }
    if (typeof t.artistNote !== 'string') { t.artistNote = ''; changed = true; }
    if (!Array.isArray(t.trackComments)) { t.trackComments = []; changed = true; }
  });
  parsed.notes.forEach(n => {
    if (!Array.isArray(n.comments)) { n.comments = []; changed = true; }
  });
  if (parsed.currentUser && !Array.isArray(parsed.currentUser.followingArtists)) {
    parsed.currentUser.followingArtists = [];
    changed = true;
  }
  if (parsed.currentUser && !parsed.currentUser.sns) {
    parsed.currentUser.sns = {};
    changed = true;
  }

  if (changed) localStorage.setItem('offstage_data', JSON.stringify(parsed));
}

// ============================================================
// window.DB — public API (unchanged from earlier versions)
// ============================================================
window.DB = {
  get: () => {
    // Bulletproof: handle corrupted/missing localStorage gracefully
    try {
      const raw = localStorage.getItem('offstage_data');
      if (!raw) {
        // Re-seed if wiped
        localStorage.setItem('offstage_data', JSON.stringify(MOCK_DATA));
        return JSON.parse(JSON.stringify(MOCK_DATA));
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      // Ensure essential arrays exist (defensive)
      if (!Array.isArray(parsed.tracks)) parsed.tracks = [];
      if (!Array.isArray(parsed.notes)) parsed.notes = [];
      if (!Array.isArray(parsed.playlists)) parsed.playlists = [];
      return parsed;
    } catch (e) {
      console.warn('[DB] localStorage corrupted, re-seeding', e);
      try {
        localStorage.setItem('offstage_data', JSON.stringify(MOCK_DATA));
        return JSON.parse(JSON.stringify(MOCK_DATA));
      } catch (e2) {
        return JSON.parse(JSON.stringify(MOCK_DATA));
      }
    }
  },
  save: (data) => {
    try {
      localStorage.setItem('offstage_data', JSON.stringify(data));
    } catch (e) {
      console.warn('[DB] save failed (storage full?)', e);
    }
  },
  addTrack: (track) => {
    const data = window.DB.get();
    data.tracks.unshift(track); // prepend
    window.DB.save(data);
  },
  addReservation: (res) => {
    const data = window.DB.get();
    data.reservations.push(res);
    window.DB.save(data);
  },
  addTrackToPlaylist: (playlistId, trackId) => {
    const data = window.DB.get();
    const pl = data.playlists.find(p => p.id === playlistId);
    if (pl && !pl.trackIds.includes(trackId)) {
      pl.trackIds.push(trackId);
      window.DB.save(data);
    }
  },
  removeTrackFromPlaylist: (playlistId, trackId) => {
    const data = window.DB.get();
    const pl = data.playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.trackIds = pl.trackIds.filter(id => id !== trackId);
      window.DB.save(data);
    }
  },
  createPlaylist: (title) => {
    const data = window.DB.get();
    const newPl = { id: 'p' + Date.now(), title, cover: '', trackIds: [] };
    data.playlists.push(newPl);
    window.DB.save(data);
    return newPl;
  },
  addNote: (note) => {
    const data = window.DB.get();
    if (!data.notes) data.notes = [];
    data.notes.unshift(note);
    window.DB.save(data);
  },
  deleteNote: (noteId) => {
    const data = window.DB.get();
    if (!data.notes) return;
    data.notes = data.notes.filter(n => n.id !== noteId);
    window.DB.save(data);
  },
  addNoteComment: (noteId, comment) => {
    const data = window.DB.get();
    const n = (data.notes || []).find(x => x.id === noteId);
    if (!n) return;
    if (!Array.isArray(n.comments)) n.comments = [];
    n.comments.push(comment);
    window.DB.save(data);
  },
  setArtistNote: (trackId, note) => {
    const data = window.DB.get();
    const t = data.tracks.find(x => x.id === trackId);
    if (!t) return;
    t.artistNote = note;
    window.DB.save(data);
  },
  addTrackComment: (trackId, comment) => {
    const data = window.DB.get();
    const t = data.tracks.find(x => x.id === trackId);
    if (!t) return;
    if (!Array.isArray(t.trackComments)) t.trackComments = [];
    t.trackComments.push(comment);
    window.DB.save(data);
  },
  addFanLetter: (letter) => {
    const data = window.DB.get();
    if (!Array.isArray(data.fanLetters)) data.fanLetters = [];
    data.fanLetters.unshift(letter);
    window.DB.save(data);
  },
  deleteFanLetter: (id) => {
    const data = window.DB.get();
    if (!data.fanLetters) return;
    data.fanLetters = data.fanLetters.filter(l => l.id !== id);
    window.DB.save(data);
  },
  toggleFollow: (artistName) => {
    const data = window.DB.get();
    if (!data.currentUser) return false;
    if (!Array.isArray(data.currentUser.followingArtists)) data.currentUser.followingArtists = [];
    const idx = data.currentUser.followingArtists.indexOf(artistName);
    let artist = (data.following || []).find(a => a.name === artistName);
    if (!artist) {
      const trackArtist = data.tracks.find(t => t.artist === artistName);
      artist = {
        id: 'u_' + Date.now(),
        name: artistName,
        avatar: trackArtist?.artistAvatar || '',
        followers: 0,
        sns: { instagram: '', youtube: '', tiktok: '', twitter: '' }
      };
      if (!data.following) data.following = [];
      data.following.push(artist);
    }
    let nowFollowing;
    if (idx >= 0) {
      data.currentUser.followingArtists.splice(idx, 1);
      artist.followers = Math.max(0, (artist.followers || 0) - 1);
      nowFollowing = false;
    } else {
      data.currentUser.followingArtists.push(artistName);
      artist.followers = (artist.followers || 0) + 1;
      nowFollowing = true;
    }
    window.DB.save(data);
    return nowFollowing;
  },
  isFollowing: (artistName) => {
    const data = window.DB.get();
    return !!(data.currentUser && data.currentUser.followingArtists && data.currentUser.followingArtists.includes(artistName));
  },
  getFollowerCount: (artistName) => {
    const data = window.DB.get();
    const a = (data.following || []).find(x => x.name === artistName);
    return a?.followers || 0;
  }
};
