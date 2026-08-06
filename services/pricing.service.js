// services/pricing.service.js — the ONE place pricing rules live. Edit prices here.
const PRICING = {
  CAR: { SUBSCRIBER: 0, NON_SUBSCRIBER: 80 },
  BIKE: { SUBSCRIBER: 0, NON_SUBSCRIBER: 40 },
};

function calculateCharge(vehicleType, isSubscriber) {
  const type = vehicleType.toUpperCase();
  if (!PRICING[type]) throw new Error('Invalid vehicle type: ' + vehicleType);
  return isSubscriber ? PRICING[type].SUBSCRIBER : PRICING[type].NON_SUBSCRIBER;
}

module.exports = { calculateCharge };
