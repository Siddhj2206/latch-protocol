import { describe, expect, test, beforeAll } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { eq } from "drizzle-orm";

import {
  generateKeyPair,
  mintRoot,
  mintStepUp,
  attenuate,
} from "@latch-protocol/core";
import * as schema from "@latch-protocol/db/schema";
import { envelopes } from "@latch-protocol/db/schema";
import type { LedgerDB } from "@latch-protocol/db/ledger";

import { createApp } from "../src/app";
import { hmacSha256Hex } from "../src/webhook";
import path from "node:path";

const SECRET = "test-webhook-secret";
const CORS = "http://localhost:3001";
const CAPS = { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 } as const;

let d1Client: D1Database;
let db: LedgerDB;

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/**
 * A swarm: fresh root keypair + a pinned app, so every test lives in its own
 * envelope and can never replay onto another test's state.
 */
function swarm(budgetPaise = 100_000) {
  const keys = generateKeyPair();
  const rootToken = mintRoot(CAPS, keys.privateKey);
  const app = () =>
    createApp({
      corsOrigin: CORS,
      rootPublicKey: keys.publicKey.toString(),
      webhookSecret: SECRET,
      db: d1Client,
    });
  return { keys, rootToken, app, budgetPaise };
}

/** Register the swarm's envelope (budget defaults to the swarm's own). */
async function register(sw: ReturnType<typeof swarm>): Promise<string> {
  const res = await sw.app().request("/v1/envelopes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootToken: sw.rootToken, budgetPaise: sw.budgetPaise }),
  });
  expect(res.status).toBe(201);
  return (await readJson<{ rootId: string }>(res)).rootId;
}

async function hold(sw: ReturnType<typeof swarm>, exec = 30_000, over: Record<string, unknown> = {}) {
  return sw.app().request("/v1/holds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: sw.rootToken, merchantId: "mer_sneakerhead", spot: exec, exec, ...over }),
  });
}

async function holdId(sw: ReturnType<typeof swarm>, exec = 30_000): Promise<string> {
  const res = await hold(sw, exec);
  expect(res.status).toBe(201);
  return (await readJson<{ holdId: string }>(res)).holdId;
}

async function execute(sw: ReturnType<typeof swarm>, id: string) {
  const res = await sw.app().request(`/v1/holds/${id}/execute`, { method: "POST" });
  return { status: res.status, body: await readJson<{ orderId?: string }>(res) };
}

async function valve(sw: ReturnType<typeof swarm>, id: string, event: "captured" | "failed" | "refunded") {
  const res = await sw.app().request("/v1/simulate/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ holdId: id, event }),
  });
  return { status: res.status, body: await readJson<{ outcome?: string }>(res) };
}

async function spent(rootId: string): Promise<number> {
  const row = await db.select().from(envelopes).where(eq(envelopes.rootId, rootId)).get();
  return row?.spentPaise ?? -1;
}

/** Sign a razorpay webhook body the way Razorpay would. */
async function signedWebhook(body: unknown, eventId: string) {
  const raw = JSON.stringify(body);
  return { body: raw, signature: await hmacSha256Hex(raw, SECRET), eventId };
}

beforeAll(async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() {} }",
      d1Databases: { LEDGER_HTTP_TEST: "ledger-http-test" },
    }),
  );
  d1Client = await mf.getD1Database("LEDGER_HTTP_TEST");
  db = drizzle(d1Client, { schema }) as LedgerDB;
  await migrate(db, { migrationsFolder: path.join(import.meta.dir, "../../../packages/db/src/migrations") });
});

describe("envelope registration (mint + register, root custody)", () => {
  test("a root token registers an envelope; a duplicate is a 409", async () => {
    const sw = swarm();
    await register(sw);

    const dup = await sw.app().request("/v1/envelopes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootToken: sw.rootToken, budgetPaise: 200_000 }),
    });
    expect(dup.status).toBe(409);
  });

  test("an attenuated capability cannot mint an envelope", async () => {
    const sw = swarm();
    const sub = await attenuate(sw.rootToken, { merchantId: "mer_sneakerhead", execAmount: 10_000 }, sw.keys.publicKey);
    const res = await sw.app().request("/v1/envelopes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootToken: sub, budgetPaise: 100_000 }),
    });
    expect(res.status).toBe(400);
  });

  test("garbage tokens are rejected at the pinned root", async () => {
    const sw = swarm();
    const res = await sw.app().request("/v1/envelopes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootToken: "garbage", budgetPaise: 100_000 }),
    });
    expect(res.status).toBe(403);
  });
});

