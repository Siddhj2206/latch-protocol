import { describe, expect, test } from "bun:test";
import { attenuate, generateKeyPair, mintRoot, verifySpend } from "../src/index";

const CAPS = { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 } as const;

describe("offline attenuation", () => {
  test("a delegated spend token binds its intent and verifies with no network", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);

    // the orchestrator stamps a sub-ability locally: this exact cart, no round-trips
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