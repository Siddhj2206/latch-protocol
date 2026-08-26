# Latch — Cryptographic Capability Tokens for Agentic Swarms

**Event:** Razorpay AI Buildathon 2026  
**Track:** 01 — AI Growth & Agentic Commerce  
**Core Thesis:** Identity-based access (OAuth) is fundamentally broken for autonomous AI swarms. Latch replaces Identity with _Cryptographic Capabilities_ (Biscuits), delivering mathematically bounded, edge-verified money actions for agent-to-agent commerce.

---

## 1. The Problem: The Agentic Auth Trilemma

Razorpay's recent launches (Agentic Payments, Razorpay MCP) successfully fixed the _interface_ of AI commerce. But the underlying trust model for API execution still relies on human-era API keys and OAuth tokens. This creates three fatal gaps for the multi-agent economy:

1. **The Delegation Problem (Agentic UPI Circle):** If an Orchestrator AI needs to spawn three sub-agents (Flight, Hotel, Cab), it cannot safely share its OAuth token without giving them access to the entire bank account. Minting new tokens requires slow, centralized database round-trips.
2. **The Ambient Authority Problem (Prompt Injection):** If an agent holding an API key is hit by a prompt-injection attack, the blast radius is the entire account limit.
3. **The UX Black Box:** When AI payments fail today, users get generic `403 Forbidden` errors, destroying consumer trust in autonomous agents.

**Current Alternatives Fail:** Virtual Credit Cards (VCCs) are too slow and fiat-heavy for multi-agent micro-transactions. Web3 Session Keys don't integrate natively with Web2 fiat merchants (Razorpay).

---

## 2. The Solution: The Latch Protocol

Latch is a Layer-2 Authorization Protocol that wraps Razorpay's native MCP and `/v1/orders` APIs. Instead of "Identity" (Who are you?), Latch operates on **Capabilities** (What does this token mathematically allow?).

Powered by **Biscuit** (Macaroons 2.0 via Rust/WASM) and **Datalog**, Latch issues cryptographically attenuable tokens.

- **Offline Attenuation:** An Orchestrator AI holding a ₹10,000 Latch token can locally stamp a ₹5,000 limit onto it and hand it to a sub-agent. _No network calls required._
- **Stateless Verification:** Caveats are checked via WASM at the Cloudflare Edge. Invalid payloads are rejected mathematically before ever touching Razorpay's databases.

---

## 3. Core Differentiators & Product Features

- **"Agentic UPI Lite" (Autonomous Micro-spending):** Users mint a Latch token with a limit of ₹500 per transaction and ₹2,000 globally. The AI executes these micro-purchases completely autonomously, bounded by cryptography.
- **"WYSIWYS" Generative UI (What You See Is What You Sign):** If the AI wants to buy a ₹6,000 flight, it triggers an MCP tool. A Generative UI Auth Card pops up in the chat, displaying the actual **Datalog smart contract** to the user before they click "Approve".
- **Explainable Rejections:** Because Latch uses Datalog, a failed transaction returns a logical proof (e.g., `Error: Merchant Category Mismatch. Expected: travel, Got: food`), mapping perfectly to Track 1's "Explainable" requirement.
- **The Agent-Readable Web:** Latch relies on merchants hosting an `agent.json` (or `llms.txt`) file that defines their catalog and checkout endpoints, standardizing UI-less agent checkout.

---

## 4. Threat Modeling & Cryptographic Guardrails

Latch is designed for the messy reality of Indian e-commerce and adversarial AI.

| Attack / Edge Case               | Latch Cryptographic Guardrail                                                                                                                                                        |
| :------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Merchant Payload Tampering**   | **Intent Hashing:** The AI hashes the cart intent (`amount`, `currency`, `merchant_id`). The Edge Gateway hashes the incoming Razorpay request. Mismatches mathematically hard-fail. |
| **Slippage / Surge Pricing**     | **Cryptographic Slippage Caveats:** Datalog natively allows variance: `check if $amt <= $target * 1.05`. The AI autonomously absorbs a ₹15 Blinkit rain-fee.                         |
| **Pre-minting Prompt Injection** | **Bounded Blast Radius:** An injected AI abusing a "UPI Lite" auto-approve token is mathematically capped at the D1 global limit (e.g., ₹2,000). The human's savings are isolated.   |
| **Sybil Swarm Attack**           | **Delegation Depth Bounds:** A rogue AI cannot spawn 10,000 sub-agents to bypass limits. A root caveat (`check if token_depth <= 2`) shatters the token if delegated too far.        |
| **Cross-Merchant Replay Attack** | **Audience Binding (`aud`):** Tokens include `check if merchant_id == "rzp_123"`. A malicious merchant cannot use a stolen token to buy items at another store.                      |

