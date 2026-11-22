'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cfg = require('./config');
const { db, tx, insertListing } = require('./db');

const app = express();
app.disable('x-powered-by');
if (cfg.isProd) app.set('trust proxy', 1);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (res, status, code, message) => res.status(status).json({ error: code, message });

// ---------- helpers ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  let s = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) s += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return s;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
    }
  });
  return out;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + cfg.sessionDays * 86400000;
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(sha(token), userId, expires);
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'lax', secure: cfg.isProd, path: '/', maxAge: cfg.sessionDays * 86400000,
  });
}

function summary(u) {
  const now = Date.now();
  const refCount = db.prepare('SELECT COUNT(*) c FROM referrals WHERE referrer_id = ?').get(u.id).c;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    credits: u.credits,
    unlimited: !!(u.unlimited_until && u.unlimited_until > now),
    unlimitedUntil: u.unlimited_until || null,
    referralCode: u.referral_code,
    referralCount: refCount,
    referralsLeft: Math.max(0, cfg.maxReferralRewards - refCount),
    isAdmin: !!u.is_admin,
  };
}

function listingOut(l, withContact) {
  const out = {
    id: l.id,
    type: l.type,
    title: l.title,
    area: l.area,
    address: l.address,
    price: l.price,
    priceUnit: l.price_unit,
    tags: l.tags ? l.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    description: l.description,
    verified: !!l.verified,
  };
  if (withContact) {
    out.contactName = l.contact_name;
    out.contactPhone = l.contact_phone;
  }
  return out;
}

// simple in-memory rate limiter
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return fail(res, 429, 'TOO_MANY_REQUESTS', 'Too many attempts. Wait a few minutes and try again.');
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) if (!arr.some((t) => now - t < 3600000)) hits.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}, 600000).unref();

// ---------- middleware ----------
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
// Block cross-site form/script posts
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.get('origin');
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.get('host'); } catch { ok = false; }
      if (!ok) return fail(res, 403, 'BAD_ORIGIN', 'Request blocked.');
    }
  }
  next();
});
app.use((req, res, next) => {
  req.user = null;
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) {
    const row = db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
    ).get(sha(sid), Date.now());
    if (row) req.user = row;
  }
  next();
});
const requireAuth = (req, res, next) =>
  req.user ? next() : fail(res, 401, 'LOGIN_REQUIRED', 'Log in to continue.');
const requireAdmin = (req, res, next) =>
  req.user && req.user.is_admin ? next() : fail(res, 403, 'ADMIN_ONLY', 'Admin access only.');

// ---------- public info ----------
app.get('/api/config', (req, res) => {
  res.json({
    siteName: cfg.siteName,
    areas: cfg.areas,
    freeSearches: cfg.freeSearches,
    referralBonus: cfg.referralBonus,
    maxReferralRewards: cfg.maxReferralRewards,
    plans: cfg.plans,
    paymentsReady: true,
  });
});

app.get('/api/featured', (req, res) => {
  const rows = db.prepare('SELECT * FROM listings WHERE active = 1 ORDER BY verified DESC, id DESC').all();
  const out = [];
  for (const type of cfg.types) {
    rows.filter((r) => r.type === type).slice(0, 2).forEach((r) => out.push(listingOut(r, false)));
  }
  const counts = {};
  for (const type of cfg.types) {
    counts[type] = db.prepare('SELECT COUNT(*) c FROM listings WHERE active = 1 AND type = ?').get(type).c;
  }
  res.json({ listings: out, counts });
});

