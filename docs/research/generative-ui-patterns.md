# Research: Generative UI + AI SDK UI-state patterns (ticket #17, issue #11)

Date: 2026-09-03. Primary sources only (ai-sdk.dev "v7 (Latest)" docs, Cloudflare docs, OpenRouterTeam repo).
No implementation, no decisions — findings + open questions only.
Local orientation: `apps/server/src/app.ts` (Hono, no `/v1/chat` yet), `apps/server/package.json`
(hono ^4.12.32, no `ai` dep), `apps/web/package.json` (React catalog ^19.2.8, no `ai`/`@ai-sdk/react`
dep), `packages/ui` chat primitives are presentational only (`bubble`, `message`, `message-scroller`
via `@shadcn/react`, `rejection-receipt-card`) — no AI SDK coupling today.

## 0. Version verdict: current major is v7, not v5 or v6

- Docs nav labels the current docs "v7 (Latest)" / "AI SDK 7.x" (every ai-sdk.dev page fetched).
- `vercel/ai` releases show `ai@7.0.91` alongside maintained `ai@6.0.275` and `ai@5.0.251` lines.
- `@openrouter/ai-sdk-provider` (OpenRouterTeam/ai-sdk-provider) has a **v7 release line**
  ("supports `ai@^7.0.0`, requires Node.js 22+, ESM-only") plus LEGACY v6/v5 lines — so the
  ticket's "v5 vs v6" premise is stale; **pin against v7** (`ai`, `@ai-sdk/react`,
  `@openrouter/ai-sdk-provider` v7 line) and record resolved versions at install time.
- v5→v6 migration guide confirms the breaking surface between those majors
  (`CoreMessage`→`ModelMessage`, `system`→`instructions`, approval states added):
  https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0

## 1. Version-pinned API shapes (v7 docs, with links)

