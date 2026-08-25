import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";
import {
  PublicKey,
  SignatureAlgorithm,
  generateKeyPair,
  mintRoot,
  verifySpend,
} from "@latch-protocol/core";

export interface LatchServerOptions {
  corsOrigin: string;
  /** The pinned Latch root public key ("ed25519/<hex>") capabilities are verified against. */
  rootPublicKey?: string;
}

const VerifyBody = z.object({
  token: z.string().min(1),
  merchantId: z.string().min(1),
  spot: z.number().int().nonnegative(),
  exec: z.number().int().nonnegative(),
});

/** The Latch edge: stateless capability verification, no database in this path. */
export function createApp(opts: LatchServerOptions) {
  const app = new Hono();

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: opts.corsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  // Trust anchor: the pinned root authority; everything not signed by it dies at parse.
  // toString() emits "ed25519/<hex>"; fromString wants the raw hex — accept both.
  const rootPublicKey = opts.rootPublicKey
    ? PublicKey.fromString(
        opts.rootPublicKey.replace(/^ed25519\//, ""),
        SignatureAlgorithm.Ed25519,
      )
    : null;

  app.get("/", (c) => c.text("OK"));

  /**
   * Boots the Biscuit WASM inside a request handler (workerd forbids module-scope
   * keygen) and proves the full mint -> verify round-trip runs at the edge.
   */
  app.get("/crypto/smoke", async (c) => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(
      { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 },
      privateKey,
    );
    const result = await verifySpend(
      token,
      { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 },
      publicKey,
    );
    return c.json({ ok: result.authorized });
  });

  /** POST /v1/verify — the stateless edge verifier. 200 when authorized, 403 with the reason. */
  app.post("/v1/verify", async (c) => {
    if (!rootPublicKey) {
      return c.json({ error: "no root public key configured" }, 503);
    }
    const parsed = VerifyBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
    }
    const { token, merchantId, spot, exec } = parsed.data;
    const result = await verifySpend(token, { merchantId, spot, exec }, rootPublicKey);
    if (result.authorized) return c.json({ authorized: true });
    return c.json({ authorized: false, reason: result.reason }, 403);
  });

  return app;
}