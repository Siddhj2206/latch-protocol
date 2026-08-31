import type { PublicKey } from "@biscuit-auth/biscuit-wasm";
import { capabilityChainId } from "./ids";

export interface SingleUseRegistry {
  /** Claim a step-up capability for spending. True only for its first presentation. */
  claim(capability: string, rootPublicKey: PublicKey): boolean;
  /** Has this step-up envelope already been spent? */
  peek(capability: string, rootPublicKey: PublicKey): boolean;
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
      const id = capabilityChainId(capability, rootPublicKey);
      if (id === null || seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    peek(capability, rootPublicKey) {
      const id = capabilityChainId(capability, rootPublicKey);
      return id !== null && seen.has(id);
    },
  };
}
