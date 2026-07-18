const crypto = require('crypto');

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const MOCK = !keyId || !keySecret;

let razorpay = null;
if (!MOCK) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function createOrder(amountRupees, receipt) {
  const amountPaise = Math.round(Number(amountRupees) * 100);
  if (MOCK) {
    return { mock: true, id: 'order_mock_' + crypto.randomBytes(8).toString('hex'), amount: amountPaise, currency: 'INR' };
  }
  const order = await razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt });
  return { mock: false, id: order.id, amount: order.amount, currency: order.currency };
}

function verifySignature({ orderId, paymentId, signature }) {
  if (MOCK) return true; // mock mode: accept
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return expected === signature;
}

module.exports = { createOrder, verifySignature, MOCK, keyId };
