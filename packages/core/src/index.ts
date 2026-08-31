import { authorizer, biscuit, block, generateKeyPair, PublicKey, Biscuit, Rule, SignatureAlgorithm } from "@smithery/biscuit";
import type { Authorizer, PrivateKey } from "@biscuit-auth/biscuit-wasm";
import { bytesToHex } from "./ids";
import { describeRejection, type RejectionContext, type RejectionReceipt, type RejectionReason } from "./rejection";

export { generateKeyPair, PublicKey, SignatureAlgorithm };
export type { PrivateKey };
export {
  REJECTION_CLAUSES,
  describeRejection,
  describeGateRejection,
  formatInr,
} from "./rejection";
export type { RejectionReceipt, RejectionReason, RejectionCode, RejectionContext } from "./rejection";

export interface EnvelopeCaps {
  /** Maximum committed (spot) amount, in paise. */
  perTxCap: number;
  /** The only merchant this capability may spend at. */
  merchantId: string;
  /**
   * The merchant category this capability may spend in (e.g. "travel",
   * "fashion"). Optional: without it only the merchant-id binding applies.
   * The canonical explainable-rejection story quotes it — "Merchant Category
   * Mismatch. Expected: travel, Got: food".
   */
  merchantCategory?: string;
  /** Maximum attenuation depth (blocks appended beyond the root). */
  maxHops: number;
  /** Slippage allowance, percent (datalog: exec <= spot + spot * d / 100). */
  maxDeltaPct: number;
}

export interface SpendIntent {
  merchantId: string;
  /** The amount that will move on the payment request, in paise. */
  execAmount: number;
}

export interface SpendFacts {
  merchantId: string;
  /** The category the presentation claims, when the merchant offers one. */
  merchantCategory?: string;
  /** The committed amount (what the agent agreed to), in paise. */
  spot: number;
  /** The amount that will move on the payment request, in paise. */
  exec: number;
}

export type VerifyResult =
  | { authorized: true }
  | { authorized: false; reason: RejectionReason; receipt: RejectionReceipt };

/**
 * The envelope's caveats, written once as a comment: the tagged-template
 * `${...}` interpolation is TERMS-only (never code), so a conditional
 * statement must be spelled as a whole template branch — that's why
 * `mintRoot` has two variants. The merchant-category binding is optional: a
 * capability minted with `caps.merchantCategory` carries the fact + check,
 * ones without it are bound by merchant id alone. Step-up mints pin
 * `intent($i)` and its check on top.
 *
 *   check if amount_cap($c), spot($s), $s <= $c;                          // committed amount ceiling
 *   check if merchant($m), request_merchant($r), $r == $m;                // audience binding (ID level)
 *   check if merchant_category($c), request_category($r), $r == $c;       // audience binding (category, optional)
 *   check if max_hops($h), hops($n), $n <= $h;                            // delegation depth (verifier injects hops)
 *   check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100); // slippage vs spot
 *   check if intent($i), request_digest($d), $d == $i;                    // step-up only: one exact spend
 */

/** Mint an envelope root: the budget authority a whole swarm spends against. */
export function mintRoot(caps: EnvelopeCaps, key: PrivateKey): string {
  const token =
    caps.merchantCategory !== undefined
      ? biscuit`
    merchant(${caps.merchantId});
    amount_cap(${caps.perTxCap});
    max_hops(${caps.maxHops});
    max_delta(${caps.maxDeltaPct});
    currency("INR");
    merchant_category(${caps.merchantCategory});

    check if amount_cap($c), spot($s), $s <= $c;
    check if merchant($m), request_merchant($r), $r == $m;
    check if merchant_category($c), request_category($r), $r == $c;
    check if max_hops($h), hops($n), $n <= $h;
    check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100);
  `
      : biscuit`
    merchant(${caps.merchantId});
    amount_cap(${caps.perTxCap});
    max_hops(${caps.maxHops});
    max_delta(${caps.maxDeltaPct});
    currency("INR");

    check if amount_cap($c), spot($s), $s <= $c;
    check if merchant($m), request_merchant($r), $r == $m;
    check if max_hops($h), hops($n), $n <= $h;
    check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100);
  `;
  return token.build(key).toBase64();
}

