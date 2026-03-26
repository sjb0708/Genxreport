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

  // Only superadmin can assign superadmin role — hide that option for regular admins
  if (currentAdminUser.role !== 'superadmin') {
    document.querySelectorAll('#newUserRole option[value="superadmin"]').forEach(o => o.remove());
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

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const isOpen  = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  overlay.style.display = isOpen ? 'none' : 'block';
}
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').style.display = 'none';
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
  const titles = { dashboard:'Dashboard', reports:'All Reports', analytics:'Analytics', export:'Export Data', users:'Users', settings:'Settings', tourstops:'Tour Stop Schedule' };
  document.getElementById('panelTitle').textContent = titles[name] || name;
  closeSidebar();

  // Action buttons
  const actions = document.getElementById('topbarActions');
  if (name === 'users')      actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openModal('createUserModal')">+ New User</button>`;
  else if (name === 'tourstops') actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openAddTourStop()">+ Add Stop</button>`;
  else actions.innerHTML = '';

  if (name === 'reports') {
    // Default: hide drafts so admin sees actionable reports only
    const sf = document.getElementById('filterStatus');
    if (sf && sf.value === '') sf.value = 'submitted';
    loadAllReports();
  }
  if (name === 'users')     loadUsers();
  if (name === 'settings')  { loadSmtpSettings(); loadAdminNotifPref(); loadBudget(); }
  if (name === 'analytics') loadAnalytics();
  if (name === 'export')    loadUserFilter('exportUser');
  if (name === 'tourstops') loadTourStops();
}

