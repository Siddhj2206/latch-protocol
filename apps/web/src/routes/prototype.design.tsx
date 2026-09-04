// PROTOTYPE (#23) — component gallery on the throwaway `/prototype/design`
// route, in the Authorization Terminal direction. Rules, not cards; the
// clause strip as signature; copy in plain domain voice. The surface builds
// (#24–#27) steal from here; what graduates gets folded into the real routes.
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, Check, ChevronRight, Lock } from "lucide-react";

import { Button } from "@latch-protocol/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@latch-protocol/ui/components/card";
import { ClauseStrip } from "@latch-protocol/ui/components/clause-strip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@latch-protocol/ui/components/input-group";
import { RejectionReceiptCard } from "@latch-protocol/ui/components/rejection-receipt-card";
import { Separator } from "@latch-protocol/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@latch-protocol/ui/components/table";
import { cn } from "@latch-protocol/ui/lib/utils";

export const Route = createFileRoute("/prototype/design")({
  component: DesignGallery,
});

// ---------------------------------------------------------------------------
// Sample data (agreed contracts: #22 lineup + ₹550 UPI-Lite cap, #20 beats).
// ---------------------------------------------------------------------------

const BEAT_ROWS = [
  { cmd: "/ buy-shoes", meta: "₹490 · footwear" },
  { cmd: "/ buy-jacket", meta: "₹6,000 · needs step-up" },
  { cmd: "/ buy-watch", meta: "₹9,000 · over the cap" },
];

const TOOL_ROWS = [
  { verb: "Searched store", detail: '"shoes" · 1 hit' },
  { verb: "Checked envelope", detail: "fits the ₹550 cap" },
  { verb: "Staged hold", detail: "hld_9f21" },
];

const APPROVAL = {
  amount: "₹490.00",
  merchant: "SneakerHead India",
  item: "Street Runner — White",
  reason: "Under the ₹550 cap.",
  expires: "Single use, expires 23:59 IST.",
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
  {
    id: "hld_9f21",
    what: "Street Runner — White",
    amount: "₹490.00",
    state: "hold",
    when: "12:04:11",
  },
  {
    id: "hld_8c0e",
    what: "Court Socks — 3 pack",
    amount: "₹199.00",
    state: "denied",
    when: "12:03:47",
  },
  {
    id: "hld_77b2",
    what: "Chrono Steel Watch",
    amount: "₹9,000.00",
    state: "denied",
    when: "12:02:03",
  },
  {
    id: "hld_61aa",
    what: "Limited Bomber Jacket",
    amount: "₹6,000.00",
    state: "captured",
    when: "11:58:29",
  },
  {
    id: "hld_50f4",
    what: "Street Runner — White",
    amount: "₹490.00",
    state: "hold",
    when: "11:41:52",
  },
] as const;

const STORE_ITEMS = [
  {
    n: "01",
    id: "sku_runner_490",
    name: "Street Runner — White",
    spec: "Footwear · sizes 40–44",
    price: "₹490",
  },
  {
    n: "02",
    id: "sku_bomber_6000",
    name: "Limited Bomber Jacket",
    spec: "Apparel · sizes M–XL",
    price: "₹6,000",
  },
  {
    n: "03",
    id: "sku_chrono_9000",
    name: "Chrono Steel Watch",
    spec: "Accessories · steel, 5 ATM",
    price: "₹9,000",
  },
  {
    n: "04",
    id: "sku_socks_199",
    name: "Court Socks — 3 pack",
    spec: "Apparel · cotton, UK 6–10",
    price: "₹199",
  },
] as const;

// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: string }) {
  return <h2 className="font-display text-xl font-semibold tracking-tight">{children}</h2>;
}

function StateMark({ state }: { state: "hold" | "captured" | "denied" }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          "text-[10px]",
          state === "hold" && "text-muted-foreground",
          state === "captured" && "text-approve",
          state === "denied" && "text-destructive",
        )}
      >
        {state === "hold" ? "○" : state === "captured" ? "●" : "✕"}
      </span>
      <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
        {state === "hold" ? "Held" : state === "captured" ? "Captured" : "Denied"}
      </span>
    </span>
  );
}

