# WristOrder build notes

## Status
- All workstreams WS0–WS4 implemented. Full flow verified in mock mode (2026-11-14): voice text → order → readback → confirm → QR → mock-pay → paid → kitchen ticket → owner stats.
- Added src/speech.js (Deepgram STT with menu keyterms + Aura TTS, cached, 15 s / 10 s timeouts).
- Cashier, customer, kitchen pages built (public/cashier, public/customer, public/kitchen).
- Voice route logs per-step timing: `[timing] voice turn: stt Xms, gemini Yms, total Zms`.
- Failure paths (bad Gemini/Deepgram key) return spoken readback + SSE error; server never crashes.
- Presentation screen and order-ready feedback loop pass the isolated mock payment → kitchen → ready → SSE → restart integration check. Simulated Vexo LED tests pass. Live Stripe and physical-band rehearsal remain.
- Pastry inventory persists in SQLite. Mock integration verifies reserve → paid consume, confirmed expiry release, sold-out rejection, and stock preservation after restart. Owner now lists the last seven days' most popular items; Cashier and Customer have paid-order rankings.
- Not yet run against live keys: Gemini, Deepgram, Stripe, Resend. Not yet clicked through in a browser.

## Ready for manual test
- CP1 ready — cashier/customer/kitchen work with all services mocked.
- CP2 ready (mock parser) — live Gemini needs GEMINI_API_KEY.
- CP3/CP4 ready (mock) — live audio needs DEEPGRAM_API_KEY; test push-to-talk in Chrome.
- CP5 ready (mock pay) — live Stripe needs sk_test key; set PUBLIC_BASE_URL to a LAN IP so a phone can reach the success page.
- CP7–CP9 ready — run `npm run seed` for demo data.
- CP11 ready (mock) — open `/demo`, `/kitchen`, `/pickup`, and `/cashier`; pay a test order, mark its kitchen ticket ready, then refresh the displays. Physical-band LED and live Stripe still need rehearsal.
- CP12 ready (mock) — order pastries, confirm checkout, verify available counts fall; mock pay to deduct stock, or use mock expiry/cancel to release it. Check Cashier/Customer availability and Owner popular items after payment.

## Contract change requests

## Known issues
- mock-pay pays the current order; the `?mockpay=<id>` value is only a flag (fine for one register).
- Live Gemini: `thinkingBudget: 0` is set for flash models for latency; check accuracy on CP2 phrases.

## Vexo
- Band 33 was connected in the kit dashboard by the user. The Cashier integration now uses the kit's browser library, tap-controlled microphone capture, WAV upload to `/api/voice`, and paid-status LED feedback. It still needs an interactive Chrome test on the physical band after disconnecting the dashboard.
