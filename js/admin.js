/* Admin dashboard — review listings, see submissions, watch the economy.

   Access is decided by the server: /api/admin returns 403 unless the session
   cookie belongs to a username in the CLAYBAY_ADMINS env var. Nothing here is
   a security boundary; hiding the page would not be one either. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtSize = (n) =>
    !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  };

  let toastTimer;
  const toast = (m) => {
    const el = $('toast');
    el.textContent = m;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 3600);
  };

  const api = (p, opts) =>
    fetch(p, { cache: 'no-store', ...opts }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || `Failed (${r.status})`), { status: r.status });
      return d;
    });

  const row = ({ thumb, title, meta, actions }) => {
    const el = document.createElement('div');
    el.className = 'ad-row';
    el.innerHTML = `
      <span class="ad-thumb">${thumb ? `<img src="${esc(thumb)}" alt="">` : ''}</span>
      <span class="ad-info">
        <span class="ad-title">${esc(title)}</span>
        <span class="ad-meta">${meta}</span>
      </span>
      <span class="ad-actions"></span>`;
    const box = el.querySelector('.ad-actions');
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ad-btn' + (a.tone ? ' ' + a.tone : '');
      b.textContent = a.label;
      b.addEventListener('click', () => a.run(b));
      box.appendChild(b);
    });
    return el;
  };

  const review = (piece, action, note) =>
    api('/api/admin/listing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece, action, note }),
    });

  function render(d) {
    $('who').textContent = 'Signed in as ' + d.admin;

    /* ---- listings awaiting review ---- */
    const L = $('rows-listings');
    L.innerHTML = '';
    $('c-listings').textContent = d.pendingListings.length;
    if (!d.pendingListings.length) L.innerHTML = '<p class="ad-empty">Nothing waiting.</p>';
    d.pendingListings.forEach((p) => {
      L.appendChild(
        row({
          thumb: p.thumb,
          title: p.note || p.id,
          meta: `${esc(p.owner)} · ${esc(p.serial)} · ${esc(fmtSize(p.modelBytes))} · listed ${esc(ago(p.listedAt))}`,
          actions: [
            {
              label: 'Approve',
              tone: 'ok',
              run: (b) => {
                b.disabled = true;
                review(p.key, 'approve')
                  .then(() => {
                    toast(`Approved "${p.note || p.id}" — it's on the shelf.`);
                    load();
                  })
                  .catch((e) => {
                    toast(e.message);
                    b.disabled = false;
                  });
              },
            },
            {
              label: 'Reject',
              run: (b) => {
                const note = prompt('Reason (optional, shown to nobody yet):') || '';
                b.disabled = true;
                review(p.key, 'reject', note)
                  .then(() => {
                    toast('Rejected.');
                    load();
                  })
                  .catch((e) => {
                    toast(e.message);
                    b.disabled = false;
                  });
              },
            },
          ],
        })
      );
    });

    /* ---- photo submissions ---- */
    const U = $('rows-uploads');
    U.innerHTML = '';
    $('c-uploads').textContent = d.pendingUploads.length;
    if (!d.pendingUploads.length) U.innerHTML = '<p class="ad-empty">No submissions waiting.</p>';
    d.pendingUploads.forEach((p) => {
      U.appendChild(
        row({
          thumb: p.thumb,
          title: p.note || '(untitled)',
          meta: `${esc(p.creator)} · ${p.images} photo${p.images === 1 ? '' : 's'} · ${esc(ago(p.submitted))} · <code>${esc(p.key)}</code>`,
        })
      );
    });

    /* ---- live listings ---- */
    const V = $('rows-live');
    V.innerHTML = '';
    $('c-live').textContent = d.live.length;
    if (!d.live.length) V.innerHTML = '<p class="ad-empty">Nothing on sale from collectors.</p>';
    d.live.forEach((p) => {
      V.appendChild(
        row({
          thumb: p.thumb,
          title: p.note || p.id,
          meta: `${esc(p.owner)} · ${esc(p.serial)}`,
          actions: [
            {
              label: 'Take down',
              run: (b) => {
                b.disabled = true;
                review(p.key, 'remove')
                  .then(() => {
                    toast('Taken off the shelf.');
                    load();
                  })
                  .catch((e) => {
                    toast(e.message);
                    b.disabled = false;
                  });
              },
            },
          ],
        })
      );
    });

    /* ---- collectors ---- */
    const C = $('rows-users');
    C.innerHTML = '';
    $('c-users').textContent = d.users.length;
    d.users
      .slice()
      .sort((a, b) => b.coins - a.coins)
      .forEach((u) => {
        C.appendChild(
          row({
            title: u.name,
            meta: `${u.coins.toLocaleString()} Coins · joined ${esc(ago(u.created))}`,
          })
        );
      });
  }

  const load = () =>
    api('/api/admin')
      .then((d) => {
        $('ad-gate').hidden = true;
        $('ad-body').hidden = false;
        render(d);
      })
      .catch((e) => {
        $('ad-gate').hidden = false;
        $('ad-body').hidden = true;
        $('ad-msg').textContent =
          e.status === 403
            ? 'This account is not an admin. Sign in on the main site as an admin user, then reload.'
            : e.message;
      });

  load();
  setInterval(load, 30000); // keep the queue fresh while it sits open
})();
