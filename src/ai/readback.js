const money = cents => `$${(cents / 100).toFixed(2)}`;
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = n => (n >= 0 && n <= 12 ? words[n] : String(n));
const plural = name => (/(s|sh|ch|x)$/i.test(name) ? `${name}es` : `${name}s`);
const join = parts => (parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
const upperFirst = text => text.charAt(0).toUpperCase() + text.slice(1);

function describeLine(line) {
  const mods = (line.modifier_names || []).map(name => name.toLowerCase().replace(/\s+/g, '-'));
  const name = line.name.toLowerCase().replace(/\s*&\s*/g, ' and ');
  return [spell(line.qty), ...mods, line.qty > 1 ? plural(name) : name].join(' ');
}

export function buildReadback(order, { clarifyQuestion, confirmed = false, error } = {}) {
  if (error) return error;
  if (clarifyQuestion) return clarifyQuestion;
  if (!order.lines.length) return 'Order is empty.';
  const items = upperFirst(join(order.lines.map(describeLine)));
  if (confirmed) return `Order confirmed. ${items}. Final total ${money(order.total_cents)}. Your receipt is ready. Please scan the code to pay.`;
  return `${items}. Total ${money(order.total_cents)}. Say confirm to finish the order.`;
}
