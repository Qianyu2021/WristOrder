import { subscribe } from '/shared/sse.js';
import { money, lineLabel } from '/shared/format.js';
import { createRecorder, listInputDevices } from '/shared/recorder.js';
import { createVexo } from './vexo.js';
import { stockAmount, stockName, stockStatus, madeToOrderItems, renderStaffStockAlert } from '/shared/inventory.js';

const $ = id => document.getElementById(id);
const els = Object.fromEntries(['mic', 'micSource', 'ptt', 'level', 'textForm', 'text', 'heard', 'readback', 'status', 'lines', 'total', 'confirm', 'clear', 'cancel', 'new', 'pay', 'error', 'vexoConnect', 'vexoStatus', 'vexoStop', 'conversation', 'receipt', 'receiptNumber', 'receiptLines', 'receiptTotal', 'printReceipt', 'payment', 'paymentQr', 'paymentLink', 'menuItems', 'popularItems', 'inventoryItems', 'menuTab', 'popularTab', 'inventoryTab'].map(id => [id, $(id)]));
const MIC_KEY = 'wristorder.mic';
let order = null, recorder = null, meter = null, listening = false, starting = false, errTimer;
let checkoutPending = false;
let vexo = null, vexoState = 'disconnected';
let conversationParts = [];
let activeItemTab = 'menu';
let menu = [];
let inventory = new Map();
let ingredientInventory = [];
let menuAvailability = [];
let inventoryError = '';
let inventoryNotice = '';
const STOP_LISTENING = /\bstop[\s.,!?-]+listening\b/i;
const NEW_ORDER_SPEECH = /\b(?:start(?: a)? new order|new order|next customer)\b/i;
const CONFIRM_SPEECH = /^(?:(?:hey )?vexo |yes |okay |ok |please |i want to |i |can you |could you )*confirm(?:(?: (?:the|this|my))? order| it)?(?: now| please)?$/;

const store = {
  get() { try { return localStorage.getItem(MIC_KEY) || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem(MIC_KEY, v); } catch {} }
};

function showError(msg) {
  els.error.textContent = msg; els.error.hidden = false;
  clearTimeout(errTimer); errTimer = setTimeout(() => { els.error.hidden = true; }, 8000);
}
const clearError = () => { els.error.hidden = true; };

async function request(path, opts = {}) {
  let res;
  try { res = await fetch(path, opts); } catch { showError('Network error: server unreachable'); throw new Error('network'); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data?.readback?.text || data?.error || `Request failed (${res.status})`;
    showError(data?.error || msg);
    if (data?.order) render(data.order);
    throw new Error(msg);
  }
  return data;
}
const post = path => request(path, { method: 'POST' });
const postJson = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function render(o) {
  if (!o) return;
  order = o;
  els.status.textContent = o.status.replace('_', ' ');
  els.status.className = 'badge ' + o.status;
  renderOrderLines(o);
  els.total.textContent = money(o.total_cents);
  renderReceipt(o.receipt);
  const checkout = o.status === 'awaiting_payment' ? o.checkout : null;
  els.payment.hidden = !checkout?.qr_data_url;
  if (checkout?.qr_data_url) {
    els.paymentQr.src = checkout.qr_data_url;
    els.paymentLink.href = checkout.url;
  }
  if (o.last_heard) els.heard.textContent = o.last_heard;
  if (o.last_readback) els.readback.textContent = o.last_readback;
  const building = o.status === 'building';
  els.confirm.disabled = checkoutPending;
  els.clear.disabled = !['building', 'awaiting_payment'].includes(o.status) || !o.lines.length;
  els.cancel.disabled = !['building', 'awaiting_payment'].includes(o.status);
  vexo?.updateOrderStatus(o.status);
}

