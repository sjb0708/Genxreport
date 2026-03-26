/* ═══════════════════════════════════════════════════════════
   GENX TAKEOVER – User App (app.js) v2
═══════════════════════════════════════════════════════════ */

let currentUser    = null;
let reports        = [];
let tourStops      = [];
let currentReport  = null;
let editingExpId   = null;
let uploadExpenseId= null;
let cameraStream   = null;

// ─── Toast Notifications ───────────────────────────────────

function toast(msg, type = 'success', duration = 3500) {
  const icons = { success:'✓', error:'✕', warning:'!', info:'i' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icons[type]||'i'}</div>
    <span style="flex:1">${msg}</span>
    <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast')?.remove(),300)">✕</button>
  `;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); }, duration);
}

function appStatusLabel(s) {
  return { draft:'Draft', submitted:'Submitted', under_review:'Under Review', approved:'Approved', rejected:'Rejected', paid:'Paid' }[s] || s;
}

// ─── Modal helpers ─────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ─── Panel switching ───────────────────────────────────────

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');
  const navItem = document.querySelector(`.nav-item[onclick*="'${name}'"]`);
  if (navItem) navItem.classList.add('active');
  const titles = { reports:'Expense Reports', settings:'Account Settings' };
  document.getElementById('panelTitle').textContent = titles[name] || name;
}

// ─── Lightbox ──────────────────────────────────────────────

document.getElementById('lightboxClose').onclick = () => {
  document.getElementById('lightbox').classList.remove('open');
};
document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target === document.getElementById('lightbox'))
    document.getElementById('lightbox').classList.remove('open');
});

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}

// ─── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentUser = await res.json();

  // Update sidebar
  document.getElementById('sidebarUsername').textContent = currentUser.username;
  document.getElementById('sidebarRole').textContent = currentUser.role;
  document.getElementById('userAvatar').textContent = currentUser.username[0].toUpperCase();

  if (currentUser.role === 'admin' || currentUser.role === 'superadmin') {
    document.getElementById('adminLink').style.display = 'flex';
  }

  // Logo
  fetch('/api/logo').then(r=>r.json()).then(d => {
    if (d.path) {
      const img = document.getElementById('sidebarLogo');
      img.src = d.path + '?t=' + Date.now();
      img.style.display = 'block';
      document.getElementById('sidebarBrand').style.display = 'none';
    }
  }).catch(()=>{});

  // Set today's date as default
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('nrReqDate').value = today;

  await Promise.all([loadReports(), loadTourStops()]);
  loadNotifications();
  setInterval(loadNotifications, 30000);

  // Check for report ID in hash
  if (window.location.hash) {
    const id = window.location.hash.slice(1);
    const r = reports.find(x => x.id === id);
    if (r) openReport(r.id);
  }
});

// ─── Notifications ─────────────────────────────────────────

let notifOpen = false;

async function loadNotifications() {
  const res = await fetch('/api/notifications');
  if (!res.ok) return;
  const { notifications, unread } = await res.json();
  const badge = document.getElementById('notifBadge');
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
  const list = document.getElementById('notifList');
  if (!notifications.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No notifications yet</div>';
    return;
  }
  list.innerHTML = notifications.map(n => `
    <div onclick="readNotif('${n.id}',this)" style="padding:12px 16px;border-bottom:1px solid #f3f4f6;cursor:pointer;background:${n.read?'#fff':'#f0f7ff'};transition:background 0.15s;"
         onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='${n.read?'#fff':'#f0f7ff'}'">
      <div style="font-size:13px;color:#111827;line-height:1.4;">${n.message}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${n.created_at.slice(0,16).replace('T',' ')}</div>
    </div>`).join('');
}

function toggleNotifPanel() {
  notifOpen = !notifOpen;
  document.getElementById('notifPanel').style.display = notifOpen ? 'block' : 'none';
  if (notifOpen) loadNotifications();
}

async function markAllRead() {
  await fetch('/api/notifications/read-all', { method:'POST' });
  loadNotifications();
}

async function readNotif(id, el) {
  await fetch(`/api/notifications/${id}/read`, { method:'POST' });
  el.style.background = '#fff';
  loadNotifications();
}

document.addEventListener('click', e => {
  if (notifOpen && !e.target.closest('#notifPanel') && !e.target.closest('#notifBell')) {
    notifOpen = false;
    document.getElementById('notifPanel').style.display = 'none';
  }
});

// ─── Logout ────────────────────────────────────────────────

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// ─── Tour Stops ────────────────────────────────────────────

async function loadTourStops() {
  const res = await fetch('/api/tour-stops');
  tourStops = await res.json();
  populateTourStopDropdowns();
}

function populateTourStopDropdowns() {
  const today = new Date().toISOString().slice(0, 10);

  ['nrTourStop', 'erTourStop'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;

    // Keep first two fixed options
    sel.innerHTML = `
      <option value="">Select a tour stop…</option>
      <option value="custom">✎ Enter custom location</option>
    `;

    // Group: upcoming vs past
    const upcoming = tourStops.filter(s => s.event_date >= today);
    const past     = tourStops.filter(s => s.event_date < today);

    if (upcoming.length) {
      const grp = document.createElement('optgroup');
      grp.label = '📅 Upcoming Shows';
      upcoming.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.venue}  —  ${formatDate(s.event_date)}`;
        opt.dataset.venue = s.venue;
        opt.dataset.date  = s.event_date;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    }

    if (past.length) {
      const grp = document.createElement('optgroup');
      grp.label = '📁 Past Shows';
      past.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.venue}  —  ${formatDate(s.event_date)}`;
        opt.dataset.venue = s.venue;
        opt.dataset.date  = s.event_date;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    }
  });
}

function onTourStopSelect() {
  const sel    = document.getElementById('nrTourStop');
  const custom = document.getElementById('nrCustomRow');
  const selOpt = sel.options[sel.selectedIndex];

  if (sel.value === 'custom') {
    custom.style.display = 'block';
    document.getElementById('nrEventDate').value = '';
    document.getElementById('nrLocation').value  = '';
  } else if (sel.value) {
    custom.style.display = 'none';
    document.getElementById('nrEventDate').value = selOpt.dataset.date  || '';
    document.getElementById('nrLocation').value  = selOpt.dataset.venue || '';
  } else {
    custom.style.display = 'none';
    document.getElementById('nrEventDate').value = '';
  }
}

function onEditTourStopSelect() {
  const sel    = document.getElementById('erTourStop');
  const selOpt = sel.options[sel.selectedIndex];
  if (sel.value && sel.value !== 'custom') {
    document.getElementById('erLocation').value  = selOpt.dataset.venue || '';
    document.getElementById('erEventDate').value = selOpt.dataset.date  || '';
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(m)}/${parseInt(d)}/${y}`;
}