describe("the two-phase flow over HTTP (Act 2)", () => {
  test("hold -> execute -> simulate captured: HOLD flies to CAPTURED", async () => {
    const sw = swarm();
    const rootId = await register(sw);

    const held = await hold(sw);
    expect(held.status).toBe(201);
    const heldBody = await readJson<{ holdId: string; status: string; remainingPaise: number }>(held);
    expect(heldBody.status).toBe("held");
    expect(heldBody.remainingPaise).toBe(70_000);

    const executed = await execute(sw, heldBody.holdId);
    expect(executed.status).toBe(200);
    expect(executed.body.orderId).toBe(`order_fake_${heldBody.holdId}`);

    const captured = await valve(sw, heldBody.holdId, "captured");
    expect(captured.body.outcome).toBe("captured");
    expect(await spent(rootId)).toBe(30_000);

    const ledger = await sw.app().request(`/v1/ledger?rootId=${rootId}`);
    const ledgerBody = await readJson<{ holds: { id: string; status: string; orderId: string | null; paymentId: string | null }[] }>(ledger);
    const row = ledgerBody.holds[0]!;
    expect(row.status).toBe("captured");
    expect(row.orderId).toBe(`order_fake_${heldBody.holdId}`);
    expect(row.paymentId).toBe(`pay_valve_${heldBody.holdId}`);
  });

  test("a refund on a captured hold restores the agent budget (budget beat)", async () => {
    const sw = swarm();
    const rootId = await register(sw);
    const id = await holdId(sw);
    await execute(sw, id);
    await valve(sw, id, "captured");
    expect(await spent(rootId)).toBe(30_000);

    const refunded = await valve(sw, id, "refunded");
    expect(refunded.body.outcome).toBe("voided");
    expect(await spent(rootId)).toBe(0);

    const envelope = await sw.app().request(`/v1/envelopes/${rootId}`);
    const envelopeBody = await readJson<{ remainingPaise: number }>(envelope);
    expect(envelopeBody.remainingPaise).toBe(100_000);
  });

  test("a payment failure voids the hold and releases the reservation", async () => {
    const sw = swarm();
    const rootId = await register(sw);
    const id = await holdId(sw);
    await execute(sw, id);

    const failed = await valve(sw, id, "failed");
    expect(failed.body.outcome).toBe("voided");
    expect(await spent(rootId)).toBe(0);
  });

  test("the valve is idempotent: repeat invocation is a duplicate no-op", async () => {
    const sw = swarm();
    await register(sw);
    const id = await holdId(sw);
    await execute(sw, id);

    const first = await valve(sw, id, "captured");
    const second = await valve(sw, id, "captured");
    expect(first.body.outcome).toBe("captured");
    expect(second.body.outcome).toBe("duplicate");
  });
});

