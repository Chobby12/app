const express = require('express');
const store = require('../lib/store');
const { verify, requireAuth, configured } = require('../lib/auth');
const { upload, resolveImage, pruneOrphans } = require('../lib/uploads');
const { attemptLimiter } = require('../lib/security');

const loginLimiter = attemptLimiter({ max: 8, windowMs: 15 * 60 * 1000 });

/** Every mutating route ends here: persist, then sweep files nothing points at. */
async function save(mutate) {
  const result = await store.update(mutate);
  pruneOrphans(store.referencedImages());
  return result;
}

const router = express.Router();

/* Shared view locals so every admin template has the same furniture. */
router.use((req, res, next) => {
  res.locals.notice = req.flash('notice');
  res.locals.problem = req.flash('problem');
  res.locals.section = '';
  const s = store.read().settings;
  res.locals.logo = s.logoDark || s.logo || '';   // sidebar mark
  next();
});

const trim = v => (typeof v === 'string' ? v.trim() : '');
/** Repeatable form rows arrive as parallel arrays; zip them and drop empty pairs. */
function pairs(body, aKey, bKey, aName, bName) {
  const a = [].concat(body[aKey] || []);
  const b = [].concat(body[bKey] || []);
  return a.map((v, i) => ({ [aName]: trim(v), [bName]: trim(b[i]) }))
          .filter(o => o[aName] || o[bName]);
}

// ---------------------------------------------------------------- login
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { configured: configured() });
});

router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!configured()) {
    req.flash('problem', 'No admin password is set. Add ADMIN_PASSWORD_HASH to your .env and restart.');
    return res.redirect('/admin/login');
  }
  if (loginLimiter.blocked(ip)) {
    req.flash('problem', `Too many failed attempts. Try again in ${loginLimiter.retryMinutes(ip)} minutes.`);
    return res.status(429).redirect('/admin/login');
  }
  if (!verify(req.body.password)) {
    loginLimiter.fail(ip);
    req.flash('problem', 'That password did not match. Try again.');
    return res.redirect('/admin/login');
  }
  loginLimiter.clear(ip);
  req.session.regenerate(err => {
    if (err) { req.flash('problem', 'Could not start a session. Try again.'); return res.redirect('/admin/login'); }
    req.session.admin = true;
    res.redirect('/admin');
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.use(requireAuth);

// ---------------------------------------------------------------- dashboard
router.get('/', (req, res) => {
  const c = store.read();
  const s = c.settings;
  const missing = [];
  if (!s.logo) missing.push({ what: 'Logo', where: '/admin/settings' });
  if (!s.calendlyUrl) missing.push({ what: 'Calendly link', where: '/admin/settings' });
  if (!s.youtubeId) missing.push({ what: 'YouTube video', where: '/admin/settings' });
  if (!s.whatsapp) missing.push({ what: 'WhatsApp number', where: '/admin/settings' });
  res.render('admin/dashboard', {
    section: 'dashboard',
    counts: { cases: c.cases.length, emails: c.emails.length, testimonials: c.testimonials.length },
    missing
  });
});

// ---------------------------------------------------------------- case studies
router.get('/cases', (req, res) =>
  res.render('admin/cases', { section: 'cases', cases: store.list('cases') }));

router.get('/cases/new', (req, res) =>
  res.render('admin/case-form', {
    section: 'cases', mode: 'new',
    item: { results: [{ v: '', l: '' }], art: 'wave' },
    emails: store.list('emails')
  }));

router.get('/cases/:id/edit', (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) return res.redirect('/admin/cases');
  res.render('admin/case-form', { section: 'cases', mode: 'edit', item, emails: store.list('emails') });
});

const caseFiles = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]);

function caseFromBody(req, existing = {}) {
  return {
    id: existing.id,
    client: trim(req.body.client),
    cat: trim(req.body.cat),
    title: trim(req.body.title),
    metric: trim(req.body.metric),
    metricLabel: trim(req.body.metricLabel),
    overview: trim(req.body.overview),
    challenge: trim(req.body.challenge),
    strategy: trim(req.body.strategy),
    art: trim(req.body.art) || 'wave',
    emailRef: trim(req.body.emailRef),
    results: pairs(req.body, 'result_v', 'result_l', 'v', 'l'),
    image: resolveImage(req, 'image', existing.image),
    beforeImage: resolveImage(req, 'beforeImage', existing.beforeImage),
    afterImage: resolveImage(req, 'afterImage', existing.afterImage)
  };
}

router.post('/cases', caseFiles, async (req, res) => {
  if (!trim(req.body.title)) { req.flash('problem', 'A case study needs a title.'); return res.redirect('/admin/cases/new'); }
  await save(c => {
    const item = caseFromBody(req);
    item.id = store.slugId('cases', item.title);
    c.cases.push(item);
  });
  req.flash('notice', 'Case study added.');
  res.redirect('/admin/cases');
});

router.post('/cases/:id', caseFiles, async (req, res) => {
  const existing = store.find('cases', req.params.id);
  if (!existing) return res.redirect('/admin/cases');
  await save(c => {
    const i = c.cases.findIndex(x => x.id === req.params.id);
    c.cases[i] = Object.assign({}, existing, caseFromBody(req, existing));
  });
  req.flash('notice', 'Case study saved.');
  res.redirect('/admin/cases');
});

