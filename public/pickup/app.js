import { subscribe } from '/shared/sse.js';

const orders = new Map();
const ready = document.getElementById('ready');
const preparing = document.getElementById('preparing');
const connection = document.getElementById('connection');
const error = document.getElementById('error');
function upsert(order) {
  if (!order?.id || order.status !== 'paid') return;
  if (orders.get(order.id)?.fulfillment_status === 'ready' && order.fulfillment_status !== 'ready') return;
  orders.set(order.id, order);
}
function render() {
  ready.replaceChildren(); preparing.replaceChildren();
  const readyOrders = [...orders.values()].filter(order => order.fulfillment_status === 'ready').sort((a, b) => String(b.ready_at).localeCompare(String(a.ready_at))).slice(0, 12);
  const openOrders = [...orders.values()].filter(order => order.fulfillment_status !== 'ready').sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)));
  for (const order of readyOrders) {
    const card = document.createElement('div'); card.className = 'ready-card';
    const id = document.createElement('strong'); id.textContent = `#${order.id.replace(/^ord_/, '').slice(0, 6).toUpperCase()}`;
    const label = document.createElement('span'); label.textContent = 'READY TO ENJOY';
    card.append(id, label); ready.append(card);
  }
  for (const order of openOrders) { const card = document.createElement('div'); card.className = 'preparing-card'; card.textContent = `#${order.id.replace(/^ord_/, '').slice(0, 6).toUpperCase()}`; preparing.append(card); }
  document.getElementById('readyCount').textContent = readyOrders.length;
  document.getElementById('preparingCount').textContent = openOrders.length;
  for (const [element, message] of [[ready, 'We’ll show your number here when your order is ready.'], [preparing, 'Waiting for the next order.']]) {
    if (element.children.length) continue;
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = message; element.append(empty);
  }
}
async function refresh() {
  try {
    const response = await fetch('/api/kitchen', { cache: 'no-store' });
    if (!response.ok) throw new Error('Order display temporarily unavailable');
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('Order display temporarily unavailable');
    list.forEach(upsert); render(); error.hidden = true;
  } catch (failure) { error.textContent = `${failure.message}. Reconnecting automatically.`; error.hidden = false; }
}
render();
const source = subscribe({ paid: order => { upsert(order); render(); }, order_saved: order => { upsert(order); render(); }, order_ready: order => { upsert(order); render(); } });
source.onopen = () => { connection.textContent = '● Live updates'; void refresh(); };
source.onerror = () => { connection.textContent = 'Reconnecting…'; };
void refresh();
setInterval(() => { void refresh(); }, 30_000);
