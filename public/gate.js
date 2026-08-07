// gate.js — gate check-in screen: manual entry, camera Cloud OCR,
// name locking, live charge preview, receipts, vehicle exit, expense logging, display settings.

let selectedType = 'CAR';

function selectType(type) {
  selectedType = type;
  document.getElementById('btnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('btnBike').classList.toggle('selected', type === 'BIKE');
  updateChargePreview();
}

function updateChargePreview() {
  const amt = selectedType === 'CAR' ? 80 : 40;
  const el = document.getElementById('chargePreview');
  if (el) el.textContent = `💰 Standard charge: ₹${amt} (free if subscriber — confirmed after Check In)`;
}

function showTab(tab) {
  document.getElementById('gateSection').style.display = tab === 'gate' ? 'block' : 'none';
  document.getElementById('expenseSection').style.display = tab === 'expense' ? 'block' : 'none';
  document.getElementById('tabGate').classList.toggle('active', tab === 'gate');
  document.getElementById('tabExpense').classList.toggle('active', tab === 'expense');
}

// ---- Attendant name lock ----
function applyNameLockUI() {
  const locked = localStorage.getItem('attendantNameLocked') === 'true';
  const nameInput = document.getElementById('attendantName');
  const confirmBtn = document.getElementById('confirmNameBtn');
  const lockedRow = document.getElementById('nameLockedRow');
  nameInput.disabled = locked;
  confirmBtn.style.display = locked ? 'none' : 'block';
  lockedRow.style.display = locked ? 'block' : 'none';
  if (locked) document.getElementById('lockedNameDisplay').textContent = nameInput.value;
}

function confirmName() {
  const name = document.getElementById('attendantName').value.trim();
  if (!name) { alert('Please enter a name first.'); return; }
  localStorage.setItem('attendantName', name);
  localStorage.setItem('attendantNameLocked', 'true');
  applyNameLockUI();
}

// Display settings
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

// ---- Camera: Lightning Fast Cloud OCR (OCR.space) ----
function startScan() {
  document.getElementById('cameraInput').click();
}

document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.textContent = '🔄 Compressing image...';

  try {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      
      img.onload = async () => {
        // 1. Resize and compress using Canvas
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024; // Shrink the image to max 1024px wide
        const scaleSize = MAX_WIDTH / img.width;
        
        // Only resize if the image is actually larger than MAX_WIDTH
        if (scaleSize < 1) {
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
        } else {
            canvas.width = img.width;
            canvas.height = img.height;
        }

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Convert to compressed JPEG (0.7 quality) - drastic size reduction
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        
        statusEl.textContent = '☁️ Uploading to Cloud AI...';

        const formData = new FormData();
        formData.append('base64Image', compressedBase64);
        
        // IMPORTANT: Replace 'helloworld' with your own free API key from ocr.space
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
            statusEl.textContent = "⚠️ Cloud AI couldn't read the plate — try typing it manually.";
            return;
          }

          const rawText = data.ParsedResults[0].ParsedText || '';
          const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');

          if (!cleaned) {
            statusEl.textContent = "⚠️ Cloud AI couldn't read the plate — try typing it manually.";
            return;
          }

          document.getElementById('plateInput').value = cleaned;
          statusEl.textContent = `✅ Recognized: "${cleaned}" — check it before confirming.`;
        } catch (uploadErr) {
          console.error('[scan error]', uploadErr);
          statusEl.textContent = "⚠️ Scan failed — network issue or API down.";
        }
      };
    };
    
    reader.onerror = () => {
      statusEl.textContent = "⚠️ Error reading image file.";
    };
  } catch (err) {
    console.error('[compression error]', err);
    statusEl.textContent = "⚠️ Processing failed — try typing the plate manually.";
  } finally {
    e.target.value = '';
  }
});

// ---- Check-in submit ----
let lastReceiptText = '';

async function checkIn() {
  const plate = document.getElementById('plateInput').value.trim();
  const attendantName = document.getElementById('attendantName').value.trim();
  const resultBox = document.getElementById('resultBox');
  if (!plate) {
    resultBox.innerHTML = `<div class="result paid">Please enter or scan a plate number first.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/verify-and-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleNumber: plate, vehicleType: selectedType, attendantName }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    const cls = data.isSubscriber ? 'sub' : 'paid';
    lastReceiptText = `TULON'S PARKING\nVehicle: ${data.vehicleNumber} (${data.vehicleType})\n${data.isSubscriber ? `Subscriber: ${data.subscriberName} - Free entry` : `Charge: Rs ${data.amount}`}\nAttendant: ${attendantName || 'N/A'}\nTime: ${new Date(data.entryTime).toLocaleString('en-IN')}`;

    resultBox.innerHTML = `<div class="result ${cls}">
      ${data.vehicleNumber} — ${data.isSubscriber ? `Subscriber (${data.subscriberName}) — Free entry` : `Charge: ₹${data.amount}`}
      <div style="margin-top:12px;">
        <button class="secondary" onclick="shareReceipt()">📤 Share Receipt</button>
      </div>
    </div>`;
    document.getElementById('plateInput').value = '';
    document.getElementById('ocrStatus').textContent = '';
  } catch (err) {
    resultBox.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

async function shareReceipt() {
  if (!lastReceiptText) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Tulon's Parking Receipt", text: lastReceiptText });
      return;
    } catch (err) {
      return; // user cancelled the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(lastReceiptText);
    alert('Receipt copied — you can paste it into a message.');
  } catch (err) {
    alert(lastReceiptText);
  }
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
    if (!data.entries || data.entries.length === 0) {
      statusEl.textContent = 'No vehicles currently parked.';
      return;
    }
    statusEl.textContent = `${data.entries.length} vehicle(s) currently parked. Tap one to check out:`;
    listEl.innerHTML = data.entries.map(e => `
      <div class="type-btn" style="text-align:left; margin-bottom:8px;" onclick="confirmExit(${e.id}, '${e.vehicle_number}')">
        ${e.vehicle_number} — ${e.vehicle_type} — entered ${new Date(e.entry_time).toLocaleTimeString('en-IN')}
      </div>
    `).join('');
  } catch (err) {
    statusEl.textContent = 'Could not load parked vehicles — try again.';
  }
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
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
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
    
