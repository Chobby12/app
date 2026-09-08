const bcrypt = require('bcryptjs');

/**
 * Single-admin auth. The password is supplied as a bcrypt hash in ADMIN_PASSWORD_HASH,
 * so the plaintext never sits in the environment or in a file.
 * Generate one with:  node -e "console.log(require('bcryptjs').hashSync('your-password',12))"
 */
const HASH = process.env.ADMIN_PASSWORD_HASH || '';

function verify(password) {
  if (!HASH) return false;
  try { return bcrypt.compareSync(String(password || ''), HASH); }
  catch { return false; }
}

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
}

module.exports = { verify, requireAuth, configured: () => Boolean(HASH) };
