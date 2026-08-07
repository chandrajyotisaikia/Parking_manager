// controllers/parking.controller.js — receives requests, calls services, sends responses
const { pool } = require('../db/db');
const { calculateCharge, calculateSubscriptionAmount } = require('../services/pricing.service');
const { checkSubscriber, addSubscriber, listSubscribers, listExpiringSubscribers } = require('../services/subscriber.service');
const { addExpense, listExpenses, totalExpenses } = require('../services/expense.service');
const { getSettings, updateSettings } = require('../services/settings.service');

// POST /api/verify-and-log
async function verifyAndLog(req, res) {
  const { vehicleNumber, vehicleType, attendantName, paymentStatus } = req.body;
  if (!vehicleNumber || !vehicleType) {
    return res.status(400).json({ success: false, error: 'vehicleNumber and vehicleType are required' });
  }
  try {
    const subscriber = await checkSubscriber(vehicleNumber);
    const isSubscriber = !!subscriber;
    const amount = calculateCharge(vehicleType, isSubscriber);
    const plate = vehicleNumber.toUpperCase().replace(/\s+/g, '');

    // Default to PAID if the frontend didn't send a status
    const finalPaymentStatus = isSubscriber ? 'PAID' : (paymentStatus || 'PAID');

    const { rows } = await pool.query(
      `INSERT INTO daily_entries (vehicle_number, vehicle_type, is_subscriber, amount_charged, attendant_name, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [plate, vehicleType.toUpperCase(), isSubscriber, amount, attendantName || '', finalPaymentStatus]
    );
    const entry = rows[0];

    return res.status(201).json({
      success: true,
      entryId: entry.id,
      vehicleNumber: plate,
      vehicleType: vehicleType.toUpperCase(),
      isSubscriber,
      subscriberName: subscriber ? subscriber.owner_name : null,
      amount,
      entryTime: entry.entry_time,
      attendantName: attendantName || '',
      message: isSubscriber ? 'Subscriber — no charge' : `Entry logged. Charge: ₹${amount}`,
    });
  } catch (err) {
    console.error('[verifyAndLog]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/check-subscriber/:plate
async function quickCheckSubscriber(req, res) {
  const subscriber = await checkSubscriber(req.params.plate);
  return res.json({
    success: true,
    isSubscriber: !!subscriber,
    ownerName: subscriber ? subscriber.owner_name : null,
    vehicleType: subscriber ? subscriber.vehicle_type : null,
  });
}

// GET /api/entries
async function getEntries(req, res) {
  const { rows } = await pool.query(`SELECT * FROM daily_entries ORDER BY entry_time DESC LIMIT 20`);
  return res.json({ success: true, entries: rows });
}

// POST /api/subscribers
async function postSubscriber(req, res) {
  // Includes the discount variable from our earlier update!
  const { vehicleNumber, ownerName, phone, vehicleType, subscriptionStart, subscriptionEnd, paymentStatus, discount } = req.body;
  if (!vehicleNumber || !ownerName || !vehicleType || !subscriptionStart || !subscriptionEnd) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  try {
    const parsedDiscount = parseInt(discount) || 0;
    const amountDue = calculateSubscriptionAmount(vehicleType, subscriptionStart, subscriptionEnd, parsedDiscount);
    const sub = await addSubscriber({ vehicleNumber, ownerName, phone, vehicleType, subscriptionStart, subscriptionEnd, amountDue, paymentStatus });
    return res.status(201).json({ success: true, subscriber: sub, amountDue });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

// GET /api/subscribers
async function getSubscribers(req, res) {
  return res.json({ success: true, subscribers: await listSubscribers() });
}

// GET /api/subscribers/expiring?days=7
async function getExpiringSubscribers(req, res) {
  const days = parseInt(req.query.days) || 7;
  return res.json({ success: true, subscribers: await listExpiringSubscribers(days) });
}

// POST /api/expenses
async function postExpense(req, res) {
  const { amount, description, expenseDate, attendantName } = req.body;
  if (!amount || !description || !expenseDate) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  await addExpense({ amount, description, expenseDate, attendantName });
  return res.status(201).json({ success: true });
}

// GET /api/expenses
async function getExpenses(req, res) {
  return res.json({ success: true, expenses: await listExpenses() });
}

// GET /api/summary
async function getSummary(req, res) {
  const { rows } = await pool.query(`SELECT COALESCE(SUM(amount_charged),0) as total FROM daily_entries`);
  const income = parseFloat(rows[0].total);
  const expenses = await totalExpenses();
  return res.json({ success: true, totalIncome: income, totalExpenses: expenses, net: income - expenses });
}

// GET /api/export
async function exportReport(req, res) {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end) || start > end) {
    return res.status(400).json({ success: false, error: 'Invalid date range' });
  }
  const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 31) {
    return res.status(400).json({ success: false, error: 'Date range cannot exceed 31 days' });
  }

  const entriesRes = await pool.query(
    `SELECT * FROM daily_entries WHERE entry_time >= $1 AND entry_time < ($2::date + INTERVAL '1 day') ORDER BY entry_time`,
    [startDate, endDate]
  );
  const expensesRes = await pool.query(
    `SELECT * FROM expenses WHERE expense_date >= $1 AND expense_date <= $2 ORDER BY expense_date`,
    [startDate, endDate]
  );
  const entries = entriesRes.rows;
  const expenses = expensesRes.rows;

  const rows = [];
  rows.push(['Type', 'Date/Time', 'Vehicle/Description', 'Category', 'Attendant', 'Amount (Rs)', 'Payment Status']);
  entries.forEach(e => {
    rows.push(['Income', e.entry_time, e.vehicle_number, e.is_subscriber ? 'Subscriber' : e.vehicle_type, e.attendant_name || '', e.amount_charged, e.payment_status || 'PAID']);
  });
  expenses.forEach(e => {
    rows.push(['Expense', e.expense_date, e.description, '-', e.attendant_name || '', -e.amount, 'PAID']);
  });

  const totalIncome = entries.reduce((s, e) => s + parseFloat(e.amount_charged), 0);
  const totalExpense = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  rows.push([]);
  rows.push(['', '', '', '', 'Total Income', totalIncome]);
  rows.push(['', '', '', '', 'Total Expenses', totalExpense]);
  rows.push(['', '', '', '', 'Net', totalIncome - totalExpense]);

  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const filename = `parking_report_${startDate}_to_${endDate}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}

// GET /api/entries/active
async function getActiveEntries(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM daily_entries WHERE status = 'ACTIVE' ORDER BY entry_time DESC`
  );
  return res.json({ success: true, entries: rows });
}

// POST /api/entries/:id/exit
async function markExit(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE daily_entries SET status = 'EXITED', exit_time = NOW() WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Vehicle not found or already exited' });
    }
    return res.json({ success: true, entry: rows[0] });
  } catch (err) {
    console.error('[markExit]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/settings
async function getSettingsHandler(req, res) {
  return res.json({ success: true, settings: await getSettings() });
}

// POST /api/settings
async function postSettingsHandler(req, res) {
  const updated = await updateSettings(req.body);
  return res.json({ success: true, settings: updated });
}

// GET /api/dues/unpaid
async function getUnpaidEntries(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM daily_entries WHERE payment_status = 'UNPAID' ORDER BY entry_time DESC`
    );
    return res.json({ success: true, entries: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/dues/:plate
async function checkBalance(req, res) {
  const { plate } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT SUM(amount_charged) as total FROM daily_entries WHERE vehicle_number = $1 AND payment_status = 'UNPAID'`, 
      [plate.toUpperCase()]
    );
    return res.json({ success: true, totalDue: rows[0].total || 0 });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/entries/:id/pay
async function markPaid(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE daily_entries SET payment_status = 'PAID' WHERE id = $1 RETURNING *`, 
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Entry not found' });
    }
    return res.json({ success: true, entry: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  verifyAndLog, quickCheckSubscriber, getEntries,
  postSubscriber, getSubscribers, getExpiringSubscribers,
  postExpense, getExpenses, getSummary, exportReport,
  getActiveEntries, markExit,
  getSettingsHandler, postSettingsHandler,
  getUnpaidEntries, checkBalance, markPaid
};
               
