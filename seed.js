'use strict';
/**
 * Seed realistic placeholder data for GENX TAKEOVER Expense System
 * Run: DATABASE_URL="..." node seed.js
 */
const { neon } = require('@neondatabase/serverless');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dbUrl = (process.env.DATABASE_URL || '').replace(/[&?]channel_binding=[^&]*/g, '');
if (!dbUrl) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }
const sql = neon(dbUrl);

const HASH = bcrypt.hashSync('admin', 10);

// ─── Users ─────────────────────────────────────────────────────────────────

const users = [
  { id: uuidv4(), username: 'admin',          email: 'admin@genxtakeover.com',         role: 'superadmin', name: 'Tour Director' },
  { id: uuidv4(), username: 'sherri_dindal',  email: 'therealslimsherri@gmail.com',    role: 'admin',      name: 'Sherri Dindal' },
  { id: uuidv4(), username: 'jon_wellington', email: 'jon.wellington@genxtour.com',    role: 'admin',      name: 'Jon Wellington' },
  { id: uuidv4(), username: 'kelly_manno',    email: 'kelly.manno@genxtour.com',       role: 'user',       name: 'Kelly Manno' },
  { id: uuidv4(), username: 'nick_harrison',  email: 'nick.harrison@genxtour.com',     role: 'user',       name: 'Nick Harrison' },
  { id: uuidv4(), username: 'reuben_buck',    email: 'reuben.buck@genxtour.com',       role: 'user',       name: 'Reuben Buck' },
  { id: uuidv4(), username: 'joyce_cene',     email: 'joyce.cene@genxtour.com',        role: 'user',       name: 'Joyce Cene' },
  { id: uuidv4(), username: 'justin_rupple',  email: 'justin.rupple@genxtour.com',     role: 'user',       name: 'Justin Rupple' },
  { id: uuidv4(), username: 'steven_bailey',  email: 'steven.bailey@genxtour.com',     role: 'user',       name: 'Steven Bailey' },
];

const tourStops = [
  { city: 'Atlanta, GA',         date: '2025-03-08' },
  { city: 'Houston, TX',         date: '2025-03-15' },
  { city: 'Chicago, IL',         date: '2025-03-22' },
  { city: 'Miami, FL',           date: '2025-03-29' },
  { city: 'New York, NY',        date: '2025-04-05' },
  { city: 'Los Angeles, CA',     date: '2025-04-12' },
  { city: 'Dallas, TX',          date: '2025-04-19' },
  { city: 'Las Vegas, NV',       date: '2025-04-26' },
  { city: 'Charlotte, NC',       date: '2025-05-03' },
  { city: 'Washington, DC',      date: '2025-05-10' },
];

const expenseTemplates = {
  'Airfare':            [{ vendor: 'Delta Air Lines', amounts: [312,387,445] }, { vendor: 'American Airlines', amounts: [298,421,365] }],
  'Hotel/Lodging':      [{ vendor: 'Marriott Hotels', amounts: [189,212,245] }, { vendor: 'Hilton Garden Inn', amounts: [165,198,222] }],
  'Transportation/Gas': [{ vendor: 'Uber / Lyft', amounts: [18.50,24.00,31.75] }, { vendor: 'Enterprise Rent-A-Car', amounts: [89,112,145] }],
  'Food & Beverage':    [{ vendor: 'Cheesecake Factory', amounts: [87.50,124.00,98.75] }, { vendor: "Ruth's Chris Steak House", amounts: [187,234,156] }],
  'Parking':            [{ vendor: 'Venue Parking Garage', amounts: [35,45,55] }],
  'Equipment Rental':   [{ vendor: 'Guitar Center Rentals', amounts: [125,200,175] }],
  'Office Supplies':    [{ vendor: 'FedEx Office', amounts: [34,28,45] }],
  'Marketing/Promotion':[{ vendor: 'Facebook Ads', amounts: [200,150,300] }],
  'Wardrobe/Costumes':  [{ vendor: 'Nordstrom', amounts: [189,245,312] }],
  'Miscellaneous':      [{ vendor: 'CVS Pharmacy', amounts: [23.40,18.60,31.20] }],
};

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomExpenses(count = 4) {
  const cats = Object.keys(expenseTemplates);
  const picked = [], used = new Set();
  let tries = 0;
  while (picked.length < count && tries < 30) {
    tries++;
    const cat = pickRandom(cats);
    if (used.has(cat) && count <= cats.length) continue;
    used.add(cat);
    const tpl = pickRandom(expenseTemplates[cat]);
    picked.push({ vendor: tpl.vendor, purpose: cat, amount: pickRandom(tpl.amounts) });
  }
  return picked;
}

