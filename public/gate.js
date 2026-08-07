// gate.js — gate check-in screen, instant payment status toggles, Cloud OCR, 
// zero-lag balance checking, receipts, pay-and-exit, unpaid dues, and expense logging.

let selectedType = 'CAR';
let currentPaymentStatus = 'PAID';
let unpaidPlatesCache = {}; // Instant memory for fast balance checks

// ---- New: Secretly load unpaid list in background for zero-lag checking ----
async function syncUnpaidCache() {
  try {
    const res = await fetch('/api/dues/unpaid');
    const data = await res.json();
    unpaidPlatesCache = {}; // Clear old data
    if (data.entries) {
      data.entries.forEach(e => {
        if (!unpaidPlatesCache[e.vehicle_number]) unpaidPlatesCache[e.vehicle_number] = 0;
        unpaidPlatesCache[e.vehicle_number] += parseFloat(e.amount_charged);
      });
    }
  } catch (err) {
    console.warn("Could not sync unpaid cache in background.");
  }
}
// Run this immediately when the app opens
syncUnpaidCache();

function selectType(type) {
  selectedType = type;
  document.getElementById('btnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('btnBike').classList.toggle('selected', type === 'BIKE');
  updateChargePreview();
}

function selectPayment(status) {
  currentPaymentStatus = status;
  const btnPaid = document.getElementById('btnPaid');
  const btnUnpaid = document.getElementById('btnUnpaid');
  
  if (btnPaid && btnUnpaid) {
    if (status === 'PAID') {
      btnPaid.classList.add('paid-active');
      btnUnpaid.classList.remove('unpaid-active');
    } else {
      btnPaid.classList.remove('paid-active');
      btnUnpaid.classList.add('unpaid-active');
    }
  }
}

function updateChargePreview() {
  const amt = selectedType === 'CAR' ? 80 : 40;
  const el = document.getElementById('chargePreview');
  if (el) el.textContent = `💰 Standard charge: ₹${amt} (free if subscriber)`;
}

function showTab(tab) {
  const gateSec = document.getElementById('gateSection');
  const duesSec = document.getElementById('duesSection');
  const expSec = document.getElementById('expenseSection');
  
  if (gateSec) gateSec.style.display = tab === 'gate' ? 'block' : 'none';
  if (duesSec) duesSec.style.display = tab === 'dues' ? 'block' : 'none';
  if (expSec) expSec.style.display = tab === 'expense' ? 'block' : 'none';
  
  const tabGate = document.getElementById('tabGate');
  const tabDues = document.getElementById('tabDues');
  const tabExp = document.getElementById('tabExpense');
  
  if (tabGate) tabGate.classList.toggle('active', tab === 'gate');
  if (tabDues) tabDues.classList.toggle('active', tab === 'dues');
  if (tabExp) tabExp.classList.toggle('active', tab === 'expense');
  
  if (tab === 'dues' && typeof loadUnpaidVehicles === 'function') {
    loadUnpaidVehicles();
  }
}

function applyNameLockUI() {
  const locked = localStorage.getItem('attendantNameLocked') === 'true';
  const nameInput = document.getElementById('attendantName');
  const confirmBtn = document.getElementById('confirmNameBtn');
  const lockedRow = document.getElementById('nameLockedRow');
  
  if (nameInput && confirmBtn && lockedRow) {
    nameInput.disabled = locked;
    confirmBtn.style.display = locked ? 'none' : 'block';
    lockedRow.style.display = locked ? 'block' : 'none';
    if (locked) document.getElementById('lockedNameDisplay').textContent = nameInput.value;
  }
}

function confirmName() {
  const name = document.getElementById('attendantName').value.trim();
  if (!name) { alert('Please enter a name first.'); return; }
  localStorage.setItem('attendantName', name);
  localStorage.setItem('attendantNameLocked', 'true');
  applyNameLockUI();
}

async function applyDisplaySettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    const s = data.settings || {};
    const padMap = { normal: '18px 16px', large: '22px 18px', xl: '28px 22px' };
    const fontMap = { normal: '18px', large: '20px', xl: '24px' };
    document.documentElement.style.setProperty('--btn-pad', padMap[s.button_size] || padMap.normal);
    document.documentElement.style.setProperty('--btn-font', fontMap[s.button_size] || fontMap.normal);
    document.body.classList.toggle('minimal', s.minimal_mode === 'true');
  } catch (err) {
    console.warn('[settings] using defaults:', err.message);
  }
}

