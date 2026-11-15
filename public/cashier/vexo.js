import { Band, BandAudio, canDecodeAudio, bandName } from '/vexo/js/src/index.js';
import { BAND_NUMBER } from '/shared/vexo-config.js';
import { encodeWav } from './wav.js';

const TRANSCRIPT_SEGMENT_MS = 4000;
const DECODER_DRAIN_MS = 500;
const CONFIRM_GESTURE_MS = 4000;
const CONFIRM_COOLDOWN_MS = 5000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const colors = { building: '#b9c9dd', awaiting_payment: '#ffd166', paid: '#65e6a1', cancelled: '#ff7b7b' };

export function createVexo({ onStatus, onError, onConversationSegment, onConversationEnd, onConfirm }) {
  let band = null;
  let capture = null;
  let state = 'disconnected';
  let orderStatus = 'building';
  let ledQueue = Promise.resolve();
  let readyPending = false;
  let readyUntil = 0;
  let readyTimer;
  let connectAttempt = 0;
  let confirmArmedAt = 0;
  let lastConfirmedAt = 0;

  const status = (next, message) => { state = next; onStatus(next, message); };
  const error = e => onError(e?.message || String(e));
  const updateLed = () => {
    const current = band;
    if (!current?.connected || capture || state === 'recording' || state === 'starting' || state === 'stopping') return;
    ledQueue = ledQueue.catch(() => {}).then(async () => {
      if (band !== current || !current.connected || capture || ['recording', 'starting', 'stopping'].includes(state)) return;
      const processing = state === 'processing';
      if (state === 'ready' && readyPending) {
        readyPending = false;
        readyUntil = Date.now() + 2500;
        clearTimeout(readyTimer);
        readyTimer = setTimeout(() => { readyUntil = 0; updateLed(); }, 2500);
      }
      const readySignal = state === 'ready' && Date.now() < readyUntil;
      await current.setLed(readySignal ? '#b99bff' : processing ? '#ffd166' : colors[orderStatus] || colors.building,
        { pattern: processing || readySignal ? 'blink' : 'solid', period: 500, brightness: 0.5 });
    }).catch(error);
  };

  function abortCapture() {
    if (!capture) return;
    clearInterval(capture.segmentTimer);
    capture.decoder.close();
    capture = null;
  }

  async function failCapture(e) {
    const current = band;
    abortCapture();
    if (current?.connected) await current.configure({ audio: false }).catch(() => {});
    if (current?.connected && band === current && state !== 'reconnecting') {
      status('ready', 'Vexo is connected. Tap to retry.');
      updateLed();
      error(e);
    }
  }

  async function stopRecording() {
    if (state !== 'recording' || !capture || !band) return;
    const active = capture;
    const current = band;
    clearInterval(active.segmentTimer);
    status('stopping', 'Finishing Vexo recording…');
    try {
      await current.configure({ audio: false });
      // WebCodecs delivers decoded packets asynchronously; wait for the last frame.
      const until = Date.now() + DECODER_DRAIN_MS;
      await wait(50);
      while (capture === active && active.samples < active.frames * 320 - 32 && Date.now() < until) await wait(25);
      if (capture !== active || band !== current) return;
      active.decoder.close();
      await sendSegment(active);
      if (capture !== active || band !== current) return;
      if (active.transcriptionFailed) throw new Error('Some audio could not be transcribed. Please review the transcript and try again.');
      capture = null;
      if (!active.receivedAudio) throw new Error('No sound arrived from the band. Tap again to retry.');
      status('processing', 'Writing the complete conversation into the order…');
      updateLed();
      await onConversationEnd();
      if (band === current && state === 'processing') {
        status('ready', 'Ready. Tap the band to speak again.');
        updateLed();
      }
    } catch (e) {
      if (capture === active) await failCapture(e);
      else if (band === current && current.connected && ['stopping', 'processing'].includes(state)) {
        status('ready', 'Vexo is connected. Tap to retry.');
        updateLed();
        error(e);
      }
    }
  }

  async function startRecording() {
    if (state !== 'ready' || !band) return;
    const current = band;
    status('starting', 'Turning on the Vexo microphone…');
    // Let any LED write finish before the microphone takes ownership of the light.
    await ledQueue;
    if (band !== current || state !== 'starting') return;
    clearTimeout(readyTimer);
    readyUntil = 0;
    try {
      const active = { chunks: [], decoder: null, segmentTimer: null, frames: 0, samples: 0, receivedAudio: false, transcriptionFailed: false, sending: Promise.resolve() };
      active.decoder = new BandAudio(samples => {
        if (capture === active && samples.length) {
          active.chunks.push(samples);
          active.samples += samples.length;
          active.receivedAudio = true;
        }
      }, { onError: e => { if (capture === active) void failCapture(e); } });
      capture = active;
      await current.configure({ audio: true });
      if (capture !== active || band !== current) return;
      status('recording', 'Listening to the conversation. Say “stop listening” when the order is complete.');
      active.segmentTimer = setInterval(() => { void sendSegment(active).catch(error); }, TRANSCRIPT_SEGMENT_MS);
    } catch (e) {
      await failCapture(e);
    }
  }

  async function sendSegment(active) {
    if (capture !== active || !active.chunks.length) return active.sending;
    const chunks = active.chunks.splice(0);
    active.sending = active.sending.catch(() => {}).then(async () => {
      // A phrase can finish the session while this upload is in flight.
      // The transcript still belongs to that conversation, so deliver it first.
      const wav = encodeWav(chunks);
      await onConversationSegment(wav);
    }).catch(e => {
      active.transcriptionFailed = true;
      throw e;
    });
    return active.sending;
  }

  function onTap() {
    if (state === 'ready') void startRecording();
  }

  function onOrientation(event) {
    const now = Date.now();
    const faceUp = event.face === '+z';
    if (state !== 'ready') return;
    if (event.face === '-z') {
      confirmArmedAt = now;
      status('ready', 'Confirmation armed. Turn the bracelet face-up.');
      return;
    }
    if (!faceUp || !confirmArmedAt || now - confirmArmedAt > CONFIRM_GESTURE_MS || now - lastConfirmedAt < CONFIRM_COOLDOWN_MS) return;
    confirmArmedAt = 0;
    lastConfirmedAt = now;
    status('processing', 'Confirming order from wrist gesture…');
    updateLed();
    Promise.resolve(onConfirm()).then(() => {
      if (band && state === 'processing') {
        status('ready', 'Order confirmed by wrist gesture.');
        updateLed();
      }
    }).catch(e => {
      if (band) {
        status('ready', 'Could not confirm. Add an item and try the gesture again.');
        updateLed();
      }
      error(e);
    });
  }

  async function connect() {
    if (band || state === 'connecting') return;
    const mine = ++connectAttempt;
    status('connecting', `Pick ${bandName(BAND_NUMBER)} in Chrome’s Bluetooth popup.`);
    let connected;
    try {
      // Calling connect directly from the click preserves Chrome's Bluetooth permission gesture.
      connected = await Band.connect(BAND_NUMBER, { autoReconnect: true });
      if (mine !== connectAttempt) { await connected.disconnect(); return; }
      if (!(await canDecodeAudio())) throw new Error('Vexo audio needs current Chrome or Edge with WebCodecs.');
      if (mine !== connectAttempt) { await connected.disconnect(); return; }
      band = connected;
      connected.on('tap', onTap);
      connected.on('orientation', onOrientation);
      connected.on('audio', frame => { if (capture) { capture.frames++; capture.decoder.push(frame); } });
      connected.on('stream-taken', event => {
        if (event.stopped?.includes('audio')) {
          abortCapture();
          status('ready', 'Another program took the microphone. Close it, then reconnect.');
          error(event.message || 'Another program took the Vexo microphone.');
        } else if (event.stopped?.includes('events')) {
          status(state, state === 'recording'
            ? 'Tap events stopped. Use Stop band recording, then reconnect Vexo.'
            : 'Another program took tap events. Disconnect and reconnect Vexo.');
        }
      });
      connected.on('reconnecting', () => {
        abortCapture();
        status('reconnecting', 'Vexo connection lost. Reconnecting…');
      });
      connected.on('reconnected', async () => {
        // Auto-reconnect restores the previous streams, including audio from an interrupted recording.
        try { await connected.configure({ audio: false }); }
        catch (e) { error(e); }
        if (band !== connected) return;
        status('ready', 'Vexo reconnected. Tap to speak.');
        updateLed();
      });
      connected.on('disconnect', () => {
        if (band !== connected) return;
        clearTimeout(readyTimer); readyPending = false; readyUntil = 0;
        abortCapture(); band = null;
        status('disconnected', 'Vexo disconnected. Double-tap the band before reconnecting.');
      });
      await connected.configure({ events: true });
      if (band !== connected) return;
      status('ready', 'Vexo connected. Tap the band to speak.');
      updateLed();
    } catch (e) {
      await connected?.disconnect().catch(() => {});
      if (mine === connectAttempt) {
        band = null;
        status('disconnected', 'Vexo not connected. Disconnect the dashboard and double-tap the band, then retry.');
        error(e);
      }
    }
  }

  async function disconnect() {
    ++connectAttempt;
    const current = band;
    clearTimeout(readyTimer); readyPending = false; readyUntil = 0;
    confirmArmedAt = 0;
    abortCapture(); band = null;
    status('disconnected', 'Vexo disconnected.');
    if (current) await current.disconnect().catch(error);
  }

  return {
    connect, disconnect, stopRecording,
    notifyOrderReady() {
      if (!band?.connected) return;
      readyPending = true;
      updateLed();
    },
    updateOrderStatus(next) { if (next && next !== orderStatus) { orderStatus = next; updateLed(); } },
  };
}
