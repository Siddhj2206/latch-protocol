/**
 * The Razorpay payment-API seam (glossary distinguishes it from the edge
 * verifier — this is the Razorpay API client, not a capability checker).
 * The ledger's execute step never talks to Razorpay directly: local dev +
 * tests use the fake (deterministic order ids, zero network); a configured key
 * pair makes the same code path talk to real test-mode Orders (research ¶2 —
 * `capture: "manual"` holds the payment in `authorized` so the webhook path
 * captures it later).
 */
export interface RazorpayOrderIntent {
  amount: number; // paise
  currency: string;
  /** ≤40 chars, unique — Razorpay's own idempotency key; we pass the hold id. */
  receipt: string;
  notes: Record<string, string>;
}

export interface RazorpayApi {
  createOrder(intent: RazorpayOrderIntent): Promise<{ orderId: string }>;
}

/** Deterministic from the receipt — the demo runs entirely offline. */
export function createFakeRazorpayApi(): RazorpayApi {
  return {
    createOrder: async ({ receipt }) => ({ orderId: `order_fake_${receipt}` }),
  };
}

export interface RazorpayApiOptions {
  keyId: string;
  keySecret: string;
  /** Defaults to the production base; test vs live is selected by the keys. */
  baseUrl?: string;
}

/** Real test-mode Orders API client (research ¶2: amounts in paise, Basic auth). */
export function createRazorpayApi(opts: RazorpayApiOptions): RazorpayApi {
  const baseUrl = opts.baseUrl ?? "https://api.razorpay.com/v1";
  const authorization = `Basic ${btoa(`${opts.keyId}:${opts.keySecret}`)}`;
  return {
    createOrder: async (intent) => {
      const res = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify({
          amount: intent.amount,
          currency: intent.currency,
          receipt: intent.receipt,
          notes: intent.notes,
          // Hold the payment in `authorized`; the webhook path captures it later.
          payment: { capture: "manual" },
        }),
      });
      if (!res.ok) {
        throw new Error(`razorpay create order failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id: string };
      return { orderId: body.id };
    },
  };
}