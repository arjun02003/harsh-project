'use strict';
// Usage: npm run make-admin -- you@example.com
// Sign up on the site first, then run this to turn that account into an admin.
const { db } = require('../db');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin -- you@example.com');
  process.exit(1);
}
const r = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
if (!r.changes) {
  console.error(`No account found for ${email}. Sign up on the site first.`);
  process.exit(1);
}
console.log(`${email} is now an admin. Open /admin to manage listings.`);
