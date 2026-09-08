require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const store = require('./lib/store');
const security = require('./lib/security');
const admin = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

// ---- refuse to start insecure in production -----------------------------
if (PROD) {
  const missing = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24) missing.push('SESSION_SECRET (24+ characters)');
  if (!process.env.ADMIN_PASSWORD_HASH) missing.push('ADMIN_PASSWORD_HASH');
  if (missing.length) {
    console.error('Refusing to start in production without: ' + missing.join(', '));
    process.exit(1);
  }
  console.warn('[session] Using the in-memory session store. Sessions are lost on restart and it leaks under load — put a real store (connect-redis, connect-mongo) here before you take real traffic.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(security.headers);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Long cache on assets is only safe with a stamp in the URL, so the stamp is
// derived from the files themselves and changes whenever they do.
const ASSET_V = (() => {
  try {
    return ['public/css/site.css', 'public/js/site.js', 'public/css/admin.css']
      .map(f => fs.statSync(path.join(__dirname, f)).mtimeMs)
      .reduce((a, b) => a + b, 0).toString(36);
  } catch { return Date.now().toString(36); }
})();

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Uploads get long-lived caching (their names are unique); everything else
    // is revalidated, because a stale stylesheet after a deploy is worse than a
    // round trip.
    res.setHeader('Cache-Control', filePath.includes(path.sep + 'uploads' + path.sep)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate');
  }
}));

app.use(session({
  name: 'josion.sid',
  secret: process.env.SESSION_SECRET || 'insecure-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(flash());

app.use('/admin', admin);

// ---- public site -------------------------------------------------------
app.get('/', (req, res) => {
  const c = store.read();
  const payload = {
    settings: c.settings,
    clients: c.clients,
    services: c.services,
    process: c.process,
    testimonials: c.testimonials,
    emails: c.emails,
    cases: c.cases
  };
  res.render('index', {
    settings: c.settings,
    payload,
    assetV: ASSET_V,
    scriptJson: security.scriptJson,
    canonical: (process.env.SITE_URL || '').replace(/\/$/, '')
  });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\n${process.env.SITE_URL ? `Sitemap: ${process.env.SITE_URL.replace(/\/$/, '')}/sitemap.xml\n` : ''}`);
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).render('404', { assetV: ASSET_V }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Check the server log.');
});

app.listen(PORT, () => console.log(`JOSION running on http://localhost:${PORT}  ·  admin at /admin`));
