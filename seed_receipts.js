'use strict';
/**
 * Generate sample receipt PDFs and attach to existing approved/submitted expenses
 * Run: node seed_receipts.js
 */
const Database   = require('better-sqlite3');
const PDFDocument = require('pdfkit');
const path       = require('path');
const fs         = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR   = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'expenses.db'));

// Get expenses that don't already have receipts, on submitted/approved reports
const expenses = db.prepare(`
  SELECT e.*, r.event_location, r.event_date, r.status
  FROM expenses e
  JOIN reports r ON r.id = e.report_id
  WHERE r.status IN ('approved','submitted')
  AND e.id NOT IN (SELECT expense_id FROM receipts WHERE expense_id IS NOT NULL)
`).all();

console.log(`Generating receipts for ${expenses.length} expenses...`);

function pad(n) { return String(n).padStart(2,'0'); }

function randomDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function randomTime() {
  const h = Math.floor(Math.random()*12)+8;
  const m = Math.floor(Math.random()*60);
  const s = Math.floor(Math.random()*60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function generateReceiptId() {
  return Math.floor(Math.random()*9000000+1000000).toString();
}

function generateAuthCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

const categoryMessages = {
  'Airfare':           'Thank you for flying with us. Have a great trip!',
  'Hotel/Lodging':     'Thank you for your stay. We hope to see you again!',
  'Transportation/Gas':'Thank you for your business.',
  'Food & Beverage':   'Thank you! Come back and see us soon.',
  'Parking':           'Thank you for parking with us.',
  'Equipment Rental':  'Thank you for your rental. Equipment due back per agreement.',
  'Office Supplies':   'Thank you for shopping with us.',
  'Marketing/Promotion':'Thank you for your business.',
  'Wardrobe/Costumes': 'Thank you for shopping with us!',
  'Miscellaneous':     'Thank you for your purchase.',
};

function generateReceiptPDF(expense, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [320, 500], margin: 20 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const receiptDate = randomDate(30);
    const receiptTime = randomTime();
    const receiptId   = generateReceiptId();
    const authCode    = generateAuthCode();
    const tax         = parseFloat((expense.amount * 0.08).toFixed(2));
    const subtotal    = parseFloat((expense.amount - tax).toFixed(2));

    // Header
    doc.rect(0, 0, 320, 70).fill('#1a3f8c');
    doc.fillColor('#ffffff')
       .fontSize(16).font('Helvetica-Bold')
       .text(expense.vendor, 20, 14, { width: 280, align: 'center' });
    doc.fontSize(9).font('Helvetica')
       .text('SALES RECEIPT', 20, 36, { width: 280, align: 'center' });
    doc.fontSize(8)
       .text(`Receipt #${receiptId}`, 20, 50, { width: 280, align: 'center' });

    // Date / Time
    doc.fillColor('#374151').fontSize(8).font('Helvetica')
       .text(`Date: ${receiptDate}   Time: ${receiptTime}`, 20, 85, { width: 280, align: 'center' });

    // Divider
    doc.moveTo(20, 100).lineTo(300, 100).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Item line
    doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold')
       .text('DESCRIPTION', 20, 112)
       .text('AMOUNT', 200, 112, { width: 80, align: 'right' });

    doc.moveTo(20, 124).lineTo(300, 124).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    doc.font('Helvetica').fillColor('#374151').fontSize(9)
       .text(expense.purpose, 20, 132, { width: 170 })
       .text(`$${subtotal.toFixed(2)}`, 200, 132, { width: 80, align: 'right' });

    if (expense.comments) {
      doc.fontSize(8).fillColor('#6b7280')
         .text(expense.comments, 20, 148, { width: 170 });
    }

    const taxY = expense.comments ? 162 : 148;

    // Tax
    doc.moveTo(20, taxY + 8).lineTo(300, taxY + 8).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.fontSize(8).fillColor('#6b7280')
       .text('Subtotal', 20, taxY + 14)
       .text(`$${subtotal.toFixed(2)}`, 200, taxY + 14, { width: 80, align: 'right' });
    doc.text('Tax (8%)', 20, taxY + 26)
       .text(`$${tax.toFixed(2)}`, 200, taxY + 26, { width: 80, align: 'right' });

    // Total
    doc.moveTo(20, taxY + 40).lineTo(300, taxY + 40).strokeColor('#1a3f8c').lineWidth(1).stroke();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111827')
       .text('TOTAL', 20, taxY + 46)
       .text(`$${expense.amount.toFixed(2)}`, 200, taxY + 46, { width: 80, align: 'right' });

    // Payment
    doc.moveTo(20, taxY + 64).lineTo(300, taxY + 64).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.fontSize(8).font('Helvetica').fillColor('#6b7280')
       .text('Payment Method: Credit Card', 20, taxY + 70)
       .text(`Auth Code: ${authCode}`, 20, taxY + 82)
       .text('Card: **** **** **** 4521', 20, taxY + 94);

    // Footer message
    const msg = categoryMessages[expense.purpose] || 'Thank you for your business.';
    doc.moveTo(20, taxY + 112).lineTo(300, taxY + 112).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.fontSize(8).fillColor('#9ca3af')
       .text(msg, 20, taxY + 118, { width: 280, align: 'center' });

    // Bottom accent
    const footY = taxY + 140;
    doc.rect(0, footY, 320, 8).fill('#b91c1c');

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

const insertReceipt = db.prepare(`
  INSERT INTO receipts (id, expense_id, report_id, filename, original_name, mimetype, uploaded_at)
  VALUES (?,?,?,?,?,?,datetime('now'))
`);

(async () => {
  let count = 0;
  for (const exp of expenses) {
    // Add 1-2 receipts per expense
    const numReceipts = Math.random() > 0.4 ? 1 : 2;
    for (let i = 0; i < numReceipts; i++) {
      const id       = uuidv4();
      const filename = `receipt-${id}.pdf`;
      const outPath  = path.join(UPLOAD_DIR, filename);
      await generateReceiptPDF(exp, outPath);
      insertReceipt.run(id, exp.id, exp.report_id, filename,
        `${exp.vendor.replace(/[^a-z0-9]/gi,'-')}-receipt.pdf`, 'application/pdf');
      count++;
    }
  }
  console.log(`✅ Created ${count} sample receipts across ${expenses.length} expenses`);
  db.close();
})();