function renderOrderLines(o) {
  els.lines.innerHTML = '';
  if (!o.lines.length) { els.lines.innerHTML = '<div class="empty">No items yet. Hold the button and speak.</div>'; return; }
  for (const l of o.lines) {
    const row = document.createElement('div'); row.className = 'line order-line';
    const details = document.createElement('span'); details.textContent = lineLabel(l);
    const price = document.createElement('span'); price.className = 'line-price'; price.textContent = money(l.line_total_cents);
    const controls = document.createElement('span'); controls.className = 'replace-controls';
    const select = document.createElement('select'); select.className = 'replace-select'; select.setAttribute('aria-label', `Replace ${l.name}`);
    for (const item of menu) { const option = new Option(`${item.name} · ${money(item.price_cents)}`, item.id, item.id === l.menu_id, item.id === l.menu_id); select.add(option); }
    const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'replace-button'; replace.textContent = 'Replace';
    replace.disabled = o.status !== 'building' || !menu.length;
    replace.onclick = async () => {
      replace.disabled = true;
      try { render(await postJson('/api/order/replace', { line_id: l.line_id, menu_id: select.value, modifiers: [] })); }
      catch {} finally { replace.disabled = false; }
    };
    controls.append(select, replace); row.append(details, price, controls); els.lines.append(row);
  }
}

function renderReceipt(receipt) {
  els.receipt.hidden = !receipt;
  if (!receipt) return;
  els.receiptNumber.textContent = `${receipt.number} · ${new Date(receipt.issued_at).toLocaleString()}`;
  els.receiptLines.innerHTML = '';
  for (const line of receipt.lines) {
    const row = document.createElement('div'); row.className = 'line';
    const label = document.createElement('span'); label.textContent = lineLabel(line);
    const price = document.createElement('span'); price.textContent = money(line.line_total_cents);
    row.append(label, price); els.receiptLines.append(row);
  }
  els.receiptTotal.textContent = money(receipt.total_cents);
}

function renderMenu(menuData) {
  menu = menuData.items || [];
  const groups = new Map();
  for (const item of menu) {
    const group = groups.get(item.category) || [];
    group.push(item); groups.set(item.category, group);
  }
  els.menuItems.innerHTML = '';
  for (const [category, items] of groups) {
    const group = document.createElement('section'); group.className = 'menu-group';
    const title = document.createElement('h3'); title.textContent = category;
    group.append(title);
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'line menu-line';
      const name = document.createElement('span'); name.textContent = item.name;
      const stock = inventory.get(item.id);
      if (stock) {
        const badge = document.createElement('small');
        badge.className = `stock-badge${stock.available === 0 ? ' sold-out' : ''}`;
        badge.textContent = stock.available === 0 ? 'Sold out' : `${stock.available} available`;
        name.append(badge);
        if (stock.available === 0) {
          const alternative = [...inventory.values()].find(candidate => candidate.menu_id !== item.id && candidate.available > 0);
          if (alternative) {
            const hint = document.createElement('small');
            hint.className = 'stock-hint';
            hint.textContent = `Offer ${alternative.name} instead; ask before replacing.`;
            name.append(hint);
          }
        }
      }
      const price = document.createElement('span'); price.textContent = money(item.price_cents);
      row.append(name, price); group.append(row);
    }
    els.menuItems.append(group);
  }
  if (order) render(order);
}

function renderPopular(items) {
  els.popularItems.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No completed orders yet. Popular items will appear after payment.';
    els.popularItems.append(empty);
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'popular-row';
    const rank = document.createElement('span'); rank.className = 'popular-rank'; rank.textContent = `#${index + 1}`;
    const name = document.createElement('span'); name.className = 'popular-name'; name.textContent = item.name;
    const count = document.createElement('span'); count.className = 'popular-count'; count.textContent = `${item.quantity_sold} sold`;
    row.append(rank, name, count); els.popularItems.append(row);
  });
}

