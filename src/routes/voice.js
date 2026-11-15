import { Router } from 'express';
import multer from 'multer';
import { parseOrderFallback, parseOrderTurn } from '../ai/gemini.js';
import { parseConversationOrder } from '../ai/conversation.js';
import { buildReadback } from '../ai/readback.js';
import { addItem, clearOrder, getOrder, newOrder, removeItem, setHeard, setReadback, updateItem } from '../order.js';
import { broadcast } from '../events.js';
import { assertStockAvailable, inventorySnapshot } from '../db.js';
import { cancelCheckout, startCheckout } from './payment.js';
import { transcribe, synthesize } from '../speech.js';
import { parseInventoryCommand, spokenPackages } from '../inventoryVoice.js';
import { receiveStock } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const audioUrl = text => `/api/tts?text=${encodeURIComponent(text)}`;

// Long bracelet conversations are uploaded in short WAV segments.  Keep this
// endpoint deliberately separate from /voice: individual segments are only
// transcribed, then the complete conversation is parsed as one order when the
// cashier says "stop listening".
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio is required' });
  try {
    const heard = await transcribe(req.file.buffer, req.file.mimetype);
    return res.json({ heard });
  } catch (error) {
    console.error('Conversation transcription failed:', error.message);
    return res.status(502).json({ error: 'Sorry, that part of the conversation could not be heard.' });
  }
});

function failure(heard, message) {
  broadcast('error', { message });
  return { ...finishReadback({ heard, error: message }), error: message };
}

function finishReadback({ heard, actions = [], clarifyQuestion, confirmed = false, error, message } = {}) {
  const order = getOrder();
  const text = message || buildReadback(order, { clarifyQuestion, confirmed, error });
  setReadback(text);
  const readback = { text, audio_url: audioUrl(text) };
  broadcast('readback', readback);
  return { heard, actions, order: getOrder(), readback };
}

function handleInventoryTurn(heard) {
  const command = parseInventoryCommand(heard, inventorySnapshot());
  if (!command) return null;
  setHeard(heard);
  if (command.question) return finishReadback({ heard, clarifyQuestion: command.question });
  const inventory = receiveStock(command.kind, command.id, command.amount);
  broadcast('inventory', inventory);
  const row = command.kind === 'item'
    ? inventory.items.find(item => item.menu_id === command.id)
    : inventory.ingredients.find(item => item.ingredient === command.id);
  const available = row.package_size && row.available % row.package_size === 0
    ? spokenPackages(row, row.available / row.package_size)
    : `${row.available} ${row.unit || 'pieces'}`;
  return { ...finishReadback({ heard, actions: [{ name: 'receive_stock', args: { kind: command.kind, id: command.id, amount: command.amount } }],
    message: `Inventory updated. Received ${command.spokenQuantity} of ${command.label}. ${available} available now.` }), inventory };
}

async function applyCall(call) {
  if (call.name === 'add_item') {
    assertStockAvailable([...getOrder().lines, { menu_id: call.args.menu_id, qty: call.args.qty }]);
    return addItem(call.args.menu_id, call.args.qty, call.args.modifiers);
  }
  if (call.name === 'remove_item') return removeItem(call.args);
  if (call.name === 'update_item') {
    const lines = getOrder().lines.map(line => line.line_id === call.args.line_id ? { ...line, qty: call.args.qty ?? line.qty } : line);
    assertStockAvailable(lines.filter(line => line.qty > 0));
    return updateItem(call.args.line_id, call.args);
  }
  if (call.name === 'clear_order') return clearOrder();
  if (call.name === 'new_order') return newOrder();
  if (call.name === 'cancel_order') return cancelCheckout();
  if (call.name === 'confirm_order') return startCheckout();
  return undefined;
}

const blockedMessage = status => status === 'paid' ? 'Order is already paid. Say next customer to start a new one.'
  : status === 'cancelled' ? 'Order was cancelled. Say next customer to start a new one.'
  : 'Order is already being paid. Say next customer to start a new one.';
function stockMessage(error) {
  if (!error.menu_id) return error.message;
  const alternatives = inventorySnapshot().items.filter(item => item.menu_id !== error.menu_id && item.available > 0).map(item => item.name);
  return alternatives.length ? `${error.message}. Available instead: ${alternatives.join(' or ')}. Please confirm a replacement.` : error.message;
}

