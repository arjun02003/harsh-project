'use strict';
const { db } = require('../db');

const r = db.prepare('DELETE FROM listings WHERE is_sample = 1').run();
console.log(`Deleted ${r.changes} sample listings.`);
