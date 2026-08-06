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

  /* Switching to the viewer is instant but the model is a multi-MB fetch, so
     without this you stare at the *previous* piece and wonder if the click
     landed. Covers the stage until the new piece is actually on the wheel. */
  const loading = {
    show(name) {
      const el = $('stage-loading');
      if (!el) return;
      $('sl-name').textContent = name || '';
      el.hidden = false;
    },
    hide() {
      const el = $('stage-loading');
      if (el) el.hidden = true;
    },
  };
  window.__STAGE_LOADING__ = loading;

  /* Fetch a model, showing the loader for the whole trip. `run` receives the
     ArrayBuffer and puts it on the wheel. */
  const openInViewer = (name, url, run) => {
    setMode('viewer');
    loading.show(name);
    return fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        run(buf);
        // One frame so the first render lands before we uncover the stage.
        requestAnimationFrame(() => requestAnimationFrame(loading.hide));
      })
      .catch(() => {
        loading.hide();
        toast(`Could not load "${name}".`);
      });
  };

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
      body: JSON.stringify(meta.piece ? { piece: meta.piece } : { file: meta.file }),
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
        // Take it off the shelf in place and stay put, so you can keep
        // browsing and buy more without being pulled to another view.
        if (meta.file && window.__SHELF_REMOVE__) window.__SHELF_REMOVE__(meta.file);
        owned = []; // stale until next visit to the collection
        loadListings().then(build);
      })
      .catch((e) => {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = `Buy · ${PRICE} Coins`;
      });
  }

  /* Offer one of your pieces to the store. Listings are reviewed by an admin
     before they go on sale, and once sent they cannot be withdrawn — pending
     goes to review, approved lands on the shelf until someone buys it (or an
     admin takes it down). */
  function listPiece(p, btn) {
    const label = p.note || p.id;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    fetch('/api/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece: p.key, listed: true }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
        return d;
      })
      .then(() => {
        toast(`${label} sent for review — it goes on sale once approved.`);
        return loadOwned().then(build);
      })
      .catch((e) => {
        toast(e.message);
        btn.disabled = false;
        build();
      });
  }

  /* Three views on one button, cycling in order:
       viewer  → the 3D stage
       shelf   → grid of pieces for sale
       owned   → grid of pieces you own
     The icon shows the view you'd go to next, matching how the play/pause
     button in the stage bar already behaves. */
  const VIEWS = ['viewer', 'shelf', 'owned'];
  const NEXT_LABEL = { viewer: 'The Shelf', shelf: 'Collection', owned: 'Viewer' };
  const NEXT_ICON = { viewer: 'ic-cube', shelf: 'ic-grid', owned: 'ic-shelf' };
  const THIS_LABEL = { viewer: 'Viewer', shelf: 'The Shelf', owned: 'Collection' };
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

    // Keep the view in the URL so a refresh lands back on the same view
    // instead of resetting to the 3D stage. replaceState, not location.hash,
    // so cycling views doesn't pile up history entries.
    history.replaceState(null, '', view === 'viewer' ? location.pathname : '#' + view);

    if (open) {
      build();
      if (view === 'owned') loadOwned().then(build);
      else loadListings().then(build);
    }
  };

  const cycle = () => setMode(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);

  let owned = [];
  let listings = []; // pieces other collectors have up for sale

  /* A gallery card: the image is the piece, the caption sits quietly beneath,
     and any action (Buy) floats over the image on hover. The whole tile can't
     be one <button> because it has to contain another one, so the open action
     is a full-bleed overlay button behind the pill. */
  const card = ({ thumb, name, sub, badge, onOpen }) => {
    const fig = document.createElement('div');
    fig.className = 'gv-card';
    fig.innerHTML = `
      <div class="gv-thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="${esc(name)}" loading="lazy">` : '<span class="gv-noimg" aria-hidden="true">◈</span>'}
        <button class="gv-open" type="button" aria-label="View ${esc(name)} in 3D"></button>
        <span class="gv-actions"></span>
      </div>
      <div class="gv-meta">
        <span class="gv-name">${esc(name)}</span>
        <span class="gv-sub">${esc(sub || '')}${badge ? `<span class="gv-serial">${esc(badge)}</span>` : ''}</span>
      </div>`;
    if (onOpen) fig.querySelector('.gv-open').addEventListener('click', onOpen);
    return fig;
  };

  const buildShelf = (grid) => {
    const shelf = window.__SHELF__ || [];
    const count = $('gv-count');
    const total = shelf.length + listings.length;
    if (count) count.textContent = total ? `${total} for sale` : 'Every piece has been claimed';

    if (!total) {
      grid.innerHTML = '<p class="gv-empty">Nothing left on the shelf — every piece has an owner now.</p>';
      return;
    }

    // Pieces other collectors have listed, shown alongside the house stock.
    listings.forEach((l) => {
      const tile = card({
        thumb: l.thumbUrl || null,
        name: l.name,
        sub: fmtSize(l.size),
        badge: l.serial,
        onOpen: () => {
          window.__OFF_SHELF__ = true;
          openInViewer(l.name, 'api/blob/' + l.piece + '/model.glb', (buf) =>
            window.__LOAD_BUFFER__(buf, l.name, l.size || 0, null)
          );
        },
      });
      const from = document.createElement('span');
      from.className = 'gv-tag';
      from.textContent = l.mine ? 'Your listing' : 'From ' + l.seller;
      tile.querySelector('.gv-thumb').appendChild(from);

      const act = document.createElement('button');
      act.className = 'gv-buy';
      act.type = 'button';
      if (l.mine) {
        // You can see your own piece is live, but not buy it back.
        act.classList.add('gv-sell', 'is-live');
        act.textContent = 'Listed by you';
        act.disabled = true;
        tile.classList.add('is-listed');
      } else {
        act.innerHTML = `Buy <span class="gv-price">${PRICE}</span>`;
        act.addEventListener('click', () => purchase({ piece: l.piece, name: l.name }, act));
      }
      tile.querySelector('.gv-actions').appendChild(act);
      grid.appendChild(tile);
    });

    shelf.forEach(({ meta, index }) => {
      const tile = card({
        thumb: meta.thumb ? 'models/' + meta.thumb : null,
        name: meta.name || meta.file,
        sub: fmtSize(meta.size),
        onOpen: () => {
          setMode('viewer');
          window.__SHELF_SHOW__(index);
        },
      });
      // The buy pill rides over the image, revealed on hover / focus.
      const buy = document.createElement('button');
      buy.className = 'gv-buy';
      buy.type = 'button';
      buy.dataset.file = meta.file;
      buy.innerHTML = `Buy <span class="gv-price">${PRICE}</span>`;
      buy.addEventListener('click', () => purchase(meta, buy));
      tile.querySelector('.gv-actions').appendChild(buy);
      grid.appendChild(tile);
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
      const tile = card({
        thumb: p.thumb || null,
        name: p.note || p.id,
        sub: fmtSize(p.modelBytes),
        badge: p.serial,
        onOpen: () => {
          window.__OFF_SHELF__ = true;
          const label = p.note || p.id;
          openInViewer(label, p.model, (buf) =>
            window.__LOAD_BUFFER__(buf, label, p.modelBytes || 0, null)
          );
        },
      });
      // Provenance as a quiet corner tag rather than a full-width bar.
      const tag = document.createElement('span');
      tag.className = 'gv-tag';
      tag.textContent = p.traded ? 'Traded' : p.boughtFromShelf ? 'Bought' : 'Yours';
      tile.querySelector('.gv-thumb').appendChild(tag);

      // Sell pill, mirroring Buy on the shelf. Listings need approval first,
      // and once sent there is no withdrawing: pending and approved are
      // status badges, not buttons.
      const sell = document.createElement('button');
      sell.className = 'gv-buy gv-sell';
      sell.type = 'button';
      if (p.listing === 'pending') {
        sell.textContent = 'Awaiting review';
        sell.classList.add('is-pending');
        sell.disabled = true;
      } else if (p.listing === 'approved') {
        sell.textContent = 'For sale';
        sell.classList.add('is-live');
        sell.disabled = true;
      } else if (p.listing === 'rejected') {
        sell.textContent = 'Not approved — retry';
        sell.addEventListener('click', () => listPiece(p, sell));
      } else {
        sell.innerHTML = `Add to store <span class="gv-price">${PRICE}</span>`;
        sell.addEventListener('click', () => listPiece(p, sell));
      }
      tile.querySelector('.gv-actions').appendChild(sell);

      // A listed piece reads differently at a glance.
      if (p.listing) tile.classList.add('is-listed');
      grid.appendChild(tile);
    });
  };

  /* On phones the left rail is hidden, so the studio card has nowhere to live.
     Move the real nodes (not copies) into whichever grid view they belong to,
     so every existing event handler keeps working:
       shop view       -> who you are + Coins
       collection view -> the "new piece from photos" uploader
     Above the phone breakpoint they go back to the rail card. */
  const PHONE = () => window.matchMedia('(max-width: 620px)').matches;

  const placeStudio = () => {
    const slot = $('gv-studio');
    const rail = $('cb-account');
    const identity = $('cb-identity');
    const maker = $('cb-maker');
    if (!slot || !rail) return;

    // Park whichever nodes we borrowed back in the rail first, so switching
    // views can always find them — appendChild moves, it doesn't copy.
    if (identity && identity.parentElement !== rail) rail.appendChild(identity);
    if (maker && maker.parentElement !== rail) rail.appendChild(maker);
    slot.innerHTML = '';

    if (!PHONE() || !identity) {
      slot.hidden = true;
      return;
    }

    slot.hidden = false;
    const wrap = document.createElement('div');
    wrap.className = 'card account gv-studio-card';
    if (view === 'owned') {
      if (maker) wrap.appendChild(maker);
    } else {
      wrap.appendChild(identity);
    }
    slot.appendChild(wrap);
  };

  const build = () => {
    const grid = $('gv-grid');
    if (!grid) return;
    placeStudio();
    grid.innerHTML = '';
    const title = $('gv-title');
    if (title) title.textContent = view === 'owned' ? 'Collection' : 'The Shelf';
    if (view === 'owned') buildOwned(grid);
    else buildShelf(grid);
  };

  /* Approved listings from other collectors, shown on the shelf. */
  const loadListings = () =>
    fetch('/api/shop', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { listings = d.listings || []; })
      .catch(() => { listings = []; });

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
    // Signing in or out re-renders the studio card, so its nodes must be
    // re-placed; it also changes what "Collection" should show.
    window.addEventListener('claybay:session', () => {
      if (open) placeStudio();
      if (view === 'owned') loadOwned().then(build);
    });
    // Rotating a phone can cross the breakpoint in either direction.
    window.matchMedia('(max-width: 620px)').addEventListener('change', () => {
      placeStudio();
    });
    // Restore the view a refresh (or shared link) points at.
    const fromHash = location.hash.replace('#', '');
    if (VIEWS.includes(fromHash) && fromHash !== 'viewer') setMode(fromHash);
    else build();
  };

  if (window.__SHELF__) start();
  else window.addEventListener('shelf:ready', start, { once: true });
})();
