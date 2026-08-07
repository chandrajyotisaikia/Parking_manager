// gate.js — handles the gate check-in screen: manual entry, camera OCR scan, receipts, and expense logging

let selectedType = 'CAR';

function selectType(type) {
  selectedType = type;
  document.getElementById('btnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('btnBike').classList.toggle('selected', type === 'BIKE');
}

function showTab(tab) {
  document.getElementById('gateSection').style.display = tab === 'gate' ? 'block' : 'none';
  document.getElementById('expenseSection').style.display = tab === 'expense' ? 'block' : 'none';
  document.getElementById('tabGate').classList.toggle('active', tab === 'gate');
  document.getElementById('tabExpense').classList.toggle('active', tab === 'expense');
}

// ---- Camera OCR scanning ----
function startScan() {
  document.getElementById('cameraInput').click();
}

document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.textContent = '📷 Photo captured. Loading OCR engine...';

  try {
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // Upgrade: auto-brightness — compute the image's average brightness first,
    // then set the black/white threshold relative to it instead of a fixed number.
    // This keeps OCR working in both bright sun and shadow instead of only one lighting condition.
    let totalLuminance = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    }
    const avgLuminance = totalLuminance / (data.length / 4);
    const threshold = avgLuminance * 0.85; // slightly below average separates text from background

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      const contrasted = gray > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = contrasted;
    }
    ctx.putImageData(imgData, 0, 0);

    statusEl.textContent = '🔍 Reading plate text (first scan can take ~30s to load model)...';

    const result = await Tesseract.recognize(canvas, 'eng', {
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
    console.error('[OCR error]', err);
    statusEl.textContent = "⚠️ Scan failed — try again or type the plate manually below.";
  } finally {
    e.target.value = '';
  }
});

// ---- Check-in submit ----
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
    const receiptText = `TULON'S PARKING\nVehicle: ${data.vehicleNumber} (${data.vehicleType})\n${data.isSubscriber ? `Subscriber: ${data.subscriberName} — Free entry` : `Charge: ₹${data.amount}`}\nAttendant: ${attendantName || 'N/A'}\nTime: ${new Date(data.entryTime).toLocaleString('en-IN')}`;

    resultBox.innerHTML = `<div class="result ${cls}">
      ${data.vehicleNumber} — ${data.isSubscriber ? `Subscriber (${data.subscriberName}) — Free entry` : `Charge: ₹${data.amount}`}
      <div style="margin-top:12px;">
        <button class="secondary" onclick='shareReceipt(${JSON.stringify(receiptText)})'>📤 Share Receipt</button>
      </div>
    </div>`;
    document.getElementById('plateInput').value = '';
    document.getElementById('ocrStatus').textContent = '';
  } catch (err) {
    resultBox.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

// Upgrade: shareable receipt — uses the phone's native share sheet if available (WhatsApp, SMS, etc.),
// falls back to copying the text so it can be pasted anywhere. No paid SMS service needed.
async function shareReceipt(text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "Tulon's Parking Receipt", text });
      return;
    } catch (err) {
      // user cancelled the share sheet — no error needed
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Receipt copied — you can paste it into a message.');
  } catch (err) {
    alert(text); // last-resort fallback so the info is never lost
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
