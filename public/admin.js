/* ═══════════════════════════════════════════════════════════
   GENX TAKEOVER – Admin Panel (admin.js) v2
═══════════════════════════════════════════════════════════ */

let currentAdminUser = null;
let allUsers         = [];
let resetTargetId    = null;
let rejectTargetId   = null;
let paidTargetId     = null;

// ─── Toast ─────────────────────────────────────────────────

function toast(msg, type = 'success', duration = 3500) {
  const icons = { success:'✓', error:'✕', warning:'!', info:'i' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icons[type]||'i'}</div>
    <span style="flex:1">${msg}</span>
    <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast')?.remove(),300)">✕</button>`;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); }, duration);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ─── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentAdminUser = await res.json();

  if (currentAdminUser.role !== 'admin' && currentAdminUser.role !== 'superadmin') {
    window.location.href = '/app'; return;
  }

  document.getElementById('adminUserBadge').textContent = currentAdminUser.username;
  document.getElementById('adminRoleLabel').textContent = currentAdminUser.role;
  document.getElementById('adminAvatar').textContent    = currentAdminUser.username[0].toUpperCase();

  document.getElementById('adminBtnLogout').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  };

  // Logo
  fetch('/api/logo').then(r=>r.json()).then(d => {
    if (d.path) {
      const img = document.getElementById('adminLogoImg');
      img.src = d.path + '?t=' + Date.now();
      img.style.display = 'block';
      document.getElementById('adminLogoText').style.display = 'none';
    }
  }).catch(()=>{});

  // Hide admin role option if not superadmin
  if (currentAdminUser.role !== 'superadmin') {
    document.querySelectorAll('#newUserRole option[value="admin"]').forEach(o => o.remove());
  }

  loadDashboard();
  loadUserFilter();
  loadNotifications();
  setInterval(loadNotifications, 30000);
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

// ─── Panel switching ───────────────────────────────────────

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-panel]').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name)?.classList.add('active');
  document.querySelector(`.nav-item[data-panel="${name}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', reports:'All Reports', export:'Export Data', users:'Users', settings:'Settings', tourstops:'Tour Stop Schedule' };
  document.getElementById('panelTitle').textContent = titles[name] || name;

  // Action buttons
  const actions = document.getElementById('topbarActions');
  if (name === 'users')      actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openModal('createUserModal')">+ New User</button>`;
  else if (name === 'tourstops') actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openAddTourStop()">+ Add Stop</button>`;
  else actions.innerHTML = '';

  if (name === 'reports')   loadAllReports();
  if (name === 'users')     loadUsers();
  if (name === 'settings')  loadSmtpSettings();
  if (name === 'export')    loadUserFilter('exportUser');
  if (name === 'tourstops') loadTourStops();
}

