# Research: Razorpay test-mode Orders, webhooks & MCP surface

> Research ticket: https://github.com/Siddhj2206/latch-protocol/issues/4 (resolved 2026-08-25)
> Facts only — no preferences or recommendations. Every claim cites its primary source.
> All sources are official Razorpay docs (`razorpay.com/docs/*`), the official
> `razorpay/razorpay-mcp-server` repo (README + Go source), and the official
> `razorpay/razorpay-go` SDK doc.
> Confidence key: **HIGH** = quoted/verified directly on an official page; **MED** =
> derived across two official sources or a JS-rendered table that couldn't be scraped verbatim.

---

## 1. Test mode & API keys

- The Razorpay Dashboard has a **Test / Live toggle**. Test mode is a sandbox:
  same functionality as Live except real payments cannot be accepted. You must
  generate a **separate set of API keys per mode**. [HIGH]
  — https://razorpay.com/docs/payments/dashboard/test-live-modes/
- Generate keys: Dashboard → **Account & Settings → API Keys** (under *Website and
  app settings*) → **Generate Key**, with the mode selected first. Test keys can be
  generated without adding a website; Live keys require a verified business website.
  The Key ID is visible on the dashboard; the Key Secret is shown once at generation.
  [HIGH] — https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/
  and https://razorpay.com/docs/api/authentication
- Test-mode Key IDs have the literal prefix `rzp_test_` (docs write
  `rzp_test_XXXXXXXXXXXXXXXX`). Live keys use `rzp_live_`. [HIGH]
  — https://razorpay.com/docs/developer-tools/integrations/standard-checkout/
- The sandbox and live API share the **same base URL**: `https://api.razorpay.com/v1/`
  (v2 for certain APIs). Test vs live is selected purely by which keys you send. [HIGH]
  — https://razorpay.com/docs/api/sandbox-setup
- All requests authenticate with **HTTP Basic Auth**: an `Authorization: Basic base64(key_id:key_secret)`
  header (base64 of `KEY_ID:KEY_SECRET`). Header format must be exactly `Basic base64token`
  (lowercase/`"quoted"`/`$var` forms are rejected). [HIGH]
  — https://razorpay.com/docs/api/authentication

## 2. Create an order — exact request/response

- Endpoint: `POST https://api.razorpay.com/v1/orders`. [HIGH]
  — https://razorpay.com/docs/api/orders/create/
- Minimal curl (from the docs page, verbatim):
  ```bash
  curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] \
    -X POST https://api.razorpay.com/v1/orders \
    -H "content-type: application/json" \
    -d '{
      "amount": 5000,
      "currency": "INR",
      "receipt": "receipt#1",
      "notes": { "key1": "value3", "key2": "value2" }
    }'
  ```
- Required body params: `amount` (integer, **smallest currency sub-unit** — ₹299 → `29900`),
  `currency` (3-letter ISO). Optional: `receipt` (≤40 chars, **unique — acts as an
  idempotency key**; duplicate `receipt` is rejected with 400), `notes` (JSON, ≤15 pairs,
  ≤256 chars each). [HIGH]
- Response (`201`/success body shown in docs):
  ```json
  {
    "amount": 5000, "amount_due": 5000, "amount_paid": 0, "attempts": 0,
    "created_at": 1756455561, "currency": "INR", "entity": "order",
    "id": "order_RB58MiP5SPFYyM",
    "notes": { "key1": "value3", "key2": "value2" },
    "offer_id": null, "receipt": "receipt#1", "status": "created"
  }
  ```
- Order states: `created` → `attempted` (first payment attempted) → `paid`
  (only after a payment against it is **captured**; stays `paid` even if later refunded). [HIGH]

## 3. Creating a payment against the order (test instruments)

### 3a. Standard Checkout (the documented happy path)
- Docs flow: create order on the server → pass `order_id` into Standard Checkout →
  customer pays → verify on the server. A payment **without an order_id cannot be
  captured and will be automatically refunded**. [HIGH]
  — https://razorpay.com/docs/developer-tools/integrations/standard-checkout/
  and https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v2/build-integration/cards/

