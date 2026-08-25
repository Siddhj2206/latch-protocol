import { authorizer, biscuit, block, generateKeyPair, PublicKey, Biscuit, Rule, SignatureAlgorithm } from "@smithery/biscuit";
import type { Authorizer, PrivateKey } from "@biscuit-auth/biscuit-wasm";

export { generateKeyPair, PublicKey, SignatureAlgorithm };
export type { PrivateKey };

export interface EnvelopeCaps {
  /** Maximum committed (spot) amount, in paise. */
  perTxCap: number;
  /** The only merchant this capability may spend at. */
  merchantId: string;
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
  /** The committed amount (what the agent agreed to), in paise. */
  spot: number;
  /** The amount that will move on the payment request, in paise. */
  exec: number;
}

export type RejectionReason =
  | "AmountCapExceeded"
  | "SlippageExceeded"
  | "AudienceMismatch"
  | "DelegationDepthExceeded"
  | "IntentMismatch"
  | "SignatureInvalid"
  | "AmbiguousRejection";

export type VerifyResult = { authorized: true } | { authorized: false; reason: RejectionReason };

/** Mint an envelope root: the budget authority a whole swarm spends against. */
export function mintRoot(caps: EnvelopeCaps, key: PrivateKey): string {
  const token = biscuit`
    merchant(${caps.merchantId});
    amount_cap(${caps.perTxCap});
    max_hops(${caps.maxHops});
    max_delta(${caps.maxDeltaPct});
    currency("INR");

    check if amount_cap($c), spot($s), $s <= $c;
    check if merchant($m), request_merchant($r), $r == $m;
    check if max_hops($h), hops($n), $n <= $h;
    check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100);
  `.build(key);
  return token.toBase64();
}

const LIMITS = { max_facts: 10_000, max_iterations: 10_000, max_time_micro: 5_000 };
const RETRY_LIMITS = { max_facts: 10_000, max_iterations: 10_000, max_time_micro: 50_000 };

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

export interface SingleUseRegistry {
  /** Claim a step-up token for spending. True only for its first presentation. */
  claim(token: string, rootPublicKey: PublicKey): boolean;
  /** Has this step-up envelope already been spent? */
  peek(token: string, rootPublicKey: PublicKey): boolean;
}

/**
 * In-memory single-use registry, keyed by the token's root revocation id.
 * Demo-grade: the D1-backed registry is the ledger ticket's job — this is the
 * seam it will replace, so the edge's call shape stays identical.
 */
export function createSingleUseRegistry(): SingleUseRegistry {
  const seen = new Set<string>();
  const idOf = (token: string, rootPublicKey: PublicKey): string | null => {
    try {
      const parsed = Biscuit.fromBase64(token, rootPublicKey);
      const rids = parsed.getRevocationIdentifiers();
      if (rids.length === 0) return null;
      const r = rids[0]!;
      return r instanceof Uint8Array ? [...r].map((b) => b.toString(16)).join("") : String(r);
    } catch {
      return null;
    }
  };
  return {
    claim(token, rootPublicKey) {
      const id = idOf(token, rootPublicKey);
      if (id === null || seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    peek(token, rootPublicKey) {
      const id = idOf(token, rootPublicKey);
      return id !== null && seen.has(id);
    },
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
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    return { authorized: false, reason: "SignatureInvalid" };
  }

  const hops = parsed.getRevocationIdentifiers().length - 1;
  const digest = await intentDigest({ merchantId: facts.merchantId, execAmount: facts.exec });

  const auth = authorizer`
    request_merchant(${facts.merchantId});
    spot(${facts.spot});
    exec(${facts.exec});
    hops(${hops});
    request_digest(${digest});
    allow if true;
  `.buildAuthenticated(parsed);

  try {
    auth.authorizeWithLimits(LIMITS);
    return { authorized: true };
  } catch (e) {
    if (isRunLimitTimeout(e)) {
      try {
        auth.authorizeWithLimits(RETRY_LIMITS);
        return { authorized: true };
      } catch (e2) {
        if (isRunLimitTimeout(e2)) return { authorized: false, reason: "AmbiguousRejection" };
        return { authorized: false, reason: attributeRejection(auth, facts, hops) };
      }
    }
    return { authorized: false, reason: attributeRejection(auth, facts, hops) };
  }
}

/** Read a single fact of the form `name($var)` from the token via a datalog query. */
function readFact(auth: Authorizer, factName: string, varName: string): string | number | null {
  try {
    const facts = auth.query(Rule.fromString(`probe(${varName}) <- ${factName}(${varName})`));
    if (facts.length === 0) return null;
    const rendered = facts[0]!.toString(); // e.g. probe(50000) or probe("mer_x")
    const value = rendered.slice(rendered.indexOf("(") + 1, rendered.lastIndexOf(")"));
    if (value.startsWith('"')) return value.slice(1, -1);
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  } catch {
    return null;
  }
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
 * Root-block facts (amount_cap, merchant, max_hops, max_delta) are readable via
 * datalog query; appended-block facts (intent) are not (empirically), so the
 * intent check is the residual: if every root check passes in JS but authorize
 * still failed, the only remaining check is the attenuation's intent binding.
 */
function attributeRejection(auth: Authorizer, facts: SpendFacts, hops: number): RejectionReason {
  const cap = readFactNum(auth, "amount_cap", "$c");
  const merchant = readFactStr(auth, "merchant", "$m");
  const maxHops = readFactNum(auth, "max_hops", "$h");
  const delta = readFactNum(auth, "max_delta", "$d");

  const capViolation = cap !== null && facts.spot > cap;
  const merchantViolation = merchant !== null && facts.merchantId !== merchant;
  const hopsViolation = maxHops !== null && hops > maxHops;
  const slipViolated =
    delta !== null && facts.exec > facts.spot + Math.floor((facts.spot * delta) / 100);

  // Every root check passes in JS, yet authorize() failed: the appended intent
  // binding is the violator (a delegated spend whose exec was tampered with).
  if (!capViolation && !merchantViolation && !hopsViolation && !slipViolated) {
    return "IntentMismatch";
  }
  // Zero-tolerance binding (step-up: cap == spot, delta == 0): any exec drift is
  // an intent violation — the Act 3 "intent hash mismatch" story, not a slip.
  if (delta === 0 && facts.exec !== facts.spot) return "IntentMismatch";
  if (capViolation) return "AmountCapExceeded";
  if (merchantViolation) return "AudienceMismatch";
  if (hopsViolation) return "DelegationDepthExceeded";
  if (slipViolated) return "SlippageExceeded";
  return "AmbiguousRejection";
}