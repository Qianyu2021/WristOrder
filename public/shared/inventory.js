const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function stockAmount(row, amount) {
  const raw = `${number(amount)} ${row.unit || 'pcs'}`;
  if (!row.package_size || amount === 0) return raw;
  const packages = amount / row.package_size;
  return `${number(packages)} × ${row.package_unit}${packages === 1 ? '' : 's'} (${raw})`;
}

export function reorderAmount(row) {
  if (!row.package_size) return stockAmount(row, row.order_amount);
  const packages = Math.ceil(row.order_amount / row.package_size);
  return `${number(packages)} × ${row.package_unit}${packages === 1 ? '' : 's'} (${number(packages * row.package_size)} ${row.unit})`;
}

export const stockName = row => row.label || row.name?.replace(/_(ml|g)$/, '').replaceAll('_', ' ') || row.ingredient?.replace(/_(ml|g)$/, '').replaceAll('_', ' ');
export const stockStatus = row => row.available === null || row.available === undefined ? 'Unknown'
  : row.available === 0 ? 'Sold out' : row.low || row.available <= row.low_at ? 'Low' : 'In stock';

export function renderStaffStockAlert(element, snapshot) {
  if (!element || !Array.isArray(snapshot?.restock)) return;
  element.replaceChildren();
  element.hidden = snapshot.restock.length === 0;
  if (element.hidden) return;
  const title = document.createElement('strong');
  title.textContent = 'Low stock — tell the owner to order:';
  const list = document.createElement('ul');
  for (const row of snapshot.restock) {
    const item = document.createElement('li');
    item.textContent = `${stockName(row)}: ${stockAmount(row, row.available)} left; order ${reorderAmount(row)}`;
    list.append(item);
  }
  const link = document.createElement('a');
  link.href = '/owner#inventory';
  link.textContent = 'Open owner inventory';
  element.append(title, list, link);
}
