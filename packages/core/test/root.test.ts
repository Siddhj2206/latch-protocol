import { describe, expect, test } from "bun:test";
import { generateKeyPair, mintRoot, verifySpend } from "../src/index";

const CAPS = {
  perTxCap: 50_000,
  merchantId: "mer_sneakerhead",
  maxHops: 2,
  maxDeltaPct: 5,
} as const;

describe("root capability issuance", () => {
  test("a root token minted with envelope caps verifies a matching presentation", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 },
      publicKey,
    );

    expect(result).toEqual({ authorized: true });
  });
});
