(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const root = $('#adminRoot');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { room: 'Room / PG', mess: 'Mess / Tiffin', institute: 'Institute' };

  async function api(url, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
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
    toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  async function load() {
    const [cfg, me] = await Promise.all([api('/api/config'), api('/api/me')]);
    if (!me.user || !me.user.isAdmin) {
      renderAdminLogin(me.user);
      return;
    }
    const [stats, list, orders] = await Promise.all([
      api('/api/admin/stats'), api('/api/admin/listings'), api('/api/admin/orders'),
    ]);
    render(cfg, stats, list.listings, orders.orders);
  }

  function renderAdminLogin(user) {
    root.innerHTML = `
      <section class="admin-access">
        <p class="admin-access-kicker">Nagpur Nest · Admin</p>
        <h1>Admin sign in</h1>
        <p class="muted admin-access-copy">${user
          ? `You are signed in as ${esc(user.email)}, which does not have admin access. Sign in with your admin email to continue.`
          : 'Sign in with the email and password of your admin account to manage the website.'}</p>
        <form id="adminLoginForm" class="admin-login-form">
          <label class="f"><span>Admin email</span><input name="email" type="email" autocomplete="username" required></label>
          <label class="f"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
          <p class="error" id="adminLoginError" role="alert"></p>
          <button class="btn btn-primary" type="submit">Sign in to admin</button>
        </form>
        <p class="admin-access-help">Admin access is tied to your account and stays available when you sign in again.</p>
      </section>`;

    $('#adminLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const error = $('#adminLoginError');
      const fields = Object.fromEntries(new FormData(form));
      error.textContent = '';
      button.disabled = true;
      button.textContent = 'Signing in…';
      try {
        const result = await api('/api/auth/login', { method: 'POST', body: fields });
        if (!result.user.isAdmin) {
          error.textContent = 'This account does not have admin access. Use your admin email.';
          return;
        }
        await load();
      } catch (err) {
        error.textContent = err.data?.message || 'Could not sign in. Please try again.';
      } finally {
        button.disabled = false;
        button.textContent = 'Sign in to admin';
      }
    });
  }

  function render(cfg, s, listings, orders) {
    const hasSamples = listings.some((l) => l.isSample);
    root.innerHTML = `
      <h2>Dashboard</h2>
      <div class="stats">
        <div class="stat"><strong>${s.users}</strong><span>Users</span></div>
        <div class="stat"><strong>${s.listings}</strong><span>Live listings</span></div>
        <div class="stat"><strong>${s.searches}</strong><span>Searches done</span></div>
        <div class="stat"><strong>${s.paidOrders}</strong><span>Paid orders</span></div>
        <div class="stat"><strong>₹${Number(s.revenue).toLocaleString('en-IN')}</strong><span>Revenue</span></div>
      </div>

      <section class="admin-payments" aria-labelledby="pendingPaymentsTitle">
        <h2 id="pendingPaymentsTitle">PhonePe payments awaiting verification (${orders.length})</h2>
        <p class="muted">Check your PhonePe/bank record and confirm the exact amount before approving. Approving activates the selected plan.</p>
        ${orders.length ? `<div class="table-wrap"><table>
          <thead><tr><th>User</th><th>Plan</th><th>Amount</th><th>Transaction ID / UTR</th><th>Submitted</th><th>Actions</th></tr></thead>
          <tbody>${orders.map((o) => `
            <tr>
              <td>${esc(o.name)}<br><span class="muted">${esc(o.email)}</span></td>
              <td>${esc(o.plan)}</td>
              <td>₹${Number(o.amount).toLocaleString('en-IN')}</td>
              <td><code>${esc(o.paymentReference)}</code></td>
              <td>${new Date(o.submittedAt).toLocaleString('en-IN')}</td>
              <td><div class="row-actions">
                <button class="btn btn-primary btn-sm" type="button" data-verify-order="${o.id}">Approve</button>
                <button class="btn btn-danger btn-sm" type="button" data-reject-order="${o.id}">Reject</button>
              </div></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty admin-payment-empty">No submitted payments are waiting for review.</p>'}
      </section>

      <h2 style="margin-top:1.8rem">Add a listing</h2>
      <form id="addForm" class="admin-form" style="margin-top:1rem">
        <label class="f"><span>Type</span><select name="type" required>
          <option value="room">Room / PG</option><option value="mess">Mess / Tiffin</option><option value="institute">Institute</option></select></label>
        <label class="f span2"><span>Name</span><input name="title" required maxlength="100"></label>
        <label class="f"><span>Area</span><select name="area" required>${cfg.areas.map((a) => `<option>${esc(a)}</option>`).join('')}</select></label>
        <label class="f span2"><span>Address or landmark</span><input name="address" maxlength="160"></label>
        <label class="f"><span>Price (₹)</span><input name="price" type="number" min="0" step="50" required></label>
        <label class="f"><span>Per</span><select name="priceUnit"><option value="month">month</option><option value="year">year</option><option value="course">course</option><option value="day">day</option></select></label>
        <label class="f"><span>Contact name</span><input name="contactName" maxlength="60"></label>
        <label class="f"><span>Mobile (10 digits)</span><input name="contactPhone" inputmode="numeric" maxlength="14" required></label>
        <label class="f span2"><span>Tags (comma separated)</span><input name="tags" placeholder="Girls, PG, WiFi, Meals included"></label>
        <label class="f span2"><span>Description</span><textarea name="description" maxlength="500"></textarea></label>
        <label class="f"><span>Verified?</span><select name="verified"><option value="">No</option><option value="1">Yes, I checked it</option></select></label>
        <div><button class="btn btn-primary" type="submit">Add listing</button></div>
        <p class="error span2" id="addErr" role="alert"></p>
      </form>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-top:2rem">
        <h2>All listings (${listings.length})</h2>
        ${hasSamples ? '<button class="btn btn-danger btn-sm" type="button" id="clearSamples">Delete all sample listings</button>' : ''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Type</th><th>Area</th><th>Price</th><th>Phone</th><th>Verified</th><th>Live</th><th></th></tr></thead>
        <tbody>${listings.map((l) => `
          <tr data-id="${l.id}">
            <td>${esc(l.title)}${l.isSample ? ' <span class="muted">(sample)</span>' : ''}</td>
            <td>${KIND[l.type]}</td><td>${esc(l.area)}</td>
            <td>₹${Number(l.price).toLocaleString('en-IN')}/${esc(l.priceUnit)}</td>
            <td>${esc(l.contactPhone)}</td>
            <td><input type="checkbox" data-field="verified" ${l.verified ? 'checked' : ''} aria-label="Verified"></td>
            <td><input type="checkbox" data-field="active" ${l.active ? 'checked' : ''} aria-label="Live on site"></td>
            <td><button class="btn btn-danger btn-sm" type="button" data-del="${l.id}">Delete</button></td>
          </tr>`).join('')}</tbody>
      </table></div>`;

    root.querySelectorAll('[data-verify-order]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Verify that the exact amount was received for this transaction, then activate the plan?')) return;
      button.disabled = true;
      try {
        await api(`/api/admin/orders/${button.dataset.verifyOrder}/verify`, { method: 'POST', body: {} });
        toast('Payment verified. Plan activated.');
        load();
      } catch (err) {
        toast(err.data?.message || 'Could not verify this payment.');
        button.disabled = false;
      }
    }));

    root.querySelectorAll('[data-reject-order]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Reject this payment? The plan will not be activated.')) return;
      button.disabled = true;
      try {
        await api(`/api/admin/orders/${button.dataset.rejectOrder}/reject`, { method: 'POST', body: {} });
        toast('Payment rejected. No plan was activated.');
        load();
      } catch (err) {
        toast(err.data?.message || 'Could not reject this payment.');
        button.disabled = false;
      }
    }));

    $('#addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.verified = !!f.verified;
      $('#addErr').textContent = '';
      try { await api('/api/admin/listings', { method: 'POST', body: f }); toast('Listing added.'); load(); }
      catch (er) { $('#addErr').textContent = er.data?.message || 'Could not add the listing.'; }
    });

    root.querySelectorAll('input[data-field]').forEach((cb) => cb.addEventListener('change', async () => {
      const id = cb.closest('tr').dataset.id;
      try { await api(`/api/admin/listings/${id}`, { method: 'PATCH', body: { [cb.dataset.field]: cb.checked } }); toast('Saved.'); }
      catch { toast('Could not save.'); cb.checked = !cb.checked; }
    }));

    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this listing for good?')) return;
      await api(`/api/admin/listings/${b.dataset.del}`, { method: 'DELETE' });
      toast('Deleted.');
      load();
    }));

    const clear = $('#clearSamples');
    if (clear) clear.addEventListener('click', async () => {
      if (!confirm('Delete every sample listing? Your own listings stay.')) return;
      const r = await api('/api/admin/samples', { method: 'DELETE' });
      toast(`Deleted ${r.deleted} sample listings.`);
      load();
    });
  }

  load().catch(() => { root.innerHTML = '<p class="error">Could not load the admin page. Refresh and try again.</p>'; });
})();