function renderInventory() {
  els.inventoryItems.replaceChildren();
  if (!inventory.size) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = inventoryError || 'Checking inventory…';
    els.inventoryItems.append(empty);
    if (inventoryError) {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = 'Retry inventory';
      retry.addEventListener('click', () => { void loadInventory(); });
      els.inventoryItems.append(retry);
    }
    return;
  }
  const intro = document.createElement('p');
  intro.className = 'inventory-intro';
  intro.textContent = inventoryError
    ? `Could not refresh inventory: ${inventoryError}. Showing the last loaded counts.`
    : 'Available stock updates as orders are reserved, paid, or cancelled. Add deliveries below or say a stock update to the band. Menu counts use base recipes; modifiers can change ingredient needs.';
  els.inventoryItems.append(intro);
  const feedback = document.createElement('p');
  feedback.id = 'inventoryFeedback'; feedback.className = 'inventory-feedback';
  feedback.setAttribute('role', 'status');
  feedback.textContent = inventoryNotice;
  els.inventoryItems.append(feedback);
  const menuHeading = document.createElement('h3');
  menuHeading.className = 'inventory-section'; menuHeading.textContent = 'Made-to-order food and drinks';
  els.inventoryItems.append(menuHeading);
  for (const item of menuAvailability) {
    const card = document.createElement('article');
    card.className = `inventory-card${item.sold_out ? ' sold-out' : item.low ? ' low-stock' : ''}`;
    const name = document.createElement('strong'); name.textContent = item.name;
    const available = document.createElement('span'); available.className = 'inventory-available';
    available.textContent = item.available === null ? 'Availability unknown' : `${item.available} can make`;
    const status = document.createElement('small'); status.className = 'inventory-status';
    status.textContent = stockStatus(item);
    card.append(name, available, status);
    els.inventoryItems.append(card);
  }
  const bakedHeading = document.createElement('h3');
  bakedHeading.className = 'inventory-section'; bakedHeading.textContent = 'Baked goods';
  els.inventoryItems.append(bakedHeading);
  for (const item of inventory.values()) {
    const card = document.createElement('article');
    card.className = `inventory-card${item.available === 0 ? ' sold-out' : item.available <= item.low_at ? ' low-stock' : ''}`;
    const name = document.createElement('strong'); name.textContent = item.name;
    const available = document.createElement('span'); available.className = 'inventory-available';
    available.textContent = item.available === 0 ? 'Sold out' : `${item.available} available`;
    const detail = document.createElement('small');
    detail.textContent = `${item.on_hand} on hand · ${item.reserved} reserved`;
    const status = document.createElement('small'); status.className = 'inventory-status'; status.textContent = stockStatus(item);
    card.append(name, available, status, detail);
    appendReceiveControl(card, { kind: 'item', id: item.menu_id, item });
    if (item.available === 0) {
      const alternative = [...inventory.values()].find(other => other.menu_id !== item.menu_id && other.available > 0);
      if (alternative) {
        const hint = document.createElement('small');
        hint.className = 'stock-hint';
        hint.textContent = `Offer ${alternative.name} instead; ask before replacing.`;
        card.append(hint);
      }
    }
    els.inventoryItems.append(card);
  }
  const ingredientHeading = document.createElement('h3');
  ingredientHeading.className = 'inventory-section'; ingredientHeading.textContent = 'Drink and food ingredients';
  els.inventoryItems.append(ingredientHeading);
  for (const item of [...ingredientInventory].sort((a, b) => Number(Boolean(b.package_size)) - Number(Boolean(a.package_size)) || stockName(a).localeCompare(stockName(b)))) {
    const card = document.createElement('article');
    card.className = `inventory-card${item.available === 0 ? ' sold-out' : item.low ? ' low-stock' : ''}`;
    const name = document.createElement('strong'); name.textContent = stockName(item);
    const available = document.createElement('span'); available.className = 'inventory-available';
    available.textContent = stockAmount(item, item.available);
    const detail = document.createElement('small');
    detail.textContent = `${stockAmount(item, item.on_hand)} on hand · ${stockAmount(item, item.reserved)} reserved`;
    const status = document.createElement('small'); status.className = 'inventory-status'; status.textContent = stockStatus(item);
    card.append(name, available, status, detail);
    appendReceiveControl(card, { kind: 'ingredient', id: item.ingredient, item });
    els.inventoryItems.append(card);
  }
}

