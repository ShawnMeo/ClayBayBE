/* ClayBay API as a single Netlify Function.

   Netlify has no persistent filesystem, so everything server.js keeps in files
   lives in Netlify Blobs instead:

     store 'claybay'  key 'accounts'          -> { users, sessions }
     store 'claybay'  key 'trades'            -> { trades: [] }
     store 'claybay'  key 'sold'              -> { sold: {} }
     store 'claybay'  key 'piece:<user>/<id>' -> piece metadata
     store 'claybay-files' key '<user>/<id>/<file>' -> binary (photos, model.glb)

   The routes and rules match server.js exactly; only storage differs.
   Local dev still uses server.js — this file is for deployment. */
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const START_COINS = 10000;
const MODEL_PRICE = 200;
const SESSION_DAYS = 30;
const MAX_IMAGES = 6;
const MAX_BYTES = 12 * 1024 * 1024;

const meta = () => getStore('claybay');
const files = () => getStore('claybay-files');

const EXT_FOR = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const safeUser = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);

const json = (code, obj, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

const getJson = async (key, fallback) => {
  const v = await meta().get(key, { type: 'json' });
  return v ?? fallback;
};
const putJson = (key, value) => meta().setJSON(key, value);

/* ---- accounts & sessions ---- */
const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');

const checkPassword = (acct, password) => {
  if (!acct?.salt || !acct?.hash) return false;
  const a = Buffer.from(hashPassword(password, acct.salt), 'hex');
  const b = Buffer.from(acct.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const parseCookies = (req) =>
  Object.fromEntries(
    String(req.headers.get('cookie') || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf('=');
        return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))];
      })
  );

