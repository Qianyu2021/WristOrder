# WristOrder — Build Plan for Implementing Agents

> A cashier talks to a Vexo bracelet to build a customer's order. The customer sees the order live on a customer-facing screen, pays by scanning a Stripe QR code with their own phone, and the kitchen gets a ticket. Every paid order is stored; the owner gets a dashboard, a weekly AI-written report (popular dishes + ingredient usage), and can ask the bracelet questions about sales.

**Hard constraint:** 5-hour solo hackathon. Favor working over clever. Every external service must have a **mock mode** so work can proceed without keys or hardware.

**Current time budget: 30 minutes of building time; submission at 6 p.m. America/Los_Angeles on 2026-11-14 (user clarification).** Use parallel agents for the presentation screen and order-ready feedback loop, then integrate and verify. The 30-minute allocation is for implementation, not submission preparation. This overrides the earlier feature freeze and schedule.

**Current feature scope (updated 2026-11-14):** §9.3 pastry inventory tracking and the most popular items list are implemented and pass mock checks. The presentation screen and order-ready feedback also remain available, but are not required for the hackathon. Live payment and physical-band rehearsal remain. Live provisional corrections and bilingual ordering remain deferred.

---

## 1. Stack (do not substitute)

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+, ESM (`"type": "module"`), plain JavaScript (no TypeScript, no build step) |
| Server | Express 4 |
| Realtime to browsers | Server-Sent Events (`GET /api/events`), no socket library |
| Frontend | Static HTML + vanilla JS + one CSS file per page, served from `public/`. Chart.js from CDN (`https://cdn.jsdelivr.net/npm/chart.js@4.4.1`) for the owner page only |
| Speech-to-text | Deepgram pre-recorded API via `fetch` (no SDK): `POST https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&keyterm=<menu name>&keyterm=...`, header `Authorization: Token <key>`, `Content-Type` = the recording's mime type, body = raw audio bytes. Transcript at `results.channels[0].alternatives[0].transcript`. Pass every menu item name and alias as a `keyterm` so Deepgram hears them correctly |
| LLM (text only) | Google Gemini via `@google/genai`. Model from env `GEMINI_MODEL` (default `gemini-2.5-flash`). Receives Deepgram's transcript, never audio |
| Voice read-back | Deepgram Aura text-to-speech via `fetch`: `POST https://api.deepgram.com/v1/speak?model=<DEEPGRAM_TTS_MODEL>`, header `Authorization: Token <key>`, JSON body `{ "text": "..." }`, returns MP3 audio |
| Payments | Stripe Checkout (test mode), `stripe` npm package |
| QR code | `qrcode` npm package (`QRCode.toDataURL`) |
| Database | SQLite via `better-sqlite3`, file `data/wristorder.db` |
| Email | Resend (`resend` npm package). Test sender `onboarding@resend.dev` |
| Scheduler | `node-cron` |
| Env | `dotenv` |

**Money is always integer cents** internally. Format only at display time.

---

## 2. Environment (`.env.example`)

```
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

DEEPGRAM_API_KEY=
DEEPGRAM_STT_MODEL=nova-3
DEEPGRAM_TTS_MODEL=aura-2-thalia-en

STRIPE_SECRET_KEY=sk_test_...

RESEND_API_KEY=
REPORT_TO_EMAIL=
REPORT_CRON=0 8 * * 1        # Mondays 08:00; empty = disabled

# Mock switches: "1" forces mock even if a key exists. Missing key => mock automatically.
MOCK_GEMINI=
MOCK_STT=
MOCK_TTS=
MOCK_STRIPE=
MOCK_EMAIL=
```

`src/config.js` exports a frozen config object and booleans `useMockGemini`, `useMockStt`, `useMockTts`, `useMockStripe`, `useMockEmail` (true if the MOCK flag is `1` OR the key is empty; STT and TTS both use `DEEPGRAM_API_KEY`). Log at startup which services are live vs mocked.

---

## 3. File Layout and Ownership

Each workstream (WS) owns its files exclusively. Do not edit files owned by another WS. If you need a change to a shared contract, write it in `NOTES.md` under "Contract change requests" and continue against the current contract.

```
WristOrder/
├── package.json                  WS0
├── .env.example                  WS0
├── NOTES.md                      shared (append only)
├── data/
│   ├── menu.json                 WS0
│   └── wristorder.db             (generated, gitignored)
├── scripts/
│   └── seed.js                   WS4
├── src/
│   ├── server.js                 WS0  (mounts all routers; no feature logic)
│   ├── config.js                 WS0
│   ├── events.js                 WS0  (SSE bus)
│   ├── menu.js                   WS0  (load menu, price a line)
│   ├── order.js                  WS0  (active order state + mutations)
│   ├── routes/
│   │   ├── voice.js              WS1
│   │   ├── payment.js            WS2
│   │   └── owner.js              WS4
│   ├── ai/
│   │   ├── gemini.js             WS1  (order parsing)
│   │   ├── readback.js           WS1
│   │   └── ownerAssistant.js     WS4
│   ├── speech.js                 WS1  (Deepgram: transcribe + synthesize)
│   ├── stripe.js                 WS2
│   ├── db.js                     WS4
│   ├── stats.js                  WS4
│   ├── report.js                 WS4
│   └── email.js                  WS4
└── public/
    ├── shared/
    │   ├── recorder.js           WS1  (push-to-talk -> audio Blob)
    │   ├── sse.js                WS3
    │   └── format.js             WS3
    ├── cashier/  index.html app.js style.css   WS3
    ├── customer/ index.html app.js style.css   WS3
    ├── kitchen/  index.html app.js style.css   WS3
    └── owner/    index.html app.js style.css   WS4
```

