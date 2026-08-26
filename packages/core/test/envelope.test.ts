import { describe, expect, test } from "bun:test";
import { generateKeyPair, mintRoot, attenuate, rootIdOf, readEnvelopeFacts } from "../src/index";

const CAPS = { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 } as const;

describe("envelope identity (root id)", () => {
  test("a root token yields a stable root id", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const id = rootIdOf(token, publicKey);
    expect(id).not.toBeNull();
    expect(rootIdOf(token, publicKey)).toBe(id);
  });

  test("an attenuated sub-capability keeps its root's id", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);
    const sub = await attenuate(
      root,
      { merchantId: "mer_sneakerhead", execAmount: 10_000 },
      publicKey,
    );

    expect(rootIdOf(sub, publicKey)).toBe(rootIdOf(root, publicKey));
  });

  test("two roots minted under different keys get distinct ids", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();

    const idA = rootIdOf(mintRoot(CAPS, a.privateKey), a.publicKey);
    const idB = rootIdOf(mintRoot(CAPS, b.privateKey), b.publicKey);
    expect(idA).not.toBe(idB);
  });

  test("garbage input yields null, not a crash", () => {
    const { publicKey } = generateKeyPair();
    expect(rootIdOf("not-a-token", publicKey)).toBeNull();
  });
});

describe("reading envelope facts off the token", () => {
  test("a root token exposes its own caps (amount cap, audience, depth, delta)", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const facts = await readEnvelopeFacts(token, publicKey);
    expect(facts).toEqual(CAPS);
  });

  test("garbage input yields null, not a crash", async () => {
    const { publicKey } = generateKeyPair();
    expect(await readEnvelopeFacts("not-a-token", publicKey)).toBeNull();
  });
});