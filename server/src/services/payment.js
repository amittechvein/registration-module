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

/**
 * Create a Razorpay order. `notes` (key → value strings) are attached to the
 * order and shown in the Razorpay dashboard — so even FAILED or abandoned
 * transactions can be identified (student, phone, form, submission id).
 * Razorpay allows max 15 notes, values up to 256 chars.
 */
async function createOrder(amountRupees, receipt, notes = {}) {
  const gw = await getGateway();
  const amountPaise = Math.round(Number(amountRupees) * 100);
  if (gw.mock) {
    return { mock: true, id: 'order_mock_' + crypto.randomBytes(8).toString('hex'), amount: amountPaise, currency: 'INR', keyId: null };
  }
  const cleanNotes = {};
  for (const [k, v] of Object.entries(notes)) {
    if (v == null || v === '') continue;
    cleanNotes[String(k).slice(0, 40)] = String(v).slice(0, 256);
    if (Object.keys(cleanNotes).length >= 15) break;
  }
  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({ key_id: gw.keyId, key_secret: gw.keySecret });
  const order = await razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt, notes: cleanNotes });
  return { mock: false, id: order.id, amount: order.amount, currency: order.currency, keyId: gw.keyId };
}

/**
 * Reconciliation: ask Razorpay what actually happened to an order.
 * Returns { paid, paymentId, method, status } — paid=true when a captured
 * payment exists even though our verify callback never arrived.
 */
async function fetchOrderPayments(orderId) {
  const gw = await getGateway();
  if (gw.mock) throw new Error('Razorpay keys are not configured');
  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({ key_id: gw.keyId, key_secret: gw.keySecret });
  const r = await razorpay.orders.fetchPayments(orderId);
  const items = r?.items || [];
  const captured = items.find((p) => p.status === 'captured');
  const authorized = items.find((p) => p.status === 'authorized');
  return {
    paid: !!captured,
    paymentId: captured?.id || null,
    method: captured?.method || null,
    status: captured ? 'captured' : authorized ? 'authorized (not captured yet)' : items.length ? items[items.length - 1].status : 'no payment attempt',
  };
}

async function verifySignature({ orderId, paymentId, signature }) {
  const gw = await getGateway();
  if (gw.mock) return true; // mock mode: accept
  const expected = crypto.createHmac('sha256', gw.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return expected === signature;
}

module.exports = { createOrder, verifySignature, getGateway, fetchOrderPayments };
