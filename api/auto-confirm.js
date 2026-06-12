// Vercel Serverless Function — auto-confirm a freshly signed-up user
// Uses Supabase admin API + secret key (server-side only).
//
// Request: POST /api/auto-confirm { email: string }
// Response: { ok: true, id: string } or { ok: false, error: string }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bikdwofqplwcdvgbcgah.supabase.co';
  const SECRET = process.env.SUPABASE_SECRET_KEY;
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SECRET_KEY env var not set' });
  }

  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ ok: false, error: 'email required' });
    }

    // Step 1: find user by email
    const listResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { 'apikey': SECRET, 'Authorization': `Bearer ${SECRET}` } }
    );
    const listJson = await listResp.json();
    const user = (listJson.users || [])[0];
    if (!user) {
      return res.status(404).json({ ok: false, error: 'user not found' });
    }
    if (user.email_confirmed_at) {
      return res.status(200).json({ ok: true, id: user.id, alreadyConfirmed: true });
    }

    // 보안 가드 — 방금 가입한 계정만 자동 confirm (10분 창).
    // 정상 플로우는 signUp 직후 1~2초 안에 이 API 를 부른다.
    // 이 창 밖의 (묵은) 미인증 계정을 임의 이메일로 활성화하는 공격 차단.
    const createdAt = new Date(user.created_at || 0).getTime();
    const ageMs = Date.now() - createdAt;
    if (!createdAt || ageMs > 10 * 60 * 1000) {
      return res.status(403).json({ ok: false, error: 'account too old for auto-confirm' });
    }

    // Step 2: confirm
    const updateResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
      {
        method: 'PUT',
        headers: {
          'apikey': SECRET,
          'Authorization': `Bearer ${SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email_confirm: true })
      }
    );
    if (!updateResp.ok) {
      const err = await updateResp.text();
      return res.status(500).json({ ok: false, error: err });
    }

    return res.status(200).json({ ok: true, id: user.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
