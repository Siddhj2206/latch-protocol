# Research: conversational / agent-commerce UX patterns

Ticket: #16 ("Research: conversational/agent-commerce UX patterns"), under issue #11.
Researched 2026-09-03. Primary sources only (official docs / vendor help / specs); secondary press is flagged where used for context and is NOT a basis for patterns.
No decisions, no implementation. Open questions are recorded, not resolved.

Conventions below: each pattern names its source with link + version/date where shown.

---

## 1. Patterns with sources

### 1A. In-dialog purchase flow: discovery → checkout session → confirmation, rendered by the agent surface, settled by the merchant

- OpenAI ACP "Key concepts" (developers.openai.com/commerce, fetched 2026-09-03): three merchant flows — (1) product feed (CSV/JSON, daily snapshots, required price/availability fields, recommended reviews/media for ranking/trust); (2) Agentic Checkout Spec — ChatGPT collects buyer/fulfillment/payment info, calls merchant ACP endpoints to create/update a checkout session, merchant validates, computes tax, runs its own risk analysis, charges via its own PSP, and **accepts or declines**; ChatGPT then "reflects states and shows the order confirmation (or decline) message to the user"; (3) Delegated Payment Spec — one-time delegated payment request with max chargeable amount + expiry, PSP returns a token, merchant charges as usual. OpenAI is explicitly NOT merchant of record.
  - Source: https://developers.openai.com/commerce/guides/key-concepts
  - Spec index: https://developers.openai.com/commerce/ (checkout spec, delegated-payment spec, feeds specs)
- Stripe "Sell through agents" (docs.stripe.com/agentic-commerce/for-sellers, fetched 2026-09-03): catalog feed as CSV with per-feed cadence — product data daily; **inventory + pricing every 15 min**; `upsert` vs `replace` modes (`delete=true` for clean removal); `checkout.session.completed` webhook → fulfill; Transactions dashboard page **tags orders by originating agent** with agent-name filter; test-a-product from the dashboard sandbox.
  - Source: https://docs.stripe.com/agentic-commerce/for-sellers
  - Overview / integration picker (UCP-or-ACP for sellers; MPP-or-x402 for machine payments): https://docs.stripe.com/agentic-commerce
- Google UCP (ucp.dev, spec versions dated up to 2026-04-08; Google merchant guide 2026-08-25): capability-based protocol — Checkout (cart, tax, unified sessions), Identity Linking (OAuth 2.0), Order (webhook lifecycle: shipped/delivered/returned). Two checkout renderings: **Native** (platform negotiates directly with seller checkout API, custom UI) vs **Embedded** (render business checkout UI, with bidirectional communication + address delegation). Checkout has a formal **status lifecycle + standard errors**; warnings tiered as **notice (default) vs disclosure (requires acknowledgment)**. Schema notes: amounts in minor units, dates RFC 3339.
  - Sources: https://ucp.dev/ ; https://ucp.dev/latest/specification/overview ; https://developers.google.com/merchant/ucp/guides/overview/native-checkout ; repo https://github.com/Universal-Commerce-Protocol/ucp (Apache-2.0)
- Perplexity (primary: vendor blog + help center): product cards answer open-ended shopping questions in-chat; **"Instant Buy"** (help center, updated 2026-07-16) — click Instant Buy, fill details once (saved on file), order + payment sent to merchant for fulfillment, confirmation returned; **merchant stays merchant of record**; non-eligible products **redirect to the merchant site**. Earlier "Buy with Pro" variant: one-click pop-up with prefilled payment, free shipping.
  - Sources: https://www.perplexity.ai/help-center/en/articles/10352906-what-is-instant-buy.html ; https://www.perplexity.ai/hub/blog/shop-like-a-pro ; https://www.perplexity.ai/hub/blog/shopping-that-puts-you-first
- Amazon Rufus Auto Buy (primary: Amazon help page `nodeId=TsaUdPSIWqy1tZhF09`, fetched 2026-09-03): standing rule (target price on Fulfilled-by-Amazon item) → autonomous purchase on default payment/shipping → **email + app + Alexa confirmation**; failures (bad payment method, missing address, out-of-stock) produce explicit failure notifications. Secondary reporting (ModernRetail via shopifreaks, 2025-11-18; paperclipped.de 2026-02-12) adds: ~30-min price monitoring, 24-hour cancellation window, "Buy for Me" on third-party sites keeps the final click human. Treat cadence/cancel-window details as secondary until confirmed on the help page.
  - Sources: https://www.amazon.com/gp/help/customer/display.html?nodeId=TsaUdPSIWqy1tZhF09 ; https://www.aboutamazon.com/news/retail/amazon-rufus