router.post('/cases/:id/delete', async (req, res) => {
  await save(c => { c.cases = c.cases.filter(x => x.id !== req.params.id); });
  req.flash('notice', 'Case study deleted.');
  res.redirect('/admin/cases');
});

router.post('/cases/:id/move', async (req, res) => {
  const dir = req.body.dir === 'up' ? -1 : 1;
  await store.update(c => {
    const i = c.cases.findIndex(x => x.id === req.params.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.cases.length) return;
    [c.cases[i], c.cases[j]] = [c.cases[j], c.cases[i]];
  });
  res.redirect('/admin/cases');
});

// ---------------------------------------------------------------- email designs
router.get('/emails', (req, res) =>
  res.render('admin/emails', { section: 'emails', emails: store.list('emails') }));

router.get('/emails/new', (req, res) =>
  res.render('admin/email-form', { section: 'emails', mode: 'new', item: {} }));

router.get('/emails/:id/edit', (req, res) => {
  const item = store.find('emails', req.params.id);
  if (!item) return res.redirect('/admin/emails');
  res.render('admin/email-form', { section: 'emails', mode: 'edit', item });
});

const emailFiles = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'mobileImage', maxCount: 1 }]);

function emailFromBody(req, existing = {}) {
  return {
    id: existing.id,
    cat: trim(req.body.cat),
    subject: trim(req.body.subject),
    desc: trim(req.body.desc),
    image: resolveImage(req, 'image', existing.image),
    mobileImage: resolveImage(req, 'mobileImage', existing.mobileImage)
  };
}

router.post('/emails', emailFiles, async (req, res) => {
  if (!trim(req.body.subject)) { req.flash('problem', 'An email design needs a subject line.'); return res.redirect('/admin/emails/new'); }
  await save(c => {
    const item = emailFromBody(req);
    item.id = store.slugId('emails', req.body.cat || item.subject);
    c.emails.push(item);
  });
  req.flash('notice', 'Email design added.');
  res.redirect('/admin/emails');
});

router.post('/emails/:id', emailFiles, async (req, res) => {
  const existing = store.find('emails', req.params.id);
  if (!existing) return res.redirect('/admin/emails');
  await save(c => {
    const i = c.emails.findIndex(x => x.id === req.params.id);
    // Merge so the coded mock-up fields on seeded designs survive an edit.
    c.emails[i] = Object.assign({}, existing, emailFromBody(req, existing));
  });
  req.flash('notice', 'Email design saved.');
  res.redirect('/admin/emails');
});

router.post('/emails/:id/delete', async (req, res) => {
  await save(c => {
    c.emails = c.emails.filter(x => x.id !== req.params.id);
    c.cases.forEach(cs => { if (cs.emailRef === req.params.id) cs.emailRef = ''; });
  });
  req.flash('notice', 'Email design deleted.');
  res.redirect('/admin/emails');
});

router.post('/emails/:id/move', async (req, res) => {
  const dir = req.body.dir === 'up' ? -1 : 1;
  await store.update(c => {
    const i = c.emails.findIndex(x => x.id === req.params.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.emails.length) return;
    [c.emails[i], c.emails[j]] = [c.emails[j], c.emails[i]];
  });
  res.redirect('/admin/emails');
});

// ---------------------------------------------------------------- links & settings
router.get('/settings', (req, res) =>
  res.render('admin/settings', { section: 'settings', s: store.read().settings }));

const brandFiles = upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'logoDark', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]);

router.post('/settings', brandFiles, async (req, res) => {
  await save(c => {
    const s = c.settings;
    s.logo = resolveImage(req, 'logo', s.logo);
    s.logoDark = resolveImage(req, 'logoDark', s.logoDark);
    s.favicon = resolveImage(req, 'favicon', s.favicon);
    s.calendlyUrl = trim(req.body.calendlyUrl);
    s.youtubeId = extractYouTubeId(trim(req.body.youtubeId));
    s.youtubeTitle = trim(req.body.youtubeTitle);
    s.whatsapp = trim(req.body.whatsapp).replace(/[^0-9]/g, '');
    s.whatsappMsg = trim(req.body.whatsappMsg);
    s.email = trim(req.body.email);
    s.privacyUrl = trim(req.body.privacyUrl);
    s.termsUrl = trim(req.body.termsUrl);
    s.social = { li: trim(req.body.social_li), ig: trim(req.body.social_ig), x: trim(req.body.social_x) };
  });
  req.flash('notice', 'Settings saved.');
  res.redirect('/admin/settings');
});

/** Accepts a bare id or any normal YouTube URL and returns the id. */
function extractYouTubeId(input) {
  if (!input) return '';
  if (/^[\w-]{11}$/.test(input)) return input;
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
  // Anything we can't recognise is dropped rather than passed through — it would
  // otherwise be concatenated straight into the embed URL.
  return m ? m[1] : '';
}

// upload errors (wrong type, too large) come back here
router.use((err, req, res, next) => {
  req.flash('problem', err.message || 'That upload was rejected.');
  res.redirect(req.get('Referer') || '/admin');
});

module.exports = router;
