// gate.js — gate check-in screen, payment status toggles, Cloud OCR, 
// balance checking, receipts, vehicle exit, unpaid dues, and expense logging.

let selectedType = 'CAR';
let currentPaymentStatus = 'PAID'; // Default to paid

function selectType(type) {
  selectedType = type;
  document.getElementById('btnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('btnBike').classList.toggle('selected', type === 'BIKE');
  updateChargePreview();
}

// ---- New: Payment Status Toggle (Glowing Buttons) ----
function selectPayment(status) {
  currentPaymentStatus = status;
  const btnPaid = document.getElementById('btnPaid');
  const btnUnpaid = document.getElementById('btnUnpaid');
  
  if (status === 'PAID') {
    btnPaid.classList.add('paid-active');
    btnUnpaid.classList.remove('unpaid-active');
  } else {
    btnPaid.classList.remove('paid-active');
    btnUnpaid.classList.add('unpaid-active');
  }
}

function updateChargePreview() {
  const amt = selectedType === 'CAR' ? 80 : 40;
  const el = document.getElementById('chargePreview');
  if (el) el.textContent = `💰 Standard charge: ₹${amt} (free if subscriber)`;
}

function showTab(tab) {
  document.getElementById('gateSection').style.display = tab === 'gate' ? 'block' : 'none';
  document.getElementById('duesSection').style.display = tab === 'dues' ? 'block' : 'none';
  document.getElementById('expenseSection').style.display = tab === 'expense' ? 'block' : 'none';
  
  document.getElementById('tabGate').classList.toggle('active', tab === 'gate');
  document.getElementById('tabDues').classList.toggle('active', tab === 'dues');
  document.getElementById('tabExpense').classList.toggle('active', tab === 'expense');
  
  if (tab === 'dues') loadUnpaidVehicles();
}

// ---- Attendant name lock ----
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

// ---- New: Check Remaining Balance ----
async function checkBalance() {
  const plate = document.getElementById('plateInput').value.trim();
  const warningBox = document.getElementById('balanceWarning');
  
  if (!plate) {
    warningBox.style.display = 'none';
    return;
  }

  try {
    const res = await fetch(`/api/dues/${plate}`);
    const data = await res.json();
    
    if (data.success && data.totalDue > 0) {
      warningBox.textContent = `⚠️ PREVIOUS BALANCE DUE: ₹${data.totalDue}`;
      warningBox.style.display = 'block';
    } else {
      warningBox.style.display = 'none';
    }
  } catch (err) {
    console.warn('Could not fetch balance:', err);
  }
}

// ---- Camera: Fast Cloud OCR ----
function startScan() {
  const cameraInput = document.getElementById('cameraInput');
  cameraInput.style.display = 'block';
  cameraInput.style.position = 'absolute';
  cameraInput.style.left = '-9999px';
  cameraInput.click();
}

document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.textContent = '⚙️ Optimizing photo...';

  try {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
        statusEl.textContent = '☁️ Reading plate number...';

        const formData = new FormData();
        formData.append('base64Image', compressedBase64);
        formData.append('apikey', 'helloworld'); 
        formData.append('language', 'eng');
        formData.append('OCREngine', '2'); 

        try {
          const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            body: formData
          });

          const data = await response.json();

          if (data.IsErroredOnProcessing || !data.ParsedResults || data.ParsedResults.length === 0) {
            statusEl.textContent = "⚠️ Couldn't read the plate clearly. Please type it.";
            return;
          }

          const rawText = data.ParsedResults[0].ParsedText || '';
          const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');

          if (!cleaned) {
            statusEl.textContent = "⚠️ No letters/numbers found. Please type it.";
            return;
          }

          document.getElementById('plateInput').value = cleaned;
          statusEl.textContent = `✅ Recognized: "${cleaned}"`;
          
          // New: Automatically check balance after OCR succeeds
          checkBalance();
          
        } catch (apiErr) {
          console.error('API Error:', apiErr);
          statusEl.textContent = "⚠️ Connection error. Please type the plate.";
        }
      };
      img.src = event.target.result;
    };
  } catch (err) {
    statusEl.textContent = "⚠️ Camera failed. Please type manually.";
  } finally {
    e.target.value = ''; 
    e.target.style.display = 'none'; 
  }
});

// ---- Check-in submit ----
let lastReceiptText = '';