// ---- Instant Zero-Lag Balance Check ----
function checkBalance() {
  const plate = document.getElementById('plateInput').value.trim().toUpperCase();
  const warningBox = document.getElementById('balanceWarning');
  
  if (!plate || !warningBox) return;

  // Instantly checks the local memory instead of asking the server
  if (unpaidPlatesCache[plate] && unpaidPlatesCache[plate] > 0) {
    warningBox.textContent = `⚠️ PREVIOUS BALANCE DUE: ₹${unpaidPlatesCache[plate]}`;
    warningBox.style.display = 'block';
  } else {
    warningBox.style.display = 'none';
  }
}

// ---- Camera: Fast Cloud OCR ----
function startScan() {
  const cameraInput = document.getElementById('cameraInput');
  if (cameraInput) {
    cameraInput.style.display = 'block';
    cameraInput.style.position = 'absolute';
    cameraInput.style.left = '-9999px';
    cameraInput.click();
  }
}

document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('ocrStatus');
  if (statusEl) statusEl.textContent = '⚙️ Optimizing photo...';

  try {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        let width = img.width, height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_WIDTH) { width *= MAX_WIDTH / height; height = MAX_WIDTH; }
        }

        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
        if (statusEl) statusEl.textContent = '☁️ Reading plate number...';

        const formData = new FormData();
        formData.append('base64Image', compressedBase64);
        formData.append('apikey', 'helloworld'); 
        formData.append('language', 'eng');
        formData.append('OCREngine', '2'); 

        try {
          const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
          const data = await response.json();

          if (data.IsErroredOnProcessing || !data.ParsedResults || data.ParsedResults.length === 0) {
            if (statusEl) statusEl.textContent = "⚠️ Couldn't read the plate clearly. Please type it.";
            return;
          }

          const rawText = data.ParsedResults[0].ParsedText || '';
          const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');

          if (!cleaned) {
            if (statusEl) statusEl.textContent = "⚠️ No letters/numbers found. Please type it.";
            return;
          }

          document.getElementById('plateInput').value = cleaned;
          if (statusEl) statusEl.textContent = `✅ Recognized: "${cleaned}"`;
          
          checkBalance(); // Instantly trigger the local check!
          
        } catch (apiErr) {
          if (statusEl) statusEl.textContent = "⚠️ Connection error. Please type the plate.";
        }
      };
      img.src = event.target.result;
    };
  } catch (err) {
    if (statusEl) statusEl.textContent = "⚠️ Camera failed. Please type manually.";
  } finally {
    e.target.value = ''; e.target.style.display = 'none'; 
  }
});

let lastReceiptText = '';