- Context note (secondary, unverified — do not design against): AdsX blog (2026-08-20) claims OpenAI **retired in-chat Instant Checkout ~Mar 2026** and pivoted to discovery-then-merchant-checkout. Flagged only because it would change which ACP flow is filmable; needs a primary confirmation.

### 1B. Step-up / approval UX: what the trustworthy approve card contains

- Vercel AI SDK — Tool Execution Approval (ai-sdk.dev docs, site labels "v7 (Latest)", fetched 2026-09-03): server declares per-tool policy via `toolApproval` — `'not-applicable' | 'approved' | 'denied' | 'user-approval'`, or a function of tool input (canonical example: **payments over $1000 require approval**). Manual flow is two model calls: first returns `tool-approval-request` parts (with `approvalId`, tool call, and a human-readable `reason`); app collects the decision, appends `tool-approval-response`, calls again. Approval UI states on the client: `approval-requested → approval-responded → output-available | output-denied | output-error`. Also: `experimental_toolApprovalSecret` so the server can cryptographically verify the client didn't fabricate an approval; `addToolApprovalResponse({ id, approved })` is only for manual approvals (automatic ones render status, no call).
  - Sources: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling ("Tool Execution Approval", "Dynamic Approval") ; https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage ("Tool Execution Approval", "Client-Side Approval UI", "Securing Approvals")
- AI Elements `Confirmation` component (elements.ai-sdk.dev/components/confirmation, fetched 2026-09-03): Alert-based approval card with sub-parts `ConfirmationRequest` (shown only while `approval-requested`) / `ConfirmationAccepted` / `ConfirmationRejected` (persisted after decision) / `ConfirmationActions` + `ConfirmationAction` buttons. Canonical example renders **the exact consequential input** (file path) plus a plain-language question, **Reject as `outline` + Approve as `default`** (safe action visually secondary), and keeps a permanent accepted/rejected receipt line afterward.
  - Source: https://elements.ai-sdk.dev/components/confirmation
- Google AP2 "Trusted Surface" + mandate model (AP2 spec v0.2, ap2-protocol.org + GitHub google-agentic-commerce/AP2, fetched 2026-09-03): the agent builds Checkout/Payment **Mandate Content**, a trusted UI surface renders it to the user and returns a signed mandate. Two modes: **Human Present (direct)** — user sees and signs the closed (finalized) mandates; **Human Not Present (autonomous)** — user approves **open mandates = constraints** (budget range, allowed payees/instruments, recurrence, execution date) and the agent later assembles closed mandates that verifiers check against those constraints. Payment Mandate is bound to the checkout by cryptographic hash; selective disclosure via SD-JWT.
  - Sources: https://ap2-protocol.org/ap2/specification/ ; https://ap2-protocol.org/ap2/payment_mandate/ ; https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md ; delegation model: https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/agent_authorization.md
- OpenAI Operator guardrails (primary announcement 2025-01-23): three layers — **takeover mode** (user types sensitive data; agent neither collects nor screenshots), **user confirmations before finalizing significant actions** (e.g. submitting an order), **task limitations** (declines banking/high-stakes decisions). Later Operator iterations add risk-tiered execution (navigation autonomous; financial/data-modifying steps surface for approval) and supervised multi-checkpoint approval.
  - Source: https://openai.com/index/introducing-operator/
- Amazon Business approvals (primary: business.amazon.com/learn/approving-requests, 2025-03-24): approver sees **shipping address + payment method + all line items (+PO)** on one order-details page; prices/availability **locked 7 days**; per-item reject allowed (whole-order reject required for wrong address/payment); **rejects should carry a comment** so the buyer can fix and resubmit (buyer gets a rebuild link); buyer gets a confirmation email after approval.
  - Source: https://business.amazon.com/en/learn/approving-requests
- Stripe two-step confirmation (primary docs): optional **review page / post-entry validation** between entering payment details and confirming.
  - Source: https://docs.stripe.com/payments/build-a-two-step-confirmation
