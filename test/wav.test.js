import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../public/cashier/wav.js';

test('Vexo samples produce a 16 kHz mono PCM WAV accepted by the voice route', async () => {
  const wav = encodeWav([Float32Array.of(-1, -0.5), Float32Array.of(0, 0.5, 1)]);
  const data = new DataView(await wav.arrayBuffer());
  const label = (at, size) => String.fromCharCode(...new Uint8Array(data.buffer, at, size));
  assert.equal(wav.type, 'audio/wav');
  assert.equal(label(0, 4), 'RIFF');
  assert.equal(label(8, 4), 'WAVE');
  assert.equal(label(12, 4), 'fmt ');
  assert.equal(data.getUint16(20, true), 1);
  assert.equal(data.getUint16(22, true), 1);
  assert.equal(data.getUint32(24, true), 16000);
  assert.equal(data.getUint16(34, true), 16);
  assert.equal(label(36, 4), 'data');
  assert.equal(data.getUint32(40, true), 10);
  assert.equal(data.byteLength, 54);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => data.getInt16(44 + i * 2, true)),
    [-32768, -16384, 0, 16384, 32767]);
});
