// Off-Stage — Supabase client initialization
// This file runs AFTER the Supabase UMD bundle (both are loaded with `defer`,
// so they execute in document order) and replaces the global `supabase`
// reference (which was the library namespace) with the actual client.
(function () {
  'use strict';
  var SUPABASE_URL = 'https://vayzhmaggwpkbsrrsdqt.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_1PxNV0BGL7Wy_strTMqnbA_pCBCsOPG';
  if (
    SUPABASE_URL.startsWith('<') ||
    SUPABASE_ANON_KEY.startsWith('<') ||
    SUPABASE_ANON_KEY === '__SUPABASE_ANON_KEY__'
  ) {
    console.warn('[Off-Stage] Supabase keys not configured; Supabase auth disabled (localStorage fallback).');
    window.supabase = null;
    return;
  }
  var lib = window.supabase; // UMD library namespace
  if (!lib || typeof lib.createClient !== 'function') {
    console.warn('[Off-Stage] Supabase UMD failed to load; running in offline/mock mode.');
    window.supabase = null;
    return;
  }
  window.supabase = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
})();
