// PROTOTYPE (#23) — "Three design-system directions, switchable via
// `?variant=`, on the throwaway `/prototype/design` route." Throwaway by
// design: the foundations it exercises (theme-provider, mode-toggle,
// halftone utilities, sonner rewire) are real and stay; the variant shells
// below do not ship. Winner gets folded into the real shell, losers move to
// the throwaway branch per the prototype skill.
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareText, ScrollText, Store, Terminal, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@latch-protocol/ui/components/button";
import { ModeToggle } from "@latch-protocol/ui/components/mode-toggle";
import { RejectionReceiptCard } from "@latch-protocol/ui/components/rejection-receipt-card";
import { useTheme } from "@latch-protocol/ui/components/theme-provider";
import { cn } from "@latch-protocol/ui/lib/utils";
import { PrototypeSwitcher } from "../components/prototype-switcher";

export const Route = createFileRoute("/prototype/design")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: search["variant"] === "B" || search["variant"] === "C" ? search["variant"] : "A",
  }),
  component: DesignPrototype,
});

const VARIANTS = [
  { key: "A", label: "Sidebar devtool" },
  { key: "B", label: "Rail terminal" },
  { key: "C", label: "Floating deck" },
] as const;

// ---------------------------------------------------------------------------
// Shared sample data (mirrors the agreed contracts: #22 agent.json lineup,
// UPI-Lite per-tx cap ₹550, #20 chat beats, #21 ledger chips).
// ---------------------------------------------------------------------------

const NAV = [
  { to: "/", n: "01", label: "Chat", Icon: MessageSquareText },
  { to: "/store", n: "02", label: "Store", Icon: Store },
  { to: "/ledger", n: "03", label: "Ledger", Icon: ScrollText },
] as const;

const ENVELOPE = {
  root: "lch_root_7f3a",
  spent: "₹505.00",
  cap: "₹550.00",
  scope: "footwear · mer_sneakerhead",
};

const APPROVAL = {
  amount: "₹490.00",
  merchant: "SneakerHead India",
  item: "Street Runner — White",
  why: "Act 2 auto-checkout · under the UPI-Lite cap",
  expiry: "single-use · expires 23:59 IST",
  clause: "check if amount_cap($c), spot($s), $s <= $c",
};

const WATCH_RECEIPT = {
  code: "AmountCapExceeded",
  message: "Per-Transaction Cap Exceeded. Expected: at most ₹550.00, Got: ₹9,000.00",
  clause: "check if amount_cap($c), spot($s), $s <= $c",
  expected: "at most ₹550.00",
  got: "₹9,000.00",
} as const;

const LEDGER_ROWS = [
  { id: "hld_9f21", what: "Street Runner — White", status: "Held", when: "12:04:11" },
  { id: "hld_8c0e", what: "Court Socks — 3 pack", status: "Denied", when: "12:03:47" },
  { id: "hld_77b2", what: "Chrono Steel Watch", status: "Denied", when: "12:02:03" },
  { id: "hld_61aa", what: "Limited Bomber Jacket", status: "Captured", when: "11:58:29" },
  { id: "hld_50f4", what: "Street Runner — White", status: "Voided", when: "11:41:52" },
] as const;

const STORE_ITEMS = [
  { id: "sku_runner_490", name: "Street Runner — White", price: "₹490", tag: "footwear" },
  { id: "sku_bomber_6000", name: "Limited Bomber Jacket", price: "₹6,000", tag: "apparel" },
  { id: "sku_chrono_9000", name: "Chrono Steel Watch", price: "₹9,000", tag: "accessories" },
  { id: "sku_socks_199", name: "Court Socks — 3 pack", price: "₹199", tag: "apparel" },
] as const;

const BEAT_PILLS = ["Buy the ₹490 shoes", "Buy the ₹6,000 jacket", "Buy the ₹9,000 watch"];

// ---------------------------------------------------------------------------
// Shared atoms (a shared header/atom is fine — only the layouts must differ).
// ---------------------------------------------------------------------------

function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-none border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase",
        status === "Denied" && "border-destructive/40 bg-destructive/10 text-destructive",
        status === "Held" && "border-ring bg-muted text-foreground",
        status === "Captured" && "border-primary/40 bg-primary text-primary-foreground",
        status === "Executed" && "border-primary/40 bg-primary/10 text-foreground",
        status === "Voided" && "border-border bg-transparent text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function EnvelopeReadout({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-envelope-root={ENVELOPE.root}
      data-envelope-spent={ENVELOPE.spent}
      data-envelope-cap={ENVELOPE.cap}
      className={cn(!compact && "rounded-none border border-border bg-card p-3")}
    >
      <MonoLabel>// envelope</MonoLabel>
      <div className="mt-1 flex items-center gap-1.5 text-xs font-medium">
        <Wallet className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono">{ENVELOPE.root}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        spent <span className="font-medium text-foreground">{ENVELOPE.spent}</span> of{" "}
        {ENVELOPE.cap} · {ENVELOPE.scope}
      </div>
    </div>
  );
}

