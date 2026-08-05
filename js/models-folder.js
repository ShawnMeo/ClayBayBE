/* Loads every model listed in models/manifest.json onto the shelf.
   Drop .glb files into models/ and run `node build-manifest.js` to refresh it.

   The built-in "From the Workshop" catalogue is hidden — the shelf is the
   whole collection. #nav stays in the DOM (hidden) because the viewer bundle
   holds references to it. */
(() => {
  const MANIFEST = 'models/manifest.json';

  const pretty = (file) => file.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').trim();

  // Registered shelf entries, in manifest order, for prev/next stepping.
  const entries = [];
  let current = -1;

  const show = (i) => {
    if (!entries.length) return;
    current = (i + entries.length) % entries.length;
    window.__OFF_SHELF__ = false;
    window.__SHOW_MODEL__(entries[current]);
    // Clear any highlight in the signed-in user's gallery.
    document
      .querySelectorAll('#cb-gallery .spec-btn[aria-pressed="true"]')
      .forEach((b) => b.setAttribute('aria-pressed', 'false'));
  };

  // Header arrows walk the shelf instead of the built-in catalogue.
  window.__STEP__ = (delta) => show(current + delta);

  // Counter reflects the shelf, not the built-in catalogue. Pieces loaded from
  // outside the shelf (a user's gallery, drag-and-drop) clear it via __OFF_SHELF__.
  const pad = (n) => String(n).padStart(2, '0');
  window.__COUNTER__ = () => {
    if (window.__OFF_SHELF__) return '';
    return entries.length && current >= 0 ? `${pad(current + 1)} / ${pad(entries.length)}` : '';
  };

  const hideWorkshop = () => {
    const nav = document.getElementById('nav');
    if (nav) nav.hidden = true;
    // The "From the Workshop" eyebrow sits just before #nav in the rail.
    const eyebrow = nav && nav.previousElementSibling;
    if (eyebrow && eyebrow.classList.contains('eyebrow')) eyebrow.hidden = true;
    // Only one section left, so it is simply "The Shelf".
    const wrap = document.getElementById('shelf-wrap');
    const shelfEyebrow = wrap && wrap.querySelector('.eyebrow');
    if (shelfEyebrow) shelfEyebrow.textContent = 'The Shelf';
  };

  const emptyState = () => {
    const wrap = document.getElementById('shelf-wrap');
    if (!wrap) return;
    wrap.hidden = false;
    const ul = document.getElementById('shelf');
    if (ul && !ul.children.length) {
      const li = document.createElement('li');
      li.className = 'empty-note';
      li.textContent = 'No models yet — drop .glb files into the models folder, then run build-manifest.js.';
      ul.appendChild(li);
    }
  };

  const start = () => {
    hideWorkshop();

    // Prefer /api/shop — it hides pieces someone has already bought. Falls back
    // to the raw manifest when there is no server (plain static hosting).
    fetch('/api/shop', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
      .catch(() => fetch(MANIFEST, { cache: 'no-store' }).then((r) => r.json()))
      .then((data) => {
        const models = Array.isArray(data) ? data : data.models || [];
        const usable = models.filter((m) => m && m.file && /\.(glb|gltf)$/i.test(m.file));
        if (!usable.length) return emptyState();

        for (const m of usable) {
          const url = 'models/' + m.file;
          entries.push(
            window.__REGISTER_MODEL__(m.name || pretty(m.file), m.size || 0, () =>
              fetch(url).then((r) => {
                if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
                return r.arrayBuffer();
              })
            )
          );
        }

        // Clicking a shelf button directly bypasses show(), so keep `current`,
        // the counter and the gallery highlight in sync from the button itself.
        entries.forEach((entry, i) => {
          if (!entry || !entry.btn) return;
          entry.btn.addEventListener('click', () => {
            current = i;
            window.__OFF_SHELF__ = false;
            document
              .querySelectorAll('#cb-gallery .spec-btn[aria-pressed="true"]')
              .forEach((b) => b.setAttribute('aria-pressed', 'false'));
          });
        });

        console.info(`[models] ${usable.length} piece(s) loaded from the models folder.`);

        // Publish for gallery mode: pair each manifest record with its shelf entry.
        window.__SHELF__ = usable.map((m, i) => ({ meta: m, entry: entries[i], index: i }));
        window.__SHELF_SHOW__ = show;
        window.dispatchEvent(new Event('shelf:ready'));

        show(0); // open the first piece instead of a built-in one
      })
      .catch((err) => {
        console.info('[models] No models folder manifest loaded:', err.message);
        emptyState();
      });
  };

  if (window.__BOOT_DONE__) start();
  else window.addEventListener('app:ready', start, { once: true });
})();
