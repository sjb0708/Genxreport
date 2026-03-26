'use strict';
const express      = require('express');
const { neon }     = require('@neondatabase/serverless');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer   = require('nodemailer');
// Lazy-load heavy modules to avoid serverless cold-start crashes
function getExcelJS() { return require('exceljs'); }
function getPDFDocument() { return require('pdfkit'); }

const app  = express();
const PORT = process.env.PORT || 3000;
const __dir = __dirname;

const JWT_SECRET = process.env.JWT_SECRET || 'genx-takeover-secret-jwt-2024';

// ─── Directories ───────────────────────────────────────────────────────────

const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : path.join(__dir, 'uploads'));
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Database ──────────────────────────────────────────────────────────────

// Strip whitespace/newlines and channel_binding param
const dbUrl = (process.env.DATABASE_URL || '').replace(/\s+/g, '').replace(/[&?]channel_binding=[^&]*/g, '');
if (!dbUrl) { console.error('FATAL: DATABASE_URL is not set'); }
const sql = neon(dbUrl || 'postgresql://user:pass@host.neon.tech/dbname');

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      active        INTEGER NOT NULL DEFAULT 1,
      created_by    TEXT,
      created_at    TEXT DEFAULT (NOW())
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS reports (
      id                TEXT PRIMARY KEY,
      user_id           TEXT,
      request_date      TEXT,
      event_location    TEXT,
      event_date        TEXT,
      submit_payment_to TEXT,
      payment_method    TEXT DEFAULT 'check',
      status            TEXT NOT NULL DEFAULT 'draft',
      admin_notes       TEXT,
      submitted_at      TEXT,
      reviewed_at       TEXT,
      reviewed_by       TEXT,
      created_at        TEXT DEFAULT (NOW()),
      updated_at        TEXT DEFAULT (NOW())
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS expenses (
      id         TEXT PRIMARY KEY,
      report_id  TEXT,
      vendor     TEXT,
      purpose    TEXT,
      amount     REAL,
      comments   TEXT,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (report_id) REFERENCES reports(id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS receipts (
      id            TEXT PRIMARY KEY,
      expense_id    TEXT,
      report_id     TEXT,
      filename      TEXT,
      original_name TEXT,
      mimetype      TEXT,
      uploaded_at   TEXT DEFAULT (NOW()),
      FOREIGN KEY (expense_id) REFERENCES expenses(id),
      FOREIGN KEY (report_id)  REFERENCES reports(id)
    )
  `;
  await sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS file_data TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS tour_stops (
      id         TEXT PRIMARY KEY,
      venue      TEXT NOT NULL,
      event_date TEXT NOT NULL,
      notes      TEXT DEFAULT '',
      created_at TEXT DEFAULT (NOW())
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      message    TEXT NOT NULL,
      report_id  TEXT,
      type       TEXT DEFAULT 'info',
      read       INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (NOW())
    )
  `;

  // Migrations
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'check'`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS paid_at TEXT`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS paid_by TEXT`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS paid_notes TEXT`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS review_started_at TEXT`;

  // Default superadmin on first run
  const userCount = (await sql`SELECT COUNT(*) as c FROM users`)[0];
  if (parseInt(userCount.c) === 0) {
    const hash = bcrypt.hashSync('GenX2024!', 10);
    await sql`INSERT INTO users (id, username, email, password_hash, role)
              VALUES (${uuidv4()}, ${'admin'}, ${'admin@genxtakeover.com'}, ${hash}, ${'superadmin'})`;
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  DEFAULT ADMIN CREDENTIALS           ║');
    console.log('║  Username : admin                    ║');
    console.log('║  Password : GenX2024!                ║');
    console.log('║  ⚠  Change password after login!     ║');
    console.log('╚══════════════════════════════════════╝\n');
  }
}

initDB().catch(console.error);

// ─── Middleware ────────────────────────────────────────────────────────────

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// ─── Auth Helpers ──────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function setAuthCookie(res, user) {
  const token = signToken(user);
  res.cookie('genx_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  });
  return token;
}

async function requireLogin(req, res, next) {
  const token = req.cookies?.genx_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const rows = await sql`SELECT * FROM users WHERE id=${decoded.userId} AND active=1`;
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (_) {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

async function requireAdmin(req, res, next) {
  await requireLogin(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
      return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

async function requireSuperadmin(req, res, next) {
  await requireLogin(req, res, () => {
    if (req.user.role !== 'superadmin')
      return res.status(403).json({ error: 'Superadmin access required' });
    next();
  });
}

// ─── Static Files ──────────────────────────────────────────────────────────

app.use(express.static(path.join(__dir, 'public')));
app.use('/uploads', requireLogin, express.static(UPLOAD_DIR));

app.get('/',      (req, res) => res.sendFile(path.join(__dir, 'public', 'index.html')));
app.get('/app',   requireLogin, (req, res) => res.sendFile(path.join(__dir, 'public', 'app.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dir, 'public', 'admin.html')));

// ─── Auth Routes ───────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = (await sql`SELECT * FROM users WHERE username=${username.trim()} AND active=1`)[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  setAuthCookie(res, user);
  res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('genx_token');
  res.json({ success: true });
});

app.get('/api/auth/me', requireLogin, (req, res) => {
  const { id, username, email, role } = req.user;
  res.json({ id, username, email, role });
});

app.put('/api/auth/password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!bcrypt.compareSync(currentPassword, req.user.password_hash))
    return res.status(400).json({ error: 'Current password incorrect' });
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await sql`UPDATE users SET password_hash=${hash} WHERE id=${req.user.id}`;
  res.json({ success: true });
});

// ─── Admin – User Management ───────────────────────────────────────────────

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await sql`SELECT id, username, email, role, active, created_at FROM users ORDER BY created_at ASC`;
  res.json(users);
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const allowedRoles = req.user.role === 'superadmin' ? ['user','admin','superadmin'] : ['user','admin'];
  const assignRole = allowedRoles.includes(role) ? role : 'user';
  try {
    const id   = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    await sql`INSERT INTO users (id, username, email, password_hash, role, created_by) VALUES (${id}, ${username.trim()}, ${email.trim().toLowerCase()}, ${hash}, ${assignRole}, ${req.user.id})`;
    res.json({ id, username, email, role: assignRole });
  } catch (e) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

app.put('/api/admin/users/:id/role', requireSuperadmin, async (req, res) => {
  const { role } = req.body;
  if (!['user','admin','superadmin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });
  await sql`UPDATE users SET role=${role} WHERE id=${req.params.id}`;
  res.json({ success: true });
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await sql`UPDATE users SET password_hash=${hash} WHERE id=${req.params.id}`;
  res.json({ success: true });
});

app.put('/api/admin/users/:id/active', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });
  const { active } = req.body;
  await sql`UPDATE users SET active=${active ? 1 : 0} WHERE id=${req.params.id}`;
  res.json({ success: true });
});

// ─── Tour Stops ────────────────────────────────────────────────────────────

app.get('/api/tour-stops', requireLogin, async (req, res) => {
  const stops = await sql`SELECT * FROM tour_stops ORDER BY event_date ASC`;
  res.json(stops);
});

app.post('/api/tour-stops', requireAdmin, async (req, res) => {
  const { venue, event_date, notes } = req.body;
  if (!venue || !event_date) return res.status(400).json({ error: 'Venue and date are required' });
  const id = uuidv4();
  await sql`INSERT INTO tour_stops (id, venue, event_date, notes) VALUES (${id}, ${venue.trim()}, ${event_date}, ${notes||''})`;
  const stop = (await sql`SELECT * FROM tour_stops WHERE id=${id}`)[0];
  res.json(stop);
});

app.put('/api/tour-stops/:id', requireAdmin, async (req, res) => {
  const { venue, event_date, notes } = req.body;
  if (!venue || !event_date) return res.status(400).json({ error: 'Venue and date are required' });
  await sql`UPDATE tour_stops SET venue=${venue.trim()}, event_date=${event_date}, notes=${notes||''} WHERE id=${req.params.id}`;
  const stop = (await sql`SELECT * FROM tour_stops WHERE id=${req.params.id}`)[0];
  res.json(stop);
});

app.delete('/api/tour-stops/:id', requireAdmin, async (req, res) => {
  await sql`DELETE FROM tour_stops WHERE id=${req.params.id}`;
  res.json({ success: true });
});

// ─── Admin – All Reports ───────────────────────────────────────────────────

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  const { userId, status, from, to } = req.query;
  let rows;
  if (userId && status && from && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.status=${status} AND r.event_date>=${from} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId && status && from) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.status=${status} AND r.event_date>=${from}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId && status && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.status=${status} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId && from && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.event_date>=${from} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (status && from && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.status=${status} AND r.event_date>=${from} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId && status) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.status=${status}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId && from) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.event_date>=${from}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (status && from) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.status=${status} AND r.event_date>=${from}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (status && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.status=${status} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (from && to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.event_date>=${from} AND r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (userId) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${userId}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (status) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.status=${status}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (from) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.event_date>=${from}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else if (to) {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.event_date<=${to}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else {
    rows = await sql`SELECT r.*, u.username, u.email,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  }
  res.json(rows);
});

