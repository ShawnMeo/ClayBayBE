#!/usr/bin/env node
/* ClayBay dev server.
   - Serves the static site (same as `python -m http.server`)
   - Adds POST /api/submit, which writes uploaded reference photos to
     uploads/<user>/<project-id>/ so you can process them by hand.
   - Adds GET /api/projects?user=<name>, which reports each project's status so
     a user's gallery can show models you've finished.

   Run:  node server.js       then open http://localhost:8777
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8777;
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'uploads');
const TRADES = path.join(ROOT, 'trades.json');
const MAX_IMAGES = 6;
const MAX_BYTES = 12 * 1024 * 1024; // per image
const MAX_BODY = 100 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

const EXT_FOR = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

// Usernames become directory names, so keep them boring.
const safeUser = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);

const json = (res, code, obj, headers) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...(headers || {}) });
  res.end(body);
};

/* ---- accounts, sessions, coins ---------------------------------------
   Passwords are salted + hashed with scrypt; the plaintext is never stored.
   A session token goes back in an HttpOnly cookie, so page JS can't read it
   and every write is checked against the *cookie*, not a username in the body. */
const crypto = require('crypto');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const ACCOUNTS = path.join(ROOT, 'accounts.json');
const START_COINS = 10000;
const MODEL_PRICE = 200;
const SESSION_DAYS = 30;

const loadAccounts = () => {
  const d = readJson(ACCOUNTS, {});
  return { users: d.users || {}, sessions: d.sessions || {} };
};
const saveAccounts = (d) => fs.writeFileSync(ACCOUNTS, JSON.stringify(d, null, 2) + '\n');

const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), salt, 64).toString('hex');

const makeAccount = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(password, salt), coins: START_COINS, created: new Date().toISOString() };
};

const checkPassword = (acct, password) => {
  if (!acct || !acct.salt || !acct.hash) return false;
  const attempt = Buffer.from(hashPassword(password, acct.salt), 'hex');
  const known = Buffer.from(acct.hash, 'hex');
  // Constant-time compare so timing can't leak the hash.
  return attempt.length === known.length && crypto.timingSafeEqual(attempt, known);
};

const parseCookies = (req) =>
  Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf('=');
        return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))];
      })
  );

