import { describe, expect, test } from "bun:test";
import { attenuate, generateKeyPair, mintRoot, verifySpend } from "../src/index";

const CAPS = { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 } as const;
const GOOD = { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 } as const;

describe("tamper-fail suite: the crypto layer rejects by construction", () => {
  test("a spot above the per-transaction cap is rejected with AmountCapExceeded", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, spot: 51_000, exec: 51_000 },
      publicKey,
    );

    expect(result).toMatchObject({ authorized: false, reason: "AmountCapExceeded" });
  });

  test("a presentation at another merchant is rejected with AudienceMismatch", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: "mer_evil", spot: GOOD.spot, exec: GOOD.exec },
      publicKey,
    );

    expect(result).toMatchObject({ authorized: false, reason: "AudienceMismatch" });
  });

  test("an execution amount beyond the slippage allowance is rejected with SlippageExceeded", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, spot: GOOD.spot, exec: 52_000 }, // allowance: 49000 + 2450
      publicKey,
    );

    expect(result).toMatchObject({ authorized: false, reason: "SlippageExceeded" });
  });

  test("a surge within the slippage allowance is absorbed (the ₹15 rain-fee beat)", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, spot: 49_000, exec: 51_000 }, // 51000 <= 51450
      publicKey,
    );

    expect(result).toEqual({ authorized: true });
  });

  test("a spend delegated too deep is rejected with DelegationDepthExceeded", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    let token = mintRoot(CAPS, privateKey);
    for (let i = 0; i < 3; i++) {
      token = await attenuate(token, { merchantId: GOOD.merchantId, execAmount: 49_000 }, publicKey);
    }

    const result = await verifySpend(token, GOOD, publicKey); // 4 blocks -> hops 3 > max 2

    expect(result).toMatchObject({ authorized: false, reason: "DelegationDepthExceeded" });
  });

  test("a tampered execution on a delegated token is rejected with IntentMismatch", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);
    const delegated = await attenuate(
      root,
      { merchantId: GOOD.merchantId, execAmount: 48_500 }, // the agent committed 48,500
      publicKey,
    );

    // the merchant swaps the amount at execution: 50,000 — inside slip (50925), so
    // only the intent binding can catch it
    const result = await verifySpend(
      delegated,
      { merchantId: GOOD.merchantId, spot: 48_500, exec: 50_000 },
      publicKey,
    );

    expect(result).toMatchObject({ authorized: false, reason: "IntentMismatch" });
  });

  test("a bit-flipped token is rejected with SignatureInvalid", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);
    const flipped =
      token.slice(0, 12) + (token[12] === "A" ? "B" : "A") + token.slice(13);

    const result = await verifySpend(flipped, GOOD, publicKey);

    expect(result).toMatchObject({ authorized: false, reason: "SignatureInvalid" });
  });
});