import { randomBytes } from 'node:crypto';
import { findItem, findModifier, priceLine } from './menu.js';
import { broadcast } from './events.js';

let order = makeOrder();
const paidOrders = [];
function makeOrder() { return { id: `ord_${randomBytes(4).toString('hex')}`, status: 'building', lines: [], total_cents: 0, last_heard: '', last_readback: '', checkout: null, receipt: null, created_at: new Date().toISOString(), paid_at: null }; }
export const getOrder = () => structuredClone(order);
function mutable() { if (order.status !== 'building') throw new Error('Order is not being built'); }
function publish() { order.total_cents = order.lines.reduce((sum, line) => sum + line.line_total_cents, 0); broadcast('order', getOrder()); return getOrder(); }
function rebuild(line) { const item = findItem(line.menu_id); const mods = [...new Set(line.modifiers)]; const prices = priceLine({ menu_id: line.menu_id, qty: line.qty, modifiers: mods }); return { ...line, name: item.name, modifiers: mods, modifier_names: mods.map(id => findModifier(id).name), ...prices }; }
function makeReceipt() {
  return {
    number: `R-${order.id.replace('ord_', '').toUpperCase()}`,
    issued_at: new Date().toISOString(),
    currency: 'usd',
    lines: structuredClone(order.lines),
    total_cents: order.total_cents
  };
}
export function newOrder() {
  if (order.status === 'awaiting_payment') throw new Error('Cancel the pending checkout before starting a new order');
  order = makeOrder(); return publish();
}
export function addItem(menu_id, qty = 1, modifiers = []) {
  mutable();
  const item = findItem(menu_id); if (!item) throw new Error(`Unknown menu item: ${menu_id}`);
  const mods = [...new Set(modifiers)];
  const existing = order.lines.find(line => line.menu_id === menu_id && [...line.modifiers].sort().join() === [...mods].sort().join());
  if (existing) existing.qty += qty;
  else order.lines.push({ line_id: order.lines.reduce((max, line) => Math.max(max, line.line_id), 0) + 1, menu_id, name: item.name, qty, modifiers: mods });
  order.lines = order.lines.map(rebuild); return publish();
}
export function removeItem({ line_id, menu_id } = {}) { mutable(); order.lines = order.lines.filter(line => line_id != null ? line.line_id !== line_id : line.menu_id !== menu_id); return publish(); }
export function updateItem(line_id, updates = {}) {
  mutable(); const line = order.lines.find(row => row.line_id === line_id); if (!line) throw new Error(`Unknown line: ${line_id}`);
  if (updates.qty === 0) return removeItem({ line_id });
  if (updates.qty != null) line.qty = updates.qty;
  if (updates.modifiers != null) line.modifiers = updates.modifiers;
  order.lines = order.lines.map(rebuild); return publish();
}
export function replaceItem(line_id, menu_id, modifiers) {
  mutable();
  const line = order.lines.find(row => row.line_id === line_id);
  if (!line) throw new Error(`Unknown line: ${line_id}`);
  const item = findItem(menu_id);
  if (!item) throw new Error(`Unknown menu item: ${menu_id}`);
  line.menu_id = menu_id;
  if (modifiers != null) line.modifiers = modifiers;
  order.lines = order.lines.map(rebuild);
  return publish();
}
export function clearOrder() { mutable(); order.lines = []; return publish(); }
export function setHeard(text) { order.last_heard = text; return publish(); }
export function setReadback(text) { order.last_readback = text; return publish(); }
export function setAwaitingPayment(checkout) { mutable(); if (!order.lines.length) throw new Error('Order is empty'); order.status = 'awaiting_payment'; order.checkout = checkout; order.receipt = makeReceipt(); return publish(); }
export function markPaid(paidAt = new Date().toISOString()) { if (order.status !== 'awaiting_payment') throw new Error('Order is not awaiting payment'); order.status = 'paid'; order.paid_at = paidAt; paidOrders.unshift(getOrder()); if (paidOrders.length > 20) paidOrders.pop(); broadcast('paid', getOrder()); return publish(); }
export function cancelOrder() {
  if (!['building', 'awaiting_payment'].includes(order.status)) {
    throw new Error(order.status === 'paid' ? 'Paid orders cannot be cancelled here' : 'Order is already cancelled');
  }
  order.status = 'cancelled';
  return publish();
}
export function lastPaidOrders() { return structuredClone(paidOrders); }
