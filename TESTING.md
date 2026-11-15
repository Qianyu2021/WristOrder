# WristOrder — Manual Test Checkpoints

Test each feature by hand as soon as it lands, in this order. Every checkpoint is reachable before the ones after it, so you never wait for the whole app to be finished.

**How you'll know a checkpoint is ready:** the agent that finishes it adds a line to `NOTES.md` under "Ready for manual test", e.g. `CP2 ready — Agent 1`. Then run the steps below.

**If something fails:** copy the bug template at the bottom into `NOTES.md` under "Known issues" and send it to the agent that owns the feature.

---

## Before you start

- [ ] `.env` filled in (Gemini, Deepgram, Stripe test key, Resend, your email as `REPORT_TO_EMAIL`)
- [ ] `npm install` done
- [ ] Phone on the same Wi-Fi as the laptop (only needed from CP5)
- [ ] Two browser windows side by side: **Cashier** (`localhost:3000/cashier`) and **Customer** (`localhost:3000/customer`)

Start the app with `npm run dev`. The terminal prints which services are **live** and which are **mocked**. Check it before every checkpoint, because a missing key silently switches that service to mock.

---

## Overview

| CP | What you test | Ready after | Needs real keys | Time |
|---|---|---|---|---|
| 0 | Server starts, health check | Lead agent (WS0) | No | 5 min |
| 1 | Screens + full flow with everything mocked | Agent 3 (WS3) | No | 10 min |
| 2 | Typed orders understood by Gemini | Agent 1 (WS1, part 1) | Gemini | 10 min |
| 3 | Spoken orders via laptop mic (Deepgram) | Agent 1 (WS1, part 2) | Deepgram | 10 min |
| 4 | Spoken read-back + speed | Agent 1 (WS1, part 3) | Deepgram | 5 min |
| 5 | Real Stripe payment on your phone | Agent 2 (WS2) | Stripe | 10 min |
| 6 | Vexo bracelet as the mic | You (WS5) | Deepgram | 10 min |
| 7 | Saved orders + owner dashboard | Agent 4 (WS4, part 1) | No | 10 min |
| 8 | Weekly report + email | Agent 4 (WS4, part 2) | Gemini, Resend | 5 min |
| 9 | Owner asks questions by voice | Agent 4 (WS4, part 3) | Gemini, Deepgram | 5 min |
| 10 | Full demo run + failure drills | Lead agent (WS6) | All | 20 min |

CP1, CP2, CP5 and CP7 can be tested in any order once each is ready, because those agents work in parallel.

---

## CP0 — Server starts

| # | Do this | Expect |
|---|---|---|
| 0.1 | `npm run dev` | Starts without errors; lists each service as live or mocked |
| 0.2 | Open `localhost:3000/api/health` | JSON showing the same live/mock status |
| 0.3 | Open `localhost:3000/api/menu` | 12–15 café items with prices |
| 0.4 | Open `localhost:3000` | Links to Cashier, Customer, Kitchen, Owner |

---

## CP1 — Screens with everything mocked

Run with `MOCK_GEMINI=1 MOCK_STT=1 MOCK_TTS=1 MOCK_STRIPE=1` in `.env` so nothing external is involved. This proves the screens and live updates work before any AI is added.

| # | Do this | Expect |
|---|---|---|
| 1.1 | Open Cashier, Customer and `localhost:3000/kitchen` | All three load; Customer shows a welcome screen |
| 1.2 | On Cashier, type `two lattes and a croissant`, press Enter | Within 1 s, both Cashier and Customer show 2× Latte, 1× Croissant and the right total |
| 1.3 | Type `remove the croissant` | Croissant disappears on both screens; total drops |
| 1.4 | Click **Confirm** | Customer shows a large QR code and "Scan to pay" with the total |
| 1.5 | Click **Simulate payment** | Customer shows the green "Paid" screen; Kitchen gets a new ticket |
| 1.6 | Wait ~6 s | Customer returns to the welcome screen |
| 1.7 | Click **New order**, refresh Customer mid-order | After refresh, Customer still shows the current order |
| 1.8 | Click **Confirm** with an empty order | Clear message such as "Order is empty"; nothing breaks |

