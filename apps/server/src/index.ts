import { env } from "@latch-protocol/env/server";
import { createApp } from "./app";
import { createFakeRazorpayApi, createRazorpayApi } from "./razorpay";

const hasRazorpayKeys = env.RAZORPAY_KEY_ID !== "" && env.RAZORPAY_KEY_SECRET !== "";

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  rootPublicKey: env.ROOT_PUBLIC_KEY,
  db: env.DB,
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  razorpay: hasRazorpayKeys
    ? createRazorpayApi({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET })
    : createFakeRazorpayApi(),
});

export default app;