### 3b. S2S `POST /v1/payments/create/json` (server-to-server, still documented)
- Current docs (S2S JSON v2, cards): after creating the order, create the payment directly:
  ```bash
  curl -X POST https://api.razorpay.com/v1/payments/create/json \
    -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] \
    -H "Content-Type: application/json" \
    -d '{
      "amount": 100, "currency": "INR",
      "contact": "9900008989", "email": "gaurav.kumar@example.com",
      "order_id": "order_DPzFe1Q1dEOKed",
      "callback_url": "https://...",
      "method": "card",
      "card": { "number": "4386289407660153", "name": "Gaurav",
                "expiry_month": "11", "expiry_year": "30", "cvv": "100" },
      "authentication": { "authentication_channel": "browser" },
      "browser": { "java_enabled": false, "javascript_enabled": false,
                   "timezone_offset": 11, "color_depth": 23,
                   "screen_width": 23, "screen_height": 100 },
      "ip": "105.106.107.108", "referer": "https://...", "user_agent": "Mozilla/5.0"
    }'
  ```
- Required: `amount`, `currency`, `order_id`, `email`, `contact`, `method`, `ip`,
  `user_agent`, plus method-specific objects (`card{number,name,expiry_month,expiry_year,cvv}`,
  `browser`, `authentication`). Optional: `callback_url` (final status posted here), `notes`.
  Response: `razorpay_payment_id` + `next[]` of actions (`otp_generate` / `redirect`),
  then finish with `POST /v1/payments/:id/otp_generate` and `POST /v1/payments/:id/otp/submit`
  (body `otp=123456`). Final success returns `razorpay_payment_id`, `razorpay_order_id`,
  `razorpay_signature`. [HIGH]
  — https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v2/build-integration/cards/
  (same endpoint/params also in S2S JSON v1:
  https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v1/build-integration/cards/)
- Note: in the **current** v1 & v2 `/payments/create/json` request-parameter tables the
  docs do **not** list a `capture: true/false` flag. The capture behaviour is set via the
  Orders API / account settings (see §5). [HIGH — verified by absence in fetched param tables]

### 3c. Test instruments
- **Test cards** (test mode only; no real money; live keys reject these with
  `card issuer is invalid` / `invalid card input`). Behaviour: use any random CVV and any
  future expiry date; on success the mock bank page asks for an OTP — **4–10 digits → success,
  <4 digits → failure**. [HIGH] — https://razorpay.com/docs/payments/payments/test-card-details/
  - The per-network "test cards for Indian payments" table on that page is JS-rendered and
    did not render in the fetched copy (MED — exact Indian table numbers not captured).
  - Numbers verified in the docs' static HTML (International/Asia test-card table and the
    S2S examples): `4628 9499 7226 2986` (India row), `4842 7930 0208 6571` (Malaysia),
    `4916 3338 9663 2957` (USA), `5105 1051 0510 5100` (Mastercard, international),
    `4386289407660153` (example Visa used throughout S2S card samples). [MED]
- **Test UPI**: `success@razorpay` → success, `failure@razorpay` → failure. Caveat: in
  **test mode, a UPI cancellation results in a successful payment** (documented). [HIGH]
  — https://razorpay.com/docs/payments/payments/test-upi-details/
  and https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v2/test-integration/

## 4. Webhooks

### 4a. Configuration
- Set up per mode (separate URLs for Live vs Test) at Dashboard → **Account & Settings →
  Webhooks** → Add New Webhook. Enter URL + optional **Secret** + select Active Events.
  Up to **30 URLs**; URLs **must use port 80 or 443** and be **public**; a URL containing
  `razorpay` as a domain is rejected. [HIGH]
  — https://razorpay.com/docs/webhooks/setup-edit-payments/
