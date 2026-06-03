// api/me.js — ログイン状態確認
function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const c = parseCookies(req);
  if (!c.access_token) return res.status(401).json({ loggedIn: false });
  res.json({
    loggedIn: true,
    email: c.user_email,
    name: c.user_name,
    picture: c.user_picture,
  });
}