// ─── Load Reports ──────────────────────────────────────────

async function loadReports() {
  const skel = document.getElementById('reportsSkeleton');
  const list = document.getElementById('reportsList');
  skel.style.display = 'block';
  list.style.display = 'none';

  const res  = await fetch('/api/reports');
  reports    = await res.json();

  skel.style.display = 'none';
  list.style.display = 'block';

  const drafts = reports.filter(r => r.status === 'draft').length;
  const badge  = document.getElementById('draftBadge');
  if (drafts > 0) { badge.textContent = drafts; badge.style.display = 'inline-flex'; }
  else { badge.style.display = 'none'; }

  renderReportList();
}

function renderReportList() {
  const el = document.getElementById('reportsList');
  if (!reports.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <h3>No expense reports yet</h3>
        <p>Create your first expense report to get started.</p>
        <button class="btn btn-primary" onclick="openModal('newReportModal')">✚ Create First Report</button>
      </div>`;
    return;
  }

  const statusOrder = { submitted:0, under_review:1, draft:2, rejected:3, approved:4, paid:5 };
  const sorted = [...reports].sort((a,b) => (statusOrder[a.status]||9) - (statusOrder[b.status]||9) || (b.created_at||'').localeCompare(a.created_at||''));

  el.innerHTML = sorted.map(r => `
    <div class="report-card ${r.status} ${currentReport?.id === r.id ? 'active-report' : ''}"
         onclick="openReport('${r.id}')" id="card-${r.id}">
      <div class="report-card-top">
        <div class="report-card-location">${esc(r.event_location||'—')}</div>
        <span class="badge badge-${r.status}">${appStatusLabel(r.status)}</span>
      </div>
      <div class="report-card-meta">
        <span>📅 Event: ${r.event_date||'—'}</span>
        <span>📝 ${r.expense_count||0} item${(r.expense_count||0)===1?'':'s'}</span>
        <span>🕐 ${r.submitted_at ? 'Submitted '+r.submitted_at.slice(0,10) : 'Draft'}</span>
      </div>
      <div class="report-card-total">$${parseFloat(r.total||0).toFixed(2)}</div>
    </div>
  `).join('');
}

// ─── Open Report Detail ────────────────────────────────────

async function openReport(id) {
  try {
    const res = await fetch('/api/reports/' + id);
    if (!res.ok) { toast('Could not load report.', 'error'); return; }
    currentReport = await res.json();

    // Highlight selected card
    document.querySelectorAll('.report-card').forEach(c => c.classList.remove('active-report'));
    document.getElementById('card-' + id)?.classList.add('active-report');

    renderReportDetail();
    const detail = document.getElementById('reportDetail');
    detail.style.display = 'block';
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', '#' + id);
  } catch(e) {
    toast('Error opening report: ' + e.message, 'error');
  }
}

function renderReportDetail() {
  const r   = currentReport;
  const isDraft = r.status === 'draft';
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'superadmin';

  document.getElementById('detailLocation').textContent = r.event_location || '—';
  document.getElementById('detailMeta').textContent = `Event: ${r.event_date||'—'} · Request: ${r.request_date||'—'} · Pay to: ${r.submit_payment_to||'—'} · Method: ${r.payment_method||'check'}`;

  const statusEl = document.getElementById('detailStatus');
  statusEl.className = `badge badge-${r.status}`;
  statusEl.textContent = appStatusLabel(r.status);

  document.getElementById('detailPdfBtn').href = `/api/reports/${r.id}/pdf`;
  document.getElementById('detailEditBtn').style.display  = isDraft || isAdmin ? 'inline-flex' : 'none';
  document.getElementById('detailSubmitBtn').style.display= isDraft ? 'inline-flex' : 'none';
  document.getElementById('detailDeleteBtn').style.display= isDraft || isAdmin ? 'inline-flex' : 'none';
  document.getElementById('addExpenseBtn').style.display  = isDraft ? 'inline-flex' : 'none';

  // Admin status action buttons
  const adminActions = document.getElementById('adminStatusActions');
  if (isAdmin) {
    let btns = '';
    if (r.status === 'submitted') {
      btns += `<button class="action-btn" style="background:#ede9fe;color:#6d28d9;" onclick="appMarkUnderReview()">🔍 Under Review</button>`;
      btns += `<button class="action-btn action-btn-green" onclick="appApprove()">✓ Approve</button>`;
      btns += `<button class="action-btn action-btn-red" onclick="openModal('appRejectModal')">✕ Reject</button>`;
    } else if (r.status === 'under_review') {
      btns += `<button class="action-btn action-btn-green" onclick="appApprove()">✓ Approve</button>`;
      btns += `<button class="action-btn action-btn-red" onclick="openModal('appRejectModal')">✕ Reject</button>`;
    } else if (r.status === 'approved') {
      btns += `<button class="action-btn" style="background:#d1fae5;color:#065f46;" onclick="openModal('appPaidModal')">💳 Mark Paid</button>`;
      btns += `<button class="action-btn action-btn-gray" onclick="appReopen()">↩ Reopen</button>`;
    } else if (r.status === 'rejected') {
      btns += `<button class="action-btn action-btn-gray" onclick="appReopen()">↩ Reopen</button>`;
    }
    adminActions.innerHTML = btns;
    adminActions.style.display = btns ? 'flex' : 'none';
  } else {
    adminActions.style.display = 'none';
  }

  // Status banner (admin notes, under review, paid)
  const banner = document.getElementById('adminNotesBanner');
  if (r.status === 'under_review') {
    document.getElementById('adminNotesText').textContent = '🔍 This report is currently under review by the admin.';
    banner.style.display = 'flex';
    banner.style.background = '#ede9fe';
    banner.style.borderColor = '#c4b5fd';
    banner.style.color = '#6d28d9';
  } else if (r.status === 'paid') {
    document.getElementById('adminNotesText').textContent = `✅ Payment processed${r.paid_at ? ' on ' + r.paid_at.slice(0,10) : ''}${r.paid_notes ? ' — ' + r.paid_notes : ''}.`;
    banner.style.display = 'flex';
    banner.style.background = '#d1fae5';
    banner.style.borderColor = '#6ee7b7';
    banner.style.color = '#065f46';
  } else if (r.admin_notes) {
    document.getElementById('adminNotesText').textContent = r.admin_notes;
    banner.style.display = 'flex';
    banner.style.background = '';
    banner.style.borderColor = '';
    banner.style.color = '';
  } else {
    banner.style.display = 'none';
  }

  renderExpenses();
}

function renderExpenses() {
  const r      = currentReport;
  const isDraft= r.status === 'draft';
  const isAdmin= currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin');
  const el     = document.getElementById('expensesList');
  const total  = (r.expenses||[]).reduce((s, e) => s + parseFloat(e.amount||0), 0);

  document.getElementById('detailExpCount').textContent = `${(r.expenses||[]).length} item${(r.expenses||[]).length===1?'':'s'}`;
  document.getElementById('detailTotal').textContent = '$' + total.toFixed(2);

  if (!r.expenses?.length) {
    el.innerHTML = `<div class="table-empty"><div class="table-empty-icon">💳</div><p>No expenses yet. Add your first expense item.</p></div>`;
    return;
  }

  el.innerHTML = r.expenses.map(exp => `
    <div class="expense-row" id="exp-${exp.id}">
      <div class="expense-row-top">
        <div class="expense-vendor">${esc(exp.vendor||'—')}</div>
        <span class="expense-purpose">${esc(exp.purpose||'—')}</span>
        <div class="expense-amount">$${parseFloat(exp.amount||0).toFixed(2)}</div>
      </div>
      ${exp.comments ? `<div class="expense-comments">💬 ${esc(exp.comments)}</div>` : ''}
      <div class="receipt-thumbs" id="thumbs-${exp.id}">${renderThumbs(exp, isDraft)}</div>
      ${isDraft || isAdmin ? `
      <div class="expense-actions">
        ${isDraft ? `<button class="action-btn action-btn-gray" onclick="openEditExpense('${exp.id}')">✎ Edit</button>` : ''}
        <button class="action-btn action-btn-blue" onclick="openUploadModal('${exp.id}','${esc(exp.vendor)}')">📎 Receipts</button>
        ${isDraft ? `<button class="action-btn action-btn-red"  onclick="deleteExpense('${exp.id}')">🗑 Delete</button>` : ''}
      </div>` : ''}
    </div>
  `).join('');
}

function renderThumbs(exp, isDraft) {
  return (exp.receipts||[]).map(r => {
    const url = `/uploads/${r.filename}`;
    const isImg = /\.(jpg|jpeg|png|gif|webp)/i.test(r.filename);
    if (!isImg) return `
      <div class="receipt-thumb" onclick="window.open('${url}','_blank')" title="${esc(r.original_name)}">
        <div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:22px;">📄</div>
        ${isDraft ? `<button class="del-receipt" onclick="event.stopPropagation();deleteReceipt('${r.id}')">✕</button>` : ''}
      </div>`;
    return `
      <div class="receipt-thumb" onclick="openLightbox('${url}')" title="${esc(r.original_name)}">
        <img src="${url}" alt="${esc(r.original_name)}" loading="lazy">
        ${isDraft ? `<button class="del-receipt" onclick="event.stopPropagation();deleteReceipt('${r.id}')">✕</button>` : ''}
      </div>`;
  }).join('');
}

// ─── Create Report ─────────────────────────────────────────

async function createReport() {
  const stopSel = document.getElementById('nrTourStop');
  const stopVal = stopSel.value;
  const selOpt  = stopSel.options[stopSel.selectedIndex];

  // Resolve location and event date from dropdown or custom input
  let loc, eDate;
  if (stopVal === 'custom') {
    loc   = document.getElementById('nrLocation').value.trim();
    eDate = document.getElementById('nrEventDate').value;
  } else if (stopVal) {
    loc   = selOpt.dataset.venue || '';
    eDate = selOpt.dataset.date  || document.getElementById('nrEventDate').value;
  } else {
    loc   = '';
    eDate = document.getElementById('nrEventDate').value;
  }

  const rDate= document.getElementById('nrReqDate').value;
  const payTo= document.getElementById('nrPayTo').value.trim();
  const meth = document.getElementById('nrPayMethod').value;
  const msgEl= document.getElementById('newReportMsg');

  if (!loc)  { msgEl.innerHTML = '<div class="error-inline">Please select a tour stop or enter a custom location.</div>'; return; }
  if (!rDate){ msgEl.innerHTML = '<div class="error-inline">Request date is required.</div>'; return; }

  msgEl.innerHTML = '';
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_date:rDate, event_location:loc, event_date:eDate, submit_payment_to:payTo||currentUser.username, payment_method:meth })
  });
  const data = await res.json();
  if (!res.ok) { msgEl.innerHTML = `<div class="error-inline">${esc(data.error)}</div>`; return; }

  closeModal('newReportModal');
  document.getElementById('nrTourStop').value = '';
  document.getElementById('nrLocation').value = '';
  document.getElementById('nrEventDate').value = '';
  document.getElementById('nrCustomRow').style.display = 'none';
  toast('Report created! Add your expense items below.', 'success');
  await loadReports();
  openReport(data.id);
}

// ─── Edit Report ───────────────────────────────────────────

function openEditReport() {
  const r = currentReport;
  document.getElementById('erReqDate').value   = r.request_date     || '';
  document.getElementById('erEventDate').value = r.event_date       || '';
  document.getElementById('erLocation').value  = r.event_location   || '';
  document.getElementById('erPayTo').value     = r.submit_payment_to|| '';
  document.getElementById('erPayMethod').value = r.payment_method   || 'check';
  document.getElementById('editReportMsg').innerHTML = '';

  // Try to match to a known tour stop
  const sel = document.getElementById('erTourStop');
  if (sel) {
    const match = tourStops.find(s => s.venue === r.event_location && s.event_date === r.event_date);
    sel.value = match ? match.id : 'custom';
  }

  openModal('editReportModal');
}

async function saveReportEdit() {
  const res = await fetch('/api/reports/' + currentReport.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_date:     document.getElementById('erReqDate').value,
      event_location:   document.getElementById('erLocation').value.trim(),
      event_date:       document.getElementById('erEventDate').value,
      submit_payment_to:document.getElementById('erPayTo').value.trim(),
      payment_method:   document.getElementById('erPayMethod').value
    })
  });
  if (!res.ok) { const d = await res.json(); document.getElementById('editReportMsg').innerHTML = `<div class="error-inline">${esc(d.error)}</div>`; return; }
  closeModal('editReportModal');
  toast('Report details updated.', 'success');
  await refreshReport();
  loadReports();
}

// ─── Delete Report ─────────────────────────────────────────

async function deleteReport() {
  if (!confirm('Delete this expense report? This cannot be undone.')) return;
  const res = await fetch('/api/reports/' + currentReport.id, { method: 'DELETE' });
  if (!res.ok) { toast('Failed to delete report.', 'error'); return; }
  currentReport = null;
  document.getElementById('reportDetail').style.display = 'none';
  window.history.replaceState(null, '', window.location.pathname);
  toast('Report deleted.', 'warning');
  await loadReports();
}

// ─── Submit Modal ──────────────────────────────────────────

function openSubmitModal() {
  const r     = currentReport;
  const total = (r.expenses||[]).reduce((s,e)=>s+parseFloat(e.amount||0),0);
  document.getElementById('submitSummary').innerHTML = `
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div><span style="color:#6b7280;display:block;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Event</span><strong>${esc(r.event_location||'—')}</strong></div>
        <div><span style="color:#6b7280;display:block;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Event Date</span><strong>${r.event_date||'—'}</strong></div>
        <div><span style="color:#6b7280;display:block;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Items</span><strong>${(r.expenses||[]).length}</strong></div>
        <div><span style="color:#6b7280;display:block;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Total</span><strong style="color:#1a3f8c;font-size:18px;">$${total.toFixed(2)}</strong></div>
      </div>
    </div>`;
  openModal('submitModal');
}

async function confirmSubmit() {
  const res = await fetch(`/api/reports/${currentReport.id}/submit`, { method: 'POST' });
  const d   = await res.json();
  if (!res.ok) { toast(d.error || 'Submit failed', 'error'); return; }
  closeModal('submitModal');
  toast('Report submitted for review! 🎉', 'success', 5000);
  await refreshReport();
  loadReports();
}

// ─── Admin Status Actions (from app view) ──────────────────

async function appMarkUnderReview() {
  const res = await fetch(`/api/reports/${currentReport.id}/under_review`, { method: 'POST' });
  const d = await res.json();
  if (!res.ok) { toast(d.error || 'Failed', 'error'); return; }
  toast('Marked as Under Review', 'info');
  await refreshReport(); loadReports();
}

async function appApprove() {
  const res = await fetch(`/api/reports/${currentReport.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: '' })
  });
  if (!res.ok) { toast('Approve failed', 'error'); return; }
  toast('Report approved! ✓', 'success');
  await refreshReport(); loadReports();
}

