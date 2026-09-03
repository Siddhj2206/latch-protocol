# Research: art-direction references + halftone / light-dark techniques

Scope: issue #11 / ticket #18. Research only — no decisions, no implementation.
Local orientation read (not modified): `packages/ui/src/styles/globals.css`, `apps/web/src/routes/__root.tsx`, `CONTEXT.md`, `packages/ui/components.json`.

Locked direction assumed from ticket: Nous-portal-flavored dev-tool look — dark-first + light mode, mono `//` labels, numbered demo beats, dense tables, one accent, halftone as recurring texture (hero, sidebar foot, Approve-card header, empty states), `tw-animate-css`-only motion.

Stack observed locally:

- `packages/ui/src/styles/globals.css`: `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `@custom-variant dark (&:is(.dark *))`, `:root`/`.dark` token pairs, `@theme inline` mapping `--color-*` → `var(--*)`.
- `packages/ui/components.json`: `style: base-lyra`, `tailwind.baseColor: neutral`, `tailwind.cssVariables: true`, `iconLibrary: lucide`.
- `apps/web/src/routes/__root.tsx`: currently hardcodes `<html className="dark">`, no `ThemeProvider`, no `ScriptOnce`, no `suppressHydrationWarning`, no mode toggle yet.

## 1. References with links

### Tailwind CSS v4 — tokens, dark mode, custom CSS, backgrounds, color

- Theme variables (`@theme`, `@theme inline`, namespaces, referencing other vars, `static`): https://tailwindcss.com/docs/theme
- Dark mode + class-driven override (`@custom-variant dark (&:where(.dark, .dark *))`, `localStorage` + `matchMedia` pattern): https://tailwindcss.com/docs/dark-mode
- Functions and directives (`@utility`, `@variant`, `@custom-variant`, `@apply`, `--alpha()`, `--spacing()` — note `--alpha()` compiles to `color-mix(in oklab, …)`): https://tailwindcss.com/docs/functions-and-directives
- Adding custom styles (`@layer base/components`, `@utility` simple/complex/functional, custom variants with `@slot`): https://tailwindcss.com/docs/adding-custom-styles
- Background image / gradients (`bg-radial`, `bg-[url(...)]`, `bg-(image:...)`, `from-*/via-*/to-*`, interpolation modifiers `/oklab`, `/srgb`): https://tailwindcss.com/docs/background-image
- Colors (palette utilities, `bg-black/75` opacity syntax, `dark:` targeting, referencing `var(--color-*)` in CSS, `--alpha()`, `@theme inline` for cross-referenced colors): https://tailwindcss.com/docs/colors

### shadcn — theming, dark mode (TanStack), sidebar, blocks, tables, empty, card, registry

- Theming (semantic `background/foreground` pairs, token table, radius scale, adding new tokens via `:root` + `.dark` + `@theme inline`, full neutral scaffold): https://ui.shadcn.com/docs/theming
- Dark mode index (framework recipes): https://ui.shadcn.com/docs/dark-mode
- Dark mode — TanStack Start (theme context + `ScriptOnce` anti-flash script + `applyTheme` + `useTheme` + `suppressHydrationWarning` root + mode toggle with `Sun`/`Moon` cross-fade classes): https://ui.shadcn.com/docs/dark-mode/tanstack-start
- Sidebar component (composition `SidebarProvider > Sidebar > SidebarHeader/Content/Footer`, `variant="inset"|"floating"|"sidebar"`, `collapsible="offcanvas"|"icon"|"none"`, `useSidebar`/`toggleSidebar`, `--sidebar-width` styling, `group-data-[collapsible=icon]:hidden` patterns): https://ui.shadcn.com/docs/components/base/sidebar
- Blocks library (copyable app shells): https://ui.shadcn.com/blocks
  - `dashboard-01` — `SidebarProvider` + `AppSidebar variant="inset"` + `SidebarInset` + `SiteHeader` + `SectionCards` + `ChartAreaInteractive` + `DataTable`; per-instance `--sidebar-width` / `--header-height` via `style` prop; install with `npx shadcn add dashboard-01`. Live at https://ui.shadcn.com/blocks (featured block).
  - `sidebar-07` — collapses-to-icons sidebar + `SidebarTrigger` + `Separator` + `Breadcrumb` header pattern; install with `npx shadcn add sidebar-07`. Live at https://ui.shadcn.com/blocks/sidebar.
- Data Table guide (TanStack Table v9 feature-based: `tableFeatures({...})`, `useTable({features,…})`, `<table.FlexRender>`, `overflow-hidden rounded-md border` wrapper, `No results.` empty row, sorting/filtering/visibility/selection/pagination recipes): https://ui.shadcn.com/docs/components/base/data-table
- Table primitives (`Table > TableHeader > TableRow > TableHead`, `TableBody > TableRow > TableCell`, `TableFooter`, `TableCaption`, actions-with-`DropdownMenu` example): https://ui.shadcn.com/docs/components/base/table
- Empty / empty states (`Empty > EmptyHeader(EmptyMedia variant="icon"|avatar, EmptyTitle, EmptyDescription) + EmptyContent`, `border` outline variant, `bg-*/bg-gradient-*` background variant): https://ui.shadcn.com/docs/components/base/empty
- Card (`Card > CardHeader(CardTitle, CardDescription, CardAction) + CardContent + CardFooter`, `size="sm"`, `--card-spacing` variable, `-.mx-(--card-spacing)` edge-to-edge pattern, `[.border-b]:pb-(--card-spacing)` header-divider pattern): https://ui.shadcn.com/docs/components/base/card
- Registry (distribution system for custom components/blocks; `registry.json` / `registry-item.json` schema; GitHub registries; namespaces): https://ui.shadcn.com/docs/registry

### CSS primitives (MDN, primary)

- `color-mix()` — syntax `color-mix(in oklab|srgb, A X%, B)`, percentage normalization, `transparent` mixing for alpha, colorspace guidance (oklab = perceptually uniform; srgb-linear = light-intensity; avoid bare srgb for mixing quality): https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix
- `radial-gradient()` — `circle`, color-stop lists, hard-stop technique (`color A, color B` at same position), `<gradient>` is `<image>` (use on `background-image`, not `background-color`): https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/gradient/radial-gradient
- `light-dark()` — needs `color-scheme: light dark` (usually on `:root`); returns first value for light / second for dark; accepts `<color>` or `<image>` (so whole gradients can switch): https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark

### Motion (`tw-animate-css`-only per locked direction)

- Repo / README (install `@import "tw-animate-css"`, `animate-in`/`animate-out` base + `fade-in`/`zoom-in`/`slide-in-from-*`/`blur-in-*`/`spin-in-*`, `duration-*`/`delay-*`/`ease-*`/`repeat-*`/`fill-mode-*`, ready-made `accordion-down|up`, `collapsible-down|up`, `caret-blink`; unused animations tree-shaken): https://github.com/Wombosvideo/tw-animate-css

## 2. Copyable snippets (halftone utility, token pairs)

All snippets are illustrative research artifacts, not implementation. They follow the repo's existing token convention (`:root`/`.dark` raw tokens + `@theme inline` aliases) so the dot color resolves per-theme instead of being hardcoded.

### 2a. Token strategy — why this survives both themes

Observed local pair (excerpt from `packages/ui/src/styles/globals.css`):

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --border: oklch(0.922 0 0);
  --muted-foreground: oklch(0.556 0 0);
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --muted-foreground: oklch(0.708 0 0);
}
@theme inline {
  --color-foreground: var(--foreground);
  --color-border: var(--border);
}
```