WS0 creates **stub files** for every router (`export default express.Router()`) so `server.js` mounts everything from the start and other WSs never touch it.

---

## 4. Shared Contracts (source of truth)

### 4.1 Menu (`data/menu.json`)

```json
{
  "currency": "usd",
  "items": [
    {
      "id": "latte",
      "name": "Latte",
      "aliases": ["cafe latte"],
      "category": "drinks",
      "price_cents": 450,
      "modifiers": ["size_large", "oat_milk", "extra_shot"],
      "ingredients": { "espresso_g": 18, "milk_ml": 200, "cup": 1 }
    }
  ],
  "modifiers": [
    { "id": "size_large", "name": "Large", "price_cents": 75,
      "ingredients": { "milk_ml": 80 } },
    { "id": "oat_milk", "name": "Oat milk", "price_cents": 50,
      "ingredients": { "milk_ml": -200, "oat_milk_ml": 200 } },
    { "id": "warmed", "name": "Warmed", "price_cents": 0, "ingredients": {} }
  ],
  "ingredient_units": { "espresso_g": "g", "milk_ml": "ml", "oat_milk_ml": "ml", "cup": "pcs" }
}
```

Provide **12–15 café items** (espresso drinks, tea, pastries, sandwiches) with realistic prices and ingredients. Modifier ingredient values are deltas added to the base recipe (per unit).

`src/menu.js` exports:
- `getMenu()` → the parsed object
- `findItem(id)`, `findModifier(id)`
- `priceLine({ menu_id, qty, modifiers })` → `{ unit_price_cents, line_total_cents }`
- `ingredientsForLine({ menu_id, qty, modifiers })` → `{ [ingredient]: amount }`

### 4.2 Order object (single active order — one register)

```js
{
  id: "ord_<short random>",
  status: "building" | "awaiting_payment" | "paid" | "cancelled",
  lines: [
    { line_id: 1, menu_id: "latte", name: "Latte", qty: 2,
      modifiers: ["size_large", "oat_milk"], modifier_names: ["Large", "Oat milk"],
      unit_price_cents: 575, line_total_cents: 1150 }
  ],
  total_cents: 1150,
  last_heard: "two large oat lattes",      // last transcript
  last_readback: "Two large oat-milk lattes. Total $11.50. Say confirm to pay.",
  checkout: null | { session_id, url, qr_data_url },
  created_at: ISOString,
  paid_at: null | ISOString
}
```

`src/order.js` exports (all mutations recompute prices/total and call `events.broadcast('order', getOrder())`):
- `getOrder()`
- `newOrder()` — starts a fresh `building` order
- `addItem(menu_id, qty = 1, modifiers = [])` — merges into an existing line if same menu_id + same modifier set
- `removeItem({ line_id?, menu_id? })`
- `updateItem(line_id, { qty?, modifiers? })` — qty 0 removes the line
- `clearOrder()`
- `setHeard(text)`, `setReadback(text)`
- `setAwaitingPayment(checkout)`, `markPaid()`, `cancelOrder()`
- `lastPaidOrders()` — in-memory list (max 20) for the kitchen page on load

Mutations are rejected (throw `Error`) when status is not `building`, except `cancelOrder` and `markPaid`.

### 4.3 SSE events (`GET /api/events`)

Each message: `event: <type>\ndata: <json>\n\n`. On connect, the server immediately sends the current `order`.

| type | data | When |
|---|---|---|
| `order` | Order object | Any order change |
| `paid` | Order object | Payment confirmed (also triggers kitchen ticket) |
| `readback` | `{ text, audio_url }` | After a voice turn, so any screen with a speaker can play it |
| `error` | `{ message }` | User-visible error (e.g. "Didn't catch that") |

`src/events.js` exports `sseHandler(req, res)` and `broadcast(type, data)`. Send a `: ping` comment every 20 s.

### 4.4 HTTP API

