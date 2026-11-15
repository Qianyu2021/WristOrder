import { getOrder } from './order.js';

const clients = new Set();
export function broadcast(type, data) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(message); } catch { clients.delete(res); }
  }
}
export function sseHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: order\ndata: ${JSON.stringify(getOrder())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}
