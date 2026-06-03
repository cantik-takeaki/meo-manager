// api/auth/logout.js
export default function handler(req, res) {
  const clear = 'Path=/; Max-Age=0';
  res.setHeader('Set-Cookie', [
    `access_token=; ${clear}`,
    `refresh_token=; ${clear}`,
    `user_email=; ${clear}`,
    `user_name=; ${clear}`,
    `user_picture=; ${clear}`,
  ]);
  res.redirect('/');
}