### 1.1 Server: `streamText` + UI-message-stream wiring
- `streamText({ model, instructions, messages, tools, toolChoice, stopWhen, toolApproval,
  experimental_toolApprovalSecret, temperature, maxOutputTokens, ... })` — full signature:
  https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
  - `instructions` (not `system`) carries the system prompt — confirmed in current examples:
    https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
  - `temperature?: number` is a top-level param → `temperature: 0` is supported as specified.
  - Multi-step: `stopWhen: isStepCount(5)`; default stops after first tool-result step:
    https://ai-sdk.dev/docs/getting-started/tanstack-start
  - Tools: `tool({ description, inputSchema: z.object({...}), execute })`; tools **without**
    `execute` are client-side tools (no auto-execution). `inputSchema` accepts Zod or JSON Schema
    (repo's zod catalog is v4 — v6+ uses Standard Schema, compatible).
- Request/response helpers (the ONLY correct pairing for `useChat`):
  `convertToModelMessages(messages)` → `streamText` → `toUIMessageStream({ stream: result.stream })`
  → `createUIMessageStreamResponse({ stream })`:
  https://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream-response
- Hono cookbook (returns the raw `Response`; framework-agnostic, no Next.js needed):
  https://ai-sdk.dev/cookbook/api-servers/hono
  - Custom data alongside the LLM stream: `createUIMessageStream({ execute({ writer }) {
    writer.write(...); writer.merge(toUIMessageStream(...)) } })` — candidate vehicle for
    pushing `remainingPaise`/receipt metadata without a tool call.
  - Errors masked by default; expose via `onError` on `toUIMessageStream`:
    https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage#errors
- Approval config: `toolApproval: { pay: 'user-approval' }` on `streamText` (NOT per-tool
  `needsApproval`, which is deprecated except on `WorkflowAgent`); per-input functions and
  whole-map generic functions supported; `experimental_toolApprovalSecret` HMAC-signs approvals
  so a forged client cannot bypass human-in-the-loop on money tools:
  https://ai-sdk.dev/docs/agents/tool-approvals
- OpenRouter provider: `pnpm add @openrouter/ai-sdk-provider`;
  `createOpenRouter({ apiKey })` → `openrouter.chat('<free-model-slug>')`:
  https://ai-sdk.dev/providers/community-providers/openrouter

### 1.2 Client: `useChat` contract (`@ai-sdk/react`, React 19 OK — all quickstarts use React)
- Import/returns reference: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- `const { messages, sendMessage, regenerate, stop, resumeStream, error, clearError,
  addToolOutput, addToolApprovalResponse, addToolResult, setMessages, onToolCall,
  sendAutomaticallyWhen, onFinish, onError } = useChat({ transport: new DefaultChatTransport({
  api, headers, credentials, body, prepareSendMessagesRequest, prepareReconnectToStreamRequest
  }), ... })`
  - No internal input state: caller owns `input` via `useState` + `sendMessage({ text })`.
  - `DefaultChatTransport` (POST UI-message stream) is the default; `TextStreamChatTransport`
    is text-only (no tools); custom transports possible:
    https://ai-sdk.dev/docs/ai-sdk-ui/transport
  - TanStack Start wiring (server route `src/routes/api/chat.ts` + `useChat`) — but NOTE: Latch
    keeps chat on the **separate Hono server**, so use the Hono route shape (§1.1) with
    `new DefaultChatTransport({ api: '<absolute-server-URL>/v1/chat' })`, not a Start route:
    https://ai-sdk.dev/docs/getting-started/tanstack-start
- `UIMessage = { id, role: 'system'|'user'|'assistant', metadata?, parts: UIMessagePart[] }`;
  tool parts are typed `tool-${toolName}` (e.g. `tool-pay`, `tool-shop_search`):
  https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message
- Tool-part `state` union **per the v7 `UIMessage` reference**: `input-streaming`
  (partial `DeepPartial<input>`, render skeleton/activity row) → `input-available` (pending —
  render tool-activity row) → `approval-requested` (render Approve card; `part.approval`:
  `{ id, requestReason?, descriptor?, isAutomatic? }`) → `approval-responded`
  (`{ approved, reason? }`, transient) → `output-available` (`part.output` → receipt cards) /
  `output-error` (`part.errorText`): https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message
  - ⚠️ SKEW: the Tool Usage guide additionally handles an `output-denied` state and the stream
    protocol defines a `tool-output-denied` chunk, but the v7 `UIMessage` reference type above
    does **not** list `output-denied` — must verify against installed `ai` `.d.ts` (Open Q6).
- Approval UI: only call `addToolApprovalResponse({ id: part.approval.id, approved, reason? })`
  for **manual** approvals (`!part.approval.isAutomatic`); auto-continue with
  `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` (or
  `...WithToolCalls` for plain client tools): https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- Client-side auto tools: `onToolCall` + `addToolOutput({ tool, toolCallId, output })` (no `await`
  — deadlock risk); must narrow `if (toolCall.dynamic)` first; `dynamic-tool` parts for
  schema-less/MCP tools: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- Step boundaries: `step-start` parts → render `<hr/>`-style separators in multi-step turns.
- Wire protocol (custom-backend reference): SSE, header `x-vercel-ai-ui-message-stream: v1`,
  chunks `text-start/delta/end`, `tool-input-start/delta/available`, `tool-approval-request/
  response`, `tool-output-available/denied`, `start-step/finish-step/reset-step`, `finish`,
  `data-*`, `error`, terminator `data: [DONE]`:
  https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

### 1.3 Error / offline behavior
- `useChat` exposes `error` + `onError`; recommended pattern: generic "Something went wrong" +
  `regenerate()` retry (optionally drop the failed tail via `setMessages`):
  https://ai-sdk.dev/docs/ai-sdk-ui/error-handling
- Server errors are masked ("An error occurred" troubleshooting entry) unless `onError` is set
  on `toUIMessageStream` — decide exposure policy for D1/ledger failures vs surprises.
- `stop()` aborts the local read; true resumability needs Redis + `resumable-stream` + GET
  resume endpoint (`resume: true`, `prepareReconnectToStreamRequest`) — almost certainly
  out of scope for the demo; offline = error state + retry, not resume:
  https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams
- Deployment streaming: if chunks arrive buffered, add `Transfer-Encoding: chunked` /
  `Connection: keep-alive` on the stream response:
  https://ai-sdk.dev/docs/troubleshooting/streaming-not-working-when-deployed

## 2. Minimal route↔client contract sketch (shapes only, NOT implementation)

```
POST /v1/chat  (Hono, apps/server)
  req:  { messages: UIMessage[] }                      (+ optional per-request body, e.g. idempotency key)
  resp: SSE UI-message stream (header x-vercel-ai-ui-message-stream: v1), chunks per §1.2
  server pipeline: c.req.json() → convertToModelMessages() →
    streamText({ model: openrouter.chat(FREE_SLUG), temperature: 0, instructions,
                 tools: { shop_search, check_remaining, pay, request_step_up },
                 toolApproval: { pay: 'user-approval', ... },   // exact set TBD
                 experimental_toolApprovalSecret, stopWhen: isStepCount(n),
                 onError: <mask-or-expose policy> }) →
    createUIMessageStreamResponse({ stream: toUIMessageStream({ stream }) })
  returns: raw Response (NOT c.json/c.text)

Client (apps/web, useChat + DefaultChatTransport({ api: '<server>/v1/chat' }))
  message.parts → render map:
    text                              → Bubble/Message primitives (streaming|done)
    tool-shop_search/check_remaining  → tool-activity rows (input-streaming/input-available → spinner;
                                        output-available → result summary; output-error → errorText)
    tool-pay approval-requested       → Approve card (amount/merchant/Datalog-clause from part.input +
                                        part.approval.requestReason/descriptor; Approve/Deny →
                                        addToolApprovalResponse)  [manual only; skip when isAutomatic]
    tool-pay output-available         → hold confirmation UI (holdId/status/remainingPaise)
    tool-* output-error / output-denied(?) → rejection receipt cards (existing
                                        rejection-receipt-card.tsx; verify output-denied in Q6)
    step-start                        → step separator; data-* → balance/metadata pushes via onData
```

## 3. workerd caveats (Cloudflare Workers — every item flagged, none verified by execution)

1. **Return the raw `Response`.** `createUIMessageStreamResponse` builds a standard
   `Response` over Web Streams — return it directly from the Hono handler; do NOT pass through
   `c.json()`/`c.text()`. Pattern confirmed framework-agnostic by the Hono cookbook (§1.1 link).
2. **Streaming headers.** Cloudflare's own AI SDK doc sets
   `Content-Type: text/x-unknown, content-encoding: identity, transfer-encoding: chunked` on
   `toTextStreamResponse` to force chunked delivery; Hono's streaming helper doc likewise says
   to set `Content-Encoding: Identity` when streaming misbehaves under Wrangler:
   https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/ ,
   https://hono.dev/docs/helpers/streaming — verify which (if any) the UI-message SSE stream
   needs on real Workers vs miniflare.
3. **No Node APIs.** `ai` core is Web-Stream/fetch-based and Cloudflare documents it on Workers;
   `@openrouter/ai-sdk-provider` is fetch (OpenAI-compatible) based — but its **v7 line is
   ESM-only / Node-22+** per OpenRouterTeam; confirm it bundles under the server's tsdown build
   and runs under workerd (no `node:*` imports), in miniflare first.
4. **Do not confuse the two `streamText`s.** `hono/streaming`'s `streamText(c, ...)` is unrelated
   to `ai`'s `streamText` — import collision hazard in the route file.
5. **Long-lived multi-step streams vs Worker limits.** `stopWhen: isStepCount(n)` + server-side
   `execute` keeps one request open across N model round-trips; check Workers request
   wall-clock/CPU limits and OpenRouter free-model latency — cap steps, set `timeout`/`maxRetries`
   on `streamText`, fail closed to a receipt-shaped `output-error`.
6. **Secrets stay server-side.** `OPENROUTER_API_KEY` (+ `TOOL_APPROVAL_SECRET` if used) as Worker
   secrets/env via `@latch-protocol/env`; never import provider config into `apps/web`. (No
   secrets were read or printed in this research.)
7. **Cross-origin chat.** Web and server deploy separately → absolute `api` URL in
   `DefaultChatTransport` + existing Hono `cors()` must permit the chat POST (verify
   `allowHeaders`/preflight for `Content-Type: application/json` — current `app.ts` only sets
   `origin` + `allowMethods`).
8. **No `resumable-stream`/Redis on the edge path** unless explicitly scoped in later — offline
   story is error + `regenerate()`, not resume (§1.3).
9. **`maxDuration`-style config is Next/Vercel-specific** (used in cookbook examples) — no
   equivalent knob on Workers; use `streamText` timeout options instead.

## 4. Open questions (explicit, no guesses)

1. **Exact pin set**: resolved versions of `ai`, `@ai-sdk/react`, `@openrouter/ai-sdk-provider`
   (v7 line) + `@ai-sdk/react` peer-compat with React 19.2 / TanStack Start 1.168 at install time.
2. **Free-model slug**: which OpenRouter `:free` model (tool-calling quality varies wildly; some
   free models don't support tools at all) — needs a live smoke test, out of scope here.
3. **Which tools are server-`execute` vs client-side, and the exact `toolApproval` map**
   (pay presumably `user-approval`; is `request_step_up` approval-gated or auto?).
4. **`requestInput` has no AI SDK counterpart found** — no `requestInput` export in UI docs;
   closest matches are `addToolApprovalResponse`, `addToolOutput`, and MCP elicitation.
   Clarify whether this means the approval card, a step-up input form, or an MCP concept.
5. **Where the Approve card's Datalog clause comes from**: `part.input` schema fields vs
   `approval.requestReason` vs `approvalDescriptor` opaque metadata — server/client agreement TBD.
6. **`output-denied` reality in v7**: guide + wire protocol have it, `UIMessage` reference type
   doesn't — verify in installed `ai` types and decide denied-receipt rendering.
7. **chat-level vs message-level status**: `useChat` reference shows
   `status: submitted|streaming|ready|error` adjacent to message fields — confirm top-level
   `status`/`error` usage forpending/disabled/offline UI against installed types.
8. **Error exposure policy**: what `onError` surfaces to the client for D1/ledger/OpenRouter
   failures (mask vs message), and mapping to rejection-receipt vs generic error UI.
9. **CORS preflight** for cross-origin `/v1/chat` (Q7 in §3) + whether cookies/credentials are
   needed (`credentials: 'include'` transport option exists).
10. **Approval replay threat**: with `useChat` the client resends history each turn — for `pay`,
    set `experimental_toolApprovalSecret` (server env on all instances); confirm multi-instance
    secret distribution story for Workers.
