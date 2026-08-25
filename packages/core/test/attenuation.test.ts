import { describe, expect, test } from "bun:test";
import { attenuate, generateKeyPair, mintRoot, verifySpend } from "../src/index";

const CAPS = { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 } as const;
const GOOD = { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 } as const;

describe("pre-minted UPI Lite: one capability, repeated autonomous spends", () => {
  test("a single pre-minted token spends again and again within its bounds", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    for (let i = 0; i < 3; i++) {
      const result = await verifySpend(token, GOOD, publicKey);
      expect(result).toEqual({ authorized: true });
    }
  });

  test("the swarm's many sub-spends all ride the same pre-minted root", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);
    const spends = [47_000, 48_500, 49_250, 48_800];

    for (const amount of spends) {
      const delegated = await attenuate(root, { merchantId: GOOD.merchantId, execAmount: amount }, publicKey);
      const result = await verifySpend(delegated, { merchantId: GOOD.merchantId, spot: amount, exec: amount }, publicKey);
      expect(result).toEqual({ authorized: true });
    }
  });
});

describe("offline attenuation", () => {
  test("a delegated spend token binds its intent and verifies with no network", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);

    // the orchestrator stamps a sub-capability locally: this exact cart, no round-trips
    const delegated = await attenuate(
      root,
      { merchantId: "mer_sneakerhead", execAmount: 48_500 },
      publicKey,
    );

    const result = await verifySpend(
      delegated,
      { merchantId: "mer_sneakerhead", spot: 48_500, exec: 48_500 },
      publicKey,
    );

    expect(result).toEqual({ authorized: true });
  });

  test("the parent token stays valid after attenuation — attenuation only narrows", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);
    await attenuate(root, { merchantId: "mer_sneakerhead", execAmount: 48_500 }, publicKey);

    const parentStillWorks = await verifySpend(
      root,
      { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 },
      publicKey,
    );

    expect(parentStillWorks).toEqual({ authorized: true });
  });
});