- Test-mode webhook setup/editing/deletion asks for the default **OTP `754081`**; a Test-mode
  webhook receives events for test transactions only. [HIGH]
  — https://razorpay.com/docs/webhooks/setup-edit-payments/,
  https://razorpay.com/docs/webhooks/validate-test/
- Delivery: must respond **2XX within 5 seconds**, else exponential-backoff retries for
  **24 hours**, then the webhook is **auto-disabled**. Failure alerts go to the Alert Email.
  Use `x-razorpay-event-id` header (unique per event) for idempotency; events may arrive out
  of order (e.g. `payment.authorized` then `payment.captured` — "may not be followed at all
  times"). [HIGH] — https://razorpay.com/docs/webhooks/setup-edit-payments/,
  https://razorpay.com/docs/webhooks/validate-test/

### 4b. Relevant events (names as documented)
- **Payments**: `payment.authorized`, `payment.captured`, `payment.failed`, plus
  `payment.downtime.started` / `payment.downtime.resolved` / `payment.downtime.updated`.
  [HIGH — event names & payloads on the page]
  — https://razorpay.com/docs/webhooks/payments/
- **Orders**: `order.paid` fires when a payment associated with an order is captured —
  documented as the order-level counterpart of `payment.captured` (payload snapshot when the
  order moved to `paid`). [HIGH] — https://razorpay.com/docs/webhooks/orders/
- **Refunds**: `refund.created`, `refund.processed` (final state), `refund.failed`,
  `refund.speed_changed`. [HIGH] — https://razorpay.com/docs/webhooks/refunds/
- On **granular successors**: the docs keep `payment.captured` / `refund.processed` as the
  canonical capture/refund events; the "newer/more granular" events are the per-entity ones
  (`order.paid`, `payment.failed`, `payment.downtime.*`, `refund.created/failed/speed_changed`).
  No event-name replacement for `payment.captured` / `refund.processed` was found on these
  pages. [MED — based on the full event list pages; the subscribable event tables are
  JS-rendered and the names above were read from sample-payload sections]
  — full list index: https://razorpay.com/docs/webhooks/all/

### 4c. Signature verification
- When a webhook **secret** is set, Razorpay includes the payload hash in the
  **`X-Razorpay-Signature`** header. (Note: the header is `X-Razorpay-Signature`, not
  "Razorpay-X-Signature".) [HIGH]
  — https://razorpay.com/docs/webhooks/validate-test/
- Verification: `expected = HMAC-SHA256(message=raw webhook body, key=webhook_secret)`,
  hex digest, compare with the received signature. The body must be the **raw** request body
  — "Do not parse or cast the webhook request body". If the secret is rotated, use the **old**
  secret for retried/older requests. SDKs provide
  `Utils.verifyWebhookSignature(payload, signature, secret)`. [HIGH]
- Separately, the **checkout/callback** success payload (`razorpay_signature`) is verified as
  `hmac_sha256(order_id + "|" + razorpay_payment_id, key_secret)` — this is the completion
  callback signature, distinct from the webhook header signature. [HIGH]
  — https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v2/build-integration/cards/

### 4d. Local dev / reaching a locally-running app
- **localhost cannot be used directly** — webhook delivery requires a public URL, and saving
  a localhost endpoint errors out. [HIGH]
- **Many common tunnels are blacklisted** and rejected as webhook URLs: `burpcollaborator.net`,
  `oast.pro`, `interact.sh`, `canarytokens.com`, `requestbin.com`, `webhook.site`,
  `hookbin.com`, `beeceptor.com`, `mockbin.org`, **`ngrok.io`**, **`loca.lt`**. [HIGH]
- Docs' workaround for localhost: create a tunnel to localhost using **`zrok`**
  (docs.zrok.io), or point a **staging host** configured in Test mode. [HIGH]
  — https://razorpay.com/docs/webhooks/validate-test/

## 5. Hold-then-capture (“order → auth → later capture”) — documented support

- **Yes, this is a supported, documented flow and it is not wallet-specific.**
  Orders-API payments can be held in `authorized` state and captured later, via three layers
  (all documented):
  1. **Per-order override on `POST /v1/orders`**: pass a `payment` object with
     `capture: "manual"` (or `"automatic"`) plus `capture_options`
     (`automatic_expiry_period` mins, `manual_expiry_period` mins, `refund_speed`);
     these take precedence over the account-level setting. Example body:
     ```json
     { "amount": 50000, "currency": "INR", "receipt": "rcptid_11",
       "payment": { "capture": "automatic",
         "capture_options": { "automatic_expiry_period": 12,
                              "manual_expiry_period": 7200, "refund_speed": "optimum" } } }
     ```
     [HIGH] — https://razorpay.com/docs/payments/payments/capture-settings/api/
  2. **Legacy boolean** `payment_capture: true|false` on order creation — still documented
     in the official SDK doc (`razorpay-go` "Payment capture settings API"). [HIGH]
     — https://github.com/razorpay/razorpay-go/blob/master/documents/payment.md
  3. **Account-level Dashboard setting**: automatic vs manual capture (default = auto-capture
     all), with timeouts. [HIGH]
     — https://razorpay.com/docs/payments/payments/capture-settings/
- Manual capture then happens via **`POST /v1/payments/:id/capture`** with
  `{ "amount": <paise>, "currency": "INR" }`; **only payments in `authorized` state can be
  captured**; capture amount must equal the authorised amount. Response shows
  `"status": "captured"`, `"captured": true`. [HIGH]
  — https://razorpay.com/docs/api/payments/capture
- Constraints documented:
  - **Manual capture is not supported for bank-transfer payments** (auto-captured), but **is**
    supported for card / UPI etc. (capture API response examples show card and UPI). [HIGH]
  - Authorized payments **must be captured within 3 days** of creation, else auto-refunded
    (the `capture-settings/api` page says **5 days** — the two pages differ; both within the
    same docs). [HIGH for “auto-refunded if not captured in time”, MED on the exact 3-vs-5 day]
  - Default expiry values: `manual_expiry_period` default `7200` min (max `7200`);
    `automatic_expiry_period` min `12` min. [HIGH]
  - Refunds only on `captured` payments: `POST /v1/payments/:id/refund` with optional
    `amount` (omit = full refund), `speed`, `notes`, `receipt`. Refund states:
    `pending → processed` (final) / `failed`. [HIGH]
    — https://razorpay.com/docs/api/refunds/create-normal and
    https://razorpay.com/docs/api/refunds/
- So the documented options are (a) hold via manual-capture config and capture later, or
  (b) auto-capture immediately (default). No “must capture immediately” rule for
  card/UPI/Orders-API payments. [MED-HIGH, per above]

## 6. Official MCP server (`github.com/razorpay/razorpay-mcp-server`)

- Two deploy modes: **Remote** (hosted, `https://mcp.razorpay.com/mcp`, via `npx mcp-remote`,
  auth header `Authorization: Basic <base64(key:secret)>` — base64 of `key_id:key_secret`
  is called the “merchant token”) and **Local** (Docker image `razorpay/mcp` with env
  `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, or Go build). Local also supports
  `READ_ONLY` / `TOOLSETS` config. [HIGH]
  — https://github.com/razorpay/razorpay-mcp-server (README.md)
- The tool catalogue (README, package `razorpay-*`) and the **Remote Server Support** column
  for the tools relevant to this use case: [HIGH — README table + source `pkg/razorpay/tools.go`]
  | Tool | Endpoint it wraps | Remote mode? |
  |---|---|---|
  | `create_order` | `POST /v1/orders` | ✅ yes |
  | `capture_payment` | `POST /v1/payments/:id/capture` | ✅ yes |
  | `create_refund` | `POST /v1/payments/:id/refund` | ❌ **no (local only)** |
  | `fetch_order` | `GET /v1/orders/:id` | ✅ yes |
  | `fetch_payment` | `GET /v1/payments/:id` | ✅ yes |
  | `initiate_payment` | `POST /v1/payments/create/json` (saved method + order) | ✅ yes |
  | `submit_otp`, `resend_otp` | otp submit/resend | ✅ yes |
- **This is the key MCP fact for the demo:** `create_refund` is listed with **no remote
  support** — refund creation requires the **local** (Docker/source) server. All the other
  write tools needed (`create_order`, `capture_payment`) and the reads (`fetch_order`,
  `fetch_payment`) are available in **remote** mode. [HIGH — README Support column]
- Tool input shapes (from Go source `pkg/razorpay/orders.go`, `refunds.go`, `payments.go`):
  - `create_order`: required `amount` (number, paise, min 100), `currency` (`^[A-Z]{3}$`);
    optional `receipt` (≤40), `notes` (≤15), `partial_payment`, `first_payment_min_amount`,
    `transfers[]`, and mandate-order fields (`method`, `customer_id`, `token`). Returns the
    order object JSON. [HIGH]
  - `capture_payment`: required `payment_id` (pay_ prefix), `amount` (paise), `currency`.
    Returns the payment JSON with `status: captured`. [HIGH]
  - `create_refund`: required `payment_id` (pay_), `amount` (paise, min 100); optional
    `speed`, `notes`, `receipt`. Returns refund JSON. [HIGH]
  - `fetch_order`: required `order_id`. [HIGH]
  - `fetch_payment`: required `payment_id`. [HIGH]
  - (`fetch_order_payments`: required `order_id` — useful to list payments on an order.) [HIGH]
- Reading toolset wiring: payments/orders/refunds toolsets each expose read vs write tools;
  `READ_ONLY` mode strips write tools. [HIGH — source `tools.go`]

## Sources

All fetched/verified 2026-08-25 (fetched live from razorpay.com docs + GitHub raw):

- Orders create: https://razorpay.com/docs/api/orders/create/
- Auth: https://razorpay.com/docs/api/authentication · Sandbox: https://razorpay.com/docs/api/sandbox-setup
- Test/live modes: https://razorpay.com/docs/payments/dashboard/test-live-modes/
- API keys: https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/
- Standard Checkout: https://razorpay.com/docs/developer-tools/integrations/standard-checkout/
- Test cards: https://razorpay.com/docs/payments/payments/test-card-details/
- Test UPI: https://razorpay.com/docs/payments/payments/test-upi-details/
- Capture settings: https://razorpay.com/docs/payments/payments/capture-settings/ and
  https://razorpay.com/docs/payments/payments/capture-settings/api/
- Capture API: https://razorpay.com/docs/api/payments/capture
- Refunds API: https://razorpay.com/docs/api/refunds/ · create normal: https://razorpay.com/docs/api/refunds/create-normal
- S2S JSON v2 cards: https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v2/build-integration/cards/
  · v1: https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v1/build-integration/cards/
  · test integration: https://razorpay.com/docs/payments/payment-gateway/s2s-integration/json/v2/test-integration/
- Webhooks: https://razorpay.com/docs/webhooks/ · setup: https://razorpay.com/docs/webhooks/setup-edit-payments/
  · validate/test: https://razorpay.com/docs/webhooks/validate-test/ · payments:
  https://razorpay.com/docs/webhooks/payments/ · refunds: https://razorpay.com/docs/webhooks/refunds/
  · orders: https://razorpay.com/docs/webhooks/orders/ · all: https://razorpay.com/docs/webhooks/all/
- MCP: https://github.com/razorpay/razorpay-mcp-server (README.md; source `pkg/razorpay/{tools,orders,payments,refunds}.go`)
- SDK doc (legacy `payment_capture` + S2S create-payment-json params):
  https://github.com/razorpay/razorpay-go/blob/master/documents/payment.md