---

## 5. Architecture & Monorepo Structure

**Stack:** Better-T-Stack, Turborepo, TanStack Start (Web UI), Hono (Cloudflare Workers API Gateway), Cloudflare D1 (Edge Database), Rust -> WASM (`@smithery/biscuit`).

```text
latch-protocol/
├── apps/
│   ├── web/                           # (TanStack Start)
│   │   ├── app/routes/index.tsx       # 🟢 USER CHAT APP: Vercel AI SDK + Generative UI
│   │   ├── app/routes/store.tsx       # 🟠 MERCHANT VIEW: "SneakerHead India" checkout
│   │   ├── app/routes/ledger.tsx      # 🔵 LATCH AUDIT DASHBOARD: Real-time D1 visualization
│   │   └── public/agent.json          # 🤖 The AI-readable catalog
│   │
│   └── server/                        # (Hono + Cloudflare Workers)
│       ├── src/index.ts               # 🔴 LATCH GATEWAY: Edge Verifier & Webhook listener
│       └── src/db/schema.ts           # 🟡 D1 DB: The 2-Phase Commit Ledger (Drizzle)
│
├── packages/
│   ├── latch-core/                    # 🦀 RUST / WASM LOGIC (Biscuit Auth Wrapper)
│   └── db/                            # Shared Types & Schemas
```

_(Dev Note: Token isolation is strictly maintained. The raw Base64 token is kept in client state/headers, never passed into the LLM context window to save tokens and prevent leaks. Fast LLMs like `gpt-4o-mini` at `temperature: 0` are used for instant tool-routing)._

### The Two-Phase Commit Ledger (Handling Refunds & Failures)

To prevent agents from losing their budget on failed network calls, Latch implements a double-entry ledger in Cloudflare D1, synced via Razorpay Webhooks:

1. **Hold (Auth):** Gateway validates the Biscuit, writes `HOLD ₹3000` to D1, deducts AI budget.
2. **Execute:** Calls Razorpay Test API.
3. **Capture/Void (Webhooks):** Gateway listens for Razorpay `payment.captured` or `refund.processed` webhooks. If a refund occurs, it autonomously credits the D1 ledger, instantly restoring the AI's budget.

---

## 6. The 5-Minute Pitch & Demo Choreography

**Act 1: The AI-Ready Merchant & Ecosystem (0:00 - 1:00)**

- Explain the "Agentic Auth Trilemma". Position Latch as the mathematical Layer-2 security for Razorpay's MCP.
- Show the dummy merchant site (`/store`), pointing out `agent.json`. _"We made SneakerHead India end-to-end transactable by AI."_

**Act 2: Agentic UPI Lite & Slippage (1:00 - 2:30)**

- **Split Screen:** Chat UI on the left, **Latch Audit Ledger** (`/ledger`) on the right.
- User prompts the Chat UI: _"Buy me the ₹490 shoes."_
- The Agent executes instantly using its pre-minted UPI Lite token.
- Show the Ledger Dashboard instantly updating from `HOLD 🟡` to `CAPTURED 🟢`. Explain the 5% Slippage Caveat that allowed the purchase to succeed despite a simulated ₹15 surge fee.

**Act 3: Generative UI Step-Up Auth (2:30 - 4:00)**

- User prompts: _"Also buy me the ₹6,000 limited edition jacket."_
- Agent hits its mathematical boundary. Uses MCP tool to ask for permission.
- **The UI Flex:** The Generative UI Auth Card renders in the chat, displaying the actual Datalog verification logic. User clicks "Approve". Browser WASM mints a single-use Biscuit token.
- Run the **Malicious Merchant Script:** Intercept and change the checkout amount to ₹7,000.
- Show the Gateway and Ledger hard-failing with an explainable error: `❌ Intent Hash Mismatch`.

**Act 4: The Enterprise Future (4:00 - 5:00)**

- Show the Turborepo architecture.
- Explain that because Latch uses Datalog, it easily extends to B2B Maker-Checker flows (Multi-sig capabilities for Enterprise Agentic Spend). List the Honest Exceptions.

---

## 7. The "Honest Exception" List

1. **D1 Replication Latency:** Cloudflare D1 is eventually consistent. A highly sophisticated, geographically distributed concurrent double-spend attack could theoretically pass within a ~100ms window before the ledger syncs globally.
2. **Key Custody:** For this demo, the root private key is stored in browser memory/local state. A production version would require secure hardware enclave storage (e.g., Apple Secure Enclave / Passkeys) linked to a Razorpay UPI Mandate.
3. **Cross-Currency Math:** Caveat logic currently assumes base INR. Cross-currency slippage requires external oracle integration not present in the demo.
