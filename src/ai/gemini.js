import { config } from '../config.js';
import { findItem, findModifier, getMenu } from '../menu.js';

const normalize = text => String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isConfirmation = text => /\b(?:i\s+)?confirm\b|\bthat s (?:it|all)\b|\bring it up\b|\bcheck out\b|^pay$/.test(normalize(text));
export function isStandaloneConfirmation(text) {
  const phrase = normalize(text).replace(/^(?:(?:(?:hey )?vexo|yes|okay|ok|please|i want to|i|can you|could you)\s+)+/, '');
  return /^(?:confirm(?: (?:(?:the|this|my) )?order| it)?(?: now| please)?|that s (?:it|all)|ring it up|check out|checkout|pay(?: now)?)$/.test(phrase);
}
export function isStandaloneNewOrder(text) {
  const phrase = normalize(text).replace(/^(?:(?:(?:hey )?vexo|yes|okay|ok|please|i want to|i|can you|could you)\s+)+/, '');
  return /^(?:start (?:a )?new order|new order|next customer)$/.test(phrase);
}
export function containsNewOrderCommand(text) {
  return /(?:^|\b)(?:start (?:a )?new order|new order|next customer)(?:$|\b)/.test(normalize(text));
}
const quantities = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const knownNames = new Set(['add_item', 'remove_item', 'update_item', 'clear_order', 'confirm_order', 'cancel_order', 'new_order', 'clarify']);

function numberFor(value, fallback = 1) {
  if (Number.isInteger(value)) return value;
  return quantities[normalize(value)] || (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
}

function allowedModifiers(item, modifierIds) {
  if (modifierIds === undefined || modifierIds === null) return [];
  if (!Array.isArray(modifierIds)) return null;
  const unique = [...new Set(modifierIds)];
  if (unique.some(id => !findModifier(id) || !item.modifiers.includes(id))) return null;
  return unique;
}

function validateCall(call, order) {
  if (!call || !knownNames.has(call.name)) return null;
  const args = call.args || {};
  if (call.name === 'add_item') {
    const item = findItem(args.menu_id); const qty = args.qty === undefined ? 1 : Number(args.qty);
    const modifiers = item && allowedModifiers(item, args.modifiers);
    return item && Number.isInteger(qty) && qty > 0 && qty <= 50 && modifiers ? { name: call.name, args: { menu_id: item.id, qty, modifiers } } : null;
  }
  if (call.name === 'update_item') {
    const line = order.lines.find(row => row.line_id === Number(args.line_id));
    if (!line) return null;
    const update = { line_id: line.line_id };
    if (args.qty !== undefined) {
      const qty = Number(args.qty);
      if (!Number.isInteger(qty) || qty < 0 || qty > 50) return null;
      update.qty = qty;
    }
    if (args.modifiers !== undefined) {
      const modifiers = allowedModifiers(findItem(line.menu_id), args.modifiers);
      if (!modifiers) return null;
      update.modifiers = modifiers;
    }
    return Object.keys(update).length > 1 ? { name: call.name, args: update } : null;
  }
  if (call.name === 'remove_item') {
    const line = order.lines.find(row => row.line_id === Number(args.line_id));
    if (line) return { name: call.name, args: { line_id: line.line_id } };
    return findItem(args.menu_id) ? { name: call.name, args: { menu_id: args.menu_id } } : null;
  }
  if (call.name === 'clarify') {
    const question = String(args.question || '').trim();
    return question ? { name: call.name, args: { question: question.slice(0, 180) } } : null;
  }
  return { name: call.name, args: {} };
}

function lineForText(order, text) {
  return order.lines.find(line => {
    const item = findItem(line.menu_id);
    return [item.name, ...item.aliases].some(name => text.includes(normalize(name))) || normalize(item.name).split(' ').some(word => word.length > 3 && text.includes(word));
  });
}

function modifierIdsForText(item, text, existing = []) {
  const modifiers = new Set(existing);
  if (/\blarge\b/.test(text) && item.modifiers.includes('size_large')) { modifiers.delete('size_small'); modifiers.add('size_large'); }
  if (/\bsmall\b/.test(text) && item.modifiers.includes('size_small')) { modifiers.delete('size_large'); modifiers.add('size_small'); }
  if (/\boat(?: milk)?\b/.test(text) && item.modifiers.includes('oat_milk')) modifiers.add('oat_milk');
  if (/\bextra shot\b/.test(text) && item.modifiers.includes('extra_shot')) modifiers.add('extra_shot');
  if (/\bdecaf\b/.test(text) && item.modifiers.includes('decaf')) modifiers.add('decaf');
  if (/\bwarmed\b/.test(text) && item.modifiers.includes('warmed')) modifiers.add('warmed');
  if (/\bno ice\b/.test(text) && item.modifiers.includes('no_ice')) modifiers.add('no_ice');
  return [...modifiers];
}

function quantityBeforeItem(text, item) {
  const names = [item.name, ...item.aliases].map(normalize).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const match = text.match(new RegExp(`(?:^|\\s)(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+)\\s+(?:large\\s+|small\\s+|oat(?:\\s+milk)?\\s+|decaf\\s+|warmed\\s+|extra\\s+shot\\s+|no\\s+ice\\s+)*${name.replaceAll(' ', '\\s+')}(?:s)?`));
    if (match) return numberFor(match[1]);
  }
  return 1;
}

