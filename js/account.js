/* Fake login + reference-photo uploads + the signed-in user's own gallery.

   The "login" is deliberately fake: any name signs you in, no password is
   checked, and the session lives in localStorage. Swap `signIn` for a real
   auth call when there is a backend to talk to.

   Uploaded photos POST to /api/submit, which writes them to
   uploads/<user>/<project>/ for manual processing. Finished models appear in
   the user's gallery once STATUS.txt says "done" and model.glb exists. */
(() => {
  const SESSION_KEY = 'claybay.user';
  const MAX_IMAGES = 6;
  // Phone photos are 5-15 MB each, but serverless request bodies cap out
  // around 6 MB for the whole submission. Accept big files, then downscale
  // in the browser so six of them still fit comfortably.
  const MAX_BYTES = 25 * 1024 * 1024; // what we'll accept from the picker
  const MAX_EDGE = 1600; // px, longest side after downscaling
  const JPEG_QUALITY = 0.82;
  const TARGET_BYTES = 700 * 1024; // aim per image after downscaling
  const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom'];

  let user = null;
  let coins = null;
  let price = 200;
  let admin = false;
  let avatar = null; // "<shape>.<colour>", null until chosen
  let staged = []; // { file, view, dataUrl }
  let projects = [];
  let polling = null;

  const $ = (id) => document.getElementById(id);
  const toast = (m) => (window.__TOAST__ ? window.__TOAST__(m) : console.log(m));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const hasPending = () => projects.some((p) => p.status === 'pending');

  /* ---------- session ----------
     The session is a HttpOnly cookie set by the server — this code cannot read
     or forge it. /api/me is the source of truth for who you are. */
  const loadSession = () =>
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        user = d.user || null;
        coins = typeof d.coins === 'number' ? d.coins : null;
        price = d.price || price;
        admin = !!d.admin;
        avatar = d.avatar || null;
        showAdminLink();
      })
      .catch(() => {
        user = null;
        coins = null;
      });

  const authCall = (action, name, password) =>
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, user: name, password }),
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Sign-in failed (${r.status})`);
      return d;
    });

  const signIn = (action, name, password) =>
    authCall(action, name, password)
      .then((d) => {
        user = d.user;
        coins = d.coins;
        loadSession().then(showAdminLink);
        render();
        refresh();
        toast(action === 'register' ? `Welcome, ${user} — ${coins.toLocaleString()} Coins to start.` : `Signed in as ${user}.`);
      })
      .catch((e) => toast(e.message));

  const signOut = () => {
    authCall('logout').catch(() => {});
    user = null;
    coins = null;
    admin = false;
    avatar = null;
    showAdminLink();
    projects = [];
    staged = [];
    stopPolling();
    render();
    renderGallery();
    window.dispatchEvent(new CustomEvent('claybay:session', { detail: { user: null } }));
  };

  /* ---------- server ---------- */
  const refresh = () =>
    fetch(`/api/projects?user=${encodeURIComponent(user)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => {
        projects = d.projects || [];
        renderGallery();
        render();
        if (hasPending()) startPolling();
        else stopPolling();
      })
      .catch(() => {
        // Static server with no /api — uploads are unavailable but the rest works.
        projects = [];
        renderGallery();
      });

  const startPolling = () => {
    if (polling) return;
    polling = setInterval(refresh, 15000);
  };
  const stopPolling = () => {
    if (polling) clearInterval(polling);
    polling = null;
  };

  /* ---------- staging images ---------- */
  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(file);
    });

  /* Downscale a photo to MAX_EDGE and re-encode as JPEG, so a six-photo
     submission stays well under the serverless request-size cap. Returns a
     data URL. Falls back to the original if anything goes wrong. */
  const shrink = (file) =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          // Already small enough and modestly sized? Keep it as-is.
          if (scale === 1 && file.size <= TARGET_BYTES) return readFile(file).then(resolve);

          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          // JPEG has no alpha, so flatten onto white first.
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch {
          readFile(file).then(resolve);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        readFile(file).then(resolve);
      };
      img.src = url;
    });

  const dataUrlBytes = (u) => Math.round((String(u).split(',')[1] || '').length * 0.75);

  async function addFiles(fileList) {
    if (hasPending()) return toast('Your previous request is still processing.');
    const room = MAX_IMAGES - staged.length;
    if (room <= 0) return toast(`That's the limit — ${MAX_IMAGES} photos per project.`);

    const picked = [...fileList].filter((f) => {
      if (!OK_TYPES.includes(f.type)) return false;
      if (f.size > MAX_BYTES) {
        toast(`"${f.name}" is over 12 MB.`);
        return false;
      }
      return true;
    });
    if (!picked.length) return toast('Reference photos must be PNG, JPEG or WebP.');

    const take = picked.slice(0, room);
    for (const f of take) {
      staged.push({ file: f, view: VIEWS[staged.length] || 'view', dataUrl: await shrink(f) });
    }
    if (picked.length > room) toast(`Only ${room} more would fit — ${MAX_IMAGES} photos max.`);
    renderStaged();
  }

  const submit = () => {
    if (!staged.length) return toast('Add at least one reference photo.');
    if (hasPending()) return toast('Your previous request is still processing.');

    const btn = $('cb-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    // The stored type must match what shrink() actually produced, not the
    // original file's type, or the server will reject the data URL.
    const images = staged.map((s) => {
      const m = /^data:([^;,]+);/.exec(s.dataUrl);
      return {
        name: s.file.name,
        type: m ? m[1] : s.file.type,
        view: s.view,
        dataUrl: s.dataUrl,
      };
    });

    const total = images.reduce((n, i) => n + dataUrlBytes(i.dataUrl), 0);
    if (total > 5 * 1024 * 1024) {
      btn.disabled = false;
      btn.textContent = 'Send for processing';
      return toast('Those photos are still too large together — try fewer, or smaller ones.');
    }

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: $('cb-note') ? $('cb-note').value : '',
        images,
      }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`);
        return d;
      })
      .then(() => {
        staged = [];
        if ($('cb-note')) $('cb-note').value = '';
        renderStaged();
        toast('Reference photos received — your piece is queued.');
        refresh();
      })
      .catch((e) => toast(e.message))
      .finally(() => {
        btn.disabled = false;
        btn.textContent = 'Send for processing';
      });
  };

  /* ---------- rendering ---------- */
  function render() {
    const host = $('cb-account');
    if (!host) return;

    if (!user) {
      host.innerHTML = `
        <span class="eyebrow">Your Studio</span>
        <p class="cb-hint">Sign in to buy pieces, send reference photos and trade.</p>
        <form class="cb-login" id="cb-login">
          <input id="cb-name" type="text" placeholder="Username" autocomplete="username"
                 aria-label="Username" maxlength="32">
          <input id="cb-pass" type="password" placeholder="Password" autocomplete="current-password"
                 aria-label="Password" maxlength="72">
          <button class="btn" type="submit">Sign in</button>
          <button class="cb-link cb-alt" type="button" id="cb-register">or create an account</button>
        </form>
        <p class="cb-fineprint">New accounts start with ${(10000).toLocaleString()} Coins.</p>`;
      const submitAuth = (action) => {
        const n = $('cb-name').value;
        const p = $('cb-pass').value;
        if (!n.trim()) return toast('Pick a username.');
        if (p.length < 6) return toast('Password must be at least 6 characters.');
        signIn(action, n, p);
      };
      $('cb-login').addEventListener('submit', (e) => {
        e.preventDefault();
        submitAuth('login');
      });
      $('cb-register').addEventListener('click', () => submitAuth('register'));
      return;
    }

    const pending = hasPending();
    host.innerHTML = `
      <div class="cb-userbar">
        <span class="eyebrow">Your Studio</span>
        <button class="cb-link" id="cb-out" type="button">Sign out</button>
      </div>
      <div class="cb-who" id="cb-identity">
        <button class="cb-avatar" id="cb-avatar" type="button"
                title="Change your mark" aria-label="Change your mark">${avatarSvg()}</button>
        <span class="cb-name-wrap">
          <span>${esc(user)}</span>
          <span class="cb-coinrow">
            <span class="cb-coins" id="cb-coins">${coins === null ? '—' : coins.toLocaleString()} Coins</span>
            <a class="cb-topup" href="/coins.html" title="Get more Coins" aria-label="Get more Coins">+</a>
          </span>
        </span>
      </div>
      <div id="cb-maker">
        <button class="cb-add" id="cb-add" type="button" ${pending ? 'disabled' : ''}
                aria-expanded="false" aria-controls="cb-uploader"
                title="${pending ? 'Waiting on your current piece' : 'Add reference photos'}">
          <span class="cb-plus" aria-hidden="true">+</span>
          <span>${pending ? 'Processing your piece…' : 'New piece from photos'}</span>
        </button>
        <div id="cb-uploader" class="cb-uploader" hidden>
          <p class="cb-hint">Up to ${MAX_IMAGES} photos — front, back, left, right, top, bottom.</p>
          <div class="cb-grid" id="cb-staged"></div>
          <input id="cb-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
          <input id="cb-note" type="text" maxlength="120" placeholder="Name or note (optional)" aria-label="Note">
          <button class="btn" id="cb-submit" type="button">Send for processing</button>
        </div>
      </div>`;

    $('cb-out').addEventListener('click', signOut);
    const ava = $('cb-avatar');
    if (ava) ava.addEventListener('click', () => ($('cb-avatars') ? closeAvatarPicker() : openAvatarPicker()));
    const add = $('cb-add');
    const panel = $('cb-uploader');
    add.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      add.setAttribute('aria-expanded', String(open));
      if (open) renderStaged();
    });
    $('cb-file').addEventListener('change', (e) => {
      addFiles(e.target.files);
      e.target.value = '';
    });
    $('cb-submit').addEventListener('click', submit);
    renderStaged();
    // Let the trade panel rebuild itself against the current session.
    window.dispatchEvent(new CustomEvent('claybay:session', { detail: { user } }));
  }

  function renderStaged() {
    const grid = $('cb-staged');
    if (!grid) return;
    const slots = [];
    for (let i = 0; i < MAX_IMAGES; i++) {
      const s = staged[i];
      if (s) {
        slots.push(
          `<div class="cb-slot filled">
             <img src="${s.dataUrl}" alt="${esc(s.view)} reference">
             <span class="cb-view">${esc(s.view)}</span>
             <button class="cb-x" type="button" data-i="${i}" aria-label="Remove ${esc(s.view)}">×</button>
           </div>`
        );
      } else if (i === staged.length) {
        slots.push(
          `<button class="cb-slot add" type="button" id="cb-pick" aria-label="Add reference photo">
             <span class="cb-plus" aria-hidden="true">+</span>
             <span class="cb-view">${esc(VIEWS[i] || 'view')}</span>
           </button>`
        );
      } else {
        slots.push(`<div class="cb-slot"><span class="cb-view">${esc(VIEWS[i] || 'view')}</span></div>`);
      }
    }
    grid.innerHTML = slots.join('');
    const pick = $('cb-pick');
    if (pick) pick.addEventListener('click', () => $('cb-file').click());
    grid.querySelectorAll('.cb-x').forEach((b) =>
      b.addEventListener('click', () => {
        staged.splice(Number(b.dataset.i), 1);
        staged.forEach((s, i) => (s.view = VIEWS[i] || 'view'));
        renderStaged();
      })
    );
    const submitBtn = $('cb-submit');
    if (submitBtn) submitBtn.disabled = !staged.length;
  }

  /* Signed-in user's own finished pieces, as their own rail section. */
  function renderGallery() {
    const wrap = $('cb-gallery-wrap');
    const ul = $('cb-gallery');
    if (!wrap || !ul) return;

    if (!user || !projects.length) {
      wrap.hidden = true;
      ul.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    ul.innerHTML = '';

    for (const p of projects) {
      const li = document.createElement('li');
      if (p.status === 'done' && p.model) {
        const btn = document.createElement('button');
        btn.className = 'spec-btn';
        btn.setAttribute('aria-pressed', 'false');
        const label = p.note || 'Your piece';
        btn.innerHTML = `<span class="thumb">${
          p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : ''
        }</span><span><span class="n">${esc(label)}</span><br><span class="c">Your piece</span></span>`;
        // Load straight into the stage rather than going through
        // __REGISTER_MODEL__ — that would append a button to #shelf and throw
        // off the shelf's own indexing and prev/next stepping.
        btn.addEventListener('click', () => {
          window.__OFF_SHELF__ = true; // not a shelf position, so blank the counter
          fetch(p.model)
            .then((r) => {
              if (!r.ok) throw new Error(`${r.status}`);
              return r.arrayBuffer();
            })
            .then((buf) => window.__LOAD_BUFFER__(buf, label, p.modelBytes || 0, null))
            .catch(() => toast(`Could not load "${label}".`));
          // The viewer only tracks pressed state on #shelf buttons, so mirror it here.
          ul.querySelectorAll('.spec-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
        });
        li.appendChild(btn);
      } else {
        li.className = 'cb-queued';
        li.innerHTML = `<span class="cb-spin" aria-hidden="true"></span><span>${esc(
          p.note || 'Your piece'
        )}<br><span class="c">${p.images} photo${p.images === 1 ? '' : 's'} · in the queue</span></span>`;
      }
      ul.appendChild(li);
    }
  }

  /* ---------- avatars ----------
     Everyone has a mark: your chosen one, or a stable one derived from your
     name until you pick. Drawn as inline SVG by js/avatars.js. */
  const avatarSvg = (id, size) => {
    const A = window.__AVATARS__;
    if (!A) return '';
    return A.svg(id || avatar || A.forName(user), size);
  };

  function openAvatarPicker() {
    const A = window.__AVATARS__;
    if (!A) return;
    const host = $('cb-account');
    if (!host || $('cb-avatars')) return; // already open

    const box = document.createElement('div');
    box.className = 'cb-avatars';
    box.id = 'cb-avatars';
    box.innerHTML = `<p class="cb-hint">Pick your mark.</p><div class="cb-avagrid"></div>`;
    const grid = box.querySelector('.cb-avagrid');

    const current = avatar || A.forName(user);
    for (const opt of A.all()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cb-ava' + (opt.id === current ? ' on' : '');
      b.title = opt.label;
      b.setAttribute('aria-label', opt.label);
      b.innerHTML = A.svg(opt.id);
      b.addEventListener('click', () => chooseAvatar(opt.id));
      grid.appendChild(b);
    }
    // Sits under the identity row, above the uploader.
    const anchor = $('cb-identity');
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(box, anchor.nextSibling);
    else host.appendChild(box);
  }

  const closeAvatarPicker = () => {
    const box = $('cb-avatars');
    if (box) box.remove();
  };

  const chooseAvatar = (id) =>
    fetch('/api/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: id }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Could not save (${r.status})`);
        return d;
      })
      .then((d) => {
        avatar = d.avatar;
        closeAvatarPicker();
        render();
      })
      .catch((e) => toast(e.message));

  /* An Admin link appears in the header only for admin accounts. Hiding it
     is convenience, not security — /api/admin is enforced server-side. */
  function showAdminLink() {
    const tools = document.querySelector('.head-tools');
    if (!tools) return;
    let link = document.getElementById('admin-link');
    if (!admin) {
      if (link) link.remove();
      return;
    }
    if (link) return;
    link = document.createElement('a');
    link.id = 'admin-link';
    link.className = 'admin-link';
    link.href = '/admin.html';
    link.textContent = 'Admin';
    link.title = 'Review listings and submissions';
    tools.insertBefore(link, tools.firstChild);
  }

  /* ---------- boot ---------- */
  const start = () =>
    loadSession().then(() => {
      render();
      renderGallery();
      if (user) refresh();
    });

  // The trade panel calls this after a swap so the gallery reflects new owners.
  window.__REFRESH_GALLERY__ = () => (user ? refresh() : null);
  window.__CURRENT_USER__ = () => user;
  // The shop calls this after a purchase: update the balance and the gallery.
  window.__SET_COINS__ = (n) => {
    coins = n;
    const el = $('cb-coins');
    if (el) el.textContent = `${n.toLocaleString()} Coins`;
  };
  window.__COINS__ = () => coins;

  if (window.__BOOT_DONE__) start();
  else window.addEventListener('app:ready', start, { once: true });
})();