// ---------- auth ----------
app.post('/api/auth/signup', limit(10, 10 * 60000), (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const ref = String(body.ref || '').trim().toUpperCase();

  if (name.length < 2 || name.length > 60) return fail(res, 400, 'NAME_INVALID', 'Enter your name (2 to 60 letters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return fail(res, 400, 'EMAIL_INVALID', 'Enter a valid email address.');
  if (password.length < 6 || password.length > 100) return fail(res, 400, 'PASSWORD_INVALID', 'Password must be at least 6 characters.');

  let user;
  try {
    user = tx(() => {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw new HttpError(409, 'EMAIL_TAKEN', 'This email already has an account. Log in instead.');
      }
      const { salt, hash } = hashPassword(password);
      let code;
      do { code = genCode(); } while (db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code));

      const referrer = ref ? db.prepare('SELECT * FROM users WHERE referral_code = ?').get(ref) : null;
      const r = db.prepare(
        'INSERT INTO users(name,email,pass_hash,pass_salt,referral_code,referred_by,credits,created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(name, email, hash, salt, code, referrer ? referrer.id : null, cfg.freeSearches, Date.now());
      const id = Number(r.lastInsertRowid);

      if (referrer) {
        const done = db.prepare('SELECT COUNT(*) c FROM referrals WHERE referrer_id = ?').get(referrer.id).c;
        if (done < cfg.maxReferralRewards) {
          db.prepare('INSERT INTO referrals(referrer_id,referred_id,created_at) VALUES (?,?,?)').run(referrer.id, id, Date.now());
          db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(cfg.referralBonus, referrer.id);
        }
      }
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(res, err.status, err.code, err.message);
    throw err;
  }
  startSession(res, user.id);
  res.json({ user: summary(user) });
});

app.post('/api/auth/login', limit(15, 10 * 60000), (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !checkPassword(password, u.pass_salt, u.pass_hash)) {
    return fail(res, 401, 'BAD_LOGIN', 'Email or password is wrong.');
  }
  startSession(res, u.id);
  res.json({ user: summary(u) });
});

app.post('/api/auth/logout', (req, res) => {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(sid));
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? summary(req.user) : null });
});

// ---------- search (this is what uses up searches) ----------
app.get('/api/search', requireAuth, (req, res) => {
  const u = req.user;
  const now = Date.now();
  const type = cfg.types.includes(req.query.type) ? req.query.type : '';
  const area = cfg.areas.includes(req.query.area) ? req.query.area : '';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const maxPrice = Math.max(0, parseInt(req.query.maxPrice, 10) || 0);

  const unlimited = !!(u.unlimited_until && u.unlimited_until > now);
  const key = [type, area, q.toLowerCase(), maxPrice].join('|');
  const repeat = db.prepare(
    'SELECT 1 FROM searches WHERE user_id = ? AND key = ? AND charged = 1 AND created_at > ?'
  ).get(u.id, key, now - cfg.repeatFreeMinutes * 60000);

  const noSearches = () =>
    fail(res, 402, 'NO_SEARCHES_LEFT', 'You have used all your searches. Refer a friend or buy a plan to continue.');
  if (!unlimited && !repeat && u.credits <= 0) return noSearches();

  const where = ['active = 1'];
  const params = [];
  if (type) { where.push('type = ?'); params.push(type); }
  if (area) { where.push('area = ?'); params.push(area); }
  if (maxPrice) { where.push('price <= ?'); params.push(maxPrice); }
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    where.push(
      "(lower(title) || ' ' || lower(area) || ' ' || lower(address) || ' ' || lower(tags) || ' ' || lower(description) || ' ' || type) LIKE ? ESCAPE '\\'"
    );
    params.push('%' + w.replace(/[\\%_]/g, '\\$&') + '%');
  }
  const rows = db.prepare(
    `SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY verified DESC, price ASC LIMIT 40`
  ).all(...params);

  // A search that finds nothing is free.
  let charged = false;
  if (rows.length && !unlimited && !repeat) {
    const r = db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0').run(u.id);
    if (!r.changes) return noSearches();
    charged = true;
  }
  db.prepare('INSERT INTO searches(user_id,key,query,charged,created_at) VALUES (?,?,?,?,?)')
    .run(u.id, key, q, charged ? 1 : 0, now);

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  res.json({ results: rows.map((r) => listingOut(r, true)), charged, me: summary(fresh) });
});

// ---------- payments ----------
function applyPlan(userId, planId) {
  const plan = cfg.plans[planId];
  if (plan.searches) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(plan.searches, userId);
  }
  if (plan.days !== undefined) {
    const u = db.prepare('SELECT unlimited_until FROM users WHERE id = ?').get(userId);
    const base = Math.max(Date.now(), u.unlimited_until || 0);
    const until = plan.days > 0 ? base + plan.days * 86400000 : 4102444800000; // 0 days = lifetime (year 2100)
    db.prepare('UPDATE users SET unlimited_until = ? WHERE id = ?').run(until, userId);
  }
}

