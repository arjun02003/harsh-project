'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no extra dependency)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  siteName: process.env.SITE_NAME || 'Nagpur Nest',
  port: num('PORT', 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, 'data', 'app.db'),
  isProd,

  // Search rules
  freeSearches: num('FREE_SEARCHES', 1),          // given at signup
  referralBonus: num('REFERRAL_BONUS', 4),        // searches the referrer gets per friend who signs up
  maxReferralRewards: num('MAX_REFERRAL_REWARDS', 5), // max friends that earn rewards (stops fake-account farming)
  repeatFreeMinutes: 10,                          // same search again within this time is not charged
  sessionDays: 30,

  // Paid plans
  plans: {
    pack: {
      id: 'pack',
      label: '25 searches',
      price: num('PACK_PRICE', 49),
      searches: num('PACK_SEARCHES', 25),
    },
    unlimited: {
      id: 'unlimited',
      label: 'Unlimited searches',
      price: num('UNLIMITED_PRICE', 99),
      days: num('UNLIMITED_DAYS', 30),            // 0 = lifetime
    },
  },

  phonepe: {
    qrImage: '/phonepe-qr.png',
    orderWindowMs: 5 * 60 * 1000,
  },

  areas: [
    'Bajaj Nagar', 'Besa', 'Civil Lines', 'Dharampeth', 'Gittikhadan', 'Hingna',
    'Itwari', 'Jaitala', 'Khamla', 'Laxmi Nagar', 'Mahal', 'Manish Nagar',
    'Manewada', 'Medical Square', 'Narendra Nagar', 'Nandanvan', 'Pratap Nagar',
    'Ramdaspeth', 'Sadar', 'Sakkardara', 'Sitabuldi', 'Somalwada',
    'Trimurti Nagar', 'Wadi', 'Wardha Road',
  ],
  types: ['room', 'mess', 'institute'],
};
