import { Biscuit } from "@smithery/biscuit";
import type { PublicKey } from "@biscuit-auth/biscuit-wasm";

export interface SingleUseRegistry {
  /** Claim a step-up capability for spending. True only for its first presentation. */
  claim(capability: string, rootPublicKey: PublicKey): boolean;
  /** Has this step-up envelope already been spent? */
  peek(capability: string, rootPublicKey: PublicKey): boolean;
}

function capabilityId(capability: string, rootPublicKey: PublicKey): string | null {
  try {
    const parsed = Biscuit.fromBase64(capability, rootPublicKey);
    // The whole block chain is the identity: two capabilities minted under the
    // same root share the ROOT revocation id, so keying on rids[0] alone would
    // collapse every sibling step-up into one registry entry.
    const rids = parsed.getRevocationIdentifiers();
    if (rids.length === 0) return null;
    const hex = (r: unknown) =>
      r instanceof Uint8Array ? [...r].map((b) => b.toString(16).padStart(2, "0")).join("") : String(r);
    return rids.map(hex).join(".");
  } catch {
    return null;
  }
}

/**
 * In-memory single-use registry. Demo-grade: the D1-backed registry is the
 * ledger ticket's job — this is the seam it will replace, so the edge's call
 * shape stays identical.
 */
export function createSingleUseRegistry(): SingleUseRegistry {
  const seen = new Set<string>();
  return {
    claim(capability, rootPublicKey) {
      const id = capabilityId(capability, rootPublicKey);
      if (id === null || seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    peek(capability, rootPublicKey) {
      const id = capabilityId(capability, rootPublicKey);
      return id !== null && seen.has(id);
    },
  };
}