// ─── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const [usersRes, reportsRes] = await Promise.all([
    fetch('/api/admin/users'),
    fetch('/api/admin/reports')
  ]);
  const users   = await usersRes.json();
  const reports = await reportsRes.json();

  // Update pending badge
  const pending = reports.filter(r => r.status === 'submitted').length;
  const badge   = document.getElementById('pendingNavBadge');
  if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline-flex'; }
  else badge.style.display = 'none';

  // Stats with counter animation
  const approved      = reports.filter(r => r.status === 'approved' || r.status === 'paid');
  const approvedTotal = reports.filter(r => r.status === 'paid').reduce((s,r) => s + parseFloat(r.total||0), 0);

  animateCounter(document.getElementById('statUsers'),   users.filter(u=>u.active).length);
  animateCounter(document.getElementById('statReports'), reports.length);
  animateCounter(document.getElementById('statPending'), pending);
  animateCounter(document.getElementById('statApproved'),reports.filter(r=>r.status==='approved').length);
  document.getElementById('statTotal').textContent = '$' + approvedTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,',');

  // Recent reports table
  const recent = [...reports].sort((a,b)=>(b.submitted_at||b.created_at||'').localeCompare(a.submitted_at||a.created_at||'')).slice(0,10);
  document.getElementById('recentBody').innerHTML = recent.map(r => `
    <tr style="cursor:pointer;" onclick="openReportDetail('${r.id}','${esc(r.user_id||'')}')" title="Click to view full report">
      <td><strong>${esc(r.username||'—')}</strong></td>
      <td>${esc(r.event_location||'—')}</td>
      <td>${r.event_date||'—'}</td>
      <td>${r.submitted_at ? r.submitted_at.slice(0,10) : '<span style="color:#9ca3af">Not submitted</span>'}</td>
      <td><strong>$${parseFloat(r.total||0).toFixed(2)}</strong></td>
      <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:6px;flex-wrap:wrap;">
        <a href="/api/reports/${r.id}/pdf" target="_blank" class="action-btn action-btn-blue">📄 PDF</a>
        ${(r.status === 'submitted' || r.status === 'under_review') ? `
          <button class="action-btn action-btn-green" onclick="quickApprove('${r.id}',this)">✓ Approve</button>
          <button class="action-btn action-btn-red"   onclick="openRejectModal('${r.id}')">✕ Reject</button>` : ''}
        ${r.status === 'approved' ? `
          <button class="action-btn" style="background:#d1fae5;color:#065f46;" onclick="openPaidModal('${r.id}')">💳 Paid</button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="table-empty"><div class="table-empty-icon">📋</div><p>No reports yet</p></td></tr>`;
}

function animateCounter(el, target) {
  if (typeof target !== 'number') return;
  const duration = 800;
  const start    = Date.now();
  const tick = () => {
    const p = Math.min((Date.now() - start) / duration, 1);
    const v = Math.round(p * p * target);
    el.textContent = v;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  };
  requestAnimationFrame(tick);
}

// ─── All Reports ───────────────────────────────────────────

function filterReports(status) {
  showPanel('reports');
  // After panel switch loadAllReports() is called — override the filter
  setTimeout(() => {
    document.getElementById('filterStatus').value = status;
    document.getElementById('filterUser').value   = '';
    document.getElementById('filterFrom').value   = '';
    document.getElementById('filterTo').value     = '';
    loadAllReports();
  }, 0);
}

async function loadAllReports() {
  const userId = document.getElementById('filterUser')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const from   = document.getElementById('filterFrom')?.value || '';
  const to     = document.getElementById('filterTo')?.value || '';

  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  if (status) params.set('status', status);
  if (from)   params.set('from',   from);
  if (to)     params.set('to',     to);

  document.getElementById('allReportsBody').innerHTML = '<tr><td colspan="7"><div class="spinner"></div></td></tr>';
  const res  = await fetch('/api/admin/reports?' + params.toString());
  const data = await res.json();

  document.getElementById('reportsCountLabel').textContent = `${data.length} report${data.length===1?'':'s'} found`;

  document.getElementById('allReportsBody').innerHTML = data.map(r => `
    <tr style="cursor:pointer;" onclick="openReportDetail('${r.id}','${esc(r.user_id||'')}')" title="Click to view full report">
      <td><strong>${esc(r.username||'—')}</strong></td>
      <td>${esc(r.event_location||'—')}</td>
      <td>${r.event_date||'—'}</td>
      <td>${r.submitted_at ? r.submitted_at.slice(0,10) : '<span style="color:#9ca3af">—</span>'}</td>
      <td><strong>$${parseFloat(r.total||0).toFixed(2)}</strong></td>
      <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:5px;flex-wrap:wrap;">
        <a href="/api/reports/${r.id}/pdf" target="_blank" class="action-btn action-btn-blue">📄 PDF</a>
        ${r.status === 'submitted' ? `
          <button class="action-btn" style="background:#ede9fe;color:#6d28d9;" onclick="markUnderReview('${r.id}',this)">🔍 Review</button>
          <button class="action-btn action-btn-green" onclick="quickApprove('${r.id}',this)">✓ Approve</button>
          <button class="action-btn action-btn-red"   onclick="openRejectModal('${r.id}')">✕ Reject</button>` : ''}
        ${r.status === 'under_review' ? `
          <button class="action-btn action-btn-green" onclick="quickApprove('${r.id}',this)">✓ Approve</button>
          <button class="action-btn action-btn-red"   onclick="openRejectModal('${r.id}')">✕ Reject</button>` : ''}
        ${r.status === 'approved' ? `
          <button class="action-btn" style="background:#d1fae5;color:#065f46;" onclick="openPaidModal('${r.id}')">💳 Mark Paid</button>
          <button class="action-btn action-btn-gray"  onclick="reopenReport('${r.id}',this)">↩ Reopen</button>` : ''}
        ${r.status === 'rejected' ? `
          <button class="action-btn action-btn-gray"  onclick="reopenReport('${r.id}',this)">↩ Reopen</button>` : ''}
        ${r.status === 'paid' ? `<span style="font-size:11px;color:#065f46;">✓ Paid ${r.paid_at?r.paid_at.slice(0,10):''}</span>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="table-empty"><div class="table-empty-icon">🔍</div><p>No reports match filters</p></td></tr>`;
}

function clearFilters() {
  document.getElementById('filterUser').value   = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterFrom').value   = '';
  document.getElementById('filterTo').value     = '';
  loadAllReports();
}

async function quickApprove(reportId, btn) {
  btn.disabled = true; btn.textContent = '…';
  const res = await fetch(`/api/reports/${reportId}/approve`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({notes:''})
  });
  if (!res.ok) { toast('Approve failed.', 'error'); btn.disabled=false; btn.textContent='✓'; return; }
  toast('Report approved! ✓', 'success');
  loadAllReports();
  loadDashboard();
}

