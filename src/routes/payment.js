import { Router } from 'express';
import QRCode from 'qrcode';
import { getOrder, setAwaitingPayment, markPaid, cancelOrder, lastPaidOrders } from '../order.js';
import { createCheckout, checkoutState, expireCheckout, mockPay, mockExpire } from '../stripe.js';
import { config } from '../config.js';
import { saveOrder, kitchenOrders, markOrderReady, inventorySnapshot, reserveStock, releaseStock, savePendingCheckout, pendingCheckouts } from '../db.js';
import { broadcast } from '../events.js';
const router = Router();
const activePollers = new Map();
let checkoutInFlight = false;
const publishInventory = () => broadcast('inventory', inventorySnapshot());

function completePayment(pendingOrder = getOrder()) {
  const current = getOrder();
  if (current.id === pendingOrder.id && current.status === 'paid') return current;
  const active = current.id === pendingOrder.id && current.status === 'awaiting_payment';
  if (!active && pendingOrder.status !== 'awaiting_payment') throw new Error('Pending checkout could not be recovered');
  const paidAt = new Date().toISOString();
  const paidOrder = { ...(active ? current : pendingOrder), status: 'paid', paid_at: paidAt };
  // The sale, stock consumption, and kitchen enqueue commit in one SQLite transaction.
  saveOrder(paidOrder, { enqueue: true });
  const published = active ? markPaid(paidAt) : paidOrder;
  if (!active) broadcast('paid', published);
  broadcast('order_saved', { ...published, fulfillment_status: 'preparing', ready_at: null });
  publishInventory();
  return published;
}

export async function startCheckout() {
  if (checkoutInFlight) throw new Error('Checkout is already starting');
  const order = getOrder();
  if (order.status !== 'building') throw new Error('Order is not being built');
  if (!order.lines.length) throw new Error('Order is empty');
  checkoutInFlight = true;
  let session;
  try {
    reserveStock(order);
    publishInventory();
    session = await createCheckout(order);
    const checkout = { ...session, qr_data_url: await QRCode.toDataURL(session.url, { width: 360, margin: 1 }) };
    const latest = getOrder();
    if (latest.id !== order.id || latest.status !== 'building' || JSON.stringify(latest.lines) !== JSON.stringify(order.lines)) {
      throw new Error('Order changed while checkout was starting. Confirm again.');
    }
    savePendingCheckout({ ...latest, status: 'awaiting_payment', checkout }, checkout.session_id);
    const updated = setAwaitingPayment(checkout);
    void pollPayment(checkout.session_id, updated.id, updated);
    return updated;
  } catch (error) {
    // An open external checkout must be expired before its stock can be released.
    if (!session || (await expireCheckout(session.session_id)).status === 'expired') {
      releaseStock(order.id);
      publishInventory();
    }
    throw error;
  } finally { checkoutInFlight = false; }
}
export async function cancelCheckout() {
  const order = getOrder();
  if (order.status !== 'awaiting_payment') return cancelOrder();
  const state = await expireCheckout(order.checkout.session_id);
  if (state.payment_status === 'paid') {
    completePayment();
    const error = new Error('Payment was already completed; this order cannot be cancelled');
    error.status = 409;
    throw error;
  }
  if (state.status !== 'expired') throw new Error('Checkout is still open; please try cancelling again');
  releaseStock(order.id);
  publishInventory();
  return cancelOrder();
}
async function pollPayment(sessionId, orderId, pendingOrder) {
  if (activePollers.has(sessionId)) return;
  const until = Date.now() + 35 * 60_000;
  activePollers.set(sessionId, until);
  try {
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const state = await checkoutState(sessionId);
        if (state.payment_status === 'paid') { completePayment(pendingOrder); break; }
        if (state.status === 'expired') {
          releaseStock(orderId);
          publishInventory();
          const active = getOrder();
          if (active.id === orderId && active.status === 'awaiting_payment') cancelOrder();
          break;
        }
      } catch (error) {
        // A transient provider error should not abandon the checkout session.
        console.error('Payment status check failed:', error.message);
      }
    }
  } finally { activePollers.delete(sessionId); }
}
export function recoverPendingCheckouts() {
  for (const { order, session_id: sessionId } of pendingCheckouts()) {
    if (config.useMockStripe) {
      // Mock payment state lives in memory, so an old mock QR cannot be paid after restart.
      releaseStock(order.id);
      publishInventory();
    } else void pollPayment(sessionId, order.id, order);
  }
}
router.post('/checkout', async (_req, res) => { try { res.json(await startCheckout()); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } });
router.post('/checkout/mock-pay', (_req, res) => {
  if (!config.useMockStripe) return res.status(404).json({ error: 'Mock payment is disabled' });
  const order = getOrder(); if (order.status !== 'awaiting_payment') return res.status(400).json({ error: 'No checkout is awaiting payment' });
  try { mockPay(order.checkout.session_id); res.json(completePayment()); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.post('/checkout/mock-expire', (_req, res) => {
  if (!config.useMockStripe) return res.status(404).json({ error: 'Mock expiry is disabled' });
  const order = getOrder();
  if (order.status !== 'awaiting_payment') return res.status(400).json({ error: 'No checkout is awaiting payment' });
  mockExpire(order.checkout.session_id);
  releaseStock(order.id);
  publishInventory();
  res.json(cancelOrder());
});
router.get('/kitchen', (_req, res) => {
  const saved = kitchenOrders();
  const ids = new Set(saved.map(order => order.id));
  // Retain visible paid tickets even if a transient database write failed.
  const unsaved = lastPaidOrders().filter(order => !ids.has(order.id)).map(order => ({ ...order, fulfillment_status: 'preparing', ready_at: null }));
  res.json([...unsaved, ...saved]);
});
router.post('/kitchen/:id/ready', (req, res) => {
  try {
    const { order, changed } = markOrderReady(req.params.id);
    if (changed) broadcast('order_ready', order);
    res.json(order);
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
router.get('/receipt', (_req, res) => {
  const order = getOrder();
  if (!order.receipt) return res.status(404).json({ error: 'No receipt has been created for this order' });
  res.json(order.receipt);
});
export default router;
