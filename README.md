# ClayBay

A 3D showcase site. Restructured from a single 798 KB `kiln-and-lathe.html` into
a normal static site with a **`models/` folder you can drop `.glb` files into**.

## Adding your own models

1. Copy `.glb` files into [`models/`](models/)
2. Run `node build-manifest.js`
3. Reload the page — they appear in the left rail under **"The Shelf"**

The shelf is the whole collection: the original five built-in demo pieces are
hidden, the first shelf model opens on load, and the header arrows step through
the shelf.

## Gallery mode

The grid icon in the header switches between the **3D viewport** and a
**gallery grid** of thumbnails. Clicking any card drops you back into the
viewport with that piece loaded. Esc also leaves the gallery.

Thumbnails live in `models/thumbs/<same-name>.png` and are picked up
automatically by `build-manifest.js` (as a `thumb` field). To regenerate them
after adding models, start the server and run:

```
node build-thumbs.js
```

It screenshots each piece in the live viewer. A model with no thumbnail still
appears in the grid, just with a placeholder glyph.

That's it. Filenames become display names (`moon_jar.glb` → "Moon Jar").

## Running it

```
node server.js
```

then open <http://localhost:8777/>. This serves the site *and* handles photo
uploads. A plain static server (`python -m http.server 8777`) still works for
viewing, but sign-in uploads will fail without `server.js`.

Opened directly as a file, the site still runs — you just get the five built-in
pieces and drag-and-drop, without the models folder.

## Layout

```
site/
├── index.html            page markup
├── server.js             static server + /api/submit + /api/projects
├── build-manifest.js     scans models/ → models/manifest.json
├── css/
│   ├── fonts.css         embedded EB Garamond (base64 woff2)
│   └── styles.css        all page styling
├── build-thumbs.js       regenerates models/thumbs/*.png for gallery mode
├── seed-user.js          test helper: give a user a finished piece instantly
├── js/
│   ├── app.bundle.js     three.js + viewer app
│   ├── models-folder.js  reads the manifest, registers each model
│   ├── gallery-view.js   thumbnail grid + viewport/gallery toggle
│   ├── account.js        login, Coins balance, uploader, personal gallery
│   └── trades.js         propose / accept / decline piece swaps
├── models/
│   ├── manifest.json     generated — hand-edit `name` only
│   ├── thumbs/*.png      gallery thumbnails, one per model
│   └── *.glb             ← public shelf models go here
└── uploads/              ← submitted photos land here, per user/project
```

## User accounts and photo submissions

Sign-in uses a real username + password (see *Accounts, Coins and the shop*
below). Every write is authorised from the session cookie.

A signed-in user gets a **+ button** that opens a 6-slot uploader (front, back,
left, right, top, bottom). They can't submit again until their current request
is processed — enforced both in the UI and by the server, which returns HTTP 409
on a second pending submission.

### Processing a submission

Photos land on disk for you to handle by hand:

```
uploads/<user>/<project-id>/
├── 01-front.png  02-back.png  ...   the reference photos
├── meta.json                        user, note, timestamp, file list
└── STATUS.txt                       "pending"
```

To publish a finished model back to that user's gallery:

1. Drop your processed model into that same folder as **`model.glb`**
2. Change `STATUS.txt` to **`done`**

It shows up under **"Your Pieces"** for that user on their next page load (an
open page picks it up within 15s — it polls while a job is pending). If you also
want it on the public shelf, copy the `.glb` into `models/` and re-run
`build-manifest.js`.

Uploads are capped at 6 images, 12 MB each, PNG/JPEG/WebP only. Usernames are
sanitised to `[a-z0-9_-]` since they become directory names.

## Trading

Signed-in users can swap pieces. **Propose a trade** → pick a collector, pick
one of your finished pieces and one of theirs → send. The recipient sees a
badge and can Accept or Decline; the sender can Cancel while it's pending.

**Accepting transfers ownership** — your piece goes to them, theirs comes to
you. A traded-away piece leaves your gallery and appears in theirs.

Mechanics:

- Files never move. `uploads/<creator>/<id>/` is permanent; ownership is an
  `owner` field in that project's `meta.json`. A gallery lists what you *own*.
- Only finished pieces (a processed `model.glb`) can be traded.
- A piece can only be in one pending trade at a time (HTTP 409 otherwise).
- Ownership is re-checked at accept time; if it changed since the offer, the
  trade is voided rather than applied.
