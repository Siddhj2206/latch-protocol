# Latch

Latch is a capability-based authorization layer for agentic commerce: instead of answering "who are you?", it answers "what does this token mathematically allow?" Money actions are authorized by cryptographically-attenuable capability tokens (Biscuit + Datalog) verified at the edge, with every payment recorded in a double-entry ledger.

## Language

### Capabilities

**Capability** (a.k.a. "Latch token"):
A signed, attenuation + Datalog-caveated spend authorization. Its meaning is "what this token can do", never "who holds it".
_Avoid_: token (for identity), API key, pre-authorization

**Root**:
The minted budget authority: a keypair under human custody from which all capabilities in a swarm derive. Only the root key can mint new roots; attenuation never can.
_Avoid_: master key, account

**Budget envelope** (envelope):
The spend bound attached to a root — per-transaction cap, global budget, spent, remaining. Every capability derived from the root spends against its envelope; only the ledger changes `spent`/`remaining`.
_Avoid_: wallet, limit, allowance

**Swarm**:
The set of capabilities derived, directly or transitively, from one root, spending against its envelope.
_Avoid_: agent cluster, token family

**Step-up envelope**:
A fresh, single-use, human-approved envelope minted on Approve when the auto envelope is exhausted. It never extends the auto envelope; it is its own bounded spend.
_Avoid_: top-up, override, extension

**Root issuance** (a.k.a. minting a root):
The act of the authority (a root keypair) creating a capability carrying the budget bound and default caveats. In code: `mintRoot`.
_Avoid_: creating a token, top-up, wallet

**Attenuation**:
Offline derivation of a sub-capability from a parent capability by tightening caveats (amount cap, audience, delegation depth). Requires no network round-trip.
_Avoid_: delegation (for named principals), re-signing, stamping

**Step-up**:
A human approving one bounded, single-use capability for a spend that exceeds an agent's bounds. In the demo this is a browser-side WASM mint on "Approve".
_Avoid_: OTP, second factor, re-auth

**UPI Lite capability**:
A pre-minted auto-approve capability bounded by a per-transaction cap and a global budget, letting an agent spend autonomously within those mathematical bounds.
_Avoid_: auto-pay token, standing instruction

**Slippage caveat**:
A variance allowance on a spend target (e.g. `amt <= target * 1.05`), letting the agent absorb small price movements the human pre-accepted.
_Avoid_: surge tolerance, variance policy

### Enforcement

**Edge verifier**:
The Worker-side code that validates a presented capability's signature and evaluates its caveats before a money action may proceed.
_Avoid_: gateway, middleware, authorize (verb), capability checker

**Intent**:
The hashed cart-spend contract (amount, currency, merchant, item line) an agent commits to; the edge hashes the incoming payment request and hard-fails on mismatch.
_Avoid_: payload hash, checksum, request digest

**Explainable rejection**:
A logical proof of the failing caveat clause, surfaced as an error, ledger note, and chat message (e.g. `Merchant Category Mismatch: expected travel, got food`).
_Avoid_: 403, access denied, hard fail error

### Accounting

**Ledger**:
The D1 double-entry store that records the lifecycle of every money action and is sync'd to real payment events via webhooks. It is the audit trail.
_Avoid_: database, wallet, balance sheet

**Hold**:
The ledger state reserving budget against an action after the capability is verified but before the payment API is called.
_Avoid_: auth, pending, blocked

**Execute**:
The ledger state after the payment API is called and the payment is created; awaiting capture.
_Avoid_: started, in-flight

**Capture**:
The ledger state on `payment.captured`; budget is spent.
_Avoid_: success, settled, charged

**Void**:
The ledger state on refund; budget is restored to the capability's holder.
_Avoid_: refund state, credit, reversal