const reportDefs = [
  { userIdx: 3, stopIdx: 0, status: 'approved',  daysBack: 25, expCount: 5 },
  { userIdx: 4, stopIdx: 0, status: 'approved',  daysBack: 25, expCount: 4 },
  { userIdx: 5, stopIdx: 0, status: 'approved',  daysBack: 25, expCount: 3 },
  { userIdx: 6, stopIdx: 0, status: 'approved',  daysBack: 24, expCount: 4 },
  { userIdx: 7, stopIdx: 0, status: 'approved',  daysBack: 24, expCount: 5 },
  { userIdx: 3, stopIdx: 1, status: 'approved',  daysBack: 18, expCount: 4 },
  { userIdx: 4, stopIdx: 1, status: 'approved',  daysBack: 18, expCount: 5 },
  { userIdx: 5, stopIdx: 1, status: 'approved',  daysBack: 17, expCount: 3 },
  { userIdx: 8, stopIdx: 1, status: 'approved',  daysBack: 17, expCount: 4 },
  { userIdx: 3, stopIdx: 2, status: 'approved',  daysBack: 11, expCount: 5 },
  { userIdx: 6, stopIdx: 2, status: 'rejected',  daysBack: 10, expCount: 2 },
  { userIdx: 3, stopIdx: 3, status: 'submitted', daysBack: 4,  expCount: 4 },
  { userIdx: 4, stopIdx: 3, status: 'submitted', daysBack: 4,  expCount: 5 },
  { userIdx: 7, stopIdx: 3, status: 'submitted', daysBack: 3,  expCount: 3 },
  { userIdx: 8, stopIdx: 3, status: 'submitted', daysBack: 3,  expCount: 4 },
  { userIdx: 5, stopIdx: 4, status: 'draft',     daysBack: 1,  expCount: 2 },
  { userIdx: 6, stopIdx: 4, status: 'draft',     daysBack: 1,  expCount: 3 },
  { userIdx: 8, stopIdx: 5, status: 'draft',     daysBack: 0,  expCount: 1 },
];

const officialStops = [
  { venue: 'Atlantic City, NJ',             event_date: '2025-08-08' },
  { venue: 'Cincinnati, OH',                event_date: '2025-08-09' },
  { venue: 'Medford, MA',                   event_date: '2025-08-22' },
  { venue: 'Charles Town, WV',              event_date: '2025-09-13' },
  { venue: 'Tacoma, WA',                    event_date: '2025-10-09' },
  { venue: 'Charleston, SC',                event_date: '2025-10-26' },
  { venue: 'Ft. Lauderdale, FL',            event_date: '2025-11-08' },
  { venue: 'Detroit, MI',                   event_date: '2026-01-31' },
  { venue: 'Coral Gables, FL',              event_date: '2026-02-28' },
  { venue: 'Charlotte, NC',                 event_date: '2026-03-01' },
  { venue: 'Baltimore, MD',                 event_date: '2026-03-06' },
  { venue: 'Buffalo, NY',                   event_date: '2026-03-07' },
  { venue: 'Chicago, IL',                   event_date: '2026-03-13' },
  { venue: 'Indianapolis, IN',              event_date: '2026-03-15' },
  { venue: 'Oklahoma City, OK',             event_date: '2026-03-20' },
  { venue: 'Mesa, AZ',                      event_date: '2026-03-22' },
  { venue: 'Omaha, NE',                     event_date: '2026-03-29' },
  { venue: 'Boise, ID',                     event_date: '2026-04-09' },
  { venue: 'Nixa, MO',                      event_date: '2026-05-08' },
  { venue: 'Lac Du Flambeau, WI',           event_date: '2026-05-23' },
  { venue: 'San Antonio, TX',               event_date: '2026-05-28' },
  { venue: 'Palm Springs, CA',              event_date: '2026-05-29' },
  { venue: 'Wichita, KS',                   event_date: '2026-06-13' },
  { venue: 'Mashantucket, CT',              event_date: '2026-08-21' },
  { venue: 'Concord, NH',                   event_date: '2026-08-22' },
  { venue: 'New Buffalo, MI',               event_date: '2026-09-12' },
  { venue: 'Biloxi, MS',                    event_date: '2026-09-19' },
  { venue: 'Mississauga, ON',               event_date: '2026-10-09' },
  { venue: 'Thunder Bay, ON',               event_date: '2026-10-10' },
  { venue: 'Riverside, IA',                 event_date: '2026-11-13' },
  { venue: 'St. Louis, MO',                 event_date: '2026-11-20' },
  { venue: 'Dallas, TX',                    event_date: '2026-11-21' },
  { venue: 'Detroit, MI',                   event_date: '2027-02-06' },
];