async function checkIn() {
  const plate = document.getElementById('plateInput').value.trim();
  const attendantName = document.getElementById('attendantName').value.trim();
  const resultBox = document.getElementById('resultBox');
  const warningBox = document.getElementById('balanceWarning');
  
  if (!plate) {
    if (resultBox) resultBox.innerHTML = `<div class="result paid">Please enter or scan a plate number first.</div>`;
    return;
  }
  
  try {
    const res = await fetch('/api/verify-and-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleNumber: plate, vehicleType: selectedType, attendantName, paymentStatus: currentPaymentStatus }),
    });
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    const cls = data.isSubscriber ? 'sub' : (currentPaymentStatus === 'UNPAID' ? 'paid' : 'sub');
    const statusText = currentPaymentStatus === 'UNPAID' ? '(UNPAID)' : '(PAID)';
    
    lastReceiptText = `TULON'S PARKING\nVehicle: ${data.vehicleNumber} (${data.vehicleType})\n${data.isSubscriber ? `Subscriber: ${data.subscriberName} - Free entry` : `Charge: Rs ${data.amount} ${statusText}`}\nAttendant: ${attendantName || 'N/A'}\nTime: ${new Date(data.entryTime).toLocaleString('en-IN')}`;

    if (resultBox) {
      resultBox.innerHTML = `<div class="result ${cls}">
        ${data.vehicleNumber} — ${data.isSubscriber ? `Subscriber (${data.subscriberName}) — Free entry` : `Charge: ₹${data.amount} <br><strong style="color:${currentPaymentStatus==='UNPAID'?'#ef4444':'#10b981'}">${statusText}</strong>`}
        <div style="margin-top:12px;">
          <button class="secondary" onclick="shareReceipt()">📤 Share Receipt</button>
        </div>
      </div>`;
    }
    
    document.getElementById('plateInput').value = '';
    const statusEl = document.getElementById('ocrStatus');
    if (statusEl) statusEl.textContent = '';
    if (warningBox) warningBox.style.display = 'none';
    
    selectPayment('PAID'); 
    syncUnpaidCache(); // Refresh the secret list in case they checked in unpaid
    
  } catch (err) {
    if (resultBox) resultBox.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

async function shareReceipt() {
  if (!lastReceiptText) return;
  if (navigator.share) {
    try { await navigator.share({ title: "Tulon's Parking Receipt", text: lastReceiptText }); return; } 
    catch (err) { return; }
  }
  try { await navigator.clipboard.writeText(lastReceiptText); alert('Receipt copied.'); } 
  catch (err) { alert(lastReceiptText); }
}

// ---- UPGRADED: Mark vehicle exit (With Pay & Exit Buttons) ----
let exitPanelOpen = false;
async function toggleExitPanel() {
  exitPanelOpen = !exitPanelOpen;
  const panel = document.getElementById('exitPanel');
  if (panel) panel.style.display = exitPanelOpen ? 'block' : 'none';
  if (exitPanelOpen) await loadActiveVehicles();
}

async function loadActiveVehicles() {
  const statusEl = document.getElementById('exitStatus');
  const listEl = document.getElementById('exitList');
  if (statusEl) statusEl.textContent = 'Loading parked vehicles...';
  if (listEl) listEl.innerHTML = '';
  
  try {
    const res = await fetch('/api/entries/active');
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) { 
      if (statusEl) statusEl.textContent = 'No vehicles currently parked.'; 
      return; 
    }
    
    if (statusEl) statusEl.textContent = `${data.entries.length} vehicle(s) currently parked. Tap to check out:`;
    if (listEl) {
      listEl.innerHTML = data.entries.map(e => `
        <div class="card" style="margin-bottom:12px; border: 2px solid ${e.payment_status === 'UNPAID' ? '#ef4444' : '#333'}; padding: 12px; background: #1a1a1a;">
          <div style="font-weight:bold; font-size:18px; margin-bottom: 12px; color: #F5C518;">
            ${e.vehicle_number} — ${e.vehicle_type}
            ${e.payment_status === 'UNPAID' ? `<span style="color:#ef4444; float:right;">(OWES ₹${e.amount_charged})</span>` : '<span style="color:#10b981; float:right;">(PAID)</span>'}
          </div>
          <div style="display:flex; gap:10px;">
            ${e.payment_status === 'UNPAID' 
              ? `<button class="primary" style="background:#10b981; flex:1; padding:12px; font-size:16px; font-weight:bold; color:#000;" onclick="payAndExit(${e.id}, '${e.vehicle_number}')">💰 Pay & Exit</button>` 
              : `<button class="secondary" style="flex:1; padding:12px; font-size:16px;" onclick="confirmExit(${e.id}, '${e.vehicle_number}')">🚪 Normal Exit</button>`
            }
          </div>
        </div>
      `).join('');
    }
  } catch (err) { 
    if (statusEl) statusEl.textContent = 'Could not load parked vehicles — try again.'; 
  }
}