// ─── Reports ───────────────────────────────────────────────────────────────

app.get('/api/reports', requireLogin, async (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  let rows;
  if (isAdmin) {
    rows = await sql`SELECT r.*, u.username,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  } else {
    rows = await sql`SELECT r.*, u.username,
                       COALESCE(SUM(e.amount),0) as total,
                       COUNT(e.id) as expense_count
                     FROM reports r
                     LEFT JOIN users u ON u.id = r.user_id
                     LEFT JOIN expenses e ON e.report_id = r.id
                     WHERE r.user_id=${req.user.id}
                     GROUP BY r.id, u.username, u.email ORDER BY r.created_at DESC`;
  }
  res.json(rows);
});

app.post('/api/reports', requireLogin, async (req, res) => {
  const id = uuidv4();
  const { request_date, event_location, event_date, submit_payment_to, payment_method } = req.body;
  await sql`INSERT INTO reports (id, user_id, request_date, event_location, event_date, submit_payment_to, payment_method, status)
            VALUES (${id}, ${req.user.id}, ${request_date||''}, ${event_location||''}, ${event_date||''}, ${submit_payment_to||''}, ${payment_method||'check'}, ${'draft'})`;
  const report = (await sql`SELECT * FROM reports WHERE id=${id}`)[0];
  res.json(report);
});

async function getFullReport(id) {
  const report = (await sql`SELECT r.*, u.username, u.email FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=${id}`)[0];
  if (!report) return null;
  const expenses = await sql`SELECT * FROM expenses WHERE report_id=${id} ORDER BY sort_order, id`;
  report.expenses = await Promise.all(expenses.map(async exp => ({
    ...exp,
    receipts: await sql`SELECT * FROM receipts WHERE expense_id=${exp.id}`
  })));
  report.total = report.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  return report;
}

app.get('/api/reports/:id', requireLogin, async (req, res) => {
  const report = await getFullReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  res.json(report);
});

app.put('/api/reports/:id', requireLogin, async (req, res) => {
  const report = (await sql`SELECT * FROM reports WHERE id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!isAdmin && report.status !== 'draft') return res.status(400).json({ error: 'Cannot edit a submitted report' });
  const { request_date, event_location, event_date, submit_payment_to, payment_method } = req.body;
  await sql`UPDATE reports SET request_date=${request_date}, event_location=${event_location}, event_date=${event_date}, submit_payment_to=${submit_payment_to},
            payment_method=${payment_method||'check'}, updated_at=${new Date().toISOString()} WHERE id=${req.params.id}`;
  const updated = (await sql`SELECT * FROM reports WHERE id=${req.params.id}`)[0];
  res.json(updated);
});

