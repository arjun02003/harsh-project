(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const state = { cfg: null, me: null, afterAuth: null };

  const KIND = { room: 'Room / PG', mess: 'Mess / Tiffin', institute: 'Institute' };
  const UNIT = { month: '/month', year: '/year', course: ' per course', day: '/day' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const fmtPhone = (p) => (/^\d{10}$/.test(p) ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

  async function api(url, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try { res = await fetch(url, init); }
    catch { throw { status: 0, data: { message: 'No internet connection. Check it and try again.' } }; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, data };
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  // ---------- dialog ----------
  const dlg = $('#dlg');
  let paymentCountdownTimer;
  let paymentPollTimer;
  function clearPaymentTimers() {
    clearInterval(paymentCountdownTimer);
    clearInterval(paymentPollTimer);
    paymentCountdownTimer = null;
    paymentPollTimer = null;
  }
  function openDlg(html) {
    clearPaymentTimers();
    $('#dlgBody').innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  $('#dlgClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', clearPaymentTimers);

  function openTerms() {
    openDlg(`
      <h2 id="dlgTitle">Terms and Conditions</h2>
      <p class="muted">Please read these terms before using Nagpur Nest.</p>
      <h3>Using the service</h3>
      <p>Nagpur Nest helps people discover rooms, PGs, mess and tiffin services, and institutes in Nagpur. You must provide accurate account information, keep your password secure, and use the service lawfully.</p>
      <h3>Searches and plans</h3>
      <p>Free searches, referral rewards, paid search packs, and plan validity work as described on the website when you use or purchase them. Prices and available plans may change. Contact us if you have a question about a payment or your account.</p>
      <h3>Listings and transactions</h3>
      <p>Listings are provided by third parties and may be incomplete, out of date, or inaccurate. A listing or verification label is not a guarantee or endorsement by Nagpur Nest. You are responsible for checking the property, service, provider, price, safety, and terms directly before making a decision or payment. Any booking or transaction is between you and the provider.</p>
      <h3>Fair use</h3>
      <p>Do not misuse the website, interfere with its operation, post misleading information, or access another person's account. We may restrict access when these terms are violated or when needed to protect the service and its users.</p>
      <h3>Availability and changes</h3>
      <p>We work to keep the service available but cannot guarantee uninterrupted access or that every listing remains available. We may update the website and these terms; continued use after an update means you accept the updated terms.</p>
      <h3>Contact</h3>
      <p>Questions about these terms? Call <a href="tel:+917559255778">75592 55778</a> or email <a href="mailto:sabhainagpur@gmail.com">sabhainagpur@gmail.com</a>.</p>
    `);
  }

  // ---------- header + allowance ----------
  function untilText(ts) {
    if (ts > 4000000000000) return 'for life';
    return 'until ' + new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function pillText(me) {
    if (me.unlimited) return `Unlimited searches ${untilText(me.unlimitedUntil)}`;
    return `${plural(me.credits, 'search', 'searches')} left`;
  }
  function renderHeader() {
    const me = state.me;
    const pill = $('#pill');
    const acct = $('#account');
    const note = $('#allowance');
    if (me) {
      pill.hidden = false;
      pill.textContent = pillText(me);
      acct.innerHTML =
        `<span class="hello">Hi, ${esc(me.name.split(' ')[0])}</span>` +
        '<button class="btn btn-quiet btn-sm" type="button" data-act="logout">Log out</button>';
      note.textContent = me.unlimited
        ? 'Search as much as you like.'
        : 'A search that finds results uses one search. No results, no charge.';
    } else {
      pill.hidden = true;
      acct.innerHTML =
        '<button class="btn btn-quiet btn-sm" type="button" data-act="login">Log in</button>' +
        '<button class="btn btn-primary btn-sm" type="button" data-act="signup">Sign up free</button>';
      note.textContent = `Free account includes ${plural(state.cfg.freeSearches, 'search', 'searches')}. Refer friends or buy a plan for more.`;
    }
  }

  // ---------- listings ----------
  const lockIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  function itemHtml(l, full) {
    const chips = l.tags.map((t) => `<li>${esc(t)}</li>`).join('');
    const where = l.address && l.address.toLowerCase().includes(l.area.toLowerCase()) ? l.address : [l.area, l.address].filter(Boolean).join(', ');
    let side;
    if (full) {
      const wa = `https://wa.me/91${encodeURIComponent(l.contactPhone)}?text=${encodeURIComponent(`Hi, I found "${l.title}" on ${state.cfg.siteName}. Is it available?`)}`;
      side = `
        <p class="who">${esc(l.contactName || 'Owner')}</p>
        <a class="btn btn-call btn-sm" href="tel:+91${esc(l.contactPhone)}">Call ${esc(fmtPhone(l.contactPhone))}</a>
        <a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>`;
    } else {
      side = `<p class="locked">${lockIcon}<span>Owner number shows after you search</span></p>`;
    }
    return `
      <article class="item t-${esc(l.type)}">
        <div>
          <p class="kind">${KIND[l.type] || ''}</p>
          <h3>${esc(l.title)}${l.verified ? '<span class="badge">Verified</span>' : ''}</h3>
          <p class="where">${esc(where)}</p>
          ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ''}
          ${chips ? `<ul class="chips">${chips}</ul>` : ''}
        </div>
        <div class="item-side">
          <p class="price"><strong>${inr(l.price)}</strong><span>${UNIT[l.priceUnit] || ''}</span></p>
          ${side}
        </div>
      </article>`;
  }

  function renderResults(list, charged, criteria) {
    const box = $('#results');
    box.hidden = false;
    $('#resultsTitle').textContent = list.length ? plural(list.length, 'result', 'results') + ' in Nagpur' : 'No matches found';
    $('#resultsNote').textContent = list.length
      ? (charged ? '1 search used.' : 'No search used for this one.')
      : 'This search was free. Try fewer words, a bigger budget or all of Nagpur.';
    $('#resultsList').innerHTML = list.length
      ? list.map((l) => itemHtml(l, true)).join('')
      : `<div class="empty"><strong>Nothing matched ${esc(criteria)}</strong><p class="muted">Try a different area or remove the budget limit.</p></div>`;
    box.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  async function runSearch() {
    if (!state.me) {
      state.afterAuth = runSearch;
      openAuth('signup');
      return;
    }
    const form = $('#searchForm');
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const k of ['type', 'q', 'area', 'maxPrice']) params.set(k, String(fd.get(k) || '').trim());
    const btn = $('#goBtn');
    btn.disabled = true;
    btn.textContent = 'Searching';
    try {
      const data = await api('/api/search?' + params.toString());
      state.me = data.me;
      renderHeader();
      const label = [KIND[fd.get('type')], fd.get('q'), fd.get('area')].filter(Boolean).join(', ') || 'your search';
      renderResults(data.results, data.charged, label);
    } catch (e) {
      if (e.status === 401) { state.me = null; renderHeader(); state.afterAuth = runSearch; openAuth('login'); }
      else if (e.status === 402) { await refreshMe(); openPaywall(); }
      else toast(e.data?.message || 'Search failed. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Search';
    }
  }

  async function refreshMe() {
    try { state.me = (await api('/api/me')).user; } catch { /* keep old */ }
    renderHeader();
  }

  // ---------- auth ----------
  function openAuth(mode) {
    const signup = mode === 'signup';
    const ref = localStorage.getItem('ref') || '';
    openDlg(`
      <h2 id="dlgTitle">${signup ? 'Create your free account' : 'Log in'}</h2>
      <p class="muted">${signup
        ? `You get ${plural(state.cfg.freeSearches, 'free search', 'free searches')} straight away.`
        : 'Log in to keep searching.'}</p>
      <form id="authForm" novalidate>
        ${signup ? '<label class="f"><span>Your name</span><input name="name" autocomplete="name" required maxlength="60"></label>' : ''}
        <label class="f"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="f"><span>Password (6 or more characters)</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="6"></label>
        ${signup ? `<label class="f"><span>Friend's referral code (optional)</span><input name="ref" value="${esc(ref)}" maxlength="10" autocapitalize="characters"></label>` : ''}
        <p class="error" id="authErr" role="alert"></p>
        <button class="btn btn-primary wide" type="submit">${signup ? 'Create account' : 'Log in'}</button>
      </form>
      <p class="switch">${signup
        ? 'Already have an account? <button class="link" type="button" data-act="login">Log in</button>'
        : 'New here? <button class="link" type="button" data-act="signup">Create a free account</button>'}</p>`);

    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const err = $('#authErr');
      err.textContent = '';
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const body = { email: f.get('email'), password: f.get('password') };
        if (signup) { body.name = f.get('name'); body.ref = f.get('ref'); }
        const data = await api(signup ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body });
        state.me = data.user;
        if (signup) localStorage.removeItem('ref');
        renderHeader();
        dlg.close();
        toast(signup ? `Welcome, ${data.user.name.split(' ')[0]}. ${plural(data.user.credits, 'search', 'searches')} ready.` : 'Logged in.');
        const next = state.afterAuth;
        state.afterAuth = null;
        if (next) next();
      } catch (er) {
        err.textContent = er.data?.message || 'Something went wrong. Try again.';
        btn.disabled = false;
      }
    });
    setTimeout(() => $('#authForm input')?.focus(), 30);
  }

  // ---------- refer + paywall ----------
  function referLink() { return `${location.origin}/?ref=${state.me.referralCode}`; }

  function referBlock() {
    const me = state.me;
    const c = state.cfg;
    const link = referLink();
    const text = `Find rooms, mess and coaching in Nagpur on ${c.siteName}. Sign up with my link: ${link}`;
    return `
      <p>For every friend who signs up with your link, you get <strong>${plural(c.referralBonus, 'more search', 'more searches')}</strong>.
         ${me.referralsLeft > 0
           ? `${plural(me.referralCount, 'friend has', 'friends have')} joined so far. You can earn from ${plural(me.referralsLeft, 'more friend', 'more friends')}.`
           : 'You have earned the maximum from referrals.'}</p>
      <div class="copy-row">
        <input id="refLink" readonly value="${esc(link)}" aria-label="Your referral link">
        <button class="btn btn-quiet btn-sm" type="button" data-act="copy">Copy</button>
      </div>
      <a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Share on WhatsApp</a>`;
  }

  function planButtons() {
    const c = state.cfg;
    const off = c.paymentsReady ? '' : ' disabled';
    const unl = c.plans.unlimited.days > 0 ? `Unlimited for ${c.plans.unlimited.days} days` : 'Unlimited searches';
    return `
      <button class="plan-btn" type="button" data-act="buy" data-plan="pack"${off}><span>${plural(c.plans.pack.searches, 'search', 'searches')}</span><strong>${inr(c.plans.pack.price)}</strong></button>
      <button class="plan-btn" type="button" data-act="buy" data-plan="unlimited"${off}><span>${unl}</span><strong>${inr(c.plans.unlimited.price)}</strong></button>
      ${c.paymentsReady ? '' : '<p class="muted">Payments are not switched on yet.</p>'}`;
  }

  function openPaywall() {
    if (!state.me) return openAuth('signup');
    openDlg(`
      <h2 id="dlgTitle">You have used all your searches</h2>
      <p class="muted">Get more for free by inviting a friend, or buy a plan.</p>
      <div class="split">
        <section class="opt"><h3>Refer a friend</h3>${referBlock()}</section>
        <section class="opt"><h3>Buy a plan</h3>${planButtons()}</section>
      </div>`);
  }

  function openPlans() {
    openDlg(`
      <h2 id="dlgTitle">Search plans</h2>
      <p class="muted">Choose an option to get more searches. A search with no results is free.</p>
      <div class="opt" style="margin-top:1rem">
        <h3>Search pack</h3>
        <p>${plural(state.cfg.plans.pack.searches, 'search', 'searches')} · no expiry</p>
        <button class="plan-btn" type="button" data-act="buy" data-plan="pack"${state.cfg.paymentsReady ? '' : ' disabled'}>
          <span>Choose search pack</span><strong>${inr(state.cfg.plans.pack.price)}</strong>
        </button>
      </div>
      <div class="opt" style="margin-top:.8rem">
        <h3>Unlimited</h3>
        <p>${state.cfg.plans.unlimited.days > 0
          ? `Unlimited searches for ${state.cfg.plans.unlimited.days} days.`
          : 'Search as much as you want.'}</p>
        <button class="plan-btn" type="button" data-act="buy" data-plan="unlimited"${state.cfg.paymentsReady ? '' : ' disabled'}>
          <span>Choose unlimited</span><strong>${inr(state.cfg.plans.unlimited.price)}</strong>
        </button>
      </div>
      ${state.cfg.paymentsReady ? '' : '<p class="muted" style="margin-top:.8rem">Payments are not switched on yet.</p>'}`);
  }

  function openRefer() {
    if (!state.me) { state.afterAuth = openRefer; return openAuth('signup'); }
    openDlg(`<h2 id="dlgTitle">Refer a friend</h2><div class="opt" style="margin-top:1rem">${referBlock()}</div>`);
  }

  async function copyLink() {
    const input = $('#refLink');
    try { await navigator.clipboard.writeText(input.value); toast('Link copied.'); }
    catch { input.select(); document.execCommand('copy'); toast('Link copied.'); }
  }

  // ---------- payments ----------
  function afterPayment(user) {
    clearPaymentTimers();
    state.me = user;
    renderHeader();
    if (dlg.open) dlg.close();
    toast(user.unlimited ? `Unlimited searches active ${untilText(user.unlimitedUntil)}.` : `Done. You now have ${plural(user.credits, 'search', 'searches')}.`);
  }

  function showPhonePeOrder(order) {
    openDlg(`
      <h2 id="dlgTitle">Pay with PhonePe</h2>
      <p class="muted">${esc(order.label)} · Pay exactly <strong>${inr(order.amount)}</strong></p>
      <div class="phonepe-payment">
        <img class="payment-qr" src="${esc(order.qrImage)}" alt="PhonePe QR code for payment">
        <p class="payment-countdown" id="paymentCountdown" aria-live="polite"></p>
        <p class="payment-instructions">Scan using PhonePe and pay the exact amount shown. Your plan stays locked until an admin verifies the payment.</p>
        <form id="paymentReferenceForm">
          <label class="f"><span>UPI transaction ID / UTR</span><input name="paymentReference" required minlength="6" maxlength="30" pattern="[A-Za-z0-9-]{6,30}" autocomplete="off" aria-describedby="paymentReferenceHelp"></label>
          <p class="muted" id="paymentReferenceHelp">Enter the transaction reference shown in your PhonePe receipt.</p>
          <button class="btn btn-primary wide" id="submitPaymentReference" type="submit">Submit for verification</button>
        </form>
        <p class="payment-status" id="paymentStatus" role="status" aria-live="polite">Complete payment and submit its transaction ID before the timer ends.</p>
      </div>`);

    const form = $('#paymentReferenceForm');
    const submit = $('#submitPaymentReference');
    const status = $('#paymentStatus');
    const countdown = $('#paymentCountdown');
    const updateCountdown = () => {
      const remaining = Math.max(0, order.expiresAt - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      countdown.textContent = remaining
        ? `Payment window: ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
        : 'Payment window expired';
      if (!remaining) {
        clearInterval(paymentCountdownTimer);
        submit.disabled = true;
        status.textContent = 'Time expired. Start a new payment. If you already paid, contact support with your transaction ID.';
      }
    };
    updateCountdown();
    paymentCountdownTimer = setInterval(updateCountdown, 1000);

    const checkOrder = async () => {
      try {
        const result = await api(`/api/pay/order/${order.orderId}`);
        if (result.status === 'paid') {
          afterPayment(result.user);
        } else if (result.status === 'rejected') {
          clearInterval(paymentPollTimer);
          status.textContent = 'Payment could not be verified. Your plan is still locked. Contact support or start a new payment.';
        } else if (result.status === 'expired') {
          clearInterval(paymentPollTimer);
          status.textContent = 'This payment order expired. No plan was activated. Start a new payment.';
        }
      } catch {
        status.textContent = 'Could not check payment status. We will try again.';
      }
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      status.textContent = 'Submitting transaction reference…';
      try {
        await api('/api/pay/submit', {
          method: 'POST',
          body: { orderId: order.orderId, paymentReference: new FormData(form).get('paymentReference') },
        });
        clearInterval(paymentCountdownTimer);
        form.hidden = true;
        countdown.textContent = 'Payment submitted';
        status.textContent = 'Verification pending. Your plan will unlock only after an admin confirms the payment.';
        await checkOrder();
        if (dlg.open && !paymentPollTimer) paymentPollTimer = setInterval(checkOrder, 3000);
      } catch (err) {
        status.textContent = err.data?.message || 'Could not submit the transaction reference. Try again.';
        submit.disabled = false;
        if (err.status === 410) {
          form.hidden = true;
          updateCountdown();
        }
      }
    });
  }

  async function buy(planId) {
    if (!state.me) { state.afterAuth = () => buy(planId); return openAuth('signup'); }
    let order;
    try {
      order = await api('/api/pay/create', { method: 'POST', body: { plan: planId } });
    } catch (e) { return toast(e.data?.message || 'Could not start the payment.'); }

    showPhonePeOrder(order);
  }

  // ---------- static sections ----------
  async function renderFeatured() {
    try {
      const { listings, counts } = await api('/api/featured');
      $('#counts').textContent = `${counts.room} rooms and PGs, ${counts.mess} mess and tiffin services, ${counts.institute} institutes. Search to see owner numbers.`;
      $('#featuredList').innerHTML = listings.length
        ? listings.map((l) => itemHtml(l, false)).join('')
        : '<div class="empty"><strong>No listings yet</strong><p class="muted">Listings will appear here once an admin adds them.</p></div>';
    } catch { $('#featuredList').innerHTML = ''; }
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'terms') { e.preventDefault(); openTerms(); }
    else if (act === 'login') openAuth('login');
    else if (act === 'signup') openAuth('signup');
    else if (act === 'refer') openRefer();
    else if (act === 'plans') openPlans();
    else if (act === 'copy') copyLink();
    else if (act === 'buy') buy(el.dataset.plan);
    else if (act === 'logout') {
      await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      state.me = null;
      $('#results').hidden = true;
      renderHeader();
      toast('Logged out.');
    }
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });

  // ---------- start ----------
  async function init() {
    const [cfg, me] = await Promise.all([api('/api/config'), api('/api/me')]);
    state.cfg = cfg;
    state.me = me.user;
    $('.brand-name').textContent = cfg.siteName;
    document.title = `${cfg.siteName} | Rooms, mess and coaching in Nagpur`;
    $('#areaSelect').insertAdjacentHTML('beforeend', cfg.areas.map((a) => `<option>${esc(a)}</option>`).join(''));
    renderHeader();
    renderFeatured();
    $('#copyrightYear').textContent = new Date().getFullYear();

    const ref = (new URLSearchParams(location.search).get('ref') || '').toUpperCase();
    if (/^[A-Z0-9]{4,10}$/.test(ref)) {
      localStorage.setItem('ref', ref);
      history.replaceState(null, '', location.pathname);
      if (!state.me) setTimeout(() => openAuth('signup'), 400);
    }
  }
  init().catch(() => toast('Could not load the site. Refresh the page.'));
})();