async function checkIn() {
  const plate = document.getElementById('plateInput').value.trim();
  const attendantName = document.getElementById('attendantName').value.trim();
  const resultBox = document.getElementById('resultBox');
  const warningBox = document.getElementById('balanceWarning');
  
  if (!plate) {
    resultBox.innerHTML = `<div class="result paid">Please enter or scan a plate number first.</div>`;
    return;
  }
  
  try {
    const res = await fetch('/api/verify-and-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // New: Sending paymentStatus to the server
      body: JSON.stringify({ vehicleNumber: plate, vehicleType: selectedType, attendantName, paymentStatus: currentPaymentStatus }),
    });
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    const cls = data.isSubscriber ? 'sub' : (currentPaymentStatus === 'UNPAID' ? 'paid' : 'sub');
    const statusText = currentPaymentStatus === 'UNPAID' ? '(UNPAID)' : '(PAID)';
    
    lastReceiptText = `TULON'S PARKING\nVehicle: ${data.vehicleNumber} (${data.vehicleType})\n${data.isSubscriber ? `Subscriber: ${data.subscriberName} - Free entry` : `Charge: Rs ${data.amount} ${statusText}`}\nAttendant: ${attendantName || 'N/A'}\nTime: ${new Date(data.entryTime).toLocaleString('en-IN')}`;

    resultBox.innerHTML = `<div class="result ${cls}">
      ${data.vehicleNumber} — ${data.isSubscriber ? `Subscriber (${data.subscriberName}) — Free entry` : `Charge: ₹${data.amount} <br><strong style="color:${currentPaymentStatus==='UNPAID'?'#ef4444':'#10b981'}">${statusText}</strong>`}
      <div style="margin-top:12px;">
        <button class="secondary" onclick="shareReceipt()">📤 Share Receipt</button>
      </div>
    </div>`;
    
    // Reset form
    document.getElementById('plateInput').value = '';
    document.getElementById('ocrStatus').textContent = '';
    warningBox.style.display = 'none';
    selectPayment('PAID'); // Reset back to Paid default
    
  } catch (err) {
    resultBox.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
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

// ---- Mark vehicle exit ----
let exitPanelOpen = false;
async function toggleExitPanel() {
  exitPanelOpen = !exitPanelOpen;
  const panel = document.getElementById('exitPanel');
  panel.style.display = exitPanelOpen ? 'block' : 'none';
  if (exitPanelOpen) await loadActiveVehicles();
}

async function loadActiveVehicles() {
  const statusEl = document.getElementById('exitStatus');
  const listEl = document.getElementById('exitList');
  statusEl.textContent = 'Loading parked vehicles...';
  listEl.innerHTML = '';
  
  try {
    const res = await fetch('/api/entries/active');
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) { statusEl.textContent = 'No vehicles currently parked.'; return; }
    
    statusEl.textContent = `${data.entries.length} vehicle(s) currently parked. Tap one to check out:`;
    listEl.innerHTML = data.entries.map(e => `
      <div class="type-btn" style="text-align:left; margin-bottom:8px; border-color:${e.payment_status === 'UNPAID' ? '#ef4444' : '#555'}" onclick="confirmExit(${e.id}, '${e.vehicle_number}')">
        ${e.vehicle_number} — ${e.vehicle_type} 
        ${e.payment_status === 'UNPAID' ? '<span style="color:#ef4444; float:right;">(UNPAID)</span>' : ''}
      </div>
    `).join('');
  } catch (err) { statusEl.textContent = 'Could not load parked vehicles — try again.'; }
}

async function confirmExit(entryId, plate) {
  if (!confirm(`Confirm exit for ${plate}?`)) return;
  const statusEl = document.getElementById('exitStatus');
  try {
    const res = await fetch(`/api/entries/${entryId}/exit`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    statusEl.textContent = `✅ ${plate} checked out.`;
    await loadActiveVehicles();
  } catch (err) { statusEl.textContent = `Error: ${err.message}`; }
}

// ---- New: Pending Dues Management ----
async function loadUnpaidVehicles() {
  const statusEl = document.getElementById('duesStatus');
  const listEl = document.getElementById('duesList');
  statusEl.textContent = 'Loading unpaid entries...';
  listEl.innerHTML = '';
  
  try {
    const res = await fetch('/api/dues/unpaid');
    const data = await res.json();
    
    if (!data.entries || data.entries.length === 0) {
      statusEl.textContent = '✅ All vehicles have paid. No pending dues.';
      return;
    }
    
    statusEl.textContent = `${data.entries.length} unpaid entry(s). Tap 'Mark Paid' to clear them:`;
    listEl.innerHTML = data.entries.map(e => `
      <div class="card" style="margin-bottom:8px; padding:12px; border-color:#ef4444;">
        <div style="font-size:18px; font-weight:bold; color:#F5C518;">${e.vehicle_number}</div>
        <div style="color:#aaa; font-size:14px; margin-bottom:10px;">Date: ${new Date(e.entry_time).toLocaleString('en-IN')} <br> Amount Due: ₹${e.amount_charged}</div>
        <button class="primary" style="background:#10b981; padding:10px; width:100%;" onclick="settleDues(${e.id}, '${e.vehicle_number}')">💰 Mark as Paid</button>
      </div>
    `).join('');
  } catch (err) {
    statusEl.textContent = 'Could not load unpaid vehicles.';
  }
}

async function settleDues(entryId, plate) {
  if (!confirm(`Mark ₹ dues as PAID for ${plate}?`)) return;
  
  try {
    const res = await fetch(`/api/entries/${entryId}/pay`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    
    alert(`Successfully marked ${plate} as PAID.`);
    loadUnpaidVehicles(); // Refresh the list
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
    resultEl.innerHTML = `<div class="result paid">Please fill in amount, description, and date.</div>`;
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
    
    resultEl.innerHTML = `<div class="result sub">Expense logged: ₹${amount} — ${description}</div>`;
    document.getElementById('expAmount').value = '';
    document.getElementById('expDesc').value = '';
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}
