export const money = cents => `$${(cents / 100).toFixed(2)}`;
export const lineLabel = line => `${line.qty}× ${line.name}${line.modifier_names?.length ? ` · ${line.modifier_names.join(', ')}` : ''}`;
