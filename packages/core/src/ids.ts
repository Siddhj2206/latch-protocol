import { Biscuit } from "@smithery/biscuit";
import type { PublicKey } from "@biscuit-auth/biscuit-wasm";

function hex(rid: unknown): string | null {
  if (rid instanceof Uint8Array) return bytesToHex(rid);
  if (typeof rid === "string") return rid;
  return null;
}

function revocationIds(capability: string, rootPublicKey: PublicKey): string[] | null {
  try {
    const parsed = Biscuit.fromBase64(capability, rootPublicKey);
    const rids = parsed.getRevocationIdentifiers();
    if (rids.length === 0) return null;
    const out: string[] = [];
    for (const r of rids) {
      const h = hex(r);
      if (h === null) return null;
      out.push(h);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The root block's revocation id — the ledger key of the budget envelope.
 * Every capability minted under the same root shares it, attenuation or not.
 */
export function rootIdOf(capability: string, rootPublicKey: PublicKey): string | null {
  const rids = revocationIds(capability, rootPublicKey);
  return rids === null ? null : rids[0]!;
}

/** Hex of a byte array — the canonical denominator for ids and hashes. */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The full block-chain revocation ids — the identity of ONE specific
 * capability. Two capabilities minted under the same root share the ROOT rid,
 * so keying single-use claims on rids[0] alone would collapse every sibling
 * step-up into one entry.
 */
export function capabilityChainId(capability: string, rootPublicKey: PublicKey): string | null {
  const rids = revocationIds(capability, rootPublicKey);
  return rids === null ? null : rids.join(".");
}