// New: All-in-one button to take the money and clear the car from the lot!
async function payAndExit(entryId, plate) {
  if (!confirm(`Collect cash and mark ${plate} as PAID & EXITED?`)) return;
  const statusEl = document.getElementById('exitStatus');
  try {
    // 1. Mark as Paid
    await fetch(`/api/entries/${entryId}/pay`, { method: 'POST' });
    // 2. Mark as Exited
    const res = await fetch(`/api/entries/${entryId}/exit`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    
    if (statusEl) statusEl.textContent = `✅ ${plate} paid and checked out.`;
    await loadActiveVehicles(); // Refresh the list
    syncUnpaidCache(); // Update the secret balance checker
  } catch (err) { 
    if (statusEl) statusEl.textContent = `Error: ${err.message}`; 
  }
}

// Standard exit for cars that already paid
async function confirmExit(entryId, plate) {
  if (!confirm(`Confirm exit for ${plate}?`)) return;
  const statusEl = document.getElementById('exitStatus');
  try {
    const res = await fetch(`/api/entries/${entryId}/exit`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    
    if (statusEl) statusEl.textContent = `✅ ${plate} checked out.`;
    await loadActiveVehicles();
  } catch (err) { 
    if (statusEl) statusEl.textContent = `Error: ${err.message}`; 
  }
}

// ---- Pending Dues Tab Logic ----
async function loadUnpaidVehicles() {
  const statusEl = document.getElementById('duesStatus');
  const listEl = document.getElementById('duesList');
  if (statusEl) statusEl.textContent = 'Loading unpaid entries...';
  if (listEl) listEl.innerHTML = '';
  
  try {
    const res = await fetch('/api/dues/unpaid');
    const data = await res.json();
    
    if (!data.entries || data.entries.length === 0) {
      if (statusEl) statusEl.textContent = '✅ All vehicles have paid. No pending dues.';
      return;
    }
    
    if (statusEl) statusEl.textContent = `${data.entries.length} unpaid entry(s). Tap 'Mark Paid' to clear them:`;
    if (listEl) {
      listEl.innerHTML = data.entries.map(e => `
        <div class="card" style="margin-bottom:8px; padding:12px; border-color:#ef4444;">
          <div style="font-size:18px; font-weight:bold; color:#F5C518;">${e.vehicle_number}</div>
          <div style="color:#aaa; font-size:14px; margin-bottom:10px;">Date: ${new Date(e.entry_time).toLocaleString('en-IN')} <br> Amount Due: ₹${e.amount_charged}</div>
          <button class="primary" style="background:#10b981; padding:10px; width:100%; color:#000; font-weight:bold;" onclick="settleDues(${e.id}, '${e.vehicle_number}')">💰 Mark as Paid</button>
        </div>
      `).join('');
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Could not load unpaid vehicles.';
  }
}

async function settleDues(entryId, plate) {
  if (!confirm(`Mark dues as PAID for ${plate}?`)) return;
  
  try {
    const res = await fetch(`/api/entries/${entryId}/pay`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    
    alert(`Successfully marked ${plate} as PAID.`);
    loadUnpaidVehicles(); 
    syncUnpaidCache(); // Keep our zero-lag memory accurate
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ---- Expense logging ----
async function submitExpense() {
  const amount = document.getElementById('expAmount').value;
  const description = document.getElementById('expDesc').value.trim();
  const expenseDate = document.getElementById('expDate').value;
  const attendantName = document.getElementById('attendantName').value.trim();
  const resultEl = document.getElementById('expenseResult');

  if (!amount || !description || !expenseDate) {
    if (resultEl) resultEl.innerHTML = `<div class="result paid">Please fill in amount, description, and date.</div>`;
    return;
  }
  
  try {
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(amount), description, expenseDate, attendantName }),
    });
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    
    if (resultEl) resultEl.innerHTML = `<div class="result sub">Expense logged: ₹${amount} — ${description}</div>`;
    document.getElementById('expAmount').value = '';
    document.getElementById('expDesc').value = '';
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
    }
      
