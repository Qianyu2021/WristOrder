# WristOrder

WristOrder is a café ordering demo that connects the cashier, customer, kitchen, pickup screen, and shop owner. Staff can type or speak an order, show the customer a live total, collect a test payment through a QR code, and send the paid ticket to the kitchen. Sales and ingredient use then appear in the owner dashboard.

## Why it helps shops

- **Fewer handoffs:** The same order moves from the register to the customer display and kitchen queue, so staff do not have to copy it between screens.
- **Clearer orders:** The cashier sees what was heard, can review the items and prices, and can correct or replace an item before payment. The customer sees the order and total as they change.
- **Smoother pickup:** Kitchen staff mark paid orders ready; the pickup display shows the order number, and the cashier gets a ready notification.
- **Better stock decisions:** The app reserves ingredients during checkout, deducts them after payment, shows low or sold-out items, and suggests reorder quantities. It can offer an available pastry as an alternative, subject to cashier confirmation.
- **Useful sales insight:** The owner can see paid sales, popular items, ingredient usage, and a weekly report, then record incoming stock.

This is a local demo. Mock integrations let you try the full workflow without API keys or real charges.

## Quick start

1. Install Node.js 20 or newer.
2. If you do not already have a `.env` file, run `cp .env.example .env`. Leave the API keys blank for mock mode.
3. Run `npm install` and `npm run dev`.
4. Open [http://localhost:3000](http://localhost:3000). The home page links to every view.

The app creates its SQLite database locally. To populate the owner dashboard with four weeks of **sample sales**, run `npm run seed`. This replaces saved sales history, so run it only on a demo database. It does not change physical inventory. To check which integrations are active, open [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Try an order from start to finish

Open the [Cashier](http://localhost:3000/cashier), [Customer](http://localhost:3000/customer), [Kitchen](http://localhost:3000/kitchen), and [Pickup](http://localhost:3000/pickup) views in separate tabs or on separate screens.

1. On **Cashier**, type an order such as `two lattes and a croissant` and press **Send**. Review the items, modifiers, total, and readback. Use **Replace** on a line if needed; **Clear** empties the current order. You can print the receipt or cancel an unpaid order.
2. Watch **Customer** update with the order. Its **Popular items** and **Inventory** tabs show sales favorites and current availability.
3. Press **Confirm** on Cashier. The customer and cashier screens show a payment QR code. With blank Stripe credentials, scan the QR code and press **Pay (test)** on the phone page, or press **Simulate payment** on Cashier. No real payment is made in mock mode.
4. Once paid, the ticket appears on **Kitchen**. Press **Mark ready**. The order number moves to the ready section on **Pickup**, and Cashier receives a notification.
5. Open [Owner](http://localhost:3000/owner) to see the saved sale, popular items, and updated stock. Press **New order** on Cashier for the next customer.

You can open [Live café](http://localhost:3000/demo) for a presentation view of the current order, payment QR, kitchen queue, and today's saved sales. Its reporting day uses UTC.

## Ways to take orders and update stock

| Method | How to use it |
| --- | --- |
| Typed command | On Cashier, enter an order or a command such as `clear` or `received two bottles of milk`, then press **Send**. This works without a microphone. |
| Laptop microphone | Hold **Hold to talk** or the Space key while speaking, then release. Allow microphone access in the browser. Live transcription needs a Deepgram key. In mock mode, every recording returns the fixed sample phrase `two lattes and a croissant`. |
| Vexo band | In Chrome or Edge, connect the band on Cashier and tap it to start a conversation. Say **“stop listening”** when finished. The app transcribes the conversation and builds the final agreed order, then starts checkout. |

For a stock delivery, say or type one update at a time, such as `received one tin of matcha` or `restock five croissants`. The app asks for clarification if the quantity or unit is unclear. The **Owner → Inventory & reorder** table also has **Receive** controls for recording deliveries; milk and matcha are received in whole bottles and tins.

The Cashier, Customer, and Owner inventory views show what can currently be made, including drinks and food. Menu counts use base recipes; modifiers can change the ingredients required. Checkout reserves stock, verified payment deducts it once, and cancellation or confirmed expiry releases it. Cashier and Kitchen show low-stock reminders.

## Owner tools

The [Owner page](http://localhost:3000/owner) shows order counts and revenue, average ticket, seven-day popular items, ingredient usage, and low-stock reorder suggestions. Use **Generate report** for a weekly briefing or **Email report to owner** to send it when Resend is configured. In mock email mode, the report is logged on the server instead. **Ask WristOrder** accepts typed questions about sales or inventory; voice questions need live transcription.

## Optional live integrations

Add credentials to `.env` only for the services you want to use. Keep `.env` private; `.env.example` lists the available settings without secrets.

| Service | Settings | What it does |
| --- | --- | --- |
| Google Gemini | `GEMINI_API_KEY`, optionally `GEMINI_MODEL` and `GEMINI_CONVERSATION_MODEL` | Parses order commands and full band conversations; answers owner questions. |
| Deepgram | `DEEPGRAM_API_KEY`, optionally `DEEPGRAM_STT_MODEL` and `DEEPGRAM_TTS_MODEL` | Transcribes microphone audio and generates spoken readback. |
| Stripe test mode | `STRIPE_SECRET_KEY` | Creates hosted Checkout sessions and QR codes. Use a **test-mode** key when trying live checkout. |
| Resend | `RESEND_API_KEY`, `REPORT_TO_EMAIL`, optionally `REPORT_CRON` | Sends the weekly owner report; the cron setting schedules it. |

An integration runs in mock mode when its key is blank. You can force mock mode with `MOCK_GEMINI=1`, `MOCK_STT=1`, `MOCK_TTS=1`, `MOCK_STRIPE=1`, or `MOCK_EMAIL=1`. Check `/api/health` to see the active mode of each service. Before using Stripe test checkout, rehearse the configured payment flow.

### Vexo band setup

The band option uses team band `Vexo-HACK-33` and the browser library in the local `vexo-open-kit/` folder. Keep that folder beside `public/`; the app serves only its browser library. On [Cashier](http://localhost:3000/cashier), disconnect the kit dashboard, double-tap the band, press **Connect Vexo**, and select the band. Use `localhost` or HTTPS in Chrome or Edge. Set `DEEPGRAM_API_KEY` and leave `MOCK_STT` empty for conversation transcription.

The band's blue light indicates that its microphone is on. Spoken readback plays through the laptop because the band has no speaker. A ready order briefly triggers a purple band light; rehearse physical band behavior before a live demonstration. The laptop microphone and typed commands remain available without the band.

## Checks

Run `npm test` for automated checks. The integration check uses an isolated temporary copy with mock services, so it does not change your `.env` or working database.