app.delete('/api/reports/:id', requireLogin, async (req, res) => {
  const report = (await sql`SELECT * FROM reports WHERE id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const receipts = await sql`SELECT filename FROM receipts WHERE report_id=${req.params.id}`;
  receipts.forEach(r => { try { fs.unlinkSync(path.join(UPLOAD_DIR, r.filename)); } catch(_){} });
  await sql`DELETE FROM receipts WHERE report_id=${req.params.id}`;
  await sql`DELETE FROM expenses WHERE report_id=${req.params.id}`;
  await sql`DELETE FROM reports WHERE id=${req.params.id}`;
  res.json({ success: true });
});

app.post('/api/reports/:id/submit', requireLogin, async (req, res) => {
  const report = (await sql`SELECT * FROM reports WHERE id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (report.status !== 'draft') return res.status(400).json({ error: 'Report already submitted' });
  const expenseCount = (await sql`SELECT COUNT(*) as c FROM expenses WHERE report_id=${req.params.id}`)[0];
  if (parseInt(expenseCount.c) === 0) return res.status(400).json({ error: 'Add at least one expense before submitting' });
  await sql`UPDATE reports SET status=${'submitted'}, submitted_at=${new Date().toISOString()} WHERE id=${req.params.id}`;
  res.json({ success: true });
  setImmediate(async () => {
    const r = (await sql`SELECT event_location FROM reports WHERE id=${req.params.id}`)[0];
    notifyAdmins(`📋 ${req.user.username} submitted an expense report for ${r?.event_location}.`, req.params.id, 'info');
    sendSubmissionEmail(req.params.id, req.user).catch(e => console.error('Email error:', e));
  });
});

// ─── Notification Helper ───────────────────────────────────────────────────

async function createNotification(userId, message, reportId, type = 'info') {
  try {
    await sql`INSERT INTO notifications (id, user_id, message, report_id, type) VALUES (${uuidv4()}, ${userId}, ${message}, ${reportId || null}, ${type})`;
  } catch(e) { console.error('Notification error:', e.message); }
}

async function notifyAdmins(message, reportId, type = 'info') {
  const admins = await sql`SELECT id FROM users WHERE role IN ('admin','superadmin') AND active=1`;
  admins.forEach(a => createNotification(a.id, message, reportId, type));
}

// ─── Notification API ──────────────────────────────────────────────────────

app.get('/api/notifications', requireLogin, async (req, res) => {
  const notes = await sql`SELECT * FROM notifications WHERE user_id=${req.user.id} ORDER BY created_at DESC LIMIT 50`;
  const unreadRow = (await sql`SELECT COUNT(*) as c FROM notifications WHERE user_id=${req.user.id} AND read=0`)[0];
  res.json({ notifications: notes, unread: parseInt(unreadRow.c) });
});

app.post('/api/notifications/read-all', requireLogin, async (req, res) => {
  await sql`UPDATE notifications SET read=1 WHERE user_id=${req.user.id}`;
  res.json({ success: true });
});

app.post('/api/notifications/:id/read', requireLogin, async (req, res) => {
  await sql`UPDATE notifications SET read=1 WHERE id=${req.params.id} AND user_id=${req.user.id}`;
  res.json({ success: true });
});

app.post('/api/reports/:id/approve', requireAdmin, async (req, res) => {
  try {
  const { notes } = req.body;
  const report = (await sql`SELECT r.*, u.username, u.email FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  await sql`UPDATE reports SET status=${'approved'}, admin_notes=${notes||''}, reviewed_at=${new Date().toISOString()}, reviewed_by=${req.user.id} WHERE id=${req.params.id}`;
  res.json({ success: true });
  setImmediate(async () => {
    const totalRow = (await sql`SELECT SUM(amount) as t FROM expenses WHERE report_id=${req.params.id}`)[0];
    const msg = `✅ Your expense report for ${report.event_location} ($${parseFloat(totalRow?.t||0).toFixed(2)}) has been approved.`;
    createNotification(report.user_id, msg, req.params.id, 'success');
    sendStatusEmail(report, 'approved', msg, notes).catch(e => console.error('Email error:', e));
  });
  } catch(e) { console.error('Approve error:', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/reports/:id/reject', requireAdmin, async (req, res) => {
  try {
  const { notes } = req.body;
  if (!notes) return res.status(400).json({ error: 'Please provide rejection notes' });
  const report = (await sql`SELECT r.*, u.username, u.email FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  await sql`UPDATE reports SET status=${'rejected'}, admin_notes=${notes}, reviewed_at=${new Date().toISOString()}, reviewed_by=${req.user.id} WHERE id=${req.params.id}`;
  res.json({ success: true });
  setImmediate(() => {
    const msg = `❌ Your expense report for ${report.event_location} was rejected. Reason: ${notes}`;
    createNotification(report.user_id, msg, req.params.id, 'error');
    sendStatusEmail(report, 'rejected', msg, notes).catch(e => console.error('Email error:', e));
  });
  } catch(e) { console.error('Reject error:', e); res.status(500).json({ error: e.message }); }
});

// Reopen (admin) – set back to draft
app.post('/api/reports/:id/reopen', requireAdmin, async (req, res) => {
  const report = (await sql`SELECT user_id, event_location FROM reports WHERE id=${req.params.id}`)[0];
  await sql`UPDATE reports SET status=${'draft'}, admin_notes=NULL, reviewed_at=NULL, reviewed_by=NULL WHERE id=${req.params.id}`;
  res.json({ success: true });
  if (report) setImmediate(() => {
    createNotification(report.user_id, `↩ Your expense report for ${report.event_location} has been reopened for editing.`, req.params.id, 'info');
  });
});

// Mark Under Review (admin)
app.post('/api/reports/:id/under_review', requireAdmin, async (req, res) => {
  const report = (await sql`SELECT r.status, r.user_id, r.event_location FROM reports r WHERE r.id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (report.status !== 'submitted') return res.status(400).json({ error: 'Report must be submitted first' });
  await sql`UPDATE reports SET status=${'under_review'}, review_started_at=${new Date().toISOString()} WHERE id=${req.params.id}`;
  res.json({ success: true });
  setImmediate(() => {
    createNotification(report.user_id, `🔍 Your expense report for ${report.event_location} is now under review.`, req.params.id, 'info');
  });
});

// Mark Paid (admin)
app.post('/api/reports/:id/paid', requireAdmin, async (req, res) => {
  const report = (await sql`SELECT r.*, u.username, u.email FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (report.status !== 'approved') return res.status(400).json({ error: 'Report must be approved first' });
  const { notes } = req.body;
  await sql`UPDATE reports SET status=${'paid'}, paid_at=${new Date().toISOString()}, paid_by=${req.user.id}, paid_notes=${notes||''} WHERE id=${req.params.id}`;
  res.json({ success: true });
  setImmediate(async () => {
    const totalRow = (await sql`SELECT SUM(amount) as t FROM expenses WHERE report_id=${req.params.id}`)[0];
    const msg = `💳 Your expense report for ${report.event_location} ($${parseFloat(totalRow?.t||0).toFixed(2)}) has been paid!${notes?' Notes: '+notes:''}`;
    createNotification(report.user_id, msg, req.params.id, 'success');
    sendStatusEmail(report, 'paid', msg, notes).catch(e => console.error('Email error:', e));
  });
});

// ─── Expenses ──────────────────────────────────────────────────────────────

app.post('/api/reports/:id/expenses', requireLogin, async (req, res) => {
  const report = (await sql`SELECT * FROM reports WHERE id=${req.params.id}`)[0];
  if (!report) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && (report.user_id !== req.user.id || report.status !== 'draft'))
    return res.status(403).json({ error: 'Forbidden' });
  const { vendor, purpose, amount, comments } = req.body;
  const id  = uuidv4();
  const maxRow = (await sql`SELECT MAX(sort_order) as m FROM expenses WHERE report_id=${req.params.id}`)[0];
  await sql`INSERT INTO expenses (id, report_id, vendor, purpose, amount, comments, sort_order) VALUES (${id}, ${req.params.id}, ${vendor||''}, ${purpose||''}, ${parseFloat(amount)||0}, ${comments||''}, ${(maxRow.m||0)+1})`;
  const expense = (await sql`SELECT * FROM expenses WHERE id=${id}`)[0];
  res.json({ ...expense, receipts: [] });
});

app.put('/api/expenses/:id', requireLogin, async (req, res) => {
  const exp    = (await sql`SELECT * FROM expenses WHERE id=${req.params.id}`)[0];
  if (!exp) return res.status(404).json({ error: 'Not found' });
  const report = (await sql`SELECT * FROM reports WHERE id=${exp.report_id}`)[0];
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && (report.user_id !== req.user.id || report.status !== 'draft'))
    return res.status(403).json({ error: 'Forbidden' });
  const { vendor, purpose, amount, comments } = req.body;
  await sql`UPDATE expenses SET vendor=${vendor}, purpose=${purpose}, amount=${parseFloat(amount)||0}, comments=${comments} WHERE id=${req.params.id}`;
  const updated  = (await sql`SELECT * FROM expenses WHERE id=${req.params.id}`)[0];
  const receipts = await sql`SELECT * FROM receipts WHERE expense_id=${req.params.id}`;
  res.json({ ...updated, receipts });
});

app.delete('/api/expenses/:id', requireLogin, async (req, res) => {
  const exp    = (await sql`SELECT * FROM expenses WHERE id=${req.params.id}`)[0];
  if (!exp) return res.status(404).json({ error: 'Not found' });
  const report = (await sql`SELECT * FROM reports WHERE id=${exp.report_id}`)[0];
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && (report.user_id !== req.user.id || report.status !== 'draft'))
    return res.status(403).json({ error: 'Forbidden' });
  const receipts = await sql`SELECT filename FROM receipts WHERE expense_id=${req.params.id}`;
  receipts.forEach(r => { try { fs.unlinkSync(path.join(UPLOAD_DIR, r.filename)); } catch(_){} });
  await sql`DELETE FROM receipts WHERE expense_id=${req.params.id}`;
  await sql`DELETE FROM expenses WHERE id=${req.params.id}`;
  res.json({ success: true });
});

