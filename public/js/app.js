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
            <div class="nav-item ${page === 'new-tune' ? 'active' : ''}" data-page="new-tune">
              <span class="nav-icon">⚡</span> New Tune Request
            </div>
            <div class="nav-item ${page === 'orders' ? 'active' : ''}" data-page="orders">
              <span class="nav-icon">📋</span> My Orders
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
          ${isAdmin ? `
          <div class="nav-section">
            <div class="nav-section-title">Admin</div>
            <div class="nav-item ${page === 'admin-dealers' ? 'active' : ''}" data-page="admin-dealers">
              <span class="nav-icon">🏢</span> Dealers
            </div>
            <div class="nav-item ${page === 'admin-orders' ? 'active' : ''}" data-page="admin-orders">
              <span class="nav-icon">📦</span> All Orders
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

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Welcome back, ${DEALER.contact_name}</p>
        </div>
        <div class="credit-display">
          <span style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:1px;">Credits</span>
          <span class="credit-amount">${data.credit_balance}</span>
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
                <tr class="clickable" onclick="navigate('orders')">
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
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>Error loading dashboard</h3><p>${err.message}</p></div>`;
  }
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

          <div style="margin-top:20px;display:flex;gap:12px;">
            ${o.stock_file_name ? `<a href="/api/tunes/${o.id}/download/stock" class="btn btn-secondary btn-sm">📥 Download Stock File (${o.stock_file_name})</a>` : ''}
            ${o.tuned_file_name ? `<a href="/api/tunes/${o.id}/download/tuned" class="btn btn-primary btn-sm">📥 Download Tuned File (${o.tuned_file_name})</a>` : ''}
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
    await api('PUT', `/api/tunes/${orderId}/status`, { status, admin_notes });
    toast('Order updated!', 'success');
    loadOrderDetail(orderId);
  } catch (err) { toast(err.message, 'error'); }
}

async function uploadTunedFile(orderId, input) {
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('tuned_file', input.files[0]);
  try {
    await api('POST', `/api/tunes/${orderId}/tuned-file`, formData, true);
    toast('Tuned file uploaded!', 'success');
    loadOrderDetail(orderId);
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
            <div class="detail-item"><div class="detail-label">Credits</div><div class="detail-value credit-amount">${d.credit_balance}</div></div>
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