function appendReceiveControl(card, { kind, id, item }) {
  const form = document.createElement('form');
  form.className = 'inventory-receive';
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.step = '1'; input.required = true;
  input.setAttribute('aria-label', `Quantity of ${stockName(item)} received`);
  const unit = document.createElement('small');
  unit.textContent = item.package_unit ? `${item.package_unit}s` : item.unit || 'pcs';
  const button = document.createElement('button');
  button.type = 'submit'; button.textContent = 'Add stock';
  form.append(input, unit, button);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    const count = Number(input.value);
    try {
      const snapshot = await postJson('/api/owner/inventory/receive', {
        kind, id, amount: count * (item.package_size || 1)
      });
      inventoryNotice = `Added ${stockAmount(item, count * (item.package_size || 1))} of ${stockName(item)}.`;
      updateInventory(snapshot);
    } catch (error) {
      inventoryNotice = error.message || 'Could not add stock. Please try again.';
      renderInventory();
      button.disabled = false;
    }
  });
  card.append(form);
}

function setItemTab(tab) {
  activeItemTab = tab;
  for (const [name, button, panel] of [
    ['menu', els.menuTab, els.menuItems],
    ['popular', els.popularTab, els.popularItems],
    ['inventory', els.inventoryTab, els.inventoryItems],
  ]) {
    const selected = tab === name;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    panel.hidden = !selected;
  }
  if (tab === 'popular') void loadPopularItems();
  if (tab === 'inventory') renderInventory();
}

async function loadPopularItems() {
  try { renderPopular(await request('/api/popular-items')); } catch {}
}

async function playReadback(rb) {
  if (!rb?.audio_url) return;
  try {
    const res = await fetch(rb.audio_url);
    if (res.status !== 200) return;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
  } catch {}
}

function handleVoiceResult(data) {
  if (!data) return;
  if (data.heard !== undefined) els.heard.textContent = data.heard || '(nothing heard)';
  if (data.order) render(data.order);
  if (data.actions?.some(action => action.name === 'new_order')) {
    els.heard.textContent = '—';
    els.readback.textContent = '—';
    els.conversation.textContent = '—';
  }
  if (data.inventory) updateInventory(data.inventory);
  if (data.readback?.text) els.readback.textContent = data.readback.text;
  playReadback(data.readback);
}

async function sendText(text) {
  try { handleVoiceResult(await postJson('/api/voice', { text })); } catch {}
}

async function transcribeConversationSegment(blob) {
  const fd = new FormData();
  fd.append('audio', blob, 'conversation.wav');
  const data = await request('/api/transcribe', { method: 'POST', body: fd });
  const heard = data.heard?.trim();
  if (!heard) return;
  conversationParts.push(heard);
  const conversation = conversationParts.join(' ');
  els.conversation.textContent = conversation;
  els.heard.textContent = heard;
  // Do not await this from the segment uploader: stopping flushes that same
  // upload queue, so waiting here would make the queue wait for itself.
  const spokenCommand = conversation.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (STOP_LISTENING.test(conversation) || NEW_ORDER_SPEECH.test(spokenCommand) || CONFIRM_SPEECH.test(spokenCommand)) void vexo.stopRecording();
}

async function finishConversation() {
  const conversation = conversationParts.join(' ').replace(STOP_LISTENING, ' ').replace(/\s+/g, ' ').trim();
  conversationParts = [];
  if (!conversation) {
    showError('No conversation was heard before listening stopped.');
    return;
  }
  els.conversation.textContent = conversation;
  handleVoiceResult(await postJson('/api/conversation', { text: conversation }));
}

async function confirmOrder({ announce = false } = {}) {
  if (!order) throw new Error('The order is still loading. Please try again.');
  if (order.status === 'awaiting_payment') {
    els.payment.scrollIntoView({ behavior: 'smooth', block: 'center' });
    throw new Error('Payment has already started. Scan the QR code or cancel this checkout.');
  }
  if (order.status !== 'building') throw new Error('Start a new order before confirming.');
  if (!order.lines.length) throw new Error('Add at least one item before confirming.');
  if (announce) {
    handleVoiceResult(await postJson('/api/voice', { text: 'confirm' }));
    return;
  }
  render(await post('/api/checkout'));
}