---

## CP2 — Typed orders understood by Gemini

Turn mocks off for Gemini (`MOCK_GEMINI=` empty). Keep typing for now, which isolates Gemini from the microphone.

| # | Type this | Expect |
|---|---|---|
| 2.1 | `two large oat lattes and a croissant` | 2× Latte (Large, Oat milk), 1× Croissant |
| 2.2 | `actually make one of the lattes small` | Lines split: 1× Large Oat Latte, 1× Small Oat Latte |
| 2.3 | `add a blueberry muffin, warmed` | Muffin with "Warmed" |
| 2.4 | `scratch the muffin` | Muffin removed |
| 2.5 | `an americano with an extra shot` | Americano + Extra shot, price includes the add-on |
| 2.6 | `do you have pizza` | Order unchanged; read-back text asks a clarifying question |
| 2.7 | `uh can I get a cap... cappuccino, no wait, a latte` | One latte, no cappuccino |
| 2.8 | `that's it` | Moves to payment (QR appears) |
| 2.9 | `next customer` | New empty order |

Pass if at least 8 of 9 are right. Note any failures exactly as typed so the agent can adjust Gemini's instructions.

---

## CP3 — Spoken orders via laptop mic (Deepgram)

Turn off `MOCK_STT`. Use the laptop mic first; the bracelet comes in CP6.

| # | Do this | Expect |
|---|---|---|
| 3.1 | Hold the talk button, say 2.1 above, release | "Heard" shows a correct transcript; order matches 2.1 |
| 3.2 | Hold **Space** instead of clicking, say `a chai latte and a ham and cheese sandwich` | Same result using the keyboard |
| 3.3 | Say menu words that are easy to mishear: `croissant`, `matcha`, `cappuccino`, `americano` | Each one transcribed correctly |
| 3.4 | Tap the button without speaking | "Sorry, I didn't catch that"; order unchanged |
| 3.5 | Play café noise from your phone (search "coffee shop ambience") and repeat 3.1 | Still correct, or close enough that Gemini fixes it |
| 3.6 | Have someone else say 3.1 | Works with a different voice |

---

## CP4 — Spoken read-back and speed

Turn off `MOCK_TTS`. Turn the laptop volume up.

| # | Do this | Expect |
|---|---|---|
| 4.1 | Say `two lattes and a croissant` | You hear "Two lattes and one croissant. Total $X. Say confirm to pay." |
| 4.2 | Check the terminal log for that turn | Timings for Deepgram transcription, Gemini and Deepgram voice are printed |
| 4.3 | Time from releasing the button to hearing audio, 3 tries | Under 3 s on average |
| 4.4 | Say the same order twice | The second read-back starts faster (cached) |

If over 3 s: send the logged timings to Agent 1 and say which step is slowest.

---

## CP5 — Real Stripe payment on your phone

Turn off `MOCK_STRIPE`. Have your phone ready.

| # | Do this | Expect |
|---|---|---|
| 5.1 | Build an order, say or click **Confirm** | QR code appears on Customer |
| 5.2 | Scan the QR with your phone camera | Stripe Checkout opens on your phone with the same items and total |
| 5.3 | Pay with card `4242 4242 4242 4242`, any future date, any CVC, any ZIP | Phone shows the thank-you page |
| 5.4 | Watch the laptop | Within ~3 s: Customer shows "Paid", Kitchen shows the ticket |
| 5.5 | Open the Stripe dashboard (test mode) → Payments | The payment is listed with the right amount |
| 5.6 | Start another checkout, then close it on the phone without paying | Order stays "awaiting payment"; **New order** still works |
| 5.7 | Try voice edits while awaiting payment, e.g. `add a muffin` | Read-back says the order is already being paid |

---

