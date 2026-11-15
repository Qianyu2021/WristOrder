import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { stockAmount, reorderAmount, stockStatus } from '../public/shared/inventory.js';

test('pastry stock reserves, releases, and commits once with a paid order', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wristorder-inventory-'));
  const path = join(directory, 'test.db');
  const previous = process.env.WRISTORDER_DB_PATH;
  process.env.WRISTORDER_DB_PATH = path;
  const { default: db, inventorySnapshot, assertStockAvailable, reserveStock,
    releaseStock, consumeStock, receiveStock, saveOrder, savePendingCheckout, pendingCheckouts,
    clearPendingCheckout } = await import('../src/db.js');
  const line = { line_id: 1, menu_id: 'croissant', name: 'Croissant', qty: 1,
    modifiers: [], unit_price_cents: 325, line_total_cents: 325 };
  const order = id => ({ id, status: 'building', total_cents: 325,
    created_at: '2026-11-14T17:00:00.000Z', paid_at: null, lines: [{ ...line }] });
  try {
    const stock = () => inventorySnapshot().items.find(item => item.menu_id === 'croissant');
    const menuItem = id => inventorySnapshot().menu_items.find(item => item.menu_id === id);
    assert.deepEqual([stock().on_hand, stock().reserved, stock().available], [8, 0, 8]);
    assert.deepEqual([menuItem('latte').available, menuItem('matcha_latte').available,
      menuItem('ham_cheese_sandwich').available, menuItem('avocado_toast').available], [25, 20, 20, 20]);
    assert.equal(stockStatus(menuItem('latte')), 'In stock');
    assert.deepEqual(inventorySnapshot().ingredients.filter(item => ['milk_ml', 'oat_milk_ml', 'matcha_g'].includes(item.ingredient))
      .map(item => [item.ingredient, item.on_hand, item.package_size]),
      [['matcha_g', 60, 30], ['milk_ml', 5000, 1000], ['oat_milk_ml', 2000, 1000]]);
    assert.equal(reserveStock(order('ord_cancel')).changed, true);
    assert.equal(reserveStock(order('ord_cancel')).changed, false);
    const cancelledPending = { ...order('ord_cancel'), status: 'awaiting_payment', checkout: { session_id: 'sess_cancel' } };
    assert.equal(savePendingCheckout(cancelledPending, 'sess_cancel').changed, true);
    assert.equal(savePendingCheckout(cancelledPending, 'sess_cancel').changed, false);
    assert.deepEqual(pendingCheckouts(), [{ order: cancelledPending, session_id: 'sess_cancel' }]);
    assert.throws(() => savePendingCheckout({ ...cancelledPending, checkout: { session_id: 'other' } }, 'other'),
      error => error.status === 409);
    assert.deepEqual([stock().on_hand, stock().reserved, stock().available], [8, 1, 7]);
    assert.equal(releaseStock('ord_cancel').changed, true);
    assert.equal(releaseStock('ord_cancel').changed, false);
    assert.deepEqual(pendingCheckouts(), [], 'cancellation clears the pending checkout with its reservation');
    assert.deepEqual([stock().on_hand, stock().reserved, stock().available], [8, 0, 8]);

    assert.throws(() => reserveStock({ ...order('ord_too_many'), lines: [{ ...line, qty: 9 }] }),
      error => error.status === 409 && /croissant/i.test(error.message));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id = 'ord_too_many'").get().n, 0);
    const muffin = { ...line, line_id: 2, menu_id: 'blueberry_muffin', name: 'Blueberry Muffin', qty: 7 };
    assert.throws(() => reserveStock({ ...order('ord_partial'), lines: [{ ...line, qty: 8 }, muffin] }),
      error => error.status === 409 && /muffin/i.test(error.message));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id = 'ord_partial'").get().n, 0,
      'failure on the second item cannot keep a partial reservation');
    assertStockAvailable([{ ...line, qty: 8 }]);

    const awaiting = order('ord_paid');
    reserveStock(awaiting);
    const paidPending = { ...awaiting, status: 'awaiting_payment', checkout: { session_id: 'sess_paid' } };
    savePendingCheckout(paidPending, 'sess_paid');
    assert.equal(pendingCheckouts().length, 1);
    const paid = { ...awaiting, status: 'paid', paid_at: '2026-11-14T17:02:00.000Z' };
    saveOrder(paid, { enqueue: true });
    assert.deepEqual(pendingCheckouts(), [], 'paid save clears pending checkout atomically');
    assert.deepEqual([stock().on_hand, stock().reserved, stock().available], [7, 0, 7]);
    saveOrder(paid, { enqueue: true });
    assert.equal(consumeStock(paid.id).changed, false);
    assert.equal(stock().on_hand, 7);
    const reopened = new Database(path, { readonly: true });
    try {
      assert.equal(reopened.prepare('SELECT on_hand FROM inventory_stock WHERE menu_id = ?').get('croissant').on_hand, 7);
      assert.equal(reopened.prepare('SELECT state FROM inventory_reservations WHERE order_id = ?').get(paid.id).state, 'consumed');
    } finally { reopened.close(); }
    assert.throws(() => saveOrder({ ...paid, id: 'ord_unreserved' }, { enqueue: true }), /reservation/);
    assert.equal(stock().on_hand, 7);

    db.prepare('UPDATE inventory_stock SET on_hand = 1 WHERE menu_id = ?').run('croissant');
    const last = order('ord_last');
    reserveStock(last);
    const lastPaid = { ...last, status: 'paid', paid_at: '2026-11-14T17:03:00.000Z' };
    saveOrder(lastPaid, { enqueue: true });
    saveOrder(lastPaid, { enqueue: true });
    assert.deepEqual([stock().on_hand, stock().reserved, stock().available], [0, 0, 0]);
    assert.equal(menuItem('croissant').sold_out, true);
    assert.throws(() => reserveStock(order('ord_after_sellout')), error => error.status === 409);
    assert.equal(clearPendingCheckout('ord_missing').changed, false);

    const latteLine = { line_id: 1, menu_id: 'latte', name: 'Latte', qty: 1,
      modifiers: ['oat_milk'], unit_price_cents: 500, line_total_cents: 500 };
    const latte = { ...order('ord_latte'), total_cents: 500, lines: [latteLine] };
    db.prepare('UPDATE ingredient_stock SET on_hand = 18 WHERE ingredient = ?').run('espresso_g');
    assert.equal(reserveStock(latte).changed, true);
    const ingredient = name => inventorySnapshot().ingredients.find(item => item.ingredient === name);
    assert.deepEqual([ingredient('espresso_g').on_hand, ingredient('espresso_g').reserved, ingredient('espresso_g').available], [18, 18, 0]);
    assert.equal(ingredient('milk_ml').reserved, 0, 'oat milk replaces dairy milk');
    assert.equal(ingredient('oat_milk_ml').reserved, 200);
    assert.ok(inventorySnapshot().restock.some(item => item.name === 'espresso_g' && item.order_amount === 1800));
    assert.throws(() => reserveStock({ ...latte, id: 'ord_no_espresso' }), error => error.status === 409 && /espresso/i.test(error.message));
    releaseStock(latte.id);
    assert.equal(ingredient('espresso_g').available, 18);
    reserveStock({ ...latte, id: 'ord_latte_paid' });
    const paidLatte = { ...latte, id: 'ord_latte_paid', status: 'paid', paid_at: '2026-11-14T17:04:00.000Z' };
    saveOrder(paidLatte, { enqueue: true });
    saveOrder(paidLatte, { enqueue: true });
    assert.deepEqual([ingredient('espresso_g').on_hand, ingredient('espresso_g').reserved, ingredient('espresso_g').available], [0, 0, 0]);
    assert.equal(ingredient('oat_milk_ml').on_hand, 1800);
    assert.throws(() => receiveStock('ingredient', 'espresso_g', -1), error => error.status === 400);
    assert.throws(() => receiveStock('ingredient', 'missing', 1), error => error.status === 404);
    receiveStock('ingredient', 'espresso_g', 500);
    assert.equal(ingredient('espresso_g').on_hand, 500);
    assert.ok(!inventorySnapshot().restock.some(item => item.name === 'espresso_g'));

    const matchaLine = { line_id: 1, menu_id: 'matcha_latte', name: 'Matcha Latte', qty: 10,
      modifiers: [], unit_price_cents: 500, line_total_cents: 5000 };
    for (const [id, remainingMatcha, remainingMilk] of [['ord_matcha_1', 30, 3000], ['ord_matcha_2', 0, 1000]]) {
      const matchaOrder = { ...order(id), total_cents: 5000, lines: [matchaLine] };
      reserveStock(matchaOrder);
      assert.equal(ingredient('matcha_g').available, remainingMatcha);
      assert.equal(menuItem('matcha_latte').available, remainingMatcha / 3);
      assert.equal(stockStatus(menuItem('matcha_latte')), remainingMatcha ? 'Low' : 'Sold out');
      saveOrder({ ...matchaOrder, status: 'paid', paid_at: '2026-11-14T17:05:00.000Z' }, { enqueue: true });
      assert.equal(ingredient('matcha_g').on_hand, remainingMatcha);
      assert.equal(ingredient('milk_ml').on_hand, remainingMilk);
    }
    assert.ok(inventorySnapshot().restock.some(item => item.name === 'Matcha powder' && item.order_amount === 60));
    assert.equal(menuItem('matcha_latte').sold_out, true);
    assert.ok(inventorySnapshot().restock.some(item => item.name === 'Whole milk' && item.order_amount === 4000));
    assert.match(stockAmount(ingredient('milk_ml'), ingredient('milk_ml').available), /1 L bottle/);
    assert.match(reorderAmount(inventorySnapshot().restock.find(item => item.name === 'Whole milk')), /4.*1 L bottle/);
    assert.throws(() => reserveStock({ ...order('ord_matcha_sold_out'), lines: [matchaLine] }),
      error => error.status === 409 && /matcha/i.test(error.message));
  } finally {
    db.close();
    if (previous === undefined) delete process.env.WRISTORDER_DB_PATH;
    else process.env.WRISTORDER_DB_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
