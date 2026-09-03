// For Cloudflare Workers, env is accessed via cloudflare:workers module.
// Types are defined in env.d.ts based on your alchemy.run.ts bindings.
// The side-effect import below keeps env.d.ts (global Env + the
// cloudflare:workers module augmentation) in every consumer's program,
// replacing the old `/// <reference path>` directive.
import "../env";

export { env } from "cloudflare:workers";