function openRejectModal(reportId) {
  rejectTargetId = reportId;
  document.getElementById('rejectNotes').value = '';
  openModal('rejectModal');
}

async function confirmReject() {
  const notes = document.getElementById('rejectNotes').value.trim();
  if (!notes) { toast('Please provide a reason for rejection.', 'error'); return; }
  const res = await fetch(`/api/reports/${rejectTargetId}/reject`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({notes})
  });
  if (!res.ok) { toast('Reject failed.', 'error'); return; }
  closeModal('rejectModal');
  closeModal('reportDetailModal');
  toast('Report rejected.', 'warning');
  loadAllReports();
  loadDashboard();
}

async function reopenReport(reportId, btn) {
  btn.disabled = true;
  const res = await fetch(`/api/reports/${reportId}/reopen`, { method:'POST' });
  if (!res.ok) { toast('Reopen failed.', 'error'); btn.disabled=false; return; }
  toast('Report reopened to draft.', 'info');
  loadAllReports();
  loadDashboard();
}

async function openReportDetail(reportId) {
  const res = await fetch(`/api/reports/${reportId}`);
  if (!res.ok) { toast('Could not load report.', 'error'); return; }
  const r = await res.json();

  const total = (r.expenses||[]).reduce((s,e) => s + parseFloat(e.amount||0), 0);

  // ── Status progress bar
  const steps = ['submitted','under_review','approved','paid'];
  const rejFlow = r.status === 'rejected';
  const currentIdx = steps.indexOf(r.status);
  const stepLabels = { submitted:'Submitted', under_review:'Under Review', approved:'Approved', paid:'Paid' };
  const progressBar = rejFlow
    ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:#dc2626;">
        ❌ REJECTED${r.admin_notes ? ` — "${esc(r.admin_notes)}"` : ''}
       </div>`
    : `<div style="display:flex;align-items:center;gap:0;margin-bottom:4px;">
        ${steps.map((s,i) => {
          const done    = i < currentIdx;
          const current = i === currentIdx;
          const bg      = current ? '#1a3f8c' : done ? '#d1fae5' : '#f3f4f6';
          const color   = current ? '#fff' : done ? '#065f46' : '#9ca3af';
          const border  = current ? '#1a3f8c' : done ? '#6ee7b7' : '#e5e7eb';
          const arrow   = i < steps.length-1
            ? `<div style="width:24px;height:2px;background:${done||current?'#1a3f8c':'#e5e7eb'};flex-shrink:0;"></div>` : '';
          return `<div style="display:flex;align-items:center;flex:1;min-width:0;">
            <div style="flex:1;text-align:center;padding:7px 4px;border-radius:8px;border:1.5px solid ${border};background:${bg};color:${color};font-size:11px;font-weight:700;white-space:nowrap;">
              ${current?'▶ ':''}${stepLabels[s]}
            </div>${arrow}
          </div>`;
        }).join('')}
       </div>`;

  // ── Admin action buttons for current status
  const actionSection = () => {
    let heading = '', btns = '';
    if (r.status === 'submitted') {
      heading = 'Next Step: Review this report';
      btns = `<button class="btn btn-ghost btn-sm" onclick="markUnderReviewModal('${r.id}')">🔍 Mark Under Review</button>
              <button class="btn btn-primary btn-sm" onclick="quickApproveModal('${r.id}')">✓ Approve</button>
              <button class="btn btn-danger btn-sm" onclick="openRejectModal('${r.id}')">✕ Reject</button>`;
    } else if (r.status === 'under_review') {
      heading = 'Next Step: Make a decision';
      btns = `<button class="btn btn-primary btn-sm" onclick="quickApproveModal('${r.id}')">✓ Approve Report</button>
              <button class="btn btn-danger btn-sm" onclick="openRejectModal('${r.id}')">✕ Reject Report</button>`;
    } else if (r.status === 'approved') {
      heading = 'Next Step: Issue payment';
      btns = `<button class="btn btn-primary btn-sm" style="background:#065f46;" onclick="openPaidModal('${r.id}')">💳 Mark as Paid</button>
              <button class="btn btn-ghost btn-sm" onclick="reopenReportModal('${r.id}')">↩ Reopen to Draft</button>`;
    } else if (r.status === 'paid') {
      heading = 'Payment complete';
      btns = `<span style="color:#065f46;font-size:13px;">✅ Paid on ${r.paid_at?r.paid_at.slice(0,10):''}${r.paid_notes?' — '+esc(r.paid_notes):''}</span>`;
    } else if (r.status === 'rejected') {
      heading = 'Report rejected — send back?';
      btns = `<button class="btn btn-ghost btn-sm" onclick="reopenReportModal('${r.id}')">↩ Reopen to Draft</button>`;
    }
    return heading ? `
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Admin Actions — ${heading}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <a href="/api/reports/${r.id}/pdf" target="_blank" class="btn btn-ghost btn-sm">📄 Download PDF</a>
          ${btns}
        </div>
      </div>` : '';
  };

  document.getElementById('reportDetailModalBody').innerHTML = `
    <div style="margin-bottom:14px;">
      <div style="font-size:18px;font-weight:800;">${esc(r.event_location||'—')}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:3px;">
        Event: ${r.event_date||'—'} &nbsp;·&nbsp; Submitted by: <strong>${esc(r.username||'—')}</strong> &nbsp;·&nbsp; Pay to: <strong>${esc(r.submit_payment_to||'—')}</strong> &nbsp;·&nbsp; Method: ${r.payment_method||'check'}
      </div>
    </div>

    <div style="margin-bottom:16px;">${progressBar}</div>

    ${actionSection()}

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:2px solid #e5e7eb;">
        <th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600;">Vendor</th>
        <th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600;">Category</th>
        <th style="text-align:right;padding:8px 10px;color:#6b7280;font-weight:600;">Amount</th>
      </tr></thead>
      <tbody>${(r.expenses||[]).map(e=>{
        const receipts = (e.receipts||[]).map(rec => {
          const isImg = /\.(jpg|jpeg|png|gif|webp)/i.test(rec.filename);
          if (isImg) return `<img src="/uploads/${rec.filename}" style="height:48px;width:48px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;" onclick="window.open('/uploads/${rec.filename}','_blank')" title="${esc(rec.original_name)}">`;
          return `<a href="/uploads/${rec.filename}" target="_blank" style="display:inline-flex;align-items:center;justify-content:center;height:48px;width:48px;border-radius:6px;border:1px solid #e5e7eb;font-size:20px;text-decoration:none;" title="${esc(rec.original_name)}">📄</a>`;
        }).join('');
        return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 10px;font-weight:600;">${esc(e.vendor||'—')}</td>
          <td style="padding:8px 10px;color:#6b7280;">${esc(e.purpose||'—')}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700;">$${parseFloat(e.amount||0).toFixed(2)}</td>
        </tr>
        ${receipts ? `<tr style="border-bottom:1px solid #f3f4f6;background:#fafafa;"><td colspan="3" style="padding:6px 10px;"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><span style="font-size:11px;color:#9ca3af;margin-right:4px;">Receipts:</span>${receipts}</div></td></tr>` : ''}`;
      }).join('')}
      </tbody>
      <tfoot><tr style="border-top:2px solid #1a3f8c;">
        <td colspan="2" style="padding:10px;font-weight:800;font-size:14px;">TOTAL</td>
        <td style="padding:10px;text-align:right;font-weight:800;font-size:16px;color:#1a3f8c;">$${total.toFixed(2)}</td>
      </tr></tfoot>
    </table>

    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e5e7eb;">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Timeline</div>
      <div style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:#6b7280;">
        ${r.created_at   ? `<div>📝 <strong>Created</strong> — ${fmtTs(r.created_at)}</div>` : ''}
        ${r.submitted_at ? `<div>📤 <strong>Submitted</strong> by ${esc(r.username||'—')} — ${fmtTs(r.submitted_at)}</div>` : ''}
        ${r.reviewed_at && r.status === 'under_review' ? `<div>🔍 <strong>Under Review</strong> — ${fmtTs(r.reviewed_at)}</div>` : ''}
        ${r.reviewed_at && r.status === 'approved'     ? `<div>✅ <strong>Approved</strong> — ${fmtTs(r.reviewed_at)}</div>` : ''}
        ${r.reviewed_at && r.status === 'rejected'     ? `<div>❌ <strong>Rejected</strong>${r.admin_notes?' — "'+esc(r.admin_notes)+'"':''} — ${fmtTs(r.reviewed_at)}</div>` : ''}
        ${r.paid_at      ? `<div>💳 <strong>Paid</strong>${r.paid_notes?' — '+esc(r.paid_notes):''} — ${fmtTs(r.paid_at)}</div>` : ''}
      </div>
    </div>`;

  openModal('reportDetailModal');
}

// These variants refresh the modal in-place after acting
async function markUnderReviewModal(id) {
  const res = await fetch(`/api/reports/${id}/under_review`, { method:'POST' });
  if (!res.ok) { toast('Failed.', 'error'); return; }
  toast('Marked as Under Review.', 'info');
  openReportDetail(id); loadAllReports(); loadDashboard();
}
async function quickApproveModal(id) {
  const res = await fetch(`/api/reports/${id}/approve`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({notes:''})
  });
  if (!res.ok) { toast('Failed.', 'error'); return; }
  toast('Report approved! ✓', 'success');
  openReportDetail(id); loadAllReports(); loadDashboard();
}
async function reopenReportModal(id) {
  const res = await fetch(`/api/reports/${id}/reopen`, { method:'POST' });
  if (!res.ok) { toast('Failed.', 'error'); return; }
  toast('Report reopened to draft.', 'info');
  openReportDetail(id); loadAllReports(); loadDashboard();
}

async function markUnderReview(reportId, btn) {
  btn.disabled = true; btn.textContent = '…';
  const res = await fetch(`/api/reports/${reportId}/under_review`, { method:'POST' });
  if (!res.ok) { toast('Action failed.', 'error'); btn.disabled=false; btn.textContent='🔍 Review'; return; }
  toast('Report marked Under Review.', 'info');
  loadAllReports();
  loadDashboard();
}

function openPaidModal(reportId) {
  paidTargetId = reportId;
  document.getElementById('paidNotes').value = '';
  openModal('paidModal');
}

async function confirmPaid() {
  const notes = document.getElementById('paidNotes').value.trim();
  const res = await fetch(`/api/reports/${paidTargetId}/paid`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({notes})
  });
  if (!res.ok) { const d = await res.json(); toast(d.error||'Failed.', 'error'); return; }
  closeModal('paidModal');
  closeModal('reportDetailModal');
  toast('Payment recorded! 💳', 'success');
  loadAllReports();
  loadDashboard();
}

function statusLabel(s) {
  return { draft:'Draft', submitted:'Submitted', under_review:'Under Review', approved:'Approved', rejected:'Rejected', paid:'Paid' }[s] || s;
}

// ─── Users ─────────────────────────────────────────────────

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  allUsers  = await res.json();
  document.getElementById('usersBody').innerHTML = allUsers.map(u => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1a3f8c,#2456a4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;flex-shrink:0;">${esc(u.username[0].toUpperCase())}</div>
          <strong>${esc(u.username)}</strong>
        </div>
      </td>
      <td>${esc(u.email)}</td>
      <td><span class="badge badge-${u.role}">${u.role}</span></td>
      <td><span class="badge badge-${u.active?'active':'inactive'}">${u.active?'Active':'Inactive'}</span></td>
      <td style="color:#9ca3af;font-size:12px;">${u.created_at?u.created_at.slice(0,10):''}</td>
      <td style="display:flex;gap:5px;flex-wrap:wrap;">
        <button class="action-btn action-btn-gray" onclick="openResetPw('${u.id}','${esc(u.username)}')">🔑 Reset PW</button>
        ${currentAdminUser.role==='superadmin' && u.id!==currentAdminUser.id ? `
          <select class="action-btn action-btn-gray" onchange="changeRole('${u.id}',this.value)" style="padding:5px;">
            <option value="user"       ${u.role==='user'       ?'selected':''}>User</option>
            <option value="admin"      ${u.role==='admin'      ?'selected':''}>Admin</option>
            <option value="superadmin" ${u.role==='superadmin' ?'selected':''}>Superadmin</option>
          </select>` : ''}
        ${u.id!==currentAdminUser.id ? `
          <button class="action-btn ${u.active?'action-btn-red':'action-btn-green'}" onclick="toggleActive('${u.id}',${u.active})">
            ${u.active?'Deactivate':'Activate'}
          </button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="table-empty">No users found</td></tr>`;
}

async function changeRole(userId, role) {
  const res = await fetch(`/api/admin/users/${userId}/role`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({role})
  });
  if (!res.ok) { toast('Role change failed.', 'error'); return; }
  toast(`Role updated to ${role}.`, 'success');
  loadUsers();
}

async function toggleActive(userId, current) {
  const res = await fetch(`/api/admin/users/${userId}/active`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({active:!current})
  });
  if (!res.ok) { toast('Failed to update status.', 'error'); return; }
  toast(`User ${current?'deactivated':'activated'}.`, current?'warning':'success');
  loadUsers();
}

