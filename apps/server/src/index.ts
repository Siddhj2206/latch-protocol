import { env } from "@latch-protocol/env/server";
import { createApp } from "./app";

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  rootPublicKey: env.ROOT_PUBLIC_KEY,
});

export default app;