const sessionCookie = (token, maxAge) =>
  `cb_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function currentUser(req) {
  const token = parseCookies(req).cb_session;
  if (!token) return null;
  const db = await getJson('accounts', { users: {}, sessions: {} });
  const s = db.sessions?.[token];
  if (!s) return null;
  if (new Date(s.expires) < new Date()) return null;
  return s.user;
}

/* ---- pieces ---- */
async function allPieces() {
  const { blobs } = await meta().list({ prefix: 'piece:' });
  const out = [];
  for (const b of blobs) {
    const p = await meta().get(b.key, { type: 'json' });
    if (p) out.push(p);
  }
  return out;
}

const pieceKey = (key) => `piece:${key}`;

/* ---- handler ---- */
export default async (req, context) => {
  const url = new URL(req.url);
  // Path after /api/ (the redirect strips the prefix into :splat)
  const route = url.pathname.replace(/^.*\/functions\/api\/?/, '').replace(/^api\/?/, '');
  const method = req.method;

  try {
    /* serve an uploaded file out of Blobs */
    if (route.startsWith('blob/')) {
      const key = decodeURIComponent(route.slice('blob/'.length));
      const blob = await files().get(key, { type: 'arrayBuffer' });
      if (!blob) return new Response('Not found', { status: 404 });
      const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
      const type =
        ext === '.glb' ? 'model/gltf-binary'
        : ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : 'application/octet-stream';
      return new Response(blob, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000' } });
    }

    /* ---- auth ---- */
    if (route === 'auth' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const db = await getJson('accounts', { users: {}, sessions: {} });
      const action = String(body.action || '');

      if (action === 'logout') {
        const token = parseCookies(req).cb_session;
        if (token && db.sessions[token]) {
          delete db.sessions[token];
          await putJson('accounts', db);
        }
        return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
      }

      const user = safeUser(body.user);
      const password = String(body.password || '');
      if (!user) return json(400, { error: 'Username must use letters, numbers, - or _.' });
      if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters.' });

      if (action === 'register') {
        if (db.users[user]) return json(409, { error: 'That name is taken. Try signing in instead.' });
        const salt = crypto.randomBytes(16).toString('hex');
        db.users[user] = { salt, hash: hashPassword(password, salt), coins: START_COINS, created: new Date().toISOString() };
      } else if (action === 'login') {
        if (!checkPassword(db.users[user], password)) return json(401, { error: 'Wrong username or password.' });
      } else return json(400, { error: 'Unknown action.' });

      const token = crypto.randomBytes(24).toString('hex');
      const maxAge = SESSION_DAYS * 86400;
      db.sessions[token] = { user, expires: new Date(Date.now() + maxAge * 1000).toISOString() };
      await putJson('accounts', db);
      return json(200, { ok: true, user, coins: db.users[user].coins }, { 'Set-Cookie': sessionCookie(token, maxAge) });
    }

    if (route === 'me' && method === 'GET') {
      const user = await currentUser(req);
      if (!user) return json(200, { user: null });
      const db = await getJson('accounts', { users: {}, sessions: {} });
      return json(200, { user, coins: db.users[user]?.coins ?? 0, price: MODEL_PRICE });
    }

    /* ---- shop ---- */
    if (route === 'shop' && method === 'GET') {
      const manifest = await loadManifest(url);
      const { sold } = await getJson('sold', { sold: {} });
      return json(200, {
        models: (manifest.models || []).filter((m) => !sold[m.file]),
        price: MODEL_PRICE,
      });
    }

    if (route === 'buy' && method === 'POST') {
      const user = await currentUser(req);
      if (!user) return json(401, { error: 'Please sign in again.' });
      const body = await req.json().catch(() => ({}));
      const file = String(body.file || '').split('/').pop();
      const manifest = await loadManifest(url);
      const entry = (manifest.models || []).find((m) => m.file === file);
      if (!entry) return json(404, { error: 'No such piece.' });

      const soldDoc = await getJson('sold', { sold: {} });
      if (soldDoc.sold[file]) return json(409, { error: 'Someone already bought that one.' });

      const db = await getJson('accounts', { users: {}, sessions: {} });
      const acct = db.users[user];
      if (!acct) return json(401, { error: 'Please sign in again.' });
      if (acct.coins < MODEL_PRICE) return json(402, { error: `Not enough Coins — that costs ${MODEL_PRICE}.` });

      // Copy the shelf model out of the deployed site into the buyer's space.
      const src = await fetch(new URL('/models/' + file, url.origin)).then((r) => (r.ok ? r.arrayBuffer() : null));
      if (!src) return json(404, { error: 'That model file is missing.' });

      const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 7);
      const key = `${user}/${id}`;
      await files().set(`${key}/model.glb`, src);

      const images = [];
      if (entry.thumb) {
        const t = await fetch(new URL('/models/' + entry.thumb, url.origin)).then((r) => (r.ok ? r.arrayBuffer() : null));
        if (t) {
          await files().set(`${key}/01-front.png`, t);
          images.push({ file: '01-front.png', view: 'front', bytes: t.byteLength });
        }
      }

      await putJson(pieceKey(key), {
        key, id, creator: user, owner: user,
        note: entry.name || file, status: 'done',
        submitted: new Date().toISOString(),
        images, boughtFromShelf: file,
        model: `uploads/${key}/model.glb`,
        thumb: images.length ? `uploads/${key}/01-front.png` : null,
        modelBytes: src.byteLength,
      });

      acct.coins -= MODEL_PRICE;
      await putJson('accounts', db);
      soldDoc.sold[file] = { user, at: new Date().toISOString(), price: MODEL_PRICE };
      await putJson('sold', soldDoc);
      return json(200, { ok: true, coins: acct.coins, name: entry.name || file });
    }

    /* ---- uploads ---- */
    if (route === 'submit' && method === 'POST') {
      const user = await currentUser(req);
      if (!user) return json(401, { error: 'Please sign in again.' });
      const payload = await req.json().catch(() => ({}));
      const imgs = Array.isArray(payload.images) ? payload.images : [];
      if (!imgs.length) return json(400, { error: 'No images supplied.' });
      if (imgs.length > MAX_IMAGES) return json(400, { error: `At most ${MAX_IMAGES} images per project.` });

      const mine = (await allPieces()).filter((p) => p.creator === user);
      if (mine.some((p) => p.status === 'pending'))
        return json(409, { error: 'Your previous request is still being processed.' });

      const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 7);
      const key = `${user}/${id}`;
      const written = [];
      for (let i = 0; i < imgs.length; i++) {
        const m = /^data:([^;,]+);base64,(.*)$/s.exec(imgs[i].dataUrl || '');
        if (!m) continue;
        const ext = EXT_FOR[m[1]];
        if (!ext) continue;
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_BYTES) continue;
        const name = String(i + 1).padStart(2, '0') + '-' + (imgs[i].view || 'view') + ext;
        await files().set(`${key}/${name}`, buf);
        written.push({ file: name, view: imgs[i].view || '', bytes: buf.length });
      }
      if (!written.length) return json(400, { error: 'No usable images (PNG, JPEG or WebP only).' });

      await putJson(pieceKey(key), {
        key, id, creator: user, owner: user,
        note: String(payload.note || '').slice(0, 500),
        status: 'pending', submitted: new Date().toISOString(),
        images: written,
        thumb: `uploads/${key}/${written[0].file}`,
        model: null, modelBytes: 0,
      });
      return json(200, { ok: true, id, images: written.length });
    }

    /* ---- galleries & trading ---- */
    if (route === 'projects' && method === 'GET') {
      const user = safeUser(url.searchParams.get('user'));
      if (!user) return json(400, { error: 'Missing user.' });
      const list = (await allPieces())
        .filter((p) => p.owner === user || (p.status === 'pending' && p.creator === user))
        .map((p) => ({ ...p, traded: p.creator !== p.owner }))
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
      return json(200, { projects: list });
    }

    if (route === 'pieces' && method === 'GET') {
      const owner = url.searchParams.get('owner');
      let list = (await allPieces()).filter((p) => p.status === 'done');
      if (owner) list = list.filter((p) => p.owner === safeUser(owner));
      return json(200, { pieces: list.sort((a, b) => String(b.id).localeCompare(String(a.id))) });
    }

    if (route === 'users' && method === 'GET') {
      const me = safeUser(url.searchParams.get('me'));
      const owners = [...new Set((await allPieces()).filter((p) => p.status === 'done').map((p) => p.owner))]
        .filter((u) => u !== me)
        .sort();
      return json(200, { users: owners });
    }

    if (route === 'trades' && method === 'GET') {
      const user = safeUser(url.searchParams.get('user'));
      if (!user) return json(400, { error: 'Missing user.' });
      const byKey = Object.fromEntries((await allPieces()).map((p) => [p.key, p]));
      const { trades } = await getJson('trades', { trades: [] });
      const mine = trades
        .filter((t) => t.from === user || t.to === user)
        .map((t) => ({ ...t, direction: t.from === user ? 'outgoing' : 'incoming',
                       offerPiece: byKey[t.offer] || null, wantPiece: byKey[t.want] || null }))
        .reverse();
      return json(200, { trades: mine });
    }

    if (route === 'trades' && method === 'POST') {
      const viewer = await currentUser(req);
      if (!viewer) return json(401, { error: 'Please sign in again.' });
      const body = await req.json().catch(() => ({}));
      const from = viewer;
      const to = safeUser(body.to);
      if (!to) return json(400, { error: 'Both users are required.' });
      if (from === to) return json(400, { error: 'You cannot trade with yourself.' });

      const all = await allPieces();
      const offer = all.find((p) => p.key === body.offer);
      const want = all.find((p) => p.key === body.want);
      if (!offer || !want) return json(404, { error: 'One of those pieces no longer exists.' });
      if (offer.owner !== from) return json(403, { error: 'You no longer own the piece you offered.' });
      if (want.owner !== to) return json(403, { error: `That piece is not owned by ${to} any more.` });
      if (offer.status !== 'done' || want.status !== 'done')
        return json(400, { error: 'Both pieces must be finished models.' });

      const doc = await getJson('trades', { trades: [] });
      const busy = (k) => doc.trades.some((t) => t.status === 'pending' && (t.offer === k || t.want === k));
      if (busy(offer.key)) return json(409, { error: 'That piece is already tied up in a pending trade.' });
      if (busy(want.key)) return json(409, { error: 'Their piece is already tied up in a pending trade.' });

      const trade = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                      from, to, offer: offer.key, want: want.key,
                      status: 'pending', created: new Date().toISOString() };
      doc.trades.push(trade);
      await putJson('trades', doc);
      return json(200, { ok: true, trade });
    }

    if (route === 'trades/respond' && method === 'POST') {
      const viewer = await currentUser(req);
      if (!viewer) return json(401, { error: 'Please sign in again.' });
      const body = await req.json().catch(() => ({}));
      const doc = await getJson('trades', { trades: [] });
      const t = doc.trades.find((x) => x.id === body.id);
      if (!t) return json(404, { error: 'No such trade.' });
      if (t.status !== 'pending') return json(409, { error: `That trade was already ${t.status}.` });

      const action = String(body.action || '');
      if (action === 'cancel') {
        if (viewer !== t.from) return json(403, { error: 'Only the sender can cancel.' });
        t.status = 'cancelled';
      } else if (action === 'decline') {
        if (viewer !== t.to) return json(403, { error: 'Only the recipient can decline.' });
        t.status = 'declined';
      } else if (action === 'accept') {
        if (viewer !== t.to) return json(403, { error: 'Only the recipient can accept.' });
        const offer = await meta().get(pieceKey(t.offer), { type: 'json' });
        const want = await meta().get(pieceKey(t.want), { type: 'json' });
        if (!offer || !want) return json(404, { error: 'One of those pieces no longer exists.' });
        if (offer.owner !== t.from || want.owner !== t.to) {
          t.status = 'void';
          await putJson('trades', doc);
          return json(409, { error: 'Ownership changed — this trade is no longer valid.' });
        }
        offer.owner = t.to;
        want.owner = t.from;
        await putJson(pieceKey(t.offer), offer);
        await putJson(pieceKey(t.want), want);
        t.status = 'accepted';
      } else return json(400, { error: 'Unknown action.' });

      t.resolved = new Date().toISOString();
      await putJson('trades', doc);
      return json(200, { ok: true, trade: t });
    }

    return json(404, { error: 'No such endpoint.' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// The shelf manifest ships with the site, so read it over HTTP.
async function loadManifest(url) {
  const r = await fetch(new URL('/models/manifest.json', url.origin));
  return r.ok ? r.json() : { models: [] };
}
