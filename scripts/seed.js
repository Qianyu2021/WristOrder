import { randomUUID } from 'node:crypto';
import { clearAllOrders, saveOrder } from '../src/db.js';
import { getMenu, priceLine } from '../src/menu.js';

const menu = getMenu();
const weightedItems = [
  ['latte', 30], ['croissant', 22], ['cappuccino', 14], ['americano', 13], ['chai_latte', 10], ['matcha_latte', 9], ['blueberry_muffin', 9], ['ham_cheese_sandwich', 8], ['avocado_toast', 7], ['iced_tea', 6], ['mocha', 6], ['banana_bread', 5], ['espresso', 5], ['hot_chocolate', 3]
];
const pick = () => { const n = Math.random() * weightedItems.reduce((sum, [, weight]) => sum + weight, 0); let total = 0; for (const [id, weight] of weightedItems) { total += weight; if (n <= total) return id; } return 'latte'; };
const modifierOptions = item => {
  const options = [];
  if (item.modifiers.includes('size_large') && Math.random() < .2) options.push('size_large');
  if (item.modifiers.includes('oat_milk') && Math.random() < .18) options.push('oat_milk');
  if (item.modifiers.includes('extra_shot') && Math.random() < .12) options.push('extra_shot');
  if (item.modifiers.includes('warmed') && Math.random() < .35) options.push('warmed');
  return options;
};
const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
clearAllOrders(); let count = 0;
for (let back = 1; back <= 28; back++) {
  const date = new Date(dayStart); date.setUTCDate(date.getUTCDate() - back);
  const weekend = [0, 6].includes(date.getUTCDay()); const total = (weekend ? 100 : 60) + Math.floor(Math.random() * (weekend ? 41 : 31));
  for (let index = 0; index < total; index++) {
    const hour = Math.random() < .55 ? 7 + Math.floor(Math.random() * 4) : 11 + Math.floor(Math.random() * 6);
    date.setUTCHours(hour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
    const lines = []; const lineCount = 1 + Math.floor(Math.random() * 4);
    for (let number = 0; number < lineCount; number++) {
      const menu_id = pick(); const item = menu.items.find(row => row.id === menu_id); const qty = Math.random() < .16 ? 2 : 1; const modifiers = modifierOptions(item); const pricing = priceLine({ menu_id, qty, modifiers });
      lines.push({ line_id: number + 1, menu_id, name: item.name, qty, modifiers, modifier_names: modifiers.map(id => menu.modifiers.find(row => row.id === id).name), ...pricing });
    }
    saveOrder({ id: `seed_${randomUUID()}`, status: 'paid', lines, total_cents: lines.reduce((sum, line) => sum + line.line_total_cents, 0), created_at: date.toISOString(), paid_at: date.toISOString() }); count++;
  }
}
console.log(`Seeded ${count} paid orders over 28 days.`);
