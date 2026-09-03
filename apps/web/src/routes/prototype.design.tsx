// PROTOTYPE (#23) — design-system gallery on the throwaway
// `/prototype/design` route. The shell-variant round (A/B/C) already ran its
// course: sidebar won and now lives in `app-sidebar.tsx`; the losing shells
// are preserved on the `throwaway/design-variants` branch. This file is the
// living gallery the surface builds (#24–#27) steal from: every pattern here
// is built from shadcn primitives, and what graduates gets folded into the
// real routes.
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@latch-protocol/ui/components/badge";
import { Button, buttonVariants } from "@latch-protocol/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@latch-protocol/ui/components/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@latch-protocol/ui/components/input-group";
import { RejectionReceiptCard } from "@latch-protocol/ui/components/rejection-receipt-card";
import { Separator } from "@latch-protocol/ui/components/separator";
import { cn } from "@latch-protocol/ui/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@latch-protocol/ui/components/table";

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

// ---------------------------------------------------------------------------

function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "Denied"
      ? "destructive"
      : status === "Captured"
        ? "default"
        : status === "Held"
          ? "secondary"
          : status === "Executed"
            ? "outline"
            : "ghost";
  return (
    <Badge variant={variant} data-status={status} className="font-mono uppercase">
      {status}
    </Badge>
  );
}

function ChatSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat — Act 2</CardTitle>
        <CardDescription>
          Pills prefix the prompt · assistant streams flat · one approval card at a time.
        </CardDescription>
        <CardAction>
          <MonoLabel>{"// /"}</MonoLabel>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {BEAT_PILLS.map((pill) => (
            <Badge key={pill} variant="outline">
              {pill}
            </Badge>
          ))}
        </div>
        <div className="max-w-[80%] justify-self-end bg-primary px-2.5 py-2 text-xs text-primary-foreground">
          Buy the ₹490 shoes
        </div>
        <p className="text-xs leading-relaxed">
          Found them — Street Runner in footwear, in stock. This fits the envelope, so I&apos;ve
          staged a hold. Review and approve:
        </p>
        <div className="font-mono text-[11px] text-muted-foreground">
          <div>{"// shop_search → 1 result · in stock"}</div>
          <div>{"// check_remaining → ₹505.00 of ₹550.00"}</div>
        </div>
        <Card data-approval="pending" className="border-l-2 border-l-primary">
          <CardHeader>
            <CardTitle className="text-xs">Confirm spend {APPROVAL.amount}</CardTitle>
            <CardDescription>
              Awaiting approval — the hold stages nothing until you approve.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">merchant</dt>
              <dd>{APPROVAL.merchant}</dd>
              <dt className="text-muted-foreground">items</dt>
              <dd>{APPROVAL.item}</dd>
              <dt className="text-muted-foreground">why</dt>
              <dd className="text-muted-foreground">{APPROVAL.why}</dd>
              <dt className="text-muted-foreground">expiry</dt>
              <dd className="text-muted-foreground">{APPROVAL.expiry}</dd>
            </dl>
            <Separator />
            <pre className="overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {APPROVAL.clause}
            </pre>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm">
                Reject
              </Button>
              <Button type="button" size="sm">
                Approve
              </Button>
            </div>
          </CardContent>
        </Card>
        <RejectionReceiptCard receipt={{ ...WATCH_RECEIPT }} />
        <InputGroup>
          <InputGroupInput placeholder="Ask Latch…" disabled />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-sm" disabled>
              <ArrowUp aria-hidden />
              <span className="sr-only">Send</span>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </CardContent>
    </Card>
  );
}

function LedgerSection() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "held now", value: "₹490.00" },
          { label: "captured today", value: "₹6,000.00" },
          { label: "denied today", value: "2" },
        ].map((stat) => (
          <Card key={stat.label} size="sm">
            <CardContent>
              <MonoLabel>{stat.label}</MonoLabel>
              <div className="mt-1 text-lg font-semibold tracking-tight">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Ledger — live</CardTitle>
          <CardDescription>Densest-first journal · 2s poll morphs chips in place.</CardDescription>
          <CardAction>
            <MonoLabel>{"// /ledger"}</MonoLabel>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {["Held", "Executed", "Captured", "Voided", "Denied"].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hold</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {LEDGER_ROWS.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">{row.id}</TableCell>
                  <TableCell>{row.what}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{row.when}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StoreSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Store — agent.json</CardTitle>
        <CardDescription>One file, four items · Buy deep-links into chat.</CardDescription>
        <CardAction>
          <MonoLabel>{"// /store"}</MonoLabel>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {STORE_ITEMS.map((item) => (
          <Card key={item.id} size="sm">
            <CardContent className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{item.name}</span>
                <Badge variant="outline" className="font-mono uppercase">
                  {item.tag}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{item.price}</span>
                <a
                  href={`/?q=buy-${item.id}`}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                >
                  Buy via agent
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}

function DesignGallery() {
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4 pb-20">
      <MonoLabel>{"// design-system gallery — shadcn primitives only"}</MonoLabel>
      <ChatSection />
      <LedgerSection />
      <StoreSection />
    </div>
  );
}
