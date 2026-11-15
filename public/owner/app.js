import { money } from '/shared/format.js';
import { createRecorder } from '/shared/recorder.js';
import { subscribe } from '/shared/sse.js';
import { stockAmount, reorderAmount, stockName, stockStatus, madeToOrderItems } from '/shared/inventory.js';

let dailyChart; let itemsChart; let currentReport;
const kpis = document.querySelector('#kpis');
const ingredientBody = document.querySelector('#ingredients');
const popularBody = document.querySelector('#popular-items');
const inventoryBody = document.querySelector('#owner-inventory-items');
const menuInventoryBody = document.querySelector('#owner-menu-items');
const restockAlert = document.querySelector('#restock-alert');
const stockMessage = document.querySelector('#stock-message');
const reportBox = document.querySelector('#report');
const reportStatus = document.querySelector('#report-status');
const prettyIngredient = name => name.replace(/_(ml|g)$/, '').replaceAll('_', ' ');
const displayAmount = (value, unit) => `${value.toLocaleString()} ${unit}`;

function renderPopularItems(items) {
  popularBody.replaceChildren();
  if (!items.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No paid items in the last 7 days.';
    row.append(cell);
    popularBody.append(row);
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement('tr');
    for (const value of [`#${index + 1}`, item.name, item.qty.toLocaleString(), money(item.revenue_cents)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    popularBody.append(row);
  });
}

function renderOwnerInventory(snapshot) {
  menuInventoryBody.replaceChildren();
  for (const item of madeToOrderItems(snapshot)) {
    const row = document.createElement('tr');
    if (item.low) row.className = 'inventory-low';
    for (const [index, value] of [item.name, item.category, item.available === null ? 'Unknown' : String(item.available), stockStatus(item)].entries()) {
      const cell = document.createElement('td'); cell.textContent = value;
      if (index === 3) cell.className = `stock-state ${item.sold_out ? 'sold-out' : item.low ? 'low' : ''}`;
      row.append(cell);
    }
    menuInventoryBody.append(row);
  }
  if (!menuInventoryBody.children.length) menuInventoryBody.innerHTML = '<tr><td colspan="4">No menu availability data.</td></tr>';
  inventoryBody.replaceChildren();
  const items = [...(snapshot?.items || []).map(item => ({ ...item, label: item.name, unit: 'pcs', kind: 'item', id: item.menu_id })),
    ...(snapshot?.ingredients || []).map(item => ({ ...item, label: stockName(item), kind: 'ingredient', id: item.ingredient }))];
  if (!items.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = 'No tracked items are available.';
    row.append(cell); inventoryBody.append(row);
    return;
  }
  for (const item of items) {
    const row = document.createElement('tr');
    const low = item.available <= item.low_at;
    if (low) row.className = 'inventory-low';
    for (const [index, value] of [item.label, stockAmount(item, item.available), stockStatus(item), stockAmount(item, item.on_hand),
      stockAmount(item, item.reserved), stockAmount(item, item.low_at),
      low ? reorderAmount(item) : '—'].entries()) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      if (index === 1 && low) cell.className = 'inventory-sold-out';
      if (index === 2) cell.className = `stock-state ${item.available === 0 ? 'sold-out' : low ? 'low' : ''}`;
      row.append(cell);
    }
    const receiveCell = document.createElement('td');
    const form = document.createElement('form');
    form.className = 'receive-form';
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.step = '1'; input.required = true;
    input.setAttribute('aria-label', `Number of ${item.package_unit || item.unit} received for ${item.label}`);
    const button = document.createElement('button');
    button.type = 'submit'; button.textContent = 'Receive';
    const receiveUnit = document.createElement('small');
    receiveUnit.textContent = item.package_unit ? `${item.package_unit}s` : item.unit;
    form.append(input, receiveUnit, button);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      button.disabled = true;
      try {
        const response = await fetch('/api/owner/inventory/receive', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: item.kind, id: item.id, amount: Number(input.value) * (item.package_size || 1) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not receive stock');
        stockMessage.textContent = `Received ${stockAmount(item, Number(input.value) * (item.package_size || 1))} of ${item.label}.`;
        renderOwnerInventory(data);
      } catch (error) { stockMessage.textContent = error.message; button.disabled = false; }
    });
    receiveCell.append(form);
    row.append(receiveCell);
    inventoryBody.append(row);
  }
  const restock = snapshot?.restock || [];
  restockAlert.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = restock.length ? `Order stock for ${restock.length} low item${restock.length === 1 ? '' : 's'}` : 'Stock levels look good';
  restockAlert.append(heading);
  if (restock.length) {
    const list = document.createElement('ul');
    for (const item of restock) {
      const entry = document.createElement('li');
      entry.textContent = `${stockName(item)}: order ${reorderAmount(item)} (${stockAmount(item, item.available)} available)`;
      list.append(entry);
    }
    restockAlert.append(list);
  }
  restockAlert.classList.toggle('needs-stock', Boolean(restock.length));
}
async function loadInventory() {
  const response = await fetch('/api/inventory', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load inventory');
  renderOwnerInventory(await response.json());
}

function renderStats(stats) {
  const top = stats.top_items[0];
  renderPopularItems(stats.top_items);
  const thisWeek = stats.daily.slice(-7).reduce((sum, day) => sum + day.orders, 0);
  kpis.innerHTML = [['Orders this week', thisWeek], ['Revenue, 28 days', money(stats.totals.revenue_cents)], ['Average ticket', money(stats.totals.avg_ticket_cents)], ['Top dish', top ? `${top.name} (${top.qty})` : 'No sales yet']].map(([label, value]) => `<article class="panel"><div class="small">${label}</div><div class="total">${value}</div></article>`).join('');
  ingredientBody.innerHTML = stats.ingredients.map(row => { const suggestion = stats.restock_suggestion.find(item => item.ingredient === row.ingredient); return `<tr><td>${prettyIngredient(row.ingredient)}</td><td>${displayAmount(row.this_week, row.unit)}</td><td>${displayAmount(row.last_week, row.unit)}</td><td>${suggestion ? displayAmount(suggestion.suggested_next_week, row.unit) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="4">No paid orders yet. Run npm run seed to load demo data.</td></tr>';
  dailyChart?.destroy(); dailyChart = new Chart(document.querySelector('#daily-chart'), { type: 'bar', data: { labels: stats.daily.map(day => day.date.slice(5)), datasets: [{ label: 'Orders', data: stats.daily.map(day => day.orders), backgroundColor: '#65e6a1' }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  itemsChart?.destroy(); itemsChart = new Chart(document.querySelector('#items-chart'), { type: 'bar', data: { labels: stats.top_items.slice(0, 6).map(item => item.name), datasets: [{ label: 'Sold', data: stats.top_items.slice(0, 6).map(item => item.qty), backgroundColor: '#79b8ff' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } } });
}
async function loadStats() { const response = await fetch('/api/owner/stats?days=28'); if (!response.ok) throw new Error('Could not load owner statistics'); renderStats(await response.json()); }
function showReport(report) { currentReport = report; reportBox.textContent = report.summary_markdown; reportStatus.textContent = `Reporting period: ${report.period}`; }
async function createReport() { reportStatus.textContent = 'Generating report…'; const response = await fetch('/api/owner/report'); const data = await response.json(); if (!response.ok) throw new Error(data.error); showReport(data); }
document.querySelector('#generate').addEventListener('click', () => createReport().catch(error => { reportStatus.textContent = error.message; }));
document.querySelector('#send').addEventListener('click', async () => { try { if (!currentReport) await createReport(); reportStatus.textContent = 'Sending report…'; const response = await fetch('/api/owner/report/send', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); showReport({ ...currentReport, summary_markdown: data.summary_markdown }); reportStatus.textContent = data.mocked ? 'Mock email logged by the server.' : `Report sent to ${data.to}.`; } catch (error) { reportStatus.textContent = error.message; } });
async function ask(body, options = {}) { const answer = document.querySelector('#answer'); answer.textContent = 'Thinking…'; try { const response = await fetch('/api/owner/ask', { method: 'POST', ...options, body }); const data = await response.json(); if (!response.ok) throw new Error(data.error); answer.textContent = data.answer; if (data.audio_url) new Audio(data.audio_url).play().catch(() => {}); } catch (error) { answer.textContent = error.message; } }
document.querySelector('#ask-form').addEventListener('submit', event => { event.preventDefault(); const question = document.querySelector('#question'); ask(JSON.stringify({ text: question.value }), { headers: { 'content-type': 'application/json' } }); question.value = ''; });
const askMic = document.querySelector('#ask-mic'); let recorder; let holding = false;
askMic.addEventListener('pointerdown', async event => { event.preventDefault(); holding = true; try { const created = await createRecorder(); if (!holding) { created.start(); await created.stop(); return; } recorder = created; recorder.start(); askMic.textContent = 'Listening… release to ask'; askMic.classList.add('primary'); } catch (error) { document.querySelector('#answer').textContent = `Microphone unavailable: ${error.message}`; } });
async function stopRecording() { holding = false; if (!recorder) return; const active = recorder; recorder = null; askMic.textContent = '🎙 Hold to ask'; askMic.classList.remove('primary'); const audio = await active.stop(); const body = new FormData(); body.append('audio', audio, 'owner-question.webm'); await ask(body); }
askMic.addEventListener('pointerup', stopRecording); askMic.addEventListener('pointerleave', stopRecording);
loadStats().catch(error => { kpis.innerHTML = `<article class="panel">${error.message}</article>`; });
const ownerEvents = subscribe({
  order_saved: () => { void loadStats().catch(() => {}); },
  inventory: renderOwnerInventory,
});
ownerEvents.onopen = () => {
  void loadStats().catch(() => {});
  void loadInventory().catch(() => {});
};
void loadInventory().catch(error => { inventoryBody.textContent = error.message; });