function mockParse(text, order) {
  let words = normalize(text);
  if (/\bno wait\b/.test(words)) words = words.slice(words.lastIndexOf('no wait') + 'no wait'.length).trim();
  if (isConfirmation(words)) return [{ name: 'confirm_order', args: {} }];
  if (/\b(next customer|new order)\b/.test(words)) return [{ name: 'new_order', args: {} }];
  if (/\b(cancel|void)\b/.test(words)) return [{ name: 'cancel_order', args: {} }];
  if (/\b(clear|start over|empty the order)\b/.test(words)) return [{ name: 'clear_order', args: {} }];
  if (/\b(remove|scratch|delete)\b/.test(words)) {
    const line = lineForText(order, words);
    return line ? [{ name: 'remove_item', args: { line_id: line.line_id } }] : [{ name: 'clarify', args: { question: 'Which item should I remove?' } }];
  }
  if (/\b(pizza|sushi|burger)\b/.test(words)) return [{ name: 'clarify', args: { question: 'We do not have that on the menu. What would you like instead?' } }];

  const changing = /\b(actually|make|change|instead)\b/.test(words);
  const line = changing && lineForText(order, words);
  if (line && /\b(large|small|oat|decaf|extra shot|warmed|no ice)\b/.test(words)) {
    const item = findItem(line.menu_id); const modifiers = modifierIdsForText(item, words, line.modifiers);
    if (/\b(one|1)\b/.test(words) && line.qty > 1) {
      return [
        { name: 'update_item', args: { line_id: line.line_id, qty: line.qty - 1 } },
        { name: 'add_item', args: { menu_id: item.id, qty: 1, modifiers } }
      ];
    }
    return [{ name: 'update_item', args: { line_id: line.line_id, modifiers } }];
  }

  const menu = getMenu();
  let rest = ` ${words} `; const found = [];
  const byLength = menu.items.map(item => ({ item, names: [item.name, ...item.aliases].map(normalize) })).sort((a, b) => Math.max(...b.names.map(n => n.length)) - Math.max(...a.names.map(n => n.length)));
  for (const { item, names } of byLength) {
    const hit = names.find(name => rest.includes(` ${name}`));
    if (hit) { found.push({ item, position: words.indexOf(hit) }); rest = rest.replace(new RegExp(` ${hit}(?:s|es)?(?= )`, 'g'), ' '); }
  }
  if (!found.length) return [{ name: 'clarify', args: { question: 'What would you like to order?' } }];
  return found.sort((a, b) => a.position - b.position).map(({ item }) => ({ name: 'add_item', args: { menu_id: item.id, qty: quantityBeforeItem(words, item), modifiers: modifierIdsForText(item, words) } }));
}

export function parseOrderFallback({ text, order }) {
  return { calls: mockParse(text, order).map(call => validateCall(call, order)).filter(Boolean) };
}