| Method + path | Owner | Request | Response |
|---|---|---|---|
| `GET /api/menu` | WS0 | — | menu.json |
| `GET /api/order` | WS0 | — | Order |
| `POST /api/order/new` | WS0 | — | Order |
| `POST /api/voice` | WS1 | `multipart/form-data` field `audio` (browser recording, e.g. webm/opus) **or** JSON `{ text }` | `{ heard, actions: [...], order, readback: { text, audio_url } }` |
| `GET /api/tts?text=...` | WS1 | — | `audio/mpeg` (mock: 204 No Content) |
| `POST /api/checkout` | WS2 | — | Order (status `awaiting_payment`, `checkout` filled) |
| `POST /api/checkout/mock-pay` | WS2 | — | Order (only in mock Stripe mode; 404 otherwise) |
| `GET /api/kitchen` | WS2 | — | `lastPaidOrders()` |
| `GET /api/owner/stats?days=28` | WS4 | — | see §7 |
| `GET /api/owner/report` | WS4 | — | `{ period, stats, summary_markdown }` |
| `POST /api/owner/report/send` | WS4 | — | `{ sent: bool, to, mocked: bool, summary_markdown }` |
| `POST /api/owner/ask` | WS4 | multipart `audio` or JSON `{ text }` | `{ heard, answer, audio_url }` |

Errors: JSON `{ error: "message" }` with 4xx/5xx. Never crash the server on an external API failure.

---

## 5. Workstreams

**Order of execution:** WS0 first (alone, ~30 min). Then WS1, WS2, WS3, WS4 run **in parallel**. WS5 (Vexo) is done by the human alongside, with agent help. WS6 integration last.

Each task lists **acceptance checks** — run them before reporting done.

### Manual test checkpoints

The human tests features by hand as they land, using `TESTING.md`. Build in the order below so each checkpoint (CP) is usable as early as possible. When you reach one, run your acceptance checks, then append to `NOTES.md` → "Ready for manual test": `CP<n> ready — <agent> — <one line on anything the tester should know>`. Keep working on your next part while the human tests; fix reported bugs before starting new parts.

| CP | Delivered by | Build these parts first |
|---|---|---|
| CP0 | WS0 | Everything in WS0, including `/api/health` |
| CP1 | WS3 (+ mocks from WS1/WS2) | Cashier text box, customer screen, kitchen screen, mock pay button |
| CP2 | WS1 part 1 | `gemini.js`, `readback.js`, `POST /api/voice` with JSON `{ text }` |
| CP3 | WS1 part 2 | `recorder.js`, `speech.transcribe()`, multipart audio in `/api/voice` |
| CP4 | WS1 part 3 | `speech.synthesize()`, `GET /api/tts`, per-step timing logs |
| CP5 | WS2 | Live Stripe checkout, QR, polling (mock pay first so CP1 works) |
| CP6 | WS5 | Cashier connects to band 33 through the Vexo browser library; tap recording reaches `/api/voice` |
| CP7 | WS4 part 1 | `db.js`, `seed.js`, `stats.js`, owner dashboard (no report, no ask) |
| CP8 | WS4 part 2 | `report.js`, `email.js`, report buttons |
| CP9 | WS4 part 3 | `ownerAssistant.js`, `/api/owner/ask`, ask box on owner page |
| CP10 | WS6 | Full live flow + error handling |

WS1 and WS2 must ship their **mock** behavior before anything else, so WS3 can reach CP1 without waiting for real Gemini, Deepgram or Stripe.

---

### WS0 — Foundation (blocking, do first)

1. `package.json` with dependencies from §1, scripts:
   - `"dev": "node --watch --env-file=.env src/server.js"` (fall back to `dotenv` import if `--env-file` unavailable)
   - `"start": "node src/server.js"`
   - `"seed": "node scripts/seed.js"`
2. `.env.example`, `.gitignore` (`node_modules`, `.env`, `data/*.db`).
3. `src/config.js` per §2.
4. `data/menu.json` per §4.1 (12–15 items; must include `latte`, `cappuccino`, `americano`, `espresso`, `chai_latte`, `matcha_latte`, `iced_tea`, `croissant`, `blueberry_muffin`, `ham_cheese_sandwich`, `avocado_toast`, because the manual tests in `TESTING.md` use them; include modifiers `size_large`, `size_small` (−50), `oat_milk`, `extra_shot`, `decaf`, `warmed`, `no_ice`).
5. `src/menu.js`, `src/events.js`, `src/order.js` per §4.
6. `src/server.js`: JSON body parser, static `public/`, routes `/cashier`, `/customer`, `/kitchen`, `/owner` → respective `index.html`, `/` → simple links page, mount routers `voice`, `payment`, `owner` under `/api`, menu/order endpoints from §4.4, global error handler.
7. Stub routers for WS1/WS2/WS4 and placeholder `index.html` for each page.
8. `GET /api/health` → `{ gemini, stt, tts, stripe, email }`, each `"live"` or `"mock"`.
9. `NOTES.md` with headings "Status", "Ready for manual test", "Contract change requests", "Known issues", "Vexo".

**Acceptance:**
- `npm install && npm run dev` starts with a log of live/mocked services.
- `curl localhost:3000/api/menu` returns the menu.
- `curl -N localhost:3000/api/events` immediately prints an `order` event.
- A quick node REPL / script calling `addItem('latte', 2, ['oat_milk'])` produces correct `total_cents` and an SSE `order` event.

---

### WS1 — Voice → Order (Deepgram + Gemini) + Read-back (Deepgram Aura)