const sessionCookie = (token, maxAgeSec) =>
  `cb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;

// The signed-in user for this request, or null. This is the ONLY source of
// identity for writes — never trust a username in the request body.
function currentUser(req) {
  const token = parseCookies(req).cb_session;
  if (!token) return null;
  const db = loadAccounts();
  const s = db.sessions[token];
  if (!s) return null;
  if (new Date(s.expires) < new Date()) {
    delete db.sessions[token];
    saveAccounts(db);
    return null;
  }
  return s.user;
}

const requireUser = (req, res) => {
  const u = currentUser(req);
  if (!u) {
    json(res, 401, { error: 'Please sign in again.' });
    return null;
  }
  return u;
};

/* POST /api/auth  { action: register|login|logout, user, password } */
async function auth(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8'));
  } catch {
    return json(res, 400, { error: 'Bad request body.' });
  }
  const db = loadAccounts();
  const action = String(body.action || '');

  if (action === 'logout') {
    const token = parseCookies(req).cb_session;
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      saveAccounts(db);
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const user = safeUser(body.user);
  const password = String(body.password || '');
  if (!user) return json(res, 400, { error: 'Username must use letters, numbers, - or _.' });
  if (password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });

  if (action === 'register') {
    if (db.users[user]) return json(res, 409, { error: 'That name is taken. Try signing in instead.' });
    db.users[user] = makeAccount(password);
  } else if (action === 'login') {
    if (!checkPassword(db.users[user], password))
      return json(res, 401, { error: 'Wrong username or password.' });
  } else {
    return json(res, 400, { error: 'Unknown action.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const maxAge = SESSION_DAYS * 86400;
  db.sessions[token] = { user, expires: new Date(Date.now() + maxAge * 1000).toISOString() };
  saveAccounts(db);
  console.log(`[auth] ${action}: ${user}`);
  return json(
    res,
    200,
    { ok: true, user, coins: db.users[user].coins },
    { 'Set-Cookie': sessionCookie(token, maxAge) }
  );
}

/* GET /api/me — who am I, and how many Coins do I have. */
function me(req, res) {
  const user = currentUser(req);
  if (!user) return json(res, 200, { user: null });
  const db = loadAccounts();
  const acct = db.users[user];
  json(res, 200, { user, coins: acct ? acct.coins : 0, price: MODEL_PRICE });
}

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/* ---- POST /api/submit ------------------------------------------------ */
/* Body: { user, note, images: [{ name, type, dataUrl }] }
   Writes uploads/<user>/<timestamp-id>/{01.png.., meta.json, STATUS.txt} */
async function submit(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8'));
  } catch (err) {
    return json(res, 400, { error: 'Bad request body: ' + err.message });
  }

  const user = requireUser(req, res); // session cookie, not payload.user
  if (!user) return;

  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!images.length) return json(res, 400, { error: 'No images supplied.' });
  if (images.length > MAX_IMAGES)
    return json(res, 400, { error: `At most ${MAX_IMAGES} images per project.` });

  const userDir = path.join(UPLOADS, user);
  // One project can be open at a time: refuse if any project is still pending.
  if (fs.existsSync(userDir)) {
    const pending = fs
      .readdirSync(userDir)
      .filter((d) => fs.existsSync(path.join(userDir, d, 'STATUS.txt')))
      .filter((d) => fs.readFileSync(path.join(userDir, d, 'STATUS.txt'), 'utf8').trim() === 'pending');
    if (pending.length) {
      return json(res, 409, {
        error: 'Your previous request is still being processed.',
        pending: pending[0],
      });
    }
  }

  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 7);
  const dir = path.join(userDir, id);
  fs.mkdirSync(dir, { recursive: true });

  const written = [];
  images.forEach((img, i) => {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(img.dataUrl || '');
    if (!m) return;
    const ext = EXT_FOR[m[1]];
    if (!ext) return;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_BYTES) return;
    const file = String(i + 1).padStart(2, '0') + '-' + (img.view || 'view') + ext;
    fs.writeFileSync(path.join(dir, file), buf);
    written.push({ file, view: img.view || '', original: img.name || '', bytes: buf.length });
  });

  if (!written.length) {
    fs.rmSync(dir, { recursive: true, force: true });
    return json(res, 400, { error: 'No usable images (PNG, JPEG or WebP only).' });
  }

  const meta = {
    id,
    user,
    note: String(payload.note || '').slice(0, 500),
    submitted: new Date().toISOString(),
    images: written,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'STATUS.txt'), 'pending\n');

  console.log(`[submit] ${user}/${id} — ${written.length} image(s)`);
  json(res, 200, { ok: true, id, images: written.length });
}

/* ---- ownership & trades ---------------------------------------------
   A piece lives forever in uploads/<creator>/<id>/, but its *owner* can
   change. meta.json carries an `owner` field; when absent the creator (the
   directory it sits in) owns it. Trading rewrites that field — no files move.

   Trades are trust-based, exactly like the fake login: the server does not
   verify that the caller really is `from`/`to`. Add real auth before this
   means anything. */

const loadTrades = () => readJson(TRADES, { trades: [] }).trades || [];
const saveTrades = (list) => fs.writeFileSync(TRADES, JSON.stringify({ trades: list }, null, 2) + '\n');

// Every piece on the server, with its current owner resolved.
function allPieces() {
  if (!fs.existsSync(UPLOADS)) return [];
  const out = [];
  for (const creator of fs.readdirSync(UPLOADS, { withFileTypes: true })) {
    if (!creator.isDirectory()) continue;
    const cdir = path.join(UPLOADS, creator.name);
    for (const proj of fs.readdirSync(cdir, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue;
      const dir = path.join(cdir, proj.name);
      const meta = readJson(path.join(dir, 'meta.json'), {});
      const statusFile = path.join(dir, 'STATUS.txt');
      const status = fs.existsSync(statusFile)
        ? fs.readFileSync(statusFile, 'utf8').trim().toLowerCase()
        : 'pending';
      const modelPath = path.join(dir, 'model.glb');
      const hasModel = fs.existsSync(modelPath);
      out.push({
        key: `${creator.name}/${proj.name}`,
        id: proj.name,
        creator: creator.name,
        owner: meta.owner || creator.name,
        note: meta.note || '',
        status: hasModel && status === 'done' ? 'done' : 'pending',
        images: (meta.images || []).length,
        thumb: meta.images && meta.images[0] ? `uploads/${creator.name}/${proj.name}/${meta.images[0].file}` : null,
        model: hasModel ? `uploads/${creator.name}/${proj.name}/model.glb` : null,
        modelBytes: hasModel ? fs.statSync(modelPath).size : 0,
        submitted: meta.submitted || null,
      });
    }
  }
  return out;
}

const findPiece = (key) => allPieces().find((p) => p.key === key);

function setOwner(key, owner) {
  const [creator, id] = String(key).split('/');
  const file = path.join(UPLOADS, safeUser(creator), id, 'meta.json');
  if (!fs.existsSync(file)) return false;
  const meta = readJson(file, {});
  meta.owner = owner;
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
  return true;
}

/* GET /api/pieces?owner=x   — finished pieces, optionally filtered by owner.
   Without `owner`, returns everyone's (for picking a trade target). */
function pieces(req, res, url) {
  const owner = url.searchParams.get('owner');
  let list = allPieces().filter((p) => p.status === 'done');
  if (owner) list = list.filter((p) => p.owner === safeUser(owner));
  json(res, 200, { pieces: list.sort((a, b) => String(b.id).localeCompare(String(a.id))) });
}

/* GET /api/trades?user=x — trades involving this user, newest first. */
function listTrades(req, res, url) {
  const user = safeUser(url.searchParams.get('user'));
  if (!user) return json(res, 400, { error: 'Missing user.' });
  const byKey = Object.fromEntries(allPieces().map((p) => [p.key, p]));
  const mine = loadTrades()
    .filter((t) => t.from === user || t.to === user)
    .map((t) => ({
      ...t,
      direction: t.from === user ? 'outgoing' : 'incoming',
      offerPiece: byKey[t.offer] || null,
      wantPiece: byKey[t.want] || null,
    }))
    .reverse();
  json(res, 200, { trades: mine });
}

/* POST /api/trades  { from, to, offer, want }  — propose a swap. */
async function createTrade(req, res) {
  const viewer = requireUser(req, res);
  if (!viewer) return;
  let body;
  try {
    body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
  } catch (e) {
    return json(res, 400, { error: 'Bad request body.' });
  }
  const from = viewer; // identity comes from the session cookie, not the body
  const to = safeUser(body.to);
  if (!from || !to) return json(res, 400, { error: 'Both users are required.' });
  if (from === to) return json(res, 400, { error: 'You cannot trade with yourself.' });

  const offer = findPiece(body.offer);
  const want = findPiece(body.want);
  if (!offer || !want) return json(res, 404, { error: 'One of those pieces no longer exists.' });
  if (offer.owner !== from) return json(res, 403, { error: 'You no longer own the piece you offered.' });
  if (want.owner !== to) return json(res, 403, { error: `That piece is not owned by ${to} any more.` });
  if (offer.status !== 'done' || want.status !== 'done')
    return json(res, 400, { error: 'Both pieces must be finished models.' });

  const list = loadTrades();
  if (list.some((t) => t.status === 'pending' && (t.offer === offer.key || t.want === offer.key)))
    return json(res, 409, { error: 'That piece is already tied up in a pending trade.' });
  if (list.some((t) => t.status === 'pending' && (t.offer === want.key || t.want === want.key)))
    return json(res, 409, { error: 'Their piece is already tied up in a pending trade.' });

  const trade = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    from,
    to,
    offer: offer.key,
    want: want.key,
    status: 'pending',
    created: new Date().toISOString(),
  };
  list.push(trade);
  saveTrades(list);
  console.log(`[trade] ${from} offers ${offer.key} for ${want.key} (${to})`);
  json(res, 200, { ok: true, trade });
}

/* POST /api/trades/respond  { id, user, action: accept|decline|cancel } */
async function respondTrade(req, res) {
  const viewer = requireUser(req, res);
  if (!viewer) return;
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8'));
  } catch {
    return json(res, 400, { error: 'Bad request body.' });
  }
  const user = viewer; // never trust a username in the body
  const list = loadTrades();
  const t = list.find((x) => x.id === body.id);
  if (!t) return json(res, 404, { error: 'No such trade.' });
  if (t.status !== 'pending') return json(res, 409, { error: `That trade was already ${t.status}.` });

  const action = String(body.action || '');
  if (action === 'cancel') {
    if (user !== t.from) return json(res, 403, { error: 'Only the sender can cancel.' });
    t.status = 'cancelled';
  } else if (action === 'decline') {
    if (user !== t.to) return json(res, 403, { error: 'Only the recipient can decline.' });
    t.status = 'declined';
  } else if (action === 'accept') {
    if (user !== t.to) return json(res, 403, { error: 'Only the recipient can accept.' });
    // Re-check ownership at accept time — it may have changed since the offer.
    const offer = findPiece(t.offer);
    const want = findPiece(t.want);
    if (!offer || !want) return json(res, 404, { error: 'One of those pieces no longer exists.' });
    if (offer.owner !== t.from || want.owner !== t.to) {
      t.status = 'void';
      saveTrades(list);
      return json(res, 409, { error: 'Ownership changed — this trade is no longer valid.' });
    }
    setOwner(t.offer, t.to); // swap
    setOwner(t.want, t.from);
    t.status = 'accepted';
    console.log(`[trade] accepted: ${t.from} <-> ${t.to}`);
  } else {
    return json(res, 400, { error: 'Unknown action.' });
  }

  t.resolved = new Date().toISOString();
  saveTrades(list);
  json(res, 200, { ok: true, trade: t });
}

/* ---- the shop -------------------------------------------------------
   Shelf models (models/*.glb) are for sale. Buying one costs MODEL_PRICE,
   removes it from the shelf for everyone, and files it in the buyer's
   gallery as a normal piece — so it can then be traded on.
   `sold.json` records which shelf files are gone and who took them. */
const SOLD = path.join(ROOT, 'sold.json');
const loadSold = () => readJson(SOLD, { sold: {} }).sold || {};
const saveSold = (map) => fs.writeFileSync(SOLD, JSON.stringify({ sold: map }, null, 2) + '\n');

/* GET /api/shop — shelf models still for sale. */
function shop(req, res) {
  const manifest = readJson(path.join(ROOT, 'models', 'manifest.json'), { models: [] });
  const sold = loadSold();
  const list = (manifest.models || [])
    .filter((m) => !sold[m.file])
    .map((m) => ({ file: m.file, name: m.name, size: m.size, thumb: m.thumb || null }));
  json(res, 200, { models: list, price: MODEL_PRICE });
}

/* POST /api/buy  { file } — buy a shelf model with Coins. */
async function buy(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  let body;
  try {
    body = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8'));
  } catch {
    return json(res, 400, { error: 'Bad request body.' });
  }

  const file = path.basename(String(body.file || '')); // basename: no path escapes
  if (!/\.(glb|gltf)$/i.test(file)) return json(res, 400, { error: 'Not a model.' });

  const manifest = readJson(path.join(ROOT, 'models', 'manifest.json'), { models: [] });
  const entry = (manifest.models || []).find((m) => m.file === file);
  if (!entry) return json(res, 404, { error: 'No such piece.' });

  const sold = loadSold();
  if (sold[file]) return json(res, 409, { error: 'Someone already bought that one.' });

  const db = loadAccounts();
  const acct = db.users[user];
  if (!acct) return json(res, 401, { error: 'Please sign in again.' });
  if (acct.coins < MODEL_PRICE)
    return json(res, 402, { error: `Not enough Coins — that costs ${MODEL_PRICE}.` });

  const src = path.join(ROOT, 'models', file);
  if (!fs.existsSync(src)) return json(res, 404, { error: 'That model file is missing.' });

  // File it into the buyer's gallery as a finished piece.
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 7);
  const dir = path.join(UPLOADS, user, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, 'model.glb'));

  const images = [];
  if (entry.thumb) {
    const thumbSrc = path.join(ROOT, 'models', entry.thumb);
    if (fs.existsSync(thumbSrc)) {
      fs.copyFileSync(thumbSrc, path.join(dir, '01-front.png'));
      images.push({ file: '01-front.png', view: 'front', original: entry.thumb, bytes: fs.statSync(thumbSrc).size });
    }
  }
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      { id, user, note: entry.name || file, submitted: new Date().toISOString(), boughtFromShelf: file, images },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(path.join(dir, 'STATUS.txt'), 'done\n');

  acct.coins -= MODEL_PRICE;
  saveAccounts(db);
  sold[file] = { user, at: new Date().toISOString(), price: MODEL_PRICE };
  saveSold(sold);

  console.log(`[buy] ${user} bought ${file} for ${MODEL_PRICE}`);
  json(res, 200, { ok: true, coins: acct.coins, name: entry.name || file });
}

/* GET /api/users — everyone with at least one finished piece, for the picker. */
function users(req, res, url) {
  const me = safeUser(url.searchParams.get('me'));
  const owners = [...new Set(allPieces().filter((p) => p.status === 'done').map((p) => p.owner))]
    .filter((u) => u !== me)
    .sort();
  json(res, 200, { users: owners });
}

/* ---- GET /api/projects?user=x --------------------------------------- */
/* Status comes from each project's STATUS.txt: "pending" or "done".
   Drop the finished model in as model.glb and set STATUS.txt to "done". */
function projects(req, res, url) {
  const user = safeUser(url.searchParams.get('user'));
  if (!user) return json(res, 400, { error: 'Missing user.' });

  // A gallery shows what you *own*, not what you uploaded — a traded-away
  // piece leaves, a received one arrives. Still-processing pieces are always
  // shown to their creator so they can see their own queue.
  const out = allPieces()
    .filter((p) => p.owner === user || (p.status === 'pending' && p.creator === user))
    .map((p) => ({
      id: p.id,
      key: p.key,
      status: p.status,
      submitted: p.submitted,
      note: p.note,
      images: p.images,
      thumb: p.thumb,
      model: p.model,
      modelBytes: p.modelBytes,
      creator: p.creator,
      traded: p.creator !== p.owner, // arrived via a trade
    }))
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));

  json(res, 200, { projects: out });
}

/* ---- static ---------------------------------------------------------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const fail = (e) => json(res, 500, { error: e.message });
    if (url.pathname === '/api/auth' && req.method === 'POST') return auth(req, res).catch(fail);
    if (url.pathname === '/api/me' && req.method === 'GET') return me(req, res);
    if (url.pathname === '/api/shop' && req.method === 'GET') return shop(req, res);
    if (url.pathname === '/api/buy' && req.method === 'POST') return buy(req, res).catch(fail);
    if (url.pathname === '/api/submit' && req.method === 'POST') return submit(req, res).catch(fail);
    if (url.pathname === '/api/projects' && req.method === 'GET') return projects(req, res, url);
    if (url.pathname === '/api/pieces' && req.method === 'GET') return pieces(req, res, url);
    if (url.pathname === '/api/users' && req.method === 'GET') return users(req, res, url);
    if (url.pathname === '/api/trades' && req.method === 'GET') return listTrades(req, res, url);
    if (url.pathname === '/api/trades' && req.method === 'POST') return createTrade(req, res).catch(fail);
    if (url.pathname === '/api/trades/respond' && req.method === 'POST') return respondTrade(req, res).catch(fail);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'No such endpoint.' });
    serveStatic(req, res, url);
  })
  .listen(PORT, () => {
    fs.mkdirSync(UPLOADS, { recursive: true });
    console.log(`ClayBay running at http://localhost:${PORT}`);
    console.log(`Uploads land in ${UPLOADS}`);
  });
