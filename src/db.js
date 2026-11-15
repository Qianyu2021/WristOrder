import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getMenu, ingredientsForLine } from './menu.js';

const databasePath = process.env.WRISTORDER_DB_PATH || new URL('../data/wristorder.db', import.meta.url).pathname;
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    paid_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    line_id INTEGER NOT NULL,
    menu_id TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    modifiers_json TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS orders_paid_at ON orders(paid_at);
  CREATE INDEX IF NOT EXISTS order_lines_order_id ON order_lines(order_id);
  CREATE INDEX IF NOT EXISTS order_lines_menu_id ON order_lines(menu_id);
  CREATE TABLE IF NOT EXISTS order_fulfillment (
    order_id TEXT PRIMARY KEY REFERENCES orders(id),
    ready_at TEXT
  );
  CREATE TABLE IF NOT EXISTS inventory_stock (
    menu_id TEXT PRIMARY KEY,
    on_hand INTEGER NOT NULL CHECK (on_hand >= 0)
  );
  CREATE TABLE IF NOT EXISTS inventory_reservations (
    order_id TEXT NOT NULL,
    menu_id TEXT NOT NULL REFERENCES inventory_stock(menu_id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
    PRIMARY KEY (order_id, menu_id)
  );
  CREATE INDEX IF NOT EXISTS inventory_reservations_active ON inventory_reservations(menu_id, state);
  CREATE TABLE IF NOT EXISTS ingredient_stock (
    ingredient TEXT PRIMARY KEY,
    on_hand REAL NOT NULL CHECK (on_hand >= 0),
    low_at REAL NOT NULL CHECK (low_at >= 0),
    target REAL NOT NULL CHECK (target >= low_at)
  );
  CREATE TABLE IF NOT EXISTS ingredient_reservations (
    order_id TEXT NOT NULL,
    ingredient TEXT NOT NULL REFERENCES ingredient_stock(ingredient),
    amount REAL NOT NULL CHECK (amount > 0),
    state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
    PRIMARY KEY (order_id, ingredient)
  );
  CREATE INDEX IF NOT EXISTS ingredient_reservations_active ON ingredient_reservations(ingredient, state);
  CREATE TABLE IF NOT EXISTS pending_checkouts (
    order_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    order_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Initial demo stock is additive: opening an existing database never resets it.
const startingStock = { croissant: 8, blueberry_muffin: 6, banana_bread: 5 };
const insertStock = db.prepare('INSERT OR IGNORE INTO inventory_stock (menu_id, on_hand) VALUES (?, ?)');
for (const [menuId, count] of Object.entries(startingStock)) insertStock.run(menuId, count);
// Demo starting quantities are inserted once; existing stock is never reset on restart.
const startingIngredients = {
  espresso_g: [1800, 360], milk_ml: [5000, 1000], oat_milk_ml: [2000, 1000],
  water_ml: [20000, 2000], chai_ml: [3600, 720], matcha_g: [60, 30],
  tea_g: [160, 32], chocolate_g: [1000, 200], cup: [100, 20],
  bread_slice: [40, 8], ham_g: [1400, 280], cheese_g: [600, 120], avocado_g: [1600, 320]
};
const packagedIngredients = {
  milk_ml: { label: 'Whole milk', package_size: 1000, package_unit: '1 L bottle' },
  oat_milk_ml: { label: 'Oat milk', package_size: 1000, package_unit: '1 L bottle' },
  matcha_g: { label: 'Matcha powder', package_size: 30, package_unit: '30 g tin' }
};
const insertIngredient = db.prepare('INSERT OR IGNORE INTO ingredient_stock (ingredient, on_hand, low_at, target) VALUES (?, ?, ?, ?)');
for (const [ingredient, [target, lowAt]] of Object.entries(startingIngredients)) {
  insertIngredient.run(ingredient, target, lowAt, target);
}

const reservedQuantity = db.prepare(`SELECT COALESCE(SUM(qty), 0) AS qty FROM inventory_reservations
  WHERE menu_id = ? AND state = 'reserved' AND (? IS NULL OR order_id <> ?)`);
const stockRows = db.prepare(`SELECT menu_id, on_hand FROM inventory_stock ORDER BY menu_id`);
const reservationRows = db.prepare('SELECT menu_id, qty, state FROM inventory_reservations WHERE order_id = ? ORDER BY menu_id');
const insertReservation = db.prepare("INSERT INTO inventory_reservations (order_id, menu_id, qty, state) VALUES (?, ?, ?, 'reserved')");
const releaseReservation = db.prepare("UPDATE inventory_reservations SET state = 'released' WHERE order_id = ? AND state = 'reserved'");
const consumeReservation = db.prepare("UPDATE inventory_reservations SET state = 'consumed' WHERE order_id = ? AND menu_id = ? AND state = 'reserved'");
const deductStock = db.prepare('UPDATE inventory_stock SET on_hand = on_hand - ? WHERE menu_id = ? AND on_hand >= ?');
const pendingRow = db.prepare('SELECT session_id, order_json FROM pending_checkouts WHERE order_id = ?');
const deletePending = db.prepare('DELETE FROM pending_checkouts WHERE order_id = ?');
const ingredientRows = db.prepare('SELECT ingredient, on_hand, low_at, target FROM ingredient_stock ORDER BY ingredient');
const ingredientReservationRows = db.prepare('SELECT ingredient, amount, state FROM ingredient_reservations WHERE order_id = ? ORDER BY ingredient');
const reservedIngredient = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS amount FROM ingredient_reservations
  WHERE ingredient = ? AND state = 'reserved' AND (? IS NULL OR order_id <> ?)`);
const insertIngredientReservation = db.prepare("INSERT INTO ingredient_reservations (order_id, ingredient, amount, state) VALUES (?, ?, ?, 'reserved')");
const releaseIngredientReservation = db.prepare("UPDATE ingredient_reservations SET state = 'released' WHERE order_id = ? AND state = 'reserved'");
const consumeIngredientReservation = db.prepare("UPDATE ingredient_reservations SET state = 'consumed' WHERE order_id = ? AND ingredient = ? AND state = 'reserved'");
const deductIngredient = db.prepare('UPDATE ingredient_stock SET on_hand = on_hand - ? WHERE ingredient = ? AND on_hand >= ?');

export function savePendingCheckout(order, sessionId) {
  if (!order?.id || order.status !== 'awaiting_payment' ||
      !sessionId || order.checkout?.session_id !== sessionId) {
    throw new Error('An awaiting-payment order and matching checkout session are required');
  }
  return db.transaction(() => {
    const existing = pendingRow.get(order.id);
    if (existing && existing.session_id !== sessionId) {
      const error = new Error('This order already has a different pending checkout');
      error.status = 409;
      throw error;
    }
    db.prepare(`INSERT INTO pending_checkouts (order_id, session_id, order_json, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET order_json = excluded.order_json`)
      .run(order.id, sessionId, JSON.stringify(order), new Date().toISOString());
    return { changed: !existing };
  })();
}

export function pendingCheckouts() {
  return db.prepare('SELECT session_id, order_json FROM pending_checkouts ORDER BY created_at').all()
    .map(row => ({ order: JSON.parse(row.order_json), session_id: row.session_id }));
}

export function clearPendingCheckout(orderId) {
  return { changed: deletePending.run(orderId).changes > 0 };
}

function trackedQuantities(lines) {
  const tracked = new Set(stockRows.all().map(row => row.menu_id));
  const quantities = new Map();
  for (const line of lines || []) {
    if (!tracked.has(line.menu_id)) continue;
    if (!Number.isInteger(line.qty) || line.qty <= 0) throw new Error('Inventory quantity must be a positive integer');
    quantities.set(line.menu_id, (quantities.get(line.menu_id) || 0) + line.qty);
  }
  return quantities;
}

function ingredientQuantities(lines) {
  const tracked = new Set(ingredientRows.all().map(row => row.ingredient));
  const quantities = new Map();
  for (const line of lines || []) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) throw new Error('Inventory quantity must be a positive integer');
    for (const [ingredient, amount] of Object.entries(ingredientsForLine(line))) {
      // Some modifiers replace an ingredient; a recipe cannot return stock to inventory.
      if (tracked.has(ingredient) && amount > 0) quantities.set(ingredient, (quantities.get(ingredient) || 0) + amount);
    }
  }
  return quantities;
}

export function inventorySnapshot() {
  const names = new Map(getMenu().items.map(item => [item.id, item.name]));
  const items = stockRows.all().map(row => {
    const reserved = reservedQuantity.get(row.menu_id, null, null).qty;
    return { menu_id: row.menu_id, name: names.get(row.menu_id) || row.menu_id,
      on_hand: row.on_hand, reserved, available: row.on_hand - reserved, tracked: true,
      low_at: 2, target: startingStock[row.menu_id] || row.on_hand };
  });
  const units = getMenu().ingredient_units;
  const ingredients = ingredientRows.all().map(row => {
    const reserved = reservedIngredient.get(row.ingredient, null, null).amount;
    const available = row.on_hand - reserved;
    return { ...row, ...(packagedIngredients[row.ingredient] || {}), unit: units[row.ingredient] || 'units', reserved, available,
      low: available <= row.low_at, order_amount: available <= row.low_at ? Math.max(0, row.target - available) : 0 };
  });
  const itemStock = new Map(items.map(item => [item.menu_id, item]));
  const ingredientStock = new Map(ingredients.map(item => [item.ingredient, item]));
  const menu_items = getMenu().items.map(menuItem => {
    const stockedItem = itemStock.get(menuItem.id);
    const recipeStock = Object.entries(menuItem.ingredients)
      .filter(([, amount]) => amount > 0)
      .map(([ingredient, amount]) => ({ row: ingredientStock.get(ingredient), amount }))
      .filter(entry => entry.row);
    const limits = [
      ...(stockedItem ? [stockedItem.available] : []),
      ...recipeStock.map(({ row, amount }) => Math.floor(row.available / amount))
    ];
    const available = limits.length ? Math.max(0, Math.min(...limits)) : null;
    const low = (available !== null && available <= 2) ||
      Boolean(stockedItem && stockedItem.available <= stockedItem.low_at) ||
      recipeStock.some(({ row }) => row.low);
    return { menu_id: menuItem.id, name: menuItem.name, category: menuItem.category,
      available, low, sold_out: available === 0 };
  });
  const restock = [
    ...items.filter(item => item.available <= item.low_at).map(item => ({ name: item.name, unit: 'pcs', available: item.available, order_amount: Math.max(0, item.target - item.available) })),
    ...ingredients.filter(item => item.low).map(item => ({ name: item.label || item.ingredient, unit: item.unit,
      package_size: item.package_size, package_unit: item.package_unit, available: item.available, order_amount: item.order_amount }))
  ];
  return { items, ingredients, menu_items, restock };
}

export function receiveStock(kind, id, amount) {
  if (!['item', 'ingredient'].includes(kind) || typeof id !== 'string' ||
      !Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) {
    const error = new Error('A valid stock item and positive whole-number quantity are required');
    error.status = 400;
    throw error;
  }
  const table = kind === 'item' ? 'inventory_stock' : 'ingredient_stock';
  const key = kind === 'item' ? 'menu_id' : 'ingredient';
  const result = db.prepare(`UPDATE ${table} SET on_hand = on_hand + ? WHERE ${key} = ?`).run(amount, id);
  if (!result.changes) {
    const error = new Error('Stock item not found');
    error.status = 404;
    throw error;
  }
  return inventorySnapshot();
}

export function assertStockAvailable(lines, excludingOrderId = null) {
  const quantities = trackedQuantities(lines);
  for (const [menuId, qty] of quantities) {
    const onHand = db.prepare('SELECT on_hand FROM inventory_stock WHERE menu_id = ?').get(menuId).on_hand;
    const reserved = reservedQuantity.get(menuId, excludingOrderId, excludingOrderId).qty;
    if (qty > onHand - reserved) {
      const name = getMenu().items.find(item => item.id === menuId)?.name || menuId;
      const error = new Error(`${name} is sold out or has only ${Math.max(0, onHand - reserved)} left`);
      error.status = 409;
      error.menu_id = menuId;
      throw error;
    }
  }
  for (const [ingredient, amount] of ingredientQuantities(lines)) {
    const onHand = db.prepare('SELECT on_hand FROM ingredient_stock WHERE ingredient = ?').get(ingredient).on_hand;
    const reserved = reservedIngredient.get(ingredient, excludingOrderId, excludingOrderId).amount;
    if (amount > onHand - reserved) {
      const error = new Error(`${ingredient.replaceAll('_', ' ')} is low: ${Math.max(0, onHand - reserved)} available`);
      error.status = 409;
      error.ingredient = ingredient;
      throw error;
    }
  }
  return true;
}

export function reserveStock(order) {
  if (!order?.id) throw new Error('An order ID is required to reserve stock');
  return db.transaction(() => {
    const quantities = trackedQuantities(order.lines);
    const ingredients = ingredientQuantities(order.lines);
    const previous = reservationRows.all(order.id);
    const previousIngredients = ingredientReservationRows.all(order.id);
    if (previous.length || previousIngredients.length) {
      const same = previous.length === quantities.size && previous.every(row => quantities.get(row.menu_id) === row.qty);
      const sameIngredients = previousIngredients.length === ingredients.size && previousIngredients.every(row => ingredients.get(row.ingredient) === row.amount);
      if (!same || !sameIngredients) { const error = new Error('This order already has a different stock reservation'); error.status = 409; throw error; }
      if (previous.some(row => row.state !== 'reserved') || previousIngredients.some(row => row.state !== 'reserved')) {
        const error = new Error('This order no longer has an active stock reservation');
        error.status = 409;
        throw error;
      }
      return { changed: false, inventory: inventorySnapshot() };
    }
    assertStockAvailable(order.lines);
    for (const [menuId, qty] of quantities) insertReservation.run(order.id, menuId, qty);
    for (const [ingredient, amount] of ingredients) insertIngredientReservation.run(order.id, ingredient, amount);
    return { changed: quantities.size > 0 || ingredients.size > 0, inventory: inventorySnapshot() };
  })();
}

export function releaseStock(orderId) {
  return db.transaction(() => {
    const changed = releaseReservation.run(orderId).changes > 0;
    const ingredientChanged = releaseIngredientReservation.run(orderId).changes > 0;
    deletePending.run(orderId);
    return { changed: changed || ingredientChanged, inventory: inventorySnapshot() };
  })();
}

function consumeStockWithinTransaction(orderId) {
  const rows = reservationRows.all(orderId).filter(row => row.state === 'reserved');
  for (const row of rows) {
    if (deductStock.run(row.qty, row.menu_id, row.qty).changes !== 1) {
      const error = new Error(`Stock for ${row.menu_id} changed while payment was pending`);
      error.status = 409;
      throw error;
    }
    consumeReservation.run(orderId, row.menu_id);
  }
  const ingredients = ingredientReservationRows.all(orderId).filter(row => row.state === 'reserved');
  for (const row of ingredients) {
    if (deductIngredient.run(row.amount, row.ingredient, row.amount).changes !== 1) {
      const error = new Error(`Stock for ${row.ingredient} changed while payment was pending`);
      error.status = 409;
      throw error;
    }
    consumeIngredientReservation.run(orderId, row.ingredient);
  }
  return rows.length > 0 || ingredients.length > 0;
}

export function consumeStock(orderId) {
  return db.transaction(() => ({ changed: consumeStockWithinTransaction(orderId), inventory: inventorySnapshot() }))();
}

const insertOrder = db.prepare(`INSERT INTO orders (id, status, total_cents, created_at, paid_at) VALUES (@id, @status, @total_cents, @created_at, @paid_at)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status, total_cents=excluded.total_cents, created_at=excluded.created_at, paid_at=excluded.paid_at`);
const deleteLines = db.prepare('DELETE FROM order_lines WHERE order_id = ?');
const insertLine = db.prepare(`INSERT INTO order_lines (order_id, line_id, menu_id, name, qty, modifiers_json, unit_price_cents, line_total_cents)
  VALUES (@order_id, @line_id, @menu_id, @name, @qty, @modifiers_json, @unit_price_cents, @line_total_cents)`);

export function saveOrder(order, { enqueue = false } = {}) {
  if (!order?.paid_at || order.status !== 'paid') throw new Error('Only paid orders can be saved');
  db.transaction(() => {
    if (enqueue) {
      const quantities = trackedQuantities(order.lines);
      const ingredients = ingredientQuantities(order.lines);
      const reservations = reservationRows.all(order.id);
      const ingredientReservations = ingredientReservationRows.all(order.id);
      if (quantities.size && (reservations.length !== quantities.size ||
          reservations.some(row => quantities.get(row.menu_id) !== row.qty || row.state === 'released'))) {
        throw new Error('Paid order has no matching stock reservation');
      }
      if (ingredients.size && (ingredientReservations.length !== ingredients.size ||
          ingredientReservations.some(row => ingredients.get(row.ingredient) !== row.amount || row.state === 'released'))) {
        throw new Error('Paid order has no matching ingredient reservation');
      }
      consumeStockWithinTransaction(order.id);
      deletePending.run(order.id);
    }
    insertOrder.run(order);
    deleteLines.run(order.id);
    for (const line of order.lines) insertLine.run({ ...line, order_id: order.id, modifiers_json: JSON.stringify(line.modifiers || []) });
    if (enqueue) db.prepare('INSERT OR IGNORE INTO order_fulfillment (order_id) VALUES (?)').run(order.id);
  })();
}

function kitchenOrder(row) {
  if (!row) return null;
  const modifiers = new Map(getMenu().modifiers.map(modifier => [modifier.id, modifier.name]));
  const lines = db.prepare('SELECT line_id, menu_id, name, qty, modifiers_json, unit_price_cents, line_total_cents FROM order_lines WHERE order_id = ? ORDER BY line_id').all(row.id)
    .map(({ modifiers_json, ...line }) => {
      const ids = JSON.parse(modifiers_json);
      return { ...line, modifiers: ids, modifier_names: ids.map(id => modifiers.get(id) || id) };
    });
  return { ...row, fulfillment_status: row.ready_at ? 'ready' : 'preparing', lines };
}

export function kitchenOrders(limit = 50) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  return db.prepare(`SELECT o.*, f.ready_at FROM orders o JOIN order_fulfillment f ON f.order_id = o.id
    WHERE o.status = 'paid' ORDER BY (f.ready_at IS NULL) DESC, o.paid_at DESC LIMIT ?`).all(safeLimit).map(kitchenOrder);
}

export function markOrderReady(orderId) {
  return db.transaction(() => {
    const row = db.prepare(`SELECT o.*, f.ready_at FROM orders o JOIN order_fulfillment f ON f.order_id = o.id WHERE o.id = ?`).get(orderId);
    if (!row) { const error = new Error('Paid kitchen ticket not found'); error.status = 404; throw error; }
    if (row.status !== 'paid') { const error = new Error('Only paid orders can be marked ready'); error.status = 409; throw error; }
    const changed = !row.ready_at;
    if (changed) {
      row.ready_at = new Date().toISOString();
      db.prepare('UPDATE order_fulfillment SET ready_at = ? WHERE order_id = ? AND ready_at IS NULL').run(row.ready_at, orderId);
    }
    return { order: kitchenOrder(row), changed };
  })();
}

export function paidOrdersBetween(from, to) {
  return db.prepare(`SELECT id, total_cents, created_at, paid_at FROM orders WHERE paid_at >= ? AND paid_at < ? ORDER BY paid_at ASC`).all(from, to);
}

export function paidOrderLinesBetween(from, to) {
  return db.prepare(`SELECT ol.order_id, ol.menu_id, ol.name, ol.qty, ol.modifiers_json, ol.unit_price_cents, ol.line_total_cents, o.paid_at
    FROM order_lines ol JOIN orders o ON o.id = ol.order_id
    WHERE o.paid_at >= ? AND o.paid_at < ? ORDER BY o.paid_at ASC`).all(from, to)
    .map(row => ({ ...row, modifiers: JSON.parse(row.modifiers_json) }));
}

// Popularity is intentionally calculated from saved, paid orders only. That
// keeps cancelled orders and carts that never reached checkout out of the list,
// while SQLite provides the persistent history across server restarts.
export function popularItems(limit = 10) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50);
  const popular = db.prepare(`
    SELECT ol.menu_id,
           ol.name,
           SUM(ol.qty) AS quantity_sold,
           COUNT(DISTINCT ol.order_id) AS order_count
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
     WHERE o.status = 'paid'
     GROUP BY ol.menu_id, ol.name
     ORDER BY quantity_sold DESC, order_count DESC, ol.name COLLATE NOCASE ASC
     LIMIT ?
  `).all(safeLimit);

  // Include recipe usage for each ranked item. Modifiers are included so the
  // estimate reflects what was actually ordered (for example, oat milk or an
  // extra espresso shot), not just the base recipe.
  const linesByItem = new Map();
  const lines = db.prepare(`
    SELECT ol.menu_id, ol.qty, ol.modifiers_json
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
     WHERE o.status = 'paid'
  `).all();
  for (const line of lines) {
    if (!linesByItem.has(line.menu_id)) linesByItem.set(line.menu_id, []);
    linesByItem.get(line.menu_id).push({ ...line, modifiers: JSON.parse(line.modifiers_json) });
  }
  const units = getMenu().ingredient_units;
  return popular.map(item => {
    const consumed = new Map();
    for (const line of linesByItem.get(item.menu_id) || []) {
      const ingredients = ingredientsForLine({ menu_id: line.menu_id, qty: line.qty, modifiers: line.modifiers });
      for (const [ingredient, amount] of Object.entries(ingredients)) {
        consumed.set(ingredient, (consumed.get(ingredient) || 0) + amount);
      }
    }
    return {
      ...item,
      ingredients_consumed: [...consumed.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ingredient, amount]) => ({ ingredient, amount, unit: units[ingredient] || 'units' }))
    };
  });
}

export function clearAllOrders() {
  db.exec('DELETE FROM order_fulfillment; DELETE FROM order_lines; DELETE FROM orders;');
}

export default db;
