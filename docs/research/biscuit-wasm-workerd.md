# Research: Biscuit WASM inside Cloudflare workerd

**Ticket:** [Siddhj2206/latch-protocol#6](https://github.com/Siddhj2206/latch-protocol/issues/6) (wayfinder:research, part of #2)
**Date:** 2026-08-25 · **Method:** primary sources (npm registry, GitHub repos/issues, official docs, published package files) + live smoke tests from `/tmp/opencode/biscuit-smoke` (bun 1.4.0, node v26.7.0, wrangler 4.125.0 → workerd)
**Repo state at research time:** neither Biscuit package is a dependency yet (`bun.lock`/`package.json` contain no `biscuit`).

---

## 1 · Does `@smithery/biscuit@1.0.1` initialize and verify inside workerd?

**Short answer: yes at request time, with two sharp edges (a required consumer-side patch, and a module-scope rule).** All verified by running it.

### 1.1 Package facts

- npm `@smithery/biscuit@1.0.1`, MIT, 2 published versions, published ≈ 2026-03 ("5 months ago"), 11 weekly downloads, **0 dependents**, 1 dependency (`@biscuit-auth/biscuit-wasm@0.6.0`). ([npm](https://www.npmjs.com/package/@smithery/biscuit))
- Source repo was `github.com/smithery-ai/workers-biscuit`, **now `github.com/clavia-labs/workers-biscuit`** (org rename; npm "repository" field still points at the old URL). 12 commits, 0 stars. ([repo](https://github.com/clavia-labs/workers-biscuit))
- npm collaborator is `calclavia` — the same person who authored upstream PR [eclipse-biscuit/biscuit-wasm#61](https://github.com/eclipse-biscuit/biscuit-wasm/pull/61) ("Add sync and workerd entrypoints for Cloudflare runtimes", **still open/unmerged** as of 2026-08-25).

### 1.2 How it works (from its source)

- Conditional exports ([package.json](https://raw.githubusercontent.com/clavia-labs/workers-biscuit/main/package.json)): `"."` → `workerd` condition → `dist/index.js` (CF shim), `default` → `dist/index-node.js` (Node shim). Also `./shim`. The published tarball ships **only `dist/`** (+ README/LICENSE/package.json) — **the pnpm patch is not shipped to consumers**.
- The [shim](https://raw.githubusercontent.com/clavia-labs/workers-biscuit/main/src/shim.ts) (verified identical in the published `dist/shim.js`):
  1. `import * as bg from "@biscuit-auth/biscuit-wasm/module/biscuit_bg.js"` and `import wasmModule from "@biscuit-auth/biscuit-wasm/module/biscuit_bg.wasm"` — **internal upstream subpaths not present in upstream `exports`**;
  2. collects all `__wbg_*` / `__wbindgen_*` glue exports into an imports map;
  3. supplies 7 hardcoded snippet modules (`./snippets/biscuit-auth-<hash>/inline0.js`, all just `performance.now()` — hash directories are wasm-bindgen-version-dependent, so the map is brittle across upstream rebuilds);
  4. `new WebAssembly.Instance(wasmModule, imports)`, `bg.__wbg_set_wasm(instance.exports)`, runs `__wbindgen_start` via a `runWasmStart` wrapper that temporarily swallows the `"biscuit-wasm loading"` console.log.
- The README explicitly documents the upstream patch: `patches/@biscuit-auth__biscuit-wasm@0.6.0.patch` adds `./module/biscuit_bg.js` and `./module/biscuit_bg.wasm` to the upstream `exports` map — "Modern bundlers (including Wrangler's esbuild) enforce `exports` strictly and refuse to resolve these subpaths. … If you upgrade `@biscuit-auth/biscuit-wasm`, regenerate the patch".

### 1.3 Verified: without the patch, the package cannot load anywhere strict (bun AND wrangler)

- **bun (Node path):** `bun run resolve-test.ts` → `error: Cannot find module '@biscuit-auth/biscuit-wasm/module/biscuit_bg.js' from '.../dist/shim-node.js'` (upstream `exports` = `{ "import": "./module/biscuit.js" }` only — confirmed from the installed package.json). After manually applying the same exports patch to `node_modules`, it loads.
- **wrangler (workerd path):** `wrangler deploy --dry-run` fails: `ERROR Could not resolve "@biscuit-auth/biscuit-wasm/module/biscuit_bg.js" … The path "./module/biscuit_bg.js" is not exported by package "@biscuit-auth/biscuit-wasm"` — from `dist/shim.js:13:20`, i.e. the `workerd` condition did resolve (wrangler uses the `workerd` export condition). Applying the exports patch fixes the build.

### 1.4 Verified: with the patch, the full round-trip runs inside workerd

Same bundle, `wrangler dev --local` (wrangler 4.125.0, running the real workerd binary), Hono-less minimal worker:

```
GET /crypto    -> {"cryptoFallback":"function","filled":true}          (200)
GET /smoke     -> {"ok":true}                                           (200)
```

`/smoke` runs the **complete mint → attenuate → verify** pipeline: `generateKeyPair()` (RNG), `.build(sk)`, `token.appendBlock(...)` (which internally calls `KeyPair::new` again — see §4 for proof), `authorizer…buildAuthenticated(restricted).authorize()`. All four loss-check caveats exercised with the expected pass/fail outcomes (see §3).

### 1.5 Verified sharp edge A: module/global-scope keygen deterministically crashes workerd

A worker whose module top-level does `const { privateKey } = generateKeyPair()` fails to start, reproducibly:

```
panicked at src/crypto.rs:215:41:
  called `Result::unwrap()` on an `Err` value: Error { internal_code: 2147483656,
  description: "Calling Web API crypto.getRandomValues failed" }
… RuntimeError: unreachable … in $keypair_new … in generateKeyPair …
Uncaught RuntimeError: unreachable → "The Workers runtime failed to start"
```

Root cause is a **documented workerd runtime rule, not a shim bug**: `crypto.getRandomValues` (and `randomUUID`) at global scope throws `Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope. To fix this error, perform this operation within a handler.` (error links to <https://developers.cloudflare.com/workers/runtime-apis/handlers/>; same generic failure hits other RNG libs, e.g. [cuid2#112](https://github.com/paralleldrive/cuid2/issues/112), [mastra#11862](https://github.com/mastra-ai/mastra/issues/11862)). Verified directly in workerd: plain `crypto.getRandomValues(new Uint8Array(8))` at module scope throws that exact error; in a handler it succeeds. Since `KeyPair::new` → `make_rng()` → `getrandom::getrandom(..).unwrap()`, the Rust panic surfaces as an `unreachable` wasm trap. **Any `generateKeyPair()`, `new KeyPair()`, `appendBlock()` or `appendThirdPartyBlock()` call must happen inside a handler (request), never at module scope.**

### 1.6 Verified sharp edge B: cold-start `RunLimit: Timeout` on the first datalog run

The datalog engine's default budget is `max_time_micro: 1000` (1 ms; `authorizeWithLimits` overrides, per [NodeJS usage docs](https://doc.biscuitsec.org/usage/nodejs)). Empirically, the **first authorize in a freshly-started isolate** (both workerd and Node v26) intermittently throws `{"RunLimit":"Timeout"}`; the second and subsequent authorizations pass. Observed pattern: `/fixedkey` cold → `RunLimit: Timeout` (reproduced 3× after isolate restarts); after any successful datalog run → 200 OK. Mitigations visible from the API: call `authorizeWithLimits({ max_time_micro })` with a larger budget, or accept a warm-up request.

### 1.7 Reported breakage ecosystem

- [clavia-labs/workers-biscuit#5](https://github.com/clavia-labs/workers-biscuit/issues/5) (open, 2026-03-17, no replies): "fails to work when using vite and @cloudflare/vite-plugin" — `TypeError: __vite_ssr_import_0__.__wbindgen_start is not a function` at `@biscuit-auth/biscuit-wasm/module/biscuit.js:5:6` (same class of failure as §2.2; vite-plugin's SSR module runner evaluates upstream's bundler glue directly).
- Upstream PR [eclipse-biscuit/biscuit-wasm#61](https://github.com/eclipse-biscuit/biscuit-wasm/pull/61) exists precisely to make this class of wrapper unnecessary ("forces downstream consumers to patch the generated loader or maintain wrapper packages"); **open, unmerged, 0 comments, last touched 2026-03-11.** It would add `@biscuit-auth/biscuit-wasm/sync` (`initSync`) and a `workerd` export condition. Today it is not in any npm release.

---

## 2 · Does official `@biscuit-auth/biscuit-wasm@0.6.0` run inside workerd?

**Short answer: no. It bundles, but cannot start under workerd without a shim; it needs `node --experimental-wasm-modules` on Node and fails under bun.** All verified by running it.

### 2.1 Package facts

- npm latest = **0.6.0** (18 versions; 0.6.0-beta.1/2, 0.6.0; `dist-tags.latest = 0.6.0`). Build: `wasm-pack build --target bundler --out-dir module --out-name biscuit` (from its package.json `scripts.build`). `engines.node >= 22.0.0`. `exports = { "import": "./module/biscuit.js" }` only. Also ships `"sideEffects": "false"` **as a string**, which wrangler flags with a warning ("must be a boolean or an array").
- Entry `module/biscuit.js` (verified from the installed tarball) is the wasm-pack bundler glue:
  ```js
  import * as wasm from "./biscuit_bg.wasm";
  export * from "./biscuit_bg.js";
  import { __wbg_set_wasm } from "./biscuit_bg.js";
  __wbg_set_wasm(wasm);
  wasm.__wbindgen_start();
  ```
  It assumes the **bundler** instantiates the wasm and exposes the instance exports as the `import *` namespace. In workerd, `.wasm` imports yield a pre-compiled `WebAssembly.Module` (`{default}`-style) — the namespace has no `__wbindgen_start`.
- Official README: Node requires the `--experimental-wasm-modules` flag; browser needs bundler config (`experiments.asyncWebAssembly` webpack example); Node ≥19 needs `globalThis.crypto = webcrypto` on older Node.

### 2.2 Verified under workerd (wrangler 4.125.0, `dev --local`)

- `wrangler deploy --dry-run` **succeeds**: "Total Upload: 2373.00 KiB / gzip: 844.98 KiB" (the .wasm gets embedded).
- Runtime: worker **fails to start**:
  ```
  Uncaught TypeError: wasm2.__wbindgen_start is not a function
    at index.js:2247:7
  ```
  This is the exact failure reported in clavia-labs/workers-biscuit#5 (vite-plugin variant) and predictably derives from §2.1. There is no workerd equivalent of `--experimental-wasm-modules`; the workerd-native `.wasm` module semantics are what the shim exists to paper over.

### 2.3 Verified under bun and Node

- **bun 1.4.0:** `TypeError: wasm.__wbindgen_start is not a function` at `module/biscuit.js:5:6` (bun treats the wasm import like a `{default}` namespace too).
- **node v26.7.0 + `--experimental-wasm-modules`:** loads ("biscuit-wasm loading" init log) and the round-trip works **with warm-up**: run 1 → `{"RunLimit":"Timeout"}`, runs 2–3 → OK. So the README's documented Node path works, with the same cold-start budget quirk as §1.6.
- Precedent: [eclipse-biscuit/biscuit-wasm#45](https://github.com/eclipse-biscuit/biscuit-wasm/issues/45) (2024, open) reports the workerd-style snippet-import failure (`WebAssembly.Instance(): Import #38 module="./snippets/…inline0.js": module is not an object or function`) when combining worker-rs + biscuit-wasm — the same wasm-bindgen snippet-module mechanics the smithery shim hardcodes.

---

## 3 · Minimal reproducible setup — one mint → attenuate → verify round-trip

Verified end-to-end under **bun (Node path, shim-node)** and **workerd (shim, inside a fetch handler)** with the returned-status evidence in §4.

### 3.0 Setup

```bash
cd /tmp/opencode/biscuit-smoke
bun add @smithery/biscuit@1.0.1        # -> dep @biscuit-auth/biscuit-wasm@0.6.0
```

**Required consumer-side fix (the shipped tarball doesn't include it):** add the two subpaths to the upstream `exports`, mirroring the repo's patch:

```jsonc
// node_modules/@biscuit-auth/biscuit-wasm/package.json
"exports": {
  ".": { "import": "./module/biscuit.js" },
  "./module/biscuit_bg.js": "./module/biscuit_bg.js",
  "./module/biscuit_bg.wasm": "./module/biscuit_bg.wasm"
}
```

(pnpm consumers can carry the same as `pnpm.patchedDependencies`; bun/npm/yarn have no patched-dependencies support, so it must be applied to `node_modules` or via a build alias. This is a mechanical fact, not a recommendation.)

### 3.1 Imports and init

```ts
import { biscuit, authorizer, block, generateKeyPair } from "@smithery/biscuit";
const { privateKey } = generateKeyPair(); // workerd: MUST be inside a handler, never module scope (§1.5)
```

No manual wasm init — the shim instantiates on import. Tagged-template interpolation gotcha (verified): `${…}` inserts **terms**, never code — a whole-datalog-snippet interpolation becomes `{param_0}` at statement position and fails to parse (`Language: ParseError`, input `{param_0} allow if true`). Write datalog literally; parameterize only values.

### 3.2 Mint (authority block)

```ts
const token = biscuit`
  resource("orders/123");
  operation("read");
  amount_cap(200);
  max_delta(5);
  max_hops(2);

  // 1. per-transaction amount cap
  check if amount_cap($c), amount($a), $a <= $c;
  // 2. audience/merchant binding
  check if resource($r), $r == ${"orders/123"};
  // 3. delegation-depth bound (user-space: verifier supplies hops($n))
  check if max_hops($h), hops($n), $n <= $h;
  // 4. slippage / variance check
  check if max_delta($d), spot($s), exec($e), $e <= $s + $d;
`.build(privateKey);
```

### 3.3 Attenuate (append block — can only narrow; internally generates a fresh keypair)

```ts
const restricted = token.appendBlock(
  block`
    check if amount($a), $a <= 150;                        // tightens cap 200 -> 150
    check if resource($r), $r == ${"orders/123/shipment"}; // narrows binding
  `,
);
```

### 3.4 Verify (inside the fetch handler on Workers)

```ts
authorizer`
  amount(${90});
  resource(${"orders/123/shipment"});
  operation("read");
  hops(${2});          // verifier-injected delegation depth (block count - 1, or policy)
  spot(${100});
  exec(${102});
  allow if true;
`
  .buildAuthenticated(restricted)
  .authorize();
```

`authorize()` throws on any failed check. Verified outcomes (bun + workerd): amount 90 → **AUTHORIZED**; amount 160 → blocked (cap 150); resource `orders/999` → blocked (binding); `hops(4)` → blocked (depth bound); `exec(108)` with `spot(100) + max_delta(5)` → blocked (slippage); unattenuated token + amount 160 → allowed (root cap 200).

### 3.5 The delegation-depth caveat — no builtin `depth()` exists

- The entire official docs book (including the Datalog reference, <https://doc.biscuitsec.org/print>) contains **zero** occurrences of "depth"; `biscuit-wasm@0.6.0`'s `.d.ts` has none either.
- Empirically: `check if depth($d), $d <= 3;` fails unless the authorizer supplies the fact; `depth(1); allow if true;` in the authorizer satisfies it — i.e. `depth` is an ordinary, non-reserved fact name, not an engine-provided one (same for `time()`: not automatic; the CLI adds it via `--include-time`).
- The verifier can measure delegation depth from the token: `token.getRevocationIdentifiers().length` = number of blocks (1 root / 2 after one append — verified in workerd and bun), and `token.countBlocks()` exists in the 0.6.0 glue. A server-side bound can then be enforced by injecting `hops($n)` as an authorizer fact (pattern verified above).

---

## 4 · Smoke test records (exact commands and outputs)

Scratch: `/tmp/opencode/biscuit-smoke` (nothing in the repo was modified; no git commands run).

| #   | Command                                                                          | Result (excerpt)                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `bun add @smithery/biscuit@1.0.1`                                                | `installed @smithery/biscuit@1.0.1`                                                                                                                                                                                                                                      |
| 2   | `bun run resolve-test.ts` (upstream unpatched)                                   | `error: Cannot find module '@biscuit-auth/biscuit-wasm/module/biscuit_bg.js' from '.../dist/shim-node.js'`                                                                                                                                                               |
| 3   | apply upstream-exports patch (§3.0) → `bun run resolve-test.ts`                  | `RESOLVED @smithery/biscuit OK; exports: function function function function`                                                                                                                                                                                            |
| 4   | `bun run roundtrip.ts`                                                           | `minted. blocks: 1 · len: 684` / `attenuated. blocks: 2 · len: 968` / `[ok] … AUTHORIZED` / `[blocked]` ×4 / `[info] amount 160 unattenuated … as expected`                                                                                                              |
| 5   | `bunx wrangler deploy --dry-run` (upstream unpatched, workerd shim)              | `ERROR Could not resolve "@biscuit-auth/biscuit-wasm/module/biscuit_bg.js" … not exported by package`                                                                                                                                                                    |
| 6   | worker with module-scope `generateKeyPair()`, `wrangler dev --local`             | `panicked at src/crypto.rs:215:41: … "Calling Web API crypto.getRandomValues failed"` → `Uncaught RuntimeError: unreachable` → "Workers runtime failed to start"                                                                                                         |
| 7   | same worker, module-scope only `crypto.getRandomValues(new Uint8Array(8))`       | `"probe":"PLAIN-getRandomValues-FAILED: Error: Disallowed operation called within global scope. … generating random values are not allowed within global scope. … https://developers.cloudflare.com/workers/runtime-apis/handlers/"`                                     |
| 8   | worker with handler-scope biscuit, fresh `wrangler dev --local`, curls           | `GET /crypto 200 {"cryptoFallback":"function","filled":true}` · `GET /fixedkey 500 {"RunLimit":"Timeout"}` (cold) · `GET /smoke 200 {"ok":true}` · then `GET /fixedkey 200 {"ok":true,"pub":"ed25519/41e77e842e5c952a29233992dc8ebbedd2d83291a89bb0eec34457e723a69526"}` |
| 9   | official package worker, `wrangler deploy --dry-run`                             | `Total Upload: 2373.00 KiB / gzip: 844.98 KiB` (bundles)                                                                                                                                                                                                                 |
| 10  | official package worker, `wrangler dev --local`                                  | `Uncaught TypeError: wasm2.__wbindgen_start is not a function at index.js:2247:7` → "runtime failed to start"                                                                                                                                                            |
| 11  | official package, `bun run official-bun.ts`                                      | `TypeError: wasm.__wbindgen_start is not a function … module/biscuit.js:5:6`                                                                                                                                                                                             |
| 12  | official package, `node --experimental-wasm-modules official-node2.ts` (v26.7.0) | `roundtrip #1: FAIL -> {"RunLimit":"Timeout"}` / `#2: OK` / `#3: OK`                                                                                                                                                                                                     |
| 13  | fixed-seed key path, workerd (warm)                                              | `GET /fixedkey 200 {"ok":true,"pub":"ed25519/…"}` — `PrivateKey.fromString("ed25519-private/…")`, `KeyPair.fromPrivateKey`, `.build(sk)`                                                                                                                                 |

---

## 5 · Sources

- npm: <https://www.npmjs.com/package/@smithery/biscuit> · <https://registry.npmjs.org/@biscuit-auth/biscuit-wasm> (dist-tags, versions, exports, engines)
- Repo (renamed): <https://github.com/clavia-labs/workers-biscuit> (README; `package.json`; `src/shim.ts`; `patches/@biscuit-auth__biscuit-wasm@0.6.0.patch`; issue #5)
- Official wasm binding: <https://github.com/eclipse-biscuit/biscuit-wasm> (README; `src/lib.rs`, `src/crypto.rs`; issue #45; PR #61)
- Docs: <https://doc.biscuitsec.org/usage/nodejs> (flag, limits), <https://doc.biscuitsec.org/print> (full book; 0 × "depth"), <https://developers.cloudflare.com/workers/runtime-apis/handlers/> (global-scope rule link) · <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- Third-party corroboration of the global-scope RNG rule: <https://github.com/paralleldrive/cuid2/issues/112>, <https://github.com/mastra-ai/mastra/issues/11862>