## CP6 — Vexo bracelet as the mic

| # | Do this | Expect |
|---|---|---|
| 6.1 | In Chrome/Edge, open Cashier. Disconnect the kit dashboard, double-tap your band, click **Connect Vexo**, select `Vexo-HACK-33` | Cashier says Vexo connected. The band is not a normal macOS microphone and will not appear in the laptop mic dropdown |
| 6.2 | Tap the band once, then speak an order at arm's length | Cashier says recording and the band's light is solid blue |
| 6.3 | Tap again to stop | The **Heard** transcript and order update through `/api/voice`; read-back plays from the laptop |
| 6.4 | Start another recording and leave it running | Recording stops automatically after 12 seconds; the microphone light goes off |
| 6.5 | Confirm and complete a test payment | Paid order appears on Customer/Kitchen and the band's LED turns green |
| 6.6 | Disconnect the band or refresh Cashier | Recording stops; reconnect using **Connect Vexo** after double-tapping the band |

The `vexo-open-kit/` folder must be beside `public/` because the app serves its browser library. If Vexo is unavailable, use the laptop mic and record what happened in `NOTES.md` → "Vexo".

---

## CP7 — Saved orders and owner dashboard

| # | Do this | Expect |
|---|---|---|
| 7.1 | `npm run seed` | Prints how many orders it created over 28 days |
| 7.2 | Open `localhost:3000/owner` | Tiles (orders, revenue, average ticket, top dish), daily chart, top dishes, ingredient table |
| 7.3 | Look at the daily chart | Weekends are visibly busier |
| 7.4 | Hand-check one ingredient: find lattes sold this week in the top dishes, multiply by the latte recipe in `data/menu.json` | Matches the ingredient table (oat-milk orders shift milk to oat milk) |
| 7.5 | Make and pay one real or simulated order, refresh Owner | Today's count goes up by one |
| 7.6 | Restart the server, refresh Owner | Numbers are unchanged (data was saved to disk) |

---

## CP8 — Weekly report and email

| # | Do this | Expect |
|---|---|---|
| 8.1 | On Owner, click **Generate report** | A short summary: totals, top 3 dishes, biggest change, restock list, one tip |
| 8.2 | Compare the summary's numbers with the dashboard | They match; nothing invented |
| 8.3 | Click **Email report to owner** | Success message; email arrives at `REPORT_TO_EMAIL` within a minute (check spam) |
| 8.4 | Open the email | Readable on your phone, with the summary and restock table |

Resend's test sender can only email the address on your Resend account. Use that address for `REPORT_TO_EMAIL`.

---

## CP9 — Owner asks questions by voice

| # | Ask (voice or typed) | Expect |
|---|---|---|
| 9.1 | `What sold best this week?` | Names the same top dish as the dashboard, with a count; spoken aloud |
| 9.2 | `How much oat milk do I need next week?` | A number matching the restock table |
| 9.3 | `How did Saturday compare to Friday?` | Plausible answer matching the daily chart |
| 9.4 | `What's the weather?` | Politely says it can only answer about sales |

---

## CP10 — Full demo run and failure drills

**Demo run, 3 times in a row**, following the script in `PLAN.md` §6. Time it.

- [ ] Run 1 under 3 minutes, no restarts
- [ ] Run 2 under 3 minutes, no restarts
- [ ] Run 3 under 3 minutes, with someone else scanning and paying