async function appConfirmReject() {
  const notes = document.getElementById('appRejectNotes').value.trim();
  if (!notes) { toast('Please provide a reason for rejection.', 'error'); return; }
  const res = await fetch(`/api/reports/${currentReport.id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes })
  });
  if (!res.ok) { toast('Reject failed', 'error'); return; }
  closeModal('appRejectModal');
  toast('Report rejected.', 'warning');
  await refreshReport(); loadReports();
}

async function appConfirmPaid() {
  const notes = document.getElementById('appPaidNotes').value.trim();
  const res = await fetch(`/api/reports/${currentReport.id}/paid`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes })
  });
  const d = await res.json();
  if (!res.ok) { toast(d.error || 'Failed', 'error'); return; }
  closeModal('appPaidModal');
  toast('Payment recorded! 💳', 'success');
  await refreshReport(); loadReports();
}

async function appReopen() {
  const res = await fetch(`/api/reports/${currentReport.id}/reopen`, { method: 'POST' });
  if (!res.ok) { toast('Reopen failed', 'error'); return; }
  toast('Report reopened to draft.', 'info');
  await refreshReport(); loadReports();
}

// ─── Expenses ──────────────────────────────────────────────

function openAddExpense() {
  editingExpId = null;
  document.getElementById('expenseModalTitle').textContent = 'Add Expense Item';
  document.getElementById('expenseSaveBtn').textContent    = 'Add Expense';
  document.getElementById('expVendor').value   = '';
  document.getElementById('expPurpose').value  = '';
  document.getElementById('expAmount').value   = '';
  document.getElementById('expComments').value = '';
  document.getElementById('expenseMsg').innerHTML = '';
  const rf = document.getElementById('expReceiptFile');
  const rc = document.getElementById('expReceiptCamera');
  const rp = document.getElementById('expReceiptPreview');
  if (rf) rf.value = '';
  if (rc) rc.value = '';
  if (rp) rp.textContent = '';
  openModal('expenseModal');
  setTimeout(() => document.getElementById('expVendor').focus(), 100);
}

function openEditExpense(expId) {
  const exp = currentReport.expenses.find(e => e.id === expId);
  if (!exp) return;
  editingExpId = expId;
  document.getElementById('expenseModalTitle').textContent = 'Edit Expense Item';
  document.getElementById('expenseSaveBtn').textContent    = 'Save Changes';
  document.getElementById('expVendor').value   = exp.vendor   || '';
  document.getElementById('expPurpose').value  = exp.purpose  || '';
  document.getElementById('expAmount').value   = exp.amount   || '';
  document.getElementById('expComments').value = exp.comments || '';
  document.getElementById('expenseMsg').innerHTML = '';
  openModal('expenseModal');
}

async function saveExpense() {
  const vendor   = document.getElementById('expVendor').value.trim();
  const purpose  = document.getElementById('expPurpose').value;
  const amount   = parseFloat(document.getElementById('expAmount').value);
  const comments = document.getElementById('expComments').value.trim();
  const msgEl    = document.getElementById('expenseMsg');

  if (!vendor)             { msgEl.innerHTML = '<div class="error-inline">Vendor is required.</div>'; return; }
  if (!purpose)            { msgEl.innerHTML = '<div class="error-inline">Category is required.</div>'; return; }
  if (isNaN(amount)||amount<=0){ msgEl.innerHTML = '<div class="error-inline">Enter a valid amount.</div>'; return; }
  msgEl.innerHTML = '';

  const btn = document.getElementById('expenseSaveBtn');
  btn.disabled = true;

  let res;
  if (editingExpId) {
    res = await fetch(`/api/expenses/${editingExpId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor, purpose, amount, comments })
    });
  } else {
    res = await fetch(`/api/reports/${currentReport.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor, purpose, amount, comments })
    });
  }

  btn.disabled = false;
  if (!res.ok) { const d = await res.json(); msgEl.innerHTML = `<div class="error-inline">${esc(d.error)}</div>`; return; }

  const data = await res.json();
  const expId = editingExpId || data.id;

  // Upload any attached receipts
  const fileInputs = [
    document.getElementById('expReceiptFile'),
    document.getElementById('expReceiptCamera')
  ];
  const allFiles = [];
  fileInputs.forEach(inp => { if (inp) Array.from(inp.files).forEach(f => allFiles.push(f)); });
  if (allFiles.length && expId) {
    const form = new FormData();
    allFiles.forEach(f => form.append('receipts', f));
    await fetch(`/api/expenses/${expId}/receipts`, { method: 'POST', body: form });
  }

  closeModal('expenseModal');
  toast(editingExpId ? 'Expense updated.' : `Expense added: $${amount.toFixed(2)}`, 'success');
  await refreshReport();
  loadReports();
}

function previewExpReceipts(files) {
  const prev = document.getElementById('expReceiptPreview');
  if (!prev) return;
  const names = Array.from(files).map(f => f.name).join(', ');
  prev.textContent = names ? `Selected: ${names}` : '';
}

async function deleteExpense(expId) {
  if (!confirm('Remove this expense item?')) return;
  const res = await fetch('/api/expenses/' + expId, { method: 'DELETE' });
  if (!res.ok) { toast('Failed to delete expense.', 'error'); return; }
  toast('Expense removed.', 'warning');
  await refreshReport();
  loadReports();
}

// ─── Upload Receipts ───────────────────────────────────────

function openUploadModal(expenseId, vendorName) {
  uploadExpenseId = expenseId;
  document.getElementById('uploadExpenseLabel').textContent = vendorName;
  document.getElementById('uploadProgress').style.display  = 'none';
  document.getElementById('progressFill').style.width = '0%';
  openModal('uploadModal');
}

async function uploadFiles(files) {
  if (!files.length || !uploadExpenseId) return;
  const prog   = document.getElementById('uploadProgress');
  const fill   = document.getElementById('progressFill');
  const status = document.getElementById('uploadStatus');
  prog.style.display = 'block';

  const form = new FormData();
  Array.from(files).forEach(f => form.append('receipts', f));

  status.textContent = `Uploading ${files.length} file${files.length>1?'s':''}…`;
  fill.style.width = '30%';

  const res = await fetch(`/api/expenses/${uploadExpenseId}/receipts`, { method: 'POST', body: form });
  fill.style.width = '100%';

  if (!res.ok) {
    const d = await res.json();
    status.textContent = 'Upload failed: ' + (d.error||'Unknown error');
    toast('Upload failed: ' + (d.error||'Unknown error'), 'error');
    return;
  }
  status.textContent = '✓ Uploaded successfully!';
  toast(`${files.length} receipt${files.length>1?'s':''} uploaded.`, 'success');
  await refreshReport();
  renderExpenses();
}

document.getElementById('fileInput').addEventListener('change', e => {
  if (e.target.files.length) uploadFiles(e.target.files);
  e.target.value = '';
});

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

// ─── Camera ────────────────────────────────────────────────

async function openCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    document.getElementById('cameraStream').srcObject = cameraStream;
    openModal('cameraModal');
  } catch(e) {
    toast('Camera access denied or not available.', 'error');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  closeModal('cameraModal');
}

async function capturePhoto() {
  const video  = document.getElementById('cameraStream');
  const canvas = document.getElementById('cameraCanvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stopCamera();
  canvas.toBlob(async blob => {
    const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await uploadFiles([file]);
  }, 'image/jpeg', 0.92);
}

// ─── Delete Receipt ────────────────────────────────────────

async function deleteReceipt(receiptId) {
  const res = await fetch('/api/receipts/' + receiptId, { method: 'DELETE' });
  if (!res.ok) { toast('Failed to delete receipt.', 'error'); return; }
  toast('Receipt removed.', 'warning');
  await refreshReport();
  renderExpenses();
}

// ─── Refresh report data ────────────────────────────────────

async function refreshReport() {
  if (!currentReport) return;
  const res = await fetch('/api/reports/' + currentReport.id);
  currentReport = await res.json();
  renderReportDetail();
}

// ─── Change Password ────────────────────────────────────────

async function changePassword() {
  const curr    = document.getElementById('pwCurrent').value;
  const next    = document.getElementById('pwNew').value;
  const confirm = document.getElementById('pwConfirm').value;
  const msgEl   = document.getElementById('pwMsg');
  msgEl.innerHTML = '';
  if (next !== confirm) { msgEl.innerHTML = '<div class="error-inline">Passwords do not match.</div>'; return; }
  if (next.length < 6)  { msgEl.innerHTML = '<div class="error-inline">Password must be at least 6 characters.</div>'; return; }
  const res = await fetch('/api/auth/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: curr, newPassword: next })
  });
  if (!res.ok) { const d = await res.json(); msgEl.innerHTML = `<div class="error-inline">${esc(d.error)}</div>`; return; }
  msgEl.innerHTML = '<div class="success-inline">✓ Password updated successfully!</div>';
  document.getElementById('pwCurrent').value = '';
  document.getElementById('pwNew').value = '';
  document.getElementById('pwConfirm').value = '';
  toast('Password updated!', 'success');
}

// ─── Helpers ───────────────────────────────────────────────

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