// Marks an order paid and gives the plan. Safe to call twice: the second call does nothing.
function completeOrder(orderId, paymentId, requiredStatus = 'created') {
  return tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ? AND status = ?').get(orderId, requiredStatus);
    if (!o) return false;
    db.prepare("UPDATE orders SET status = 'paid', rzp_payment_id = ?, paid_at = ? WHERE id = ?")
      .run(paymentId, Date.now(), orderId);
    applyPlan(o.user_id, o.plan);
    return true;
  });
}

app.post('/api/pay/create', requireAuth, limit(20, 10 * 60000), async (req, res) => {
  const plan = cfg.plans[String((req.body || {}).plan || '')];
  if (!plan) return fail(res, 400, 'PLAN_INVALID', 'Unknown plan.');
  const now = Date.now();
  db.prepare("UPDATE orders SET status = 'expired' WHERE user_id = ? AND status = 'created' AND expires_at <= ?")
    .run(req.user.id, now);
  const expiresAt = now + cfg.phonepe.orderWindowMs;
  const r = db.prepare('INSERT INTO orders(user_id,plan,amount,created_at,expires_at) VALUES (?,?,?,?,?)')
    .run(req.user.id, plan.id, plan.price, now, expiresAt);
  const orderId = Number(r.lastInsertRowid);
  res.json({
    mode: 'phonepe', orderId, amount: plan.price, label: plan.label,
    qrImage: cfg.phonepe.qrImage, expiresAt,
  });
});

app.post('/api/pay/submit', requireAuth, (req, res) => {
  const orderId = parseInt((req.body || {}).orderId, 10);
  const reference = String((req.body || {}).paymentReference || '').trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{6,30}$/.test(reference)) {
    return fail(res, 400, 'REFERENCE_INVALID', 'Enter a valid UPI transaction reference (6 to 30 letters or numbers).');
  }
  const now = Date.now();
  const result = tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);
    if (!order) return { error: [404, 'ORDER_NOT_FOUND', 'Payment order not found.'] };
    if (order.status !== 'created') return { error: [409, 'ORDER_NOT_OPEN', 'This payment order is no longer open.'] };
    if (!order.expires_at || order.expires_at <= now) {
      db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'created'").run(orderId);
      return { error: [410, 'ORDER_EXPIRED', 'The 5-minute payment window has expired. Start a new payment.'] };
    }
    if (db.prepare('SELECT 1 FROM orders WHERE payment_reference = ?').get(reference)) {
      return { error: [409, 'REFERENCE_USED', 'This transaction reference has already been submitted.'] };
    }
    db.prepare("UPDATE orders SET status = 'submitted', payment_reference = ?, payment_submitted_at = ? WHERE id = ? AND status = 'created'")
      .run(reference, now, orderId);
    return { status: 'submitted' };
  });
  if (result.error) return fail(res, result.error[0], result.error[1], result.error[2]);
  res.json(result);
});

app.get('/api/pay/order/:id', requireAuth, (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  let order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);
  if (!order) return fail(res, 404, 'ORDER_NOT_FOUND', 'Payment order not found.');
  if (order.status === 'created' && order.expires_at <= Date.now()) {
    db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'created'").run(orderId);
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  }
  const response = { status: order.status, expiresAt: order.expires_at };
  if (order.status === 'paid') {
    response.user = summary(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id));
  }
  res.json(response);
});

