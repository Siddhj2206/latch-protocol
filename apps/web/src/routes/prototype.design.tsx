// PROTOTYPE (#23) — component gallery on the throwaway `/prototype/design`
// route, in the Authorization Terminal direction. Rules, not cards; the
// clause strip as signature; copy in plain domain voice. The surface builds
// (#24–#27) steal from here; what graduates gets folded into the real routes.
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";

import { Badge } from "@latch-protocol/ui/components/badge";
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

const BEAT_PILLS = ["Buy the ₹490 shoes", "Buy the ₹6,000 jacket", "Buy the ₹9,000 watch"];

const APPROVAL = {
  amount: "₹490.00",
  merchant: "SneakerHead India",
  item: "Street Runner — White",
  reason: "Under the ₹550 per-transaction cap, footwear scope matches.",
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
  { id: "sku_runner_490", name: "Street Runner — White", price: "₹490", tag: "Footwear" },
  { id: "sku_bomber_6000", name: "Limited Bomber Jacket", price: "₹6,000", tag: "Apparel" },
  { id: "sku_chrono_9000", name: "Chrono Steel Watch", price: "₹9,000", tag: "Accessories" },
  { id: "sku_socks_199", name: "Court Socks — 3 pack", price: "₹199", tag: "Apparel" },
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
      <div className="flex flex-wrap gap-1.5">
        {BEAT_PILLS.map((pill) => (
          <Badge key={pill} variant="secondary" className="font-normal">
            {pill}
          </Badge>
        ))}
      </div>
      <div className="max-w-[80%] justify-self-end bg-primary px-2.5 py-2 text-[13px] text-primary-foreground">
        Buy the ₹490 shoes
      </div>
      <p className="max-w-prose text-[13px] leading-relaxed">
        Found them — Street Runner in footwear, in stock. This fits the envelope, so I staged a
        hold. Review and approve:
      </p>
      <div className="grid gap-0.5 font-mono text-[11px] text-muted-foreground">
        <div>shop_search → 1 result, in stock</div>
        <div>check_remaining → ₹505.00 of ₹550.00</div>
      </div>
      <Card data-approval="pending">
        <CardHeader>
          <CardTitle className="font-display text-base">
            Approve {APPROVAL.amount} to {APPROVAL.merchant}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Item</dt>
            <dd>{APPROVAL.item}</dd>
            <dt className="text-muted-foreground">Why it fits</dt>
            <dd className="text-muted-foreground">{APPROVAL.reason}</dd>
            <dt className="text-muted-foreground">Expiry</dt>
            <dd className="text-muted-foreground">{APPROVAL.expires}</dd>
          </dl>
          <ClauseStrip state="hold" clause={APPROVAL.clause} result="₹490.00 ≤ ₹550.00" />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline">
              Reject
            </Button>
            <Button
              type="button"
              className="bg-approve text-approve-foreground hover:bg-approve/90"
            >
              Approve ₹490.00
            </Button>
          </div>
        </CardContent>
      </Card>
      <RejectionReceiptCard receipt={{ ...WATCH_RECEIPT }} />
      <ClauseStrip state="denied" clause={WATCH_RECEIPT.clause} result="got ₹9,000.00" />
      <InputGroup>
        <InputGroupInput placeholder="Ask for anything in the store…" disabled />
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
    <section className="grid gap-3">
      <SectionTitle>Ledger</SectionTitle>
      <Table>
        <TableHeader>
          <TableRow className="h-8">
            <TableHead className="font-mono text-[11px] tracking-wide uppercase">Hold</TableHead>
            <TableHead className="font-mono text-[11px] tracking-wide uppercase">Item</TableHead>
            <TableHead className="text-right font-mono text-[11px] tracking-wide uppercase">
              Amount
            </TableHead>
            <TableHead className="font-mono text-[11px] tracking-wide uppercase">State</TableHead>
            <TableHead className="text-right font-mono text-[11px] tracking-wide uppercase">
              Time
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {LEDGER_ROWS.map((row) => (
            <TableRow key={row.id} className={cn(row.state === "hold" && "hold-tone", "h-10")}>
              <TableCell className="font-mono text-[12px]">{row.id}</TableCell>
              <TableCell>{row.what}</TableCell>
              <TableCell className="text-right font-mono text-[12px] tabular-nums">
                {row.amount}
              </TableCell>
              <TableCell>
                <StateMark state={row.state} />
              </TableCell>
              <TableCell className="text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                {row.when}
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
    <section className="grid gap-1">
      <SectionTitle>Store</SectionTitle>
      <p className="text-[13px] text-muted-foreground">
        Four items from agent.json. Choosing one continues in chat, where the hold is staged and
        approved.
      </p>
      <div>
        {STORE_ITEMS.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{item.name}</div>
              <div className="text-xs text-muted-foreground">{item.tag}</div>
            </div>
            <div className="font-mono text-[13px] tabular-nums">{item.price}</div>
            <a
              href={`/?q=buy-${item.id}`}
              className={cn("text-[13px] font-medium text-foreground underline underline-offset-4")}
            >
              Continue in chat
            </a>
          </div>
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
