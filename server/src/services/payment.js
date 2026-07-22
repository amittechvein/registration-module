const crypto = require('crypto');
const { getConfig } = require('./settings');

/** Razorpay gateway resolved from admin settings (DB) with .env fallback. */
async function getGateway() {
  const cfg = await getConfig();
  const keyId = cfg.RAZORPAY_KEY_ID;
  const keySecret = cfg.RAZORPAY_KEY_SECRET;
  const mock = !keyId || !keySecret;
  return { keyId, keySecret, mock };
}

async function createOrder(amountRupees, receipt) {
  const gw = await getGateway();
  const amountPaise = Math.round(Number(amountRupees) * 100);
  if (gw.mock) {
    return { mock: true, id: 'order_mock_' + crypto.randomBytes(8).toString('hex'), amount: amountPaise, currency: 'INR', keyId: null };
  }
  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({ key_id: gw.keyId, key_secret: gw.keySecret });
  const order = await razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt });
  return { mock: false, id: order.id, amount: order.amount, currency: order.currency, keyId: gw.keyId };
}

async function verifySignature({ orderId, paymentId, signature }) {
  const gw = await getGateway();
  if (gw.mock) return true; // mock mode: accept
  const expected = crypto.createHmac('sha256', gw.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return expected === signature;
}

module.exports = { createOrder, verifySignature, getGateway };
