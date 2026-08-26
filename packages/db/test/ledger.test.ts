import { describe, expect, test, beforeAll } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import path from "node:path";

import * as schema from "../src/schema";
import {
  hold,
  executeHold,
  capture,
  voidHold,
  refund,
  readEnvelope,
  listLedger,
  type HoldInput,
} from "../src/ledger";

let mf: Miniflare;
let db: DrizzleD1Database<typeof schema>;

const MERCHANT = "mer_sneakerhead";
let seq = 0;

async function seedEnvelope(
  over: Partial<typeof schema.envelopes.$inferInsert> = {},
  budgetPaise = 100_000,
): Promise<string> {
  const rootId = `root_test_${seq++}`;
  await db.insert(schema.envelopes).values({
    rootId,
    merchantId: MERCHANT,
    perTxCap: 50_000,
    maxHops: 2,
    maxDeltaPct: 5,
    budgetPaise,
    spentPaise: 0,
    createdAt: Date.now(),
    ...over,
  });
  return rootId;
}

function holdInput(rootId: string, digest: string, over: Partial<HoldInput> = {}): HoldInput {
  return {
    rootId,
    merchantId: MERCHANT,
    intentDigest: digest,
    spotPaise: 30_000,
    execPaise: 30_000,
    ...over,
  };
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() {} }",
      d1Databases: { LEDGER_TEST: "ledger-test" },
    }),
  );
  const d1 = await mf.getD1Database("LEDGER_TEST");
  db = drizzle(d1, { schema });
  await migrate(db, { migrationsFolder: path.join(import.meta.dir, "../src/migrations") });
});

async function spent(rootId: string): Promise<number> {
  const env = await db.select().from(schema.envelopes).where(sql`root_id = ${rootId}`).get();
  return env?.spentPaise ?? -1;
}

async function heldHoldId(rootId: string, digest: string, over: Partial<HoldInput> = {}): Promise<string> {
  const result = await hold(db, holdInput(rootId, digest, over));
  expect(result.outcome).toBe("held");
  return (result as { outcome: "held"; holdId: string }).holdId;
}

