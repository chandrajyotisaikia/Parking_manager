// routes/parking.routes.js — wires URLs to controller functions
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/parking.controller');

router.post('/verify-and-log', ctrl.verifyAndLog);
router.get('/check-subscriber/:plate', ctrl.quickCheckSubscriber);
router.get('/entries', ctrl.getEntries);
router.get('/entries/active', ctrl.getActiveEntries);
router.post('/entries/:id/exit', ctrl.markExit);

// Dues & Payment Routes
router.get('/dues/unpaid', ctrl.getUnpaidEntries);
router.get('/dues/:plate', ctrl.checkBalance);
router.post('/entries/:id/pay', ctrl.markPaid);

router.get('/settings', ctrl.getSettingsHandler);
router.post('/settings', ctrl.postSettingsHandler);
router.post('/subscribers', ctrl.postSubscriber);
router.get('/subscribers', ctrl.getSubscribers);
router.get('/subscribers/expiring', ctrl.getExpiringSubscribers);
router.post('/expenses', ctrl.postExpense);
router.get('/expenses', ctrl.getExpenses);
router.get('/summary', ctrl.getSummary);
router.get('/export', ctrl.exportReport);

module.exports = router;
