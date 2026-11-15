const money = cents => `$${(cents / 100).toFixed(2)}`;
const amount = row => `${row.order_amount} ${row.unit}`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

export function reportHtml(report) {
  const rows = report.stats.top_items.slice(0, 5).map(item => `<tr><td>${escape(item.name)}</td><td>${item.qty}</td><td>${money(item.revenue_cents)}</td></tr>`).join('');
  const restock = report.inventory.restock.slice(0, 8).map(row => `<tr><td>${escape(row.name)}</td><td>${amount(row)}</td></tr>`).join('') || '<tr><td colspan="2">Nothing is currently below its low mark.</td></tr>';
  return `<main style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#17212b"><h1>WristOrder weekly report</h1><p>${escape(report.period)}</p><div style="white-space:pre-wrap;line-height:1.55">${escape(report.summary_markdown)}</div><h2>Top dishes</h2><table style="border-collapse:collapse;width:100%"><tr><th align="left">Dish</th><th align="left">Sold</th><th align="left">Revenue</th></tr>${rows}</table><h2>Order now</h2><table style="border-collapse:collapse;width:100%"><tr><th align="left">Item or ingredient</th><th align="left">Quantity</th></tr>${restock}</table></main>`;
}