async function createUser() {
  const username = document.getElementById('newUsername').value.trim();
  const email    = document.getElementById('newEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role     = document.getElementById('newUserRole').value;
  const msgEl    = document.getElementById('createUserMsg');
  msgEl.innerHTML = '';
  if (!username||!email||!password) { msgEl.innerHTML = '<div class="error-inline">All fields required.</div>'; return; }
  const res = await fetch('/api/admin/users', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,email,password,role})
  });
  const data = await res.json();
  if (!res.ok) { msgEl.innerHTML = `<div class="error-inline">${esc(data.error)}</div>`; return; }
  msgEl.innerHTML = '<div class="success-inline">✓ User created!</div>';
  document.getElementById('newUsername').value     = '';
  document.getElementById('newEmail').value        = '';
  document.getElementById('newUserPassword').value = '';
  toast(`User "${username}" created.`, 'success');
  loadUsers();
  loadUserFilter();
  setTimeout(() => closeModal('createUserModal'), 1200);
}

function openResetPw(userId, username) {
  resetTargetId = userId;
  document.getElementById('resetPwName').textContent = `Resetting password for: ${username}`;
  document.getElementById('resetPwValue').value = '';
  document.getElementById('resetPwMsg').innerHTML = '';
  openModal('resetPwModal');
}

