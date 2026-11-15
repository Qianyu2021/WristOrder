import { subscribe } from '/shared/sse.js';
import { money } from '/shared/format.js';
import { stockAmount, stockName, stockStatus, madeToOrderItems } from '/shared/inventory.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brand = '<div class="brand">WristOrder</div>';
const thanks = (sub = 'Enjoy your order.') => `<div class="screen paid">${brand}<div class="center"><div class="check">&#10003;</div><h1 class="big">Paid &mdash; thank you!</h1><p class="sub">${sub}</p></div></div>`;
const lineHtml = l => `<li data-id="${l.line_id}"><span>${l.qty}&times; ${esc(l.name)}${l.modifier_names?.length ? `<span class="mods">${esc(l.modifier_names.join(', '))}</span>` : ''}</span><span class="price">${money(l.line_total_cents)}</span></li>`;
const cancelButton = '<button class="cancel" id="cancel-order">Cancel order</button>';
let popularItems = null;
let activeTab = 'order';
let inventoryItems = [];
let ingredientInventory = [];
let menuInventory = [];
let screenStarted = false;
let renderCurrent = null;
const ingredientName = name => name.replace(/_(ml|g)$/, '').replaceAll('_', ' ');
function inventoryHtml() {
  if (!inventoryItems.length) return '<section class="stock-list" id="inventory-status" aria-label="Pastry availability"><p>Checking pastry availability…</p></section>';
  return `<section class="stock-list" id="inventory-status" aria-label="Pastry availability"><h2>Pastries today</h2><div class="stock-grid">${inventoryItems.map(item => {
    const alternative = item.available === 0 ? inventoryItems.find(other => other.menu_id !== item.menu_id && other.available > 0) : null;
    return `<div class="stock-card${item.available === 0 ? ' sold-out' : ''}"><strong>${esc(item.name)}</strong><span>${item.available === 0 ? 'Sold out' : `${item.available} available`}</span>${alternative ? `<small>Try ${esc(alternative.name)} instead; ask the cashier to change your order.</small>` : ''}</div>`;
  }).join('')}</div></section>`;
}
function fullInventoryHtml() {
  if (!menuInventory.length && !inventoryItems.length && !ingredientInventory.length) return '<p class="sub">Checking inventory…</p>';
  const menuCards = menuInventory.map(item => {
    const status = stockStatus(item);
    return `<article class="stock-card${status === 'Sold out' ? ' sold-out' : status === 'Low' ? ' low-stock' : ''}"><strong>${esc(item.name)}</strong><span>${item.available === null ? 'Availability unknown' : `${item.available} can make`}</span><small class="stock-status">${status}</small></article>`;
  }).join('');
  const stockCards = [...inventoryItems.map(item => ({ ...item, unit: 'pcs' })), ...ingredientInventory].map(item => {
    const status = stockStatus(item);
    return `<article class="stock-card${status === 'Sold out' ? ' sold-out' : status === 'Low' ? ' low-stock' : ''}"><strong>${esc(stockName(item))}</strong><span>${esc(stockAmount(item, item.available))} available</span><small class="stock-status">${status}</small></article>`;
  }).join('');
  return `<section class="stock-list"><h2>Made-to-order food and drinks</h2><div class="stock-grid">${menuCards}</div><h2>Baked goods and ingredients</h2><div class="stock-grid">${stockCards}</div></section>`;
}
function renderInventoryStatus() {
  const section = document.getElementById('inventory-status');
  if (section) section.outerHTML = inventoryHtml();
}
function updateInventory(snapshot) {
  if (!Array.isArray(snapshot?.items)) return;
  inventoryItems = snapshot.items;
  ingredientInventory = snapshot.ingredients || [];
  menuInventory = madeToOrderItems(snapshot);
  if (activeTab === 'order') renderCurrent?.();
  else if (activeTab === 'inventory') renderInventoryPage();
}
const tabs = () => `<div class="tabs" role="tablist" aria-label="Customer views"><button class="tab ${activeTab === 'order' ? 'selected' : ''}" data-tab="order" role="tab" aria-selected="${activeTab === 'order'}">Current order</button><button class="tab ${activeTab === 'popular' ? 'selected' : ''}" data-tab="popular" role="tab" aria-selected="${activeTab === 'popular'}">Popular items</button><button class="tab ${activeTab === 'inventory' ? 'selected' : ''}" data-tab="inventory" role="tab" aria-selected="${activeTab === 'inventory'}">Inventory</button></div>`;
function bindTabs() {
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { activeTab = button.dataset.tab; renderPopularOrOrder(); });
}
async function renderPopular() {
  app.innerHTML = `<div class="screen">${brand}${tabs()}<div class="info-view"><h1>Popular items</h1><p class="sub">Based on paid orders</p><div id="popular-list" class="popular-list"><p class="sub">Loading popularity…</p></div></div></div>`;
  bindTabs();
  try {
    if (!popularItems) {
      const response = await fetch('/api/popular-items?limit=8');
      if (!response.ok) throw new Error('Could not load popular items');
      popularItems = await response.json();
    }
    const list = document.querySelector('#popular-list');
    if (!list) return;
    if (!popularItems.length) { list.innerHTML = '<p class="sub">No paid orders yet.</p>'; return; }
    list.innerHTML = popularItems.map((item, index) => `<article class="popular-card"><div class="popular-heading"><span class="rank">#${index + 1}</span><div><h2>${esc(item.name)}</h2><p>${item.quantity_sold} sold across ${item.order_count} order${item.order_count === 1 ? '' : 's'}</p></div></div><div class="ingredients"><strong>Estimated ingredients consumed</strong><span>${item.ingredients_consumed.map(row => `${esc(ingredientName(row.ingredient))}: ${row.amount} ${esc(row.unit)}`).join(' · ')}</span></div></article>`).join('');
  } catch (error) { const list = document.querySelector('#popular-list'); if (list) list.innerHTML = `<p class="sub">${esc(error.message)}</p>`; }
}
function renderInventoryPage() {
  if (activeTab !== 'inventory') return;
  app.innerHTML = `<div class="screen">${brand}${tabs()}<div class="info-view inventory-view"><h1>Inventory</h1><p class="sub">Live food and ingredient availability. Menu counts use base recipes.</p>${fullInventoryHtml()}</div></div>`;
  bindTabs();
}
function renderPopularOrOrder() {
  if (activeTab === 'popular') void renderPopular();
  else if (activeTab === 'inventory') renderInventoryPage();
  else screen();
}
async function cancelActiveOrder(button) {
  if (!confirm('Cancel this order?')) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/order/cancel', { method: 'POST' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not cancel the order.');
  } catch (error) {
    button.disabled = false;
    const message = document.getElementById('cancel-message');
    if (message) message.textContent = error.message;
  }
}

