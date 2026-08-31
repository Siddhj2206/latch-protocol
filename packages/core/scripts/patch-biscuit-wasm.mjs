// Idempotent patch for @biscuit-auth/biscuit-wasm (see docs/research/biscuit-wasm-workerd.md §3.0).
// Two problems with the published package.json `exports`:
//   1. It ships only the root conditions map; the smithery shim imports the internal
//      subpaths `./module/biscuit_bg.js` and `./module/biscuit_bg.wasm`, which strict
//      bundlers (wrangler's esbuild) refuse to resolve.
//   2. bun's resolver rejects the mixed root-conditions + subpaths form entirely
//      ("Cannot find module") — it needs a dotted `"."` root key.
// npm/bun/yarn have no patched-dependencies support, so the patch is carried here.
// Works with the bun `node_modules/.bun` store layout AND the classic npm/monorepo
// hoisted layout.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = {
  ".": { import: "./module/biscuit.js", default: "./module/biscuit.js" },
  "./module/biscuit_bg.js": "./module/biscuit_bg.js",
  "./module/biscuit_bg.wasm": "./module/biscuit_bg.wasm",
};

function findPackageJson(startDir) {
  // 1) classic layout: node_modules/@biscuit-auth/biscuit-wasm walking up
  let dir = startDir;
  for (;;) {
    const p = join(dir, "node_modules", "@biscuit-auth", "biscuit-wasm", "package.json");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 2) bun `.bun` store layout: node_modules/.bun/@biscuit-auth+biscuit-wasm@*/node_modules/...
  dir = startDir;
  for (;;) {
    const bunStore = join(dir, "node_modules", ".bun");
    const entries = readdirSafe(bunStore);
    for (const e of entries) {
      if (e.startsWith("@biscuit-auth+biscuit-wasm@")) {
        const p = join(
          bunStore,
          e,
          "node_modules",
          "@biscuit-auth",
          "biscuit-wasm",
          "package.json",
        );
        if (existsSync(p)) return p;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

const file = findPackageJson(dirname(fileURLToPath(import.meta.url)));
if (!file) {
  console.warn(
    "[patch-biscuit-wasm] NOT FOUND: @biscuit-auth/biscuit-wasm — run `bun install` first, then re-run this script",
  );
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(file, "utf8"));
const needs =
  !pkg.exports?.["."] ||
  !pkg.exports?.["./module/biscuit_bg.js"] ||
  !pkg.exports?.["./module/biscuit_bg.wasm"];
if (!needs) {
  console.log("[patch-biscuit-wasm] already patched:", file);
  process.exit(0);
}
pkg.exports = TARGET;
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[patch-biscuit-wasm] rewrote exports in ${file}`);
process.exit(0);