- Trade records live in `trades.json` at the site root.

Who you are comes from the session cookie, so nobody can propose or accept a
trade on someone else's behalf. A username in the request body is ignored.

## Accounts, Coins and the shop

Accounts are real now: **username + password**, hashed with scrypt (salted, the
plaintext is never stored). The session is an **HttpOnly cookie** — page JS
can't read or forge it, and every write checks the cookie rather than a
username in the request body, so one user can no longer act as another.

New accounts start with **10,000 Coins**. Shelf pieces cost **200 Coins** each,
bought from the **Buy** button under each card in gallery mode. Buying:

- takes the piece **off the shelf for everyone** (recorded in `sold.json`)
- files it into your gallery as a finished piece
- makes it **tradable** like any other piece you own

Local data files (all gitignored): `accounts.json`, `sold.json`,
`trades.json`, `uploads/`.

## Deploying to Netlify

Netlify has no persistent filesystem, so `server.js` can't run there. The same
API is reimplemented as a Netlify Function backed by **Netlify Blobs** in
[`netlify/functions/api.mjs`](netlify/functions/api.mjs) — same routes, same
rules, different storage. `server.js` remains the local dev server.

To deploy:

1. Push this folder to a Git repo (GitHub/GitLab).
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Accept the settings from `netlify.toml` (publish `.`, functions in
   `netlify/functions`). Netlify Blobs needs no setup on a linked site.
4. Deploy. Uploaded files are served through `/uploads/*`, which redirects into
   the function.

Notes:

- The `models/` folder and its thumbnails ship with the site, so run
  `build-manifest.js` (and `build-thumbs.js` if you added models) **before**
  pushing.
- Blobs data is per-site and separate from your local files — the deployed site
  starts with no accounts, no sales, no trades.
- Netlify Functions have a request size cap (~6 MB). Six 12 MB photos will
  exceed it; lower `MAX_BYTES` or resize client-side if users hit this.
- Processing submitted photos on the deployed site means writing to Blobs, not
  dropping a file in a folder. Easiest path is to keep processing locally and
  publish finished pieces to the shelf.

## Testing with two accounts

Sessions live in `localStorage`, so **one browser profile = one account**. To be
two people at once, use two *separate* browser profiles:

- A normal window and a **private/incognito** window, or
- Two different browsers (Chrome + Edge), or
- Two Chrome profiles

Two tabs in the same window share a session and will *not* work.

To skip the upload-then-process loop while testing, seed a finished piece
directly:

```
node seed-user.js shawn "Moon Jar" models/Turtle.glb
node seed-user.js friend "Lattice Turtle"
```

Then sign in as each name in its own window and trade. To wipe test data:
delete `uploads/` and `trades.json`.

## Giving it to someone else

The server listens on all interfaces, so on the same Wi-Fi they can just open
`http://<your-lan-ip>:8777` (find it with `ipconfig`). Your machine has to stay
running, and Windows Firewall may prompt to allow Node the first time.

Before handing it to a real user, know these limits:

- **Their uploads need you.** A submitted piece stays "in the queue" until you
  drop a `model.glb` into its folder and set `STATUS.txt` to `done`.
- **They can't trade until they have a finished piece**, so process their first
  upload (or seed them one) before trading will do anything.
- Data lives in local files, so back up `uploads/` and `trades.json`.

## Loading models three ways

- **The models folder** — persistent, listed above
- **"Load pieces" button** — one-off file picker
- **Drag and drop** — drop files, or a whole folder, anywhere on the page

The last two are session-only; the folder is what persists across reloads.

## Notes

- `app.bundle.js` is the minified original bundle, patched at a few points to
  expose hooks: `__REGISTER_MODEL__(name, size, getBuffer)` (`getBuffer` may
  return a Promise, which is how folder models stream in by URL),
  `__SHOW_MODEL__`, plus `__STEP__` / `__COUNTER__` overrides so the header
  arrows and counter follow the shelf. Any model source you add should go
  through `__REGISTER_MODEL__`.
- The five built-in pieces still exist in the bundle. `#nav` is kept in the DOM
  but hidden via CSS, because the bundle holds live references to it — deleting
  the element would throw.
- Models are auto-scaled and centred; animations play automatically.
- Light and dark themes both work, following the OS setting.
- The original `../kiln-and-lathe.html` is untouched.