function ApprovalCard() {
  return (
    <div
      data-approval="pending"
      className="rounded-none border border-border border-l-2 border-l-primary bg-card p-3"
    >
      <MonoLabel>// confirmation — awaiting approval</MonoLabel>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">amount</dt>
        <dd className="font-medium">{APPROVAL.amount}</dd>
        <dt className="text-muted-foreground">merchant</dt>
        <dd>{APPROVAL.merchant}</dd>
        <dt className="text-muted-foreground">items</dt>
        <dd>{APPROVAL.item}</dd>
        <dt className="text-muted-foreground">why</dt>
        <dd className="text-muted-foreground">{APPROVAL.why}</dd>
        <dt className="text-muted-foreground">expiry</dt>
        <dd className="text-muted-foreground">{APPROVAL.expiry}</dd>
      </dl>
      <pre className="mt-2 overflow-x-auto border-t border-border pt-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
        {APPROVAL.clause}
      </pre>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="outline" size="sm">
          Reject
        </Button>
        <Button type="button" size="sm">
          Approve
        </Button>
      </div>
    </div>
  );
}

function ChatDemo() {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5">
        {BEAT_PILLS.map((pill) => (
          <span key={pill} className="rounded-none border border-border px-2 py-1 text-xs">
            {pill}
          </span>
        ))}
      </div>
      <div className="max-w-[80%] justify-self-end rounded-none bg-primary px-2.5 py-2 text-xs text-primary-foreground">
        Buy the ₹490 shoes
      </div>
      <div className="text-xs leading-relaxed">
        Found them — Street Runner in footwear, in stock. This fits the envelope, so I&apos;ve
        staged a hold. Review and approve:
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        <div>// shop_search → 1 result · in stock</div>
        <div>// check_remaining → ₹505.00 of ₹550.00</div>
      </div>
      <ApprovalCard />
      <RejectionReceiptCard receipt={{ ...WATCH_RECEIPT }} />
      <div className="rounded-none border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
        input disabled while approval pending…
      </div>
    </div>
  );
}