// ─── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const [usersRes, reportsRes, staleRes] = await Promise.all([
    fetch('/api/admin/users'),
    fetch('/api/admin/reports'),
    fetch('/api/admin/stale-drafts')
  ]);
  const users   = await usersRes.json();
  const reports = await reportsRes.json();
  const stale   = staleRes.ok ? await staleRes.json() : [];
  renderStaleDrafts(stale);

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

  // Needs Attention — submitted + under_review only
  const needsAttention = reports
    .filter(r => r.status === 'submitted' || r.status === 'under_review')
    .sort((a,b) => (a.submitted_at||a.created_at||'').localeCompare(b.submitted_at||b.created_at||''));
  document.getElementById('recentBody').innerHTML = needsAttention.map(r => `
    <tr style="cursor:pointer;" onclick="openReportDetail('${r.id}')" title="Click to view full report">
      <td><strong>${esc(r.username||'—')}</strong></td>
      <td>${esc(r.event_location||'—')}</td>
      <td>${r.event_date||'—'}</td>
      <td>${r.submitted_at ? r.submitted_at.slice(0,10) : '—'}</td>
      <td><strong>$${parseFloat(r.total||0).toFixed(2)}</strong></td>
      <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:6px;flex-wrap:wrap;">
        <a href="/api/reports/${r.id}/pdf" target="_blank" class="action-btn action-btn-blue">📄 PDF</a>
        <button class="action-btn action-btn-green" onclick="quickApprove('${r.id}',this)">✓ Approve</button>
        <button class="action-btn action-btn-red"   onclick="openRejectModal('${r.id}')">✕ Reject</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="table-empty"><div class="table-empty-icon">🎉</div><p>All caught up — nothing pending</p></td></tr>`;

  // Recently Closed — last 5 approved or paid
  const recentClosed = reports
    .filter(r => r.status === 'approved' || r.status === 'paid')
    .sort((a,b) => (b.reviewed_at||b.created_at||'').localeCompare(a.reviewed_at||a.created_at||''))
    .slice(0, 5);
  document.getElementById('recentClosedBody').innerHTML = recentClosed.map(r => `
    <tr style="cursor:pointer;" onclick="openReportDetail('${r.id}')" title="Click to view full report">
      <td><strong>${esc(r.username||'—')}</strong></td>
      <td>${esc(r.event_location||'—')}</td>
      <td>${r.event_date||'—'}</td>
      <td><strong>$${parseFloat(r.total||0).toFixed(2)}</strong></td>
      <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:6px;flex-wrap:wrap;">
        <a href="/api/reports/${r.id}/pdf" target="_blank" class="action-btn action-btn-blue">📄 PDF</a>
        ${r.status === 'approved' ? `<button class="action-btn" style="background:#d1fae5;color:#065f46;" onclick="openPaidModal('${r.id}')">💳 Paid</button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="table-empty"><div class="table-empty-icon">📋</div><p>No closed reports yet</p></td></tr>`;
}

function renderStaleDrafts(drafts) {
  const el = document.getElementById('staleDraftsCard');
  if (!el) return;
  if (!drafts.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  document.getElementById('staleDraftsCount').textContent = drafts.length;
  document.getElementById('staleDraftsBody').innerHTML = drafts.map(r => `
    <tr>
      <td><strong>${esc(r.username||'—')}</strong></td>
      <td>${esc(r.event_location||'Untitled')}</td>
      <td>${r.created_at ? r.created_at.slice(0,10) : '—'}</td>
      <td>${r.last_reminder_at ? r.last_reminder_at.slice(0,10) : '<span style="color:#9ca3af">Never</span>'}</td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:6px;flex-wrap:wrap;padding:6px 10px;">
        <button class="action-btn" style="background:#fef3c7;color:#92400e;" onclick="remindDraft('${r.id}',this)">📧 Remind</button>
        <button class="action-btn action-btn-red" onclick="deleteStaleDraft('${r.id}','${esc(r.event_location||r.username)}',this)">🗑 Delete</button>
      </td>
    </tr>`).join('');
}

async function remindDraft(id, btn) {
  btn.disabled = true;
  const res = await fetch(`/api/admin/remind-draft/${id}`, { method:'POST' });
  if (!res.ok) { toast('Reminder failed.', 'error'); btn.disabled=false; return; }
  toast('Reminder sent to user.', 'success');
  loadDashboard();
}

async function deleteStaleDraft(id, label, btn) {
  if (!confirm(`Delete draft "${label}"? This cannot be undone.`)) return;
  btn.disabled = true;
  const res = await fetch(`/api/reports/${id}`, { method:'DELETE' });
  if (!res.ok) { toast('Delete failed.', 'error'); btn.disabled=false; return; }
  toast('Draft deleted.', 'warning');
  loadDashboard();
}

async function deleteReportFromDetail() {
  if (!_currentDetailReportId) return;
  if (!confirm('Delete this report permanently? This cannot be undone.')) return;
  const btn = document.getElementById('btnDeleteReport');
  btn.disabled = true;
  const res = await fetch(`/api/reports/${_currentDetailReportId}`, { method:'DELETE' });
  if (!res.ok) { toast('Delete failed.', 'error'); btn.disabled=false; return; }
  closeModal('reportDetailModal');
  toast('Report deleted.', 'warning');
  loadDashboard();
  loadAllReports();
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
        ${r.status === 'draft' ? `
          <button class="action-btn" style="background:#fef3c7;color:#92400e;" onclick="event.stopPropagation();remindDraft('${r.id}',this)">📧 Remind</button>
          <button class="action-btn action-btn-red" onclick="event.stopPropagation();deleteStaleDraft('${r.id}','${esc(r.event_location||r.username)}',this)">🗑 Delete</button>` : ''}
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
  if (!res.ok) { const d = await res.json().catch(()=>({})); toast('Reject failed: ' + (d.error||res.status), 'error'); return; }
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

let _currentDetailReportId = null;

async function openReportDetail(reportId) {
  _currentDetailReportId = reportId;
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
          const url   = `/api/receipts/${rec.id}/file`;
          const isImg = /\.(jpg|jpeg|png|gif|webp)/i.test(rec.filename);
          if (isImg) return `<img src="${url}" style="height:48px;width:48px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;" onclick="window.open('${url}','_blank')" title="${esc(rec.original_name)}">`;
          return `<a href="${url}" target="_blank" style="display:inline-flex;align-items:center;justify-content:center;height:48px;width:48px;border-radius:6px;border:1px solid #e5e7eb;font-size:20px;text-decoration:none;" title="${esc(rec.original_name)}">📄</a>`;
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
        ${r.created_at   ? `<div>📝 <strong>Created</strong> by ${esc(r.username||'—')} — ${fmtTs(r.created_at)}</div>` : ''}
        ${r.submitted_at ? `<div>📤 <strong>Submitted</strong> by ${esc(r.username||'—')} — ${fmtTs(r.submitted_at)}</div>` : ''}
        ${r.reviewed_at && r.status === 'under_review' ? `<div>🔍 <strong>Marked Under Review</strong> by ${esc(r.reviewed_by_username||'admin')} — ${fmtTs(r.reviewed_at)}</div>` : ''}
        ${r.reviewed_at && r.status === 'approved'     ? `<div>✅ <strong>Approved</strong> by ${esc(r.reviewed_by_username||'admin')} — ${fmtTs(r.reviewed_at)}</div>` : ''}
        ${r.reviewed_at && r.status === 'rejected'     ? `<div>❌ <strong>Rejected</strong> by ${esc(r.reviewed_by_username||'admin')}${r.admin_notes?' — "'+esc(r.admin_notes)+'"':''} — ${fmtTs(r.reviewed_at)}</div>` : ''}
        ${r.paid_at      ? `<div>💳 <strong>Paid</strong> by ${esc(r.paid_by_username||'admin')}${r.paid_notes?' — '+esc(r.paid_notes):''} — ${fmtTs(r.paid_at)}</div>` : ''}
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
  if (!res.ok) { const d = await res.json().catch(()=>({})); toast('Approve failed: ' + (d.error||res.status), 'error'); return; }
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

// ─── Analytics ────────────────────────────────────────────────────────────

async function loadAnalytics() {
  // Populate user dropdown — fetch if not yet loaded
  const userSel = document.getElementById('analyticsUser');
  if (userSel && userSel.options.length === 1) {
    if (!allUsers.length) {
      const r = await fetch('/api/admin/users');
      if (r.ok) allUsers = await r.json();
    }
    allUsers.forEach(u => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = u.username;
      userSel.appendChild(o);
    });
  }

  const user_id  = document.getElementById('analyticsUser')?.value || '';
  const category = document.getElementById('analyticsCategory')?.value || '';
  const status   = document.getElementById('analyticsStatus')?.value || '';
  const from     = document.getElementById('analyticsFrom')?.value || '';
  const to       = document.getElementById('analyticsTo')?.value || '';
  const location = document.getElementById('analyticsLocation')?.value || '';

  const params = new URLSearchParams();
  if (user_id)  params.set('user_id',  user_id);
  if (category) params.set('category', category);
  if (status)   params.set('status',   status);
  if (from)     params.set('from',     from);
  if (to)       params.set('to',       to);
  if (location) params.set('location', location);

  const res = await fetch('/api/admin/analytics?' + params.toString());
  if (!res.ok) { toast('Analytics failed to load.', 'error'); return; }
  const { byCategory, byUser, byVenue, summary, detail, locations, budget } = await res.json();

  // Refresh location dropdown while preserving selection
  const locSel = document.getElementById('analyticsLocation');
  if (locSel && locations) {
    const current = locSel.value;
    locSel.innerHTML = '<option value="">All Locations</option>' +
      locations.map(l => `<option value="${esc(l)}"${l === current ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }

  const fmt = n => '$' + parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const grandTotal = summary.grand_total || 0;

  // Summary cards
  document.getElementById('anStatTotal').textContent    = fmt(grandTotal);
  document.getElementById('anStatVenues').textContent   = summary.venue_count || 0;
  document.getElementById('anStatPeople').textContent   = summary.people_count || 0;
  const avgVenue = summary.venue_count > 0 ? grandTotal / summary.venue_count : 0;
  document.getElementById('anStatAvgVenue').textContent = fmt(avgVenue);

  // Venue table
  const venueTitle = document.getElementById('anVenueTitle');
  if (venueTitle) venueTitle.textContent = location ? `${location} — Cost Summary` : 'Cost by Venue';
  document.getElementById('anVenueBody').innerHTML = byVenue.length
    ? byVenue.map((v, i) => {
        const pct    = grandTotal > 0 ? ((v.total / grandTotal) * 100).toFixed(1) : '0.0';
        const avgPer = v.people > 0 ? v.total / v.people : 0;
        const isHigh = byVenue.length > 1 && v.total > (grandTotal / byVenue.length) * 1.5;
        const bar    = `<div style="display:inline-block;width:${Math.max(4, Math.round((v.total/byVenue[0].total)*80))}px;height:6px;background:${isHigh?'#dc2626':'#1a3f8c'};border-radius:3px;margin-right:8px;vertical-align:middle;"></div>`;
        const venueBudget = budget?.total_per_show || 0;
        const budgetIndicator = venueBudget > 0 ? (() => {
          const bpct = (v.total / venueBudget) * 100;
          const color = bpct > 100 ? '#dc2626' : bpct > 80 ? '#d97706' : '#16a34a';
          const icon  = bpct > 100 ? '🔴' : bpct > 80 ? '🟡' : '🟢';
          return `<span style="color:${color};font-size:11px;margin-left:6px;">${icon} ${bpct.toFixed(0)}% of $${venueBudget.toLocaleString()} budget</span>`;
        })() : '';
        return `<tr style="${isHigh ? 'background:#fff7f7;' : i===0 ? 'background:#f0f7ff;' : ''}"
                    onclick="document.getElementById('analyticsLocation').value='${esc(v.venue)}';loadAnalytics();"
                    style="cursor:pointer;${isHigh ? 'background:#fff7f7;' : i===0 ? 'background:#f0f7ff;' : ''}">
          <td><strong>${esc(v.venue)}</strong>${isHigh ? ' <span style="color:#dc2626;" title="High spend venue">⚠️</span>' : ''}</td>
          <td style="color:#6b7280;">${v.date||'—'}</td>
          <td style="text-align:right;color:#6b7280;">${v.people}</td>
          <td style="text-align:right;font-weight:700;white-space:nowrap;">${bar}${fmt(v.total)}${budgetIndicator}</td>
          <td style="text-align:right;color:#6b7280;">${fmt(avgPer)}</td>
          <td style="text-align:right;color:#6b7280;">${pct}%</td>
        </tr>`;
      }).join('') + `<tr style="border-top:2px solid #e5e7eb;background:#f9fafb;font-weight:700;">
        <td>TOTAL</td><td></td><td></td>
        <td style="text-align:right;color:#1a3f8c;">${fmt(grandTotal)}</td>
        <td></td><td style="text-align:right;">100%</td>
      </tr>`
    : `<tr><td colspan="6" class="table-empty"><div class="table-empty-icon">📍</div><p>No venue data — run a report</p></td></tr>`;

  // User table
  const userAvg = byUser.length > 1 ? grandTotal / byUser.length : 0;
  const userTitle = document.getElementById('anUserTitle');
  const ctxLabel = [location, category].filter(Boolean).join(' · ');
  if (userTitle) userTitle.textContent = ctxLabel ? `Cost by Person — ${ctxLabel}` : 'Cost by Person';

  document.getElementById('anUserBody').innerHTML = byUser.length
    ? byUser.map((r, i) => {
        const isHigh   = byUser.length > 1 && r.total > userAvg * 1.5;
        const vsAvg    = userAvg > 0 ? ((r.total - userAvg) / userAvg * 100) : 0;
        const vsLabel  = userAvg > 0 ? `${vsAvg >= 0 ? '+' : ''}${vsAvg.toFixed(0)}%` : '—';
        const vsColor  = vsAvg > 50 ? '#dc2626' : vsAvg > 0 ? '#d97706' : '#16a34a';
        const bar      = byUser[0].total > 0
          ? `<div style="display:inline-block;width:${Math.max(4,Math.round((r.total/byUser[0].total)*80))}px;height:6px;background:${isHigh?'#dc2626':'#1a3f8c'};border-radius:3px;margin-right:8px;vertical-align:middle;"></div>`
          : '';
        return `<tr style="${isHigh ? 'background:#fff7f7;' : i===0 ? 'background:#f0f7ff;' : ''}">
          <td><strong>${esc(r.username)}</strong>${isHigh ? ' <span style="color:#dc2626;" title="Above average spender">⚠️</span>' : ''}</td>
          <td style="text-align:right;color:#6b7280;">${r.report_count}</td>
          <td style="text-align:right;font-weight:700;white-space:nowrap;">${bar}${fmt(r.total)}</td>
          <td style="text-align:right;font-weight:700;color:${userAvg>0?vsColor:'#6b7280'};font-size:12px;">${vsLabel}</td>
        </tr>`;
      }).join('') + `<tr style="border-top:2px solid #e5e7eb;background:#f9fafb;font-weight:700;">
        <td>TOTAL</td><td></td><td style="text-align:right;color:#1a3f8c;">${fmt(grandTotal)}</td><td></td>
      </tr>`
    : `<tr><td colspan="4" class="table-empty"><div class="table-empty-icon">👥</div><p>No data</p></td></tr>`;

  // Category table
  document.getElementById('anCategoryBody').innerHTML = byCategory.length
    ? byCategory.map(r => {
        const pct = grandTotal > 0 ? ((r.total / grandTotal) * 100).toFixed(1) : '0.0';
        const bar = `<div style="display:inline-block;width:${Math.max(4,Math.round(parseFloat(pct)))}%;max-width:80px;height:6px;background:#1a3f8c;border-radius:3px;margin-right:6px;vertical-align:middle;"></div>`;
        const catBudget = budget?.categories?.[r.category] || 0;
        const budgetCell = catBudget > 0 ? (() => {
          const bpct = (r.total / catBudget) * 100;
          const color = bpct > 100 ? '#dc2626' : bpct > 80 ? '#d97706' : '#16a34a';
          const icon  = bpct > 100 ? '🔴' : bpct > 80 ? '🟡' : '🟢';
          return `<span style="color:${color};font-size:11px;">${icon} ${bpct.toFixed(0)}% of $${catBudget}</span>`;
        })() : '<span style="color:#d1d5db;font-size:11px;">No limit</span>';
        return `<tr>
          <td><strong>${esc(r.category||'Uncategorized')}</strong></td>
          <td style="text-align:right;font-weight:700;">${fmt(r.total)}</td>
          <td style="text-align:right;white-space:nowrap;">${bar}${pct}%</td>
          <td style="text-align:right;">${budgetCell}</td>
        </tr>`;
      }).join('') + `<tr style="border-top:2px solid #e5e7eb;background:#f9fafb;font-weight:700;">
        <td>TOTAL</td>
        <td style="text-align:right;color:#1a3f8c;">${fmt(grandTotal)}</td><td></td><td></td>
      </tr>`
    : `<tr><td colspan="4" class="table-empty"><div class="table-empty-icon">📊</div><p>No data</p></td></tr>`;

  // Detail table
  document.getElementById('anDetailSubtitle').textContent =
    `${detail.length} line item${detail.length !== 1 ? 's' : ''}${detail.length === 200 ? ' (first 200 shown)' : ''}`;
  document.getElementById('anDetailBody').innerHTML = detail.length
    ? detail.map(e => `<tr>
        <td><strong>${esc(e.username)}</strong></td>
        <td>${esc(e.event_location||'—')}</td>
        <td>${e.event_date||'—'}</td>
        <td>${esc(e.vendor||'—')}</td>
        <td style="font-size:11px;color:#6b7280;">${esc(e.purpose||'—')}</td>
        <td style="text-align:right;font-weight:700;">${fmt(e.amount)}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="table-empty"><div class="table-empty-icon">🧾</div><p>No expenses match your filters</p></td></tr>`;
}

async function seedDemoData() {
  if (!confirm('This will add 5 demo expense reports across your existing users. Continue?')) return;
  const res = await fetch('/api/admin/seed-demo', { method: 'POST' });
  const d   = await res.json();
  if (!res.ok) { toast('Seed failed: ' + d.error, 'error'); return; }
  toast(`${d.reports} demo reports added!`, 'success');
  loadAnalytics();
}

function resetAnalyticsFilters() {
  document.getElementById('analyticsUser').value     = '';
  document.getElementById('analyticsCategory').value = '';
  document.getElementById('analyticsStatus').value   = '';
  document.getElementById('analyticsLocation').value = '';
  document.getElementById('analyticsFrom').value     = '';
  document.getElementById('analyticsTo').value       = '';
  loadAnalytics();
}

const BUDGET_CATEGORIES = [
  'Airfare','Hotel/Lodging','Transportation/Gas','Car Rental',
  'Food & Beverage','Parking','Entertainment','Equipment Rental',
  'Office Supplies','Marketing/Promotion','Wardrobe/Costumes',
  'Professional Services','Telecommunications','Miscellaneous'
];

async function loadBudget() {
  const res = await fetch('/api/admin/budget');
  if (!res.ok) return;
  const b = await res.json();
  document.getElementById('budgetTotal').value = b.total_per_show || '';

  const container = document.getElementById('budgetCategoryInputs');
  container.innerHTML = BUDGET_CATEGORIES.map(cat => `
    <div class="form-group" style="margin-bottom:8px;">
      <label style="font-size:11px;">${cat}</label>
      <div style="position:relative;">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#6b7280;font-size:13px;">$</span>
        <input type="number" id="budgetCat_${cat.replace(/[^a-z0-9]/gi,'_')}"
               class="form-control" placeholder="No limit"
               style="padding-left:24px;height:36px;font-size:13px;"
               value="${b.categories?.[cat] || ''}">
      </div>
    </div>
  `).join('');
}

async function saveBudget() {
  const total_per_show = parseFloat(document.getElementById('budgetTotal').value) || 0;
  const categories = {};
  BUDGET_CATEGORIES.forEach(cat => {
    const val = parseFloat(document.getElementById('budgetCat_' + cat.replace(/[^a-z0-9]/gi,'_')).value);
    if (val > 0) categories[cat] = val;
  });
  const res = await fetch('/api/admin/budget', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ total_per_show, categories })
  });
  if (!res.ok) { toast('Failed to save budget.', 'error'); return; }
  toast('Budget template saved!', 'success');
}

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

