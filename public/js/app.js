/* ========================================
   ECC DMS — Frontend Application
   ======================================== */

const API = '';
let TOKEN = localStorage.getItem('ecc_token');
let DEALER = JSON.parse(localStorage.getItem('ecc_dealer') || 'null');
let TUNE_OPTIONS = null;

// ---- API Helper ----
async function api(method, path, body, isFormData) {
  const opts = { method, headers: {} };
  if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
  if (body && !isFormData) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isFormData) {
    opts.body = body;
  }
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---- Authenticated File Download ----
async function downloadFile(url, filename) {
  try {
    const res = await fetch(`${API}${url}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }));
      return toast(err.error || 'Download failed', 'error');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) { toast('Download failed: ' + err.message, 'error'); }
}

// ---- Toast ----
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

// ---- Router ----
function navigate(page, params = {}) {
  window._params = params;
  render(page);
}

function render(page) {
  const app = document.getElementById('app');
  if (!TOKEN || !DEALER) {
    app.innerHTML = renderLogin();
    bindLogin();
    return;
  }
  app.innerHTML = renderLayout(page);
  bindSidebar(page);

  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'new-tune': loadNewTune(); break;
    case 'orders': loadOrders(); break;
    case 'order-detail': loadOrderDetail(window._params.id); break;
    case 'clients': loadClients(); break;
    case 'client-detail': loadClientDetail(window._params.id); break;
    case 'vehicles': loadVehicles(); break;
    case 'tools': loadTools(); break;
    case 'perf-hardware': loadPerfHardware(); break;
    case 'manage-catalog': loadManageCatalog(); break;
    case 'account': loadAccount(); break;
    case 'admin-dealers': loadAdminDealers(); break;
    case 'manage-dealers': loadManageDealers(); break;
    case 'settings': loadSettings(); break;
    default: loadDashboard();
  }
}

// ---- LOGIN PAGE ----
function renderLogin() {
  return `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-logo">
          <img src="/images/ecc-logo.png" alt="ECC Tuned" onerror="this.style.display='none'">
          <h2>Dealer Portal</h2>
        </div>
        <div class="login-error" id="loginError"></div>
        <form id="loginForm">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="loginEmail" placeholder="dealer@example.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="loginPassword" placeholder="Enter your password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="loginBtn">
            Sign In
          </button>
        </form>
        <p style="text-align:center; margin-top:24px; font-size:12px; color:var(--text-muted);">
          Contact ECC to obtain dealer credentials
        </p>
      </div>
    </div>
  `;
}

function bindLogin() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    errEl.classList.remove('show');

    try {
      const data = await api('POST', '/api/auth/login', { email, password });
      TOKEN = data.token;
      DEALER = data.dealer;
      localStorage.setItem('ecc_token', TOKEN);
      localStorage.setItem('ecc_dealer', JSON.stringify(DEALER));
      navigate('dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

function logout() {
  TOKEN = null;
  DEALER = null;
  localStorage.removeItem('ecc_token');
  localStorage.removeItem('ecc_dealer');
  render('login');
}

// ---- APP LAYOUT ----
function renderLayout(page) {
  const initials = DEALER.contact_name.split(' ').map(w => w[0]).join('').toUpperCase();
  const isAdmin = DEALER.is_admin;
  const isDistributor = DEALER.role === 'distributor';

  return `
    <div class="app-layout">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <img src="/images/ecc-logo.png" alt="ECC Tuned" onerror="this.parentElement.innerHTML='<h3 style=color:var(--primary)>ECC TUNED</h3>'">
          <span>Dealer Portal</span>
        </div>
        <nav class="sidebar-nav">
          <div class="nav-section">
            <div class="nav-section-title">Main</div>
            <div class="nav-item ${page === 'dashboard' ? 'active' : ''}" data-page="dashboard">
              <span class="nav-icon">📊</span> Dashboard
            </div>
            ${!isAdmin ? `
            <div class="nav-item ${page === 'new-tune' ? 'active' : ''}" data-page="new-tune">
              <span class="nav-icon">⚡</span> New Tune Request
            </div>` : ''}
            <div class="nav-item ${page === 'orders' ? 'active' : ''}" data-page="orders">
              <span class="nav-icon">📋</span> ${isAdmin ? 'All Orders' : 'My Orders'}
            </div>
          </div>
          <div class="nav-section">
            <div class="nav-section-title">Shop</div>
            <div class="nav-item ${page === 'tools' ? 'active' : ''}" data-page="tools">
              <span class="nav-icon">🔧</span> Tools
            </div>
            <div class="nav-item ${page === 'perf-hardware' ? 'active' : ''}" data-page="perf-hardware">
              <span class="nav-icon">⚡</span> ECC Performance Hardware
            </div>
            ${isAdmin || isDistributor ? `
            <div class="nav-item ${page === 'manage-catalog' ? 'active' : ''}" data-page="manage-catalog">
              <span class="nav-icon">📦</span> Manage Catalog
            </div>` : ''}
            <div class="nav-item ${page === 'account' ? 'active' : ''}" data-page="account">
              <span class="nav-icon">💰</span> Account & Billing
            </div>
          </div>
          <div class="nav-section">
            <div class="nav-section-title">Management</div>
            <div class="nav-item ${page === 'clients' ? 'active' : ''}" data-page="clients">
              <span class="nav-icon">👤</span> Clients
            </div>
            <div class="nav-item ${page === 'vehicles' ? 'active' : ''}" data-page="vehicles">
              <span class="nav-icon">🚗</span> Vehicles
            </div>
          </div>
          ${isDistributor ? `
          <div class="nav-section">
            <div class="nav-section-title">Distributor</div>
            <div class="nav-item ${page === 'manage-dealers' ? 'active' : ''}" data-page="manage-dealers">
              <span class="nav-icon">🏪</span> My Dealers
            </div>
          </div>` : ''}
          ${isAdmin ? `
          <div class="nav-section">
            <div class="nav-section-title">Admin</div>
            <div class="nav-item ${page === 'admin-dealers' ? 'active' : ''}" data-page="admin-dealers">
              <span class="nav-icon">🏢</span> Dealers
            </div>
          </div>` : ''}
          <div class="nav-section">
            <div class="nav-item ${page === 'settings' ? 'active' : ''}" data-page="settings">
              <span class="nav-icon">⚙️</span> Settings
            </div>
          </div>
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-user-avatar">${initials}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${DEALER.contact_name}</div>
              <div class="sidebar-user-company">${DEALER.company_name}</div>
            </div>
            <button class="btn-logout" id="btnLogout" title="Sign Out">⏻</button>
          </div>
        </div>
      </aside>
      <main class="main-content" id="mainContent">
        <div class="empty-state"><span class="spinner"></span><p style="margin-top:16px">Loading...</p></div>
      </main>
    </div>
  `;
}

function bindSidebar(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
  document.getElementById('btnLogout').addEventListener('click', logout);
}

// ---- DASHBOARD ----
async function loadDashboard() {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', '/api/dealers/stats');
    const s = data.stats;

    if (DEALER.is_admin) {
      // ---- ADMIN WORK QUEUE VIEW ----
      main.innerHTML = `
        <div class="page-header">
          <div>
            <h1 class="page-title">ECC HQ — Work Queue</h1>
            <p class="page-subtitle">${data.workQueue.length} tune${data.workQueue.length !== 1 ? 's' : ''} awaiting action</p>
          </div>
          <div style="display:flex;gap:16px;align-items:center;">
            <div class="stat-card stat-warning" style="margin:0;padding:12px 20px;min-width:auto;">
              <div class="stat-label" style="font-size:11px;">Pending</div>
              <div class="stat-value" style="font-size:22px;">${s.pendingOrders}</div>
            </div>
            <div class="stat-card stat-info" style="margin:0;padding:12px 20px;min-width:auto;">
              <div class="stat-label" style="font-size:11px;">In Progress</div>
              <div class="stat-value" style="font-size:22px;">${s.inProgressOrders}</div>
            </div>
            <div class="stat-card stat-success" style="margin:0;padding:12px 20px;min-width:auto;">
              <div class="stat-label" style="font-size:11px;">Completed</div>
              <div class="stat-value" style="font-size:22px;">${s.completedOrders}</div>
            </div>
          </div>
        </div>

        <div id="workQueueContainer">
          ${data.workQueue.length ? data.workQueue.map(o => {
            let opts = [];
            try { opts = JSON.parse(o.options || '[]'); } catch(e) {}
            const allOptions = TUNE_OPTIONS ? Object.values(TUNE_OPTIONS).flat() : [];
            const optionLabels = opts.map(id => {
              const found = allOptions.find(opt => opt.id === id);
              return found ? found.label : id;
            });
            const timeAgo = getTimeAgo(o.created_at);

            return `
            <div class="card work-queue-card" style="margin-bottom:16px;border-left:4px solid ${o.status === 'in_progress' ? '#64b5f6' : '#ffb74d'};">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px 12px;">
                <div style="flex:1;">
                  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                    <span style="font-weight:600;color:var(--accent);font-size:15px;">${o.order_number}</span>
                    <span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span>
                    <span style="color:var(--text-muted);font-size:12px;">${timeAgo}</span>
                  </div>
                  <div style="font-size:16px;font-weight:500;color:var(--text-primary);margin-bottom:4px;">
                    ${o.year || ''} ${o.make || ''} ${o.model || ''} ${o.engine ? '— ' + o.engine : ''}
                  </div>
                  <div style="display:flex;gap:24px;color:var(--text-muted);font-size:13px;margin-bottom:6px;">
                    <span>VIN: <span style="color:var(--text-secondary);font-family:monospace;">${o.vin || '—'}</span></span>
                    <span>ECU: <span style="color:var(--text-secondary);">${o.ecu_type || '—'}</span></span>
                    ${o.engine_code ? `<span>Code: <span style="color:var(--text-secondary);">${o.engine_code}</span></span>` : ''}
                  </div>
                  <div style="display:flex;gap:24px;color:var(--text-muted);font-size:13px;">
                    <span>Dealer: <span style="color:var(--text-secondary);">${o.dealer_name}</span></span>
                    <span>Client: <span style="color:var(--text-secondary);">${o.first_name} ${o.last_name}</span></span>
                  </div>
                </div>
                <div style="text-align:right;min-width:140px;">
                  <div style="font-size:13px;color:var(--accent);font-weight:600;margin-bottom:4px;">${formatTuneType(o.tune_type)}</div>
                  ${o.stock_file_name ? `<button class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 10px;margin-bottom:6px;" onclick="downloadFile('/api/tunes/${o.id}/download/stock','${(o.stock_file_name||'stock.bin').replace(/'/g,"\\'")}')">📥 Stock File</button>` : ''}
                </div>
              </div>

              ${optionLabels.length || o.notes ? `
              <div style="padding:0 20px 12px;display:flex;gap:16px;flex-wrap:wrap;">
                ${optionLabels.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${optionLabels.map(label =>
                  `<span style="background:rgba(221,51,51,0.12);color:#dd3333;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500;">${label}</span>`
                ).join('')}</div>` : ''}
                ${o.notes ? `<div style="color:var(--text-muted);font-size:12px;font-style:italic;">📝 ${o.notes}</div>` : ''}
              </div>` : ''}

              <div style="padding:8px 20px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);">
                <select class="form-control" id="qStatus_${o.id}" style="width:auto;padding:6px 12px;font-size:12px;">
                  <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Pending</option>
                  <option value="in_progress" ${o.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                  <option value="completed" ${o.status === 'completed' ? 'selected' : ''}>Completed</option>
                  <option value="on_hold" ${o.status === 'on_hold' ? 'selected' : ''}>On Hold</option>
                </select>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="color:var(--text-muted);font-size:12px;">$</span>
                  <input type="number" step="0.01" min="0" class="form-control" id="qPrice_${o.id}" value="${o.price || 0}" style="width:80px;padding:6px 8px;font-size:12px;" placeholder="Price">
                </div>
                <button class="btn btn-primary btn-sm" style="font-size:12px;padding:6px 14px;" onclick="quickUpdateStatus('${o.id}')">Update</button>
                <label class="btn btn-secondary btn-sm" style="font-size:12px;padding:6px 14px;cursor:pointer;margin:0;">
                  📤 Upload Tuned File
                  <input type="file" style="display:none" onchange="uploadTunedFile('${o.id}', this)">
                </label>
                <button class="btn btn-secondary btn-sm" style="font-size:12px;padding:6px 14px;" onclick="navigate('order-detail', {id:'${o.id}'})">View Details</button>
              </div>
            </div>`;
          }).join('') : `
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon">✅</div>
              <h3>All caught up!</h3>
              <p>No pending tune requests at this time</p>
            </div>
          </div>`}
        </div>
      `;

      // Load tune options if not cached (needed for option labels)
      if (!TUNE_OPTIONS) {
        try {
          const optData = await api('GET', '/api/tunes/options');
          TUNE_OPTIONS = optData.options;
          loadDashboard(); // Re-render with option labels
        } catch(e) {}
      }

    } else {
      // ---- DEALER DASHBOARD VIEW ----
      main.innerHTML = `
        <div class="page-header">
          <div>
            <h1 class="page-title">Dashboard</h1>
            <p class="page-subtitle">Welcome back, ${DEALER.contact_name}</p>
          </div>
          <div class="credit-display">
            <span style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:1px;">Balance</span>
            <span class="credit-amount">$${(data.account_balance || 0).toFixed(2)}</span>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card stat-primary">
            <div class="stat-icon">📋</div>
            <div class="stat-label">Total Orders</div>
            <div class="stat-value">${s.totalOrders}</div>
          </div>
          <div class="stat-card stat-warning">
            <div class="stat-icon">⏳</div>
            <div class="stat-label">Pending</div>
            <div class="stat-value">${s.pendingOrders}</div>
          </div>
          <div class="stat-card stat-info">
            <div class="stat-icon">🔧</div>
            <div class="stat-label">In Progress</div>
            <div class="stat-value">${s.inProgressOrders}</div>
          </div>
          <div class="stat-card stat-success">
            <div class="stat-icon">✅</div>
            <div class="stat-label">Completed</div>
            <div class="stat-value">${s.completedOrders}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Recent Orders</h3>
            <button class="btn btn-primary btn-sm" onclick="navigate('new-tune')">+ New Tune</button>
          </div>
          <div class="table-wrapper">
            ${data.recentOrders.length ? `
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Client</th>
                  <th>Vehicle</th>
                  <th>Tune Type</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${data.recentOrders.map(o => `
                  <tr class="clickable" onclick="navigate('order-detail', {id:'${o.id}'})">
                    <td class="td-primary">${o.order_number}</td>
                    <td>${o.first_name} ${o.last_name}</td>
                    <td>${o.year || ''} ${o.make || ''} ${o.model || ''}</td>
                    <td>${formatTuneType(o.tune_type)}</td>
                    <td><span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span></td>
                    <td>${formatDate(o.created_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>` : `
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <h3>No orders yet</h3>
              <p>Submit your first tune request to get started</p>
            </div>`}
          </div>
        </div>
      `;
    }
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error loading dashboard</h3><p>${err.message}</p></div>`;
  }
}

// Quick status update from work queue
async function quickUpdateStatus(orderId) {
  try {
    const status = document.getElementById(`qStatus_${orderId}`).value;
    const priceEl = document.getElementById(`qPrice_${orderId}`);
    const price = priceEl ? parseFloat(priceEl.value) || 0 : 0;

    await api('PUT', `/api/tunes/${orderId}/status`, { status });
    if (price > 0) {
      await api('PUT', `/api/tunes/${orderId}/set-price`, { price });
    }
    toast('Order updated!', 'success');
    loadDashboard();
  } catch (err) { toast(err.message, 'error'); }
}

// Time ago helper for work queue
function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const then = new Date(dateStr + 'Z');
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days === 1) return '1 day ago';
  return days + ' days ago';
}

// ---- NEW TUNE REQUEST ----
async function loadNewTune() {
  const main = document.getElementById('mainContent');

  // Load tune options and clients
  try {
    if (!TUNE_OPTIONS) {
      const optData = await api('GET', '/api/tunes/options');
      TUNE_OPTIONS = optData.options;
    }
    const clientData = await api('GET', '/api/clients');

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">New Tune Request</h1>
          <p class="page-subtitle">Submit a stock ECU file for tuning</p>
        </div>
      </div>

      <form id="tuneForm">
        <!-- Step 1: Client -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-header">
            <h3>1. Select or Create Client</h3>
            <button type="button" class="btn btn-secondary btn-sm" onclick="showNewClientModal()">+ New Client</button>
          </div>
          <div class="card-body">
            <div class="form-group mb-0">
              <select class="form-control" id="tuneClientId" required>
                <option value="">-- Select a client --</option>
                ${clientData.clients.map(c => `<option value="${c.id}">${c.last_name}, ${c.first_name}${c.email ? ' (' + c.email + ')' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- Step 2: Vehicle -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-header">
            <h3>2. Vehicle Information</h3>
          </div>
          <div class="card-body">
            <div class="form-group">
              <label>VIN (Vehicle Identification Number)</label>
              <div class="vin-input-group">
                <input type="text" class="form-control" id="tuneVin" maxlength="17" placeholder="Enter 17-character VIN">
                <button type="button" class="btn btn-primary btn-decode" id="btnDecodeVin">Decode VIN</button>
              </div>
              <div class="form-help">Enter the VIN and click Decode to auto-fill vehicle details</div>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Year</label>
                <input type="number" class="form-control" id="tuneYear" placeholder="2024">
              </div>
              <div class="form-group">
                <label>Make</label>
                <input type="text" class="form-control" id="tuneMake" placeholder="BMW">
              </div>
              <div class="form-group">
                <label>Model</label>
                <input type="text" class="form-control" id="tuneModel" placeholder="340i">
              </div>
              <div class="form-group">
                <label>Engine</label>
                <input type="text" class="form-control" id="tuneEngine" placeholder="3.0L 6cyl Turbo">
              </div>
              <div class="form-group">
                <label>Engine Code</label>
                <input type="text" class="form-control" id="tuneEngineCode" placeholder="B58">
              </div>
              <div class="form-group">
                <label>Transmission</label>
                <select class="form-control" id="tuneTransmission">
                  <option value="">Select...</option>
                  <option value="Manual">Manual</option>
                  <option value="Automatic">Automatic</option>
                  <option value="DCT">DCT / Dual Clutch</option>
                  <option value="CVT">CVT</option>
                </select>
              </div>
              <div class="form-group">
                <label>ECU Type</label>
                <input type="text" class="form-control" id="tuneEcuType" placeholder="Bosch MG1CS003">
              </div>
              <div class="form-group">
                <label>TCU Type</label>
                <input type="text" class="form-control" id="tuneTcuType" placeholder="Optional">
              </div>
            </div>

            <div id="vehicleSelect" style="display:none; margin-top:16px;">
              <label style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--text-secondary);font-family:Poppins,sans-serif;font-weight:500;margin-bottom:8px;display:block;">Or Select Existing Vehicle</label>
              <select class="form-control" id="existingVehicleId">
                <option value="">-- Add new vehicle --</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Step 3: Tune Options -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-header">
            <h3>3. Tune Type & Options</h3>
          </div>
          <div class="card-body">
            <div class="form-group">
              <label>Primary Tune Type</label>
              <select class="form-control" id="tuneTuneType" required>
                <option value="">-- Select tune type --</option>
                <option value="stage1">Stage 1</option>
                <option value="stage2">Stage 2</option>
                <option value="stage3">Custom Stage 3</option>
                <option value="eco_tune">Economy Tune</option>
                <option value="custom">Custom Request</option>
              </select>
            </div>

            ${Object.entries(TUNE_OPTIONS).filter(([k]) => k !== 'performance').map(([category, opts]) => `
              <div class="option-category">
                <div class="option-category-title">${category.charAt(0).toUpperCase() + category.slice(1)} Options</div>
                <div class="checkbox-grid">
                  ${opts.map(o => `
                    <div class="checkbox-item" onclick="toggleCheckbox(this)">
                      <input type="checkbox" name="tune_options" value="${o.id}" id="opt_${o.id}">
                      <label for="opt_${o.id}">${o.label}</label>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Step 4: File Upload -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-header">
            <h3>4. Upload Stock ECU File</h3>
          </div>
          <div class="card-body">
            <div class="file-upload-area" id="fileUploadArea" onclick="document.getElementById('stockFile').click()">
              <div class="file-upload-icon">📁</div>
              <div class="file-upload-text">Click to upload or drag and drop</div>
              <div class="file-upload-hint">Stock ECU read file — max 50MB</div>
              <div class="file-upload-name" id="fileName" style="display:none"></div>
              <input type="file" id="stockFile" accept="*/*" required>
            </div>

            <div class="form-group mt-2">
              <label>Additional Notes</label>
              <textarea class="form-control" id="tuneNotes" placeholder="Any special instructions or notes for ECC..."></textarea>
            </div>
          </div>
        </div>

        <!-- Submit -->
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" onclick="navigate('dashboard')">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btnSubmitTune">Submit Tune Request</button>
        </div>
      </form>

      <!-- New Client Modal -->
      <div class="modal-overlay" id="newClientModal">
        <div class="modal">
          <div class="modal-header">
            <h3>Add New Client</h3>
            <button class="modal-close" onclick="closeModal('newClientModal')">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-group">
                <label>First Name *</label>
                <input type="text" class="form-control" id="newClientFirst" required>
              </div>
              <div class="form-group">
                <label>Last Name *</label>
                <input type="text" class="form-control" id="newClientLast" required>
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" class="form-control" id="newClientEmail">
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input type="tel" class="form-control" id="newClientPhone">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal('newClientModal')">Cancel</button>
            <button class="btn btn-primary" id="btnSaveClient">Save Client</button>
          </div>
        </div>
      </div>
    `;

    bindTuneForm();
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error loading form</h3><p>${err.message}</p></div>`;
  }
}

function bindTuneForm() {
  // VIN decoder
  document.getElementById('btnDecodeVin').addEventListener('click', async () => {
    const vin = document.getElementById('tuneVin').value.trim();
    if (!vin) return toast('Please enter a VIN', 'error');

    const btn = document.getElementById('btnDecodeVin');
    btn.disabled = true;
    btn.textContent = 'Decoding...';

    try {
      const data = await api('GET', `/api/vehicles/decode-vin/${vin}`);
      const d = data.decoded;
      if (d.year) document.getElementById('tuneYear').value = d.year;
      if (d.make) document.getElementById('tuneMake').value = d.make;
      if (d.model) document.getElementById('tuneModel').value = d.model;
      if (d.engine) document.getElementById('tuneEngine').value = d.engine;
      if (d.engine_code) document.getElementById('tuneEngineCode').value = d.engine_code;
      if (d.transmission) {
        const sel = document.getElementById('tuneTransmission');
        for (let opt of sel.options) {
          if (opt.value && d.transmission.toLowerCase().includes(opt.value.toLowerCase())) {
            sel.value = opt.value;
            break;
          }
        }
      }
      toast('VIN decoded successfully!', 'success');
    } catch (err) {
      toast('VIN decode failed: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Decode VIN';
  });

  // Client change — load vehicles
  document.getElementById('tuneClientId').addEventListener('change', async (e) => {
    const clientId = e.target.value;
    const vSelect = document.getElementById('vehicleSelect');
    const vDropdown = document.getElementById('existingVehicleId');

    if (clientId) {
      try {
        const data = await api('GET', `/api/vehicles?client_id=${clientId}`);
        if (data.vehicles.length > 0) {
          vDropdown.innerHTML = '<option value="">-- Add new vehicle --</option>' +
            data.vehicles.map(v => `<option value="${v.id}">${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.vin ? '(VIN: ' + v.vin + ')' : ''}</option>`).join('');
          vSelect.style.display = 'block';
        } else {
          vSelect.style.display = 'none';
        }
      } catch (err) {}
    } else {
      vSelect.style.display = 'none';
    }
  });

  // Existing vehicle select — populate fields
  document.getElementById('existingVehicleId').addEventListener('change', async (e) => {
    // If they select an existing vehicle, we'll use that ID during submission
    // Clear fields if they select an existing one (the backend already has the data)
  });

  // File upload
  const fileInput = document.getElementById('stockFile');
  const uploadArea = document.getElementById('fileUploadArea');

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      const nameEl = document.getElementById('fileName');
      nameEl.textContent = '✓ ' + fileInput.files[0].name;
      nameEl.style.display = 'block';
      uploadArea.classList.add('has-file');
    }
  });

  // Drag and drop
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--primary)'; });
  uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '';
    if (e.dataTransfer.files[0]) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  // Save new client
  document.getElementById('btnSaveClient').addEventListener('click', async () => {
    const first = document.getElementById('newClientFirst').value.trim();
    const last = document.getElementById('newClientLast').value.trim();
    if (!first || !last) return toast('First and last name required', 'error');

    try {
      const data = await api('POST', '/api/clients', {
        first_name: first,
        last_name: last,
        email: document.getElementById('newClientEmail').value.trim(),
        phone: document.getElementById('newClientPhone').value.trim()
      });

      // Add to select and choose it
      const select = document.getElementById('tuneClientId');
      const opt = document.createElement('option');
      opt.value = data.client.id;
      opt.textContent = `${data.client.last_name}, ${data.client.first_name}`;
      opt.selected = true;
      select.appendChild(opt);

      closeModal('newClientModal');
      toast('Client created!', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Submit tune form
  document.getElementById('tuneForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const clientId = document.getElementById('tuneClientId').value;
    const tuneType = document.getElementById('tuneTuneType').value;
    const stockFile = document.getElementById('stockFile').files[0];

    if (!clientId) return toast('Please select a client', 'error');
    if (!tuneType) return toast('Please select a tune type', 'error');
    if (!stockFile) return toast('Please upload a stock ECU file', 'error');

    const btn = document.getElementById('btnSubmitTune');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Submitting...';

    try {
      // Create vehicle if needed
      let vehicleId = document.getElementById('existingVehicleId')?.value;

      if (!vehicleId) {
        const vData = await api('POST', '/api/vehicles', {
          client_id: clientId,
          vin: document.getElementById('tuneVin').value.trim(),
          year: document.getElementById('tuneYear').value ? parseInt(document.getElementById('tuneYear').value) : null,
          make: document.getElementById('tuneMake').value.trim(),
          model: document.getElementById('tuneModel').value.trim(),
          engine: document.getElementById('tuneEngine').value.trim(),
          engine_code: document.getElementById('tuneEngineCode').value.trim(),
          transmission: document.getElementById('tuneTransmission').value,
          ecu_type: document.getElementById('tuneEcuType').value.trim(),
          tcu_type: document.getElementById('tuneTcuType').value.trim()
        });
        vehicleId = vData.vehicle.id;
      }

      // Gather selected options
      const selectedOptions = [];
      document.querySelectorAll('input[name="tune_options"]:checked').forEach(cb => {
        selectedOptions.push(cb.value);
      });

      // Build FormData
      const formData = new FormData();
      formData.append('client_id', clientId);
      formData.append('vehicle_id', vehicleId);
      formData.append('tune_type', tuneType);
      formData.append('options', JSON.stringify(selectedOptions));
      formData.append('notes', document.getElementById('tuneNotes').value.trim());
      formData.append('stock_file', stockFile);

      const result = await api('POST', '/api/tunes', formData, true);
      toast(`Tune order ${result.order.order_number} submitted!`, 'success');
      navigate('orders');
    } catch (err) {
      toast('Error: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Tune Request';
    }
  });
}

function toggleCheckbox(item) {
  const cb = item.querySelector('input[type="checkbox"]');
  cb.checked = !cb.checked;
  item.classList.toggle('checked', cb.checked);
}

function showNewClientModal() { document.getElementById('newClientModal').classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ---- ORDERS LIST ----
async function loadOrders() {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', '/api/tunes');

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${DEALER.is_admin ? 'All Orders' : 'My Orders'}</h1>
          <p class="page-subtitle">${data.orders.length} total orders</p>
        </div>
        <button class="btn btn-primary" onclick="navigate('new-tune')">+ New Tune</button>
      </div>

      <div class="card">
        <div class="table-wrapper">
          ${data.orders.length ? `
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Client</th>
                <th>Vehicle</th>
                <th>ECU</th>
                <th>Tune Type</th>
                <th>Options</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${data.orders.map(o => {
                let opts = [];
                try { opts = JSON.parse(o.options || '[]'); } catch(e) {}
                return `
                <tr class="clickable" onclick="navigate('order-detail', {id:'${o.id}'})">
                  <td class="td-primary">${o.order_number}</td>
                  <td>${o.first_name} ${o.last_name}</td>
                  <td>${o.year || ''} ${o.make || ''} ${o.model || ''}</td>
                  <td>${o.ecu_type || '—'}</td>
                  <td>${formatTuneType(o.tune_type)}</td>
                  <td>${opts.length ? opts.length + ' selected' : '—'}</td>
                  <td><span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span></td>
                  <td>${formatDate(o.created_at)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>` : `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <h3>No orders</h3>
            <p>Submit a tune request to see your orders here</p>
          </div>`}
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

// ---- ORDER DETAIL ----
async function loadOrderDetail(orderId) {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', `/api/tunes/${orderId}`);
    const o = data.order;
    let opts = [];
    try { opts = JSON.parse(o.options || '[]'); } catch(e) {}

    // Map option IDs to labels
    const allOptions = TUNE_OPTIONS ? Object.values(TUNE_OPTIONS).flat() : [];
    const optionLabels = opts.map(id => {
      const found = allOptions.find(opt => opt.id === id);
      return found ? found.label : id;
    });

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Order ${o.order_number}</h1>
          <p class="page-subtitle">Submitted ${formatDate(o.created_at)}</p>
        </div>
        <span class="badge badge-${o.status}" style="font-size:14px;padding:8px 20px;">${o.status.replace('_', ' ')}</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <div class="card-header"><h3>Vehicle Details</h3></div>
          <div class="card-body">
            <div class="detail-grid">
              <div class="detail-item"><div class="detail-label">VIN</div><div class="detail-value">${o.vin || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Vehicle</div><div class="detail-value">${o.year || ''} ${o.make || ''} ${o.model || ''}</div></div>
              <div class="detail-item"><div class="detail-label">Engine</div><div class="detail-value">${o.engine || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Engine Code</div><div class="detail-value">${o.engine_code || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Transmission</div><div class="detail-value">${o.transmission || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">ECU Type</div><div class="detail-value">${o.ecu_type || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">TCU Type</div><div class="detail-value">${o.tcu_type || '—'}</div></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Client & Dealer</h3></div>
          <div class="card-body">
            <div class="detail-grid">
              <div class="detail-item"><div class="detail-label">Client</div><div class="detail-value">${o.first_name} ${o.last_name}</div></div>
              <div class="detail-item"><div class="detail-label">Client Email</div><div class="detail-value">${o.client_email || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Client Phone</div><div class="detail-value">${o.client_phone || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Dealer</div><div class="detail-value">${o.dealer_name}</div></div>
              <div class="detail-item"><div class="detail-label">Dealer Contact</div><div class="detail-value">${o.dealer_contact}</div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:20px">
        <div class="card-header"><h3>Tune Details</h3></div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Tune Type</div><div class="detail-value">${formatTuneType(o.tune_type)}</div></div>
            <div class="detail-item">
              <div class="detail-label">Selected Options</div>
              <div class="detail-value">${optionLabels.length ? optionLabels.join(', ') : 'None'}</div>
            </div>
            <div class="detail-item"><div class="detail-label">Notes</div><div class="detail-value">${o.notes || 'None'}</div></div>
            ${o.admin_notes ? `<div class="detail-item"><div class="detail-label">ECC Notes</div><div class="detail-value">${o.admin_notes}</div></div>` : ''}
          </div>

          ${o.price > 0 ? `
          <div class="detail-grid" style="margin-top:12px;">
            <div class="detail-item"><div class="detail-label">Price</div><div class="detail-value" style="color:var(--primary);font-weight:600;font-size:18px;">$${o.price.toFixed(2)}</div></div>
            <div class="detail-item"><div class="detail-label">Payment</div><div class="detail-value"><span class="badge badge-${o.is_paid ? 'completed' : 'pending'}">${o.is_paid ? 'Paid' : 'Unpaid'}</span></div></div>
          </div>` : ''}

          <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
            ${o.stock_file_name ? `<button class="btn btn-secondary btn-sm" onclick="downloadFile('/api/tunes/${o.id}/download/stock','${(o.stock_file_name||'stock.bin').replace(/'/g,"\\'")}')">📥 Download Stock File (${o.stock_file_name})</button>` : ''}
            ${o.tuned_file_name && (DEALER.is_admin || o.is_paid || o.price <= 0) ? `<button class="btn btn-primary btn-sm" onclick="downloadFile('/api/tunes/${o.id}/download/tuned','${(o.tuned_file_name||'tuned.bin').replace(/'/g,"\\'")}')">📥 Download Tuned File (${o.tuned_file_name})</button>` : ''}
            ${o.tuned_file_name && !DEALER.is_admin && o.price > 0 && !o.is_paid ? `<button class="btn btn-primary btn-sm" onclick="payForTune('${o.id}', ${o.price})">💳 Pay $${o.price.toFixed(2)} to Download</button>` : ''}
          </div>
        </div>
      </div>

      ${DEALER.is_admin ? `
      <div class="card" style="margin-top:20px">
        <div class="card-header"><h3>Admin Actions</h3></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Update Status</label>
              <select class="form-control" id="adminStatus">
                <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="in_progress" ${o.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="completed" ${o.status === 'completed' ? 'selected' : ''}>Completed</option>
                <option value="on_hold" ${o.status === 'on_hold' ? 'selected' : ''}>On Hold</option>
                <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>
            </div>
            <div class="form-group">
              <label>Price ($)</label>
              <input type="number" step="0.01" min="0" class="form-control" id="adminPrice" value="${o.price || 0}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Admin Notes</label>
              <input type="text" class="form-control" id="adminNotes" value="${o.admin_notes || ''}" placeholder="Internal notes...">
            </div>
          </div>
          <div style="display:flex;gap:12px;margin-top:12px;">
            <button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${o.id}')">Update Status</button>
            <label class="btn btn-secondary btn-sm" style="cursor:pointer">
              📤 Upload Tuned File
              <input type="file" style="display:none" onchange="uploadTunedFile('${o.id}', this)">
            </label>
          </div>
        </div>
      </div>` : ''}

      <div style="margin-top:20px">
        <button class="btn btn-secondary" onclick="navigate('orders')">← Back to Orders</button>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function updateOrderStatus(orderId) {
  try {
    const status = document.getElementById('adminStatus').value;
    const admin_notes = document.getElementById('adminNotes').value;
    const price = parseFloat(document.getElementById('adminPrice').value) || 0;

    // Update status
    await api('PUT', `/api/tunes/${orderId}/status`, { status, admin_notes });
    // Update price
    await api('PUT', `/api/tunes/${orderId}/set-price`, { price });

    toast('Order updated!', 'success');
    loadOrderDetail(orderId);
  } catch (err) { toast(err.message, 'error'); }
}

async function payForTune(orderId, price) {
  if (!confirm(`Pay $${price.toFixed(2)} from your account balance to download the tuned file?`)) return;
  try {
    await api('POST', `/api/tunes/${orderId}/pay`);
    toast('Payment successful! You can now download the tuned file.', 'success');
    loadOrderDetail(orderId);
  } catch (err) { toast(err.message, 'error'); }
}

async function uploadTunedFile(orderId, input) {
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('tuned_file', input.files[0]);

  // Try to get price from admin price input (order detail page) or prompt
  const priceEl = document.getElementById('adminPrice');
  const price = priceEl ? parseFloat(priceEl.value) || 0 : 0;
  formData.append('price', price);

  try {
    await api('POST', `/api/tunes/${orderId}/tuned-file`, formData, true);
    toast('Tuned file uploaded!', 'success');
    // Reload whichever view we're on
    if (document.getElementById('workQueueContainer')) {
      loadDashboard();
    } else {
      loadOrderDetail(orderId);
    }
  } catch (err) { toast(err.message, 'error'); }
}

// ---- CLIENTS ----
async function loadClients() {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', '/api/clients');

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Clients</h1>
          <p class="page-subtitle">Shared client database across all dealers</p>
        </div>
        <button class="btn btn-primary" onclick="showAddClientPage()">+ Add Client</button>
      </div>

      <div class="search-bar">
        <input type="text" class="form-control" id="clientSearch" placeholder="Search by name, email, or phone...">
        <button class="btn btn-secondary btn-sm" onclick="searchClients()">Search</button>
      </div>

      <div class="card">
        <div class="table-wrapper">
          ${data.clients.length ? `
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Vehicles</th>
                <th>Orders</th>
                <th>Added By</th>
              </tr>
            </thead>
            <tbody id="clientsTable">
              ${renderClientRows(data.clients)}
            </tbody>
          </table>` : `
          <div class="empty-state">
            <div class="empty-icon">👤</div>
            <h3>No clients yet</h3>
            <p>Create a client when submitting a tune request</p>
          </div>`}
        </div>
      </div>
    `;

    document.getElementById('clientSearch')?.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') searchClients();
    });
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderClientRows(clients) {
  return clients.map(c => `
    <tr class="clickable" onclick="navigate('client-detail', {id:'${c.id}'})">
      <td class="td-primary">${c.first_name} ${c.last_name}</td>
      <td>${c.email || '—'}</td>
      <td>${c.phone || '—'}</td>
      <td>${c.vehicle_count || 0}</td>
      <td>${c.order_count || 0}</td>
      <td>${c.created_by_company || '—'}</td>
    </tr>
  `).join('');
}

async function searchClients() {
  const search = document.getElementById('clientSearch').value.trim();
  try {
    const data = await api('GET', `/api/clients${search ? '?search=' + encodeURIComponent(search) : ''}`);
    document.getElementById('clientsTable').innerHTML = renderClientRows(data.clients);
  } catch (err) { toast(err.message, 'error'); }
}

function showAddClientPage() {
  // Redirect to new tune which has client creation
  navigate('new-tune');
}

// ---- CLIENT DETAIL ----
async function loadClientDetail(clientId) {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', `/api/clients/${clientId}`);
    const c = data.client;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${c.first_name} ${c.last_name}</h1>
          <p class="page-subtitle">Client Profile — Added by ${c.created_by_company || 'Unknown'}</p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <div class="card-header"><h3>Contact Info</h3></div>
          <div class="card-body">
            <div class="detail-grid">
              <div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">${c.email || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Phone</div><div class="detail-value">${c.phone || '—'}</div></div>
              <div class="detail-item"><div class="detail-label">Notes</div><div class="detail-value">${c.notes || '—'}</div></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Vehicles (${data.vehicles.length})</h3></div>
          <div class="card-body">
            ${data.vehicles.length ? data.vehicles.map(v => `
              <div style="padding:10px 0;border-bottom:1px solid var(--border);">
                <strong>${v.year || ''} ${v.make || ''} ${v.model || ''}</strong><br>
                <span class="text-muted" style="font-size:13px;">VIN: ${v.vin || '—'} | ECU: ${v.ecu_type || '—'} | Engine: ${v.engine || '—'}</span>
              </div>
            `).join('') : '<p class="text-muted">No vehicles</p>'}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:20px">
        <div class="card-header"><h3>Tune Orders (${data.orders.length})</h3></div>
        <div class="table-wrapper">
          ${data.orders.length ? `
          <table>
            <thead>
              <tr><th>Order #</th><th>Vehicle</th><th>Dealer</th><th>Tune Type</th><th>Status</th><th>Date</th></tr>
            </thead>
            <tbody>
              ${data.orders.map(o => `
                <tr class="clickable" onclick="navigate('order-detail', {id:'${o.id}'})">
                  <td class="td-primary">${o.order_number}</td>
                  <td>${o.year || ''} ${o.make || ''} ${o.model || ''}</td>
                  <td>${o.dealer_name}</td>
                  <td>${formatTuneType(o.tune_type)}</td>
                  <td><span class="badge badge-${o.status}">${o.status.replace('_', ' ')}</span></td>
                  <td>${formatDate(o.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>` : '<div class="empty-state"><p>No tune orders for this client</p></div>'}
        </div>
      </div>

      <div style="margin-top:20px">
        <button class="btn btn-secondary" onclick="navigate('clients')">← Back to Clients</button>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

// ---- VEHICLES ----
async function loadVehicles() {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', '/api/vehicles');

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Vehicles</h1>
          <p class="page-subtitle">${data.vehicles.length} vehicles registered</p>
        </div>
      </div>

      <div class="search-bar">
        <input type="text" class="form-control" id="vehicleSearch" placeholder="Search by VIN, make, model, or owner...">
        <button class="btn btn-secondary btn-sm" onclick="searchVehicles()">Search</button>
      </div>

      <div class="card">
        <div class="table-wrapper">
          ${data.vehicles.length ? `
          <table>
            <thead>
              <tr><th>Vehicle</th><th>VIN</th><th>Engine</th><th>ECU</th><th>Owner</th></tr>
            </thead>
            <tbody id="vehiclesTable">
              ${renderVehicleRows(data.vehicles)}
            </tbody>
          </table>` : `
          <div class="empty-state">
            <div class="empty-icon">🚗</div>
            <h3>No vehicles</h3>
            <p>Vehicles are added when submitting tune requests</p>
          </div>`}
        </div>
      </div>
    `;

    document.getElementById('vehicleSearch')?.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') searchVehicles();
    });
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderVehicleRows(vehicles) {
  return vehicles.map(v => `
    <tr>
      <td class="td-primary">${v.year || ''} ${v.make || ''} ${v.model || ''}</td>
      <td>${v.vin || '—'}</td>
      <td>${v.engine || '—'}</td>
      <td>${v.ecu_type || '—'}</td>
      <td class="clickable" onclick="navigate('client-detail', {id:'${v.client_id}'})">${v.first_name} ${v.last_name}</td>
    </tr>
  `).join('');
}

async function searchVehicles() {
  const search = document.getElementById('vehicleSearch').value.trim();
  try {
    const data = await api('GET', `/api/vehicles${search ? '?search=' + encodeURIComponent(search) : ''}`);
    document.getElementById('vehiclesTable').innerHTML = renderVehicleRows(data.vehicles);
  } catch (err) { toast(err.message, 'error'); }
}

// ---- SETTINGS ----
async function loadSettings() {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', '/api/auth/me');
    const d = data.dealer;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Manage your account</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><h3>Dealer Information</h3></div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Company</div><div class="detail-value">${d.company_name}</div></div>
            <div class="detail-item"><div class="detail-label">Contact</div><div class="detail-value">${d.contact_name}</div></div>
            <div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">${d.email}</div></div>
            <div class="detail-item"><div class="detail-label">Phone</div><div class="detail-value">${d.phone || '—'}</div></div>
            <div class="detail-item"><div class="detail-label">Address</div><div class="detail-value">${[d.address, d.city, d.province, d.postal_code].filter(Boolean).join(', ') || '—'}</div></div>
            <div class="detail-item"><div class="detail-label">Account Balance</div><div class="detail-value credit-amount">$${(d.account_balance || 0).toFixed(2)}</div></div>
            <div class="detail-item"><div class="detail-label">Member Since</div><div class="detail-value">${formatDate(d.created_at)}</div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Change Password</h3></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" class="form-control" id="currentPassword">
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" class="form-control" id="newPassword">
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="changePassword()">Update Password</button>
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function changePassword() {
  const current = document.getElementById('currentPassword').value;
  const newPw = document.getElementById('newPassword').value;
  if (!current || !newPw) return toast('Fill in both fields', 'error');
  if (newPw.length < 6) return toast('Password must be at least 6 characters', 'error');

  try {
    await api('PUT', '/api/auth/password', { current_password: current, new_password: newPw });
    toast('Password updated!', 'success');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
  } catch (err) { toast(err.message, 'error'); }
}

// ---- HARDWARE CATALOG ----
// ---- TOOLS PAGE (tuning tools, cables, adapters + kits) ----
async function loadTools() {
  const main = document.getElementById('mainContent');
  try {
    const [prodData, kitData] = await Promise.all([
      api('GET', '/api/hardware?type=tools'),
      api('GET', '/api/hardware/kits')
    ]);
    const products = prodData.products;
    const kits = kitData.kits;

    // Group products by category
    const categories = {};
    products.forEach(p => {
      if (!categories[p.category]) categories[p.category] = [];
      categories[p.category].push(p);
    });

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Tools</h1>
          <p class="page-subtitle">Tuning tools, cables, adapters & kits — ${DEALER.role === 'distributor' ? 'distributor' : 'dealer'} pricing shown</p>
        </div>
      </div>

      ${kits.length ? `
      <div style="margin-bottom:28px;">
        <h2 style="font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:16px;font-family:'Poppins',sans-serif;">Tuning Kits & Bundles</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px;">
          ${kits.map(kit => `
            <div class="card work-queue-card" style="border-top:3px solid var(--primary);position:relative;overflow:hidden;">
              ${kit.badge ? `<div style="position:absolute;top:12px;right:-30px;background:var(--primary);color:#fff;font-size:10px;font-weight:700;padding:3px 36px;transform:rotate(45deg);text-transform:uppercase;letter-spacing:1px;">${kit.badge}</div>` : ''}
              <div style="padding:20px;">
                <div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">${kit.name}</div>
                <div style="font-size:12px;color:var(--text-muted);font-family:monospace;margin-bottom:10px;">SKU: ${kit.sku}</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">${kit.description}</div>

                <div style="background:var(--bg-primary);border-radius:8px;padding:12px;margin-bottom:16px;">
                  <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Kit Includes:</div>
                  ${kit.items.map(item => `
                    <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;">
                      <span style="color:var(--text-secondary);">${item.name}</span>
                      <span style="color:var(--text-muted);font-weight:500;">x${item.quantity}</span>
                    </div>
                  `).join('')}
                </div>

                <div style="display:flex;justify-content:space-between;align-items:flex-end;">
                  <div>
                    <div style="font-size:11px;color:var(--text-muted);text-decoration:line-through;">MSRP $${kit.msrp.toFixed(2)}</div>
                    <div style="font-size:26px;font-weight:700;color:var(--primary);">$${kit.your_price.toFixed(2)}</div>
                    <div style="font-size:12px;color:#81c784;font-weight:600;">Save ${kit.savings_pct}%</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:12px;color:${kit.in_stock ? '#81c784' : '#ef5350'};margin-bottom:8px;">${kit.in_stock ? 'In Stock' : 'Some items out of stock'}</div>
                    ${!DEALER.is_admin && kit.in_stock ? `<button class="btn btn-primary" style="font-size:13px;" onclick="orderKit('${kit.id}','${kit.name}',${kit.your_price})">Buy Kit</button>` : ''}
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <h2 style="font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:16px;font-family:'Poppins',sans-serif;">Individual Products</h2>

      ${Object.entries(categories).map(([cat, items]) => `
        <div class="card" style="margin-bottom:20px">
          <div class="card-header"><h3>${cat}</h3></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding:16px 20px;">
            ${items.map(p => `
              <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--bg-primary);">
                <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">${p.name}</div>
                <div style="font-size:12px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;">SKU: ${p.sku || '—'}</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">${p.description || ''}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <div style="font-size:11px;color:var(--text-muted);text-decoration:line-through;">MSRP $${p.msrp.toFixed(2)}</div>
                    <div style="font-size:20px;font-weight:700;color:var(--primary);">$${p.your_price.toFixed(2)}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:12px;color:${p.stock_qty > 0 ? '#81c784' : '#ef5350'};">${p.stock_qty > 0 ? p.stock_qty + ' in stock' : 'Out of stock'}</div>
                    ${!DEALER.is_admin && p.stock_qty > 0 ? `<button class="btn btn-primary btn-sm" style="margin-top:6px;font-size:11px;" onclick="addToCart('${p.id}','${p.name}',${p.your_price})">Add to Cart</button>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}

      ${!DEALER.is_admin ? `
      <div class="card" id="cartCard" style="display:none;">
        <div class="card-header"><h3>Shopping Cart</h3></div>
        <div id="cartItems" style="padding:16px 20px;"></div>
        <div style="padding:0 20px 16px;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:18px;font-weight:600;color:var(--primary);" id="cartTotal">$0.00</div>
          <button class="btn btn-primary" onclick="submitHardwareOrder()">Place Order</button>
        </div>
      </div>` : ''}
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

// ---- ECC PERFORMANCE HARDWARE PAGE (emulators, sensors, modules) ----
async function loadPerfHardware() {
  const main = document.getElementById('mainContent');
  try {
    const prodData = await api('GET', '/api/hardware?type=hardware');
    const products = prodData.products;

    // Group products by category
    const categories = {};
    products.forEach(p => {
      if (!categories[p.category]) categories[p.category] = [];
      categories[p.category].push(p);
    });

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">ECC Performance Hardware</h1>
          <p class="page-subtitle">Emulators, sensors & performance modules — ${DEALER.role === 'distributor' ? 'distributor' : 'dealer'} pricing shown</p>
        </div>
      </div>

      ${products.length === 0 ? `
        <div class="empty-state">
          <h3>No Products Available</h3>
          <p>Performance hardware products will appear here once added.</p>
        </div>
      ` : `
        ${Object.entries(categories).map(([cat, items]) => `
          <div class="card" style="margin-bottom:20px">
            <div class="card-header"><h3>${cat}</h3></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding:16px 20px;">
              ${items.map(p => `
                <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--bg-primary);">
                  <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">${p.name}</div>
                  <div style="font-size:12px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;">SKU: ${p.sku || '—'}</div>
                  <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">${p.description || ''}</div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:11px;color:var(--text-muted);text-decoration:line-through;">MSRP $${p.msrp.toFixed(2)}</div>
                      <div style="font-size:20px;font-weight:700;color:var(--primary);">$${p.your_price.toFixed(2)}</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:12px;color:${p.stock_qty > 0 ? '#81c784' : '#ef5350'};">${p.stock_qty > 0 ? p.stock_qty + ' in stock' : 'Out of stock'}</div>
                      ${!DEALER.is_admin && p.stock_qty > 0 ? `<button class="btn btn-primary btn-sm" style="margin-top:6px;font-size:11px;" onclick="addToCart('${p.id}','${p.name}',${p.your_price})">Add to Cart</button>` : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}

        ${!DEALER.is_admin ? `
        <div class="card" id="cartCard" style="display:none;">
          <div class="card-header"><h3>Shopping Cart</h3></div>
          <div id="cartItems" style="padding:16px 20px;"></div>
          <div style="padding:0 20px 16px;display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:18px;font-weight:600;color:var(--primary);" id="cartTotal">$0.00</div>
            <button class="btn btn-primary" onclick="submitHardwareOrder()">Place Order</button>
          </div>
        </div>` : ''}
      `}
    `;
    // Re-render cart if items exist
    if (_cart.length) renderCart();
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function orderKit(kitId, kitName, kitPrice) {
  if (!confirm(`Order the ${kitName} for $${kitPrice.toFixed(2)}? This will be charged to your account balance.`)) return;
  try {
    const data = await api('POST', '/api/hardware/kits/order', { kit_id: kitId });
    toast(`${kitName} ordered! Order #${data.order.order_number}`, 'success');
    loadTools();
  } catch (err) { toast(err.message, 'error'); }
}

let _cart = [];
function addToCart(productId, name, price) {
  const existing = _cart.find(i => i.product_id === productId);
  if (existing) {
    existing.quantity++;
  } else {
    _cart.push({ product_id: productId, name, price, quantity: 1 });
  }
  renderCart();
  toast(name + ' added to cart', 'success');
}

function removeFromCart(idx) {
  _cart.splice(idx, 1);
  renderCart();
}

function renderCart() {
  const card = document.getElementById('cartCard');
  const container = document.getElementById('cartItems');
  if (!card || !container) return;

  if (_cart.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  let total = 0;
  container.innerHTML = _cart.map((item, i) => {
    const lineTotal = item.price * item.quantity;
    total += lineTotal;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div>
          <span style="font-weight:500;">${item.name}</span>
          <span style="color:var(--text-muted);font-size:13px;"> x${item.quantity}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-weight:600;">$${lineTotal.toFixed(2)}</span>
          <button class="btn btn-secondary btn-sm" style="font-size:10px;padding:2px 8px;" onclick="removeFromCart(${i})">✕</button>
        </div>
      </div>`;
  }).join('');
  document.getElementById('cartTotal').textContent = '$' + total.toFixed(2);
}

async function submitHardwareOrder() {
  if (!_cart.length) return toast('Cart is empty', 'error');
  if (!confirm('Place this hardware order? The total will be deducted from your account balance.')) return;

  try {
    const items = _cart.map(i => ({ product_id: i.product_id, quantity: i.quantity }));
    await api('POST', '/api/hardware/order', { items });
    toast('Hardware order placed successfully!', 'success');
    _cart = [];
    navigate(location.hash.replace('#','') || 'tools');
  } catch (err) { toast(err.message, 'error'); }
}

// ---- MANAGE CATALOG (admin & distributor) ----
async function loadManageCatalog() {
  const main = document.getElementById('mainContent');
  try {
    const [prodData, kitData] = await Promise.all([
      api('GET', '/api/hardware'),
      api('GET', '/api/hardware/kits')
    ]);
    const products = prodData.products;
    const kits = kitData.kits;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Manage Catalog</h1>
          <p class="page-subtitle">Products, kits & bundles</p>
        </div>
      </div>

      <!-- KITS SECTION -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h3>Tuning Kits & Bundles</h3>
          <button class="btn btn-primary btn-sm" onclick="showKitForm()">+ New Kit</button>
        </div>

        <div id="kitFormArea" style="display:none;padding:20px;border-bottom:1px solid var(--border);">
          <input type="hidden" id="kfId">
          <div class="form-grid">
            <div class="form-group"><label>Kit Name *</label><input class="form-control" id="kfName"></div>
            <div class="form-group"><label>SKU</label><input class="form-control" id="kfSku"></div>
            <div class="form-group" style="grid-column:span 2;"><label>Description</label><textarea class="form-control" id="kfDesc" rows="2"></textarea></div>
            <div class="form-group"><label>Badge Label</label><input class="form-control" id="kfBadge" placeholder="e.g. Best Value, Most Popular"></div>
            <div class="form-group"><label>MSRP ($)</label><input type="number" step="0.01" class="form-control" id="kfBase"></div>
            <div class="form-group"><label>Dealer Price ($)</label><input type="number" step="0.01" class="form-control" id="kfDealer"></div>
            <div class="form-group"><label>Distributor Price ($)</label><input type="number" step="0.01" class="form-control" id="kfDist"></div>
            <div class="form-group"><label>Sort Order</label><input type="number" class="form-control" id="kfSort" value="0"></div>
          </div>

          <div style="margin-top:12px;">
            <label style="font-weight:600;font-size:13px;margin-bottom:8px;display:block;">Kit Items (select products & quantities):</label>
            <div id="kitItemsBuilder">
              ${products.map(p => `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                  <input type="checkbox" id="kp_${p.id}" data-product-id="${p.id}">
                  <label for="kp_${p.id}" style="flex:1;font-size:13px;">${p.name} <span style="color:var(--text-muted);">(${p.category})</span></label>
                  <input type="number" min="1" value="1" style="width:60px;" class="form-control" id="kpq_${p.id}">
                </div>
              `).join('')}
            </div>
          </div>

          <div style="display:flex;gap:12px;margin-top:16px;">
            <button class="btn btn-primary" onclick="saveKit()">Save Kit</button>
            <button class="btn btn-secondary" onclick="document.getElementById('kitFormArea').style.display='none'">Cancel</button>
          </div>
        </div>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Name</th><th>SKU</th><th>Badge</th><th>MSRP</th><th>Dealer</th><th>Dist.</th><th>Items</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${kits.map(k => `
                <tr>
                  <td class="td-primary">${k.name}</td>
                  <td style="font-family:monospace;font-size:12px;">${k.sku || '—'}</td>
                  <td>${k.badge || '—'}</td>
                  <td>$${k.msrp.toFixed(2)}</td>
                  <td style="font-weight:600;">$${k.your_price.toFixed(2)}</td>
                  <td>$${(k.distributor_price || 0).toFixed(2)}</td>
                  <td>${k.items.length} products</td>
                  <td><span class="badge badge-${k.is_active ? 'completed' : 'cancelled'}">${k.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="editKit('${k.id}')">Edit</button>
                    ${k.is_active ? `<button class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="deactivateKit('${k.id}','${k.name}')">Disable</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- PRODUCTS SECTION -->
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h3>Individual Products</h3>
          <button class="btn btn-primary btn-sm" onclick="showProductForm()">+ New Product</button>
        </div>

        <div id="productFormArea" style="display:none;padding:20px;border-bottom:1px solid var(--border);">
          <input type="hidden" id="pfId">
          <div class="form-grid">
            <div class="form-group"><label>Product Name *</label><input class="form-control" id="pfName"></div>
            <div class="form-group"><label>SKU</label><input class="form-control" id="pfSku"></div>
            <div class="form-group"><label>Category</label>
              <select class="form-control" id="pfCategory">
                <option value="Tools">Tools</option>
                <option value="Cables">Cables</option>
                <option value="Adapters">Adapters</option>
                <option value="Emulators">Emulators</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-group"><label>Type</label>
              <select class="form-control" id="pfType">
                <option value="tools">Tools (tuning tools)</option>
                <option value="hardware">Performance Hardware</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:span 2;"><label>Description</label><textarea class="form-control" id="pfDesc" rows="2"></textarea></div>
            <div class="form-group"><label>MSRP ($)</label><input type="number" step="0.01" class="form-control" id="pfBase"></div>
            <div class="form-group"><label>Dealer Price ($)</label><input type="number" step="0.01" class="form-control" id="pfDealer"></div>
            <div class="form-group"><label>Distributor Price ($)</label><input type="number" step="0.01" class="form-control" id="pfDist"></div>
            <div class="form-group"><label>Stock Qty</label><input type="number" class="form-control" id="pfStock" value="0"></div>
          </div>
          <div style="display:flex;gap:12px;margin-top:12px;">
            <button class="btn btn-primary" onclick="saveProduct()">Save Product</button>
            <button class="btn btn-secondary" onclick="document.getElementById('productFormArea').style.display='none'">Cancel</button>
          </div>
        </div>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Product</th><th>SKU</th><th>Category</th><th>Type</th><th>MSRP</th><th>Dealer</th><th>Dist.</th><th>Stock</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${products.map(p => `
                <tr>
                  <td class="td-primary">${p.name}</td>
                  <td style="font-family:monospace;font-size:12px;">${p.sku || '—'}</td>
                  <td>${p.category || '—'}</td>
                  <td>${p.product_type === 'hardware' ? 'Perf. HW' : 'Tools'}</td>
                  <td>$${p.msrp.toFixed(2)}</td>
                  <td style="font-weight:600;">$${p.your_price.toFixed(2)}</td>
                  <td>$${(p.distributor_price || 0).toFixed(2)}</td>
                  <td>${p.stock_qty}</td>
                  <td>
                    <button class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="editProduct('${p.id}')">Edit</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Store for edit lookups
    window._catalogProducts = products;
    window._catalogKits = kits;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function showKitForm(clear = true) {
  if (clear) {
    document.getElementById('kfId').value = '';
    document.getElementById('kfName').value = '';
    document.getElementById('kfSku').value = '';
    document.getElementById('kfDesc').value = '';
    document.getElementById('kfBadge').value = '';
    document.getElementById('kfBase').value = '';
    document.getElementById('kfDealer').value = '';
    document.getElementById('kfDist').value = '';
    document.getElementById('kfSort').value = '0';
    // Uncheck all product checkboxes
    document.querySelectorAll('#kitItemsBuilder input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('#kitItemsBuilder input[type="number"]').forEach(inp => { inp.value = 1; });
  }
  document.getElementById('kitFormArea').style.display = 'block';
}

function editKit(kitId) {
  const kit = window._catalogKits.find(k => k.id === kitId);
  if (!kit) return;
  document.getElementById('kfId').value = kit.id;
  document.getElementById('kfName').value = kit.name;
  document.getElementById('kfSku').value = kit.sku || '';
  document.getElementById('kfDesc').value = kit.description || '';
  document.getElementById('kfBadge').value = kit.badge || '';
  document.getElementById('kfBase').value = kit.base_price;
  document.getElementById('kfDealer').value = kit.dealer_price;
  document.getElementById('kfDist').value = kit.distributor_price || '';
  document.getElementById('kfSort').value = kit.sort_order || 0;

  // Set checkboxes for kit items
  document.querySelectorAll('#kitItemsBuilder input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('#kitItemsBuilder input[type="number"]').forEach(inp => { inp.value = 1; });
  (kit.items || []).forEach(item => {
    const cb = document.getElementById('kp_' + item.product_id);
    const qty = document.getElementById('kpq_' + item.product_id);
    if (cb) cb.checked = true;
    if (qty) qty.value = item.quantity;
  });

  showKitForm(false);
}

async function saveKit() {
  const id = document.getElementById('kfId').value;
  const items = [];
  document.querySelectorAll('#kitItemsBuilder input[type="checkbox"]:checked').forEach(cb => {
    const productId = cb.dataset.productId;
    const qty = parseInt(document.getElementById('kpq_' + productId).value) || 1;
    items.push({ product_id: productId, quantity: qty });
  });

  const payload = {
    name: document.getElementById('kfName').value,
    sku: document.getElementById('kfSku').value || null,
    description: document.getElementById('kfDesc').value,
    badge: document.getElementById('kfBadge').value || null,
    base_price: parseFloat(document.getElementById('kfBase').value) || 0,
    dealer_price: parseFloat(document.getElementById('kfDealer').value) || 0,
    distributor_price: parseFloat(document.getElementById('kfDist').value) || 0,
    sort_order: parseInt(document.getElementById('kfSort').value) || 0,
    is_active: true,
    items
  };

  try {
    if (id) {
      await api('PUT', `/api/hardware/kits/${id}`, payload);
      toast('Kit updated!', 'success');
    } else {
      await api('POST', '/api/hardware/kits', payload);
      toast('Kit created!', 'success');
    }
    loadManageCatalog();
  } catch (err) { toast(err.message, 'error'); }
}

async function deactivateKit(kitId, kitName) {
  if (!confirm(`Disable kit "${kitName}"? It will no longer appear in the shop.`)) return;
  try {
    await api('DELETE', `/api/hardware/kits/${kitId}`);
    toast(`${kitName} disabled`, 'success');
    loadManageCatalog();
  } catch (err) { toast(err.message, 'error'); }
}

function showProductForm(clear = true) {
  if (clear) {
    document.getElementById('pfId').value = '';
    document.getElementById('pfName').value = '';
    document.getElementById('pfSku').value = '';
    document.getElementById('pfCategory').value = 'Tools';
    document.getElementById('pfType').value = 'tools';
    document.getElementById('pfDesc').value = '';
    document.getElementById('pfBase').value = '';
    document.getElementById('pfDealer').value = '';
    document.getElementById('pfDist').value = '';
    document.getElementById('pfStock').value = '0';
  }
  document.getElementById('productFormArea').style.display = 'block';
}

function editProduct(productId) {
  const p = window._catalogProducts.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('pfId').value = p.id;
  document.getElementById('pfName').value = p.name;
  document.getElementById('pfSku').value = p.sku || '';
  document.getElementById('pfCategory').value = p.category || 'Tools';
  document.getElementById('pfType').value = p.product_type || 'tools';
  document.getElementById('pfDesc').value = p.description || '';
  document.getElementById('pfBase').value = p.base_price;
  document.getElementById('pfDealer').value = p.dealer_price;
  document.getElementById('pfDist').value = p.distributor_price;
  document.getElementById('pfStock').value = p.stock_qty;
  showProductForm(false);
}

async function saveProduct() {
  const id = document.getElementById('pfId').value;
  const payload = {
    name: document.getElementById('pfName').value,
    sku: document.getElementById('pfSku').value || null,
    category: document.getElementById('pfCategory').value,
    product_type: document.getElementById('pfType').value,
    description: document.getElementById('pfDesc').value,
    base_price: parseFloat(document.getElementById('pfBase').value) || 0,
    dealer_price: parseFloat(document.getElementById('pfDealer').value) || 0,
    distributor_price: parseFloat(document.getElementById('pfDist').value) || 0,
    stock_qty: parseInt(document.getElementById('pfStock').value) || 0,
    is_active: true
  };

  try {
    if (id) {
      await api('PUT', `/api/hardware/${id}`, payload);
      toast('Product updated!', 'success');
    } else {
      await api('POST', '/api/hardware', payload);
      toast('Product created!', 'success');
    }
    loadManageCatalog();
  } catch (err) { toast(err.message, 'error'); }
}

// ---- ACCOUNT & BILLING ----
async function loadAccount() {
  const main = document.getElementById('mainContent');
  try {
    const [me, txData, depData] = await Promise.all([
      api('GET', '/api/auth/me'),
      api('GET', '/api/dealers/transactions'),
      api('GET', '/api/pricing/deposits')
    ]);
    const d = me.dealer;
    const txs = txData.transactions;
    const deposits = depData.requests;

    const isAdminOrDist = DEALER.is_admin || DEALER.role === 'distributor';
    const pendingDeposits = deposits.filter(r => r.status === 'pending');
    const myPending = deposits.filter(r => r.dealer_id === DEALER.id && r.status === 'pending');

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Account & Billing</h1>
          <p class="page-subtitle">${d.company_name}</p>
        </div>
        <div class="credit-display" style="text-align:right;">
          <span style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:1px;">Account Balance</span>
          <span class="credit-amount" style="font-size:28px;">$${(d.account_balance || 0).toFixed(2)}</span>
        </div>
      </div>

      ${!DEALER.is_admin ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header"><h3>Request Funds</h3></div>
        <div class="card-body">
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Submit a deposit request. Your ${DEALER.role === 'distributor' ? 'ECC HQ' : (d.parent_dealer_id ? 'distributor' : 'ECC HQ')} will process payment and approve the credit to your account.</p>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div style="display:flex;gap:8px;">
              ${[500, 1000, 2500, 5000].map(amt => `
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('depositAmount').value=${amt}">$${amt}</button>
              `).join('')}
            </div>
            <input type="number" step="0.01" min="1" class="form-control" id="depositAmount" placeholder="Amount" style="width:140px;">
            <button class="btn btn-primary" onclick="depositFunds()">Submit Request</button>
          </div>
          ${myPending.length ? `
          <div style="margin-top:16px;padding:12px;background:var(--bg-primary);border-radius:8px;">
            <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Pending Requests</div>
            ${myPending.map(r => `
              <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
                <span>$${r.amount.toFixed(2)}</span>
                <span class="badge badge-pending">Pending</span>
                <span style="color:var(--text-muted);">${formatDate(r.created_at)}</span>
              </div>
            `).join('')}
          </div>` : ''}
        </div>
      </div>` : ''}

      ${isAdminOrDist && pendingDeposits.length ? `
      <div class="card" style="margin-bottom:20px;border-left:3px solid var(--primary);">
        <div class="card-header"><h3>Pending Deposit Requests (${pendingDeposits.length})</h3></div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Dealer</th><th>Amount</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${pendingDeposits.map(r => `
                <tr>
                  <td class="td-primary">${r.company_name}<br><span style="font-size:11px;color:var(--text-muted);">${r.contact_name}</span></td>
                  <td style="font-size:18px;font-weight:700;color:var(--primary);">$${r.amount.toFixed(2)}</td>
                  <td>${formatDate(r.created_at)}</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 10px;" onclick="approveDeposit('${r.id}','${r.company_name}',${r.amount})">Approve</button>
                    <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 10px;" onclick="rejectDeposit('${r.id}','${r.company_name}')">Reject</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header"><h3>Transaction History</h3></div>
        <div class="table-wrapper">
          ${txs.length ? `
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Description</th><th>Order</th><th>Amount</th></tr>
            </thead>
            <tbody>
              ${txs.map(t => `
                <tr>
                  <td>${formatDate(t.created_at)}</td>
                  <td><span class="badge badge-${t.type === 'deposit' || t.type === 'commission' ? 'completed' : 'pending'}">${t.type}</span></td>
                  <td>${t.description || '—'}</td>
                  <td>${t.order_number || '—'}</td>
                  <td style="font-weight:600;color:${t.amount >= 0 ? '#81c784' : '#ef5350'};">${t.amount >= 0 ? '+' : ''}$${t.amount.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>` : `
          <div class="empty-state">
            <div class="empty-icon">💰</div>
            <h3>No transactions yet</h3>
            <p>Submit a deposit request to get started</p>
          </div>`}
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

async function depositFunds() {
  const amount = parseFloat(document.getElementById('depositAmount').value);
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'error');
  if (!confirm(`Submit a deposit request for $${amount.toFixed(2)}? This will be reviewed and approved by your account manager.`)) return;

  try {
    const data = await api('POST', '/api/pricing/deposit', { amount });
    toast(data.message, 'success');
    loadAccount();
  } catch (err) { toast(err.message, 'error'); }
}

async function approveDeposit(requestId, companyName, amount) {
  if (!confirm(`Approve $${amount.toFixed(2)} deposit for ${companyName}? This will credit their account.`)) return;
  try {
    const data = await api('PUT', `/api/pricing/deposits/${requestId}/approve`);
    toast(data.message, 'success');
    loadAccount();
  } catch (err) { toast(err.message, 'error'); }
}

async function rejectDeposit(requestId, companyName) {
  if (!confirm(`Reject deposit request from ${companyName}?`)) return;
  try {
    const data = await api('PUT', `/api/pricing/deposits/${requestId}/reject`);
    toast(data.message, 'success');
    loadAccount();
  } catch (err) { toast(err.message, 'error'); }
}

// ---- ADMIN DEALER MANAGEMENT ----
async function loadAdminDealers() {
  const main = document.getElementById('mainContent');
  try {
    const [dealerData, distData] = await Promise.all([
      api('GET', '/api/dealers'),
      api('GET', '/api/dealers/distributors')
    ]);
    const dealers = dealerData.dealers;
    const distributors = distData.distributors;
    _adminDealerList = dealers;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Dealer Management</h1>
          <p class="page-subtitle">${dealers.length} accounts</p>
        </div>
        <button class="btn btn-primary" onclick="showCreateDealerForm()">+ Add Dealer</button>
      </div>

      <div id="createDealerArea" style="display:none;">
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header"><h3>Create New Dealer</h3></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="form-group"><label>Company Name *</label><input class="form-control" id="ndCompany"></div>
              <div class="form-group"><label>Contact Name *</label><input class="form-control" id="ndContact"></div>
              <div class="form-group"><label>Email *</label><input type="email" class="form-control" id="ndEmail"></div>
              <div class="form-group"><label>Password *</label><input type="password" class="form-control" id="ndPassword"></div>
              <div class="form-group"><label>Phone</label><input class="form-control" id="ndPhone"></div>
              <div class="form-group"><label>City</label><input class="form-control" id="ndCity"></div>
              <div class="form-group"><label>Province</label><input class="form-control" id="ndProvince"></div>
              <div class="form-group">
                <label>Role</label>
                <select class="form-control" id="ndRole">
                  <option value="dealer">Standard Dealer</option>
                  <option value="distributor">Distributor</option>
                </select>
              </div>
              <div class="form-group">
                <label>Parent Distributor</label>
                <select class="form-control" id="ndParent">
                  <option value="">— None (Direct) —</option>
                  ${distributors.map(d => `<option value="${d.id}">${d.company_name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group"><label>Opening Balance ($)</label><input type="number" step="0.01" class="form-control" id="ndBalance" value="0"></div>
              <div class="form-group"><label>Discount %</label><input type="number" step="1" min="0" max="100" class="form-control" id="ndDiscount" value="0"></div>
            </div>
            <div style="display:flex;gap:12px;margin-top:12px;">
              <button class="btn btn-primary" onclick="createDealer()">Create Dealer</button>
              <button class="btn btn-secondary" onclick="document.getElementById('createDealerArea').style.display='none'">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Company</th><th>Contact</th><th>Role</th><th>Parent</th><th>Balance</th><th>Discount</th><th>Orders</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${dealers.filter(d => !d.is_admin).map(d => `
                <tr>
                  <td class="td-primary">${d.company_name}</td>
                  <td>${d.contact_name}<br><span style="font-size:11px;color:var(--text-muted);">${d.email}</span></td>
                  <td><span class="badge badge-${d.role === 'distributor' ? 'in_progress' : 'completed'}">${d.role || 'dealer'}</span></td>
                  <td>${d.parent_name || '—'}</td>
                  <td style="font-weight:600;">$${(d.account_balance || 0).toFixed(2)}</td>
                  <td>${d.discount_pct || 0}%</td>
                  <td>${d.order_count || 0}</td>
                  <td><span class="badge badge-${d.is_active ? 'completed' : 'cancelled'}">${d.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="editDealer('${d.id}')">Edit</button>
                    <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="adjustBalance('${d.id}','${d.company_name}')">+ Funds</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Edit Dealer Modal -->
      <div id="editDealerModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center;">
        <div class="card" style="width:600px;max-width:90vw;max-height:90vh;overflow-y:auto;margin:auto;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
            <h3 id="editModalTitle">Edit Dealer</h3>
            <button class="btn btn-secondary btn-sm" onclick="closeEditModal()" style="font-size:14px;padding:2px 10px;">✕</button>
          </div>
          <div class="card-body">
            <input type="hidden" id="edId">
            <div class="form-grid">
              <div class="form-group"><label>Company Name</label><input class="form-control" id="edCompany"></div>
              <div class="form-group"><label>Contact Name</label><input class="form-control" id="edContact"></div>
              <div class="form-group"><label>Phone</label><input class="form-control" id="edPhone"></div>
              <div class="form-group"><label>City</label><input class="form-control" id="edCity"></div>
              <div class="form-group"><label>Province</label><input class="form-control" id="edProvince"></div>
              <div class="form-group">
                <label>Role</label>
                <select class="form-control" id="edRole">
                  <option value="dealer">Standard Dealer</option>
                  <option value="distributor">Distributor</option>
                </select>
              </div>
              <div class="form-group">
                <label>Parent Distributor</label>
                <select class="form-control" id="edParent">
                  <option value="">— None (Direct) —</option>
                  ${distributors.map(d => `<option value="${d.id}">${d.company_name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group"><label>Discount %</label><input type="number" step="1" min="0" max="100" class="form-control" id="edDiscount"></div>
              <div class="form-group">
                <label>Status</label>
                <select class="form-control" id="edActive">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:12px;margin-top:16px;">
              <button class="btn btn-primary" onclick="saveDealer()">Save Changes</button>
              <button class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

// Store dealer list for edit lookups
let _adminDealerList = [];

function showCreateDealerForm() {
  document.getElementById('createDealerArea').style.display = 'block';
}

function editDealer(dealerId) {
  const d = _adminDealerList.find(x => x.id === dealerId);
  if (!d) return toast('Dealer not found', 'error');

  document.getElementById('edId').value = d.id;
  document.getElementById('edCompany').value = d.company_name || '';
  document.getElementById('edContact').value = d.contact_name || '';
  document.getElementById('edPhone').value = d.phone || '';
  document.getElementById('edCity').value = d.city || '';
  document.getElementById('edProvince').value = d.province || '';
  document.getElementById('edRole').value = d.role || 'dealer';
  document.getElementById('edParent').value = d.parent_dealer_id || '';
  document.getElementById('edDiscount').value = d.discount_pct || 0;
  document.getElementById('edActive').value = d.is_active ? '1' : '0';
  document.getElementById('editModalTitle').textContent = `Edit: ${d.company_name}`;

  document.getElementById('editDealerModal').style.display = 'block';
}

function closeEditModal() {
  document.getElementById('editDealerModal').style.display = 'none';
}

async function saveDealer() {
  const id = document.getElementById('edId').value;
  try {
    await api('PUT', `/api/dealers/${id}`, {
      company_name: document.getElementById('edCompany').value,
      contact_name: document.getElementById('edContact').value,
      phone: document.getElementById('edPhone').value,
      city: document.getElementById('edCity').value,
      province: document.getElementById('edProvince').value,
      role: document.getElementById('edRole').value,
      parent_dealer_id: document.getElementById('edParent').value || null,
      discount_pct: parseFloat(document.getElementById('edDiscount').value) || 0,
      is_active: document.getElementById('edActive').value === '1',
      account_balance: _adminDealerList.find(x => x.id === id)?.account_balance || 0
    });
    toast('Dealer updated!', 'success');
    closeEditModal();
    loadAdminDealers();
  } catch (err) { toast(err.message, 'error'); }
}

async function createDealer() {
  try {
    await api('POST', '/api/dealers', {
      company_name: document.getElementById('ndCompany').value,
      contact_name: document.getElementById('ndContact').value,
      email: document.getElementById('ndEmail').value,
      password: document.getElementById('ndPassword').value,
      phone: document.getElementById('ndPhone').value,
      city: document.getElementById('ndCity').value,
      province: document.getElementById('ndProvince').value,
      role: document.getElementById('ndRole').value,
      parent_dealer_id: document.getElementById('ndParent').value || null,
      account_balance: parseFloat(document.getElementById('ndBalance').value) || 0,
      discount_pct: parseFloat(document.getElementById('ndDiscount').value) || 0
    });
    toast('Dealer created!', 'success');
    loadAdminDealers();
  } catch (err) { toast(err.message, 'error'); }
}

async function adjustBalance(dealerId, companyName) {
  const amount = prompt(`Add funds to ${companyName}.\nEnter dollar amount (negative to deduct):`);
  if (!amount) return;
  const val = parseFloat(amount);
  if (isNaN(val)) return toast('Invalid amount', 'error');

  try {
    await api('PUT', `/api/dealers/${dealerId}/balance`, { amount: val, description: 'Admin adjustment' });
    toast(`$${val.toFixed(2)} ${val > 0 ? 'added to' : 'deducted from'} ${companyName}`, 'success');
    loadAdminDealers();
  } catch (err) { toast(err.message, 'error'); }
}

// ---- DISTRIBUTOR DEALER MANAGEMENT ----
async function loadManageDealers() {
  const main = document.getElementById('mainContent');
  try {
    const data = await api('GET', '/api/dealers');
    const dealers = data.dealers;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">My Dealers</h1>
          <p class="page-subtitle">${dealers.length} dealers under your distribution</p>
        </div>
        <button class="btn btn-primary" onclick="showDistCreateForm()">+ Add Dealer</button>
      </div>

      <div id="distCreateArea" style="display:none;">
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header"><h3>Add New Dealer</h3></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="form-group"><label>Company Name *</label><input class="form-control" id="ddCompany"></div>
              <div class="form-group"><label>Contact Name *</label><input class="form-control" id="ddContact"></div>
              <div class="form-group"><label>Email *</label><input type="email" class="form-control" id="ddEmail"></div>
              <div class="form-group"><label>Password *</label><input type="password" class="form-control" id="ddPassword"></div>
              <div class="form-group"><label>Phone</label><input class="form-control" id="ddPhone"></div>
              <div class="form-group"><label>City</label><input class="form-control" id="ddCity"></div>
              <div class="form-group"><label>Discount %</label><input type="number" step="1" min="0" max="100" class="form-control" id="ddDiscount" value="0"></div>
            </div>
            <div style="display:flex;gap:12px;margin-top:12px;">
              <button class="btn btn-primary" onclick="distCreateDealer()">Create Dealer</button>
              <button class="btn btn-secondary" onclick="document.getElementById('distCreateArea').style.display='none'">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrapper">
          ${dealers.length ? `
          <table>
            <thead>
              <tr><th>Company</th><th>Contact</th><th>Email</th><th>Balance</th><th>Discount</th><th>Orders</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${dealers.map(d => `
                <tr>
                  <td class="td-primary">${d.company_name}</td>
                  <td>${d.contact_name}</td>
                  <td>${d.email}</td>
                  <td style="font-weight:600;">$${(d.account_balance || 0).toFixed(2)}</td>
                  <td>${d.discount_pct || 0}%</td>
                  <td>${d.order_count || 0}</td>
                  <td><span class="badge badge-${d.is_active ? 'completed' : 'cancelled'}">${d.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="adjustBalance('${d.id}','${d.company_name}')">+ Funds</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>` : `
          <div class="empty-state">
            <div class="empty-icon">🏪</div>
            <h3>No dealers yet</h3>
            <p>Create your first dealer account</p>
          </div>`}
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function showDistCreateForm() {
  document.getElementById('distCreateArea').style.display = 'block';
}

async function distCreateDealer() {
  try {
    await api('POST', '/api/dealers', {
      company_name: document.getElementById('ddCompany').value,
      contact_name: document.getElementById('ddContact').value,
      email: document.getElementById('ddEmail').value,
      password: document.getElementById('ddPassword').value,
      phone: document.getElementById('ddPhone').value,
      city: document.getElementById('ddCity').value,
      discount_pct: parseFloat(document.getElementById('ddDiscount').value) || 0
    });
    toast('Dealer created!', 'success');
    loadManageDealers();
  } catch (err) { toast(err.message, 'error'); }
}

// ---- HELPERS ----
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'Z');
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTuneType(type) {
  const types = {
    stage1: 'Stage 1',
    stage2: 'Stage 2',
    stage3: 'Custom Stage 3',
    eco_tune: 'Economy Tune',
    custom: 'Custom'
  };
  return types[type] || type;
}

// ---- INIT ----
render('dashboard');