Survival mechanism (per https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix and https://tailwindcss.com/docs/theme):

- Dot color is **derived at computed-value time** from the live token: `color-mix(in oklab, var(--foreground) 10%, transparent)`.
- In light mode `var(--foreground)` is near-black → faint dark dots on white. In dark mode it flips to near-white → faint light dots on near-black. No `dark:` override needed because the *input* already flips.
- Hardcoded `rgba(0,0,0,.12)` fails this: near-invisible on dark. Hardcoded `rgba(255,255,255,.12)` fails the mirror case. Token-derived `color-mix` is the documented fix.
- Same logic already exists in-repo for borders: `.dark --border` is `oklch(1 0 0 / 10%)` (translucent white) vs light `oklch(0.922 0 0)` (opaque). Dots should follow the same translucent-on-dark discipline.

### 2b. Minimal halftone dot utility (Tailwind v4 `@utility`)

Shape per https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/gradient/radial-gradient (hard-stop circle = crisp dot); exposure per https://tailwindcss.com/docs/adding-custom-styles (`@utility` = variant-compatible, e.g. `hover:halftone-strong` works):

```css
/* research sketch — not yet placed in globals.css */
@utility halftone {
  --halftone-dot: color-mix(in oklab, var(--foreground) 12%, transparent);
  --halftone-size: 12px;
  background-image: radial-gradient(circle, var(--halftone-dot) 1px, transparent 1.2px);
  background-size: var(--halftone-size) var(--halftone-size);
}

@utility halftone-fade-b {
  --halftone-dot: color-mix(in oklab, var(--foreground) 12%, transparent);
  background-image: radial-gradient(circle, var(--halftone-dot) 1px, transparent 1.2px);
  background-size: 12px 12px;
  mask-image: linear-gradient(to bottom, black 55%, transparent 100%);
}
```

Notes on the sketch:

- `circle … 1px, transparent 1.2px` is the hard-stop dot; the 0.2px ramp anti-aliases instead of a blurry gradient.
- `--halftone-size` (tile) controls density; keep dot ≤ ~10% of tile so it reads as texture, not polka-dots.
- `mask-image` fade variant is for hero/card-header strips so texture dissolves into the surface (plain CSS; no extra dependency).
- Equivalent Tailwind-native alpha helper per https://tailwindcss.com/docs/functions-and-directives: `--alpha(var(--color-foreground) / 12%)` compiles to the same `color-mix(in oklab, …)` form. Prefer raw `color-mix` in the utility so the `:root`/`.dark` flip is explicit.
- `light-dark()` alternative (per https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark) exists but is redundant here: it needs `color-scheme: light dark` and duplicates the color, whereas the token already encodes the theme. Reserve `light-dark()` for cases with no token (e.g. a fixed accent glow that needs two unrelated stops).

### 2c. Accent-tinted variant (for the single-accent rule)

```css
@utility halftone-accent {
  --halftone-dot: color-mix(in oklab, var(--primary) 18%, transparent);
  background-image: radial-gradient(circle, var(--halftone-dot) 1px, transparent 1.2px);
  background-size: 12px 12px;
}
```

`var(--primary)` flips `oklch(0.205 0 0)` → `oklch(0.87 0 0)` across themes (per local `globals.css`), so the accent dots stay visible in both. If the one accent becomes chromatic later, add it as a new `:root`/`.dark` + `@theme inline` pair per https://ui.shadcn.com/docs/theming ("Adding New Tokens") rather than hardcoding.

### 2d. Where the texture slots in (pattern mapping, no code written)

- Hero: `halftone` + `halftone-fade-b` on a bounded strip, not full-bleed.
- Sidebar foot (`SidebarFooter` per https://ui.shadcn.com/docs/components/base/sidebar): thin `halftone` band above the user row.
- Approve-card header (`CardHeader` + `[.border-b]:pb-(--card-spacing)` per https://ui.shadcn.com/docs/components/base/card): `halftone-accent` confined to header, divider below.
- Empty states (`Empty` + `EmptyMedia variant="icon"` + `bg-*` background variant per https://ui.shadcn.com/docs/components/base/empty): faint `halftone` panel behind `EmptyHeader`.

## 3. Do-and-don't list

### Halftone / theming

- DO derive dot color from a flipping semantic token (`--foreground`, `--border`, `--muted-foreground`, `--primary`) via `color-mix(… transparent)`.
- DON'T hardcode `black/`white` dots or fixed `rgba()` — one theme will always wash out.
- DO keep dot alpha low (8–14% sketch range); verify on both `#fff` and `oklch(0.145 0 0)` backgrounds.
- DON'T tile below ~8px or above ~40% dot/tile ratio — moiré / polka-dot effect, worse on light mode.
- DO put the utility behind `@utility` (not a plain class) so `dark:`, `hover:`, responsive variants compose (https://tailwindcss.com/docs/adding-custom-styles).
- DO keep `@theme inline` for token aliases (`--color-*: var(--*)`) so utilities resolve the live `:root`/`.dark` value (https://tailwindcss.com/docs/theme, https://ui.shadcn.com/docs/theming).
- DON'T reach for `light-dark()` when a token already flips; DO ensure `color-scheme` is set (`root.style.colorScheme` in the TanStack recipe) if `light-dark()` is ever used or native controls/scrollbars must match theme.
- DO confine texture to bands/strips with mask fades; DON'T full-bleed it behind dense tables or body copy.

### Tailwind v4 token practice (this repo)

- DO follow the file's existing order: raw tokens in `:root`/`.dark`, aliases in `@theme inline`, base in `@layer base` (matches https://ui.shadcn.com/docs/theming default scaffold).
- DO add any new token (e.g. accent, halftone density) as a `:root` + `.dark` pair plus `@theme inline` entry (shadcn "Adding New Tokens").
- DON'T define theme-dependent values inside `@theme` directly — `@theme` must stay top-level/static; per-theme values live in `:root`/`.dark` (https://tailwindcss.com/docs/theme).
- DO keep `@custom-variant dark (&:is(.dark *))` as-is (matches both https://tailwindcss.com/docs/dark-mode and https://ui.shadcn.com/docs/theming scaffolds).
- DO use `--alpha()` / `/opacity` shorthand only for static palette colors (https://tailwindcss.com/docs/colors); use explicit `color-mix` for token-derived texture so the flip is auditable.

### shadcn sidebar / blocks worth copying

- DO copy `dashboard-01` shell: `SidebarProvider(style={{--sidebar-width, --header-height}}) > AppSidebar variant="inset" + SidebarInset > SiteHeader + content` (https://ui.shadcn.com/blocks).
- DO copy `sidebar-07` header row: `SidebarTrigger + Separator vertical + Breadcrumb` inside `SidebarInset` header (https://ui.shadcn.com/blocks/sidebar).
- DO use `collapsible="icon"` + `group-data-[collapsible=icon]:hidden` for icon-collapse labels, and `SidebarMenuButton isActive` for the active beat (https://ui.shadcn.com/docs/components/base/sidebar).
- DO put user/mode controls in `SidebarFooter` (sticky by contract) — natural home for the sidebar-foot halftone band.
- DO register any bespoke latch blocks (Approve card, beat list) as registry items if reused (`registry.json`/`registry-item.json`, https://ui.shadcn.com/docs/registry); DON'T fork `sidebar.tsx` itself.

### Dense tables + light mode

- DO build tables on `Table` primitives + the Data Table guide's `overflow-hidden rounded-md border` wrapper and `data-state={selected && "selected"}` row pattern (https://ui.shadcn.com/docs/components/base/table, https://ui.shadcn.com/docs/components/base/data-table).
- DO use semantic header/body/footer roles (`TableHeader`, `TableHead`, `TableBody`, `TableCell`, `TableFooter` for totals) — the invoice + footer examples are the closest dense-table precedent.
- DON'T zebra-stripe with fixed grays; if striping, use `bg-muted/50`-style token washes so light mode doesn't go muddy and dark mode doesn't band.
- DON'T rely on `border` alone for row separation in light mode — `oklch(0.922 0 0)` is faint; pair with `text-muted-foreground` hierarchy and right-aligned tabular numerals for amounts.
- DO keep sticky headers opaque (`bg-background`/`bg-card`, not transparent) or halftone will show through scrolled rows.
- DO keep the `No results.` full-span empty row pattern for the ledger table's empty state, styled as `Empty` when it becomes a panel (https://ui.shadcn.com/docs/components/base/empty).
- DO check `muted-foreground` contrast in light mode first (`oklch(0.556 0 0)` on white is the riskiest pair in the current scaffold); dim auxiliary columns before shrinking font size.

### Motion

- DO stay inside `tw-animate-css`: `animate-in fade-in zoom-in slide-in-from-*`, `animate-out …`, `duration-*/delay-*/ease-*`, `accordion-down/up` for collapsibles (https://github.com/Wombosvideo/tw-animate-css).
- DON'T add framer-motion / custom `@keyframes` for standard enter/exit — tree-shaking already drops unused animations.

## 4. Open questions

1. Accent choice: "one accent color" is locked but unnamed — which oklch value, and does it need its own `:root`/`.dark` foreground pair for dots-on-accent text? (Blocks theming decision, not research.)
2. `__root.tsx` gap: current file hardcodes `className="dark"` with no `ThemeProvider`/`ScriptOnce`/`suppressHydrationWarning`. Is adopting https://ui.shadcn.com/docs/dark-mode/tanstack-start verbatim in scope for the theming ticket, or does the demo stay dark-locked?
3. Halftone density/alpha: is `12px / 1px / 12%` the intended hero default, or should sidebar-foot / card-header / empty-state each get distinct densities? Needs a visual pass, both themes, at 1x and 2x DPR.
4. `light-dark()` vs token-`color-mix`: research recommends token-`color-mix`; confirm no stakeholder requirement to use `light-dark()` directly (e.g. for non-token accent glows).
5. Table stack: full TanStack Table v9 (`tableFeatures`, `useTable`, `<table.FlexRender>`) vs static `Table` primitives for the first dense ledger table? The v9 API in https://ui.shadcn.com/docs/components/base/data-table differs from v8 examples elsewhere — confirm version pin.
6. `base-lyra` vs `base-nova` style drift: local `components.json` says `base-lyra`, current docs default to `base-nova` (radius `calc(*)` scale, `--card-spacing`). Should new Card/Sidebar code follow the installed `lyra` primitives or the `nova` doc snippets?
7. Reduced-motion: should `tw-animate-css` enter/exit be gated behind `prefers-reduced-motion` for numbered demo beats? No repo policy found.
8. Print/export: does the ledger table need a print stylesheet where halftone and dark backgrounds are suppressed? Unscoped.
