const path = require('path');
const fs = require('fs');
const multer = require('multer');

const DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(DIR, { recursive: true });

/**
 * SVG is deliberately absent. An SVG can contain <script>, and anything served
 * from /uploads/ runs on our own origin — one uploaded file would be stored XSS
 * against every visitor. Raster only.
 */
const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

let counter = 0;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIR),
  filename: (req, file, cb) => {
    // Extension comes from the sniffed mime type, not from the client's filename.
    const ext = ALLOWED.get(file.mimetype) || '.png';
    const stem = path.basename(file.originalname, path.extname(file.originalname))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    counter = (counter + 1) % 1e4;   // two files in the same millisecond must not collide
    cb(null, `${stem}-${Date.now().toString(36)}${counter.toString(36)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED.has(file.mimetype) && (!ext || ALLOWED_EXT.has(ext))) return cb(null, true);
    cb(new Error('Only PNG, JPG, WebP or GIF images can be uploaded.'));
  }
});

/**
 * Returns the public path for a field: the newly uploaded file if there is one,
 * the existing value if the field was left alone, or '' if the admin ticked "remove".
 */
function resolveImage(req, field, existing) {
  const uploaded = req.files && req.files[field] && req.files[field][0];
  if (req.body[`${field}__remove`]) {
    // "Remove" wins over a file picked in the same submit; don't leave that file behind.
    if (uploaded) safeUnlink(path.join(DIR, uploaded.filename));
    return '';
  }
  return uploaded ? `/uploads/${uploaded.filename}` : (existing || '');
}

function safeUnlink(abs) {
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(DIR + path.sep)) return;   // never delete outside the uploads dir
  fs.unlink(resolved, () => {});
}

/**
 * Delete uploaded files nothing points at any more — replaced images, images on
 * deleted records. Files younger than a minute are spared so an upload that is
 * mid-request never gets swept away.
 */
function pruneOrphans(referenced) {
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - 60 * 1000;
    files.forEach(name => {
      if (name === '.gitkeep') return;
      if (referenced.has('/uploads/' + name)) return;
      const abs = path.join(DIR, name);
      fs.stat(abs, (e, st) => {
        if (e || st.mtimeMs > cutoff) return;
        safeUnlink(abs);
      });
    });
  });
}

module.exports = { upload, resolveImage, pruneOrphans, DIR };