export async function parseOrderTurn({ text, order }) {
  // Payment confirmation is a command, not an open-ended language task. Handle
  // it locally so the QR flow still works if Gemini is slow or returns no call.
  if (isConfirmation(text)) return { calls: [{ name: 'confirm_order', args: {} }] };
  if (config.useMockGemini) return parseOrderFallback({ text, order });
  const { GoogleGenAI, Type, FunctionCallingConfigMode } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const menu = getMenu();
  const compactMenu = menu.items.map(item => `${item.id} | ${item.name} | $${(item.price_cents / 100).toFixed(2)}${item.aliases?.length ? ` (aka ${item.aliases.join(', ')})` : ''} | modifiers: ${item.modifiers.join(', ') || 'none'}`).join('\n');
  const compactMods = menu.modifiers.map(mod => `${mod.id} = ${mod.name} (${mod.price_cents >= 0 ? '+' : '-'}$${Math.abs(mod.price_cents / 100).toFixed(2)})`).join(', ');
  const currentLines = order.lines.map(line => ({ line_id: line.line_id, menu_id: line.menu_id, qty: line.qty, modifiers: line.modifiers }));
  const systemInstruction = `You are the order-taking assistant for a café register. The text can be one cashier command or a complete conversation between a customer and cashier, and may contain recognition errors.
Menu (id | name | base price | allowed modifiers):
${compactMenu}
Modifier ids: ${compactMods}
Current order lines (JSON): ${JSON.stringify(currentLines)}
Rules:
- Use only the menu ids and modifier ids listed above; never invent any. Map near-miss words to the closest menu item.
- Prices are authoritative for menu access, but never calculate or make up a total: the register calculates it from the selected items.
- Only use modifiers listed as allowed for that item.
- "Make that / make one of them X" refers to the most recent or best-matching line. To change just one of several, call update_item to reduce that line's qty and add_item for the single changed item.
- "Confirm", "I confirm", "that's it", "ring it up", or "check out" means confirm_order. "Next customer" means new_order.
- For a complete conversation, extract the customer's final requested items and any changes. Ignore greetings, questions about availability, the cashier repeating prices, and the phrase "stop listening"; it only ends recording.
- If the utterance is unclear or off-menu, call clarify with a short question.
- Respond with function calls only.`;
  const declarations = [
    { name: 'add_item', description: 'Add a menu item.', parameters: { type: Type.OBJECT, properties: { menu_id: { type: Type.STRING }, qty: { type: Type.INTEGER }, modifiers: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['menu_id', 'qty', 'modifiers'] } },
    { name: 'remove_item', description: 'Remove a line or matching item.', parameters: { type: Type.OBJECT, properties: { line_id: { type: Type.INTEGER }, menu_id: { type: Type.STRING } } } },
    { name: 'update_item', description: 'Update a line quantity or modifiers.', parameters: { type: Type.OBJECT, properties: { line_id: { type: Type.INTEGER }, qty: { type: Type.INTEGER }, modifiers: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['line_id'] } },
    { name: 'clear_order', description: 'Clear the order.', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'confirm_order', description: 'Start payment.', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'cancel_order', description: 'Cancel the active order.', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'new_order', description: 'Start the next customer.', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'clarify', description: 'Ask the cashier a concise question.', parameters: { type: Type.OBJECT, properties: { question: { type: Type.STRING } }, required: ['question'] } }
  ];
  const generation = ai.models.generateContent({
    model: config.geminiModel,
    contents: text,
    config: {
      systemInstruction,
      temperature: 0,
      ...(/flash/.test(config.geminiModel) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      tools: [{ functionDeclarations: declarations }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
    }
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Gemini timed out')), 15000); });
  const response = await Promise.race([generation, timeout]).finally(() => clearTimeout(timer));
  generation.catch(() => {});
  const raw = response.functionCalls || [];
  const calls = raw.map(call => validateCall(call, order)).filter(Boolean);
  if (calls.length < raw.length) console.warn(`[gemini] dropped ${raw.length - calls.length} invalid call(s): ${JSON.stringify(raw)}`);
  // Keep a clear, correctly transcribed menu request from becoming a dead end
  // when the model elects not to return a function call.
  if (!calls.length) {
    const fallbackCalls = parseOrderFallback({ text, order }).calls;
    console.warn(`[gemini] no valid function calls; using local menu fallback for: ${JSON.stringify(text)}`);
    return { calls: fallbackCalls };
  }
  return { calls };
}
