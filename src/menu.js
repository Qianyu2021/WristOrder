import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const menu = JSON.parse(readFileSync(new URL('../data/menu.json', import.meta.url), 'utf8'));
const items = new Map(menu.items.map(item => [item.id, item]));
const modifiers = new Map(menu.modifiers.map(modifier => [modifier.id, modifier]));

export const getMenu = () => menu;
export const findItem = id => items.get(id);
export const findModifier = id => modifiers.get(id);

export function priceLine({ menu_id, qty = 1, modifiers: modifierIds = [] }) {
  const item = findItem(menu_id);
  if (!item) throw new Error(`Unknown menu item: ${menu_id}`);
  if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a positive integer');
  const unit_price_cents = item.price_cents + [...new Set(modifierIds)].reduce((sum, id) => {
    if (!item.modifiers.includes(id)) throw new Error(`${id} is not available for ${item.name}`);
    return sum + findModifier(id).price_cents;
  }, 0);
  if (unit_price_cents < 0) throw new Error('Line price cannot be negative');
  return { unit_price_cents, line_total_cents: unit_price_cents * qty };
}

export function ingredientsForLine({ menu_id, qty = 1, modifiers: modifierIds = [] }) {
  const item = findItem(menu_id);
  if (!item) throw new Error(`Unknown menu item: ${menu_id}`);
  const amounts = { ...item.ingredients };
  for (const id of new Set(modifierIds)) {
    if (!item.modifiers.includes(id)) throw new Error(`${id} is not available for ${item.name}`);
    for (const [ingredient, amount] of Object.entries(findModifier(id).ingredients)) {
      amounts[ingredient] = (amounts[ingredient] || 0) + amount;
    }
  }
  return Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value * qty]).filter(([, value]) => value !== 0));
}
