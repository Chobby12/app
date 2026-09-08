/**
 * Content store.
 *
 * Everything the site renders lives in one JSON document on disk. Reads are
 * served from memory; writes go through a queue so two admins saving at the
 * same time can't interleave and corrupt the file.
 *
 * Swapping this for MongoDB means reimplementing read()/write() against a
 * single `content` document — nothing else in the app touches the filesystem.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'content.json');
const TMP = FILE + '.tmp';

const DEFAULTS = {
  settings: {
    logo: '', logoDark: '', favicon: '',
    calendlyUrl: '', whatsapp: '', whatsappMsg: '', youtubeId: '', youtubeTitle: '',
    email: '', social: { li: '', ig: '', x: '' }, privacyUrl: '', termsUrl: ''
  },
  clients: [], services: [], process: [], testimonials: [], emails: [], cases: []
};

let cache = null;
let queue = Promise.resolve();

function read() {
  if (cache) return cache;
  try {
    cache = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] content.json unreadable, starting empty:', err.message);
    cache = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return cache;
}

/**
 * Run `mutate(content)` and persist the result, serialised against other writes.
 *
 * The mutation runs against a copy: if it throws, the in-memory content and the
 * file on disk are both left exactly as they were. The queue survives a failed
 * write too — an earlier rejection must not stop every later save.
 */
function update(mutate) {
  const run = queue.then(async () => {
    const draft = JSON.parse(JSON.stringify(read()));
    const result = await mutate(draft);
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(TMP, JSON.stringify(draft, null, 2));
    fs.renameSync(TMP, FILE);           // atomic swap, so a crash never truncates the file
    cache = draft;                      // only commit once the write succeeded
    return result;
  });
  queue = run.catch(() => {});          // keep the queue alive after a failure
  return run;
}

const list = key => read()[key] || [];
const find = (key, id) => list(key).find(x => x.id === id);

/** Every image path referenced anywhere in the content. Used to prune orphans. */
function referencedImages() {
  const c = read();
  const out = new Set();
  const add = v => { if (typeof v === 'string' && v.startsWith('/uploads/')) out.add(v); };
  ['logo', 'logoDark', 'favicon'].forEach(k => add(c.settings[k]));
  c.cases.forEach(x => ['image', 'beforeImage', 'afterImage'].forEach(k => add(x[k])));
  c.emails.forEach(x => ['image', 'mobileImage'].forEach(k => add(x[k])));
  return out;
}

/** URL-safe id derived from a title, kept unique within its collection. */
function slugId(key, text, ignoreId) {
  const base = String(text || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';
  const taken = new Set(list(key).filter(x => x.id !== ignoreId).map(x => x.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

module.exports = { read, update, list, find, slugId, referencedImages, FILE };
