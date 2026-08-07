// admin.js — handles login gate, dashboard data loading, subscriber/expense forms, and reports

const ADMIN_PASSWORD = 'LoginPwd'; // NOTE: this is a basic access gate, not real security

function tryLogin() {
  const entered = document.getElementById('loginPassword').value;
  if (entered === ADMIN_PASSWORD) {
    sessionStorage.setItem('adminLoggedIn', 'true');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadAll();
  } else {
    document.getElementById('loginError').textContent = 'Incorrect password.';
  }
}

if (sessionStorage.getItem('adminLoggedIn') === 'true') {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadAll();
}

function showAdminTab(tab) {
  const panels = { entries: 'entriesPanel', subs: 'subsPanel', addsub: 'addsubPanel', expenses: 'expensesPanel', export: 'exportPanel', display: 'displayPanel' };
  const tabs = { entries: 'tabEntries', subs: 'tabSubs', addsub: 'tabAddSub', expenses: 'tabExpenses', export: 'tabExport', display: 'tabDisplay' };
  Object.keys(panels).forEach(key => {
    document.getElementById(panels[key]).style.display = key === tab ? 'block' : 'none';
    document.getElementById(tabs[key]).classList.toggle('active', key === tab);
  });
}

async function loadAll() {
  await loadSummary();
  await loadEntries();
  await loadSubscribers();
  await loadExpenses();
  await loadRenewalReminders();
}

async function loadSummary() {
  const res = await fetch('/api/summary');
  const data = await res.json();
  document.getElementById('sumIncome').textContent = `₹${data.totalIncome}`;
  document.getElementById('sumExpense').textContent = `₹${data.totalExpenses}`;
  document.getElementById('sumNet').textContent = `₹${data.net}`;
}

async function loadEntries() {
  const res = await fetch('/api/entries');
  const data = await res.json();
  document.getElementById('entriesBody').innerHTML = data.entries.map(e => `
    <tr><td>${e.vehicle_number}</td><td>${e.vehicle_type}</td><td>₹${e.amount_charged}</td><td>${e.attendant_name || '-'}</td><td>${new Date(e.entry_time).toLocaleString('en-IN')}</td></tr>
  `).join('');
}

async function loadSubscribers() {
  const res = await fetch('/api/subscribers');
  const data = await res.json();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('subsBody').innerHTML = data.subscribers.map(s => {
    const expDate = new Date(s.subscription_end).toISOString().split('T')[0];
    const expired = expDate < today;
    return `<tr class="${expired ? 'expired' : ''}"><td>${s.vehicle_number}</td><td>${s.owner_name}</td><td>${s.phone || ''}</td><td>${expDate}</td></tr>`;
  }).join('');
}

async function loadExpenses() {
  const res = await fetch('/api/expenses');
  const data = await res.json();
  document.getElementById('expensesBody').innerHTML = data.expenses.map(e => `
    <tr><td>${new Date(e.expense_date).toISOString().split('T')[0]}</td><td>${e.description}</td><td>${e.attendant_name || '-'}</td><td>₹${e.amount}</td></tr>
  `).join('');
}

// Upgrade: renewal reminders — subscribers expiring within 7 days
async function loadRenewalReminders() {
  const res = await fetch('/api/subscribers/expiring?days=7');
  const data = await res.json();
  const banner = document.getElementById('renewalBanner');
  if (!data.subscribers || data.subscribers.length === 0) {
    banner.innerHTML = '';
    return;
  }
  const names = data.subscribers.map(s => `${s.vehicle_number} (${s.owner_name})`).join(', ');
  banner.innerHTML = `<div class="card" style="border-color:#F5C518; background:#2a2410;">
    ⚠️ <strong>${data.subscribers.length} subscription(s) expiring within 7 days:</strong> ${names}
  </div>`;
}

async function addSubscriber() {
  const vehicleNumber = document.getElementById('newPlate').value.trim();
  const ownerName = document.getElementById('newOwner').value.trim();
  const phone = document.getElementById('newPhone').value.trim();
  const vehicleType = document.getElementById('newType').value;
  const subscriptionEnd = document.getElementById('newEnd').value;
  const resultEl = document.getElementById('addSubResult');

  if (!vehicleNumber || !ownerName || !subscriptionEnd) {
    resultEl.innerHTML = `<div class="result paid">Please fill in plate, owner name, and expiry date.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleNumber, ownerName, phone, vehicleType, subscriptionEnd }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    resultEl.innerHTML = `<div class="result sub">Subscriber added.</div>`;
    ['newPlate','newOwner','newPhone','newEnd'].forEach(id => document.getElementById(id).value = '');
    loadSubscribers();
    loadRenewalReminders();
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

function downloadReport() {
  const start = document.getElementById('exportStart').value;
  const end = document.getElementById('exportEnd').value;
  const resultEl = document.getElementById('exportResult');

  if (!start || !end) {
    resultEl.innerHTML = `<div class="result paid">Please pick both a start and end date.</div>`;
    return;
  }
  const diffDays = Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 31 || diffDays < 1) {
    resultEl.innerHTML = `<div class="result paid">Please choose a range of 31 days or less.</div>`;
    return;
  }
  resultEl.innerHTML = '';
  window.location.href = `/api/export?startDate=${start}&endDate=${end}`;
}

// ---- Display settings (button size + minimal mode on the gate app) ----
async function loadDisplaySettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  document.getElementById('settingButtonSize').value = data.settings.button_size || 'normal';
  document.getElementById('settingMinimal').checked = data.settings.minimal_mode === 'true';
}

async function saveDisplaySettings() {
  const button_size = document.getElementById('settingButtonSize').value;
  const minimal_mode = document.getElementById('settingMinimal').checked ? 'true' : 'false';
  const resultEl = document.getElementById('settingsResult');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ button_size, minimal_mode }),
    });
    const data = await res.json();
    if (!data.success) throw new Error('Failed to save');
    resultEl.innerHTML = `<div class="result sub">Saved.</div>`;
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}