router.post('/conversation', async (req, res) => {
  const heard = String(req.body?.text || '').trim();
  if (!heard) return res.status(400).json({ error: 'Conversation text is required' });
  if (heard.length > 100000) return res.status(400).json({ error: 'Conversation is too long' });
  try {
    const inventoryTurn = handleInventoryTurn(heard);
    if (inventoryTurn) return res.json(inventoryTurn);
  } catch (error) { return res.status(error.status || 500).json(failure(heard, error.message)); }
  const initial = getOrder();
  if (initial.status !== 'building') return res.status(409).json(failure(heard, blockedMessage(initial.status)));
  setHeard(heard);
  let final;
  try {
    final = await parseConversationOrder(heard, initial);
  } catch (error) {
    console.error('Conversation parsing failed:', error.message);
    return res.status(502).json(failure(heard, 'I could not extract the full order. Please review the transcript and try again.'));
  }
  if (getOrder().id !== initial.id || getOrder().status !== 'building') {
    return res.status(409).json(failure(heard, 'The order changed while the conversation was being processed. Please review it before payment.'));
  }
  if (final.question || !final.items.length) {
    return res.json(finishReadback({ heard, clarifyQuestion: final.question || 'Which items should I add to the order?' }));
  }
  try { assertStockAvailable(final.items); }
  catch (error) {
    if (error.status !== 409) throw error;
    return res.status(409).json(failure(heard, stockMessage(error)));
  }
  clearOrder();
  for (const item of final.items) addItem(item.menu_id, item.qty, item.modifiers);
  try {
    await startCheckout();
  } catch (error) {
    console.error('Conversation checkout failed:', error.message);
    return res.status(error.status || 502).json(failure(heard, error.status === 409 ? stockMessage(error) : 'The order is ready, but payment could not start. Check the items and press Confirm to retry.'));
  }
  return res.json(finishReadback({ heard, confirmed: true }));
});

router.post('/voice', upload.single('audio'), async (req, res, next) => {
  try {
    const t0 = Date.now();
    let heard; let sttMs = 0;
    try {
      heard = req.file ? await transcribe(req.file.buffer, req.file.mimetype) : String(req.body?.text || '').trim();
      sttMs = Date.now() - t0;
    } catch (error) {
      console.error('Voice transcription failed:', error.message);
      return res.status(502).json(failure('', 'Sorry, say that again.'));
    }
    if (!heard) return res.json(finishReadback({ heard: '', error: "Sorry, I didn't catch that." }));

    const inventoryTurn = handleInventoryTurn(heard);
    if (inventoryTurn) return res.json(inventoryTurn);

    setHeard(heard);
    let calls; const g0 = Date.now();
    try {
      ({ calls } = await parseOrderTurn({ text: heard, order: getOrder() }));
    } catch (error) {
      console.error('Order parsing failed:', error.message);
      ({ calls } = parseOrderFallback({ text: heard, order: getOrder() }));
      console.warn(`[voice] using local menu fallback after parser failure for: ${JSON.stringify(heard)}`);
    }
    const geminiMs = Date.now() - g0;

    let confirmed = false;
    let clarifyQuestion;
    const applied = [];
    for (const call of calls) {
      if (call.name === 'clarify') { clarifyQuestion = call.args.question; applied.push(call); continue; }
      try {
        await applyCall(call);
        applied.push(call);
        if (call.name === 'confirm_order') confirmed = true;
      } catch (error) {
        if (call.name === 'confirm_order') {
          console.error('Payment checkout could not start:', error.message);
          broadcast('error', { message: `Payment could not start: ${error.message}` });
          clarifyQuestion = error.status === 409 ? stockMessage(error) : 'Payment could not start. Check the payment setup and try again.';
        } else if (error.message === 'Order is not being built') clarifyQuestion = blockedMessage(getOrder().status);
        else if (error.message === 'Order is empty') clarifyQuestion = 'Order is empty. Add an item before payment.';
        else { console.error('Order action failed:', error.message); clarifyQuestion = error.status === 409 ? stockMessage(error) : 'Sorry, I could not update that order. Please try again.'; }
        break;
      }
    }
    if (!calls.length) clarifyQuestion = 'Sorry, I did not understand that order.';
    const body = finishReadback({ heard, actions: applied, clarifyQuestion, confirmed });
    console.log(`[timing] voice turn: stt ${sttMs}ms, gemini ${geminiMs}ms, total ${Date.now() - t0}ms (tts is fetched on demand via /api/tts)`);
    return res.json(body);
  } catch (error) {
    console.error('Voice turn crashed:', error);
    try { return res.status(500).json(failure('', 'Sorry, say that again.')); } catch { next(error); }
  }
});

router.get('/tts', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 1000) return res.status(400).json({ error: 'text is too long' });
  try {
    const audio = await synthesize(text);
    if (!audio) return res.status(204).end();
    res.type('audio/mpeg').send(audio);
  } catch (error) {
    console.error('Speech synthesis failed:', error.message);
    res.status(502).json({ error: 'Voice read-back is temporarily unavailable.' });
  }
});

export default router;
