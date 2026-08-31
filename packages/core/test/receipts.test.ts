import { describe, expect, test } from "bun:test";
import { Biscuit, block } from "@smithery/biscuit";
import { attenuate, generateKeyPair, mintRoot, mintStepUp, verifySpend } from "../src/index";

const CAPS = {
  perTxCap: 50_000,
  merchantId: "mer_sneakerhead",
  maxHops: 2,
  maxDeltaPct: 5,
} as const;
const GOOD = { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 } as const;

/**
 * The receipt is the story a rejection tells: the failing Datalog clause
 * verbatim, expected vs got, one human line. Issue #5 ("explainable
 * rejections — the fail-gracefully beat").
 */
describe("rejection receipts: every denial carries the clause that failed", () => {
  test("an over-cap spend receipts the amount_cap clause, expected vs got in INR", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, spot: 51_000, exec: 51_000 },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt).toEqual({
      code: "AmountCapExceeded",
      message:
        "Per-Transaction Cap Exceeded. Expected: at most ₹500.00, Got: ₹510.00 (committed spot)",
      clause: "check if amount_cap($c), spot($s), $s <= $c",
      expected: "at most ₹500.00",
      got: "₹510.00 (committed spot)",
    });
  });

  test("an audience mismatch receipts the merchant binding, named both sides", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: "mer_evil", spot: GOOD.spot, exec: GOOD.exec },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt).toEqual({
      code: "AudienceMismatch",
      message: "Merchant Mismatch. Expected: mer_sneakerhead, Got: mer_evil",
      clause: "check if merchant($m), request_merchant($r), $r == $m",
      expected: "mer_sneakerhead",
      got: "mer_evil",
    });
  });

  test("a category-bound capability presented under the wrong category speaks the canonical story", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot({ ...CAPS, merchantCategory: "travel" }, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: "mer_evil", merchantCategory: "food", spot: GOOD.spot, exec: GOOD.exec },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    // The CONTEXT.md / IDEA.md canonical line: "Merchant Category Mismatch.
    // Expected: travel, Got: food" — clause quoted verbatim, both sides named.
    expect(result.receipt).toEqual({
      code: "AudienceMismatch",
      message: "Merchant Category Mismatch. Expected: travel, Got: food",
      clause: "check if merchant_category($c), request_category($r), $r == $c",
      expected: "travel",
      got: "food",
    });
  });

  test("an ID-level mismatch inside a matching category still names the merchant binding", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot({ ...CAPS, merchantCategory: "travel" }, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: "mer_evil", merchantCategory: "travel", spot: GOOD.spot, exec: GOOD.exec },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt.code).toBe("AudienceMismatch");
    expect(result.receipt.clause).toBe("check if merchant($m), request_merchant($r), $r == $m");
    expect(result.receipt.message).toBe(
      "Merchant Mismatch. Expected: mer_sneakerhead, Got: mer_evil",
    );
  });

  test("a category-bound token presented without any category receipts the missing side", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot({ ...CAPS, merchantCategory: "travel" }, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, spot: GOOD.spot, exec: GOOD.exec },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt.code).toBe("AudienceMismatch");
    expect(result.receipt.message).toBe(
      "Merchant Category Mismatch. Expected: travel, Got: (none offered)",
    );
  });

  test("a slippage breach receipts the max_delta clause with the allowance math", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, spot: 49_000, exec: 52_000 },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt).toEqual({
      code: "SlippageExceeded",
      message:
        "Slippage Exceeded. Expected: at most ₹514.50 (₹490.00 spot + 5% allowance), Got: ₹520.00",
      clause: "check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100)",
      expected: "at most ₹514.50 (₹490.00 spot + 5% allowance)",
      got: "₹520.00",
    });
  });

  test("an over-deep chain receipts the max_hops clause with both depths", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    let token = mintRoot(CAPS, privateKey);
    for (let i = 0; i < 3; i++) {
      token = await attenuate(
        token,
        { merchantId: GOOD.merchantId, execAmount: 49_000 },
        publicKey,
      );
    }

    const result = await verifySpend(token, GOOD, publicKey);

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt).toEqual({
      code: "DelegationDepthExceeded",
      message: "Delegation Depth Exceeded. Expected: at most 2 delegation hops, Got: 3",
      clause: "check if max_hops($h), hops($n), $n <= $h",
      expected: "at most 2 delegation hops",
      got: "3",
    });
  });

  test("a tampered delegated exec receipts the intent clause with both digests", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);
    const delegated = await attenuate(
      root,
      { merchantId: GOOD.merchantId, execAmount: 48_500 },
      publicKey,
    );

    const result = await verifySpend(
      delegated,
      { merchantId: GOOD.merchantId, spot: 48_500, exec: 50_000 },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt.code).toBe("IntentMismatch");
    expect(result.receipt.clause).toBe("check if intent($i), request_digest($d), $d == $i");
    expect(result.receipt.expected).toMatch(/^[0-9a-f]{64}$/);
    expect(result.receipt.got).toMatch(/^[0-9a-f]{64}$/);
    expect(result.receipt.expected).not.toBe(result.receipt.got);
    // the human line carries the shortened digests
    expect(result.receipt.message).toBe(
      `Intent Hash Mismatch. Expected: ${result.receipt.expected.slice(0, 12)}… (the committed spend), Got: ${result.receipt.got.slice(0, 12)}… (this request)`,
    );
  });

  test("a zero-tolerance step-up over-charged by the merchant receipts IntentMismatch (Act 3)", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = await mintStepUp(
      { merchantId: "mer_sneakerhead", execAmount: 600_000 },
      privateKey,
    );

    const result = await verifySpend(
      token,
      { merchantId: "mer_sneakerhead", spot: 600_000, exec: 700_000 },
      publicKey,
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt.code).toBe("IntentMismatch");
    expect(result.receipt.clause).toBe("check if intent($i), request_digest($d), $d == $i");
    expect(result.receipt.message).toContain("Intent Hash Mismatch");
  });

  test("a bit-flipped token receipts SignatureInvalid honestly: there is no clause to cite", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);
    const flipped = token.slice(0, 12) + (token[12] === "A" ? "B" : "A") + token.slice(13);

    const result = await verifySpend(flipped, GOOD, publicKey);

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.receipt).toEqual({
      code: "SignatureInvalid",
      message:
        "Signature Invalid. Expected: a capability signed under the pinned root authority, Got: a token whose signature does not verify",
      clause: "ed25519 signature over the capability block chain (the pinned root key)",
      expected: "a capability signed under the pinned root authority",
      got: "a token whose signature does not verify",
    });
  });

  test("an authorized spend receipts nothing", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(CAPS, privateKey);

    const result = await verifySpend(token, GOOD, publicKey);

    expect(result).toEqual({ authorized: true });
  });

  test("a category match inside the bound category authorizes", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot({ ...CAPS, merchantCategory: "travel" }, privateKey);

    const result = await verifySpend(
      token,
      { merchantId: GOOD.merchantId, merchantCategory: "travel", spot: GOOD.spot, exec: GOOD.exec },
      publicKey,
    );

    expect(result).toEqual({ authorized: true });
  });

  test("a failing check the verifier cannot name receipts AmbiguousRejection, never a wrong story", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const root = mintRoot(CAPS, privateKey);
    // An appended check over a fact nothing satisfies: authorize fails, every
    // root check passes in JS, and NO intent block exists to blame — the
    // honest answer is the retriable AmbiguousRejection, not a fabricated
    // IntentMismatch (the ADR-0002 soundness guard).
    const weird = Biscuit.fromBase64(root, publicKey)
      .appendBlock(block`check if never_satisfied($x);`)
      .toBase64();

    const result = await verifySpend(weird, GOOD, publicKey);

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reason).toBe("AmbiguousRejection");
    expect(result.receipt.code).toBe("AmbiguousRejection");
    expect(result.receipt.got).toContain("retriable");
  });
});
