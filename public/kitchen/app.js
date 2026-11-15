import { subscribe } from '/shared/sse.js';
import { lineLabel } from '/shared/format.js';
import { renderStaffStockAlert } from '/shared/inventory.js';

const tickets = document.getElementById('tickets');
const done = document.getElementById('done');
const donehead = document.getElementById('donehead');
const count = document.getElementById('count');
const error = document.getElementById('error');
const connection = document.getElementById('connection');
const stockAlert = document.getElementById('staffStockAlert');
const orders = new Map();
const pending = new Set();

function showError(message = '') { error.textContent = message; error.hidden = !message; }
function upsert(order) {
  if (!order?.id || order.status !== 'paid') return;
  const previous = orders.get(order.id);
  if (previous?.fulfillment_status === 'ready' && order.fulfillment_status !== 'ready') return;
  orders.set(order.id, order);
}
function card(order) {
  const ready = order.fulfillment_status === 'ready';
  const el = document.createElement('article');
  el.className = `ticket${ready ? ' done' : ''}`;
  const head = document.createElement('div'); head.className = 'head';
  const id = document.createElement('span'); id.className = 'id'; id.textContent = `#${order.id.replace(/^ord_/, '').slice(0, 6).toUpperCase()}`;
  const time = document.createElement('span'); time.className = 'time';
  time.textContent = new Date(ready ? order.ready_at : order.paid_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  head.append(id, time);
  const list = document.createElement('ul');
  for (const line of order.lines || []) { const item = document.createElement('li'); item.textContent = lineLabel(line); list.append(item); }
  const action = document.createElement('button');
  action.textContent = ready ? 'Ready for pickup ✓' : pending.has(order.id) ? 'Updating…' : 'Mark ready';
  action.disabled = ready || pending.has(order.id);
  action.onclick = () => markReady(order.id);
  el.append(head, list, action);
  return el;
}
function render() {
  tickets.replaceChildren(); done.replaceChildren();
  const sorted = [...orders.values()].sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
  for (const order of sorted) (order.fulfillment_status === 'ready' ? done : tickets).append(card(order));
  const open = tickets.children.length;
  count.textContent = `${open} preparing · ${done.children.length} ready`;
  if (!open) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'All caught up. Paid orders appear here.'; tickets.append(empty); }
  donehead.hidden = !done.children.length;
}
async function markReady(id) {
  if (pending.has(id)) return;
  pending.add(id); showError(); render();
  try {
    const response = await fetch(`/api/kitchen/${encodeURIComponent(id)}/ready`, { method: 'POST' });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not mark order ready');
    upsert(value);
  } catch (failure) { showError(`${failure.message}. Please try again.`); }
  finally { pending.delete(id); render(); }
}
async function refresh() {
  try {
    const response = await fetch('/api/kitchen', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load kitchen tickets');
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('Unexpected kitchen response');
    list.forEach(upsert); render(); showError();
  } catch (failure) { showError(failure.message); }
}
async function refreshInventory() {
  try {
    const response = await fetch('/api/inventory', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load stock levels');
    renderStaffStockAlert(stockAlert, await response.json());
  } catch (failure) { showError(failure.message); }
}

render();
const source = subscribe({ paid: order => { upsert(order); render(); }, order_saved: order => { upsert(order); render(); }, order_ready: order => { upsert(order); render(); }, inventory: snapshot => renderStaffStockAlert(stockAlert, snapshot) });
source.onopen = () => { connection.textContent = 'Live'; void refresh(); void refreshInventory(); };
source.onerror = () => { connection.textContent = 'Reconnecting…'; };
void refresh();
void refreshInventory();
setInterval(() => { void refresh(); }, 30_000);
