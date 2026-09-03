# Research: browser WASM mint + OpenRouter-on-workerd verdicts

**Ticket:** #19 (map issue #11) · **Date:** 2026-09-03 · **Method:** live spikes from scratch dirs (bun 1.4.0, node v26.8.1, vite 8.2.2, wrangler 4.128.0 → real workerd). **Zero repo modifications** (`git status --porcelain` empty at end). No API keys exist in this env — none requested, none used (dummy bearer only against a local mock).

**Scratch (all outside repo, kept for re-run):**
- `/tmp/opencode/spikes/biscuit-browser/` — Vite browser spike (`@smithery/biscuit@1.0.1`, `@biscuit-auth/biscuit-wasm@0.6.0`, `vite-plugin-wasm@3.6.0`, vitest)
- `/tmp/opencode/spikes/openrouter-workerd/worker/` — workerd spike (`@openrouter/ai-sdk-provider@3.0.0`, `ai@7.0.91`, hono, mock OpenRouter at `mock.mjs`, `wrangler.toml`)

---

## 1 · Verdicts

### Unknown 1 — Browser WASM mint (apps/web Vite build): CONDITIONAL GO, but NOT via `@smithery/biscuit`

| Path | Build | Runtime | Verdict |
|------|-------|---------|---------|
| A. `import { biscuit, generateKeyPair } from "@smithery/biscuit"` (default export → `dist/index-node.js`) | passes **with warnings** (`node:fs`, `node:module` externalized for browser compat) | **BROKEN** — node builtins are stubbed externals; wasm bytes never bundled (43 KB bundle, no `.wasm` asset) | **NO-GO** |
| B. `from "@smithery/biscuit/shim"` | resolves to `shim-node.js` (Vite client doesn't set the `workerd` condition); **fails**: `"generateKeyPair" is not exported` + node external warnings | n/a | **NO-GO** |
| B2. Same, with `resolve.conditions: ["workerd", …]` forced | **fails**: `"default" is not exported by "…/biscuit_bg.wasm"` (`shim.js` needs workerd's `WebAssembly.Module` default-export semantics) | n/a | **NO-GO** |
| C. `from "@biscuit-auth/biscuit-wasm"` (root entry = wasm-pack bundler glue) + `vite-plugin-wasm`, `build.target: "esnext"` | passes, `.wasm` emitted (2.35 MB) | **BROKEN** — wasm init (`__wbg_set_wasm`/`__wbindgen_start`) silently tree-shaken; 0 occurrences in bundle → `TypeError: Cannot read properties of undefined (reading 'keypair_new')` | **NO-GO as-is** |
| D. Direct `biscuit_bg.js` + `biscuit_bg.wasm` + explicit `__wbg_set_wasm(wasm); wasm.__wbindgen_start()` in app code + `vite-plugin-wasm` | passes, `.wasm` emitted | **WORKS — real keypair + real mint from the built bundle** (`minted EuMBCnkK… ed25519/7af9…`) | **GO** |
| C-dev. Path C under vitest (dev pipeline, no treeshake) | n/a | **WORKS** (1 test passed) | GO (dev/test only) |

**Required config for the GO path (D):**
```ts
// vite.config.ts — apps/web equivalent
import wasm from "vite-plugin-wasm";
export default defineConfig({
  build: { target: "esnext" }, // TLA for the plugin's async wasm init; vite-plugin-top-level-await NOT usable (requires `rollup`, absent in Vite 8/rolldown)
  plugins: [tailwindcss(), tanstackStart(), viteReact(), wasm()],
});
```
```ts
// browser biscuit module (app carries a ~15-line init shim; CANNOT reuse packages/core or @smithery/biscuit as-is)
import * as wasm from "@biscuit-auth/biscuit-wasm/module/biscuit_bg.wasm";
import { __wbg_set_wasm, Biscuit, KeyPair, SignatureAlgorithm } from "@biscuit-auth/biscuit-wasm/module/biscuit_bg.js";
__wbg_set_wasm(wasm);
(wasm as unknown as { __wbindgen_start: () => void }).__wbindgen_start();
// then: new KeyPair(...) / Biscuit.builder() / .build(sk) / .appendBlock(...) / .toBase64()
```
Notes: (a) needs the upstream `exports` subpaths for `./module/biscuit_bg.js` + `./module/biscuit_bg.wasm` — present in the currently-published `0.6.0` tarball (verified in scratch install; the repo's `patch-biscuit-wasm.mjs` already covers this shape); (b) raw `biscuit_bg.js` API is used, so the `biscuit\`\``/`block\`\``/`authorizer\`\`` tagged-template helpers from `@smithery/biscuit` must be re-implemented (small, pure-TS: `addCodeWithParameters` wrapper — copy from `dist/shim.js`, ~30 lines) or mintStepUp logic rewritten against `addCode`.

**Why C fails (root cause):** the wasm-pack `--target bundler` glue (`module/biscuit.js`) runs init as module side effects (`__wbg_set_wasm(wasm); wasm.__wbindgen_start();`), but upstream ships `"sideEffects": "false"` (**string**, not boolean) and rolldown drops the calls from the production bundle. `build.rolldownOptions.treeshake.moduleSideEffects` (function AND `true`) had **no effect** (function never invoked — verified via logging probe); only `treeshake: false` rescues it, which disables tree-shaking globally and is not an acceptable app config. `vite-plugin-wasm`'s transform itself is fine (virtual glue module verified via transform spy).

### Unknown 2 — OpenRouter provider on workerd: GO (unconditional, proven end-to-end)

- **Static:** `@openrouter/ai-sdk-provider@3.0.0` dist contains **zero** `node:` references. `ai@7.0.91` refs (`node:async_hooks`, `node:diagnostics_channel`) load only via `loadBuiltinModule()` behind `isNodeRuntime()` (telemetry path). `@ai-sdk/provider-utils` refs (`node:module`, `node:dns`) load only inside `createSafeNodeFetch()` (Node-undici SSRF-guard path). All guarded → edge-safe by construction.
- **Bundle:** `wrangler dev --local` on a Hono worker importing `createOpenRouter` + `generateText`/`streamText` — **clean, zero warnings**.
- **Runtime (real workerd, mock OpenRouter on 127.0.0.1:8899):**
  - `GET /health` → `{"ok":true,"streamTextType":"function","generateTextType":"function","modelId":"openai/gpt-4o-mini"}` (import + init)
  - `GET /chat` → `{"ok":true,"text":"hello from mock","finishReason":"stop"}` (`generateText` full round-trip, `Authorization: Bearer` observed at mock)
  - `GET /stream` → `{"ok":true,"text":"hello from mock"}` (`streamText` SSE round-trip, consumed edge-side)
- No live LLM call (no key in env; never asked). The mock speaks OpenAI-compatible `/chat/completions` (JSON + SSE `[DONE]`), which is all the provider needs.

**Required config:** none beyond the dependency install. `createOpenRouter({ apiKey })` works; `baseURL` override works (used for the mock; production uses default `https://openrouter.ai/api/v1`). No wrangler compat flags, no `nodejs_compat` needed for these imports.

---

## 2 · Minimal repro steps

### Browser mint (GO path D)
```bash
mkdir /tmp/bb && cd /tmp/bb && bun init -y >/dev/null
bun add @biscuit-auth/biscuit-wasm@0.6.0 && bun add -d vite vite-plugin-wasm
# index.html -> /src/main.ts ; src/main.ts = path-D snippet above (KeyPair + Biscuit.builder + addCode + build)
# vite.config.ts = plugins: [wasm()], build.target: "esnext"
./node_modules/.bin/vite build   # expect: .wasm asset emitted, no warnings
# serve dist/ over http; import the built chunk in a browser (or node + document/fetch shims) -> expect "minted <base64> ed25519/<hex>"
```

### OpenRouter on workerd
```bash
mkdir /tmp/orw && cd /tmp/orw && bun init -y >/dev/null
bun add @openrouter/ai-sdk-provider@3.0.0 ai@7.0.91 hono
# worker.ts: Hono app, createOpenRouter({apiKey:"dummy", baseURL:"http://127.0.0.1:8899"}) + generateText
# mock.mjs: node:http server answering POST /chat/completions with OpenAI-compatible JSON (see scratch worker/mock.mjs)
node mock.mjs & bunx wrangler dev --local --port 8901
curl localhost:8901/chat   # expect {"ok":true,"text":"hello from mock","finishReason":"stop"}
```

---

## 3 · Fallbacks if no-go

- **If path D is deemed too raw** (hand-rolled init + re-implemented datalog helpers): the only in-repo alternative is **server-side step-up mint** (Approve calls a workerd endpoint that runs `mintStepUp` with a server-held key). This contradicts CONTEXT.md ("browser-side WASM mint on Approve") and changes the custody story — product decision, not recommended without map sign-off. A middle option is vendoring a tiny `packages/browser-biscuit` wrapper around path D so apps/web never touches glue directly.
- **Wasm payload cost is real:** 2.35 MB (867 KB gzip) added to the web bundle, fetched async at Approve time. Preload/prefetch on chat focus mitigates; document if the film's network is throttled.
- **If OpenRouter had failed:** fallback was `fetch` directly to OpenRouter's OpenAI-compatible HTTPS endpoint (no SDK). Not needed — provider is GO.

## 4 · Raw evidence (trimmed)

```
# A: default @smithery/biscuit import — builds with warnings, runtime-broken
$ vite build
[plugin rolldown:vite-resolve] Module "node:fs" has been externalized for browser compatibility,
  imported by ".../node_modules/@smithery/biscuit/dist/shim-node.js".
[plugin rolldown:vite-resolve] Module "node:module" has been externalized ...
dist/assets/index-w2fLGGOs.js  43.39 kB   # no .wasm asset; bundle inlines readFileSync/createRequire

# B: /shim subpath — wrong condition, wrong exports
[MISSING_EXPORT] "generateKeyPair" is not exported by "node_modules/@smithery/biscuit/dist/shim-node.js"

# B2: forced workerd condition — workerd-only .wasm semantics
[MISSING_EXPORT] "default" is not exported by
  "node_modules/@biscuit-auth/biscuit-wasm/module/biscuit_bg.wasm".  (shim.js:15)

# C: upstream root + vite-plugin-wasm — silent treeshake breakage
$ vite build
dist/assets/biscuit_bg-DyvGvTw4.wasm  2,353.82 kB
dist/assets/index-BjuV5NJR.js            31.85 kB
$ grep -c "__wbg_set_wasm\|__wbindgen_start" dist/assets/index-*.js
0
$ node run-dist.mjs   # browser-shimmed harness
RUNTIME-FAIL: TypeError: Cannot read properties of undefined (reading 'keypair_new')

# D: manual init — runtime mint proven (bundle served over http, browser-equivalent fetch)
$ node run-dist2.mjs
biscuit-wasm loading
minted EuMBCnkKCG1lcmNoYW50 ed25519/7af99fb58acaad0bb31e7f44c7c87e2ba6d4d61eb057ca4e5166282bfd5a32dd
BUNDLE-OK (no exception)

# C-dev: vitest passes (no treeshake in dev pipeline)
 Test Files  1 passed (1) / Tests  1 passed (1)

# OpenRouter static: provider clean; ai + provider-utils guarded
$ grep -o -E "node:[a-z_0-9/-]+" node_modules/@openrouter/ai-sdk-provider/dist/index.js | sort | uniq -c
(empty)
$ grep ... node_modules/ai/dist/index.js  ->  node:async_hooks (1), node:diagnostics_channel (2)
  # ...behind: function isNodeRuntime(){ return typeof process !== "undefined" && process.release?.name === "node"; }
  # loadBuiltinModule uses globalThis.process?.getBuiltinModule in try/catch
$ grep ... node_modules/@ai-sdk/provider-utils/dist/index.js  ->  node:dns (1), node:module (1)
  # ...inside createSafeNodeFetch(), only when global fetch is Node's undici

# OpenRouter runtime (wrangler 4.128.0 dev --local, real workerd; mock on 127.0.0.1:8899)
$ curl localhost:8901/health
{"ok":true,"streamTextType":"function","generateTextType":"function","modelId":"openai/gpt-4o-mini"}
$ curl localhost:8901/chat
{"ok":true,"text":"hello from mock","finishReason":"stop"}
$ curl localhost:8901/stream
{"ok":true,"text":"hello from mock"}
[mock] POST /chat/completions auth=Bearer dummy-no-real-key   # x2 (chat + stream)
# wrangler.log: no warnings/errors; "Ready on http://localhost:8901"
```

## 5 · Open questions

1. **Upstream fix for path C?** `eclipse-biscuit/biscuit-wasm#61` (sync + workerd entrypoints) would obsolete all shims; open/unmerged at last check (see `docs/research/biscuit-wasm-workerd.md` §1.7). If merged, re-evaluate path C.
2. **TanStack Start SSR interplay:** path D runs client-side on Approve; confirm no SSR import of the wasm module (server functions run under node — use `packages/core` there). Lazy `import()` inside the Approve handler keeps it out of SSR/prerender graphs.
3. **Attenuate in browser** (`Biscuit.fromBase64` + `appendBlock` via raw glue): same init covers it, but not explicitly exercised — 10-minute follow-up when the Approve flow is built.
4. **`"sideEffects": "false"` (string) upstream:** wrangler already warns it must be boolean/array; worth an upstream issue since it silently breaks every Vite production build of path C.
5. **No live OpenRouter call made** (no key present by design): streaming SSE shape verified against mock; first real-key call should be smoke-tested in the chat-loop ticket, watching for provider-version drift (spike pins provider 3.0.0 / ai 7.0.91; repo does not yet depend on either).
