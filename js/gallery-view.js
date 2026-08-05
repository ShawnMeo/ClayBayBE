/* Gallery mode — a thumbnail grid of the whole shelf, toggled from the header.
   Picking a piece drops you back into the 3D viewport with it loaded.
   Thumbnails come from each manifest entry's `thumb` (models/thumbs/*.png). */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtSize = (n) =>
    !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

  const PRICE = 200;
  let open = false;

  const toast = (m) => (window.__TOAST__ ? window.__TOAST__(m) : console.log(m));

  /* Buy a shelf piece with Coins. On success it leaves the shelf for everyone
     and lands in the buyer's gallery, where it can then be traded. */
  function purchase(meta, btn) {
    if (!window.__CURRENT_USER__ || !window.__CURRENT_USER__())
      return toast('Sign in to buy pieces.');
    const label = meta.name || meta.file;
    btn.disabled = true;
    btn.textContent = 'Buying…';
    fetch('/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: meta.file }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Purchase failed (${r.status})`);
        return d;
      })
      .then((d) => {
        if (window.__SET_COINS__) window.__SET_COINS__(d.coins);
        if (window.__REFRESH_GALLERY__) window.__REFRESH_GALLERY__();
        toast(`Bought ${label} — it's in your collection.`);
        // Drop it from the shelf list in place and show the collection, rather
        // than reloading the whole page.
        if (window.__SHELF_REMOVE__) window.__SHELF_REMOVE__(meta.file);
        setMode('owned');
      })
      .catch((e) => {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = `Buy · ${PRICE} Coins`;
      });
  }

  /* Three views on one button, cycling in order:
       viewer  → the 3D stage
       shelf   → grid of pieces for sale
       owned   → grid of pieces you own
     The icon shows the view you'd go to next, matching how the play/pause
     button in the stage bar already behaves. */
  const VIEWS = ['viewer', 'shelf', 'owned'];
  const NEXT_LABEL = { viewer: 'The Shelf', shelf: 'My Collection', owned: 'Viewer' };
  const NEXT_ICON = { viewer: 'ic-cube', shelf: 'ic-grid', owned: 'ic-shelf' };
  const THIS_LABEL = { viewer: 'Viewer', shelf: 'The Shelf', owned: 'My Collection' };
  let view = 'viewer';

  const setMode = (next) => {
    view = VIEWS.includes(next) ? next : 'viewer';
    open = view !== 'viewer';

    const panel = $('gallery-view');
    const btn = $('mode-toggle');
    if (!panel || !btn) return;

    panel.hidden = !open;
    document.body.classList.toggle('gallery-open', open);

    // The button advertises the *next* view so it reads as a control.
    btn.setAttribute('aria-label', `View ${NEXT_LABEL[view]}`);
    btn.setAttribute('title', NEXT_LABEL[view]);
    for (const id of ['ic-cube', 'ic-grid', 'ic-shelf']) {
      const el = $(id);
      if (el) el.style.display = id === NEXT_ICON[view] ? '' : 'none';
    }
    const label = $('mode-label');
    if (label) label.textContent = THIS_LABEL[view];

    if (open) {
      build();
      if (view === 'owned') loadOwned().then(build);
    }
  };

  const cycle = () => setMode(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);

  let owned = [];

  const card = ({ thumb, name, sub, badge, onOpen }) => {
    const b = document.createElement('button');
    b.className = 'gv-card';
    b.type = 'button';
    b.innerHTML = `
      <span class="gv-thumb">${
        thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<span class="gv-noimg" aria-hidden="true">◈</span>'
      }</span>
      <span class="gv-meta">
        <span class="gv-name">${esc(name)}</span>
        <span class="gv-sub">${esc(sub || '')}</span>
        ${badge ? `<span class="gv-serial">${esc(badge)}</span>` : ''}
      </span>`;
    if (onOpen) b.addEventListener('click', onOpen);
    return b;
  };

  const buildShelf = (grid) => {
    const shelf = window.__SHELF__ || [];
    const count = $('gv-count');
    if (count) count.textContent = shelf.length ? `${shelf.length} for sale` : 'Every piece has been claimed';

    if (!shelf.length) {
      grid.innerHTML = '<p class="gv-empty">Nothing left on the shelf — every piece has an owner now.</p>';
      return;
    }

    shelf.forEach(({ meta, index }) => {
      const row = document.createElement('div');
      row.className = 'gv-item';
      row.appendChild(
        card({
          thumb: meta.thumb ? 'models/' + meta.thumb : null,
          name: meta.name || meta.file,
          sub: fmtSize(meta.size),
          onOpen: () => {
            setMode('viewer');
            window.__SHELF_SHOW__(index);
          },
        })
      );
      const buy = document.createElement('button');
      buy.className = 'gv-buy';
      buy.type = 'button';
      buy.dataset.file = meta.file;
      buy.textContent = `Buy · ${PRICE} Coins`;
      buy.addEventListener('click', () => purchase(meta, buy));
      row.appendChild(buy);
      grid.appendChild(row);
    });
  };

  const buildOwned = (grid) => {
    const user = window.__CURRENT_USER__ && window.__CURRENT_USER__();
    const count = $('gv-count');

    if (!user) {
      if (count) count.textContent = '';
      grid.innerHTML = '<p class="gv-empty">Sign in to see the pieces you own.</p>';
      return;
    }
    const done = owned.filter((p) => p.status === 'done');
    if (count) count.textContent = done.length ? `${done.length} owned` : '';

    if (!done.length) {
      grid.innerHTML =
        '<p class="gv-empty">You don\'t own anything yet. Buy a piece from the shelf, or send in photos of your own.</p>';
      return;
    }

    done.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'gv-item';
      row.appendChild(
        card({
          thumb: p.thumb || null,
          name: p.note || p.id,
          sub: fmtSize(p.modelBytes),
          badge: p.serial,
          onOpen: () => {
            setMode('viewer');
            window.__OFF_SHELF__ = true;
            fetch(p.model)
              .then((r) => {
                if (!r.ok) throw new Error(String(r.status));
                return r.arrayBuffer();
              })
              .then((buf) => window.__LOAD_BUFFER__(buf, p.note || p.id, p.modelBytes || 0, null))
              .catch(() => toast(`Could not load "${p.note || p.id}".`));
          },
        })
      );
      const foot = document.createElement('div');
      foot.className = 'gv-owned-foot';
      foot.textContent = p.traded ? 'Traded in' : p.boughtFromShelf ? 'Bought' : 'Made by you';
      row.appendChild(foot);
      grid.appendChild(row);
    });
  };

  const build = () => {
    const grid = $('gv-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const title = $('gv-title');
    if (title) title.textContent = view === 'owned' ? 'My Collection' : 'The Shelf';
    if (view === 'owned') buildOwned(grid);
    else buildShelf(grid);
  };

  /* Owned pieces come from the same endpoint the rail gallery uses. */
  const loadOwned = () => {
    const user = window.__CURRENT_USER__ && window.__CURRENT_USER__();
    if (!user) {
      owned = [];
      return Promise.resolve();
    }
    return fetch(`/api/projects?user=${encodeURIComponent(user)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        owned = d.projects || [];
      })
      .catch(() => {
        owned = [];
      });
  };

  const start = () => {
    const btn = $('mode-toggle');
    if (btn) btn.addEventListener('click', cycle);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) setMode('viewer');
    });
    // Signing in or out changes what "My Collection" should show.
    window.addEventListener('claybay:session', () => {
      if (view === 'owned') loadOwned().then(build);
    });
    build();
  };

  if (window.__SHELF__) start();
  else window.addEventListener('shelf:ready', start, { once: true });
})();