async function confirmResetPw() {
  const pw  = document.getElementById('resetPwValue').value;
  const msg = document.getElementById('resetPwMsg');
  if (!pw||pw.length<6) { msg.innerHTML='<div class="error-inline">Password must be at least 6 characters.</div>'; return; }
  const res = await fetch(`/api/admin/users/${resetTargetId}/reset-password`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({newPassword:pw})
  });
  if (!res.ok) { const d=await res.json(); msg.innerHTML=`<div class="error-inline">${esc(d.error)}</div>`; return; }
  msg.innerHTML = '<div class="success-inline">✓ Password reset!</div>';
  toast('Password reset successfully.', 'success');
  setTimeout(() => closeModal('resetPwModal'), 1200);
}

// ─── SMTP Settings ─────────────────────────────────────────

async function loadSmtpSettings() {
  const res  = await fetch('/api/settings/smtp');
  const data = await res.json();
  document.getElementById('smtpHost').value   = data.smtp_host   || '';
  document.getElementById('smtpPort').value   = data.smtp_port   || '587';
  document.getElementById('smtpUser').value   = data.smtp_user   || '';
  document.getElementById('smtpPass').value   = data.smtp_pass   || '';
  document.getElementById('smtpFrom').value   = data.smtp_from   || '';
  document.getElementById('smtpSecure').value = data.smtp_secure==='true' ? 'true' : 'false';
}