// ─── Receipts ──────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|gif|pdf|heic|heif|webp/i.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('Images and PDFs only'));
  }
});

app.post('/api/expenses/:expenseId/receipts', requireLogin, upload.array('receipts', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const exp = (await sql`SELECT * FROM expenses WHERE id=${req.params.expenseId}`)[0];
  if (!exp) return res.status(404).json({ error: 'Expense not found' });
  const report  = (await sql`SELECT * FROM reports WHERE id=${exp.report_id}`)[0];
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const inserted = await Promise.all(req.files.map(async file => {
    const id       = uuidv4();
    const filename = id + path.extname(file.originalname).toLowerCase();
    const b64      = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    // Save to disk as fallback (local dev)
    try { fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer); } catch(_){}
    await sql`INSERT INTO receipts (id, expense_id, report_id, filename, original_name, mimetype, file_data)
              VALUES (${id}, ${req.params.expenseId}, ${exp.report_id}, ${filename}, ${file.originalname}, ${file.mimetype}, ${b64})`;
    return (await sql`SELECT id, expense_id, report_id, filename, original_name, mimetype, uploaded_at FROM receipts WHERE id=${id}`)[0];
  }));
  res.json(inserted);
});

// Serve receipt from DB (persistent on Vercel)
app.get('/api/receipts/:id/file', requireLogin, async (req, res) => {
  const r = (await sql`SELECT mimetype, file_data FROM receipts WHERE id=${req.params.id}`)[0];
  if (!r) return res.status(404).send('Not found');
  if (r.file_data) {
    const [, data] = r.file_data.split(',');
    res.setHeader('Content-Type', r.mimetype || 'application/octet-stream');
    return res.send(Buffer.from(data, 'base64'));
  }
  res.status(404).send('No file data');
});

