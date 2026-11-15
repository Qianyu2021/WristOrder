import { config } from './config.js';
import { getMenu } from './menu.js';

const DG = 'https://api.deepgram.com/v1';
const ttsCache = new Map();

function keyterms() {
  const terms = new Set();
  for (const item of getMenu().items) {
    terms.add(item.name);
    for (const alias of item.aliases || []) terms.add(alias);
  }
  return [...terms];
}

export async function transcribe(buffer, mimeType = 'audio/webm') {
  if (config.useMockStt) return 'two lattes and a croissant';
  const started = Date.now();
  const params = new URLSearchParams({ model: config.deepgramSttModel, smart_format: 'true', mip_opt_out: 'true' });
  for (const term of keyterms()) params.append('keyterm', term);
  const res = await fetch(`${DG}/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${config.deepgramApiKey}`, 'Content-Type': mimeType || 'audio/webm' },
    body: buffer,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Deepgram STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const transcript = (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
  console.log(`[timing] deepgram stt ${Date.now() - started}ms: "${transcript}"`);
  return transcript;
}

export async function synthesize(text) {
  if (config.useMockTts) return null;
  if (ttsCache.has(text)) return ttsCache.get(text);
  const started = Date.now();
  const res = await fetch(`${DG}/speak?model=${encodeURIComponent(config.deepgramTtsModel)}`, {
    method: 'POST',
    headers: { Authorization: `Token ${config.deepgramApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Deepgram TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  console.log(`[timing] deepgram tts ${Date.now() - started}ms (${audio.length} bytes)`);
  ttsCache.set(text, audio);
  if (ttsCache.size > 100) ttsCache.delete(ttsCache.keys().next().value);
  return audio;
}
