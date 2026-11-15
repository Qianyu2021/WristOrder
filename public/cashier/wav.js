// The Vexo decoder yields 16 kHz mono Float32 samples; Deepgram accepts a standard PCM WAV.
export function encodeWav(chunks, sampleRate = 16000) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(bytes);
  const word = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  let at = 44;
  for (const chunk of chunks) for (const sample of chunk) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(at, Math.round(value < 0 ? value * 32768 : value * 32767), true);
    at += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
