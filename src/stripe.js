import Stripe from 'stripe';
import { config } from './config.js';
const stripe = config.useMockStripe ? null : new Stripe(config.stripeSecretKey);
const paid = new Set();
const expired = new Set();
export async function createCheckout(order) {
  if (config.useMockStripe) return { session_id: `mock_${order.id}`, url: `${config.publicBaseUrl}/customer?mockpay=${encodeURIComponent(order.id)}` };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    line_items: order.lines.map(line => ({
      price_data: {
        currency: 'usd',
        unit_amount: line.unit_price_cents,
        product_data: { name: `${line.name}${line.modifier_names?.length ? ` (${line.modifier_names.join(', ')})` : ''}` }
      },
      quantity: line.qty
    })),
    success_url: `${config.publicBaseUrl}/customer?paid=1`,
    cancel_url: `${config.publicBaseUrl}/customer`,
    metadata: { order_id: order.id }
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return { session_id: session.id, url: session.url };
}
export async function checkoutState(id) {
  if (config.useMockStripe) return { status: expired.has(id) ? 'expired' : paid.has(id) ? 'complete' : 'open', payment_status: paid.has(id) ? 'paid' : 'unpaid' };
  const session = await stripe.checkout.sessions.retrieve(id);
  return { status: session.status, payment_status: session.payment_status };
}
export async function isPaid(id) { return (await checkoutState(id)).payment_status === 'paid'; }
export async function expireCheckout(id) {
  if (config.useMockStripe) {
    if (!paid.has(id)) expired.add(id);
    return checkoutState(id);
  }
  try { await stripe.checkout.sessions.expire(id); }
  catch (error) {
    const state = await checkoutState(id);
    if (state.status === 'open') throw error;
    return state;
  }
  return checkoutState(id);
}
export function mockPay(id) {
  if (expired.has(id)) throw new Error('Checkout has expired');
  paid.add(id);
}
export function mockExpire(id) { if (!paid.has(id)) expired.add(id); }
