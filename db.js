'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new DatabaseSync(cfg.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  credits INTEGER NOT NULL DEFAULT 0,
  unlimited_until INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('room','mess','institute')),
  title TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  price_unit TEXT NOT NULL DEFAULT 'month',
  tags TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_type_area ON listings(type, area, active);
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  charged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_searches_user_key ON searches(user_id, key, created_at);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  rzp_order_id TEXT,
  rzp_payment_id TEXT,
  payment_reference TEXT,
  payment_submitted_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
`);

const orderColumns = new Set(db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name));
if (!orderColumns.has('payment_reference')) db.exec('ALTER TABLE orders ADD COLUMN payment_reference TEXT');
if (!orderColumns.has('payment_submitted_at')) db.exec('ALTER TABLE orders ADD COLUMN payment_submitted_at INTEGER');
if (!orderColumns.has('expires_at')) db.exec('ALTER TABLE orders ADD COLUMN expires_at INTEGER');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_reference ON orders(payment_reference) WHERE payment_reference IS NOT NULL");

// Run fn inside a transaction
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function insertListing(l) {
  return db.prepare(`INSERT INTO listings
    (type,title,area,address,price,price_unit,tags,description,contact_name,contact_phone,verified,active,is_sample,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    l.type, l.title, l.area, l.address || '', l.price || 0, l.priceUnit || 'month', l.tags || '',
    l.description || '', l.contactName || '', l.contactPhone || '', l.verified ? 1 : 0,
    l.active === 0 ? 0 : 1, l.isSample ? 1 : 0, Date.now());
}

// Fill the site with sample listings the very first time (empty table, never seeded before)
function seedIfEmpty() {
  if (process.env.NO_SEED === '1') return;
  const count = db.prepare('SELECT COUNT(*) c FROM listings').get().c;
  if (count > 0) return;
  const rows = require('./seed-data');
  tx(() => {
    for (const r of rows) {
      insertListing({
        type: r[0], title: r[1], area: r[2], address: r[3], price: r[4], priceUnit: r[5],
        tags: r[6], description: r[7], contactName: r[8], contactPhone: r[9],
        verified: 0, isSample: 1,
      });
    }
  });
  console.log(`Added ${rows.length} sample listings. Remove them with: npm run clear-samples`);
}
seedIfEmpty();

module.exports = { db, tx, insertListing };