**1. `public/shared/recorder.js`** — push-to-talk recorder.
- `createRecorder({ deviceId? })` → `{ start(), stop(): Promise<Blob> }`.
- Use `getUserMedia({ audio: { deviceId } })` + `MediaRecorder` and return the recorded Blob as-is (Chrome: `audio/webm;codecs=opus`). Deepgram accepts browser formats directly, so **no WAV conversion**. Send the Blob's `type` along so the server can set `Content-Type`.
- Export `listInputDevices()` so the cashier page can choose a standard laptop or USB microphone. Vexo uses its own Bluetooth audio stream (WS5).

**2. `src/speech.js`** — all Deepgram calls, using `fetch`.
- `transcribe(buffer, mimeType)` → `string`. Calls `/v1/listen` with `model=DEEPGRAM_STT_MODEL`, `smart_format=true`, and one `keyterm` query param per menu item name and alias (from `menu.js`). Returns the trimmed transcript; empty string if nothing heard. Mock → `"two lattes and a croissant"`.
- `synthesize(text)` → `Buffer | null`. Calls `/v1/speak?model=DEEPGRAM_TTS_MODEL`. Cache by text in memory (Map, max 100). Mock → `null`.
- Log the duration of each call.

**3. `src/ai/gemini.js`** — `parseOrderTurn({ text, order, menu })` → `{ calls: [{ name, args }] }`.
- One `ai.models.generateContent` call with the transcript text only.
- `systemInstruction` includes: role ("You are the order-taking assistant for a café register; the speaker is the cashier; the text is a speech transcript and may contain recognition errors"), compact menu (ids, names, aliases, allowed modifiers), the current order lines as JSON, and rules:
  - Only use menu ids and modifier ids from the list; never invent. Map near-miss words to the closest menu item.
  - "Make that / make one of them" refers to the most recent or best-matching line.
  - If the utterance is unclear or off-menu, call `clarify` with a short question.
- Function declarations:
  - `add_item(menu_id: string, qty: integer, modifiers: string[])`
  - `remove_item(line_id?: integer, menu_id?: string)`
  - `update_item(line_id: integer, qty?: integer, modifiers?: string[])`
  - `clear_order()`
  - `confirm_order()` — cashier says "confirm", "that's it", "ring it up"
  - `cancel_order()`
  - `new_order()` — "next customer"
  - `clarify(question: string)`
- Use function-calling mode `ANY` so the model must return calls. Validate every call's ids against the menu; drop invalid ones and note them.
- **Mock mode:** a keyword parser on `text`. Handle "two lattes", "a croissant", "remove the croissant", "confirm", "clear". Good enough for UI development.

**4. `src/ai/readback.js`** — `buildReadback(order, { clarifyQuestion?, confirmed?, error? })` → string. **Deterministic, not LLM**: e.g. "Two large oat-milk lattes and one warmed croissant. Total $14.50. Say confirm to pay." Confirmed → "Total $14.50. Please scan the code to pay." Empty → "Order is empty."