// ---- push to talk ----
async function startMeter(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf;
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    els.level.style.width = Math.min(100, (peak / 128) * 160) + '%';
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); els.level.style.width = '0'; };
}

let pendingStop = false;
async function pttStart() {
  if (listening || starting || els.ptt.disabled) return;
  starting = true; pendingStop = false; clearError();
  try {
    const deviceId = els.mic.value || undefined;
    recorder = await createRecorder({ deviceId });
    try { meter = await startMeter(deviceId); } catch { meter = null; }
    recorder.start();
    listening = true;
    els.ptt.classList.add('listening');
    els.ptt.firstChild.textContent = 'Listening… ';
  } catch (e) {
    recorder = null;
    showError('Microphone unavailable: ' + (e.message || e.name));
  }
  starting = false;
  if (pendingStop) pttStop();
}

async function pttStop() {
  if (starting) { pendingStop = true; return; }
  if (!listening) return;
  listening = false;
  const rec = recorder; recorder = null;
  els.ptt.classList.remove('listening');
  els.ptt.classList.add('busy');
  els.ptt.firstChild.textContent = 'Working… ';
  try {
    const blob = await rec.stop();
    if (meter) { meter(); meter = null; }
    if (!blob.size) { showError('No audio captured'); return; }
    const ext = (blob.type.match(/(webm|ogg|mp4|mpeg|wav|aac)/) || [, 'webm'])[1].replace('mpeg', 'mp3');
    const fd = new FormData();
    fd.append('audio', blob, `clip.${ext}`);
    handleVoiceResult(await request('/api/voice', { method: 'POST', body: fd }));
  } catch {} finally {
    if (meter) { meter(); meter = null; }
    els.ptt.classList.remove('busy');
    els.ptt.firstChild.textContent = 'Hold to talk ';
  }
}

els.ptt.addEventListener('pointerdown', e => { e.preventDefault(); els.ptt.setPointerCapture?.(e.pointerId); pttStart(); });
els.ptt.addEventListener('pointerup', pttStop);
els.ptt.addEventListener('pointercancel', pttStop);
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault(); pttStart();
});
window.addEventListener('keyup', e => { if (e.code === 'Space' && (listening || starting)) { e.preventDefault(); pttStop(); } });
window.addEventListener('blur', pttStop);

// ---- controls ----
els.textForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = els.text.value.trim();
  if (!text) return;
  els.text.value = '';
  clearError(); sendText(text);
});
els.confirm.addEventListener('click', async () => {
  if (checkoutPending) return;
  clearError(); checkoutPending = true; els.confirm.disabled = true;
  try { await confirmOrder(); }
  catch (error) { showError(error.message || 'Could not start payment. Please try again.'); }
  finally { checkoutPending = false; els.confirm.disabled = false; }
});
els.new.addEventListener('click', async () => { clearError(); try { render(await post('/api/order/new')); els.heard.textContent = '—'; els.readback.textContent = '—'; } catch {} });
els.clear.addEventListener('click', async () => {
  clearError();
  try {
    render(await post('/api/order/clear'));
    els.heard.textContent = '—';
    els.readback.textContent = 'Order cleared.';
    els.conversation.textContent = '—';
  } catch {}
});
els.cancel.addEventListener('click', async () => {
  if (!confirm('Cancel this order?')) return;
  clearError();
  try { render(await post('/api/order/cancel')); } catch {}
});
els.pay.addEventListener('click', async () => { clearError(); try { render(await post('/api/checkout/mock-pay')); } catch {} });
els.printReceipt.addEventListener('click', () => window.print());
els.menuTab.addEventListener('click', () => setItemTab('menu'));
els.popularTab.addEventListener('click', () => setItemTab('popular'));
els.inventoryTab.addEventListener('click', () => setItemTab('inventory'));
document.querySelector('#showPopular').addEventListener('click', () => { setItemTab('popular'); document.querySelector('#menu').scrollIntoView({ behavior: 'smooth' }); });
document.querySelector('#showInventory').addEventListener('click', () => { setItemTab('inventory'); void loadInventory(); document.querySelector('#menu').scrollIntoView({ behavior: 'smooth' }); });