async function loadAdminNotifPref() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return;
  const u = await res.json();
  const on = u.email_notifications !== false;
  const slider = document.getElementById('adminNotifSlider');
  const thumb  = document.getElementById('adminNotifThumb');
  const cb     = document.getElementById('adminEmailNotifToggle');
  if (!slider) return;
  cb.checked = on;
  slider.style.background = on ? '#1a3f8c' : '#d1d5db';
  thumb.style.transform   = on ? 'translateX(20px)' : 'translateX(0)';
}

async function saveAdminNotifPref() {
  const on = document.getElementById('adminEmailNotifToggle').checked;
  const slider = document.getElementById('adminNotifSlider');
  const thumb  = document.getElementById('adminNotifThumb');
  slider.style.background = on ? '#1a3f8c' : '#d1d5db';
  thumb.style.transform   = on ? 'translateX(20px)' : 'translateX(0)';
  await fetch('/api/auth/notifications', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_notifications: on })
  });
  toast(on ? 'Email notifications enabled' : 'Email notifications disabled', 'success');
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

function openEditTourStop(stopId) {
  const stop = tourStopsData.find(s => s.id === stopId);
  if (!stop) return;
  document.getElementById('editStopId').value    = stopId;
  document.getElementById('editStopVenue').value = stop.venue || '';
  document.getElementById('editStopDate').value  = stop.event_date || '';
  document.getElementById('editStopNotes').value = stop.notes || '';
  openModal('editTourStopModal');
}

async function saveEditTourStop() {
  const stopId = document.getElementById('editStopId').value;
  const venue  = document.getElementById('editStopVenue').value.trim();
  const date   = document.getElementById('editStopDate').value.trim();
  const notes  = document.getElementById('editStopNotes').value.trim();
  if (!venue || !date) { toast('Venue and date are required.', 'error'); return; }
  const res = await fetch(`/api/tour-stops/${stopId}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ venue, event_date: date, notes })
  });
  if (!res.ok) { toast('Update failed.', 'error'); return; }
  closeModal('editTourStopModal');
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
