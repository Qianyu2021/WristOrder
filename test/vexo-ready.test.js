import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/cashier/vexo.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace('export function createVexo', 'function createVexo');
const load = new Function('Band', 'BandAudio', 'canDecodeAudio', 'bandName', 'BAND_NUMBER', 'encodeWav', `${source}\nreturn createVexo;`);
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup(t) {
  const handlers = new Map(), writes = [], errors = [];
  let audio = false;
  const band = {
    connected: true,
    on(name, handler) { handlers.set(name, handler); },
    async configure(options) {
      assert.equal('motion' in options, false, 'the band should not start a motion stream');
      if ('audio' in options) audio = options.audio;
    },
    async setLed(color, options) {
      assert.equal(audio, false, 'LED commands must never run while microphone owns the light');
      writes.push({ color, ...options });
    },
    async disconnect() { this.connected = false; audio = false; },
  };
  class Decoder {
    constructor(callback) { this.callback = callback; }
    push() { this.callback(new Float32Array(320)); }
    close() {}
  }
  const create = load({ connect: async () => band }, Decoder, async () => true, () => 'Test band', 33,
    () => new Blob(['audio']));
  const controller = create({
    onStatus() {}, onError: error => errors.push(error), onConfirm() {},
    async onConversationSegment() {}, async onConversationEnd() {},
  });
  t.after(() => controller.disconnect());
  await controller.connect();
  await tick();
  return { controller, handlers, writes, errors };
}

test('ready feedback blinks and restores the latest order state', async t => {
  const { controller, writes, errors } = await setup(t);
  controller.notifyOrderReady();
  await tick();
  assert.equal(writes.at(-1).color, '#b99bff');
  assert.equal(writes.at(-1).pattern, 'blink');
  controller.updateOrderStatus('awaiting_payment');
  await new Promise(resolve => setTimeout(resolve, 2600));
  assert.equal(writes.at(-1).color, '#ffd166');
  assert.equal(writes.at(-1).pattern, 'solid');
  assert.deepEqual(errors, []);
});

test('ready feedback waits until recording ends, and disconnect drops notifications', async t => {
  const { controller, handlers, writes, errors } = await setup(t);
  handlers.get('tap')();
  await tick();
  handlers.get('audio')({});
  const before = writes.length;
  controller.notifyOrderReady();
  controller.updateOrderStatus('paid');
  await tick();
  assert.equal(writes.length, before, 'recording light remains untouched');
  await controller.stopRecording();
  await tick();
  assert.equal(writes.at(-1).color, '#b99bff');
  assert.deepEqual(errors, []);
  await controller.disconnect();
  const after = writes.length;
  controller.notifyOrderReady();
  await tick();
  assert.equal(writes.length, after);
});
