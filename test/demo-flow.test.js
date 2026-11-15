import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('demo payment and fulfillment remain consistent through SSE, retries, and restart', { timeout: 30_000 }, async t => {
  // Copy only source and the menu, never credentials or the working database.
  const workspace = await mkdtemp(join(tmpdir(), 'wristorder-demo-test-'));
  let child;
  const subscriptions = [];
  let logs = '';
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
  t.after(async () => {
    subscriptions.forEach(controller => controller.abort());
    await stop();
    await rm(workspace, { recursive: true, force: true });
  });
  await Promise.all(['src', 'public', 'package.json'].map(path => cp(join(root, path), join(workspace, path), { recursive: true })));
  await mkdir(join(workspace, 'data'));
  await cp(join(root, 'data/menu.json'), join(workspace, 'data/menu.json'));
  await symlink(join(root, 'node_modules'), join(workspace, 'node_modules'), 'dir');
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: workspace,
      env: {
        ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, REPORT_CRON: '',
        WRISTORDER_DB_PATH: join(workspace, 'data/test.db'),
        GEMINI_API_KEY: '', DEEPGRAM_API_KEY: '', STRIPE_SECRET_KEY: '', RESEND_API_KEY: '',
        MOCK_GEMINI: '1', MOCK_STT: '1', MOCK_TTS: '1', MOCK_STRIPE: '1', MOCK_EMAIL: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) assert.fail(`Server exited: ${logs}`);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      await delay(30);
    }
    assert.fail(`Server did not start: ${logs}`);
  }
  async function request(path, body, expected = 200) {
    const response = await fetch(`${base}${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
    return data;
  }
  async function assertRejected(path) {
    const response = await fetch(`${base}${path}`, { method: 'POST' });
    assert.ok([400, 404, 409].includes(response.status), `${path} should reject; got ${response.status}`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  async function subscribe() {
    const controller = new AbortController();
    subscriptions.push(controller);
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const events = [];
    void (async () => {
      let buffer = '';
      for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const type = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      }
    })().catch(error => { if (error.name !== 'AbortError') logs += `\nSSE error: ${error.message}`; });
    return { controller, events };
  }
  async function waitForEvent(events, type, id) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const event = events.find(event => event.type === type && event.data.id === id);
      if (event) return event.data;
      await delay(20);
    }
    assert.fail(`Missing ${type} event for ${id}`);
  }

  await start();
  assert.deepEqual(await request('/api/health'), { gemini: 'mock', stt: 'mock', tts: 'mock', stripe: 'mock', email: 'mock' });
  for (const page of ['demo', 'pickup', 'kitchen']) {
    const response = await fetch(`${base}/${page}`);
    assert.equal(response.status, 200, `/${page} available`);
    assert.match(await response.text(), /<html[\s>]/i);
    for (const asset of ['app.js', 'style.css']) {
      assert.equal((await fetch(`${base}/${page}/${asset}`)).status, 200, `/${page}/${asset} available`);
    }
  }
  assert.deepEqual(await request('/api/kitchen'), []);
  const startingStock = await request('/api/inventory');
  assert.equal(startingStock.items.find(item => item.menu_id === 'croissant').available, 8);
  assert.equal(startingStock.ingredients.find(item => item.ingredient === 'espresso_g').available, 1800);
  assert.equal(startingStock.ingredients.find(item => item.ingredient === 'milk_ml').available, 5000);
  assert.equal(startingStock.ingredients.find(item => item.ingredient === 'matcha_g').package_size, 30);
  assert.equal(startingStock.menu_items.length, 14);
  assert.equal(startingStock.menu_items.find(item => item.menu_id === 'ham_cheese_sandwich').available, 20);
  for (const page of ['cashier', 'kitchen']) {
    assert.match(await (await fetch(`${base}/${page}`)).text(), /id="staffStockAlert"/);
  }
  const ownerPage = await (await fetch(`${base}/owner`)).text();
  assert.match(ownerPage, /id="popular"/);
  assert.match(ownerPage, /id="inventory"/);
  const subscription = await subscribe();
  const initial = await request('/api/order');
  const emptyConfirm = await request('/api/conversation', { text: 'confirm the order' }, 400);
  assert.match(emptyConfirm.error, /empty/i);
  assert.equal((await request('/api/order')).status, 'building');
  await assertRejected(`/api/kitchen/${initial.id}/ready`);
  await assertRejected('/api/kitchen/ord_unknown/ready');
  await request('/api/voice', { text: 'one latte' });
  const cleared = await request('/api/order/clear', {});
  assert.equal(cleared.status, 'building');
  assert.deepEqual(cleared.lines, []);
  assert.equal(cleared.total_cents, 0);
  const voice = await request('/api/voice', { text: 'two lattes and a croissant' });
  assert.ok(voice.order.lines.length >= 2);
  const checkout = await request('/api/checkout', {});
  assert.equal(checkout.status, 'awaiting_payment');
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').available, 7);
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'espresso_g').reserved, 36);
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'milk_ml').available, 4600);
  await assertRejected(`/api/kitchen/${checkout.id}/ready`);
  const paid = await request('/api/checkout/mock-pay', {});
  assert.equal(paid.status, 'paid');
  const afterPaidStock = (await request('/api/inventory')).items.find(item => item.menu_id === 'croissant');
  assert.deepEqual([afterPaidStock.on_hand, afterPaidStock.reserved, afterPaidStock.available], [7, 0, 7]);
  assert.deepEqual((({ on_hand, reserved, available }) => [on_hand, reserved, available])((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'espresso_g')), [1764, 0, 1764]);
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'milk_ml').on_hand, 4600);
  await request('/api/owner/inventory/receive', { kind: 'ingredient', id: 'espresso_g', amount: 36 });
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'espresso_g').on_hand, 1800);
  const bandStock = await request('/api/conversation', { text: 'received one tin of matcha' });
  assert.equal(bandStock.actions[0].name, 'receive_stock');
  assert.match(bandStock.readback.text, /matcha/i);
  assert.equal(bandStock.order.status, 'paid', 'stock voice command does not change the customer order');
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'matcha_g').on_hand, 90);
  const micStock = await request('/api/voice', { text: 'add two bottles of oat milk to inventory' });
  assert.equal(micStock.actions[0].name, 'receive_stock');
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'oat_milk_ml').on_hand, 4000);
  const unclearStock = await request('/api/conversation', { text: 'received milk' });
  assert.match(unclearStock.readback.text, /how many/i);
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'milk_ml').on_hand, 4600);
  const mixedTurn = await request('/api/conversation', { text: 'received one tin of matcha and the customer wants a latte' });
  assert.match(mixedTurn.readback.text, /separately/i);
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'matcha_g').on_hand, 90);
  await waitForEvent(subscription.events, 'paid', paid.id);
  let kitchen = await request('/api/kitchen');
  assert.equal(kitchen.length, 1);
  assert.equal(kitchen[0].id, paid.id);
  assert.equal(kitchen[0].fulfillment_status, 'preparing');
  assert.deepEqual(kitchen[0].lines.map(line => [line.menu_id, line.qty]), paid.lines.map(line => [line.menu_id, line.qty]));
  const beforeReady = await request('/api/owner/stats?days=7');
  assert.equal(beforeReady.totals.orders, 1);
  assert.equal(beforeReady.totals.revenue_cents, paid.total_cents);
  const popular = await request('/api/popular-items?limit=2');
  assert.equal(popular[0].menu_id, 'latte');
  assert.equal(popular[0].quantity_sold, 2);
  assert.equal(beforeReady.top_items[0].menu_id, 'latte');
  assert.equal(beforeReady.top_items[0].qty, 2);

  const ready = await request(`/api/kitchen/${paid.id}/ready`, {});
  assert.equal(ready.id, paid.id);
  assert.equal(ready.fulfillment_status, 'ready');
  assert.ok(Number.isFinite(Date.parse(ready.ready_at)));
  const event = await waitForEvent(subscription.events, 'order_ready', paid.id);
  assert.equal(event.fulfillment_status, 'ready');
  assert.equal(event.ready_at, ready.ready_at);
  const repeated = await request(`/api/kitchen/${paid.id}/ready`, {});
  assert.equal(repeated.ready_at, ready.ready_at);
  await delay(50);
  assert.equal(subscription.events.filter(event => event.type === 'order_ready' && event.data.id === paid.id).length, 1);
  assert.deepEqual((await request('/api/owner/stats?days=7')).totals, beforeReady.totals);

  const fresh = await request('/api/order/new', {});
  assert.notEqual(fresh.id, paid.id);
  const seven = await request('/api/voice', { text: 'seven croissants' });
  assert.equal(seven.order.lines.find(line => line.menu_id === 'croissant').qty, 7);
  await request('/api/checkout', {});
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').available, 0);
  await assertRejected('/api/order/new');
  await request('/api/checkout/mock-expire', {});
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').available, 7);
  await request('/api/order/new', {});
  await request('/api/voice', { text: 'seven croissants' });
  await request('/api/checkout', {});
  await request('/api/order/cancel', {});
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').available, 7);
  await request('/api/order/new', {});
  const unavailable = await request('/api/voice', { text: 'eight croissants' });
  assert.deepEqual(unavailable.order.lines, []);
  assert.match(unavailable.readback.text, /croissant/i);
  assert.match(unavailable.readback.text, /available instead/i);
  await request('/api/checkout', {}, 400);
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').available, 7);
  const cancelled = await request('/api/order/cancel', {});
  await assertRejected(`/api/kitchen/${cancelled.id}/ready`);
  kitchen = await request('/api/kitchen');
  assert.equal(kitchen.length, 1);
  assert.equal(kitchen[0].fulfillment_status, 'ready');

  await request('/api/order/new', {});
  await request('/api/voice', { text: 'one blueberry muffin' });
  await request('/api/checkout', {});
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'blueberry_muffin').available, 5);

  subscription.controller.abort();
  await stop();
  await start();
  const muffinAfterRestart = (await request('/api/inventory')).items.find(item => item.menu_id === 'blueberry_muffin');
  assert.deepEqual([muffinAfterRestart.on_hand, muffinAfterRestart.reserved, muffinAfterRestart.available], [6, 0, 6], 'unpayable mock checkout releases its reservation on restart');
  kitchen = await request('/api/kitchen');
  assert.equal(kitchen.length, 1, 'paid ticket survives server restart');
  assert.equal(kitchen[0].id, paid.id);
  assert.equal(kitchen[0].fulfillment_status, 'ready');
  assert.equal(kitchen[0].ready_at, ready.ready_at);
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').on_hand, 7);
  assert.deepEqual((await request('/api/owner/stats?days=7')).totals, beforeReady.totals);
  assert.equal((await request(`/api/kitchen/${paid.id}/ready`, {})).ready_at, ready.ready_at);
  const pastryStock = await request('/api/voice', { text: 'restock five croissants' });
  assert.equal(pastryStock.actions[0].name, 'receive_stock');
  assert.equal((await request('/api/inventory')).items.find(item => item.menu_id === 'croissant').on_hand, 12);

  await request('/api/order/new', {});
  const bandConfirm = await request('/api/voice', { text: 'one latte' });
  assert.equal(bandConfirm.order.status, 'awaiting_payment');
  assert.ok(bandConfirm.order.checkout.qr_data_url);
  const repeatConfirm = await request('/api/conversation', { text: 'confirm order' });
  assert.equal(repeatConfirm.order.checkout.session_id, bandConfirm.order.checkout.session_id);
  await request('/api/checkout/mock-expire', {});

  await request('/api/order/new', {});
  const fullConversation = await request('/api/conversation', { text: 'one latte and confirm' });
  assert.equal(fullConversation.order.status, 'awaiting_payment', 'full conversations still extract items before checkout');
  await request('/api/checkout/mock-expire', {});

  await request('/api/order/new', {});
  const availableBeforeClear = (await request('/api/inventory')).ingredients.find(item => item.ingredient === 'milk_ml').available;
  await request('/api/voice', { text: 'one latte' });
  await request('/api/checkout', {});
  const clearedCheckout = await request('/api/order/clear', {});
  assert.equal(clearedCheckout.status, 'building');
  assert.deepEqual(clearedCheckout.lines, []);
  assert.equal((await request('/api/inventory')).ingredients.find(item => item.ingredient === 'milk_ml').available, availableBeforeClear);
});
