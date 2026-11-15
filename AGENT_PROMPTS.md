# WristOrder — Agent Session Prompts

Start **5 Claude Code sessions**, all in `/Users/qian/Hackathon/WristOrder`:

| Session | Name | Start when | Builds |
|---|---|---|---|
| 1 | Lead | Right away | WS0 core, later WS6 integration |
| 2 | Voice | After Lead posts `CP0 ready` | WS1 |
| 3 | Payments | After `CP0 ready` | WS2 |
| 4 | Screens | After `CP0 ready` | WS3 |
| 5 | Owner | After `CP0 ready` | WS4 |

You (no agent) handle WS5: the Vexo bracelet, API keys, and manual testing with `TESTING.md`.

**Ports, so sessions don't collide:** you run the real app on port 3000 (`npm run dev`, which restarts automatically when files change). Each agent tests on its own port: Lead 3001, Voice 3002, Payments 3003, Screens 3004, Owner 3005.

**Before starting:** run `git init && git add -A && git commit -m "plan"` in the folder so you can undo a bad change. Fill in `.env` once the Lead creates `.env.example`.

Copy each prompt below into its session exactly as written.

---

## Session 1 — Lead

```
You are the Lead agent for WristOrder, a 5-hour hackathon project. Read PLAN.md fully, and skim TESTING.md.

Your job now: build WS0 (Foundation) exactly as described in PLAN.md §5 WS0, using the contracts in §4.

Important:
- Include every dependency the other workstreams need in package.json now, including multer, so other agents never have to edit package.json: express, @google/genai, stripe, qrcode, better-sqlite3, resend, node-cron, dotenv, multer. Run npm install.
- Create stub routers (routes/voice.js, routes/payment.js, routes/owner.js) and placeholder index.html pages so server.js never needs editing by other agents.
- Make server.js read PORT from env so agents can run on different ports.
- Add GET /api/health and create NOTES.md with the headings from PLAN.md.
- Create data/menu.json with the required item ids listed in WS0 step 4.
- Test on PORT=3001, not 3000 (the human uses 3000).

When WS0 passes its acceptance checks, append "CP0 ready — Lead — <notes>" to NOTES.md under "Ready for manual test", then tell me in one short message so I can start the other four sessions.

After that, stay available. Your second job (WS6, integration) starts when I tell you. Until then, if I paste a bug report or a contract change request from NOTES.md, handle it. Only you may edit server.js, config.js, events.js, order.js, menu.js, menu.json and package.json.
```

**Later, when CP1–CP9 are mostly done, send the Lead:**

```
Start WS6 (Integration & demo polish) from PLAN.md. Read NOTES.md first for status and known issues. Run the full live flow with real keys on port 3001, fix integration bugs across files (you may now edit any file, but tell the owning agent's session via NOTES.md if you change their files), make all error paths from TESTING.md CP10 behave gracefully, and write README.md. Post "CP10 ready" in NOTES.md when done.
```

---

## Session 2 — Voice (Agent 1, WS1)

```
You are Agent 1 (Voice) for WristOrder, a 5-hour hackathon project. Read PLAN.md (especially §1, §2, §4 contracts, §5 "Manual test checkpoints", and WS1), NOTES.md, and the CP2–CP4 sections of TESTING.md.

Build WS1. You own only these files: public/shared/recorder.js, src/routes/voice.js, src/speech.js, src/ai/gemini.js, src/ai/readback.js. Do not edit any other file or package.json. If you need a contract change, write it in NOTES.md under "Contract change requests" and continue.

Build in this order, announcing each checkpoint in NOTES.md under "Ready for manual test" as you reach it:
0. Mock mode first: POST /api/voice with JSON {text} works using the mock keyword parser, so the Screens agent can use it right away. Post "WS1 mocks ready" in NOTES.md.
1. CP2: real Gemini parsing of typed text + deterministic readback.
2. CP3: recorder.js + Deepgram transcription + multipart audio upload.
3. CP4: Deepgram Aura read-back via GET /api/tts + per-step timing logs.

For "confirm", import startCheckout from the Payments agent's module as PLAN.md describes, wrapped in try/catch so you work before it exists.

Test with PORT=3002 (never 3000). Run the acceptance checks for each part before announcing it. Check NOTES.md "Known issues" between parts and fix bugs reported for your files before starting the next part.
```

---

## Session 3 — Payments (Agent 2, WS2)