function LedgerDemo() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        {["Held", "Executed", "Captured", "Voided", "Denied"].map((s) => (
          <StatusChip key={s} status={s} />
        ))}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <th className="py-1.5 pr-2 font-medium">hold</th>
            <th className="py-1.5 pr-2 font-medium">item</th>
            <th className="py-1.5 pr-2 font-medium">status</th>
            <th className="py-1.5 font-medium">time</th>
          </tr>
        </thead>
        <tbody>
          {LEDGER_ROWS.map((row) => (
            <tr key={row.id} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-2 font-mono text-[11px]">{row.id}</td>
              <td className="py-1.5 pr-2">{row.what}</td>
              <td className="py-1.5 pr-2">
                <StatusChip status={row.status} />
              </td>
              <td className="py-1.5 font-mono text-[11px] text-muted-foreground">{row.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoreDemo() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {STORE_ITEMS.map((item) => (
        <div key={item.id} className="rounded-none border border-border bg-card p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{item.name}</span>
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              {item.tag}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold">{item.price}</span>
            <a
              href={`/?q=buy-${item.id}`}
              className="rounded-none bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground"
            >
              Buy via agent
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

function ThemeStateLine() {
  const { theme } = useTheme();
  return (
    <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
      theme: {theme} · flip it with the toggle — halftone + tokens follow
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant A — Sidebar devtool (Nous): full-height nav + budget readout.
// ---------------------------------------------------------------------------

function VariantA() {
  return (
    <div data-variant="A" className="flex h-full min-h-0 animate-in fade-in-0 duration-200">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
        <div className="border-b border-sidebar-border p-3">
          <div className="text-sm font-semibold tracking-tight">LATCH</div>
          <MonoLabel>// risk protocol</MonoLabel>
        </div>
        <nav className="grid gap-0.5 p-2">
          {NAV.map(({ to, n, label, Icon }) => (
            <a
              key={to}
              href={to}
              data-active={label === "Chat"}
              className="flex items-center gap-2 rounded-none px-2 py-1.5 text-xs data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="font-mono text-[10px] text-muted-foreground">{n}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="p-2">
          <EnvelopeReadout />
        </div>
        <div className="mt-auto border-t border-sidebar-border p-2">
          <div className="flex items-center justify-between">
            <ThemeStateLine />
            <ModeToggle />
          </div>
          <div className="halftone halftone-fade mt-2 h-8 rounded-none opacity-60" aria-hidden />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4">
        <MonoLabel>// chat — act 2</MonoLabel>
        <div className="mt-2 grid max-w-2xl gap-5">
          <ChatDemo />
          <section className="grid gap-2">
            <MonoLabel>// ledger — live</MonoLabel>
            <LedgerDemo />
          </section>
          <section className="grid gap-2">
            <MonoLabel>// store — agent.json</MonoLabel>
            <StoreDemo />
          </section>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant B — Rail terminal: icon rail + top bar + split chat/ledger.
// ---------------------------------------------------------------------------

function VariantB() {
  return (
    <div data-variant="B" className="flex h-full min-h-0 animate-in fade-in-0 duration-200">
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2">
        {NAV.map(({ to, label, Icon }) => (
          <a
            key={to}
            href={to}
            title={label}
            aria-label={label}
            data-active={label === "Chat"}
            className="flex size-9 items-center justify-center rounded-none text-muted-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
          >
            <Icon className="size-4" aria-hidden />
          </a>
        ))}
        <div className="mt-auto">
          <ModeToggle />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <span className="text-sm font-semibold tracking-tight">LATCH</span>
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            {ENVELOPE.root} · spent {ENVELOPE.spent} of {ENVELOPE.cap}
          </span>
          <span className="ml-auto">
            <ThemeStateLine />
          </span>
        </div>
        <div className="halftone h-6 shrink-0 opacity-50" aria-hidden />
        <main className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <section className="h-fit rounded-none border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Terminal className="size-3.5 text-muted-foreground" aria-hidden />
              <MonoLabel>agent session — act 2</MonoLabel>
            </div>
            <ChatDemo />
          </section>
          <div className="grid h-fit gap-4">
            <section className="rounded-none border border-border bg-card p-3">
              <MonoLabel>ledger — live</MonoLabel>
              <div className="mt-2">
                <LedgerDemo />
              </div>
            </section>
            <section className="rounded-none border border-border bg-card p-3">
              <MonoLabel>store — agent.json</MonoLabel>
              <div className="mt-2">
                <StoreDemo />
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant C — Floating deck: centered column, top nav card, card grid.
// ---------------------------------------------------------------------------

function VariantC() {
  return (
    <div
      data-variant="C"
      className="halftone-soft h-full min-h-0 animate-in overflow-y-auto fade-in-0 duration-200"
    >
      <div className="mx-auto grid max-w-4xl gap-4 p-4 pb-20">
        <header className="flex flex-wrap items-center gap-2 rounded-none border border-border bg-card p-3">
          <div>
            <div className="text-sm font-semibold tracking-tight">LATCH</div>
            <MonoLabel>risk protocol</MonoLabel>
          </div>
          <nav className="mx-auto flex gap-1">
            {NAV.map(({ to, label }) => (
              <a
                key={to}
                href={to}
                data-active={label === "Chat"}
                className="rounded-none px-2.5 py-1.5 text-xs data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {ENVELOPE.spent} / {ENVELOPE.cap}
            </span>
            <ModeToggle />
          </div>
        </header>
        <ThemeStateLine />
        <section className="rounded-none border border-border bg-card p-4">
          <MonoLabel>chat — act 2</MonoLabel>
          <div className="mt-2">
            <ChatDemo />
          </div>
        </section>
        <div className="grid gap-4 md:grid-cols-5">
          <section className="rounded-none border border-border bg-card p-4 md:col-span-3">
            <MonoLabel>ledger — live</MonoLabel>
            <div className="mt-2">
              <LedgerDemo />
            </div>
          </section>
          <section className="rounded-none border border-border bg-card p-4 md:col-span-2">
            <MonoLabel>store — agent.json</MonoLabel>
            <div className="mt-2 grid gap-2 sm:grid-cols-1">
              <StoreDemo />
            </div>
          </section>
        </div>
        <EnvelopeReadout />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DesignPrototype() {
  const { variant } = Route.useSearch();
  return (
    <div className="h-full min-h-0">
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <PrototypeSwitcher variants={[...VARIANTS]} current={variant} />
    </div>
  );
}