// Vexo owns its own Bluetooth audio path. Keep the laptop microphone as a separate fallback.
vexo = createVexo({
  onStatus(state, message) {
    vexoState = state;
    if (state === 'starting') { conversationParts = []; els.conversation.textContent = '—'; }
    els.micSource.textContent = `Vexo mic · ${state === 'ready' ? 'connected' : state}`;
    els.vexoStatus.textContent = message;
    els.vexoConnect.textContent = state === 'disconnected' ? 'Connect Vexo' : state === 'connecting' ? 'Cancel connection' : 'Disconnect Vexo';
    els.vexoStop.hidden = state !== 'recording';
    els.ptt.disabled = ['starting', 'recording', 'stopping', 'processing'].includes(state);
  },
  onError: showError,
  onConfirm: () => confirmOrder({ announce: true }),
  onConversationSegment: transcribeConversationSegment,
  onConversationEnd: finishConversation,
});
els.vexoConnect.addEventListener('click', () => {
  clearError();
  if (vexoState === 'disconnected') void vexo.connect();
  else void vexo.disconnect();
});
els.vexoStop.addEventListener('click', () => { void vexo.stopRecording(); });

// ---- mic selector ----
async function loadMics() {
  try {
    const devices = await listInputDevices();
    const saved = store.get();
    for (const d of devices) {
      const o = document.createElement('option');
      o.value = d.deviceId; o.textContent = d.label || `Microphone ${els.mic.options.length}`;
      els.mic.append(o);
    }
    if (saved && devices.some(d => d.deviceId === saved)) els.mic.value = saved;
  } catch (e) { showError('Cannot list microphones: ' + (e.message || e.name)); }
}
els.mic.addEventListener('change', () => store.set(els.mic.value));

// ---- init ----
const readyNotifications = new Set();
function updateInventory(snapshot) {
  if (!Array.isArray(snapshot?.items)) return;
  inventoryError = '';
  inventory = new Map(snapshot.items.map(item => [item.menu_id, item]));
  ingredientInventory = snapshot.ingredients || [];
  menuAvailability = madeToOrderItems(snapshot);
  renderStaffStockAlert(document.querySelector('#staffStockAlert'), snapshot);
  if (menu.length) renderMenu({ items: menu });
  if (activeItemTab === 'inventory') renderInventory();
}
async function loadInventory() {
  try { updateInventory(await request('/api/inventory', { cache: 'no-store' })); }
  catch (error) {
    inventoryError = error.message === 'network' ? 'Inventory is unavailable. Check the server and retry.' : error.message || 'Could not load inventory.';
    if (activeItemTab === 'inventory') renderInventory();
  }
}
subscribe({
  order: render,
  paid: o => { render(o); if (activeItemTab === 'popular') void loadPopularItems(); },
  inventory: updateInventory,
  order_ready: o => {
    if (!o?.id || readyNotifications.has(o.id)) return;
    readyNotifications.add(o.id);
    if (readyNotifications.size > 100) readyNotifications.delete(readyNotifications.values().next().value);
    const notice = $('readyNotice');
    notice.textContent = `Order #${String(o.id).replace(/^ord_/, '').slice(0, 6).toUpperCase()} is ready for pickup`;
    notice.hidden = false;
    vexo?.notifyOrderReady();
  },
  error: d => showError(d?.message || 'Error')
});
request('/api/health').then(h => { els.pay.hidden = h.stripe !== 'mock'; }).catch(() => {});
request('/api/order').then(render).catch(() => {});
request('/api/menu').then(renderMenu).catch(() => {});
void loadInventory();
loadMics();