const LIMITS = { max_facts: 10_000, max_iterations: 10_000, max_time_micro: 5_000 };
const RETRY_LIMITS = { max_facts: 10_000, max_iterations: 10_000, max_time_micro: 50_000 };
/** Fact probes share the retry budget: a cold-start timeout must not read as "fact absent". */
const PROBE_LIMITS = RETRY_LIMITS;

/** The datalog engine's cold-start budget exhaustion (research §1.6): retriable, not a rejection. */
function isRunLimitTimeout(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const keys = Object.keys(e);
  if (keys.includes("RunLimit")) return true;
  const serialized = JSON.stringify(e) ?? "";
  return serialized.includes("RunLimit") || serialized.toLowerCase().includes("timeout");
}

/**
 * Offline attenuation: a parent capability locally stamps a tightly-bound
 * spent intent onto a sub-capability. No network calls; only narrows.
 * The appended block pins `intent($i)` — the spend the delegate may execute —
 * so a tampered execution can never match the delegated digest.
 */
export async function attenuate(
  token: string,
  intent: SpendIntent,
  rootPublicKey: PublicKey,
): Promise<string> {
  const parsed = Biscuit.fromBase64(token, rootPublicKey);
  const digest = await intentDigest(intent);

  const delegated = parsed.appendBlock(
    block`
      intent(${digest});
      check if intent($i), request_digest($d), $d == $i;
    `,
  );
  return delegated.toBase64();
}

/**
 * Step-up: a fresh, single-use envelope minted on human Approve. Zero slippage,
 * cap == committed amount, intent bound to the one approved spend. It never
 * extends the auto envelope (see map decision: "step-up = fresh envelope").
 */
export async function mintStepUp(spend: SpendIntent, key: PrivateKey): Promise<string> {
  const digest = await intentDigest(spend);
  const token = biscuit`
    merchant(${spend.merchantId});
    amount_cap(${spend.execAmount});
    max_hops(0);
    max_delta(0);
    currency("INR");
    intent(${digest});

    check if amount_cap($c), spot($s), $s <= $c;
    check if merchant($m), request_merchant($r), $r == $m;
    check if max_hops($h), hops($n), $n <= $h;
    check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100);
    check if intent($i), request_digest($d), $d == $i;
  `.build(key);
  return token.toBase64();
}

export { createSingleUseRegistry } from "./single-use";
export type { SingleUseRegistry } from "./single-use";
export { rootIdOf, capabilityChainId, bytesToHex } from "./ids";

/** The envelope bounds carried by a root block, read off the token itself. */
export type EnvelopeFacts = EnvelopeCaps;

/**
 * Read a token's own envelope bounds (amount cap, audience, delegation depth,
 * slippage) via datalog queries. Used at envelope registration so the D1
 * envelope row is derived from the token, never from a client-supplied claim.
 * Returns null for anything that does not parse under the pinned root key.
 */
export async function readEnvelopeFacts(
  capability: string,
  rootPublicKey: PublicKey,
): Promise<EnvelopeFacts | null> {
  let parsed: Biscuit;
  try {
    parsed = Biscuit.fromBase64(capability, rootPublicKey);
  } catch {
    return null;
  }

  const auth = authorizer``.buildAuthenticated(parsed);
  const cap = readFactNum(auth, "amount_cap", "$c");
  const merchant = readFactStr(auth, "merchant", "$m");
  const category = readFactStr(auth, "merchant_category", "$c");
  const maxHops = readFactNum(auth, "max_hops", "$h");
  const delta = readFactNum(auth, "max_delta", "$d");

  if (cap === null || merchant === null || maxHops === null || delta === null) return null;
  return {
    perTxCap: cap,
    merchantId: merchant,
    merchantCategory: category ?? undefined,
    maxHops,
    maxDeltaPct: delta,
  };
}

