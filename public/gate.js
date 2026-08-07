// gate.js — gate check-in screen: Live Camera Scanner with Guide Box, Center-Crop + Compression,
// smart format enforcement (AA00AA0000), name locking, live charge preview,
// receipts, vehicle exit, expense logging, display settings.

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

// ---- Smart Plate Formatter (AA00AA0000) ----
function enforcePlateFormat(rawText) {
  let plate = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plate.length !== 10) return plate; 

  let fixedPlate = '';
  const formatMap = 'LLNNLLNNNN'; 

  for (let i = 0; i < 10; i++) {
    let char = plate[i];
    let expectedType = formatMap[i];

    if (expectedType === 'L') {
      if (char === '0') char = 'O';
      if (char === '1') char = 'I';
      if (char === '5') char = 'S';
      if (char === '8') char = 'B';
      if (char === '2') char = 'Z';
    } else if (expectedType === 'N') {
      if (char === 'O') char = '0';
      if (char === 'I') char = '1';
      if (char === 'S') char = '5';
      if (char === 'B') char = '8';
      if (char === 'Z') char = '2';
    }
    fixedPlate += char;
  }
  return fixedPlate;
}

// ---- LIVE CAMERA SCANNER (WebRTC) ----
let videoStream = null;

async function startScan() {
  try {
    // Request rear camera specifically
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    videoStream = stream;
    const video = document.getElementById('liveVideo');
    video.srcObject = stream;
    
    // Show the scanner UI
    document.getElementById('scannerUI').style.display = 'flex';
  } catch (err) {
    console.error('Camera error:', err);
    alert('Could not access camera. Please check browser permissions.');
  }
}

function cancelScan() {
  document.getElementById('scannerUI').style.display = 'none';
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
  }
}

async function captureAndScan() {
  const video = document.getElementById('liveVideo');
  const statusEl = document.getElementById('ocrStatus');
  statusEl.textContent = '✂️ Capturing plate...';

  // 1. Draw current video frame to a hidden canvas
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = video.videoWidth;
  fullCanvas.height = video.videoHeight;
  const ctx = fullCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);

  // Stop camera and hide UI
  cancelScan();
  statusEl.textContent = '☁️ Uploading cropped plate to AI...';

  // 2. Crop logic: Matches the CSS box overlay (Middle 80% W, 35% H)
  const cropW = fullCanvas.width * 0.8;
  const cropH = fullCanvas.height * 0.35;
  const startX = (fullCanvas.width - cropW) / 2;
  const startY = (fullCanvas.height - cropH) / 2;

  const cropCanvas = document.createElement('canvas');
  const MAX_WIDTH = 800; 
  const scaleSize = MAX_WIDTH / cropW;
  
  if (scaleSize < 1) {
      cropCanvas.width = MAX_WIDTH;
      cropCanvas.height = cropH * scaleSize;
  } else {
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
  }

  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(fullCanvas, startX, startY, cropW, cropH, 0, 0, cropCanvas.width, cropCanvas.height);
  
  // 3. Compress to JPEG and upload
  const compressedBase64 = cropCanvas.toDataURL('image/jpeg', 0.7);

  const formData = new FormData();
  formData.append('base64Image', compressedBase64);
  formData.append('apikey', 'helloworld'); // Replace with real OCR.space key!
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
    const smartCleaned = enforcePlateFormat(rawText);

    if (!smartCleaned) {
      statusEl.textContent = "⚠️ Cloud AI couldn't read the plate — try typing it manually.";
      return;
    }

    document.getElementById('plateInput').value = smartCleaned;
    statusEl.textContent = `✅ Recognized: "${smartCleaned}" — check it before confirming.`;
  } catch (uploadErr) {
    console.error('[scan error]', uploadErr);
    statusEl.textContent = "⚠️ Scan failed — network issue or API down.";
  }
}

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
  