describe("hold — the atomic budget gate", () => {
  test("a hold reserves budget and writes a balanced double-entry pair", async () => {
    const rootId = await seedEnvelope();
    const result = await hold(db, holdInput(rootId, "digest-a"));

    expect(result.outcome).toBe("held");
    expect(await spent(rootId)).toBe(30_000);

    const rows = await db.select().from(schema.journal).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.account}:${r.direction}:${r.amountPaise}`).sort()).toEqual([
      "envelope:debit:30000",
      "escrow:credit:30000",
    ]);
  });

  test("an over-budget hold is rejected and writes nothing", async () => {
    const rootId = await seedEnvelope({}, 20_000);
    const result = await hold(db, holdInput(rootId, "digest-big"));

    expect(result.outcome).toBe("budget-exhausted");
    expect(await spent(rootId)).toBe(0);
    const holdRows = await db.select().from(schema.holds).where(sql`root_id = ${rootId}`).all();
    expect(holdRows).toHaveLength(0);
    const journalRows = await db.select().from(schema.journal).where(sql`hold_id IN (SELECT id FROM holds WHERE root_id = ${rootId})`).all();
    expect(journalRows).toHaveLength(0);
  });

  test("an unknown envelope is rejected before any write", async () => {
    const result = await hold(db, holdInput("root_ghost", "digest-x"));
    expect(result.outcome).toBe("unknown-envelope");
  });

  test("a replay of the same intent returns the existing hold and never reserves twice", async () => {
    const rootId = await seedEnvelope();
    const first = await hold(db, holdInput(rootId, "digest-a"));
    const replay = await hold(db, holdInput(rootId, "digest-a"));

    expect(first.outcome).toBe("held");
    expect(replay.outcome).toBe("replayed");
    expect(await spent(rootId)).toBe(30_000);
    const rows = await db.select().from(schema.holds).where(sql`root_id = ${rootId}`).all();
    expect(rows).toHaveLength(1);
  });

  test("concurrent identical holds: exactly one wins, spent is incremented once", async () => {
    const rootId = await seedEnvelope();
    const [a, b] = await Promise.all([
      hold(db, holdInput(rootId, "digest-race")),
      hold(db, holdInput(rootId, "digest-race")),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["held", "replayed"]);
    expect(await spent(rootId)).toBe(30_000);
  });

  test("a step-up (single-use) hold claims its capability once and skips the envelope budget", async () => {
    const rootId = await seedEnvelope({}, 20_000);
    const input: HoldInput = {
      ...holdInput(rootId, "digest-stepup", { spotPaise: 600_000, execPaise: 600_000 }),
      stepUp: true,
      stepUpChainId: "chain-stepup-1",
    };

    const first = await hold(db, input);
    const replay = await hold(db, { ...input, stepUpChainId: "chain-stepup-1" });

    expect(first.outcome).toBe("held");
    expect(replay.outcome).toBe("step-up-replayed");
    expect(await spent(rootId)).toBe(0);
    expect(await db.select().from(schema.singleUseClaims).all()).toHaveLength(1);
  });

  test("a claimed step-up can never reserve a second hold, even under a divergent intent", async () => {
    const rootId = await seedEnvelope({}, 20_000);
    const first = await hold(db, {
      ...holdInput(rootId, "digest-div-a", { spotPaise: 600_000, execPaise: 600_000 }),
      stepUp: true,
      stepUpChainId: "chain-div-1",
    });
    // Tampered middleware: same capability, different committed amount.
    const divergent = await hold(db, {
      ...holdInput(rootId, "digest-div-b", { spotPaise: 400_000, execPaise: 400_000 }),
      stepUp: true,
      stepUpChainId: "chain-div-1",
    });

    expect(first.outcome).toBe("held");
    expect(divergent.outcome).toBe("step-up-replayed");
    const holdRows = await db.select().from(schema.holds).where(sql`root_id = ${rootId}`).all();
    expect(holdRows).toHaveLength(1);
    const claims = await db.select().from(schema.singleUseClaims).where(sql`capability_chain_id = 'chain-div-1'`).all();
    expect(claims).toHaveLength(1);
  });
});

describe("the lifecycle: execute -> capture -> void/refund", () => {
  test("execute transitions held -> executed and records the order id", async () => {
    const rootId = await seedEnvelope();
    const holdId = await heldHoldId(rootId, "digest-exec");

    const exec = await executeHold(db, holdId, "order_exec_1");
    expect(exec.outcome).toBe("executed");
    expect(exec.outcome === "executed" && exec.orderId).toBe("order_exec_1");

    const again = await executeHold(db, holdId, "order_exec_1");
    expect(again.outcome).toBe("executed");
  });

  test("capture settles escrow -> merchant and is exactly-once per webhook event", async () => {
    const rootId = await seedEnvelope();
    const holdId = await heldHoldId(rootId, "digest-cap");
    await executeHold(db, holdId, "order_cap_1");

    const cap = await capture(db, {
      holdId,
      eventId: "evt_cap_1",
      paymentId: "pay_cap_1",
      eventType: "payment.captured",
      entityId: "pay_cap_1",
    });
    expect(cap.outcome).toBe("captured");
    expect(await spent(rootId)).toBe(30_000);

    const dup = await capture(db, {
      holdId,
      eventId: "evt_cap_1",
      paymentId: "pay_cap_1",
      eventType: "payment.captured",
      entityId: "pay_cap_1",
    });
    expect(dup.outcome).toBe("duplicate");

    const settle = await db.select().from(schema.journal).where(sql`kind = 'capture'`).all();
    expect(settle).toHaveLength(2);
    expect(await db.select().from(schema.webhookEvents).all()).toHaveLength(1);
    const event = await db.select().from(schema.webhookEvents).where(sql`event_id = 'evt_cap_1'`).get();
    expect(event?.entityId).toBe("pay_cap_1");
  });

  test("void on payment failure releases escrow and restores the budget", async () => {
    const rootId = await seedEnvelope();
    const holdId = await heldHoldId(rootId, "digest-fail");
    await executeHold(db, holdId, "order_fail_1");

    const result = await voidHold(db, { holdId, eventId: "evt_fail_1", eventType: "payment.failed", entityId: "pay_fail_1" });
    expect(result.outcome).toBe("voided");
    expect(await spent(rootId)).toBe(0);

    const release = await db.select().from(schema.journal).where(sql`kind = 'release'`).all();
    expect(release).toHaveLength(2);
  });

  test("refund on a captured payment restores the agent budget (refund.processed)", async () => {
    const rootId = await seedEnvelope();
    const holdId = await heldHoldId(rootId, "digest-refund");
    await executeHold(db, holdId, "order_refund_1");
    await capture(db, {
      holdId,
      eventId: "evt_refund_cap",
      paymentId: "pay_refund_1",
      eventType: "payment.captured",
      entityId: "pay_refund_1",
    });

    const result = await refund(db, { holdId, eventId: "evt_refund_1", eventType: "refund.processed", entityId: "rfd_refund_1" });
    expect(result.outcome).toBe("voided");
    expect(await spent(rootId)).toBe(0);

    const entries = await db.select().from(schema.journal).where(sql`kind = 'refund'`).all();
    expect(entries).toHaveLength(2);
  });

  test("a transition on a terminal hold is a no-op, not a rollback of history", async () => {
    const rootId = await seedEnvelope();
    const holdId = await heldHoldId(rootId, "digest-terminal");
    await executeHold(db, holdId, "order_term_1");
    await capture(db, {
      holdId,
      eventId: "evt_term_cap",
      paymentId: "pay_term_1",
      eventType: "payment.captured",
      entityId: "pay_term_1",
    });

    const lateVoid = await voidHold(db, { holdId, eventId: "evt_term_late", eventType: "payment.failed", entityId: "pay_term_late" });
    expect(lateVoid.outcome).toBe("terminal");

    const lateCapture = await capture(db, {
      holdId,
      eventId: "evt_term_late2",
      paymentId: "pay_term_2",
      eventType: "payment.captured",
      entityId: "pay_term_2",
    });
    expect(lateCapture.outcome).toBe("terminal");
    expect(await spent(rootId)).toBe(30_000);
  });

  test("transitions on a missing hold report not-found", async () => {
    const result = await capture(db, {
      holdId: "hold_ghost",
      eventId: "evt_ghost",
      paymentId: "pay_ghost",
      eventType: "payment.captured",
      entityId: "pay_ghost",
    });
    expect(result.outcome).toBe("not-found");
  });
});

describe("reads", () => {
  test("readEnvelope exposes spent and remaining", async () => {
    const rootId = await seedEnvelope();
    const holdId = await heldHoldId(rootId, "digest-read");

    const env = await readEnvelope(db, rootId);
    expect(env).toMatchObject({ budgetPaise: 100_000, spentPaise: 30_000, remainingPaise: 70_000 });

    const ledger = await listLedger(db, rootId);
    expect(ledger.holds.some((h) => h.id === holdId)).toBe(true);
  });
});