app.delete('/api/receipts/:id', requireLogin, async (req, res) => {
  const r = (await sql`SELECT * FROM receipts WHERE id=${req.params.id}`)[0];
  if (!r) return res.status(404).json({ error: 'Not found' });
  const report  = (await sql`SELECT * FROM reports WHERE id=${r.report_id}`)[0];
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, r.filename)); } catch(_){}
  await sql`DELETE FROM receipts WHERE id=${req.params.id}`;
  res.json({ success: true });
});

// ─── Logo ──────────────────────────────────────────────────────────────────

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dir, 'public', 'assets')),
  filename:    (req, file, cb) => cb(null, 'logo' + path.extname(file.originalname).toLowerCase())
});
const logoUpload = multer({ storage: logoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/logo', requireAdmin, logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  // Store as base64 in DB so it persists on Vercel
  const data = fs.readFileSync(req.file.path);
  const mime = req.file.mimetype || 'image/png';
  const b64  = `data:${mime};base64,${data.toString('base64')}`;
  await upsertSetting('logo_b64', b64);
  await upsertSetting('logo_ext', path.extname(req.file.originalname).toLowerCase());
  res.json({ path: `/assets/${req.file.filename}` });
});

app.get('/api/logo', async (req, res) => {
  // Check DB first (persists on Vercel)
  const b64 = await getSetting('logo_b64');
  if (b64) return res.json({ path: '/api/logo/img' });
  // Fallback: check filesystem
  const dir = path.join(__dir, 'public', 'assets');
  for (const ext of ['.png','.jpg','.jpeg','.gif','.svg','.webp']) {
    if (fs.existsSync(path.join(dir, 'logo'+ext))) return res.json({ path: `/assets/logo${ext}` });
  }
  res.json({ path: null });
});

app.get('/api/logo/img', async (req, res) => {
  const b64 = await getSetting('logo_b64');
  if (!b64) return res.status(404).send('No logo');
  const [header, data] = b64.split(',');
  const mime = header.match(/:(.*?);/)[1];
  res.setHeader('Content-Type', mime);
  res.send(Buffer.from(data, 'base64'));
});

// ─── Settings (SMTP) ───────────────────────────────────────────────────────

async function getSetting(key) {
  const row = (await sql`SELECT value FROM settings WHERE key=${key}`)[0];
  return row ? row.value : (process.env[key.toUpperCase()] || '');
}