// ---------- admin ----------
function readListing(body) {
  const b = body || {};
  const type = String(b.type || '');
  const title = String(b.title || '').trim();
  const area = String(b.area || '');
  const phone = String(b.contactPhone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!cfg.types.includes(type)) throw new HttpError(400, 'TYPE_INVALID', 'Pick room, mess or institute.');
  if (title.length < 3 || title.length > 100) throw new HttpError(400, 'TITLE_INVALID', 'Title must be 3 to 100 characters.');
  if (!cfg.areas.includes(area)) throw new HttpError(400, 'AREA_INVALID', 'Pick an area from the list.');
  if (!/^\d{10}$/.test(phone)) throw new HttpError(400, 'PHONE_INVALID', 'Enter a 10 digit mobile number.');
  const unit = ['month', 'year', 'course', 'day'].includes(b.priceUnit) ? b.priceUnit : 'month';
  return {
    type, title, area,
    address: String(b.address || '').trim().slice(0, 160),
    price: Math.max(0, parseInt(b.price, 10) || 0),
    priceUnit: unit,
    tags: String(b.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10).join(','),
    description: String(b.description || '').trim().slice(0, 500),
    contactName: String(b.contactName || '').trim().slice(0, 60),
    contactPhone: phone,
    verified: !!b.verified,
  };
}

app.get('/api/admin/listings', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM listings ORDER BY id DESC').all();
  res.json({
    listings: rows.map((r) => ({ ...listingOut(r, true), active: !!r.active, isSample: !!r.is_sample })),
  });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT o.id, o.user_id AS userId, u.name, u.email, o.plan, o.amount,
      o.status, o.payment_reference AS paymentReference,
      o.payment_submitted_at AS submittedAt, o.created_at AS createdAt
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.status = 'submitted'
    ORDER BY o.payment_submitted_at ASC
  `).all();
  res.json({ orders });
});

app.post('/api/admin/orders/:id/verify', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'submitted'").get(id);
  if (!order || !order.payment_reference) return fail(res, 404, 'ORDER_NOT_PENDING', 'Submitted payment was not found.');
  if (!completeOrder(id, `phonepe:${order.payment_reference}`, 'submitted')) {
    return fail(res, 409, 'ORDER_NOT_PENDING', 'This payment is no longer pending verification.');
  }
  res.json({ ok: true });
});

app.post('/api/admin/orders/:id/reject', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = db.prepare("UPDATE orders SET status = 'rejected' WHERE id = ? AND status = 'submitted'").run(id);
  if (!result.changes) return fail(res, 404, 'ORDER_NOT_PENDING', 'Submitted payment was not found.');
  res.json({ ok: true });
});

app.post('/api/admin/listings', requireAdmin, (req, res) => {
  try {
    const r = insertListing(readListing(req.body));
    res.json({ id: Number(r.lastInsertRowid) });
  } catch (err) {
    if (err instanceof HttpError) return fail(res, err.status, err.code, err.message);
    throw err;
  }
});

app.patch('/api/admin/listings/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  if (typeof b.verified === 'boolean') db.prepare('UPDATE listings SET verified = ? WHERE id = ?').run(b.verified ? 1 : 0, id);
  if (typeof b.active === 'boolean') db.prepare('UPDATE listings SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
  res.json({ ok: true });
});

app.delete('/api/admin/listings/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM listings WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.delete('/api/admin/samples', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM listings WHERE is_sample = 1').run();
  res.json({ deleted: r.changes });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    users: one('SELECT COUNT(*) c FROM users').c,
    listings: one('SELECT COUNT(*) c FROM listings WHERE active = 1').c,
    searches: one('SELECT COUNT(*) c FROM searches').c,
    paidOrders: one("SELECT COUNT(*) c FROM orders WHERE status = 'paid' AND rzp_payment_id != 'demo'").c,
    revenue: one("SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status = 'paid' AND rzp_payment_id != 'demo'").s,
    demoOrders: one("SELECT COUNT(*) c FROM orders WHERE status = 'paid' AND rzp_payment_id = 'demo'").c,
  });
});

// ---------- static + errors ----------
app.use('/api', (req, res) => fail(res, 404, 'NOT_FOUND', 'Not found.'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status && err.status < 500) return fail(res, err.status, 'BAD_REQUEST', 'Bad request.');
  console.error(err);
  fail(res, 500, 'SERVER_ERROR', 'Something went wrong. Try again.');
});

app.listen(cfg.port, () => {
  console.log(`${cfg.siteName} running on http://localhost:${cfg.port}`);
  console.log('Payments: PhonePe QR (admin verification required)');
});