if (params.get('paid')) {
  app.innerHTML = thanks('Your payment went through.');
} else if (params.get('mockpay')) {
  phonePay();
} else {
  screen();
}

async function phonePay() {
  let order = null;
  try { order = await (await fetch('/api/order')).json(); } catch {}
  const lines = order?.lines || [];
  app.innerHTML = `<div class="screen">${brand}<div class="pay"><h1>Your order</h1><ul class="lines">${lines.map(lineHtml).join('')}</ul><div class="totalbar"><span>Total</span><b>${money(order?.total_cents || 0)}</b></div><button id="pay">Pay (test)</button><p class="sub" id="msg"></p></div></div>`;
  const btn = document.getElementById('pay');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await fetch('/api/checkout/mock-pay', { method: 'POST' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Payment failed');
      app.innerHTML = thanks('Your test payment went through.');
    } catch (e) { document.getElementById('msg').textContent = e.message; btn.disabled = false; }
  };
}

function screen() {
  if (activeTab === 'popular') { renderPopular(); return; }
  if (screenStarted) { renderCurrent?.(); return; }
  screenStarted = true;
  let order = null, paidTimer = null, showingPaid = false, lastStatus = null;
  const showPaid = () => {
    showingPaid = true;
    app.innerHTML = thanks();
    clearTimeout(paidTimer);
    paidTimer = setTimeout(() => { showingPaid = false; render(); }, 6000);
  };
  function render() {
    if (showingPaid || activeTab !== 'order') return;
    if (!order || (order.status === 'building' && !order.lines.length) || order.status === 'paid' || order.status === 'cancelled') {
      app.innerHTML = `<div class="screen">${brand}${tabs()}<div class="center"><h1 class="big">Welcome</h1><p class="sub">Tell us your order &mdash; we&rsquo;re listening.</p></div>${inventoryHtml()}</div>`;
      bindTabs();
      return;
    }
    if (order.status === 'awaiting_payment' && order.checkout?.qr_data_url) {
      const key = `${order.id}|qr`;
      if (app.dataset.key === key && app.querySelector('.qr')) return;
      app.dataset.key = key;
      app.innerHTML = `<div class="screen">${brand}${tabs()}<div class="center"><img class="qr" alt="Payment QR code" src="${esc(order.checkout.qr_data_url)}"><h1 class="big" style="font-size:clamp(2.5rem,6vw,5rem)">Scan to pay ${money(order.total_cents)}</h1><p class="sub">Apple Pay / Google Pay / card</p>${cancelButton}<p class="sub" id="cancel-message"></p></div></div>`;
      document.getElementById('cancel-order').onclick = event => cancelActiveOrder(event.currentTarget);
      bindTabs();
      return;
    }
    delete app.dataset.key;
    let ul = app.querySelector('ul.lines');
    if (!ul) {
      app.innerHTML = `<div class="screen">${brand}${tabs()}<ul class="lines"></ul><div class="totalbar"><span>Total</span><b id="total"></b></div><div class="heard" id="heard"></div>${inventoryHtml()}${cancelButton}<p class="sub" id="cancel-message"></p></div>`;
      ul = app.querySelector('ul.lines');
      document.getElementById('cancel-order').onclick = event => cancelActiveOrder(event.currentTarget);
      bindTabs();
    }
    // Reconcile: keep unchanged rows (no re-animation), add/replace changed ones.
    const want = order.lines.map(l => [String(l.line_id), lineHtml(l)]);
    const have = [...ul.children];
    have.forEach(li => { const w = want.find(x => x[0] === li.dataset.id); if (!w) li.remove(); else if (li.outerHTML !== w[1] && li.dataset.sig !== w[1]) { li.innerHTML = new DOMParser().parseFromString(w[1], 'text/html').querySelector('li').innerHTML; li.dataset.sig = w[1]; li.style.animation = 'none'; } });
    want.forEach(([id, html], i) => {
      let li = [...ul.children].find(x => x.dataset.id === id);
      if (!li) { ul.insertAdjacentHTML('beforeend', html); li = ul.lastElementChild; }
      if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
    });
    document.getElementById('total').textContent = money(order.total_cents);
    document.getElementById('heard').textContent = order.last_heard ? `Heard: “${order.last_heard}”` : '';
    renderInventoryStatus();
  }
  renderCurrent = render;
  subscribe({
    order(o) {
      // Show Paid only on a watched transition; a fresh already-paid order on load shows Welcome.
      if (o.status === 'paid' && lastStatus && lastStatus !== 'paid' && !showingPaid) showPaid();
      lastStatus = o.status; order = o; render();
    },
    paid(o) { lastStatus = 'paid'; order = o; if (!showingPaid) showPaid(); },
    order_saved() { popularItems = null; if (activeTab === 'popular') void renderPopular(); },
    inventory: updateInventory,
  });
  // SSE only delivers changes that happen after this page connects. Hydrate once
  // so a customer display opened (or reloaded) after confirmation still shows
  // the active payment QR code.
  fetch('/api/order')
    .then(res => res.ok ? res.json() : null)
    .then(o => { if (o) { lastStatus = o.status; order = o; render(); } })
    .catch(() => {});
  fetch('/api/inventory').then(res => res.ok ? res.json() : null).then(updateInventory).catch(() => {});
  render();
}
