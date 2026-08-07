// gate.js — gate check-in screen: manual entry, camera OCR + AI vehicle-type detection,
// name locking, live charge preview, receipts, vehicle exit, expense logging, display settings.

let selectedType = 'CAR';

function selectType(type) {
  selectedType = type;
  document.getElementById('btnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('btnBike').classList.toggle('selected', type === 'BIKE');
  updateChargePreview();
}

// Upgrade: tells the attendant what to charge before they even tap Check In
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
// Once confirmed, the field locks. Editing after that requires the admin password,
// so a name can't be casually changed mid-shift by mistake.
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

function unlockName() {
  const pwd = prompt('Enter admin password to edit the attendant name:');
  if (pwd === null) return;
  if (pwd === 'LoginPwd') {
    localStorage.setItem('attendantNameLocked', 'false');
    applyNameLockUI();
  } else {
    alert('Incorrect password.');
  }
}

// ---- Display settings (set from the admin dashboard) ----
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

// ---- Camera: OCR plate reading + free on-device AI vehicle-type detection ----
// coco-ssd is a free, client-side object detection model (no API key, no account) —
// it can recognize "car" vs "motorcycle" in the photo, so the type can be auto-filled.
let cocoModel = null;
async function getCocoModel() {
  if (!cocoModel) cocoModel = await cocoSsd.load();
  return cocoModel;
}

function startScan() {
  document.getElementById('cameraInput').click();
}

document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.textContent = '📷 Photo captured. Analyzing...';

  try {
    const imageBitmap = await createImageBitmap(file);

    // Original color canvas — used for AI vehicle-type detection
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = imageBitmap.width;
    colorCanvas.height = imageBitmap.height;
    colorCanvas.getContext('2d').drawImage(imageBitmap, 0, 0);

    // Best-effort vehicle type detection — never blocks the OCR flow if it fails
    try {
      statusEl.textContent = '🚙 Detecting vehicle type...';
      const model = await getCocoModel();
      const predictions = await model.detect(colorCanvas);
      const vehiclePred = predictions
        .filter(p => ['car', 'motorcycle', 'truck', 'bus'].includes(p.class))
        .sort((a, b) => b.score - a.score)[0];
      if (vehiclePred) {
        const detectedType = vehiclePred.class === 'motorcycle' ? 'BIKE' : 'CAR';
        selectType(detectedType);
        statusEl.textContent = `🚙 Detected: ${detectedType === 'BIKE' ? 'Bike' : 'Car'} (${Math.round(vehiclePred.score * 100)}% confidence). `;
      }
    } catch (visionErr) {
      console.warn('[vehicle detection]', visionErr);
    }

    // Preprocess for OCR: grayscale + auto-brightness threshold
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = imageBitmap.width;
    ocrCanvas.height = imageBitmap.height;
    const ctx = ocrCanvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    const data = imgData.data;

    let totalLuminance = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    }
    const avgLuminance = totalLuminance / (data.length / 4);
    const threshold = avgLuminance * 0.85;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      const contrasted = gray > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = contrasted;
    }
    ctx.putImageData(imgData, 0, 0);

    statusEl.textContent += ' 🔍 Reading plate text (first scan can take ~30s to load)...';

    const result = await Tesseract.recognize(ocrCanvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          statusEl.textContent = `🔍 Reading plate... ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    const rawText = result.data.text || '';
    const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleaned) {
      statusEl.textContent = "⚠️ Couldn't read the plate — try again or type it manually below.";
      return;
    }

    document.getElementById('plateInput').value = cleaned;
    statusEl.textContent = `✅ Recognized: "${cleaned}" — please check it's correct before confirming.`;
  } catch (err) {
    console.error('[scan error]', err);
    statusEl.textContent = "⚠️ Scan failed — try again or type the plate manually below.";
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

// Fix: previously this built the share text inline inside the onclick HTML attribute,
// and the apostrophe in "TULON'S" broke the attribute so the button silently did nothing.
// Now the text is stored in a variable and the button just calls this with no arguments.
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