**5. `src/routes/voice.js`**
- `POST /voice`: accept audio via `multer` memory storage (add dependency) or JSON `{ text }`. Steps: audio → `speech.transcribe(buffer, file.mimetype)` (text input skips this) → if the transcript is empty, readback "Sorry, I didn't catch that" and stop → `order.setHeard(text)` → `parseOrderTurn` → apply calls in order (`confirm_order` triggers the same logic as `POST /api/checkout` — import and call WS2's exported `startCheckout()`; until WS2 lands, guard with try/catch) → `buildReadback` → `order.setReadback` → `broadcast('readback', { text, audio_url: '/api/tts?text=' + encodeURIComponent(text) })` → respond.
- If status isn't `building` and the call is an item mutation, readback: "Order is already being paid. Say next customer to start a new one."
- `GET /tts`: send `speech.synthesize(text)` with `Content-Type: audio/mpeg`; 204 in mock.

**Acceptance:**
- `curl -XPOST localhost:3000/api/voice -H 'content-type: application/json' -d '{"text":"two large oat lattes and a croissant"}'` → order has 2 lines with correct modifiers and total (live Gemini) .
- Follow-up `{"text":"actually make the lattes small"}` updates the right line.
- `{"text":"do you have pizza"}` → no mutation, readback is a clarify question.
- A browser recording of the same sentence works via multipart, and menu words like "croissant" are transcribed correctly.
- `/api/tts?text=hello` plays in a browser (live) / 204 (mock).
- Round-trip latency for a short utterance logged per step (Deepgram STT, Gemini, Deepgram TTS); target < 3 s total.

---

### WS2 — Payments (Stripe) + Kitchen feed

**1. `src/stripe.js`**
- `createCheckout(order)` → `{ session_id, url }` using `stripe.checkout.sessions.create({ mode: 'payment', line_items: [{ price_data: { currency, unit_amount, product_data: { name: "Latte (Large, Oat milk)" } }, quantity }], success_url: PUBLIC_BASE_URL + '/customer?paid=1', cancel_url: PUBLIC_BASE_URL + '/customer', metadata: { order_id } })`.
- `isPaid(session_id)` → `retrieve(...).payment_status === 'paid'`.
- Mock: `url = PUBLIC_BASE_URL + '/customer?mockpay=' + order.id`, `isPaid` reads an in-memory flag set by mock-pay.

**2. `startCheckout()`** (exported from `src/routes/payment.js` or `src/stripe.js`, used by WS1):
- Reject if order empty or not `building`.
- Create checkout, generate `qr_data_url` from `url` (size ~360 px, margin 1), call `order.setAwaitingPayment(...)`.
- Start a **poller**: every 2 s call `isPaid`; stop after 15 min or when order changes. On paid: `order.markPaid()`, call `db.saveOrder(order)` (WS4; import lazily and wrap in try/catch so WS2 works before WS4 lands), `broadcast('paid', order)`.
- **No webhooks** (avoids ngrok).

**3. Routes:** `POST /checkout`, `POST /checkout/mock-pay`, `GET /kitchen` per §4.4.

**Acceptance:**
- With items in the order, `POST /api/checkout` returns a Stripe URL; opening it shows the right items and total.
- Paying with `4242 4242 4242 4242` flips the order to `paid` within ~3 s and an SSE `paid` event fires.
- Mock mode: `POST /api/checkout/mock-pay` flips to paid.
- Checkout with an empty order → 400 with a clear error.

---

### WS3 — Cashier, Customer, Kitchen screens

Build against WS0's SSE + mock services. Visual direction: dark, high-contrast, large type, readable from 2 m away; brand name "WristOrder". No frameworks.

**`public/shared/sse.js`** — `subscribe(handlers)` with auto-reconnect. **`format.js`** — `money(cents)`, `lineLabel(line)` ("2× Latte · Large, Oat milk").

**Cashier (`/cashier`)** — laptop the cashier glances at; also the audio source.
- Big push-to-talk button; **hold Space** also works. Visual "listening" state with a level meter.
- Mic selector dropdown (from `listInputDevices()`), remembered in `localStorage` (try/catch).
- Text input fallback ("type an order") → `POST /api/voice` with `{ text }`.
- Shows: last heard transcript, current order lines, total, status badge, readback text.
- Plays readback audio (`new Audio(audio_url)`) when its own request returns.
- Buttons: Confirm (→ `/api/checkout`), New order, Clear, and in mock mode "Simulate payment".

**Customer (`/customer`)** — screen facing the customer.
- Building: order lines appear with a subtle slide-in animation; big total.
- Awaiting payment: large QR code + "Scan to pay $14.50" + "Apple Pay / Google Pay / card".
- Paid: full-screen green "Paid — thank you!" for 6 s, then idle "Welcome" screen.
- If opened with `?mockpay=<id>`: show a "Pay (test)" button that calls mock-pay (this is what a phone sees in mock mode).
- If opened with `?paid=1` (Stripe success redirect on the customer's phone): simple thank-you page.

**Kitchen (`/kitchen`)** — on load fetch `/api/kitchen`; on `paid` event prepend a ticket card (order id short, time, lines with modifiers) with a highlight flash. Click to mark done (client-side only).

**Acceptance:**
- With all services mocked: type "two lattes and a croissant" on cashier → customer screen updates live → Confirm → QR shows → Simulate payment → customer shows Paid, kitchen shows ticket.
- Space-bar push-to-talk records and posts the audio clip.
- Pages work at 1280×720 and on a phone width (customer `?paid=1` page).

---

### WS4 — Data, Owner dashboard, Weekly report, Owner voice Q&A

**1. `src/db.js`** — create tables on startup:

```sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, paid_at TEXT NOT NULL,
  total_cents INTEGER NOT NULL, stripe_session_id TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id),
  menu_id TEXT NOT NULL, name TEXT NOT NULL, qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL, modifiers_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at);
```

Export `saveOrder(order)` (transaction, idempotent on order id), `ordersBetween(fromISO, toISO)` returning orders with their items.

**2. `scripts/seed.js`** — `npm run seed` clears and generates **28 days** of history ending yesterday: 60–90 orders/weekday, 100–140 on Sat/Sun, opening hours 7:00–17:00 with a morning peak; 1–4 lines per order; weighted popularity (one clear top seller, one item trending up week-over-week, croissants spike on weekends). Uses `menu.js` pricing so totals are consistent.

**3. `src/stats.js`** — `getStats({ days = 28 })` →

```js
{
  range: { from, to },
  totals: { orders, revenue_cents, avg_ticket_cents },
  daily: [{ date: "2026-11-10", orders, revenue_cents }],
  top_items: [{ menu_id, name, qty, revenue_cents }],          // this week
  week_over_week: [{ menu_id, name, this_week, last_week, change_pct }],
  ingredients: [{ ingredient, unit, this_week, last_week }],     // via menu.ingredientsForLine
  restock_suggestion: [{ ingredient, unit, suggested_next_week }] // this_week * 1.1, rounded sensibly
}
```

"This week" = last 7 days, "last week" = the 7 days before that. Pure math, no LLM.

**4. `src/report.js`** — `buildReport()` → `{ period, stats, summary_markdown }`. Gemini writes a ≤150-word owner briefing from the stats JSON: headline numbers, top 3 dishes, biggest mover, restock list, one actionable tip. Mock/failure → template-based summary from the same numbers. Also `reportHtml(report)` → simple inline-styled HTML email (summary + top items table + restock table).

**5. `src/email.js`** — `sendReport(report)` via Resend to `REPORT_TO_EMAIL`, subject "WristOrder weekly report — <date range>". Mock → log and return `{ mocked: true }`.

**6. Scheduler** — in `src/report.js` export `startReportSchedule()`; if `REPORT_CRON` set, `node-cron` runs build + send. Call it from `routes/owner.js` module init (so WS0's server.js needs no change).

**7. `src/ai/ownerAssistant.js`** — `askOwner({ audioBuffer?, mimeType?, text? })` → `{ heard, answer }`. Audio is transcribed with WS1's `speech.transcribe()` first. Gemini gets `getStats({ days: 28 })` JSON + menu in the system instruction; answer in ≤2 spoken sentences with concrete numbers. Mock → canned answer using top item.

**8. `src/routes/owner.js`** — endpoints from §4.4. `/owner/ask` returns `audio_url` using `/api/tts?text=`.

**9. Owner page (`/owner`)**
- KPI tiles: orders this week, revenue, avg ticket, top dish.
- Bar chart: daily orders (28 days). Horizontal bar: top dishes this week.
- Table: ingredient usage this week vs last week + suggested restock.
- "Generate report" (shows summary) and "Email report to owner" buttons.
- "Ask WristOrder" push-to-talk (reuse `public/shared/recorder.js`) + text box; shows and plays the answer.

**Acceptance:**
- `npm run seed` then `GET /api/owner/stats` returns non-empty, plausible numbers; ingredient totals match a hand check for one item.
- A real paid order (or mock-pay) appears in today's stats.
- `POST /api/owner/report/send` delivers an email (live) or logs it (mock).
- `POST /api/owner/ask {"text":"what sold best this week?"}` names the actual top item with its count.

---

### WS5 — Vexo bracelet integration

The current implementation plan and verification steps are in `VEXO_IMPLEMENTATION_PLAN.md` and `TESTING.md` CP6. The band sends Opus audio through the Vexo browser library; it does not appear in the system microphone picker. Cashier connects only to team band 33, records between taps, sends WAV to `POST /api/voice`, and plays read-back on the laptop. The existing laptop microphone remains available.

---

### WS6 — Integration & demo polish (last ~45 min)

1. Run the full live flow with real keys: voice → order → read-back → confirm → QR → pay on a phone → Paid → kitchen ticket → appears in owner stats.
2. Fix latency hotspots (target < 3 s from release of button to read-back audio).
3. Error paths: Deepgram or Gemini failure → readback "Sorry, say that again" without crashing; Stripe failure → error banner on cashier.
4. `npm run seed` before demo; verify the owner dashboard looks good.
5. Write `README.md`: setup, env, `npm run seed`, `npm run dev`, page URLs, demo script.

---

## 6. Demo Script (target 90 seconds; owner extension up to 3 minutes)

Use `/demo` for the audience once verified; keep cashier and kitchen controls in separate tabs or windows and `/pickup` on the pickup display. Demonstrate only completed and rehearsed features. If a new view fails verification, use the existing customer/kitchen/owner pages.

1. **Problem (10 s):** busy counter, cashier tapping screens, losing eye contact. Introduce hands-free ordering from the wristband.
2. **Order and correction (30 s):** start listening from the band. Say "Two lattes and a croissant," then "Actually, make one latte oat milk." Show the final extracted order after stopping capture. Include the correction only if it passes rehearsal. Any spoken read-back plays through the laptop; the band has no speaker.
3. **Review and pay (25 s):** review the final items and scan the test-payment QR produced by the existing flow. Show actual payment confirmation, the kitchen ticket, and refreshed sales on `/demo`. Preserve the current checkout behavior.
4. **Show the result (15 s):** mark the kitchen ticket ready. Show its pickup number on `/pickup` and `/demo`, plus the cashier notification. Demonstrate the band LED only after physical verification; its notification waits while the microphone is recording.
5. **Close (10 s):** "WristOrder lets café staff keep their hands on service while the order moves from conversation to checkout to kitchen."

Optional owner extension: show top dishes, ingredient usage, and restock suggestions; generate the report and demonstrate owner Q&A. Demonstrate emailing the report only when configured and rehearsed. Omit these extras if they make the core transaction harder to follow.

Backup: screen-record the working flow. Label seeded history and mock integrations clearly. Measure several real runs before quoting completion times; do not claim unmeasured time savings.

---

## 7. Priority / Cut Line

Original build order, retained for reference. For the current 30-minute implementation window, §7.1 takes precedence.

1. WS0 foundation
2. Text → Gemini → order → customer screen (WS1 + WS3)
3. Confirm → Stripe QR → paid → kitchen (WS2 + WS3)
4. Push-to-talk audio via Deepgram + Deepgram read-back (WS1)
5. Vexo bracelet audio (WS5)
6. DB + seed + owner dashboard (WS4 1–3, 9 without ask)
7. AI weekly report + email (WS4 4–6)
8. Owner voice Q&A (WS4 7)
9. Presentation screen (§9.1) — first demo enhancement
10. Live provisional order and visible corrections (§9.2) — signature enhancement
11. Live stock awareness (§9.3) — stretch goal
12. Order-ready feedback loop (§9.4) — stretch goal; may precede stock if time is tight
13. Bilingual ordering (§9.5) — stretch goal, contingent on speech support validation
14. Split bill — **not planned; do not start unless everything above is done**

The earlier ~45-minute rehearsal reserve is superseded by the user's clarification: there are 30 minutes allocated to building, with submission due at 6 p.m. Pacific. Finish verification within the build allocation; use remaining time before submission for rehearsal and submission preparation.

### 7.1 Thirty-minute build — parallel execution plan

| Time from now | Task | Completion check |
|---|---|---|
| 0–3 min | Agree on shared events and file ownership; inspect current behavior. | Agents have separate files and matching fulfillment contracts. |
| 3–20 min | In parallel: build `/demo`; persist kitchen Ready and build `/pickup`; integrate routes and recording-aware band LED. | Actual payment/order events drive each screen; no new external services. |
| 20–27 min | Run isolated mock integration checks and browser smoke; fix failures. | Payment, ready status, duplicate actions, refresh, and restart behave consistently. |
| 27–30 min | Finish visual polish and document URLs, tested behavior, and hardware checks. | The working feature scope is ready for physical-band rehearsal. |

- Presentation agent owns `public/demo/*`; fulfillment agent owns database/payment routes and kitchen/pickup views; primary agent owns server route wiring, cashier/band feedback, and documentation. Verification agent owns isolated integration checks. Coordinate shared changes explicitly.
- Limit database changes to additive fulfillment storage; preserve existing orders and payment semantics. Tests use a temporary database/project and forced mock services.
- Preserve existing demo data; do not rerun the destructive history seed merely to refresh the dashboard. Do not read or change `.env` secrets.
- Live provisional corrections, stock awareness, and bilingual ordering remain deferred. Do not introduce new dependencies or external integrations.
- After building, rehearse and record the working flow, then complete submission before 6 p.m. Pacific. Submission preparation is outside this 30-minute build allocation.

## 8. Rules for Implementing Agents

- Stay inside your owned files. Shared contract changes go to `NOTES.md`.
- Keep every external call behind its module and mockable; never let a failed API call crash the server.
- No new dependencies beyond §1 plus `multer`, unless noted in `NOTES.md` with a reason.
- Run your acceptance checks and paste results into `NOTES.md` → "Status" when done.
- Announce each manual test checkpoint in `NOTES.md` → "Ready for manual test" as soon as you reach it (see §5). Bugs the human reports in "Known issues" come before new work.
- Do not commit secrets. Do not add auth, general-purpose i18n, tests frameworks, TypeScript, or bundlers. The narrowly scoped bilingual ordering stretch goal in §9.5 is the only planned language-support exception.

---

## 9. Demo Enhancement Backlog

Status: **§9.1, §9.3, and §9.4 implemented and mock-verified; §9.2 and §9.5 deferred**. The current hackathon scope is inventory and popular items, with no presentation requirement. Live payment and physical-band rehearsal remain. Keep the existing Node.js, vanilla JS, SQLite, and SSE stack. Effort estimates below are relative, not delivery promises. Each feature must work with mock services and preserve the existing ordering flow. Coordinate shared contract changes through `NOTES.md` as required by §8.

### 9.1 Presentation screen — first build priority

**Demo value:** judges can follow one transaction through the whole café without switching browser tabs. **Effort:** low–medium.

Implementation:
- Add `/demo` with `public/demo/index.html`, `app.js`, and `style.css`; register the route in `src/server.js`.
- Show four readable panels: current order, customer payment QR, kitchen tickets, and today's order/revenue totals. Use large item cards and brief highlights when real state changes arrive.
- Reuse existing order and paid SSE events. Load initial order, kitchen, and stats snapshots; refresh sales after a paid order is persisted. Do not infer successful payment from a redirect or animation.
- Make refresh/reconnect restore the current state without replaying duplicate tickets or incrementing sales twice. Keep the displayed order ID visible so a new order cannot be confused with the preceding paid order.
- Label mock integrations and seeded historical data. Use existing cashier controls for actions; the presentation screen is primarily a shared view.

**Acceptance:**
- Complete text order → confirm → mock payment; all four panels show matching order, payment, ticket, and sales data.
- Repeat with live integrations before the demo. A failed payment does not show Paid or create a kitchen ticket.
- Refresh/reconnect after payment: one ticket and one sales increment remain. The screen is readable at 1280×720 with a scannable QR.

### 9.2 Live provisional order and visible corrections — signature feature

**Demo value:** "Two lattes… actually, make one oat milk" visibly becomes one regular latte and one oat latte during the conversation. **Effort:** medium–high.

Implementation:
- Extend the existing segmented band transcription flow in `public/cashier/vexo.js` and `app.js`. Send the accumulated transcript to a preview route in `src/routes/voice.js`, reusing the validated menu-based extraction in `src/ai/conversation.js`.
- Introduce a conversation ID and monotonically increasing revision. Debounce preview requests, allow at most one inference request in flight per conversation, and discard results from older revisions or ended conversations.
- Keep preview items separate from the authoritative order. Broadcast an `order_preview` event containing conversation ID, revision, provisional items, and any clarification question. Calculate preview prices through `menu.js`.
- Render provisional items on cashier, customer, and presentation screens with a clear Draft label. Briefly highlight additions, removals, and modifier changes. Re-readbacks must not duplicate quantities.
- On stop, await remaining transcription and perform final extraction. Replace the order once, clear the preview, and require cashier confirmation before creating checkout. Update the current conversation-finalization path so stopping capture alone does not launch payment.
- On cancel/new order, clear the preview and invalidate pending requests. On inference failure, retain the last valid draft with a visible retry/status message; do not silently commit it.
- Provide deterministic mock preview responses for the demo correction sequence.

**Acceptance:**
- "Two lattes and a croissant" → "make one latte oat milk" → "remove the croissant" produces exactly one regular latte and one oat latte, with correct menu-derived prices.
- A cashier reading the order back does not add duplicates. Ambiguous corrections ask for clarification.
- Delayed responses cannot overwrite a newer draft or another conversation. Stopping capture creates no checkout until final confirmation.
- Cancel, transcription failure, and preview failure leave the authoritative order consistent. Record observed preview latency during a live rehearsal.

### 9.3 Live stock awareness — stretch goal

**Demo value:** buying the last croissant marks it sold out, and the next customer receives an available alternative. **Effort:** medium.

Implementation:
- Start with item counts for pastries, not full ingredient inventory. Add SQLite starting/on-hand stock and explicit demo seed values; existing ingredient usage reports remain separate from on-hand stock.
- Validate availability when finalizing an order and before checkout. Reserve tracked quantities while checkout is pending; consume the reservation exactly once on verified payment and release it on cancellation or confirmed checkout expiry.
- Persist reservation state and make duplicate payment notifications idempotent. Reject insufficient stock without partial order or stock mutations.
- Broadcast inventory changes so cashier, customer, and presentation views show sold-out items. Suggest an in-stock alternative from the menu, but require acceptance before substituting it.
- If adding reservation handling cannot fit the remaining time, defer this feature rather than presenting an unreliable stock count.

**Acceptance:**
- With one croissant in stock, paying for it produces zero available stock and a sold-out badge. Repeated payment notifications do not deduct it again.
- A second order cannot buy unavailable stock. Cancelling or expiring a pending checkout releases its reservation.
- Suggested alternatives exist, are available, and never enter the order without acceptance. Refresh/restart preserves inventory.

### 9.4 Order-ready feedback loop — stretch goal

**Demo value:** a kitchen action updates the pickup display and the cashier's band, completing the service journey. **Effort:** low–medium.

Implementation:
- Replace the kitchen's current browser-only Done action with a server-backed ready action keyed by paid order ID.
- Persist fulfillment status separately from payment status. Add an idempotent ready endpoint and an `order_ready` SSE event; include fulfillment state in kitchen snapshots.
- Add a pickup view at `/pickup` and a ready indicator on `/demo`. Show a short order number rather than customer personal information.
- Give the connected cashier band a brief ready LED signal using its existing LED API, then restore its current state color. Preserve recording feedback while the microphone is active; do not assume the band has a speaker or vibration motor.
- Keep the ready action usable when the band is disconnected.

**Acceptance:**
- Marking a paid ticket ready updates kitchen, pickup, and presentation screens. Refresh preserves the status.
- Repeated clicks do not create duplicate ready entries. Unpaid or unknown orders cannot be marked ready.
- Verify LED feedback on the physical band, including while a subsequent order is being captured; disconnected-band failures do not block fulfillment.

### 9.5 Bilingual ordering — stretch goal

**Demo value:** a customer orders in one supported language while the cashier receives the same order in English. **Effort:** medium–high.

Implementation:
- First verify the configured speech model supports the chosen language and test real café phrases. Select one additional demo language, such as Spanish or Mandarin, based on that validation.
- Add an explicit language selector. Configure transcription accordingly and pass language context into order extraction while retaining canonical menu/modifier IDs and deterministic prices.
- Show the original transcript and a localized customer order summary alongside the cashier's English summary. Keep quantities, modifiers, and totals identical across views.
- Use a small curated translation map for the demo menu and essential messages; do not introduce an application-wide translation framework. Offer spoken read-back only if the configured TTS voice supports the language.
- Maintain the existing English/text path and mock fixtures for both languages. Clearly report unsupported language input.

**Acceptance:**
- A rehearsed non-English order and correction produce the same item IDs, quantities, modifiers, and total as their English equivalents.
- Both customer and cashier can verify the final order before confirmation. Unsupported items or unclear speech trigger clarification rather than invented menu entries.
- Complete the chosen language's full live speech → confirmation → payment → kitchen flow before including it in the demo.
