import { getMenu, ingredientsForLine } from './menu.js';
import { paidOrdersBetween, paidOrderLinesBetween } from './db.js';

const DAY_MS = 86_400_000;
const day = date => new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
const iso = date => date.toISOString().slice(0, 10);
const rounded = value => Math.round(value * 10) / 10;

function addDays(date, amount) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + amount); return next; }
function rangeForDays(days) {
  const end = addDays(day(new Date()), 1);
  return { from: addDays(end, -days), to: end };
}
function itemSummary(lines) {
  const map = new Map();
  for (const line of lines) {
    const value = map.get(line.menu_id) || { menu_id: line.menu_id, name: line.name, qty: 0, revenue_cents: 0 };
    value.qty += line.qty;
    value.revenue_cents += line.line_total_cents;
    map.set(line.menu_id, value);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || b.revenue_cents - a.revenue_cents);
}
function ingredientSummary(lines) {
  const total = new Map();
  for (const line of lines) {
    const ingredients = ingredientsForLine({ menu_id: line.menu_id, qty: line.qty, modifiers: line.modifiers });
    for (const [ingredient, amount] of Object.entries(ingredients)) total.set(ingredient, (total.get(ingredient) || 0) + amount);
  }
  const units = getMenu().ingredient_units;
  return total;
}

export function getStats({ days = 28 } = {}) {
  days = Math.max(7, Math.min(90, Number(days) || 28));
  const { from, to } = rangeForDays(days);
  const allOrders = paidOrdersBetween(from.toISOString(), to.toISOString());
  const allLines = paidOrderLinesBetween(from.toISOString(), to.toISOString());
  const daily = Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index); const key = iso(date);
    const orders = allOrders.filter(order => order.paid_at.slice(0, 10) === key);
    return { date: key, orders: orders.length, revenue_cents: orders.reduce((sum, order) => sum + order.total_cents, 0) };
  });
  const weekStart = addDays(to, -7); const lastWeekStart = addDays(to, -14);
  const thisWeekLines = allLines.filter(line => line.paid_at >= weekStart.toISOString());
  const lastWeekLines = allLines.filter(line => line.paid_at >= lastWeekStart.toISOString() && line.paid_at < weekStart.toISOString());
  const thisItems = itemSummary(thisWeekLines); const lastItems = itemSummary(lastWeekLines);
  const lastById = new Map(lastItems.map(item => [item.menu_id, item]));
  const week_over_week = thisItems.map(item => {
    const prior = lastById.get(item.menu_id)?.qty || 0;
    return { menu_id: item.menu_id, name: item.name, this_week: item.qty, last_week: prior, change_pct: prior ? rounded(((item.qty - prior) / prior) * 100) : item.qty ? 100 : 0 };
  }).sort((a, b) => b.change_pct - a.change_pct);
  const ingredientsThis = ingredientSummary(thisWeekLines); const ingredientsLast = ingredientSummary(lastWeekLines); const units = getMenu().ingredient_units;
  const ingredientKeys = new Set([...ingredientsThis.keys(), ...ingredientsLast.keys()]);
  const ingredients = [...ingredientKeys].map(ingredient => ({ ingredient, unit: units[ingredient] || 'units', this_week: rounded(ingredientsThis.get(ingredient) || 0), last_week: rounded(ingredientsLast.get(ingredient) || 0) })).sort((a, b) => b.this_week - a.this_week);
  return {
    range: { from: iso(from), to: iso(addDays(to, -1)) },
    totals: { orders: allOrders.length, revenue_cents: allOrders.reduce((sum, order) => sum + order.total_cents, 0), avg_ticket_cents: allOrders.length ? Math.round(allOrders.reduce((sum, order) => sum + order.total_cents, 0) / allOrders.length) : 0 },
    daily,
    top_items: thisItems,
    week_over_week,
    ingredients,
    restock_suggestion: ingredients.filter(row => row.this_week > 0).map(row => ({ ingredient: row.ingredient, unit: row.unit, suggested_next_week: rounded(row.this_week * 1.1) }))
  };
}
