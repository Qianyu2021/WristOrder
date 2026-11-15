import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { getStats } from '../stats.js';
import { inventorySnapshot } from '../db.js';
import { transcribe } from '../speech.js';

export async function askOwner({ audioBuffer, mimeType, text }) {
  let heard = String(text || '').trim();
  if (!heard && audioBuffer) {
    try { heard = (await transcribe(audioBuffer, mimeType)).trim(); } catch (error) {
      console.error('Owner transcription failed:', error.message);
      return { heard: '', answer: 'Sorry, I could not hear that. Please try again.' };
    }
  }
  if (!heard) return { heard: '', answer: "Sorry, I didn't catch that." };
  const stats = getStats({ days: 28 });
  const inventory = inventorySnapshot();
  const top = stats.top_items[0];
  if (config.useMockGemini) {
    const lower = heard.toLowerCase();
    if (lower.includes('low') || lower.includes('order') || lower.includes('restock') || lower.includes('inventory')) {
      return { heard, answer: inventory.restock.length ? `Order ${inventory.restock.map(row => `${row.order_amount} ${row.unit} of ${row.name.replaceAll('_', ' ')}`).join(', ')}.` : 'Nothing is currently below its low stock mark.' };
    }
    if (lower.includes('oat')) { const oat = stats.restock_suggestion.find(row => row.ingredient === 'oat_milk_ml'); return { heard, answer: oat ? `Plan for about ${oat.suggested_next_week} milliliters of oat milk next week.` : 'There is no oat milk usage yet.' }; }
    return { heard, answer: top ? `${top.name} sold best this week, with ${top.qty} sold.` : 'There are no paid orders yet.' };
  }
  try {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const result = await ai.models.generateContent({ model: config.geminiModel, contents: `You answer a café owner’s sales and inventory questions using only this data. Answer in two spoken sentences or fewer. If the question is unrelated to café sales or inventory, say so.\nData: ${JSON.stringify({ stats, inventory })}\nQuestion: ${heard}` });
    return { heard, answer: result.text?.trim() || 'I could not find an answer in the sales data.' };
  } catch (error) {
    console.error('Owner assistant failed:', error.message);
    return { heard, answer: 'I could not answer that right now. Please try again.' };
  }
}
