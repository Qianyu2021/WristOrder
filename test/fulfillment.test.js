import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

test('paid kitchen tickets persist, exclude history, and transition to ready exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wristorder-fulfillment-'));
  const databasePath = join(directory, 'test.db');
  const previousPath = process.env.WRISTORDER_DB_PATH;
  process.env.WRISTORDER_DB_PATH = databasePath;
  const { default: db, saveOrder, reserveStock, kitchenOrders, markOrderReady, clearAllOrders } = await import('../src/db.js');
  try {
    const paid = {
      id: 'ord_test1234', status: 'paid', total_cents: 500,
      created_at: '2026-11-14T16:00:00.000Z', paid_at: '2026-11-14T16:00:02.000Z',
      lines: [{ line_id: 1, menu_id: 'latte', name: 'Latte', qty: 1, modifiers: ['oat_milk'], unit_price_cents: 500, line_total_cents: 500 }]
    };
    saveOrder({ ...paid, id: 'ord_seeded' });
    assert.deepEqual(kitchenOrders(), [], 'historical seed orders must not appear in the kitchen');
    reserveStock(paid);
    saveOrder(paid, { enqueue: true });
    assert.equal(kitchenOrders().length, 1);
    assert.equal(kitchenOrders()[0].fulfillment_status, 'preparing');
    assert.deepEqual(kitchenOrders()[0].lines[0].modifier_names, ['Oat milk']);
    const first = markOrderReady(paid.id);
    assert.equal(first.changed, true);
    assert.equal(first.order.status, 'paid');
    assert.equal(first.order.fulfillment_status, 'ready');
    assert.ok(first.order.ready_at);
    const repeated = markOrderReady(paid.id);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.order.ready_at, first.order.ready_at);
    saveOrder(paid, { enqueue: true });
    assert.equal(kitchenOrders().length, 1, 'duplicate paid notifications must not create extra tickets');
    assert.equal(kitchenOrders()[0].ready_at, first.order.ready_at, 'duplicate save must not reset readiness');
    const reopened = new Database(databasePath, { readonly: true });
    try { assert.equal(reopened.prepare('SELECT ready_at FROM order_fulfillment WHERE order_id = ?').get(paid.id).ready_at, first.order.ready_at); }
    finally { reopened.close(); }
    assert.throws(() => markOrderReady('ord_missing'), error => error.status === 404);
    assert.throws(() => markOrderReady('ord_seeded'), error => error.status === 404);
    assert.throws(() => saveOrder({ ...paid, status: 'building' }, { enqueue: true }), /Only paid orders/);
    db.prepare("UPDATE orders SET status = 'building' WHERE id = ?").run(paid.id);
    assert.throws(() => markOrderReady(paid.id), error => error.status === 409);
    clearAllOrders();
    assert.deepEqual(kitchenOrders(), []);
  } finally {
    db.close();
    if (previousPath === undefined) delete process.env.WRISTORDER_DB_PATH;
    else process.env.WRISTORDER_DB_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