async function saveSmtp() {
  const msg = document.getElementById('smtpMsg');
  msg.innerHTML = '';
  const res = await fetch('/api/settings/smtp', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      smtp_host:   document.getElementById('smtpHost').value,
      smtp_port:   document.getElementById('smtpPort').value,
      smtp_secure: document.getElementById('smtpSecure').value,
      smtp_user:   document.getElementById('smtpUser').value,
      smtp_pass:   document.getElementById('smtpPass').value,
      smtp_from:   document.getElementById('smtpFrom').value,
    })
  });
  if (res.ok) { msg.innerHTML='<div class="success-inline">✓ Settings saved!</div>'; toast('SMTP settings saved.','success'); }
  else { msg.innerHTML='<div class="error-inline">Failed to save.</div>'; }
}

async function testSmtp() {
  const msg = document.getElementById('smtpMsg');
  msg.innerHTML = '<div class="success-inline">Sending test email…</div>';
  const res  = await fetch('/api/settings/smtp/test', { method:'POST' });
  const data = await res.json();
  if (res.ok) { msg.innerHTML='<div class="success-inline">✓ Test email sent! Check your inbox.</div>'; toast('Test email sent!','success'); }
  else { msg.innerHTML=`<div class="error-inline">Error: ${esc(data.error)}</div>`; }
}

