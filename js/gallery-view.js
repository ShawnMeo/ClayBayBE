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
        toast(`Bought ${label} — it's yours now.`);
        // It has left the shelf, so reload the page's shelf state.
        setTimeout(() => window.location.reload(), 900);
      })
      .catch((e) => {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = `Buy · ${PRICE} Coins`;
      });
  }

  const setMode = (on) => {
    open = on;
    const view = $('gallery-view');
    const btn = $('mode-toggle');
    if (!view || !btn) return;
    view.hidden = !on;
    document.body.classList.toggle('gallery-open', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Back to the viewer' : 'Show gallery grid');
    btn.setAttribute('title', on ? 'Viewer' : 'Gallery');
    $('ic-grid').style.display = on ? 'none' : '';
    $('ic-cube').style.display = on ? '' : 'none';
  };

  const build = () => {
    const grid = $('gv-grid');
    const shelf = window.__SHELF__ || [];
    if (!grid) return;

    grid.innerHTML = '';
    const count = $('gv-count');
    if (count) count.textContent = shelf.length ? `${shelf.length} pieces` : 'No pieces yet';

    shelf.forEach(({ meta, index }) => {
      const card = document.createElement('button');
      card.className = 'gv-card';
      card.type = 'button';
      const thumb = meta.thumb ? 'models/' + meta.thumb : null;
      card.innerHTML = `
        <span class="gv-thumb">${
          thumb
            ? `<img src="${esc(thumb)}" alt="" loading="lazy">`
            : '<span class="gv-noimg" aria-hidden="true">◈</span>'
        }</span>
        <span class="gv-meta">
          <span class="gv-name">${esc(meta.name || meta.file)}</span>
          <span class="gv-sub">${esc(fmtSize(meta.size))}</span>
        </span>`;
      card.addEventListener('click', () => {
        setMode(false); // back to the viewport, with this piece loaded
        window.__SHELF_SHOW__(index);
      });

      // Buying sits outside the card button so it doesn't also open the viewer.
      const row = document.createElement('div');
      row.className = 'gv-item';
      row.appendChild(card);
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

  const start = () => {
    const btn = $('mode-toggle');
    if (btn) btn.addEventListener('click', () => setMode(!open));
    // Esc leaves gallery mode.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) setMode(false);
    });
    build();
  };

  if (window.__SHELF__) start();
  else window.addEventListener('shelf:ready', start, { once: true });
})();