/** Canonical intent digest: sha256 over {currency, merchantId, amount}. */
export async function intentDigest(intent: SpendIntent): Promise<string> {
  const canonical = JSON.stringify({
    currency: "INR",
    merchantId: intent.merchantId,
    amount: intent.execAmount,
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToHex(new Uint8Array(bytes));
}

/**
 * Verify a presented capability against the pinned root authority.
 * Stateless by design: pure token math, no database reads (see map, "hold-gate" decision).
 */
export async function verifySpend(
  token: string,
  facts: SpendFacts,
  rootPublicKey: PublicKey,
): Promise<VerifyResult> {
  let parsed: Biscuit;
  try {
    parsed = Biscuit.fromBase64(token, rootPublicKey);
  } catch {
    return {
      authorized: false,
      reason: "SignatureInvalid",
      receipt: describeRejection("SignatureInvalid", {
        spot: facts.spot,
        exec: facts.exec,
        presentedMerchantId: facts.merchantId,
        presentedMerchantCategory: facts.merchantCategory,
      }),
    };
  }

  const hops = parsed.getRevocationIdentifiers().length - 1;
  const digest = await intentDigest({ merchantId: facts.merchantId, execAmount: facts.exec });

  const auth = (
    facts.merchantCategory !== undefined
      ? authorizer`
    request_merchant(${facts.merchantId});
    request_category(${facts.merchantCategory});
    spot(${facts.spot});
    exec(${facts.exec});
    hops(${hops});
    request_digest(${digest});
    allow if true;
  `
      : authorizer`
    request_merchant(${facts.merchantId});
    spot(${facts.spot});
    exec(${facts.exec});
    hops(${hops});
    request_digest(${digest});
    allow if true;
  `
).buildAuthenticated(parsed);

  // A cold-start datalog budget exhaustion (research §1.6) is a retriable quirk,
  // not a rejection: try once more with a larger time budget before attributing.
  let timedOut = false;
  for (const limits of [LIMITS, RETRY_LIMITS]) {
    try {
      auth.authorizeWithLimits(limits);
      return { authorized: true };
    } catch (e) {
      timedOut = isRunLimitTimeout(e);
      if (!timedOut) break;
    }
  }
  if (timedOut) {
    return {
      authorized: false,
      reason: "AmbiguousRejection",
      receipt: describeRejection("AmbiguousRejection", {
        spot: facts.spot,
        exec: facts.exec,
        presentedMerchantId: facts.merchantId,
        presentedMerchantCategory: facts.merchantCategory,
      }),
    };
  }
  const attributed = attributeRejection(auth, facts, hops, digest, parsed);
  return { authorized: false, reason: attributed.reason, receipt: describeRejection(attributed.reason, attributed.ctx) };
}

/** Read a single fact of the form `name($var)` from the token via a datalog query. */
function readFact(auth: Authorizer, factName: string, varName: string): string | number | null {
  const rule = Rule.fromString(`probe(${varName}) <- ${factName}(${varName})`);
  try {
    const facts = auth.query(rule);
    if (facts.length === 0) return null;
    return parseProbe(facts[0]!.toString());
  } catch (e) {
    // Cold-start quirk (research §1.6): retry once with a bigger budget before
    // giving up — a timed-out probe must never read as "fact absent".
    if (!isRunLimitTimeout(e)) return null;
  }
  try {
    const facts = auth.queryWithLimits(rule, PROBE_LIMITS);
    if (facts.length === 0) return null;
    return parseProbe(facts[0]!.toString());
  } catch {
    return null;
  }
}

function parseProbe(rendered: string): string | number | null {
  const value = rendered.slice(rendered.indexOf("(") + 1, rendered.lastIndexOf(")"));
  if (value.startsWith('"')) return value.slice(1, -1);
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function readFactNum(auth: Authorizer, factName: string, varName: string): number | null {
  const v = readFact(auth, factName, varName);
  return typeof v === "number" ? v : null;
}

function readFactStr(auth: Authorizer, factName: string, varName: string): string | null {
  const v = readFact(auth, factName, varName);
  return typeof v === "string" ? v : null;
}

/**
 * Attribute which caveat rejected the spend.
 *
 * Root-block facts (amount_cap, merchant, merchant_category, max_hops,
 * max_delta) are readable via datalog query; appended-block facts (intent) are
 * not queryable, but their block SOURCE is readable (`getBlockSource`) once
 * the token has signature-verified — the pinned intent digest is extracted
 * there.
 *
 * Ordering is deliberate and documented: root-level bound violations (money
 * ceiling, audience, depth, slip) outrank the residual intent check — a spend
 * that breaks both a root bound AND its intent binding is reported as the root
 * violation, because that is the harder bound. The zero-tolerance exception:
 * a step-up (cap == spot, delta == 0) reports IntentMismatch for any exec
 * drift — the Act 3 "intent hash mismatch" story.
 */
function attributeRejection(
  auth: Authorizer,
  facts: SpendFacts,
  hops: number,
  requestDigest: string,
  parsed: Biscuit,
): { reason: RejectionReason; ctx: RejectionContext } {
  const cap = readFactNum(auth, "amount_cap", "$c");
  const merchant = readFactStr(auth, "merchant", "$m");
  const category = readFactStr(auth, "merchant_category", "$c");
  const maxHops = readFactNum(auth, "max_hops", "$h");
  const delta = readFactNum(auth, "max_delta", "$d");

  const ctx: RejectionContext = {
    spot: facts.spot,
    exec: facts.exec,
    presentedMerchantId: facts.merchantId,
    presentedMerchantCategory: facts.merchantCategory,
    hops,
    requestDigest,
    bound: {
      ...(cap !== null && { perTxCap: cap }),
      ...(merchant !== null && { merchantId: merchant }),
      ...(category !== null && { merchantCategory: category }),
      ...(maxHops !== null && { maxHops: maxHops }),
      ...(delta !== null && { maxDeltaPct: delta }),
    },
  };

  const capViolation = cap !== null && facts.spot > cap;
  const merchantViolation = merchant !== null && facts.merchantId !== merchant;
  // The canonical audience story outranks the ID one: the category check is
  // the coarser, more explainable boundary, and CONTEXT.md's example quotes it.
  const categoryViolation = category !== null && facts.merchantCategory !== category;
  const hopsViolation = maxHops !== null && hops > maxHops;
  const slipViolated =
    delta !== null && facts.exec > facts.spot + Math.floor((facts.spot * delta) / 100);

  // The pinned digest, read once: both the residual and the zero-tolerance
  // intent branches need it (extraction is per-block-source work).
  const pinned = pinnedIntentDigest(parsed);

  // Every root check passes in JS, yet authorize() failed: the appended intent
  // binding is the violator (a delegated spend whose exec was tampered with).
  // A token without an intent block can never intent-mismatch — if the pinned
  // digest is unreadable, the attribution itself failed (cold-start probe):
  // report the honest "unknown" instead of blaming intent.
  if (!capViolation && !categoryViolation && !merchantViolation && !hopsViolation && !slipViolated) {
    if (pinned === undefined) return { reason: "AmbiguousRejection", ctx };
    return { reason: "IntentMismatch", ctx: { ...ctx, intentDigest: pinned } };
  }
  // Zero-tolerance binding (step-up: cap == spot, delta == 0): any exec drift is
  // an intent violation — the Act 3 "intent hash mismatch" story, not a slip.
  if (delta === 0 && facts.exec !== facts.spot) {
    return { reason: "IntentMismatch", ctx: { ...ctx, intentDigest: pinned } };
  }
  // The category story first (canonical), then the ID-level audience binding.
  if (categoryViolation) return { reason: "AudienceMismatch", ctx };
  if (capViolation) return { reason: "AmountCapExceeded", ctx };
  if (merchantViolation) return { reason: "AudienceMismatch", ctx };
  if (hopsViolation) return { reason: "DelegationDepthExceeded", ctx };
  if (slipViolated) return { reason: "SlippageExceeded", ctx };
  return { reason: "AmbiguousRejection", ctx };
}

/**
 * The digest pinned by the capability's intent block(s), read off the block
 * sources (plaintext CBOR). Safe to trust: the caller only reaches here after
 * `Biscuit.fromBase64(token, rootPublicKey)` verified every signature.
 * Step-ups carry it in the root block; attenuations append it.
 */
function pinnedIntentDigest(parsed: Biscuit): string | undefined {
  for (let i = parsed.countBlocks() - 1; i >= 0; i--) {
    let source: string | undefined;
    try {
      source = parsed.getBlockSource(i);
    } catch {
      continue;
    }
    const match = /intent\("([0-9a-f]{64})"\)/.exec(source ?? "");
    if (match) return match[1]!;
  }
  return undefined;
}