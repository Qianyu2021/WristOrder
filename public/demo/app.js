import { money, lineLabel } from '/shared/format.js';

const $ = id => document.getElementById(id);
let currentOrder = null;
let kitchenOrders = new Map();
let orderRevision = 0;
let kitchenRevision = 0;
let snapshotRevision = 0;
let statsRevision = 0;
let serviceModes = {};
let connected = false;
let refreshTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
const shortId = id => `#${String(id || '').replace(/^ord_/, '').slice(0, 6).toUpperCase()}`;
function flash(node) {
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
}
async function get(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}
function setConnection(value) {
  connected = value;
  $('connection').textContent = value ? 'Connected' : 'Reconnecting';
  $('connection').classList.toggle('connected', value);
  if (!value) $('sync-status').textContent = 'Connection interrupted. Showing the last received state.';
}
function stage(id, state, label) {
  $(`step-${id}`).className = state;
  $(`${id}-progress`).textContent = label;
}
function renderProgress() {
  const order = currentOrder;
  if (!order || !order.lines?.length || order.status === 'cancelled') {
    stage('order', 'active', order?.status === 'cancelled' ? 'Cancelled' : 'Ready to listen');
    stage('pay', '', 'Waiting');
    stage('kitchen', '', 'Waiting');
    return;
  }
  const paid = order.status === 'paid';
  const checkout = order.status === 'awaiting_payment';
  const ready = kitchenOrders.get(order.id)?.fulfillment_status === 'ready';
  stage('order', paid || checkout ? 'complete' : 'active', paid || checkout ? 'Captured' : 'Building');
  stage('pay', paid ? 'complete' : checkout ? 'active' : '', paid ? 'Paid' : checkout ? 'Scan the QR' : 'Waiting');
  stage('kitchen', ready ? 'complete' : paid ? 'active' : '', ready ? 'Ready for pickup' : paid ? 'Preparing' : 'Waiting');
}
function paymentMessage(symbol, heading, description, success = false) {
  const icon = element('span', `payment-symbol${success ? ' success' : ''}`, symbol);
  icon.setAttribute('aria-hidden', 'true');
  $('payment-content').replaceChildren(icon, element('h3', '', heading), element('p', '', description));
}
function renderPayment(order) {
  if (order.status === 'paid') {
    paymentMessage('✓', 'Payment confirmed.', `${shortId(order.id)} is with the kitchen.`, true);
  } else if (order.status === 'awaiting_payment' && order.checkout?.qr_data_url) {
    const image = element('img', 'qr');
    image.src = order.checkout.qr_data_url;
    image.alt = `Scan to pay ${money(order.total_cents)} for order ${shortId(order.id)}`;
    const label = element('p', '', `${shortId(order.id)} · ${money(order.total_cents)}`);
    const nodes = [image, label];
    try {
      const url = new URL(order.checkout.url, location.origin);
      if (['http:', 'https:'].includes(url.protocol)) {
        const link = element('a', 'payment-link', 'Open checkout ↗');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener';
        nodes.push(link);
      }
    } catch { /* The QR remains available if a checkout URL is malformed. */ }
    $('payment-content').replaceChildren(...nodes);
  } else if (order.status === 'cancelled') {
    paymentMessage('—', 'Order cancelled.', 'Start a new order from the register.');
  } else {
    paymentMessage('↗', 'Ready when you are.', 'The payment code appears when the order is confirmed.');
  }
}
function renderOrder(order, animate = false) {
  if (!order?.id) return;
  const previous = currentOrder;
  currentOrder = order;
  const statusText = { building: 'Building', awaiting_payment: 'Awaiting payment', paid: 'Paid', cancelled: 'Cancelled' };
  $('order-status').textContent = statusText[order.status] || order.status;
  $('order-status').className = `badge ${order.status}`;
  $('order-id').textContent = `ORDER ${shortId(order.id)}`;
  const rows = (order.lines || []).map(line => {
    const row = element('div', 'order-line');
    const details = element('div');
    const name = element('span', 'line-name');
    name.append(element('span', 'line-quantity', `${line.qty}×`), document.createTextNode(line.name));
    details.append(name);
    if (line.modifier_names?.length) details.append(element('span', 'line-modifiers', line.modifier_names.join(' · ')));
    row.append(details, element('span', 'line-price', money(line.line_total_cents)));
    return row;
  });
  $('order-lines').replaceChildren(...(rows.length ? rows : [element('p', 'empty', 'Start an order from the wristband or register.')]));
  $('order-total').textContent = money(order.total_cents || 0);
  $('heard').textContent = order.last_heard || 'Your conversation will appear here.';
  // Transcript updates need not rebuild the QR image while the customer scans it.
  if (!previous || previous.id !== order.id || previous.status !== order.status || previous.checkout?.qr_data_url !== order.checkout?.qr_data_url || previous.total_cents !== order.total_cents) renderPayment(order);
  renderProgress();
  if (animate && previous && (previous.id !== order.id || JSON.stringify(previous.lines) !== JSON.stringify(order.lines))) flash(document.querySelector('.order-panel'));
}
function renderKitchen(animate = false) {
  const all = [...kitchenOrders.values()].sort((a, b) => Number(a.fulfillment_status === 'ready') - Number(b.fulfillment_status === 'ready') || String(b.paid_at).localeCompare(String(a.paid_at)));
  const preparing = all.filter(order => order.fulfillment_status !== 'ready');
  $('kitchen-count').textContent = `${preparing.length} preparing`;
  const cards = all.slice(0, 20).map(order => {
    const ready = order.fulfillment_status === 'ready';
    const card = element('article', `ticket${ready ? ' ready' : ''}`);
    const heading = element('div', 'ticket-heading');
    heading.append(element('span', 'ticket-number', shortId(order.id)), element('span', 'ticket-status', ready ? 'READY FOR PICKUP' : 'PREPARING'));
    const lines = element('div', 'ticket-lines');
    for (const line of order.lines || []) lines.append(element('span', '', lineLabel(line)));
    card.append(heading, lines);
    return card;
  });
  $('tickets').replaceChildren(...(cards.length ? cards : [element('p', 'empty', 'Paid orders arrive here automatically.')]));
  renderProgress();
  if (animate) flash(document.querySelector('.kitchen-panel'));
}
function renderModes(modes) {
  serviceModes = modes;
  const names = { gemini: 'Gemini', stt: 'Speech', tts: 'Read-back', stripe: 'Payment', email: 'Email' };
  $('services').replaceChildren(...Object.entries(names).map(([key, label]) => element('span', `service ${modes[key] === 'live' ? 'live' : ''}`, `${label} · ${modes[key] || 'unknown'}`)));
  $('payment-mode').textContent = modes.stripe === 'mock' ? 'MOCK PAYMENT · No money is charged' : modes.stripe === 'live' ? 'Stripe connected · Use the configured checkout mode' : 'Payment mode unavailable';
}
async function refreshStats(animate = false) {
  const revision = ++statsRevision;
  try {
    const stats = await get('/api/owner/stats?days=7');
    if (revision !== statsRevision) return;
    const date = new Date().toISOString().slice(0, 10);
    const today = stats.daily?.find(day => day.date === date);
    if (!today) throw new Error('Today is not available in the sales response');
    const previous = $('sales-revenue').textContent;
    $('sales-revenue').textContent = money(today.revenue_cents);
    $('sales-orders').textContent = String(today.orders);
    $('sales-date').textContent = `${date} · UTC reporting day`;
    $('sales-note').textContent = 'Saved sales. History may include seeded demo orders.';
    if (animate && previous !== $('sales-revenue').textContent) flash(document.querySelector('.sales-panel'));
  } catch {
    if (revision === statsRevision) $('sales-note').textContent = 'Sales refresh unavailable. Last loaded totals remain visible.';
  }
}
async function refreshSnapshots() {
  const revision = ++snapshotRevision;
  const orderAtStart = orderRevision;
  const kitchenAtStart = kitchenRevision;
  const results = await Promise.allSettled([get('/api/order'), get('/api/kitchen'), get('/api/health')]);
  if (revision !== snapshotRevision) return;
  if (results[0].status === 'fulfilled' && orderRevision === orderAtStart) renderOrder(results[0].value);
  if (results[1].status === 'fulfilled' && kitchenRevision === kitchenAtStart) {
    kitchenOrders = new Map(results[1].value.map(order => [order.id, order]));
    renderKitchen();
  }
  if (results[2].status === 'fulfilled') renderModes(results[2].value);
  else if (!Object.keys(serviceModes).length) $('services').textContent = 'Integration modes unavailable';
  if (connected) $('sync-status').textContent = results.some(result => result.status === 'rejected') ? 'Some panels could not refresh. Retrying automatically.' : 'Live order events · Saved sales refresh automatically';
  await refreshStats();
}
function receivedOrder(event) {
  orderRevision++;
  renderOrder(JSON.parse(event.data), true);
}
function receivedKitchen(event) {
  const order = JSON.parse(event.data);
  if (!order?.id) return;
  const previous = kitchenOrders.get(order.id);
  // A late paid/saved notification must not put a ready ticket back in preparation.
  if (previous?.fulfillment_status === 'ready' && order.fulfillment_status !== 'ready') return;
  if (previous?.fulfillment_status === order.fulfillment_status && previous?.ready_at === order.ready_at) return;
  kitchenRevision++;
  kitchenOrders.set(order.id, order);
  renderKitchen(true);
  if (order.fulfillment_status !== 'ready') void refreshStats(true);
}
const events = new EventSource('/api/events');
events.addEventListener('order', receivedOrder);
events.addEventListener('paid', receivedKitchen);
events.addEventListener('order_ready', receivedKitchen);
events.addEventListener('order_saved', receivedKitchen);
events.addEventListener('open', () => { setConnection(true); void refreshSnapshots(); });
events.addEventListener('error', () => setConnection(false));
// Also render snapshots if EventSource cannot connect initially.
void refreshSnapshots();
refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') void refreshSnapshots(); }, 15_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshSnapshots(); });
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { $('sync-status').textContent = 'Full screen is unavailable in this browser.'; }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
window.addEventListener('pagehide', () => { clearInterval(refreshTimer); events.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
