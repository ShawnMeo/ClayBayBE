/* Trading — offer one of your pieces for someone else's.

   Ownership transfers on accept: your piece goes to them, theirs comes to you.
   Trades are trust-based, matching the fake login — the server does not verify
   that you really are who you claim. Add real auth before this means anything.

   Only finished pieces (a processed model.glb) can be traded. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (window.__TOAST__ ? window.__TOAST__(m) : console.log(m));

  let user = null;
  let mine = []; // my finished pieces
  let theirs = []; // chosen partner's pieces
  let trades = [];
  let partner = '';
  let offerKey = '';
  let wantKey = '';
  let poll = null;
  let composeOpen = false; // survives re-renders (polling, partner change)

  const api = (p, opts) =>
    fetch(p, opts).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
      return d;
    });

  const pendingIncoming = () => trades.filter((t) => t.status === 'pending' && t.direction === 'incoming').length;

  /* ---------- data ---------- */
  const load = () => {
    if (!user) return Promise.resolve();
    return Promise.all([
      api(`/api/pieces?owner=${encodeURIComponent(user)}`).then((d) => (mine = d.pieces || [])),
      api(`/api/trades?user=${encodeURIComponent(user)}`).then((d) => (trades = d.trades || [])),
    ])
      .then(render)
      .catch(() => {
        // No /api (static server) — hide the panel rather than showing errors.
        const host = $('cb-trades');
        if (host) host.hidden = true;
      });
  };

  const loadPartner = (name) => {
    partner = name;
    wantKey = '';
    if (!name) {
      theirs = [];
      return render();
    }
    api(`/api/pieces?owner=${encodeURIComponent(name)}`)
      .then((d) => {
        theirs = d.pieces || [];
        render();
      })
      .catch((e) => toast(e.message));
  };

  /* ---------- actions ---------- */
  const propose = () => {
    if (!offerKey || !wantKey) return toast('Pick a piece on each side.');
    api('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: user, to: partner, offer: offerKey, want: wantKey }),
    })
      .then(() => {
        offerKey = wantKey = '';
        toast(`Trade request sent to ${partner}.`);
        return load();
      })
      .catch((e) => toast(e.message));
  };

  const respond = (id, action) =>
    api('/api/trades/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, user, action }),
    })
      .then((d) => {
        toast(
          d.trade.status === 'accepted'
            ? 'Trade accepted — the pieces have swapped hands.'
            : `Trade ${d.trade.status}.`
        );
        if (window.__REFRESH_GALLERY__) window.__REFRESH_GALLERY__();
        return load();
      })
      .catch((e) => {
        toast(e.message);
        load();
      });

  /* ---------- rendering ---------- */
  const pieceRow = (p, selected, onPick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tr-piece' + (selected ? ' on' : '');
    b.innerHTML = `<span class="tr-thumb">${
      p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : ''
    }</span><span class="tr-label">${esc(p.note || p.id)}</span>`;
    b.addEventListener('click', onPick);
    return b;
  };

  function render() {
    const host = $('cb-trades');
    if (!host) return;
    if (!user) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    const incoming = pendingIncoming();
    host.innerHTML = `
      <div class="cb-userbar">
        <span class="eyebrow">Trades</span>
        ${incoming ? `<span class="tr-badge">${incoming} new</span>` : ''}
      </div>
      <button class="cb-add" id="tr-open" type="button" aria-expanded="${composeOpen}">
        <span class="cb-plus" aria-hidden="true">⇄</span>
        <span>Propose a trade</span>
      </button>
      <div id="tr-panel" class="tr-panel"${composeOpen ? '' : ' hidden'}>
        <label class="tr-lab" for="tr-who">Trade with</label>
        <select id="tr-who"><option value="">Choose a collector…</option></select>
        <div id="tr-cols"></div>
        <button class="btn" id="tr-send" type="button" disabled>Send request</button>
      </div>
      <div id="tr-list" class="tr-list"></div>`;

    const openBtn = $('tr-open');
    const panel = $('tr-panel');
    openBtn.addEventListener('click', () => {
      composeOpen = panel.hidden;
      panel.hidden = !composeOpen;
      openBtn.setAttribute('aria-expanded', String(composeOpen));
      if (composeOpen) fillUsers();
    });

    renderCols();
    renderList();
    if (composeOpen) fillUsers(); // keep the picker populated after a re-render
  }

  function fillUsers() {
    api(`/api/users?me=${encodeURIComponent(user)}`)
      .then((d) => {
        const sel = $('tr-who');
        if (!sel) return;
        const list = d.users || [];
        sel.innerHTML =
          '<option value="">Choose a collector…</option>' +
          list.map((u) => `<option value="${esc(u)}"${u === partner ? ' selected' : ''}>${esc(u)}</option>`).join('');
        if (!list.length) sel.innerHTML = '<option value="">Nobody else has finished pieces yet</option>';
        sel.onchange = () => loadPartner(sel.value); // onchange, not addEventListener — render() re-runs this
      })
      .catch((e) => toast(e.message));
  }

  function renderCols() {
    const cols = $('tr-cols');
    if (!cols) return;
    cols.innerHTML = '';

    const col = (title, list, sel, pick, empty) => {
      const wrap = document.createElement('div');
      wrap.className = 'tr-col';
      const h = document.createElement('span');
      h.className = 'tr-lab';
      h.textContent = title;
      wrap.appendChild(h);
      if (!list.length) {
        const p = document.createElement('p');
        p.className = 'tr-empty';
        p.textContent = empty;
        wrap.appendChild(p);
      } else {
        list.forEach((p) => wrap.appendChild(pieceRow(p, p.key === sel, () => pick(p.key))));
      }
      return wrap;
    };

    cols.appendChild(
      col('You give', mine, offerKey, (k) => {
        offerKey = k;
        renderCols();
        syncSend();
      }, 'You have no finished pieces yet.')
    );
    cols.appendChild(
      col('You get', theirs, wantKey, (k) => {
        wantKey = k;
        renderCols();
        syncSend();
      }, partner ? 'They have no finished pieces.' : 'Pick a collector first.')
    );
    syncSend();
  }

  const syncSend = () => {
    const b = $('tr-send');
    if (!b) return;
    b.disabled = !(offerKey && wantKey && partner);
    b.onclick = propose;
  };

  function renderList() {
    const list = $('tr-list');
    if (!list) return;
    list.innerHTML = '';
    const active = trades.filter((t) => t.status === 'pending');
    if (!active.length) return;

    for (const t of active) {
      const row = document.createElement('div');
      row.className = 'tr-row';
      const them = t.direction === 'incoming' ? t.from : t.to;
      const give = t.direction === 'incoming' ? t.wantPiece : t.offerPiece;
      const get = t.direction === 'incoming' ? t.offerPiece : t.wantPiece;
      row.innerHTML = `
        <div class="tr-row-head">
          <span class="tr-dir">${t.direction === 'incoming' ? 'From' : 'To'} ${esc(them)}</span>
        </div>
        <div class="tr-swap">
          <span class="tr-mini">${give && give.thumb ? `<img src="${esc(give.thumb)}" alt="">` : ''}</span>
          <span class="tr-arrow" aria-hidden="true">⇄</span>
          <span class="tr-mini">${get && get.thumb ? `<img src="${esc(get.thumb)}" alt="">` : ''}</span>
        </div>
        <div class="tr-names">
          <span>${esc(give ? give.note || give.id : '—')}</span>
          <span>${esc(get ? get.note || get.id : '—')}</span>
        </div>
        <div class="tr-acts"></div>`;
      const acts = row.querySelector('.tr-acts');
      if (t.direction === 'incoming') {
        const yes = document.createElement('button');
        yes.className = 'btn tr-yes';
        yes.type = 'button';
        yes.textContent = 'Accept';
        yes.addEventListener('click', () => respond(t.id, 'accept'));
        const no = document.createElement('button');
        no.className = 'cb-link';
        no.type = 'button';
        no.textContent = 'Decline';
        no.addEventListener('click', () => respond(t.id, 'decline'));
        acts.append(yes, no);
      } else {
        const waiting = document.createElement('span');
        waiting.className = 'tr-wait';
        waiting.textContent = 'Awaiting reply';
        const cancel = document.createElement('button');
        cancel.className = 'cb-link';
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => respond(t.id, 'cancel'));
        acts.append(waiting, cancel);
      }
      list.appendChild(row);
    }
  }

  /* ---------- boot ---------- */
  const startPoll = () => {
    if (poll) return;
    poll = setInterval(load, 20000); // pick up trades proposed elsewhere
  };
  const stopPoll = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };

  window.addEventListener('claybay:session', (e) => {
    const next = e.detail && e.detail.user;
    if (next === user) return;
    user = next;
    mine = theirs = [];
    trades = [];
    partner = offerKey = wantKey = '';
    if (user) {
      load();
      startPoll();
    } else {
      stopPoll();
      render();
    }
  });

  const boot = () => {
    user = window.__CURRENT_USER__ ? window.__CURRENT_USER__() : null;
    if (user) {
      load();
      startPoll();
    } else render();
  };
  if (window.__BOOT_DONE__) boot();
  else window.addEventListener('app:ready', boot, { once: true });
})();