- Human-in-the-loop notification layer (vendor blog — Courier, 2026-05-26; primary for their product, secondary for the general pattern): approval notification must carry **what / why / how much with live-fetched context**; reach the human on every active channel; **escalate on silence**; support **ask-the-agent back-and-forth** (pure approve/reject invites hedge-rejects); dedupe double-approvals (first decision wins).
  - Source: https://www.courier.com/blog/human-in-the-loop-ai-agent-notifications

### 1C. Denial / receipt UX: deny states that preserve trust, where the proof lives

- AI SDK denial states (same AI SDK pages as 1B): `output-denied` is a **first-class terminal state** distinct from `output-error`; both automatic-denial and manual-denial `reason`s are rendered in the UI (`part.approval.reason`); guidance to add a system instruction like "when a tool execution is not approved, do not retry it" so the model narrates the denial instead of re-attempting.
- AP2 receipts as dispute evidence (AP2 spec v0.2): **Checkout Receipt + Payment Receipt** are signed artifacts returned to agent/credential-provider/network; verification failures return a signed receipt carrying the error; Checkout Mandate + Receipt and Payment Mandate + Receipt together form the **non-repudiable picture of the transaction** (retention/retrieval out of scope).
  - Source: https://ap2-protocol.org/ap2/specification/ ("Dispute Evidence", "Verification")
- ACP merchant decline (OpenAI key-concepts): when the merchant declines, ChatGPT **reflects the decline state in the same UI** that would have shown confirmation — i.e. the receipt slot doubles as the denial slot.
  - Source: https://developers.openai.com/commerce/guides/key-concepts
- UCP errors + warnings (spec): standard error catalog with an error-processing algorithm + eligibility verification at completion; **warning presentation tiers** (notice vs disclosure-with-acknowledgment) — the pattern for "allowed but the user must demonstrably see it."
  - Source: https://ucp.dev/latest/specification/shopping/checkout/mcp/ (Checkout Capability → Error Handling / Warning Presentation)
- Stripe machine-payment signals (vendor guide MindStudio 2026-05-04, secondary): subscribe to `payment_intent.succeeded / payment_failed / requires_action`; `requires_action` (e.g. 3DS) means **pause the agent, notify the user, resume after confirmation**; keep agent-initiated vs human-initiated transactions labeled from the start. Underlying webhook/event names are Stripe-primary.
  - Source: https://www.mindstudio.ai/blog/stripe-agentic-commerce-suite-ai-agent-payments (secondary); events are Stripe-primary.
- Amazon Business reject-with-comment + rebuild link; Auto Buy failure notifications naming the cause (payment/address/stock) — see 1B/1A sources.
- AI Elements `Tool` component status vocabulary (elements.ai-sdk.dev/components/tool): badges Pending / Running / **Awaiting Approval / Responded** / Completed / **Error / Denied** — denial gets its own badge, not a generic error color.
  - Source: https://elements.ai-sdk.dev/components/tool

### 1D. Chat-commerce dialog mechanics (generative UI primitives)

- AI SDK `useChat` tool-part rendering (chatbot-tool-usage): render from `message.parts` with **exhaustive state switch** (`input-streaming / input-available / approval-requested / approval-responded / output-available / output-error / output-denied`); `sendAutomaticallyWhen` helpers (`lastAssistantMessageIsCompleteWithToolCalls`, `lastAssistantMessageIsCompleteWithApprovalResponses`) resume the loop; **tool-call streaming on by default** (v5+) so partial inputs render progressively; `step-start` parts mark multi-step boundaries.
  - Source: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- AI Elements `Message` suite (elements.ai-sdk.dev/components/message): **user messages in secondary background, assistant full-width flat**; `MessageResponse` markdown (GFM, streaming-safe); `MessageActions` (retry/copy/share w/ tooltips); branch navigation (`MessageBranch*`); file-attachment display; `ConversationScrollButton`.
  - Source: https://elements.ai-sdk.dev/components/message
- AI Elements `Tool` component (see 1C): **collapsible** tool-call cards — `ToolHeader` (name + status icon/badge) / `ToolInput` (JSON) / `ToolOutput`; completed tools auto-open; errors open by default.
  - Source: https://elements.ai-sdk.dev/components/tool
- AI Elements `Task` component (elements.ai-sdk.dev/components/task): collapsible task lists with **pending / in-progress / completed / error icons + completed-vs-total progress counter** — the closest AI-native primitive to a hold/execute/settle progress display.
  - Source: https://elements.ai-sdk.dev/components/task
