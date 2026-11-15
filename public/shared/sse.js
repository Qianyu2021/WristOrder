export function subscribe(handlers) {
  const source = new EventSource('/api/events');
  for (const [name, handler] of Object.entries(handlers)) source.addEventListener(name, event => handler(JSON.parse(event.data)));
  return source;
}