// ─── Change Admin Password ─────────────────────────────────

async function changeAdminPassword() {
  const current = document.getElementById('adminPwCurrent').value;
  const next    = document.getElementById('adminPwNew').value;
  const confirm = document.getElementById('adminPwConfirm').value;
  const msg     = document.getElementById('adminPwMsg');
  msg.innerHTML = '';
  if (next!==confirm) { msg.innerHTML='<div class="error-inline">Passwords do not match.</div>'; return; }
  const res = await fetch('/api/auth/password', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ currentPassword:current, newPassword:next })
  });
  if (!res.ok) { const d=await res.json(); msg.innerHTML=`<div class="error-inline">${esc(d.error)}</div>`; return; }
  msg.innerHTML='<div class="success-inline">✓ Password updated!</div>';
  toast('Password updated successfully.','success');
  document.getElementById('adminPwCurrent').value='';
  document.getElementById('adminPwNew').value='';
  document.getElementById('adminPwConfirm').value='';
  setTimeout(()=>closeModal('adminPwModal'),1500);
}

// ─── Export ────────────────────────────────────────────────

function doExport(format) {
  const userId = document.getElementById('exportUser')?.value || '';
  const status = document.getElementById('exportStatus')?.value || '';
  const from   = document.getElementById('exportFrom')?.value || '';
  const to     = document.getElementById('exportTo')?.value || '';
  const params = new URLSearchParams({ all:'true' });
  if (userId) params.set('userId', userId);
  if (status) params.set('status', status);
  if (from)   params.set('from',   from);
  if (to)     params.set('to',     to);
  window.location.href = `/api/export/${format}?${params.toString()}`;
  toast(`Downloading ${format.toUpperCase()} export…`, 'info');
}

// ─── User filter dropdowns ─────────────────────────────────

async function loadUserFilter(selectId = 'filterUser') {
  const res   = await fetch('/api/admin/users');
  const users = await res.json();
  const ids   = selectId === 'filterUser' ? ['filterUser','exportUser'] : [selectId];
  ids.forEach(sid => {
    const el = document.getElementById(sid);
    if (!el) return;
    el.innerHTML = '<option value="">All Users</option>';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id; opt.textContent = u.username;
      el.appendChild(opt);
    });
  });
}

// ─── Logo Upload ───────────────────────────────────────────

async function uploadLogo(file) {
  if (!file) return;
  const form = new FormData();
  form.append('logo', file);
  const res  = await fetch('/api/logo', { method:'POST', body:form });
  const data = await res.json();
  if (!res.ok) { document.getElementById('logoMsg').innerHTML=`<div class="error-inline">${esc(data.error)}</div>`; return; }
  document.getElementById('logoMsg').innerHTML='<div class="success-inline">✓ Logo uploaded! Refresh to see it.</div>';
  toast('Logo updated!','success');
}

// ─── Helper ────────────────────────────────────────────────

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}

// ─── Tour Stops ────────────────────────────────────────────

let tourStopsData = [];

