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

  /* Base64 data URL from an ArrayBuffer, chunked so a large model doesn't
     blow the argument limit on String.fromCharCode. */
  const toDataUrl = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return 'data:model/gltf-binary;base64,' + btoa(bin);
  };

  /* Shrink a model before it is uploaded — the same simplify + quantize pass
     the shelf models went through (6.5 MB -> ~500 KB). Doing it here rather
     than server-side means a raw photogrammetry export never has to fit
     through the request size limit.

     If the optimizer can't load or the file defeats it, fall through with the
     original: publishing a large model beats refusing to publish at all. */
  async function optimize(raw, originalSize) {
    try {
      const mod = await import('/js/glb-optimize.js');
      const out = await mod.optimizeGlb(raw);
      // Trust it only if it actually helped and produced something sane.
      if (out.byteLength > 0 && out.byteLength < raw.byteLength) {
        return { buffer: out, before: originalSize, after: out.byteLength };
      }
      return { buffer: raw, before: originalSize, after: raw.byteLength };
    } catch (err) {
      console.warn('optimise failed, publishing the original', err);
      toast('Could not optimise that model — publishing it as-is.');
      return { buffer: raw, before: originalSize, after: raw.byteLength };
    }
  }

  /* Render the model to a PNG for its thumbnail. Non-fatal: if the renderer
     is unavailable the piece just keeps whatever thumbnail it had. */
  async function snapshot(buffer) {
    try {
      const mod = await import('/js/glb-snapshot.js');
      return await mod.snapshotGlb(buffer, 640);
    } catch (err) {
      console.warn('snapshot failed, keeping the existing thumbnail', err);
      return null;
    }
  }

  /* Attach a finished .glb to a submission. This replaces what used to be
     "drop model.glb in the folder" — Blobs has no folder to drop into. */
  function pickModel(piece, btn) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      // No size gate on the input: optimisation happens before upload, so a
      // raw export is expected to be large. Only the *result* has to fit,
      // which is checked after optimising.
      btn.disabled = true;
      btn.textContent = 'Optimising…';

      const fail = (msg) => {
        toast(msg);
        btn.disabled = false;
        btn.textContent = 'Publish model';
      };

      file
        .arrayBuffer()
        .then((raw) => optimize(raw, file.size))
        .then(async (res) => {
          // Render the finished model for its thumbnail. Until now a piece
          // showed the maker's reference photo, which is the input, not the
          // work — and looked nothing like it on the shelf.
          btn.textContent = 'Rendering…';
          res.thumb = await snapshot(res.buffer);
          return res;
        })
        .then(({ buffer, before, after, thumb }) => {
          // Base64 inflates by ~33%, so the cap is on the encoded payload.
          if (after > 4 * 1024 * 1024) {
            throw new Error(
              `Still ${(after / 1048576).toFixed(1)} MB after optimising — simplify it further before publishing.`
            );
          }
          btn.textContent = 'Publishing…';
          return api('/api/admin/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ piece: piece.key, glb: toDataUrl(buffer), thumb }),
          }).then((d) => ({ d, before, after }));
        })
        .then(({ d, before, after }) => {
          const saved = before && after ? ` (${Math.round(100 - (after / before) * 100)}% smaller)` : '';
          toast(`Published "${d.name}" — ${Math.round(d.bytes / 1024)} KB${saved}.`);
          load();
        })
        .catch((e) => fail(e.message));
    });
    input.click();
  }

  const review = (piece, action, note) =>
    api('/api/admin/listing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece, action, note }),
    });

  function render(d) {
    $('who').textContent = 'Signed in as ' + d.admin;
    // Always leave a trace of the last successful load, so "the page is blank"
    // can be told apart from "the page never loaded".
    const stamp = $('ad-stamp');
    if (stamp) {
      stamp.textContent = `Updated ${new Date().toLocaleTimeString()} · ${
        (d.pendingListings || []).length
      } pending · ${(d.users || []).length} collectors`;
    }

    // Any of these can be absent if the payload shape ever changes; default
    // them so a missing field can never blank the whole dashboard.
    const pendingListings = d.pendingListings || [];
    const pendingUploads = d.pendingUploads || [];
    const live = d.live || [];
    const users = d.users || [];

    /* ---- listings awaiting review ---- */
    const L = $('rows-listings');
    L.innerHTML = '';
    $('c-listings').textContent = pendingListings.length;
    if (!pendingListings.length) L.innerHTML = '<p class="ad-empty">Nothing waiting.</p>';
    pendingListings.forEach((p) => {
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
    $('c-uploads').textContent = pendingUploads.length;
    if (!pendingUploads.length) U.innerHTML = '<p class="ad-empty">No submissions waiting.</p>';
    pendingUploads.forEach((p) => {
      // `images` is the array of image records, not a count.
      const shots = Array.isArray(p.images) ? p.images : [];
      const el = row({
        thumb: p.thumb,
        title: p.note || '(untitled)',
        meta: `${esc(p.creator)} · ${shots.length} photo${shots.length === 1 ? '' : 's'} · ${esc(ago(p.submitted))}`,
        actions: [
          {
            label: 'Publish model',
            tone: 'ok',
            run: (btn) => pickModel(p, btn),
          },
        ],
      });

      // The reference photos themselves — this is the whole point of the
      // queue, so link straight to each one at full size.
      if (shots.length) {
        // The two backends serve uploads from different roots — Blobs via
        // /api/blob/, the local dev server from /uploads/. Take the base from
        // the record's own thumb path rather than assuming either.
        const base = (p.thumb || '').replace(/[^/]*$/, '') || `api/blob/${p.key}/`;
        const strip = document.createElement('div');
        strip.className = 'ad-shots';
        for (const img of shots) {
          const a = document.createElement('a');
          a.className = 'ad-shot';
          a.href = '/' + (base + img.file).replace(/^\/+/, '');
          a.target = '_blank';
          a.rel = 'noopener';
          a.title = `${img.view || 'view'} — open full size`;
          a.innerHTML = `<img src="${esc(a.getAttribute('href'))}" alt="${esc(img.view || '')}" loading="lazy">
                         <span>${esc(img.view || '')}</span>`;
          strip.appendChild(a);
        }
        el.appendChild(strip);
      }
      U.appendChild(el);
    });

    /* ---- live listings ---- */
    const V = $('rows-live');
    V.innerHTML = '';
    $('c-live').textContent = live.length;
    if (!live.length) V.innerHTML = '<p class="ad-empty">Nothing on sale from collectors.</p>';
    live.forEach((p) => {
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
    $('c-users').textContent = users.length;
    users
      .slice()
      .sort((a, b) => (b.coins || 0) - (a.coins || 0))
      .forEach((u) => {
        const A = window.__AVATARS__;
        const el = row({
          title: u.name || '(unnamed)',
          meta: `${(u.coins || 0).toLocaleString()} Coins · joined ${esc(ago(u.created))}`,
        });
        // Show each collector's mark rather than an empty thumbnail well.
        if (A) el.querySelector('.ad-thumb').innerHTML = A.svg(u.avatar || A.forName(u.name));
        C.appendChild(el);
      });
  }

  /* Pieces published before renders existed still show a reference photo.
     Fetch each model, render it here, and store the result. */
  function loadStale() {
    return api('/api/admin/stale')
      .then((d) => {
        const list = d.stale || [];
        const sec = $('sec-stale');
        const rows = $('rows-stale');
        if (!sec || !rows) return;
        sec.hidden = !list.length;
        $('c-stale').textContent = list.length;
        rows.innerHTML = '';
        for (const p of list) {
          rows.appendChild(
            row({ title: p.name, meta: `${esc(p.owner)} · <code>${esc(p.key)}</code>` })
          );
        }
        return list;
      })
      .catch(() => []);
  }

  async function rebuildThumbs(btn) {
    const list = await loadStale();
    if (!list || !list.length) return;
    btn.disabled = true;
    let done = 0;
    for (const p of list) {
      btn.textContent = `Rebuilding ${done + 1} of ${list.length}…`;
      try {
        const buf = await fetch('/' + p.model).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        });
        const thumb = await snapshot(buf);
        if (!thumb) throw new Error('render failed');
        await api('/api/admin/rethumb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ piece: p.key, thumb }),
        });
        done++;
      } catch (err) {
        console.warn('rebuild failed for', p.key, err);
      }
    }
    btn.disabled = false;
    btn.textContent = 'Rebuild all';
    toast(`Rebuilt ${done} of ${list.length} thumbnail${list.length === 1 ? '' : 's'}.`);
    load();
  }

  const load = () =>
    api('/api/admin')
      .then((d) => {
        try {
          render(d);
          $('ad-gate').hidden = true;
          $('ad-body').hidden = false;
          loadStale();
        } catch (err) {
          // A render error must not leave a blank body with no explanation.
          // Show it on the page: a console-only error looks like a blank page.
          console.error('admin render failed', err, d);
          $('ad-gate').hidden = false;
          $('ad-body').hidden = true;
          $('ad-msg').innerHTML =
            `<strong>Loaded your data but could not display it.</strong><br>
             ${esc(err.message)}<br>
             <span class="ad-diag">${esc(
               `listings:${(d.pendingListings || []).length} uploads:${(d.pendingUploads || []).length} ` +
                 `live:${(d.live || []).length} users:${(d.users || []).length}`
             )}</span>`;
        }
      })
      .catch((e) => {
        $('ad-gate').hidden = false;
        $('ad-body').hidden = true;
        if (e.status !== 403) {
          $('ad-msg').textContent = e.message;
          return;
        }
        // 403 means either "not signed in" or "signed in as the wrong user" —
        // they need different fixes, so say which one it is.
        fetch('/api/me', { cache: 'no-store' })
          .then((r) => r.json())
          .then((me) => {
            $('ad-msg').innerHTML = me.user
              ? `Signed in as <strong>${esc(me.user)}</strong>, which is not an admin account.
                 Sign in below with an admin account.`
              : 'Sign in with an admin account to review listings.';
            $('ad-login').hidden = false;
            $('ad-user').focus();
          })
          .catch(() => {
            $('ad-msg').textContent = 'Could not reach the server.';
          });
      });

  // Sign in without leaving the page. Same endpoint the main site uses, so a
  // successful login sets the same session cookie.
  const form = $('ad-login');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      api('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', user: $('ad-user').value, password: $('ad-pass').value }),
      })
        .then(() => {
          form.hidden = true;
          $('ad-msg').textContent = 'Checking your access…';
          return load();
        })
        .catch((err) => toast(err.message))
        .finally(() => {
          btn.disabled = false;
        });
    });
  }

  const rebuildBtn = $('rebuild-thumbs');
  if (rebuildBtn) rebuildBtn.addEventListener('click', () => rebuildThumbs(rebuildBtn));

  load();
  setInterval(load, 30000); // keep the queue fresh while it sits open
})();