- shadcn chat-adjacent blocks (ui.shadcn.com/blocks; shadcnregistry ai-elements chatbot example): full-page conversational block shape — **sidebar of past conversations + empty-state welcome with suggestion pills + pinned prompt input**; ai-elements installable via `npx ai-elements` / `npx shadcn add <registry-url>`.
  - Sources: https://ui.shadcn.com/blocks ; https://github.com/vercel/ai-elements ; https://ui.shadcn.com/docs/helpers/ai-sdk
- shadcn `AlertDialog` composition (ui.shadcn.com/docs/components/alert-dialog): `Trigger → Content → Header(Title + Description) → Footer(Cancel + Action)`; `size="sm"`; media slot for icon; **destructive variant** — the modal-interrupt alternative to an inline approve card.
  - Source: https://ui.shadcn.com/docs/components/alert-dialog

### 1E. Audit / ledger dashboard patterns (dense financial tables, lifecycle status)

- shadcn `dashboard-01` block (ui.shadcn.com/blocks, fetched 2026-09-03): canonical dense-dashboard shape — **sidebar + section stat cards + interactive chart + data table** (`npx shadcn add dashboard-01`).
  - Source: https://ui.shadcn.com/blocks
- shadcn Data Table guide (TanStack Table; guide now shows **v9 feature-based** `tableFeatures()` with tree-shaken sorting/filtering/pagination/selection/visibility): payments-shaped example (`status | email | amount`), **Intl.NumberFormat currency cell formatting**, row actions via dropdown (copy payment ID, view customer/payment), pagination controls, column-visibility menu, selected-row counter (`x of y rows selected`), empty-state "No results."
  - Source: https://ui.shadcn.com/docs/components/data-table
- Stripe seller dashboard behaviors (for-sellers page): **agent-tagged transaction list w/ agent filter**, feed/catalog health + error-file download (`stripe_error_message` leading column), batch fulfillment via list-CheckoutSessions with `starting_after` cursor to avoid duplicates.
  - Source: https://docs.stripe.com/agentic-commerce/for-sellers
- Lifecycle/status vocabularies from specs (for status-chip design): UCP checkout **status lifecycle + standard errors** (ucp.dev); AP2 **mandate ↔ receipt pairs** as the audit trail (what-authorized vs what-happened); AI SDK **tool-part states** (1B) as the dialog-side equivalent of lifecycle.
- Deny-side interleaving precedent: AI SDK renders `output-denied` **inline in the message transcript** at the position of the refused call (chatbot-tool-usage example); Stripe dashboard keeps failures filterable in the same transaction list (agent filter); Amazon Business keeps rejected requests visible with comments + rebuild action. No primary source shows a separate "denials table" — denials live **in the same list, distinguished by status**.

---

## 2. What each implies for our flows

(Implications only — no decisions taken.)