async function seed() {
  // Create tables
  await sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT DEFAULT (NOW()))`;
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS tour_stops (id TEXT PRIMARY KEY, venue TEXT NOT NULL, event_date TEXT NOT NULL, notes TEXT DEFAULT '', created_at TEXT DEFAULT (NOW()))`;
  await sql`CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_date TEXT, event_location TEXT, event_date TEXT, submit_payment_to TEXT, payment_method TEXT DEFAULT 'check', status TEXT DEFAULT 'draft', submitted_at TEXT, reviewed_at TEXT, reviewed_by TEXT, reject_reason TEXT, paid_at TEXT, created_at TEXT DEFAULT (NOW()), updated_at TEXT DEFAULT (NOW()))`;
  await sql`CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, vendor TEXT, purpose TEXT, amount NUMERIC, comments TEXT, sort_order INTEGER DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, report_id TEXT NOT NULL, filename TEXT, original_name TEXT, mimetype TEXT, size INTEGER, uploaded_at TEXT DEFAULT (NOW()))`;
  await sql`CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, message TEXT NOT NULL, report_id TEXT, type TEXT DEFAULT 'info', read INTEGER DEFAULT 0, created_at TEXT DEFAULT (NOW()))`;

  // Clear existing data
  await sql`DELETE FROM notifications`;
  await sql`DELETE FROM receipts`;
  await sql`DELETE FROM expenses`;
  await sql`DELETE FROM reports`;
  await sql`DELETE FROM tour_stops`;
  await sql`DELETE FROM users`;

  // Insert users
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const d = new Date(2025, 0, 10 + i).toISOString();
    await sql`INSERT INTO users (id,username,email,password_hash,role,active,created_at) VALUES (${u.id},${u.username},${u.email},${HASH},${u.role},1,${d})`;
  }

  // Insert reports + expenses
  const adminId = users.find(u => u.role === 'superadmin').id;
  for (const def of reportDefs) {
    const user  = users[def.userIdx];
    const stop  = tourStops[def.stopIdx];
    const rId   = uuidv4();
    const now   = new Date();
    const created   = new Date(now - def.daysBack * 86400000);
    const submitted = def.status !== 'draft' ? new Date(created.getTime() + 3600000) : null;
    const reviewed  = (def.status === 'approved' || def.status === 'rejected') ? new Date(submitted.getTime() + 7200000) : null;
    const reqDate   = created.toISOString().slice(0, 10);

    await sql`INSERT INTO reports (id,user_id,request_date,event_location,event_date,submit_payment_to,payment_method,status,submitted_at,reviewed_at,reviewed_by,created_at,updated_at)
      VALUES (${rId},${user.id},${reqDate},${stop.city},${stop.date},${user.name},'check',${def.status},${submitted ? submitted.toISOString() : null},${reviewed ? reviewed.toISOString() : null},${reviewed ? adminId : null},${created.toISOString()},${created.toISOString()})`;

    const exps = randomExpenses(def.expCount);
    for (let i = 0; i < exps.length; i++) {
      const exp = exps[i];
      await sql`INSERT INTO expenses (id,report_id,vendor,purpose,amount,comments,sort_order) VALUES (${uuidv4()},${rId},${exp.vendor},${exp.purpose},${exp.amount},'',${i+1})`;
    }
  }

  // Insert official tour stops
  for (const s of officialStops) {
    await sql`INSERT INTO tour_stops (id,venue,event_date) VALUES (${uuidv4()},${s.venue},${s.event_date})`;
  }

  console.log('\n✅ Seed data inserted successfully!\n');
  console.log('Users created (all passwords: admin):');
  users.forEach(u => console.log(`  • ${u.username.padEnd(16)} (${u.role})`));
  console.log(`\n  Reports: ${reportDefs.length} across ${tourStops.length} sample tour stops`);
  console.log(`  Tour stop schedule: ${officialStops.length} official stops loaded`);
  console.log('  Statuses: approved, submitted (pending), rejected, draft\n');
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
