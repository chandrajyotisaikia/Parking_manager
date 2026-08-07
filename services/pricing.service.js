// services/pricing.service.js — the ONE place pricing rules live. Edit prices here.
const PRICING = {
  CAR: { SUBSCRIBER: 0, NON_SUBSCRIBER: 80 },
  BIKE: { SUBSCRIBER: 0, NON_SUBSCRIBER: 40 },
};

// Daily subscription rates
const SUBSCRIPTION_DAILY_RATE = { CAR: 80, BIKE: 40 };

function calculateCharge(vehicleType, isSubscriber) {
  const type = vehicleType.toUpperCase();
  if (!PRICING[type]) throw new Error('Invalid vehicle type: ' + vehicleType);
  return isSubscriber ? PRICING[type].SUBSCRIBER : PRICING[type].NON_SUBSCRIBER;
}

// Calculates the amount based on daily rate and applies discount
function calculateSubscriptionAmount(vehicleType, startDate, endDate, discount = 0) {
  const type = vehicleType.toUpperCase();
  if (!SUBSCRIPTION_DAILY_RATE[type]) throw new Error('Invalid vehicle type: ' + vehicleType);
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  
  const baseAmount = SUBSCRIPTION_DAILY_RATE[type] * days;
  const finalAmount = Math.max(0, baseAmount - discount); // Ensures no negative amounts
  
  return finalAmount;
}

module.exports = { calculateCharge, calculateSubscriptionAmount, SUBSCRIPTION_DAILY_RATE };
