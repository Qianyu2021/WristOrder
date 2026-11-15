import cron from 'node-cron';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { getStats } from './stats.js';
import { inventorySnapshot } from './db.js';
import { sendReport } from './email.js';

const money = cents => `$${(cents / 100).toFixed(2)}`;
const amount = row => `${row.order_amount} ${row.unit}`;

function template(stats, inventory) {
  const top = stats.top_items.slice(0, 3).map(item => `${item.name} (${item.qty})`).join(', ') || 'no sales yet';
  const mover = stats.week_over_week[0];
  const restock = inventory.restock.slice(0, 3).map(row => `${row.name}: order ${amount(row)}`).join(', ') || 'nothing is currently below its low mark';
  return `## Weekly café brief\n\n${stats.totals.orders} paid orders generated ${money(stats.totals.revenue_cents)} from ${stats.range.from} to ${stats.range.to}. Top sellers: ${top}. ${mover ? `${mover.name} changed ${mover.change_pct}% week over week.` : ''} Current low stock: ${restock}. Tip: feature the best seller during your busiest morning window.`;
}

export async function buildReport() {
  const stats = getStats({ days: 28 });
  const inventory = inventorySnapshot();
  let summary_markdown = template(stats, inventory);
  if (!config.useMockGemini) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const result = await ai.models.generateContent({
        model: config.geminiModel,
        contents: `Write a concise café owner briefing of 150 words or fewer from this exact data. Include headline numbers, top three dishes, biggest mover, current low-stock reorder list, and one actionable tip. Never invent a number.\n${JSON.stringify({ stats, restock: inventory.restock })}`
      });
      if (result.text?.trim()) summary_markdown = result.text.trim();
    } catch (error) {
      console.error('Gemini report generation failed:', error.message);
    }
  }
  return { period: `${stats.range.from} to ${stats.range.to}`, stats, inventory, summary_markdown };
}

let scheduled = false;
export function startReportSchedule() {
  if (scheduled || !config.reportCron) return;
  if (!cron.validate(config.reportCron)) { console.error(`Invalid REPORT_CRON: ${config.reportCron}`); return; }
  cron.schedule(config.reportCron, async () => {
    try { await sendReport(await buildReport()); } catch (error) { console.error('Weekly report failed:', error.message); }
  });
  scheduled = true;
}
