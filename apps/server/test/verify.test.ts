import { describe, expect, test } from "bun:test";
import { generateKeyPair, mintRoot, mintStepUp } from "@latch-protocol/core";
import { createApp } from "../src/app";

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("the latch edge (Hono app seam)", () => {
  test("GET /crypto/smoke: the Biscuit WASM round-trips inside a handler", async () => {
    const app = createApp({ corsOrigin: "http://localhost:3001" });
    const res = await app.request("/crypto/smoke");
    expect(res.status).toBe(200);
    expect(await readJson<{ ok: boolean }>(res)).toEqual({ ok: true });
  });

  test("POST /v1/verify: an envelope-root spend passes end-to-end", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const app = createApp({ corsOrigin: "http://localhost:3001", rootPublicKey: publicKey.toString() });
    const token = mintRoot(
      { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 },
      privateKey,
    );

    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 }),
    });

    expect(res.status).toBe(200);
    expect(await readJson<{ authorized: boolean }>(res)).toEqual({ authorized: true });
  });

  test("POST /v1/verify: a tampered step-up is hard-failed with its reason (Act 3)", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const app = createApp({ corsOrigin: "http://localhost:3001", rootPublicKey: publicKey.toString() });
    const token = await mintStepUp({ merchantId: "mer_sneakerhead", execAmount: 600_000 }, privateKey);

    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, merchantId: "mer_sneakerhead", spot: 600_000, exec: 700_000 }),
    });

    expect(res.status).toBe(403);
    expect(await readJson<{ authorized: boolean; reason: string }>(res)).toEqual({
      authorized: false,
      reason: "IntentMismatch",
    });
  });

  test("POST /v1/verify: no pinned root key -> 503, clearly", async () => {
    const app = createApp({ corsOrigin: "http://localhost:3001" });
    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "x", merchantId: "m", spot: 1, exec: 1 }),
    });
    expect(res.status).toBe(503);
  });

  test("POST /v1/verify: the attack matrix hard-fails at the edge (cap, audience)", async () => {
    const { privateKey, publicKey } = generateKeyPair();
    const app = createApp({ corsOrigin: "http://localhost:3001", rootPublicKey: publicKey.toString() });
    const token = mintRoot(
      { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 },
      privateKey,
    );

    const overCap = await app.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, merchantId: "mer_sneakerhead", spot: 51_000, exec: 51_000 }),
    });
    expect(overCap.status).toBe(403);
    expect(await readJson<{ authorized: boolean; reason: string }>(overCap)).toEqual({ authorized: false, reason: "AmountCapExceeded" });

    const wrongMerchant = await app.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, merchantId: "mer_evil", spot: 49_000, exec: 49_000 }),
    });
    expect(wrongMerchant.status).toBe(403);
    expect(await readJson<{ authorized: boolean; reason: string }>(wrongMerchant)).toEqual({ authorized: false, reason: "AudienceMismatch" });
  });
});