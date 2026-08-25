import { describe, expect, test } from "bun:test";
import { createSingleUseRegistry, generateKeyPair, mintStepUp, verifySpend } from "../src/index";

describe("step-up: the human-approved, single-use envelope", () => {
  test("mintStepUp binds one exact spend and verifies at that amount", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    // the ₹6,000 limited-edition jacket — a fresh envelope, its own caps
    const stepUp = await mintStepUp({ merchantId: "mer_sneakerhead", execAmount: 600_000 }, privateKey);

    const result = await verifySpend(
      stepUp,
      { merchantId: "mer_sneakerhead", spot: 600_000, exec: 600_000 },
      publicKey,
    );

    expect(result).toEqual({ authorized: true });
  });

  test("a tampered step-up spend hard-fails with IntentMismatch (Act 3)", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const stepUp = await mintStepUp({ merchantId: "mer_sneakerhead", execAmount: 600_000 }, privateKey);

    // the merchant intercepts and raises the checkout to ₹7,000
    const result = await verifySpend(
      stepUp,
      { merchantId: "mer_sneakerhead", spot: 600_000, exec: 700_000 },
      publicKey,
    );

    expect(result).toEqual({ authorized: false, reason: "IntentMismatch" });
  });

  test("the single-use registry claims a spent step-up exactly once", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const registry = createSingleUseRegistry();
    const stepUp = await mintStepUp({ merchantId: "mer_sneakerhead", execAmount: 600_000 }, privateKey);

    expect(registry.claim(stepUp, publicKey)).toBe(true); // first presentation: spend allowed
    expect(registry.claim(stepUp, publicKey)).toBe(false); // replay: dead on arrival
  });
});