**Failure drills** (so a hiccup on stage doesn't end the demo):

| # | Do this | Expect |
|---|---|---|
| 10.1 | Turn Wi-Fi off, speak an order | Cashier shows a clear error; server keeps running; works again when Wi-Fi is back |
| 10.2 | Put a wrong Gemini key in `.env`, restart, speak | Read-back says "Sorry, say that again"; no crash. Restore the key |
| 10.3 | Mic blocked in browser settings | Cashier says the mic is blocked; typing still works |
| 10.4 | Close and reopen the Customer tab mid-order | Order reappears |

Preserve the current order history; `npm run seed` clears it. Screen-record one successful run as a backup video.

## CP11 — Live café, persistent ready status, and pickup

Automated checks: `npm test`. The HTTP/SSE integration check runs against an isolated temporary database with all integrations mocked. It does not verify real speech, Stripe credentials, Bluetooth, or the physical LED.

| # | Do this | Expect |
|---|---|---|
| 11.1 | Open `/demo`, `/cashier`, `/kitchen`, and `/pickup` in separate windows | Presentation shows current order, integration modes, kitchen state, and UTC-day sales; pickup lists ready order numbers |
| 11.2 | Build an order, confirm, and pay using the configured test checkout or labeled mock path | QR matches the current order; actual paid status produces one kitchen ticket and one sales increment |
| 11.3 | Click **Ready for pickup** on the kitchen ticket | The same order number becomes ready on presentation and pickup screens; cashier receives a notification |
| 11.4 | Repeat the ready request, refresh views, then restart the server | No duplicate ticket or sales increment; paid ticket and ready status persist |
| 11.5 | Mark another ticket ready while the connected cashier band is idle | Purple blink, followed by the current order-state LED color |
| 11.6 | Mark a ticket ready while recording another conversation | Blue microphone light remains; ready feedback waits until recording/processing finishes |
| 11.7 | Disconnect the band and mark a ticket ready | Kitchen, pickup, and presentation still update |
| 11.8 | Temporarily disconnect a display, complete a ready action, then reconnect | Latest persisted kitchen/ready state reloads without duplicates |
| 11.9 | Check `/demo` at 1280×720 and on a phone | Readable panels, no horizontal page overflow, scannable payment QR |

## CP12 — Pastry inventory and popular items

Use mock payment and a temporary database if you want predictable starting stock. A new database starts with 8 croissants, 6 blueberry muffins, and 5 banana breads; existing stock is preserved.

| # | Do this | Expect |
|---|---|---|
| 12.1 | Check `/api/inventory`, then add one croissant and confirm checkout | Available croissants fall by one while on-hand stays the same |
| 12.2 | Cancel checkout or call `/api/checkout/mock-expire` in mock mode | The reservation releases; available count returns |
| 12.3 | Repeat checkout and use mock payment | On-hand falls once, reserved returns to zero, and refresh keeps the new count |
| 12.4 | Ask for more croissants than available | The order stays unchanged and the cashier hears an in-stock alternative; no substitution is made |
| 12.5 | Open Popular items and Inventory from the Cashier shortcuts, Customer tabs, and Owner page | Paid items are ranked; made-to-order items, baked goods, and tracked ingredients appear with available counts and explicit In stock, Low, or Sold out labels; each pastry appears only once in the Inventory view |
| 12.6 | Place and pay for a latte, then inspect Owner inventory; receive new stock | Espresso, milk, and cups decrease once on payment; milk appears as 1 L bottle equivalents; received bottles increase the saved count |
| 12.7 | Sell 10 matcha lattes twice, checking Cashier, Kitchen, and Owner after each payment | Matcha falls from two 30 g tins to one, then zero; milk falls by 2 L each time; staff see a low-stock reminder and a suggested reorder; another matcha checkout is rejected until stock arrives |
| 12.8 | Tap the Vexo band and say “received one tin of matcha, stop listening”; also try “restock five croissants” with Hold to talk | Stock increases once, the Cashier and Kitchen inventory views update, the laptop reads back the new amount, and the active customer order is unchanged |
| 12.9 | On Cashier, open Inventory and use Add stock on a baked good or ingredient card | The saved quantity increases, the card and staff low-stock alert update, and Owner sees the same count |

---

## Bug report template

```
CP#/step: e.g. CP2 / 2.2
Did: exactly what you typed, said or clicked
Expected: from the table above
Got: what happened (paste "Heard" text, error message, or terminal log lines)
Services: which were live / mocked
Owner: Agent # (see PLAN.md)
```
