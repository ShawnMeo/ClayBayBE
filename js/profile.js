/* Collector profiles — banner, bio and everything they own.

   Reached by clicking a seller's name anywhere a piece shows one. Rendered
   inside the gallery panel so it reuses the card grid, the loading overlay
   and the view-in-URL behaviour rather than being a separate page.

   The banner is generated from the collector's chosen avatar: a wide band in
   that glaze with the mark oversized behind it. Nothing is uploaded, so a
   profile always looks deliberate even on day one. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (window.__TOAST__ ? window.__TOAST__(m) : console.log(m));

  const fmtSize = (n) =>
    !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

  const since = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };

  let data = null; // the profile currently on screen

  const load = (who) =>
    fetch(`/api/profile?user=${encodeURIComponent(who)}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Could not load (${r.status})`);
        return d;
      })
      .then((d) => {
        data = d;
        return d;
      });

  /* Banner: the collector's mark, oversized and low-contrast, on their glaze. */
  const banner = (avatarId, name) => {
    const A = window.__AVATARS__;
    const id = avatarId || (A ? A.forName(name) : 'jar.glaze');
    const colour = A ? A.COLOURS[A.parse(id).colour] : { ink: '#37527A', wash: '#E8EDF6' };
    return `
      <div class="pf-banner" style="background:${colour.wash}">
        <span class="pf-banner-mark" style="color:${colour.ink}">${A ? A.svg(id) : ''}</span>
      </div>`;
  };

  function render(host) {
    if (!host || !data) return;
    const A = window.__AVATARS__;
    const count = data.pieces.length;

    host.innerHTML = `
      ${banner(data.avatar, data.user)}
      <div class="pf-head">
        <span class="pf-avatar">${A ? A.svg(data.avatar || A.forName(data.user)) : ''}</span>
        <div class="pf-who">
          <h2 class="pf-name">${esc(data.user)}</h2>
          <p class="pf-meta">
            ${count} piece${count === 1 ? '' : 's'}${data.listed ? ` · ${data.listed} for sale` : ''}${
      data.joined ? ` · collecting since ${esc(since(data.joined))}` : ''
    }
          </p>
        </div>
        ${data.viewerIsOwner ? '<button class="cb-link pf-edit" id="pf-edit" type="button">Edit bio</button>' : ''}
      </div>
      <p class="pf-bio${data.bio ? '' : ' is-empty'}" id="pf-bio">${
        data.bio ? esc(data.bio) : data.viewerIsOwner ? 'No bio yet — say something about what you make.' : ''
      }</p>`;

    const edit = $('pf-edit');
    if (edit) edit.addEventListener('click', () => openBioEditor(host));
  }

  function openBioEditor(host) {
    if ($('pf-bio-form')) return;
    const form = document.createElement('form');
    form.className = 'pf-bio-form';
    form.id = 'pf-bio-form';
    form.innerHTML = `
      <textarea id="pf-bio-input" maxlength="280" rows="3"
                placeholder="What do you make?">${esc(data.bio || '')}</textarea>
      <div class="pf-bio-actions">
        <button class="btn" type="submit">Save</button>
        <button class="cb-link" type="button" id="pf-bio-cancel">Cancel</button>
      </div>`;
    $('pf-bio').replaceWith(form);
    $('pf-bio-input').focus();

    $('pf-bio-cancel').addEventListener('click', () => render(host));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const bio = $('pf-bio-input').value;
      fetch('/api/bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio }),
      })
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || `Could not save (${r.status})`);
          return d;
        })
        .then((d) => {
          data.bio = d.bio;
          render(host);
          toast('Bio saved.');
        })
        .catch((err) => toast(err.message));
    });
  }

  /* Their pieces, as gallery cards. Reuses the shelf card shape so a profile
     looks like the rest of the site rather than a separate design. */
  const cards = (grid, makeCard, openPiece) => {
    grid.innerHTML = '';
    if (!data.pieces.length) {
      grid.innerHTML = '<p class="gv-empty">Nothing in this collection yet.</p>';
      return;
    }
    for (const p of data.pieces) {
      const tile = makeCard({
        thumb: p.thumb || null,
        name: p.name,
        sub: fmtSize(p.modelBytes),
        badge: p.serial,
        onOpen: () => openPiece(p),
      });
      const tag = document.createElement('span');
      tag.className = 'gv-tag';
      tag.textContent = p.listing === 'approved' ? 'For sale' : p.madeByThem ? 'Made by them' : 'Collected';
      tile.querySelector('.gv-thumb').appendChild(tag);
      grid.appendChild(tile);
    }
  };

  window.__PROFILE__ = { load, render, cards, get data() { return data; } };
})();