function ChatSection() {
  return (
    <section className="grid gap-4">
      <SectionTitle>Chat</SectionTitle>
      <div className="grid border-y border-border">
        {BEAT_ROWS.map((beat) => (
          <div
            key={beat.cmd}
            className="flex items-baseline gap-3 border-b border-border py-2 last:border-0"
          >
            <span className="font-mono text-[12px] text-foreground">{beat.cmd}</span>
            <span className="truncate text-xs text-muted-foreground">{beat.meta}</span>
          </div>
        ))}
      </div>
      <div className="max-w-[80%] justify-self-end bg-primary px-2.5 py-2 text-[13px] text-primary-foreground">
        Buy the ₹490 shoes
      </div>
      <p className="max-w-prose text-[13px] leading-relaxed">
        Street Runner is in stock and fits the envelope.
      </p>
      <div className="grid">
        {TOOL_ROWS.map((row) => (
          <div key={row.verb} className="flex items-center gap-1.5 py-0.5 text-[12px]">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {row.verb} <span className="text-muted-foreground">— {row.detail}</span>
            </span>
            <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </div>
        ))}
      </div>
      <Card data-approval="pending">
        <CardHeader>
          <div className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            <Lock className="size-3" aria-hidden />
            Authorize this hold · envelope lch_root_7f3a
          </div>
          <CardTitle className="font-display text-[32px] font-semibold tracking-tight tabular-nums">
            {APPROVAL.amount}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-[13px]">
            {APPROVAL.item} ×1 @ {APPROVAL.merchant}
          </div>
          <div className="max-w-prose text-[13px] text-muted-foreground">{APPROVAL.reason}</div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {APPROVAL.expires} · hld_9f21
          </div>
          <ClauseStrip state="hold" clause={APPROVAL.clause} result="₹490.00 ≤ ₹550.00" />
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              className="text-[13px] font-medium text-destructive hover:underline hover:underline-offset-4"
            >
              Reject hold
            </button>
            <Button
              type="button"
              className="bg-approve text-approve-foreground hover:bg-approve/90"
            >
              Approve {APPROVAL.amount}
            </Button>
          </div>
        </CardContent>
      </Card>
      <RejectionReceiptCard receipt={{ ...WATCH_RECEIPT }} />
      <ClauseStrip state="denied" clause={WATCH_RECEIPT.clause} result="got ₹9,000.00" />
      <p className="font-mono text-[12px] text-muted-foreground">
        ✕ Declined ₹9,000.00 to SneakerHead India · kept in envelope · hld_77b2 · 12:02:03 · nothing
        moved
      </p>
      <InputGroup>
        <InputGroupInput
          placeholder="Awaiting decision on ₹490.00 — approve or reject above"
          disabled
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" disabled>
            <ArrowUp aria-hidden />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </section>
  );
}

function LedgerSection() {
  return (
    <section className="grid gap-2">
      <SectionTitle>Ledger</SectionTitle>
      <div className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
        Today · 5 holds
      </div>
      <Table>
        <TableHeader>
          <TableRow className="h-8">
            <TableHead className="font-mono text-[11px] tracking-wide uppercase">Time</TableHead>
            <TableHead className="font-mono text-[11px] tracking-wide uppercase">Item</TableHead>
            <TableHead className="text-right font-mono text-[11px] tracking-wide uppercase">
              Amount
            </TableHead>
            <TableHead className="font-mono text-[11px] tracking-wide uppercase">State</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {LEDGER_ROWS.map((row) => (
            <TableRow key={row.id} className={cn(row.state === "hold" && "hold-tone", "h-12")}>
              <TableCell className="font-mono text-[12px] text-muted-foreground tabular-nums">
                {row.when}
              </TableCell>
              <TableCell>
                <div className="text-[13px]">{row.what}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{row.id}</div>
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums">
                {row.amount}
              </TableCell>
              <TableCell>
                <StateMark state={row.state} />
              </TableCell>
              <TableCell>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function StoreSection() {
  return (
    <section className="grid gap-2">
      <SectionTitle>Store</SectionTitle>
      <div className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
        agent.json · 4 items · INR · no checkout here
      </div>
      <div>
        {STORE_ITEMS.map((item) => (
          <a
            key={item.id}
            href={`/?q=buy-${item.id}`}
            className="flex items-center gap-3 border-b border-border py-3 last:border-0"
          >
            <span className="font-mono text-[12px] text-muted-foreground">{item.n}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{item.name}</span>
              <span className="block text-xs text-muted-foreground">{item.spec}</span>
            </span>
            <span className="font-mono text-[13px] tabular-nums">{item.price}</span>
            <span className="text-[13px] font-medium underline underline-offset-4">
              Continue in chat
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function DesignGallery() {
  return (
    <div className="mx-auto grid max-w-2xl gap-8 p-4 pb-20 sm:p-6">
      <ChatSection />
      <Separator />
      <LedgerSection />
      <Separator />
      <StoreSection />
    </div>
  );
}