async function loadTourStops() {
  const res    = await fetch('/api/tour-stops');
  tourStopsData= await res.json();
  renderTourStops();
}

function renderTourStops() {
  const today  = new Date().toISOString().slice(0, 10);
  const tbody  = document.getElementById('tourStopsBody');
  if (!tourStopsData.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><div class="table-empty-icon">📍</div><p>No tour stops added yet.</p></td></tr>`;
    return;
  }

  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  tbody.innerHTML = tourStopsData.map((s, i) => {
    const isPast     = s.event_date < today;
    const isToday    = s.event_date === today;
    const dateObj    = new Date(s.event_date + 'T12:00:00');
    const dayName    = days[dateObj.getDay()];
    const formatted  = dateObj.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const statusHtml = isToday
      ? '<span class="badge badge-submitted">TODAY</span>'
      : isPast
        ? '<span style="color:#9ca3af;font-size:12px;">Past</span>'
        : '<span class="badge badge-approved">Upcoming</span>';

    return `
      <tr style="${isPast ? 'opacity:0.55;' : ''}">
        <td style="color:#9ca3af;font-size:13px;">${i+1}</td>
        <td><strong>${esc(s.venue)}</strong>${s.notes ? `<br><span style="font-size:11px;color:#9ca3af;">${esc(s.notes)}</span>` : ''}</td>
        <td><strong>${formatted}</strong></td>
        <td style="color:#6b7280;">${dayName}</td>
        <td>${statusHtml}</td>
        <td style="display:flex;gap:6px;">
          <button class="action-btn action-btn-gray" onclick="openEditTourStop('${s.id}')">✎ Edit</button>
          <button class="action-btn action-btn-red"  onclick="deleteTourStop('${s.id}','${esc(s.venue)}')">🗑</button>
        </td>
      </tr>`;
  }).join('');
}

function openAddTourStop() {
  document.getElementById('addStopForm').style.display = 'block';
  document.getElementById('newStopVenue').value = '';
  document.getElementById('newStopDate').value  = '';
  document.getElementById('newStopNotes').value = '';
  document.getElementById('addStopMsg').innerHTML = '';
  document.getElementById('newStopVenue').focus();
  document.getElementById('addStopForm').scrollIntoView({ behavior:'smooth' });
}

async function saveNewTourStop() {
  const venue = document.getElementById('newStopVenue').value.trim();
  const date  = document.getElementById('newStopDate').value;
  const notes = document.getElementById('newStopNotes').value.trim();
  const msgEl = document.getElementById('addStopMsg');
  msgEl.innerHTML = '';

  if (!venue) { msgEl.innerHTML = '<div class="error-inline">Venue is required.</div>'; return; }
  if (!date)  { msgEl.innerHTML = '<div class="error-inline">Event date is required.</div>'; return; }

  const res  = await fetch('/api/tour-stops', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ venue, event_date: date, notes })
  });
  const data = await res.json();
  if (!res.ok) { msgEl.innerHTML = `<div class="error-inline">${esc(data.error)}</div>`; return; }

  document.getElementById('addStopForm').style.display = 'none';
  toast(`Tour stop added: ${venue}`, 'success');
  await loadTourStops();
}

// Inline edit via prompt (simple approach)
async function openEditTourStop(stopId) {
  const stop  = tourStopsData.find(s => s.id === stopId);
  if (!stop) return;

  const venue = prompt('Edit venue/city:', stop.venue);
  if (venue === null) return;
  const date  = prompt('Edit date (YYYY-MM-DD):', stop.event_date);
  if (date === null) return;
  const notes = prompt('Notes (optional):', stop.notes || '');
  if (notes === null) return;

  const res = await fetch(`/api/tour-stops/${stopId}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ venue: venue.trim(), event_date: date.trim(), notes: notes.trim() })
  });
  if (!res.ok) { toast('Update failed.', 'error'); return; }
  toast('Tour stop updated.', 'success');
  await loadTourStops();
}

async function deleteTourStop(stopId, venueName) {
  if (!confirm(`Remove "${venueName}" from the tour schedule?`)) return;
  const res = await fetch(`/api/tour-stops/${stopId}`, { method:'DELETE' });
  if (!res.ok) { toast('Delete failed.', 'error'); return; }
  toast(`Removed: ${venueName}`, 'warning');
  await loadTourStops();
}