- **Chat loop (shop_search → check_remaining → pay):** the 1A consensus (ACP checkout sessions, UCP native checkout, Perplexity product cards) says discovery results should render **as structured cards inside the dialog** (price/availability explicit, feed-fresh), and the pay step should produce a **session-like object** whose final state (confirmation or decline) renders **in the same dialog slot**. The 1D primitives (`message.parts` exhaustive switch, tool-call streaming, `step-start` boundaries, collapsible `Tool` cards) map 1:1 onto our tool-call transcript.
- **request_step_up → Approve card:** the 1B consensus says the card must show, in hierarchy order — **amount → merchant → what Exactly (line items/constraints) → why (reason/policy clause) → expiry/scope** — with the destructive/safe action visually distinct (AI Elements: Reject=`outline`, Approve=`default`; AP2: closed mandate vs open-constraint display). Dynamic step-up (only above a threshold, cf. AI SDK $1000 example) and a persistent post-decision receipt line (ConfirmationAccepted/Rejected) are both established patterns. The `experimental_toolApprovalSecret` pattern implies approvals in our loop need server-side verification, not client assertion.
- **Denials → rejection receipts:** 1C says denial is a **terminal, named state** (`output-denied`, Denied badge), never a generic error; the receipt should carry **code / message / failing clause / expected-vs-got** because every spec-level denial (AP2 signed error receipts, UCP standard errors, Amazon reject-comments, Auto Buy failure causes) **names the cause and, where possible, the remedy** (fix-and-resubmit, rebuild link, resume-after-3DS). The proof (mandate/receipt pair, approval id + reason) lives **attached to the denial row**, not on a separate page.
- **Ledger dashboard (held → executed → captured | voided + denials):** 1E says: one dense table (dashboard-01 shape: stat cards + table), **status chips from a closed vocabulary**, currency-formatted amounts, row actions (copy id, view detail), selected-row count, empty state — with **denials interleaved as rows with Denied status**, matching the AI SDK (inline `output-denied`), Stripe (agent-tagged single list), and Amazon Business (rejected requests stay visible) precedents. Feed-health/error-file (Stripe) and mandate↔receipt pairing (AP2) imply each ledger row should link back to its dialog-side artifact.
- **Merchant store + agent-readable catalog:** ACP feeds + Stripe catalog-feed cadences (daily product, 15-min inventory/price, explicit deletion) imply the catalog needs **freshness metadata visible somewhere** (stale price = failed checkout is called out as the top failure mode in Stripe's seller docs).
- **Trust under film conditions:** Operator's takeover mode + AP2's Trusted Surface both imply the approve moment must be visibly **human-gated** (agent pauses, human acts, resumption is explicit) — this is the single most filmable trust beat.

## 3. Filmable moments

Ranked by how legibly each reads on camera (no staging decisions made):

1. **The pause-and-approve:** agent streams tool calls, halts at the Approve card (amount/merchant/proof hierarchy visible), human clicks Approve → execution resumes → receipt streams in. (AI SDK approval flow + Confirmation component + Operator confirmations.)
2. **The denial receipt:** over-budget (or wrong-merchant) request → red Denied badge inline in chat → receipt renders code/message/failing-clause/expected/got → ledger gains a Denied row. (AI SDK `output-denied` + AP2 error receipts + Amazon reject-comment.)
3. **The lifecycle sweep:** ledger table filtering held → executed → captured, then a void, with status chips + amounts + timestamps — one continuous pan. (dashboard-01 + data-table guide + UCP status lifecycle.)
4. **The standing rule (if in scope):** set-a-limit moment ("buy X if under $Y") → later autonomous execution + confirmation notification. (Amazon Auto Buy; AP2 Human-Not-Present open mandates.)
5. **The stale-price save (if in scope):** 15-min price/inventory refresh prevents a checkout failure; feed-health indicator visible. (Stripe seller docs feed cadence.)
6. **The proof link:** click from a ledger row back to the exact dialog turn (mandate ↔ receipt pairing). (AP2 dispute-evidence model; Stripe agent-tagged transactions.)

## 4. Open questions

1. Approve card primitive: inline card (AI Elements `Confirmation`) vs modal interrupt (`AlertDialog`) — which reads better on film and for a11y? Undecided.
2. Proof-block placement: full mandate/quote inline on the card vs collapsed (`Tool`-style collapsible) vs ledger-only — hierarchy unvalidated with users.
3. Threshold policy for step-up (always-approve vs amount-gated, cf. AI SDK dynamic-approval example): no policy chosen.
4. Denial-row content: exact code vocabulary and whether expected/got renders for every denial type or only budget/merchant mismatches.
5. Ledger denials: interleaved rows (all precedents) vs separate tab — precedents favor interleaved but no decision.
6. Lifecycle vocabulary lock: held→executed→captured|voided assumed from ticket; UCP/AP2 vocabularies differ — mapping unconfirmed.
7. ACP Instant Checkout status: secondary press claims retirement (~Mar 2026); needs a primary check before citing ACP in-dialog checkout as current.
8. Rufus Auto Buy cadence (30 min) + 24-h cancel window: secondary only; confirm on Amazon help before referencing.
9. Light mode + mono-label density: Nous-portal aesthetic direction is given, but no primary source surveyed covers "dev-tool marketplace" aesthetics — may need a design-reference pass (out of scope for this ticket).
10. Escalation on approver silence (Courier pattern) and ask-the-agent back-and-forth: applicable to a single-user demo loop? Scope unclear.
11. `toolApprovalSecret`-style server verification of approvals: assumed necessary; no threat model written (likely another ticket's scope).
12. Catalog freshness surfacing (Stripe 15-min cadence): does the merchant store UI show feed health, or is it ledger-only? Undecided.