describe("hold-write semantics at the edge", () => {
  test("an over-budget hold is a 402 with the remaining", async () => {
    const sw = swarm(20_000);
    await register(sw);
    const res = await hold(sw, 30_000);
    expect(res.status).toBe(402);
    const body = await readJson<{ error: string; remainingPaise: number }>(res);
    expect(body.error).toBe("budget-exhausted");
    expect(body.remainingPaise).toBe(20_000);
  });

  test("a replay returns the existing hold and never reserves twice", async () => {
    const sw = swarm();
    const rootId = await register(sw);
    const first = await hold(sw);
    expect(first.status).toBe(201);
    const firstBody = await readJson<{ holdId: string }>(first);

    const replay = await hold(sw);
    expect(replay.status).toBe(200);
    const replayBody = await readJson<{ holdId: string; replayed: boolean }>(replay);
    expect(replayBody.holdId).toBe(firstBody.holdId);
    expect(replayBody.replayed).toBe(true);
    expect(await spent(rootId)).toBe(30_000);
  });

  test("a plain root spending exactly at its per-tx cap still hits the budget gate (not a step-up)", async () => {
    const sw = swarm(20_000); // global budget ₹200, per-tx cap ₹500
    await register(sw);
    const res = await hold(sw, 50_000); // spends AT the cap — must NOT dodge the gate
    expect(res.status).toBe(402);
    expect((await readJson<{ error: string }>(res)).error).toBe("budget-exhausted");
  });

  test("a step-up spend is single-use: its own bounded envelope, claimable once", async () => {
    const sw = swarm(20_000); // envelope far too small — step-up ignores it
    await register(sw);
    const stepUpToken = await mintStepUp({ merchantId: "mer_sneakerhead", execAmount: 600_000 }, sw.keys.privateKey);

    const first = await sw.app().request("/v1/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: stepUpToken, merchantId: "mer_sneakerhead", spot: 600_000, exec: 600_000 }),
    });
    expect(first.status).toBe(201);
    const firstBody = await readJson<{ holdId: string; stepUp: boolean }>(first);
    expect(firstBody.stepUp).toBe(true);

    const replay = await sw.app().request("/v1/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: stepUpToken, merchantId: "mer_sneakerhead", spot: 600_000, exec: 600_000 }),
    });
    expect(replay.status).toBe(409);
    const replayBody = await readJson<{ error: string }>(replay);
    expect(replayBody.error).toBe("step-up-replayed");
  });

  test("a tampered spend hard-fails at the hold gate with its reason, writing nothing", async () => {
    const sw = swarm();
    const rootId = await register(sw);
    const res = await sw.app().request("/v1/holds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: sw.rootToken, merchantId: "mer_evil", spot: 30_000, exec: 30_000 }),
    });
    expect(res.status).toBe(403);
    const body = await readJson<{ authorized: boolean; reason: string }>(res);
    expect(body).toEqual({ authorized: false, reason: "AudienceMismatch" });
    expect(await spent(rootId)).toBe(0);
  });

  test("a hold on an unregistered root is a 404 with an explainable nudge", async () => {
    const sw = swarm(); // never registers
    const res = await hold(sw);
    expect(res.status).toBe(404);
    expect((await readJson<{ error: string }>(res)).error).toBe("unknown-envelope");
  });
});

describe("the real webhook listener (HMAC, shapes, exactly-once)", () => {
  test("a signed payment.captured webhook captures the hold by order id", async () => {
    const sw = swarm();
    await register(sw);
    const id = await holdId(sw);
    const orderId = (await execute(sw, id)).body.orderId!;

    const { body, signature, eventId } = await signedWebhook(
      {
        entity: "event",
        event: "payment.captured",
        payload: {
          payment: { entity: { id: "pay_real_1", order_id: orderId } },
        },
      },
      "evt_real_1",
    );
    const res = await sw.app().request("/v1/webhooks/razorpay", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
      body,
    });
    expect(res.status).toBe(200);
    expect((await readJson<{ outcome: string }>(res)).outcome).toBe("captured");

    const event = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.eventId, eventId)).get();
    expect(event?.entityId).toBe("pay_real_1");

    const dup = await sw.app().request("/v1/webhooks/razorpay", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
      body,
    });
    expect((await readJson<{ outcome: string }>(dup)).outcome).toBe("duplicate");
  });

  test("a tampered signature is rejected before any processing", async () => {
    const sw = swarm();
    const rootId = await register(sw);
    const id = await holdId(sw);
    const orderId = (await execute(sw, id)).body.orderId!;

    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_evil", order_id: orderId } } },
    });
    const res = await sw.app().request("/v1/webhooks/razorpay", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef", "x-razorpay-event-id": "evt_evil" },
      body,
    });
    expect(res.status).toBe(401);
    // The hold is untouched — still reserved, not captured.
    expect(await spent(rootId)).toBe(30_000);
    const ledger = await sw.app().request(`/v1/ledger?rootId=${rootId}`);
    const ledgerBody = await readJson<{ holds: { status: string }[] }>(ledger);
    expect(ledgerBody.holds[0]!.status).toBe("executed");
  });

  test("without a configured secret the listener fails closed (503)", async () => {
    const keys = generateKeyPair();
    const res = await createApp({ corsOrigin: CORS, db: d1Client, rootPublicKey: keys.publicKey.toString() }).request(
      "/v1/webhooks/razorpay",
      { method: "POST" },
    );
    expect(res.status).toBe(503);
  });
});