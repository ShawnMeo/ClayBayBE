/* Coin top-up page.

   Bundles come from /api/bundles so the page never decides how many Coins a
   purchase is worth — the server does. Buying calls /api/topup.

   DEMO: no payment is taken. When a real processor is wired in, the button
   should start a checkout session and the credit should happen in a verified
   webhook, not from a click. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (cents) => '$' + (cents / 100).toFixed(2);
  const num = (n) => Number(n).toLocaleString();

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

  let me = { user: null, coins: null };

  const showBalance = () => {
    $('cn-balance').textContent = me.user
      ? `${num(me.coins)} Coins`
      : 'Not signed in';
  };

  function render(bundles) {
    const grid = $('cn-grid');
    grid.innerHTML = '';

    for (const b of bundles) {
      const card = document.createElement('div');
      card.className = 'cn-card' + (b.popular ? ' is-popular' : '');
      // Value per dollar, so the bigger bundles justify themselves.
      const perDollar = Math.round(b.coins / (b.cents / 100));
      card.innerHTML = `
        ${b.popular ? '<span class="cn-flag">Most chosen</span>' : ''}
        <span class="cn-name">${esc(b.label)}</span>
        <span class="cn-coins">${num(b.coins)}<span class="cn-unit">Coins</span></span>
        ${b.bonus ? `<span class="cn-bonus">includes ${num(b.bonus)} bonus</span>` : '<span class="cn-bonus"></span>'}
        <span class="cn-rate">${num(perDollar)} per $1 · ${Math.floor(b.coins / 200)} pieces</span>
        <button class="btn cn-buy" type="button" data-bundle="${esc(b.id)}">${money(b.cents)}</button>`;

      card.querySelector('.cn-buy').addEventListener('click', (e) => buy(b, e.currentTarget));
      grid.appendChild(card);
    }
  }

  function buy(bundle, btn) {
    if (!me.user) {
      toast('Sign in on the shelf first.');
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    api('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: bundle.id }),
    })
      .then((d) => {
        me.coins = d.coins;
        showBalance();
        toast(`${num(d.added)} Coins added — you now have ${num(d.coins)}.`);
      })
      .catch((e) => toast(e.message))
      .finally(() => {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  Promise.all([
    api('/api/me').catch(() => ({ user: null })),
    api('/api/bundles').catch(() => ({ bundles: [] })),
  ]).then(([who, data]) => {
    me = { user: who.user, coins: who.coins };
    showBalance();
    $('cn-signin').hidden = !!me.user;
    $('cn-demo').hidden = !data.demo;
    render(data.bundles || []);
  });
})();
