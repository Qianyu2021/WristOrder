import express from 'express';
import { config, serviceModes } from './config.js';
import { getMenu } from './menu.js';
import { clearOrder, getOrder, newOrder, replaceItem } from './order.js';
import { assertStockAvailable, inventorySnapshot, popularItems } from './db.js';
import { sseHandler } from './events.js';
import voiceRouter from './routes/voice.js';
import paymentRouter, { cancelCheckout, recoverPendingCheckouts } from './routes/payment.js';
import ownerRouter from './routes/owner.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
// Expose only the browser library from the locally cloned kit, never the project root or .env.
app.use('/vexo/js/src', express.static(new URL('../vexo-open-kit/js/src', import.meta.url).pathname));
app.use(express.static('public'));
app.get('/', (_req, res) => res.type('html').send('<h1>WristOrder</h1><nav><a href="/demo">Live café</a> · <a href="/cashier">Cashier</a> · <a href="/customer">Customer</a> · <a href="/kitchen">Kitchen</a> · <a href="/pickup">Pickup</a> · <a href="/owner">Owner</a> · <a href="/owner#popular">Popular items</a> · <a href="/owner#inventory">Inventory &amp; reorder</a></nav>'));
for (const page of ['cashier', 'customer', 'kitchen', 'owner', 'demo', 'pickup']) app.get(`/${page}`, (_req, res) => res.sendFile(new URL(`../public/${page}/index.html`, import.meta.url).pathname));
app.get('/api/health', (_req, res) => res.json(serviceModes));
app.get('/api/menu', (_req, res) => res.json(getMenu()));
app.get('/api/popular-items', (req, res) => res.json(popularItems(req.query.limit)));
app.get('/api/inventory', (_req, res) => res.json(inventorySnapshot()));
app.get('/api/order', (_req, res) => res.json(getOrder()));
app.post('/api/order/new', (_req, res) => {
  try { res.json(newOrder()); }
  catch (error) { res.status(409).json({ error: error.message }); }
});
app.post('/api/order/clear', async (_req, res) => {
  try {
    if (getOrder().status === 'awaiting_payment') {
      await cancelCheckout();
      return res.json(newOrder());
    }
    return res.json(clearOrder());
  } catch (error) { return res.status(error.status || 409).json({ error: error.message }); }
});
app.post('/api/order/cancel', async (_req, res) => {
  try { res.json(await cancelCheckout()); }
  catch (error) { res.status(error.status || 409).json({ error: error.message }); }
});
app.post('/api/order/replace', (req, res) => {
  try {
    const lineId = Number(req.body?.line_id);
    if (!Number.isInteger(lineId)) throw new Error('A valid order line is required');
    const current = getOrder();
    const lines = current.lines.map(line => line.line_id === lineId ? { ...line, menu_id: String(req.body?.menu_id || '') } : line);
    assertStockAvailable(lines);
    res.json(replaceItem(lineId, String(req.body?.menu_id || ''), req.body?.modifiers));
  } catch (error) { res.status(409).json({ error: error.message }); }
});
app.get('/api/events', sseHandler);
app.use('/api', voiceRouter, paymentRouter, ownerRouter);
app.use((err, _req, res, _next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Unexpected server error' }); });
app.listen(config.port, () => {
  recoverPendingCheckouts();
  console.log(`WristOrder listening at ${config.publicBaseUrl}`);
  for (const [service, mode] of Object.entries(serviceModes)) console.log(`  ${service}: ${mode}`);
});