```
You are Agent 2 (Payments) for WristOrder, a 5-hour hackathon project. Read PLAN.md (especially §1, §2, §4 contracts, §5 "Manual test checkpoints", and WS2), NOTES.md, and the CP1 and CP5 sections of TESTING.md.

Build WS2. You own only these files: src/stripe.js, src/routes/payment.js. Do not edit any other file or package.json. If you need a contract change, write it in NOTES.md under "Contract change requests" and continue.

Build in this order:
0. Mock mode first: POST /api/checkout and POST /api/checkout/mock-pay work without a Stripe key, including QR generation, order status changes and the SSE "paid" event. Export startCheckout() for the Voice agent. Post "WS2 mocks ready" in NOTES.md under "Ready for manual test".
1. CP5: live Stripe Checkout with polling every 2 s (no webhooks), GET /api/kitchen, and saving paid orders through the Owner agent's db.saveOrder (import lazily, wrapped in try/catch so it works before that exists). Post "CP5 ready" when acceptance checks pass.

Test with PORT=3003 (never 3000). Use Stripe test mode only. Check NOTES.md "Known issues" between parts and fix bugs reported for your files first.
```

---

## Session 4 — Screens (Agent 3, WS3)

```
You are Agent 3 (Screens) for WristOrder, a 5-hour hackathon project. Read PLAN.md (especially §4 contracts, §5 "Manual test checkpoints", and WS3), NOTES.md, and the CP1 section of TESTING.md.

Build WS3: the cashier, customer and kitchen pages. You own only: public/shared/sse.js, public/shared/format.js, public/cashier/*, public/customer/*, public/kitchen/*. Do not edit any other file. If you need a contract change, write it in NOTES.md under "Contract change requests" and continue.

Design: dark, high contrast, large type readable from 2 meters, brand name "WristOrder", no frameworks. The customer screen is what judges watch, so make the order appearing, the QR code and the "Paid" moment look great.

The Voice and Payments agents are building in parallel. Start with the pages against the SSE stream and GET /api/order. When NOTES.md shows "WS1 mocks ready" and "WS2 mocks ready", wire up the text box, Confirm and Simulate payment. For push-to-talk, use createRecorder and listInputDevices from public/shared/recorder.js (owned by the Voice agent); if it isn't there yet, build the UI and connect it once it appears.

When everything in the CP1 table of TESTING.md passes with all services mocked, post "CP1 ready — Screens" in NOTES.md under "Ready for manual test". Then finish push-to-talk on the cashier page (hold Space, mic selector, level meter, playing the read-back audio).

Test with PORT=3004 (never 3000). Check NOTES.md "Known issues" regularly and fix bugs reported for your files first.
```

---

## Session 5 — Owner (Agent 4, WS4)

```
You are Agent 4 (Owner & data) for WristOrder, a 5-hour hackathon project. Read PLAN.md (especially §1, §2, §4 contracts, §5 "Manual test checkpoints", and WS4), NOTES.md, and the CP7–CP9 sections of TESTING.md.

Build WS4. You own only: src/db.js, scripts/seed.js, src/stats.js, src/report.js, src/email.js, src/ai/ownerAssistant.js, src/routes/owner.js, public/owner/*. Do not edit any other file or package.json. If you need a contract change, write it in NOTES.md under "Contract change requests" and continue.

Build in this order, announcing each checkpoint in NOTES.md under "Ready for manual test":
1. CP7: db.js (export saveOrder early, since the Payments agent calls it), seed.js with believable 28-day history, stats.js, and the owner dashboard page with KPI tiles, charts and the ingredient/restock table.
2. CP8: AI weekly report (Gemini, with a template fallback), Resend email, the report buttons, and the node-cron schedule.
3. CP9: owner Q&A by voice or text, using speech.transcribe/synthesize from src/speech.js (owned by the Voice agent) and recorder.js for push-to-talk. If those aren't ready yet, build with text input first.

The dashboard is shown to judges: make it clean and readable on a projector. Stats must be computed in code, never by the LLM; the LLM only writes the summary from the computed numbers.

Test with PORT=3005 (never 3000). Seeding writes to data/wristorder.db, which everyone shares; that's fine. Check NOTES.md "Known issues" between parts and fix bugs reported for your files first.
```

---

## Tips while the sessions run

- **Watch `NOTES.md`.** It's the shared board: what's ready to test, bugs, and requests between agents.
- **When you find a bug**, paste the bug report (template at the bottom of `TESTING.md`) into `NOTES.md` under "Known issues" *and* into the owning agent's session.
- **If an agent asks to edit a file it doesn't own**, say no and point it to "Contract change requests". The Lead resolves those.
- **Commit after each checkpoint passes:** `git add -A && git commit -m "CP2 passes"`. That gives you a known-good point to roll back to.
- **If time runs short**, tell the Owner agent to stop after CP8, then CP7, per the cut list in `PLAN.md` §7.