async function upsertSetting(key, value) {
  await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

app.get('/api/settings/smtp', requireAdmin, async (req, res) => {
  const keys = ['smtp_host','smtp_port','smtp_secure','smtp_user','smtp_from'];
  const result = {};
  for (const k of keys) { result[k] = await getSetting(k); }
  result.smtp_pass = (await getSetting('smtp_pass')) ? '••••••••' : '';
  res.json(result);
});

app.put('/api/settings/smtp', requireAdmin, async (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from } = req.body;
  await upsertSetting('smtp_host',   smtp_host   || '');
  await upsertSetting('smtp_port',   smtp_port   || '587');
  await upsertSetting('smtp_secure', smtp_secure || 'false');
  await upsertSetting('smtp_user',   smtp_user   || '');
  await upsertSetting('smtp_from',   smtp_from   || '');
  if (smtp_pass && smtp_pass !== '••••••••') await upsertSetting('smtp_pass', smtp_pass);
  res.json({ success: true });
});

app.post('/api/settings/smtp/test', requireAdmin, async (req, res) => {
  try {
    const t = await getTransport();
    await t.sendMail({
      from:    await getSetting('smtp_from') || await getSetting('smtp_user'),
      to:      req.user.email,
      subject: 'GENX Expense Report – SMTP Test',
      text:    'SMTP is configured correctly!'
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Export ────────────────────────────────────────────────────────────────

async function getReportsForExport(query, userId) {
  const { reportId, status, from, to, all } = query;
  let rows;
  if (reportId) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=${reportId} ORDER BY r.created_at DESC`;
  } else if (!all && userId && status && from && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.status=${status} AND r.event_date>=${from} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (!all && userId && status && from) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.status=${status} AND r.event_date>=${from} ORDER BY r.created_at DESC`;
  } else if (!all && userId && status && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.status=${status} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (!all && userId && status) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.status=${status} ORDER BY r.created_at DESC`;
  } else if (!all && userId && from && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.event_date>=${from} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (!all && userId && from) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.event_date>=${from} ORDER BY r.created_at DESC`;
  } else if (!all && userId && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (!all && userId) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.user_id=${userId} ORDER BY r.created_at DESC`;
  } else if (status && from && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.status=${status} AND r.event_date>=${from} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (status && from) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.status=${status} AND r.event_date>=${from} ORDER BY r.created_at DESC`;
  } else if (status && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.status=${status} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (status) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.status=${status} ORDER BY r.created_at DESC`;
  } else if (from && to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.event_date>=${from} AND r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else if (from) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.event_date>=${from} ORDER BY r.created_at DESC`;
  } else if (to) {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.event_date<=${to} ORDER BY r.created_at DESC`;
  } else {
    rows = await sql`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`;
  }
  return await Promise.all(rows.map(async r => ({
    ...r,
    expenses: await sql`SELECT * FROM expenses WHERE report_id=${r.id} ORDER BY sort_order, id`
  })));
}

app.get('/api/export/csv', requireAdmin, async (req, res) => {
  const reports = await getReportsForExport(req.query, req.user.id);
  let csv = 'Date,Submitter,Event,Event Date,Status,Vendor,Purpose,Amount,Comments\n';
  reports.forEach(r => {
    if (!r.expenses.length) {
      csv += `"${r.request_date}","${r.username||''}","${r.event_location}","${r.event_date}","${r.status}","","",0,""\n`;
    } else {
      r.expenses.forEach(e => {
        csv += `"${r.request_date}","${r.username||''}","${r.event_location}","${r.event_date}","${r.status}","${e.vendor}","${e.purpose}",${e.amount},"${e.comments||''}"\n`;
      });
    }
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="genx-expense-report.csv"');
  res.send(csv);
});

app.get('/api/export/xlsx', requireAdmin, async (req, res) => {
  const reports = await getReportsForExport(req.query, req.user.id);
  const ExcelJS = getExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GENX Takeover Expense System';
  const ws = wb.addWorksheet('Expense Report');
  ws.columns = [
    { header: 'Submitter',    key: 'username',   width: 18 },
    { header: 'Event',        key: 'event',      width: 26 },
    { header: 'Event Date',   key: 'event_date', width: 14 },
    { header: 'Request Date', key: 'req_date',   width: 14 },
    { header: 'Status',       key: 'status',     width: 12 },
    { header: 'Vendor',       key: 'vendor',     width: 24 },
    { header: 'Purpose',      key: 'purpose',    width: 24 },
    { header: 'Amount',       key: 'amount',     width: 12 },
    { header: 'Comments',     key: 'comments',   width: 30 },
    { header: 'Payment To',   key: 'payment_to', width: 24 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a3f8c' } };
  headerRow.height = 22;
  reports.forEach(r => {
    if (!r.expenses.length) {
      ws.addRow({ username: r.username, event: r.event_location, event_date: r.event_date,
        req_date: r.request_date, status: r.status, vendor:'', purpose:'', amount:0,
        comments:'', payment_to: r.submit_payment_to });
    } else {
      r.expenses.forEach(e => {
        ws.addRow({ username: r.username, event: r.event_location, event_date: r.event_date,
          req_date: r.request_date, status: r.status, vendor: e.vendor, purpose: e.purpose,
          amount: e.amount, comments: e.comments||'', payment_to: r.submit_payment_to });
      });
    }
  });
  ws.getColumn('amount').numFmt = '"$"#,##0.00';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="genx-expense-report.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

app.get('/api/export/qif', requireAdmin, async (req, res) => {
  const reports = await getReportsForExport(req.query, req.user.id);
  let qif = '!Type:Cash\n';
  reports.forEach(r => {
    r.expenses.forEach(e => {
      qif += `D${r.event_date||r.request_date}\n`;
      qif += `T-${Math.abs(parseFloat(e.amount)||0).toFixed(2)}\n`;
      qif += `P${e.vendor}\n`;
      qif += `M${e.purpose} – ${r.event_location}\n`;
      qif += `^\n`;
    });
  });
  res.setHeader('Content-Type', 'application/qif');
  res.setHeader('Content-Disposition', 'attachment; filename="genx-expense-report.qif"');
  res.send(qif);
});

app.get('/api/export/iif', requireAdmin, async (req, res) => {
  const reports = await getReportsForExport(req.query, req.user.id);
  let iif  = '!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n';
  iif +=     '!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n';
  iif +=     '!ENDTRNS\n';
  reports.forEach(r => {
    const total = r.expenses.reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
    const date  = r.event_date || r.request_date;
    iif += `TRNS\tEXPENSE\t${date}\tAccounts Payable\t${r.submit_payment_to||r.username}\t-${total.toFixed(2)}\t${r.event_location}\n`;
    r.expenses.forEach(e => {
      iif += `SPL\tEXPENSE\t${date}\tTravel:${e.purpose}\t${e.vendor}\t${(parseFloat(e.amount)||0).toFixed(2)}\t${e.comments||e.purpose}\n`;
    });
    iif += 'ENDTRNS\n';
  });
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="genx-expense-report.iif"');
  res.send(iif);
});

// ─── PDF Generation (pdfkit – no Chrome required) ─────────────────────────

function findLogo() {
  const dir = path.join(__dir, 'public', 'assets');
  for (const ext of ['.png','.jpg','.jpeg','.webp']) {
    const fp = path.join(dir, 'logo'+ext);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

async function getLogoBuffer() {
  const b64 = await getSetting('logo_b64');
  if (b64) {
    const [, data] = b64.split(',');
    return Buffer.from(data, 'base64');
  }
  const fp = findLogo();
  if (fp) return fs.readFileSync(fp);
  return null;
}

async function generatePDF(report) {
  const logoBuf = await getLogoBuffer();
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = getPDFDocument();
      const doc  = new PDFDocument({ size: 'LETTER', margins: { top: 0, bottom: 40, left: 50, right: 50 }, bufferPages: true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W   = doc.page.width;
      const COL = W - 100;
      const BLUE = '#1a3f8c';
      const RED  = '#b91c1c';

      // ── Header band
      doc.rect(0, 0, W, 88).fill(BLUE);

      // Logo
      if (logoBuf) {
        try { doc.image(logoBuf, 50, 10, { fit: [180, 68], align: 'left', valign: 'center' }); } catch(_){
          doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('GENX TAKEOVER', 50, 28);
        }
      } else {
        doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('GENX TAKEOVER', 50, 28);
      }

      // Red accent bar
      doc.rect(0, 88, W, 5).fill(RED);

      // Title
      doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
         .text('TRAVEL REIMBURSEMENT / EXPENSE REQUEST', 240, 24, { width: W - 290, align: 'right' });
      doc.fillColor('rgba(255,255,255,0.7)').fontSize(9).font('Helvetica')
         .text('GENX TAKEOVER Comedy Tour', 240, 44, { width: W - 290, align: 'right' });

      let y = 108;

      // ── Meta grid
      const metaCells = [
        { label: 'REQUEST DATE',    value: report.request_date    || '—' },
        { label: 'EVENT LOCATION',  value: report.event_location  || '—' },
        { label: 'EVENT DATE',      value: report.event_date      || '—' },
        { label: 'SUBMIT PAYMENT TO', value: report.submit_payment_to || report.username || '—' },
      ];
      const cellW = COL / metaCells.length;
      doc.rect(50, y, COL, 48).fill('#f0f4f8');
      metaCells.forEach((cell, i) => {
        const cx = 50 + i * cellW;
        if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + 48).stroke('#d0d7e2');
        doc.fillColor('#6b7280').fontSize(8).font('Helvetica-Bold')
           .text(cell.label, cx + 10, y + 8, { width: cellW - 20 });
        doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold')
           .text(cell.value, cx + 10, y + 22, { width: cellW - 20 });
      });
      doc.rect(50, y, COL, 48).stroke('#d0d7e2');
      y += 60;

      // ── Expenses table header
      const colW = [COL * 0.28, COL * 0.25, COL * 0.13, COL * 0.34];
      const colX = colW.reduce((acc, w, i) => { acc.push(i === 0 ? 50 : acc[i-1] + colW[i-1]); return acc; }, []);
      const headers = ['VENDOR / PAYEE', 'PURPOSE / CATEGORY', 'AMOUNT', 'COMMENTS'];

      doc.rect(50, y, COL, 22).fill(BLUE);
      headers.forEach((h, i) => {
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
           .text(h, colX[i] + 6, y + 7, { width: colW[i] - 8 });
      });
      y += 22;

      // ── Expense rows
      const expenses = report.expenses || [];
      expenses.forEach((exp, idx) => {
        const rowH = 22;
        if (y + rowH > doc.page.height - 100) { doc.addPage(); y = 60; }
        doc.rect(50, y, COL, rowH).fill(idx % 2 === 0 ? '#ffffff' : '#f8fafc');
        const cells = [exp.vendor||'', exp.purpose||'', `$${(parseFloat(exp.amount)||0).toFixed(2)}`, exp.comments||''];
        cells.forEach((val, i) => {
          doc.fillColor('#111827').fontSize(9).font('Helvetica')
             .text(val, colX[i] + 6, y + 6, { width: colW[i] - 8, height: rowH - 4, ellipsis: true });
        });
        doc.rect(50, y, COL, rowH).stroke('#e5e7eb');
        y += rowH;
      });

      // ── Total row
      const total = expenses.reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
      doc.rect(50, y, COL, 28).fill(BLUE);
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
         .text('TOTAL REIMBURSEMENT REQUEST', 56, y + 8, { width: COL * 0.6 });
      doc.fillColor('#f39c12').fontSize(13).font('Helvetica-Bold')
         .text(`$${total.toFixed(2)}`, 56, y + 7, { width: COL - 12, align: 'right' });
      y += 40;

      // ── Status badge
      const statusColor = { approved: '#16a34a', rejected: '#dc2626', submitted: '#d97706', draft: '#6b7280' };
      const sc = statusColor[report.status] || '#6b7280';
      doc.rect(50, y, 100, 22).fill(sc).roundedRect(50, y, 100, 22, 4).fill(sc);
      doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
         .text(report.status.toUpperCase(), 50, y + 7, { width: 100, align: 'center' });
      if (report.admin_notes) {
        doc.fillColor('#374151').fontSize(9).font('Helvetica-Oblique')
           .text(`Admin Notes: ${report.admin_notes}`, 160, y + 7, { width: COL - 110 });
      }
      y += 34;

      // ── Footer note
      doc.moveTo(50, y).lineTo(50 + COL, y).stroke('#e5e7eb');
      y += 10;
      doc.fillColor(RED).fontSize(8.5).font('Helvetica-Bold')
         .text('NOTE: All reimbursements require itemized receipts.', 50, y);
      y += 14;
      doc.fillColor('#374151').fontSize(8.5).font('Helvetica')
         .text('Email completed forms to: Therealslimsherri@gmail.com   cc: Thedadbodveteran@outlook.com', 50, y);

      // ── Submitted by / date
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fillColor('#9ca3af').fontSize(7.5).font('Helvetica')
           .text(`Submitted by: ${report.username || ''}  |  Generated: ${new Date().toLocaleDateString()}  |  Page ${i+1} of ${pageCount}`,
                 50, doc.page.height - 25, { width: COL, align: 'center' });
      }

      doc.end();
    } catch(e) { reject(e); }
  });
}

app.get('/api/reports/:id/pdf', requireLogin, async (req, res) => {
  const report = await getFullReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin && report.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  try {
    const pdf = await generatePDF(report);
    const filename = `expense-${(report.event_location||'report').replace(/[^a-z0-9]/gi,'-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// ─── Email ─────────────────────────────────────────────────────────────────

async function getTransport() {
  return nodemailer.createTransport({
    host:   await getSetting('smtp_host') || 'smtp.gmail.com',
    port:   parseInt(await getSetting('smtp_port')) || 587,
    secure: (await getSetting('smtp_secure')) === 'true',
    auth:   { user: await getSetting('smtp_user'), pass: await getSetting('smtp_pass') }
  });
}

async function sendStatusEmail(report, status, message, notes) {
  const smtp = await getSetting('smtp_user');
  if (!smtp || !report.email) return;
  const subjectMap = { approved: '✅ Expense Report Approved', rejected: '❌ Expense Report Rejected', paid: '💳 Expense Report Payment Processed' };
  const t = await getTransport();
  await t.sendMail({
    from: await getSetting('smtp_from') || smtp,
    to:   report.email,
    subject: `${subjectMap[status]||status} – ${report.event_location}`,
    html: `<h2>${subjectMap[status]||status}</h2>
           <p>Hi ${report.username},</p>
           <p>${message}</p>
           ${notes ? `<p><b>Notes:</b> ${notes}</p>` : ''}
           <p>Log in to view your report: <a href="http://localhost:3000/app">GENX Expense Portal</a></p>`
  });
}

async function sendSubmissionEmail(reportId, submitter) {
  const smtp = await getSetting('smtp_user');
  if (!smtp) return; // Skip if not configured
  const report = await getFullReport(reportId);
  if (!report) return;
  const total = (report.expenses||[]).reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
  try {
    const pdf = await generatePDF(report);
    const fname = `expense-${(report.event_location||'report').replace(/[^a-z0-9]/gi,'-')}-${report.event_date||'report'}.pdf`;
    const t = await getTransport();
    await t.sendMail({
      from:    await getSetting('smtp_from') || smtp,
      to:      'Therealslimsherri@gmail.com',
      cc:      'Thedadbodveteran@outlook.com',
      subject: `Expense Report: ${report.event_location} – ${report.event_date} ($${total.toFixed(2)})`,
      html: `<h2>New Expense Report Submitted</h2>
             <p><b>From:</b> ${submitter.username} (${submitter.email})</p>
             <p><b>Event:</b> ${report.event_location} on ${report.event_date}</p>
             <p><b>Total:</b> $${total.toFixed(2)}</p>
             <p>PDF attached. Login to admin panel to approve/reject.</p>`,
      attachments: [{ filename: fname, content: pdf, contentType: 'application/pdf' }]
    });
  } catch(e) { console.error('Email send failed:', e.message); }
}

// ─── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nGENX Expense Report running at http://localhost:${PORT}\n`);
});

module.exports = app;
