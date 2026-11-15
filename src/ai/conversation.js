import { config } from '../config.js';
import { findItem, findModifier, getMenu } from '../menu.js';
import { parseOrderFallback } from './gemini.js';

function validateItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error('No complete order was extracted');
  return items.map(row => {
    const item = findItem(row?.menu_id);
    const qty = Number(row?.qty);
    const modifiers = row?.modifiers;
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > 50 || !Array.isArray(modifiers)) {
      throw new Error('The conversation contained an invalid order item');
    }
    const unique = [...new Set(modifiers)];
    if (unique.some(id => !findModifier(id) || !item.modifiers.includes(id))) {
      throw new Error('The conversation contained an invalid modifier');
    }
    return { menu_id: item.id, qty, modifiers: unique };
  });
}

export async function parseConversationOrder(text, order) {
  if (config.useMockGemini) {
    const withoutCommands = text.replace(/\b(?:i\s+)?confirm\b|\bthat'?s\s+(?:it|all)\b|\bring it up\b|\bcheck out\b/gi, ' ');
    const calls = parseOrderFallback({ text: withoutCommands, order }).calls;
    const question = calls.find(call => call.name === 'clarify')?.args.question || '';
    const items = calls.filter(call => call.name === 'add_item').map(call => call.args);
    return { items: items.length ? validateItems(items) : [], question: question || (!items.length ? 'Which items should I add to the order?' : '') };
  }

  const { GoogleGenAI, Type, FunctionCallingConfigMode } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const menu = getMenu();
  const menuText = menu.items.map(item => `${item.id}: ${item.name} (aliases: ${item.aliases.join(', ') || 'none'}; modifiers: ${item.modifiers.join(', ') || 'none'})`).join('\n');
  const instruction = `Extract the FINAL agreed cafe order from the entire customer/cashier transcript.\nMenu:\n${menuText}\nRules:\n- Return each item the customer ultimately wants, with its final quantity and modifiers. Handle corrections, substitutions, cancellations, and the cashier reading the order back; never count a readback as another order.\n- Use only the listed menu and modifier IDs. Do not guess an ambiguous item or an unsupported modifier.\n- A cashier's "confirm" or "that's it" inside the transcript is conversational context, not a command to skip item extraction. "Stop listening" ends capture and is not an item.\n- If an essential item or change is unclear, set question to a brief clarification and return no items. Otherwise set question to an empty string.\n- Prices and checkout are calculated by the register; never calculate a total.\n- Call final_order exactly once with the complete final list, in customer-request order.`;
  const generation = ai.models.generateContent({
    model: config.geminiConversationModel,
    contents: text,
    config: {
      systemInstruction: instruction,
      temperature: 0,
      tools: [{ functionDeclarations: [{
        name: 'final_order',
        description: 'Return the complete final order from the conversation.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            items: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
              menu_id: { type: Type.STRING }, qty: { type: Type.INTEGER },
              modifiers: { type: Type.ARRAY, items: { type: Type.STRING } }
            }, required: ['menu_id', 'qty', 'modifiers'] } },
            question: { type: Type.STRING }
          },
          required: ['items', 'question']
        }
      }] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
    }
  });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Conversation parsing timed out')), 45000); });
  const response = await Promise.race([generation, timeout]).finally(() => clearTimeout(timer));
  generation.catch(() => {});
  const calls = response.functionCalls || [];
  if (calls.length !== 1 || calls[0].name !== 'final_order') throw new Error('No complete order was returned');
  const { items, question } = calls[0].args || {};
  if (typeof question !== 'string') throw new Error('The order response was incomplete');
  if (question.trim()) return { items: [], question: question.trim().slice(0, 180) };
  return { items: validateItems(items), question: '' };
}
