# Vexo voice integration plan

Team band: `Vexo-HACK-33`. Keep `33` in one app constant and pass it to the kit's `Band.connect` so the browser chooser filters by exact name and service. The kit verifies the reported band number after connecting. Never fall back to another band.

## User flow

1. On the Cashier page in Chrome or Edge, disconnect the kit dashboard, double-tap the band to make it discoverable, and click **Connect Vexo**. The page shows the connection state.
2. Tap the connected band to start recording. Its built-in blue microphone light stays on while it records. Tap again to stop; a 12-second limit also stops recording automatically. A Cashier button can stop a recording if a tap is missed.
3. The page converts the band's Opus packets to 16 kHz mono PCM with the kit's `BandAudio`, wraps the PCM in WAV, and posts it as `audio` to the existing `/api/voice` endpoint. The server already handles Deepgram transcription, Gemini order updates, and read-back. Keys remain on the server in `.env`.
4. Once the microphone is off, the LED indicates processing/checkout/paid state. During recording the band's blue microphone light owns the LED; LED commands are deferred until recording stops. The Cashier page shows connection, recording, errors, and the normal order transcript.

## Code changes

- `public/shared/vexo-config.js`: the one band-number constant.
- `src/server.js`: expose only the kit's browser JavaScript library at a dedicated static path; never expose the workspace root or `.env`.
- `public/cashier/vexo.js` and `public/cashier/wav.js`: connection lifecycle, tap-controlled capture, WebCodecs decoding, WAV encoding, LED state, and bounded recording.
- `public/cashier/index.html`, `app.js`, `style.css`: connect/disconnect and recording controls, status, and reuse the existing voice result handler.
- `TESTING.md` and `README.md`: replace the obsolete assumption that the band is a standard Bluetooth microphone; document the actual browser flow.

## Verification

- Check the WAV header, sample rate, channel count, size and PCM conversion with a focused local test.
- Verify that the browser serves the Vexo library but cannot fetch `.env` through the app.
- Check that simulated band connection and tap events work with band 33, and that a stopped capture reaches the existing voice route.
- Manually verify on the real band: disconnect dashboard; double-tap to discover; connect only `Vexo-HACK-33`; tap, speak a cafe order, tap; confirm transcript/order and LED response. A paid order should turn the LED green. Only the user can click Chrome's Bluetooth picker and speak into the physical band.

## Constraints

- The Vexo kit is currently ignored by Git. A fresh checkout needs the same `vexo-open-kit/` folder to run this integration. Keep this dependency documented until the library is vendored or packaged.
- The band has no speaker. Read-back audio plays from the laptop.
- If Web Bluetooth or WebCodecs is unavailable, the Cashier page retains its existing laptop-microphone path.
