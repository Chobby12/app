# JOSION Marketing Agency — site + admin

A one-page marketing site with a small dashboard behind it, so case studies,
email designs and every link on the page can be changed without touching code.

Node · Express · EJS · JSON content store · Multer uploads.

## Running it

```bash
npm install
cp .env.example .env
node -e "console.log(require('bcryptjs').hashSync('your-password',12))"
#   paste the output into ADMIN_PASSWORD_HASH in .env
npm start
```

Site: `http://localhost:3000` · Dashboard: `http://localhost:3000/admin`

## First five minutes

1. Sign in at `/admin`.
2. **Links & branding** → upload the JOSION logo. It is used exactly as
   supplied. If the lettering is dark, also upload a light version under
   "Logo for dark theme" so it stays readable on the dark palette.
3. Paste the Calendly link. Every "Book a strategy call" button and the
   inline calendar switch on the moment it is saved.
4. Paste the YouTube URL — the video ID is pulled out for you. The video
   section sits directly under the hero and **only appears once a video is
   set**; an empty player in that slot looks broken, so it stays hidden until
   there is something to play.
5. Set the WhatsApp number and email address.

The **Overview** page lists anything still unset.

## The dashboard on a phone

Below 900px the sidebar becomes an off-canvas drawer behind a hamburger in a
sticky top bar. It closes on Escape, on a tap outside, or with the X in the
drawer header; focus moves into the drawer while it is open and returns to the
hamburger when it closes. List rows stack so the action buttons get their own
line, and the theme switch moves from the sidebar into the top bar.

## Layout

```
server.js              routes, sessions, static files
lib/store.js           reads and writes data/content.json (queued, atomic)
lib/auth.js            bcrypt password check + route guard
lib/uploads.js         multer config, type and size limits
routes/admin.js        every dashboard route
views/index.ejs        the public page
views/admin/*.ejs      the dashboard
public/css/site.css    the design system, both themes
public/js/site.js      the page behaviour
data/content.json      all content — back this up
public/uploads/        uploaded images
```

## Content model

`data/content.json` holds `settings`, `cases`, `emails`, `services`,
`process`, `testimonials` and `clients`. The server passes it to the page as
`window.JOSION`, and `public/js/site.js` renders from that.

Case studies and email designs both degrade gracefully. A case study with no
image gets generated artwork instead; an email design with no screenshot falls
back to the coded mock-up. A half-finished entry never looks broken.

`services`, `process`, `testimonials` and `clients` are edited directly in the
JSON for now. Adding dashboard screens for them follows the same shape as
`routes/admin.js` → `/cases`.

## Moving to MongoDB

`lib/store.js` is the only file that touches the filesystem. Reimplement
`read()` and `update()` against a single `content` document and nothing else
changes.

## Before going live

- Set `NODE_ENV=production`. The server refuses to start without a real
  `SESSION_SECRET` (24+ chars) and an `ADMIN_PASSWORD_HASH`, and marks the
  session cookie secure.
- Set `SITE_URL` so the canonical tag, Open Graph image and `robots.txt`
  sitemap line point somewhere real.
- Put it behind HTTPS.
- **Replace the in-memory session store.** It is fine for one admin on one
  box, but sessions are lost on restart and it leaks memory under load. Add
  `connect-redis` or `connect-mongo` in `server.js`. The server logs a warning
  about this on every production boot.
- Replace the placeholder testimonials, client names and case study metrics.
- Back up `data/content.json` and `public/uploads/` together — they are the
  whole site. `data/content.json` is committed; uploads are gitignored, so a
  fresh clone has content records pointing at images that are not there. Copy
  the uploads directory across as well when you move servers.

## Security notes

- The admin password is only ever stored as a bcrypt hash.
- Login is rate limited to 8 failed attempts per IP per 15 minutes.
- The session cookie is `httpOnly` and `sameSite=lax`, which is what blocks
  cross-site form posts to the admin routes. If you ever loosen it to `none`,
  add CSRF tokens at the same time.
- SVG uploads are deliberately rejected. An SVG can carry `<script>`, and
  anything under `/uploads/` runs on this origin.
- Content is injected into the page as JSON with `<`, `>` and `&` escaped, so
  text typed in the dashboard cannot break out of the script tag.
- `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` are set on
  every response; HSTS is added in production.

## Known limits

- Only the work grid is server-rendered. The hero carousel, email gallery and
  testimonials are still drawn by JavaScript, so a crawler that does not run JS
  sees the case studies but not those sections.
- Uploaded images are stored at their original size. A 4MB screenshot is served
  as a 4MB screenshot; resize before uploading, or add `sharp` to the upload
  pipeline.
- Orphaned files are swept on the next save, not immediately — files younger
  than a minute are spared so a concurrent upload is never deleted mid-request.
