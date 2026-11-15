import { getMenu } from './menu.js';

const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const quantityPattern = /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const spokenPackages = (row, count) => `${count} ${row.package_unit.replace('1 L', 'one-liter').replace('30 g', '30-gram')}${count === 1 ? '' : 's'}`;

function stockTargets(snapshot) {
  const menu = new Map(getMenu().items.map(item => [item.id, item]));
  return [
    ...snapshot.items.map(row => ({ kind: 'item', id: row.menu_id, row,
      aliases: [row.name, ...(menu.get(row.menu_id)?.aliases || [])] })),
    ...snapshot.ingredients.map(row => ({ kind: 'ingredient', id: row.ingredient, row,
      aliases: [row.label || '', row.ingredient.replace(/_(ml|g)$/, '').replaceAll('_', ' '),
        ...(row.ingredient === 'milk_ml' ? ['milk', 'dairy milk', 'regular milk'] : []),
        ...(row.ingredient === 'matcha_g' ? ['matcha'] : [])] }))
  ];
}

function targetFor(text, snapshot) {
  const matches = [];
  for (const target of stockTargets(snapshot)) {
    for (const alias of target.aliases) {
      const term = normalize(alias);
      if (!term) continue;
      const pattern = new RegExp(`\\b${escapeRegex(term).replaceAll(' ', '\\s+')}s?\\b`, 'g');
      for (const match of text.matchAll(pattern)) matches.push({ target, start: match.index, end: match.index + match[0].length, length: match[0].length });
    }
  }
  matches.sort((a, b) => b.length - a.length);
  const selected = [];
  for (const match of matches) {
    if (selected.some(other => match.start < other.end && match.end > other.start)) continue;
    selected.push(match);
  }
  const ids = new Set(selected.map(match => `${match.target.kind}:${match.target.id}`));
  if (ids.size > 1) return { question: 'Please add one stock item at a time.' };
  return selected[0]?.target || null;
}

export function parseInventoryCommand(utterance, snapshot) {
  const text = normalize(utterance);
  const stockIntent = /^(?:please\s+)?(?:add|receive|received|restock|stock|record|log|we\s+received|we\s+got)\b/.test(text)
    && (/(?:\binventory\b|\bstock\b|\brestock\b|\breceiv(?:e|ed)\b|\bdelivery\b)/.test(text));
  if (!stockIntent) return null;
  if (/\b(customer|checkout|paid|pay|order|ordered|wants)\b/.test(text)) {
    return { question: 'Please give the stock update separately from a customer order.' };
  }
  const target = targetFor(text, snapshot);
  if (target?.question) return target;
  if (!target) return { question: 'Which stock item did you receive?' };
  const quantityMatch = text.match(quantityPattern);
  const count = quantityMatch ? (words[quantityMatch[1]] || Number(quantityMatch[1])) : NaN;
  if (!Number.isSafeInteger(count) || count < 1) return { question: `How many ${target.row.label || target.row.name || target.id} did you receive?` };

  const { row } = target;
  const bottle = /\bbottles?\b/.test(text);
  const tin = /\btins?\b/.test(text);
  const liters = /\b(?:l|liters?|litres?)\b/.test(text);
  const milliliters = /\b(?:ml|milliliters?|millilitres?)\b/.test(text);
  const kilograms = /\b(?:kg|kilograms?)\b/.test(text);
  const grams = /\b(?:g|grams?)\b/.test(text);
  let amount;
  if (target.kind === 'item') {
    if (bottle || tin || liters || milliliters || kilograms || grams) return { question: 'Count baked goods in pieces.' };
    amount = count;
  } else if (bottle || tin) {
    if (!row.package_size || (bottle && !row.package_unit.includes('bottle')) || (tin && !row.package_unit.includes('tin'))) {
      return { question: `Please give a valid package unit for ${row.label || target.id}.` };
    }
    amount = count * row.package_size;
  } else if (liters && row.unit === 'ml') amount = count * 1000;
  else if (milliliters && row.unit === 'ml') amount = count;
  else if (kilograms && row.unit === 'g') amount = count * 1000;
  else if (grams && row.unit === 'g') amount = count;
  else if (['pcs', 'slices'].includes(row.unit)) amount = count;
  else return { question: `Please say the unit for ${row.label || target.id}, such as bottles, tins, milliliters, or grams.` };

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) return { question: 'Please give a stock quantity between 1 and 1,000,000 base units.' };
  return { kind: target.kind, id: target.id, amount, label: row.label || row.name || target.id,
    spokenQuantity: row.package_size && amount % row.package_size === 0
      ? spokenPackages(row, amount / row.package_size)
      : `${amount} ${row.unit || 'pieces'}` };
}
