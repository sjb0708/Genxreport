'use strict';
/**
 * Seed realistic placeholder data for GENX TAKEOVER Expense System
 * Run: node seed.js
 */
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'expenses.db'));
db.pragma('foreign_keys = ON');

// Ensure tour_stops table exists (in case running seed before server)
db.exec(`
  CREATE TABLE IF NOT EXISTS tour_stops (
    id TEXT PRIMARY KEY, venue TEXT NOT NULL, event_date TEXT NOT NULL,
    notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Clear existing seed data
db.exec(`DELETE FROM receipts; DELETE FROM expenses; DELETE FROM reports; DELETE FROM users; DELETE FROM tour_stops;`);

const HASH = bcrypt.hashSync('GenX2024!', 10);

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

const insertUser = db.prepare(`INSERT INTO users (id,username,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,1,?)`);
users.forEach((u, i) => {
  const d = new Date(2025, 0, 10 + i);
  insertUser.run(u.id, u.username, u.email, HASH, u.role, d.toISOString());
});

// ─── Tour Stops ────────────────────────────────────────────────────────────

const tourStops = [
  { city: 'Atlanta, GA',         venue: 'State Farm Arena',         date: '2025-03-08' },
  { city: 'Houston, TX',         venue: 'Toyota Center',            date: '2025-03-15' },
  { city: 'Chicago, IL',         venue: 'Chicago Theatre',          date: '2025-03-22' },
  { city: 'Miami, FL',           venue: 'Fillmore Miami Beach',      date: '2025-03-29' },
  { city: 'New York, NY',        venue: 'Beacon Theatre',           date: '2025-04-05' },
  { city: 'Los Angeles, CA',     venue: 'The Wiltern',              date: '2025-04-12' },
  { city: 'Dallas, TX',          venue: 'House of Blues',           date: '2025-04-19' },
  { city: 'Las Vegas, NV',       venue: 'MGM Grand Garden Arena',   date: '2025-04-26' },
  { city: 'Charlotte, NC',       venue: 'Ovens Auditorium',         date: '2025-05-03' },
  { city: 'Washington, DC',      venue: 'DAR Constitution Hall',    date: '2025-05-10' },
];

// ─── Expense Categories & Vendors ──────────────────────────────────────────

const expenseTemplates = {
  'Airfare': [
    { vendor: 'Delta Air Lines', amounts: [312, 387, 445, 502, 278] },
    { vendor: 'American Airlines', amounts: [298, 421, 365] },
    { vendor: 'Southwest Airlines', amounts: [189, 245, 312] },
  ],
  'Hotel/Lodging': [
    { vendor: 'Marriott Hotels', amounts: [189, 212, 245, 178] },
    { vendor: 'Hilton Garden Inn', amounts: [165, 198, 222] },
    { vendor: 'Hyatt Regency', amounts: [225, 267, 289] },
  ],
  'Transportation/Gas': [
    { vendor: 'Uber / Lyft', amounts: [18.50, 24.00, 31.75, 45.20, 15.00] },
    { vendor: 'BP Gas Station', amounts: [67.40, 52.80, 71.20] },
    { vendor: 'Enterprise Rent-A-Car', amounts: [89, 112, 145] },
  ],
  'Food & Beverage': [
    { vendor: "Cheesecake Factory", amounts: [87.50, 124.00, 98.75] },
    { vendor: 'Green Salad Catering', amounts: [145, 178, 210] },
    { vendor: 'Chick-fil-A', amounts: [28.40, 34.20, 41.80] },
    { vendor: 'Ruth\'s Chris Steak House', amounts: [187, 234, 156] },
  ],
  'Parking': [
    { vendor: 'Venue Parking Garage', amounts: [35, 45, 55, 28] },
    { vendor: 'SpotHero Parking', amounts: [22, 18, 30] },
  ],
  'Equipment Rental': [
    { vendor: 'Guitar Center Rentals', amounts: [125, 200, 175] },
    { vendor: 'Production Plus', amounts: [350, 425, 290] },
  ],
  'Office Supplies': [
    { vendor: 'FedEx Office', amounts: [34, 28, 45] },
    { vendor: 'Staples', amounts: [62, 48, 55] },
  ],
  'Marketing/Promotion': [
    { vendor: 'Vistaprint', amounts: [145, 198, 89] },
    { vendor: 'Facebook Ads', amounts: [200, 150, 300] },
  ],
  'Wardrobe/Costumes': [
    { vendor: 'Nordstrom', amounts: [189, 245, 312] },
    { vendor: 'H&M Business Wear', amounts: [87, 124, 156] },
  ],
  'Miscellaneous': [
    { vendor: 'CVS Pharmacy', amounts: [23.40, 18.60, 31.20] },
    { vendor: 'Walgreens', amounts: [15.80, 28.40, 19.60] },
  ],
};

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickAmount(tpl) { return pickRandom(tpl.amounts); }

function randomExpenses(count = 4) {
  const cats = Object.keys(expenseTemplates);
  const picked = [];
  const used = new Set();
  let tries = 0;
  while (picked.length < count && tries < 30) {
    tries++;
    const cat = pickRandom(cats);
    if (used.has(cat) && count <= cats.length) continue;
    used.add(cat);
    const tpl = pickRandom(expenseTemplates[cat]);
    picked.push({
      vendor:   tpl.vendor,
      purpose:  cat,
      amount:   pickAmount(tpl),
      comments: '',
    });
  }
  return picked;
}

// ─── Reports ───────────────────────────────────────────────────────────────

const insertReport  = db.prepare(`INSERT INTO reports (id,user_id,request_date,event_location,event_date,submit_payment_to,payment_method,status,submitted_at,reviewed_at,reviewed_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertExpense = db.prepare(`INSERT INTO expenses (id,report_id,vendor,purpose,amount,comments,sort_order) VALUES (?,?,?,?,?,?,?)`);

// userIdx 3=kelly, 4=nick, 5=reuben, 6=joyce, 7=justin, 8=steven
const reportDefs = [
  // Approved reports (completed tour stops)
  { userIdx: 3, stopIdx: 0, status: 'approved',   daysBack: 25, expCount: 5 },
  { userIdx: 4, stopIdx: 0, status: 'approved',   daysBack: 25, expCount: 4 },
  { userIdx: 5, stopIdx: 0, status: 'approved',   daysBack: 25, expCount: 3 },
  { userIdx: 6, stopIdx: 0, status: 'approved',   daysBack: 24, expCount: 4 },
  { userIdx: 7, stopIdx: 0, status: 'approved',   daysBack: 24, expCount: 5 },

  { userIdx: 3, stopIdx: 1, status: 'approved',   daysBack: 18, expCount: 4 },
  { userIdx: 4, stopIdx: 1, status: 'approved',   daysBack: 18, expCount: 5 },
  { userIdx: 5, stopIdx: 1, status: 'approved',   daysBack: 17, expCount: 3 },
  { userIdx: 8, stopIdx: 1, status: 'approved',   daysBack: 17, expCount: 4 },

  { userIdx: 3, stopIdx: 2, status: 'approved',   daysBack: 11, expCount: 5 },
  { userIdx: 6, stopIdx: 2, status: 'rejected',   daysBack: 10, expCount: 2 },

  // Submitted (pending review)
  { userIdx: 3, stopIdx: 3, status: 'submitted',  daysBack: 4,  expCount: 4 },
  { userIdx: 4, stopIdx: 3, status: 'submitted',  daysBack: 4,  expCount: 5 },
  { userIdx: 7, stopIdx: 3, status: 'submitted',  daysBack: 3,  expCount: 3 },
  { userIdx: 8, stopIdx: 3, status: 'submitted',  daysBack: 3,  expCount: 4 },

  // Drafts (upcoming tour stops)
  { userIdx: 5, stopIdx: 4, status: 'draft',      daysBack: 1,  expCount: 2 },
  { userIdx: 6, stopIdx: 4, status: 'draft',      daysBack: 1,  expCount: 3 },
  { userIdx: 8, stopIdx: 5, status: 'draft',      daysBack: 0,  expCount: 1 },
];

const adminId = users.find(u => u.role === 'superadmin').id;

reportDefs.forEach(def => {
  const user  = users[def.userIdx];
  const stop  = tourStops[def.stopIdx];
  const rId   = uuidv4();
  const now   = new Date();
  const created  = new Date(now - def.daysBack * 86400000);
  const submitted = def.status !== 'draft' ? new Date(created.getTime() + 3600000) : null;
  const reviewed  = (def.status === 'approved' || def.status === 'rejected') ? new Date(submitted.getTime() + 7200000) : null;

  const reqDate = created.toISOString().slice(0, 10);

  insertReport.run(
    rId, user.id, reqDate,
    stop.city,
    stop.date,
    user.name || user.username,
    'check',
    def.status,
    submitted ? submitted.toISOString() : null,
    reviewed  ? reviewed.toISOString()  : null,
    reviewed  ? adminId : null,
    created.toISOString(),
    created.toISOString()
  );

  randomExpenses(def.expCount).forEach((exp, i) => {
    insertExpense.run(uuidv4(), rId, exp.vendor, exp.purpose, exp.amount, exp.comments, i + 1);
  });
});

// ─── Official Tour Stop Schedule ───────────────────────────────────────────

const officialStops = [
  { venue: 'Atlantic City, NJ',               event_date: '2025-08-08' },
  { venue: 'Cincinnati, OH',                  event_date: '2025-08-09' },
  { venue: 'Medford, MA',                     event_date: '2025-08-22' },
  { venue: 'Charles Town, WV',                event_date: '2025-09-13' },
  { venue: 'Tacoma, WA',                      event_date: '2025-10-09' },
  { venue: 'Charleston, SC',                  event_date: '2025-10-26' },
  { venue: 'Ft. Lauderdale, FL',              event_date: '2025-11-08' },
  { venue: 'Detroit, MI',                     event_date: '2026-01-31' },
  { venue: 'Coral Gables, FL (Lauderdale)',   event_date: '2026-02-28' },
  { venue: 'Charlotte, NC',                   event_date: '2026-03-01' },
  { venue: 'Baltimore, MD',                   event_date: '2026-03-06' },
  { venue: 'Buffalo, NY',                     event_date: '2026-03-07' },
  { venue: 'Chicago, IL',                     event_date: '2026-03-13' },
  { venue: 'Indianapolis, IN',                event_date: '2026-03-15' },
  { venue: 'Oklahoma City, OK',               event_date: '2026-03-20' },
  { venue: 'Mesa, AZ',                        event_date: '2026-03-22' },
  { venue: 'Omaha, NE',                       event_date: '2026-03-29' },
  { venue: 'Boise, ID',                       event_date: '2026-04-09' },
  { venue: 'Nixa, MO',                        event_date: '2026-05-08' },
  { venue: 'Lac Du Flambeau, WI',             event_date: '2026-05-23' },
  { venue: 'San Antonio, TX',                 event_date: '2026-05-28' },
  { venue: 'Palm Springs, CA',                event_date: '2026-05-29' },
  { venue: 'Wichita, KS',                     event_date: '2026-06-13' },
  { venue: 'Mashantucket, CT (Foxwood)',       event_date: '2026-08-21' },
  { venue: 'Concord, NH',                     event_date: '2026-08-22' },
  { venue: 'New Buffalo, MI',                 event_date: '2026-09-12' },
  { venue: 'Biloxi, MS',                      event_date: '2026-09-19' },
  { venue: 'Mississauga, ON',                 event_date: '2026-10-09' },
  { venue: 'Thunder Bay, ON',                 event_date: '2026-10-10' },
  { venue: 'Riverside, IA',                   event_date: '2026-11-13' },
  { venue: 'St. Louis, MO',                   event_date: '2026-11-20' },
  { venue: 'Dallas, TX',                      event_date: '2026-11-21' },
  { venue: 'Detroit, MI',                     event_date: '2027-02-06' },
];

const insertStop = db.prepare('INSERT INTO tour_stops (id, venue, event_date) VALUES (?,?,?)');
officialStops.forEach(s => insertStop.run(uuidv4(), s.venue, s.event_date));

console.log('\n✅ Seed data inserted successfully!\n');
console.log('Users created (all passwords: GenX2024!):');
users.forEach(u => console.log(`  • ${u.username.padEnd(16)} (${u.role})`));
console.log(`\n  Reports: ${reportDefs.length} across ${tourStops.length} sample tour stops`);
console.log(`  Tour stop schedule: ${officialStops.length} official stops loaded`);
console.log('  Statuses: approved, submitted (pending), rejected, draft\n');
