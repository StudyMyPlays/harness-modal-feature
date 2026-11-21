# Venice Chat Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prompt optimizer with a ChatGPT-style chat harness that
talks to Venice AI. It runs locally first and deploys to Vercel unchanged.

**Architecture:** The DeepSeek-Harness seams are rebuilt in TypeScript under
`src/lib/harness/`:
- an LLM adapter (Venice)
- a stateless agent loop with a tool registry (MCP tools)
- a typed stream protocol
- a browser-owned session log with projection, compaction and a swappable
  `SessionStore` (IndexedDB in v1)

Next.js route handlers (`/api/chat`, `/api/models`, `/api/title`,
`/api/compact`, `/api/tools`, `/api/unlock`) sit behind one shared guard. The
UI is a sidebar plus chat view, styled with be-promptful's tokens.

**Tech Stack:**
- Next.js 16.4 (App Router), React 19.2, Tailwind 4, TypeScript, Vitest
- react-markdown, remark-gfm, remark-breaks, rehype-highlight
- @modelcontextprotocol/sdk, zod, sonner, @radix-ui/react-dialog
- fake-indexeddb (dev, tests only)

**Spec:** `docs/superpowers/specs/2026-11-20-venice-chat-harness-design.md`. Read it before any task.

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing a route handler, config
  or proxy (AGENTS.md). In Next 16, middleware is `proxy.ts`. This plan does
  not need one.
- Venice base URL: `https://api.venice.ai/api/v1`. Auth:
  `Authorization: Bearer ${VENICE_API_KEY}`. The key is read only on the
  server (no `NEXT_PUBLIC_`).
- Default models:
  - `HARNESS_MODELS` = `deepseek-v4-1-flash-1017-uncensored,glm-5-3-flash-uncensored`
  - `HARNESS_DEFAULT_MODEL` = `deepseek-v4-1-flash-1017-uncensored`
  - `HARNESS_UTILITY_MODEL` = `glm-5-3-flash-uncensored`
- Agent loop limits: max 8 steps per turn, 20,000 ms per tool, and tool
  results capped at 16,000 characters.
- Request body cap: 4,400,000 bytes. Attachment and history budget: 4,000,000
  bytes. Per-file limit: 4 MB, for images and documents.
- `COMPACT_AT_TOKENS` defaults to 150000. Token estimate: `Math.ceil(chars / 4)`.
  Compaction keeps the last 6 messages verbatim.
- `HARNESS_DAILY_CALL_BUDGET` defaults to 2000 upstream calls. The chat rate
  limit is 20 per 60 s per IP.
- `include_venice_system_prompt` defaults to `false`. Web search defaults to
  `off`. When web search is not `off`, `enable_web_citations` is true.
- Errors to the browser always go through `upstreamMessage`/`downstreamStatus`.
  Venice's response body is never forwarded.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WR9uofXxUEgS2C5a8uBRKH
  ```
- Checks that must stay green after every task: `npm run lint`,
  `npm run typecheck`, `npm test`. `npm run build` must pass at the end.
- Test style follows the repo:
  - colocated `*.test.ts(x)`
  - component tests start with `// @vitest-environment jsdom`
  - `fetch` is stubbed with `vi.stubGlobal`
  - env is stubbed with `vi.stubEnv`

## Review Focus

1. **Tab reload or close mid-stream.** The partial reply is still there after
   reload, marked "interrupted", and the chat can continue (Task 14).
2. **Venice 401, 402 or 429 mid-chat, or a missing key.** The assistant
   message shows a short, friendly error with Retry. No Venice text or key
   detail is shown, and the user message isn't lost (Tasks 3 and 14).
3. **Switching to a model without vision in a chat that has images.** Images
   are replaced by the text placeholder in the projection, with no 400 from
   Venice (Task 12).
4. **An over-budget paste or attachment.** The composer refuses before
   sending and names the limit. Nothing is half-sent (Tasks 12 and 17).
5. **An MCP server that's down or slow, or a malformed tool-call argument.**
   The turn continues, the model sees a tool error, and other tools still
   load (Tasks 5 and 6).

---

## File Structure

```
src/lib/harness/
  config.ts                 env → HarnessConfig
  llm/types.ts              LlmMessage, LlmRequest, LlmEvent, LlmAdapter, LlmError, Usage, Citation
  llm/sse.ts                parseSse(): bytes → data payloads
  llm/venice.ts             createVeniceAdapter(), chunk→LlmEvent mapping, error mapping
  llm/retry.ts              withRetry(adapter)
  catalog.ts                getModelCatalog(), costUsd()
  tools/registry.ts         HarnessTool, createToolRegistry(), executeToolCall()
  tools/mcp.ts              parseMcpServers(), loadMcpTools()
  agent-loop.ts             runAgentLoop()
  protocol.ts               HarnessEvent, encodeEvent(), readHarnessStream()
  http.ts                   isCrossSite(), readJsonBody()   (moved from optimize route)
  auth.ts                   signSession(), verifySession(), checkAccess()
  guard.ts                  guardRequest()
  prompts.ts                harnessPreamble(), TITLE_PROMPT, COMPACT_PROMPT, sanitizeTitle()
  citations.ts              linkCitations()
  session/format.ts         Chat, ChatSettings, SessionEvent, AttachmentRef, AssistantStep
  session/projection.ts     projectForModel(), estimateTokens()
  session/compaction.ts     shouldCompact(), selectCompactionRange()
  session/store.ts          SessionStore interface, createMemoryStore()
  session/indexeddb.ts      createIndexedDbStore()
  client/controller.ts      createChatController()
  client/use-chat.ts        React hooks over the controller
src/app/api/{chat,models,title,compact,tools,unlock}/route.ts
src/components/chat/        harness-app, sidebar, chat-view, message-list, user-message,
                            assistant-message, markdown, thinking-block, sources,
                            usage-badge, composer, model-picker, settings-sheet, unlock-screen
src/components/ui/          (existing) + sheet.tsx (Radix dialog), sonner.tsx
```

Removed in Task 19:
- `src/lib/optimizer/`, `src/components/optimizer/`, `src/app/api/optimize/`
- `src/lib/openrouter*.ts`
- `public/platforms/`, `public/{next,vercel,globe,window,file}.svg`
- the `diff` dependency

---

### Task 1: Dependencies and config

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/lib/harness/config.ts`
- Test: `src/lib/harness/config.test.ts`

**Interfaces:**
- Produces:
  - `interface HarnessConfig { veniceKey: string | null; models: string[]; defaultModel: string; utilityModel: string; dailyBudget: number; compactAtTokens: number; passcode: string | null; sessionSecret: string | null; isPublic: boolean; isProduction: boolean; mcpServersRaw: string | undefined }`
  - `getHarnessConfig(env?: NodeJS.ProcessEnv): HarnessConfig`

- [ ] **Step 1: Install packages.** Runtime packages:
  `npm install react-markdown remark-gfm remark-breaks rehype-highlight @modelcontextprotocol/sdk zod sonner @radix-ui/react-dialog`.
  Dev package: `npm install -D fake-indexeddb`. Don't remove `diff` yet;
  Task 19 removes it.
- [ ] **Step 2: Write failing tests** in `config.test.ts`:
  - `defaults when env is empty`:
    - `models` equals the two default IDs
    - `defaultModel === 'deepseek-v4-1-flash-1017-uncensored'`
    - `utilityModel === 'glm-5-3-flash-uncensored'`
    - `dailyBudget === 2000`
    - `compactAtTokens === 150000`
    - `veniceKey === null`
    - `isPublic === false`
  - `HARNESS_MODELS is trimmed and de-duplicated`: `' a, b ,a,'` becomes `['a','b']`.
  - `default model must be in the allow-list`: if `HARNESS_DEFAULT_MODEL='x'`
    isn't in `models`, then `defaultModel === models[0]`.
  - `non-numeric budgets fall back to defaults`.
  - `HARNESS_PUBLIC=1 sets isPublic`.
- [ ] **Step 3: Run** `npx vitest run src/lib/harness/config.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement `getHarnessConfig`.** Read from the `env` argument (default `process.env`), so tests don't need `stubEnv`.
- [ ] **Step 5: Run the test again.** Expected: PASS. Then run `npm run lint && npm run typecheck`.
- [ ] **Step 6: Commit** `feat(harness): add dependencies and env config`.

### Task 2: LLM types and SSE parsing

**Files:**
- Create: `src/lib/harness/llm/types.ts`, `src/lib/harness/llm/sse.ts`
- Test: `src/lib/harness/llm/sse.test.ts`

**Interfaces:**
- Produces, in `types.ts` (exactly these names):
  ```ts
  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'file'; file: { filename: string; file_data: string } }
  interface LlmToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
  type LlmMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string | ContentPart[] }
    | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string }
  interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
  type WebSearchMode = 'off' | 'on' | 'auto'
  interface LlmRequest {
    model: string; messages: LlmMessage[]; tools?: ToolSpec[]
    reasoningEffort?: string; temperature?: number; maxTokens?: number
    webSearch: WebSearchMode; includeVeniceSystemPrompt: boolean
    signal: AbortSignal; timeoutMs: number
  }
  interface Usage { inputTokens: number; outputTokens: number; cachedInputTokens: number }
  interface Citation { title: string; url: string; content?: string; date?: string }
  type FinishReason = 'stop' | 'length' | 'tool_calls' | 'other'
  type LlmEvent =
    | { type: 'reasoning-delta'; text: string }
    | { type: 'text-delta'; text: string }
    | { type: 'citations'; citations: Citation[] }
    | { type: 'tool-calls'; calls: LlmToolCall[] }
    | { type: 'usage'; usage: Usage }
    | { type: 'meta'; balanceUsd: number | null }
    | { type: 'finish'; reason: FinishReason }
  interface LlmAdapter { stream(req: LlmRequest): AsyncIterable<LlmEvent> }
  class LlmError extends Error {
    constructor(public kind: 'upstream' | 'timeout' | 'empty' | 'transport' | 'aborted', public status?: number)
    get retryable(): boolean  // upstream 429 or >=500, or transport
  }
  ```
- Produces, in `sse.ts`: `parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<string>`.
  It yields each `data:` payload, with multi-line data joined by `\n`. It
  stops at `[DONE]` and skips comments (`:`) and blank events.

- [ ] **Step 1: Write failing tests** in `sse.test.ts`. Build streams from string arrays.
  - `yields data payloads split across chunk boundaries`: chunks
    `['data: {"a":', '1}\n\ndata: {"b":2}\n\n']` give `['{"a":1}','{"b":2}']`.
  - `handles CRLF line endings`.
  - `ignores comment lines and stops at [DONE]`: payloads after `[DONE]` aren't yielded.
  - `joins multi-line data fields with newline`.
  - `flushes a final event without trailing blank line`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/llm/sse.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `types.ts` and `parseSse`. Use `TextDecoder` with `stream: true` and buffer lines.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): llm types and SSE parser`.

### Task 3: Venice adapter and retry

**Files:**
- Create: `src/lib/harness/llm/venice.ts`, `src/lib/harness/llm/retry.ts`, `src/lib/harness/llm/__fixtures__/` (JSON arrays of chunk objects)
- Move: `upstreamMessage`, `downstreamStatus` from `src/lib/openrouter.ts` into `venice.ts`, unchanged in behaviour (Task 19 deletes the old file)
- Test: `src/lib/harness/llm/venice.test.ts`, `src/lib/harness/llm/retry.test.ts`

**Interfaces:**
- Consumes: Task 2 types and `parseSse`.
- Produces:
  - `VENICE_BASE_URL = 'https://api.venice.ai/api/v1'`
  - `createVeniceAdapter(opts: { key: string; fetchImpl?: typeof fetch }): LlmAdapter`
  - `buildVeniceBody(req: LlmRequest): Record<string, unknown>`
  - `upstreamMessage(status: number, feature?: string): string`
  - `downstreamStatus(status: number): number`
  - `withRetry(adapter: LlmAdapter, opts?: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> }): LlmAdapter`

**Rules:**
- `buildVeniceBody` sends:
  - `model`, `messages`, `stream: true`, `stream_options: { include_usage: true }`
  - `tools`, mapped to the OpenAI `{type:'function', function:{name, description, parameters}}` shape, only when non-empty
  - `reasoning_effort` when set
  - `temperature` when set
  - `max_tokens` when set
  - `venice_parameters: { enable_web_search, enable_web_citations: webSearch !== 'off', include_venice_system_prompt }`
- Each chunk's `choices[0].delta` is mapped as follows:
  - `reasoning_content` becomes `reasoning-delta`
  - `content` becomes `text-delta`
  - `tool_calls[]` deltas accumulate by `index`: id and name from the first
    delta, `arguments` concatenated. They're emitted once, as a single
    `tool-calls` event, before `finish`.
- `chunk.venice_parameters?.web_search_citations` (non-empty) becomes one
  `citations` event.
- `chunk.usage` becomes `usage`:
  - `prompt_tokens` → `inputTokens`
  - `completion_tokens` → `outputTokens`
  - `prompt_tokens_details?.cached_tokens ?? 0` → `cachedInputTokens`
- `finish_reason` maps to `stop|length|tool_calls`, with anything else as
  `other`.
- The `meta` event reads the first header present of
  `x-venice-balance-usd` / `x-venice-balance-diem`, as a number or null. It's
  emitted first.
- Errors:
  - non-2xx becomes `LlmError('upstream', status)`, with the body logged via
    `console.error` and never thrown into the message
  - a stream with no text, no reasoning and no tool calls becomes
    `LlmError('empty')`
  - `AbortSignal.timeout(timeoutMs)` combined with `req.signal` (via
    `AbortSignal.any`) becomes `'timeout'` or `'aborted'`, depending on which
    signal fired
- `withRetry` retries only when the error is `retryable` **and no event has
  been yielded yet**. Defaults are 2 retries, with base delay 500 ms
  doubling.

- [ ] **Step 1: Record fixtures.** These are hand-written JSON arrays of
  OpenAI-style chunks:
  - `text.json`: reasoning, then text, then a usage chunk
  - `tools.json`: two tool calls whose arguments are split across 3 deltas
  - `search.json`: the first chunk carries
    `venice_parameters.web_search_citations` with 2 entries

  After Task 20, replace them with real captured streams if they differ.
- [ ] **Step 2: Write failing tests** in `venice.test.ts`. Stub `fetchImpl` to return an SSE `Response`.
  - `maps reasoning, text and usage in order`: event types are
    `['meta','reasoning-delta','text-delta','usage','finish']`, and usage is
    `{inputTokens, outputTokens, cachedInputTokens}`.
  - `accumulates split tool-call arguments into one tool-calls event`:
    `calls[0].function.arguments === '{"q":"cats"}'` and `calls.length === 2`.
  - `emits citations from the first chunk`.
  - `buildVeniceBody sets venice_parameters`:
    - `webSearch:'auto'` gives `enable_web_search:'auto'`, `enable_web_citations:true`
    - `includeVeniceSystemPrompt:false` gives `include_venice_system_prompt:false`
    - with no tools, there's no `tools` key
  - `non-2xx throws LlmError upstream with status and never includes body text`:
    a 402 with body `"insufficient balance sk-xx"` gives `kind 'upstream'`,
    `status 402`, and the message doesn't contain `'sk-xx'`.
  - `aborting the caller signal throws kind 'aborted'`, and
    `timeout throws kind 'timeout'` (fake timers, or `timeoutMs: 1` with a
    stream that never ends).
  - `empty stream throws kind 'empty'`.
  - `upstreamMessage/downstreamStatus` keep the existing cases. Port them
    from `src/lib/openrouter.test.ts`.
- [ ] **Step 3: Write failing tests** in `retry.test.ts`:
  - `retries a 429 thrown before the first event`: it's called 2 times and
    then succeeds.
  - `does not retry after an event was yielded`.
  - `does not retry 400 or aborted`.
  - `gives up after retries and rethrows the last error`.
- [ ] **Step 4: Run** `npx vitest run src/lib/harness/llm`. Expected: FAIL.
- [ ] **Step 5: Implement** `venice.ts` and `retry.ts`.
- [ ] **Step 6: Run the tests again.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(harness): Venice streaming adapter with retry`.

### Task 4: Model catalog and cost

**Files:**
- Create: `src/lib/harness/catalog.ts`
- Test: `src/lib/harness/catalog.test.ts`

**Interfaces:**
- Produces:
  - `interface ModelPricing { inputUsd: number; outputUsd: number; cachedInputUsd: number }` (USD per 1M tokens)
  - `interface ModelInfo { id: string; name: string; contextTokens: number; maxOutputTokens: number; supportsVision: boolean; supportsTools: boolean; supportsWebSearch: boolean; reasoningEffortOptions: string[]; defaultReasoningEffort: string | null; pricing: ModelPricing }`
  - `getModelCatalog(opts: { key: string; allow: string[]; fetchImpl?: typeof fetch; now?: () => number }): Promise<ModelInfo[]>`
  - `costUsd(usage: Usage, pricing: ModelPricing): number`
  - `resetCatalogCache(): void`

**Rules:**
- Call `GET ${VENICE_BASE_URL}/models?type=text` with the bearer key.
- Map from `model_spec`:
  - `name`
  - `availableContextTokens`
  - `maxCompletionTokens`
  - `capabilities.supportsVision`, `capabilities.supportsFunctionCalling`, `capabilities.supportsWebSearch`
  - `capabilities.reasoningEffortOptions ?? []`
  - `capabilities.defaultReasoningEffort ?? null`
  - `pricing.input.usd`, `pricing.output.usd`, `pricing.cache_input.usd ?? pricing.input.usd`
- The result is filtered and ordered by `allow`. Allowed IDs missing from
  Venice are left out.
- The cache lasts 10 minutes per process. A failed fetch serves the stale
  cache if there is one, and otherwise throws `LlmError('upstream', status)`.
- `costUsd` = `((input − cached) × inputUsd + cached × cachedInputUsd + output × outputUsd) / 1e6`.

- [ ] **Step 1: Write failing tests:**
  - `maps and orders allowed models`. The fixture uses the real spec values
    from the design §3:
    - deepseek: `contextTokens 1000000`, `reasoningEffortOptions ['none','low','high','max']`, pricing `0.33/1.32/0.00825`
    - glm: pricing `0.165/0.55/0.033`
  - `caches for 10 minutes`: `fetch` is called once across two calls at
    `now+9min`, and again at `now+11min`.
  - `serves stale cache when refresh fails`.
  - `costUsd`: `{input:1_000_000, cached:0, output:1_000_000}` with deepseek
    pricing gives `1.65`. `{input:1_000_000, cached:1_000_000, output:0}`
    gives `0.00825`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): model catalog and cost`.

### Task 5: Tool registry and executor

**Files:**
- Create: `src/lib/harness/tools/registry.ts`
- Test: `src/lib/harness/tools/registry.test.ts`

**Interfaces:**
- Consumes: `ToolSpec`, `LlmToolCall` (Task 2).
- Produces:
  - `interface HarnessTool { spec: ToolSpec; execute(args: unknown, ctx: { signal: AbortSignal }): Promise<string> }`
  - `interface ToolRegistry { specs(): ToolSpec[]; get(name: string): HarnessTool | undefined }`
  - `createToolRegistry(tools: HarnessTool[]): ToolRegistry`. A duplicate
    name throws.
  - `interface ToolResult { ok: boolean; content: string; truncated: boolean }`
  - `executeToolCall(registry: ToolRegistry, call: LlmToolCall, opts: { signal: AbortSignal; timeoutMs?: number; maxChars?: number }): Promise<ToolResult>`.
    Defaults: 20000 ms and 16000 characters. **It never throws.**

- [ ] **Step 1: Write failing tests:**
  - `runs a tool with parsed JSON args`.
  - `unknown tool returns ok:false 'Unknown tool: <name>'`.
  - `malformed JSON args returns ok:false starting 'Invalid JSON arguments'` (Review Focus 5).
  - `tool that throws returns ok:false with the error message`.
  - `times out after timeoutMs with ok:false 'Tool timed out after 20s'` (fake timers).
  - `truncates content over maxChars and sets truncated:true`.
  - `aborted signal returns ok:false 'Cancelled'`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/tools/registry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): tool registry and guarded executor`.

### Task 6: MCP tool source

**Files:**
- Create: `src/lib/harness/tools/mcp.ts`
- Test: `src/lib/harness/tools/mcp.test.ts`

**Interfaces:**
- Consumes: `HarnessTool` (Task 5).
- Produces:
  - `interface McpServerConfig { name: string; url: string; headers?: Record<string, string> }`
  - `parseMcpServers(raw: string | undefined): McpServerConfig[]`. It
    returns `[]` for invalid JSON (with `console.error`) and drops entries
    with no name, a non-https URL (except `http://localhost`), or a duplicate
    name. Names must match `/^[a-z0-9_-]{1,32}$/i`.
  - `interface McpServerStatus { name: string; ok: boolean; toolCount: number; error?: string }`
  - `loadMcpTools(servers: McpServerConfig[], enabled: string[], deps?: { connect?: (s: McpServerConfig) => Promise<McpConnection>; now?: () => number }): Promise<{ tools: HarnessTool[]; status: McpServerStatus[] }>`
  - `interface McpConnection { listTools(): Promise<{ name: string; description?: string; inputSchema: Record<string, unknown> }[]>; callTool(name: string, args: unknown, signal: AbortSignal): Promise<string> }`
  - `resetMcpCache(): void`

**Rules:**
- The default `connect` uses `@modelcontextprotocol/sdk` `Client` with
  `StreamableHTTPClientTransport`. Check the SDK's README in `node_modules`
  for current import paths.
- `callTool` joins the `text` content items. Non-text items become
  `[<type> content omitted]`.
- Tool names are `mcp__<server>__<tool>`, cut to 64 characters.
- Connection and tool list are cached per server for 5 minutes.
- Each server loads in parallel, with a 5 s connect timeout. A failing
  server gives `ok:false` and the others still load (Review Focus 5).

- [ ] **Step 1: Write failing tests**, using a fake `connect`:
  - `parseMcpServers` cases: valid, invalid JSON, `http://evil` dropped,
    `http://localhost:3001` kept, duplicate dropped.
  - `prefixes tool names and only loads enabled servers`.
  - `a server that rejects yields ok:false and others still load`.
  - `a server that hangs past 5s yields ok:false 'timed out'`.
  - `caches listTools for 5 minutes`.
  - `callTool joins text content`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/tools/mcp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): MCP client tool source`.

### Task 7: Stream protocol

**Files:**
- Create: `src/lib/harness/protocol.ts`
- Test: `src/lib/harness/protocol.test.ts`

**Interfaces:**
- Consumes: `Citation`, `Usage`, `FinishReason`, `ToolResult`.
- Produces:
  ```ts
  type TurnFinish = FinishReason | 'max-steps' | 'aborted'
  type HarnessEvent =
    | { type: 'step-start'; step: number }
    | { type: 'reasoning-delta'; text: string }
    | { type: 'text-delta'; text: string }
    | { type: 'citations'; citations: Citation[] }
    | { type: 'tool-call'; id: string; name: string; args: string }
    | { type: 'tool-result'; id: string; result: ToolResult }
    | { type: 'usage'; usage: Usage; costUsd: number | null }
    | { type: 'meta'; balanceUsd: number | null }
    | { type: 'step-end'; step: number; finishReason: FinishReason }
    | { type: 'done'; finishReason: TurnFinish }
    | { type: 'error'; message: string; status: number }
  ```
  - `encodeEvent(e: HarnessEvent): Uint8Array`, which writes `data: <json>\n\n`
  - `eventsToResponse(events: AsyncIterable<HarnessEvent>): Response`, with
    headers `content-type: text/event-stream`, `cache-control: no-cache, no-transform`
    and `x-accel-buffering: no`
  - `readHarnessStream(res: Response): AsyncIterable<HarnessEvent>`, which
    reuses `parseSse` and drops unknown `type`s

- [ ] **Step 1: Write failing tests:**
  - `round-trips every event type through eventsToResponse and readHarnessStream`.
  - `ignores unknown event types`.
  - `an iterator that throws mid-stream ends with an error event, not a broken stream`.
    `eventsToResponse` catches the error and writes
    `{type:'error', message:'The stream ended unexpectedly.', status:502}`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/protocol.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): typed stream protocol`.

### Task 8: Agent loop

**Files:**
- Create: `src/lib/harness/agent-loop.ts`
- Test: `src/lib/harness/agent-loop.test.ts`

**Interfaces:**
- Consumes: `LlmAdapter`, `LlmRequest`, `LlmError` (Tasks 2–3), `ToolRegistry` and `executeToolCall` (Task 5), `HarnessEvent` (Task 7), `upstreamMessage`/`downstreamStatus`.
- Produces: `runAgentLoop(opts: { adapter: LlmAdapter; request: Omit<LlmRequest, 'tools' | 'signal' | 'timeoutMs'>; tools: ToolRegistry; signal: AbortSignal; deadline: number; maxSteps?: number; stepTimeoutMs?: number; pricing?: ModelPricing | null; beforeStep?: () => boolean; now?: () => number }): AsyncIterable<HarnessEvent>`. Defaults: `maxSteps` 8 and `stepTimeoutMs` 120000.

**Rules:**
- Each step:
  - It checks `beforeStep()`, which is the daily budget. If that returns
    false, the loop emits
    `error {message:'The harness is at capacity for today. Try again tomorrow.', status:503}`.
  - It emits `step-start`.
  - It calls `adapter.stream` with `tools: tools.specs()` and
    `timeoutMs: min(stepTimeoutMs, deadline − now)`, and re-emits deltas,
    citations and meta.
  - It turns `usage` into
    `{usage, costUsd: pricing ? costUsd(usage, pricing) : null}`, summed
    across steps into a single `usage` event before `done`.
- If the step finishes with `tool-calls`:
  - It emits `tool-call` for each call.
  - It runs the calls sequentially with `executeToolCall`, emitting
    `tool-result`.
  - It appends the assistant message (`content` = the step's text or null,
    plus `tool_calls`) and the `tool` messages, then starts the next step.
- Otherwise it emits `step-end`, then `done` with that finish reason.
- When `maxSteps` is exhausted while tools are still requested, it emits
  `done 'max-steps'`.
- On abort, it emits `done 'aborted'` (no error).
- An `LlmError` becomes an `error` with
  `{message: upstreamMessage(status, 'The chat'), status: downstreamStatus(status)}`:
  - `timeout` maps to `504` with `'The model provider took too long to answer. Try again.'`
  - `empty` maps to `502` with `'The model returned an empty response. Try again.'`
- When `deadline − now < 1000` before a step, it emits `done 'length'`.

- [ ] **Step 1: Write failing tests**, with a fake adapter driven by scripted event arrays:
  - `single step text turn`: events are
    `step-start, text-delta…, step-end, usage, done(stop)`.
  - `tool round trip`: in step 1 the model calls `echo`, and in step 2 it
    answers. The second `adapter.stream` call's messages end with an
    assistant message whose `tool_calls` has the call, then
    `{role:'tool', tool_call_id, content}`.
  - `stops at maxSteps with done max-steps` when every step requests tools.
  - `aborted signal ends with done aborted`.
  - `LlmError 401 becomes error 502 with friendly message`.
  - `usage is summed across steps and costed` (pricing given).
  - `beforeStep false ends with 503 error before calling adapter`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/agent-loop.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): stateless agent loop`.

### Task 9: HTTP helpers, passcode gate, shared guard, unlock route

**Files:**
- Create: `src/lib/harness/http.ts`, `src/lib/harness/auth.ts`, `src/lib/harness/guard.ts`, `src/app/api/unlock/route.ts`
- Test: `src/lib/harness/auth.test.ts`, `src/lib/harness/guard.test.ts`, `src/app/api/unlock/route.test.ts`

**Interfaces:**
- Consumes: `getHarnessConfig` (Task 1), `checkRateLimits`, `consumeBudget`, `getClientIp` (`src/lib/rate-limit.ts`), `jsonError`, `notConfigured`, `rateLimited`, `invalidBody`, `unauthorized` (`src/lib/api-response.ts`).
- Produces:
  - `http.ts`: `isCrossSite(req: Request): boolean` and
    `readJsonBody(req: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }>`.
    Both move out of `src/app/api/optimize/route.ts` with the same
    behaviour. `readJsonBody` also checks the content type (415), declared
    length (413), streamed length (413) and JSON parse (400).
  - `auth.ts`:
    - `SESSION_COOKIE = 'harness_session'` and `SESSION_TTL_MS = 30 * 24 * 3600_000`
    - `signSession(secret: string, now: number): Promise<string>`, giving
      `${expiresAt}.${base64url(HMAC-SHA256)}` via Web Crypto
    - `verifySession(token: string | undefined, secret: string, now: number): Promise<boolean>`
    - `checkPasscode(given: string, expected: string): boolean`, a
      constant-time comparison over the UTF-8 bytes, length-safe
    - `checkAccess(req: Request, cfg: HarnessConfig): Promise<Response | null>`
  - `guard.ts`: `guardRequest(req: Request, opts: { name: string; limit: number; windowMs: number; budgetUnits: number }): Promise<{ ok: true; cfg: HarnessConfig; ip: string } | { ok: false; response: Response }>`.
    The order is: cross-site (403), `checkAccess`, missing Venice key (503
    `'The harness isn’t configured: set VENICE_API_KEY.'`), client IP (503,
    same as today), rate limit (429), then budget (503).
  - `POST /api/unlock` takes the body `{ passcode: string }`:
    - Correct passcode: 204, with
      `Set-Cookie: harness_session=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
      plus `Secure` in production.
    - Wrong passcode: 401.
    - It's rate limited to 5 per minute per IP.
  - `GET /api/unlock` returns `{ required: boolean, unlocked: boolean }` for
    the UI.

`checkAccess` rules:
- With a passcode set, it needs a valid cookie, and otherwise returns 401
  `'Enter the passcode to continue.'`.
- With no passcode in production and `!isPublic`, it returns 503
  `'Set HARNESS_PASSCODE (or HARNESS_PUBLIC=1) before deploying.'`.
- With a passcode set but no `sessionSecret`, it returns 503.
- In every other case it returns `null`.

- [ ] **Step 1: Write failing tests:**
  - `auth.test.ts`:
    - `signed token verifies until expiry and fails after`
    - `tampered signature fails`
    - `checkPasscode true/false and different lengths false`
    - `checkAccess`: the four rule branches above
  - `guard.test.ts`: one test per refusal in order, plus
    `passes and returns cfg and ip`. Reuse header patterns from
    `src/app/api/optimize/route.test.ts`.
  - `unlock/route.test.ts`:
    - `correct passcode sets HttpOnly SameSite=Strict cookie`
    - `wrong passcode 401`
    - `6th attempt in a minute 429`
    - `GET reports required/unlocked`
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/auth.test.ts src/lib/harness/guard.test.ts src/app/api/unlock`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
  for cookie handling in route handlers first.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): passcode gate and shared request guard`.

### Task 10: `/api/chat` route

**Files:**
- Create: `src/app/api/chat/route.ts`, `src/lib/harness/prompts.ts` (preamble part only), `src/lib/harness/schemas.ts`
- Test: `src/app/api/chat/route.test.ts`, `src/lib/harness/prompts.test.ts`

**Interfaces:**
- Consumes: `guardRequest`, `readJsonBody` (Task 9), `createVeniceAdapter`, `withRetry` (Task 3), `getModelCatalog` (Task 4), `parseMcpServers`, `loadMcpTools` (Task 6), `createToolRegistry` (Task 5), `runAgentLoop` (Task 8), `eventsToResponse` (Task 7).
- Produces:
  - `schemas.ts`: the zod schemas `llmMessageSchema`, `chatSettingsSchema`
    and `chatRequestSchema`, with
    `type ChatRequest = { model: string; messages: LlmMessage[]; settings: { reasoningEffort?: string; temperature?: number; webSearch: WebSearchMode; includeVeniceSystemPrompt: boolean; mcpServers: string[] } }`
  - `prompts.ts`: `harnessPreamble(opts: { now: Date; webSearch: WebSearchMode; toolNames: string[] }): string`
  - Route: `POST /api/chat`, with `runtime = 'nodejs'` and `maxDuration` (see
    Step 3).

**Rules:**
- The guard gets `{name:'chat', limit:20, windowMs:60_000, budgetUnits:1}`.
  The loop's `beforeStep` charges 1 budget unit for each step after the
  first.
- The body cap is 4,400,000 bytes.
- `model` must be in `cfg.models` (400 `'Unsupported model.'`).
- `messages` must have 1–2000 items, and the last one must be `user`. The
  system message is built here from the client's first `system` message (if
  any) plus `harnessPreamble`. Any other `system` messages from the client
  are refused (400).
- `reasoningEffort` must be in that model's `reasoningEffortOptions`, or it's
  dropped. `temperature` must be within 0–2. Image parts sent to a model
  without vision give 400 `'This model can’t read images.'`.
- The catalog is used for pricing. If it fails, the chat still runs with
  `pricing: null`.
- The request signal is passed as the loop's `signal`. The deadline is
  `now + (maxDuration − 8) s`.

- [ ] **Step 1: Write failing tests** in `route.test.ts`. Stub `fetch` to
  route `/models` to the catalog fixture and `/chat/completions` to SSE
  fixtures.
  - `streams text events for a valid request`: the content type is
    `text/event-stream`, and the event types include `text-delta` and
    `done`.
  - `refuses unsupported model 400`.
  - `refuses a client system message after the first 400`.
  - `refuses images for a non-vision model 400`. Use a fixture model with
    `supportsVision:false`.
  - `refuses body over 4.4MB 413`.
  - `upstream 402 streams an error event with friendly message and no upstream text`.
  - `system message = client system prompt + preamble`: check the captured
    upstream body.
  - `drops reasoningEffort not offered by the model`.
- [ ] **Step 2: Write failing tests** in `prompts.test.ts`:
  `harnessPreamble includes ISO date, mentions web search only when not off, lists tool names only when present`.
- [ ] **Step 3: Choose `maxDuration`.** Read
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
  and Vercel's current function limits, then set `maxDuration = 300`, or the
  plan's maximum if that's lower. Record the source in a comment.
- [ ] **Step 4: Run** `npx vitest run src/app/api/chat src/lib/harness/prompts.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run the tests again.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(harness): streaming /api/chat route`.

### Task 11: `/api/models`, `/api/tools`, `/api/title`, `/api/compact`

**Files:**
- Create: `src/app/api/{models,tools,title,compact}/route.ts`
- Modify: `src/lib/harness/prompts.ts` (add `TITLE_PROMPT`, `COMPACT_PROMPT`, `sanitizeTitle`)
- Test: one `route.test.ts` per route, plus `prompts.test.ts` additions

**Interfaces:**
- Produces:
  - `GET /api/models` returns
    `{ models: ModelInfo[]; defaultModel: string; utilityModel: string; compactAtTokens: number }`.
    Guard: `{name:'models', limit:60, budgetUnits:0}`.
  - `GET /api/tools` returns `{ servers: McpServerStatus[]; tools: { name: string; description: string }[] }`
    for every configured server. Guard: `budgetUnits:0`.
  - `POST /api/title` takes `{ userText: string; assistantText: string }`
    (each cut to 2000 characters on the server) and returns
    `{ title: string }`.
    - The guard uses `budgetUnits:1` and a limit of 20 per minute.
    - It's a non-streamed utility-model call with `maxTokens 30`,
      `temperature 0.3`, `webSearch 'off'` and `reasoningEffort` set to the
      lowest the model offers. It reuses `adapter.stream` and collects the
      text.
  - `POST /api/compact` takes `{ messages: LlmMessage[] }`, where only
    `user`/`assistant` with string content is allowed, and returns
    `{ summary: string }`.
    - The guard uses `budgetUnits:1` and a limit of 10 per minute.
    - It calls the utility model with `COMPACT_PROMPT` and `maxTokens 4000`.
  - `sanitizeTitle(raw: string): string | null` removes quotes, a trailing
    full stop and a `Title:` prefix, collapses whitespace, and keeps at most
    6 words and 60 characters. It returns null when empty.
  - `TITLE_PROMPT` and `COMPACT_PROMPT` are exact copy:
    - `TITLE_PROMPT = 'Write a title of at most 6 words for this conversation. Reply with the title only.'`
    - `COMPACT_PROMPT = 'Summarise the conversation so far for another assistant who will continue it. Keep: the user’s goals and preferences, decisions made, facts and numbers given, code or text the user will refer back to, and open questions. Use short headed sections. Do not add anything that was not said.'`

- [ ] **Step 1: Write failing tests:**
  - `models returns allowed models in order`, and
    `models 503 when VENICE_API_KEY missing`.
  - `tools lists status for configured servers and [] when none`.
  - `title returns sanitized title`, and `title 400 on missing userText`.
  - `compact returns summary`, and `compact 400 when a message has array content`.
  - `sanitizeTitle` table: `'"Hello World."'` gives `'Hello World'`,
    `'Title: A B C D E F G H'` gives `'A B C D E F'`, and `'   '` gives null.
- [ ] **Step 2: Run** `npx vitest run src/app/api src/lib/harness/prompts.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): models, tools, title and compact routes`.

### Task 12: Session format, projection, compaction selection

**Files:**
- Create: `src/lib/harness/session/format.ts`, `projection.ts`, `compaction.ts`
- Test: `projection.test.ts`, `compaction.test.ts`

**Interfaces:**
- Consumes: `LlmMessage`, `ContentPart`, `Citation`, `Usage`, `ToolResult`, `TurnFinish`.
- Produces, in `format.ts`:
  ```ts
  interface ChatSettings { model: string; systemPrompt: string; reasoningEffort: string | null; temperature: number | null; webSearch: WebSearchMode; includeVeniceSystemPrompt: boolean; mcpServers: string[] }
  interface Chat { id: string; title: string; titleSource: 'auto' | 'user' | 'fallback' | null; createdAt: number; updatedAt: number; settings: ChatSettings; totals: { inputTokens: number; outputTokens: number; costUsd: number } }
  interface AttachmentRef { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' }
  interface StoredAttachment extends AttachmentRef { dataUrl: string }
  interface AssistantStep { reasoning: string; text: string; citations: Citation[]; toolCalls: { id: string; name: string; args: string; result: ToolResult | null }[] }
  interface EventBase { id: string; chatId: string; ts: number; v: 1 }
  type SessionEvent = EventBase & (
    | { type: 'user-message'; text: string; attachments: AttachmentRef[] }
    | { type: 'assistant-message'; model: string; steps: AssistantStep[]; status: 'streaming' | 'complete' | 'interrupted' | 'error'; finishReason: TurnFinish | null; error: { message: string; status: number } | null; usage: Usage | null; costUsd: number | null }
    | { type: 'compaction'; summary: string; coversThroughEventId: string }
  )
  const ATTACHMENT_BUDGET_BYTES = 4_000_000
  const MAX_FILE_BYTES = 4 * 1024 * 1024
  ```
  - Decision: the title lives on `Chat` (with `titleSource`), not as a
    `title-set` event. It's the same information with one less projection
    rule.
- Produces, in `projection.ts`:
  - `estimateTokens(text: string): number`
  - `projectForModel(events: SessionEvent[], attachments: Map<string, StoredAttachment>, opts: { systemPrompt: string; supportsVision: boolean; budgetBytes?: number }): { messages: LlmMessage[]; evictedAttachmentIds: string[]; estimatedTokens: number; bytes: number; overBudget: boolean }`
- Produces, in `compaction.ts`:
  - `shouldCompact(p: { estimatedTokens: number; overBudget: boolean }, compactAtTokens: number): boolean`
  - `selectCompactionRange(events: SessionEvent[], keepLast?: number): { toSummarize: SessionEvent[]; throughEventId: string } | null`
    (`keepLast` defaults to 6)

**Projection rules:**
- The `system` message comes first if `systemPrompt` is non-empty.
- Only the **latest** `compaction` event applies. Events up to and including
  `coversThroughEventId` are replaced by one `user` message:
  `[Summary of earlier conversation]\n<summary>`.
- A user message becomes string content when it has no attachments.
  Otherwise it becomes parts:
  - text
  - `image_url` for images, with `data:` URLs
  - `file` for files
- An assistant message is projected as follows:
  - Each step with tool calls becomes an `assistant` message
    (`content` = step text or null, plus `tool_calls`), followed by `tool`
    messages from `result.content`. A null result becomes `'Cancelled'`.
  - The last step's text becomes a final `assistant` message.
  - `reasoning` is never sent.
  - An `error` or `interrupted` message with empty text is skipped.
- Images are replaced by the text part
  `[Image "<name>" can’t be read by this model]` when `!supportsVision`
  (Review Focus 3).
- Eviction: `bytes` is the UTF-8 length of `JSON.stringify(messages)`. While
  `bytes > budgetBytes`, the oldest attachment part is replaced by
  `[Attachment "<name>" was shared earlier and is no longer in context]`,
  recording its ID. The attachments in the **last** user message are never
  evicted. If they alone exceed the budget, `overBudget` is true (Review
  Focus 4).
- An attachment missing from the map (deleted) gets the same eviction
  placeholder.

**Compaction selection rules:**
- Count "messages" as user-message and assistant-message events after the
  latest compaction.
- Return null when there are 6 or fewer.
- `toSummarize` is everything after the last compaction except the last 6
  messages. When a previous compaction exists, its summary event is included
  first, so summaries chain.

- [ ] **Step 1: Write failing tests** in `projection.test.ts`. Use a small
  `makeEvents` helper in the test file.
  - `plain chat projects to system, user, assistant strings`.
  - `tool steps project to assistant tool_calls + tool messages in order`.
  - `reasoning is not sent`.
  - `empty interrupted assistant message is skipped; non-empty kept`.
  - `latest compaction replaces covered events with summary message`.
  - `images become placeholder text when supportsVision is false`.
  - `oldest attachments evicted first until under budget; ids reported`.
  - `last user message attachments never evicted; overBudget true when they alone exceed`.
  - `missing attachment data becomes eviction placeholder`.
  - `estimatedTokens = ceil(total text chars / 4)`.
- [ ] **Step 2: Write failing tests** in `compaction.test.ts`:
  - `shouldCompact true over threshold or overBudget`.
  - `selectCompactionRange returns null with ≤6 messages`.
  - `keeps last 6 messages and covers through the event before them`.
  - `chains: previous compaction summary included first`.
- [ ] **Step 3: Run** `npx vitest run src/lib/harness/session`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(harness): session format, projection and compaction selection`.

### Task 13: Session store (memory and IndexedDB)

**Files:**
- Create: `src/lib/harness/session/store.ts`, `src/lib/harness/session/indexeddb.ts`
- Test: `src/lib/harness/session/store.contract.ts` (shared cases), `store.test.ts`, `indexeddb.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SessionStore {
    listChats(): Promise<Chat[]>            // newest updatedAt first
    getChat(id: string): Promise<Chat | null>
    putChat(chat: Chat): Promise<void>
    deleteChat(id: string): Promise<void>   // also deletes its events and attachments
    listEvents(chatId: string): Promise<SessionEvent[]>   // ts ascending, then insertion order
    putEvent(event: SessionEvent): Promise<void>          // insert or replace by id
    deleteEventsAfter(chatId: string, eventId: string): Promise<void>  // removes events strictly after it
    putAttachment(chatId: string, a: StoredAttachment): Promise<void>
    getAttachments(chatId: string): Promise<Map<string, StoredAttachment>>
  }
  createMemoryStore(): SessionStore
  createIndexedDbStore(opts?: { dbName?: string; indexedDB?: IDBFactory }): SessionStore
  ```
- The IndexedDB layout is DB `harness`, version 1, with three object stores:
  - `chats` (key `id`)
  - `events` (key `id`, index `byChat` on `[chatId, ts]`)
  - `attachments` (key `id`, index `byChat` on `chatId`)

  The wrapper is in-repo, with no IDB library.

- [ ] **Step 1: Write the contract** `runStoreContract(name: string, make: () => SessionStore)` with these cases:
  - `put/get/list chats ordered by updatedAt desc`
  - `putEvent replaces by id`
  - `listEvents ordered by ts`
  - `deleteEventsAfter removes later events only`
  - `deleteChat cascades`
  - `attachments round-trip`
- [ ] **Step 2: Write test files.** `store.test.ts` runs the contract on
  `createMemoryStore`. `indexeddb.test.ts` runs it on
  `createIndexedDbStore({ indexedDB: new IDBFactory(), dbName: crypto.randomUUID() })`
  from `fake-indexeddb`.
- [ ] **Step 3: Run** `npx vitest run src/lib/harness/session/store.test.ts src/lib/harness/session/indexeddb.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** both stores.
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(harness): session store (memory + IndexedDB)`.

### Task 14: Chat controller (client turn orchestration)

**Files:**
- Create: `src/lib/harness/client/controller.ts`, `src/lib/harness/client/use-chat.ts`
- Test: `src/lib/harness/client/controller.test.ts`

**Interfaces:**
- Consumes: `SessionStore` (Task 13), `projectForModel`, `shouldCompact`, `selectCompactionRange` (Task 12), `readHarnessStream` (Task 7), `ModelInfo` (Task 4), `ChatRequest` (Task 10).
- Produces:
  ```ts
  interface ControllerState { chats: Chat[]; activeChatId: string | null; events: SessionEvent[]; attachments: Map<string, StoredAttachment>; streaming: boolean; compacting: boolean; models: ModelInfo[]; notice: string | null }
  interface ChatController {
    getState(): ControllerState; subscribe(fn: () => void): () => void
    init(): Promise<void>   // loads /api/models + chats; marks any 'streaming' assistant events as 'interrupted'
    newChat(settings?: Partial<ChatSettings>): Promise<string>
    openChat(id: string): Promise<void>
    renameChat(id: string, title: string): Promise<void>
    deleteChat(id: string): Promise<void>
    updateSettings(id: string, patch: Partial<ChatSettings>): Promise<void>
    send(text: string, files: File[]): Promise<void>
    stop(): void
    regenerate(): Promise<void>                    // deletes the last assistant event, re-sends
    editLastUserMessage(text: string): Promise<void>  // replaces text, deletes after, re-sends
    compactNow(): Promise<void>
  }
  createChatController(deps: { store: SessionStore; fetchImpl?: typeof fetch; now?: () => number; newId?: () => string; flushMs?: number; readFile?: (f: File) => Promise<string> }): ChatController
  useChatController(): ChatController   // singleton per tab over createIndexedDbStore()
  useControllerState<T>(select: (s: ControllerState) => T): T   // useSyncExternalStore
  ```

**`send` rules:**
- Validation comes first. `send` does nothing while `streaming`. Each file
  must be ≤ `MAX_FILE_BYTES`, and its MIME type must be an image type
  (png, jpeg, webp, gif) or one of Venice's file types (pdf, docx, pptx,
  xlsx, xls, csv, txt, md, json, common code types by extension). Otherwise
  `notice` is set and nothing is stored (Review Focus 4).
- It stores the attachments and the `user-message` event, then projects.
  - If `overBudget`, it deletes the event and attachments it just wrote and
    sets
    `notice = 'This message is over the 4 MB limit per request. Remove an attachment or shorten it.'`
  - If `shouldCompact`, it runs `compactNow()` first and projects again.
- It creates an `assistant-message` event with `status 'streaming'` and
  POSTs `/api/chat` with an `AbortController`.
- As events arrive, it applies them to the steps:
  - `step-start` pushes a new step
  - deltas append
  - `tool-call` and `tool-result` fill `toolCalls`
- It persists with `putEvent` at most every `flushMs` (500) and on finish.
- Finishing:
  - `done` gives status `'complete'`, or `'interrupted'` when aborted.
  - `error` gives `'error'` with the message.
  - A non-OK HTTP response's `{error}` JSON gives `'error'` (Review Focus 2).
- After the first complete assistant reply of a chat with
  `titleSource === null`, it POSTs `/api/title`. On failure it uses
  `fallbackTitle(text)`, the first 40 characters at a word boundary with `…`.
- It adds usage to `chat.totals`.

**`compactNow`:** runs `selectCompactionRange`, POSTs `/api/compact` with
the text-only projection of `toSummarize`, then stores the `compaction`
event. On failure it sets `notice` and continues without compacting.

**`init`:** any assistant event still marked `streaming` (from a reload) is
re-saved as `interrupted` (Review Focus 1).

**`newChat` defaults:** the settings are `{ ...loadDefaults(), ...settings }`.
- `loadDefaults()` reads `localStorage['harness.defaults']` with try/catch.
  Its fallback is `{ model: defaultModel, systemPrompt: '', reasoningEffort: null, temperature: null, webSearch: 'off', includeVeniceSystemPrompt: false, mcpServers: [] }`.
- A stored model that's no longer in `models` falls back to `defaultModel`.
- `saveDefaults(s: ChatSettings): void` is exported for the settings sheet's
  "Use for new chats" button (Task 17).

Add a test: `newChat uses stored defaults and falls back when the stored model is gone`.

- [ ] **Step 1: Write failing tests.** Use `createMemoryStore` and a fake
  `fetchImpl` that serves `/api/models`, `/api/chat` (SSE built with
  `encodeEvent`), `/api/title` and `/api/compact`.
  - `send streams into an assistant event and completes`: the final event
    has `status 'complete'`, the text is joined, and the totals are updated.
  - `persists partial text during streaming (flushMs) so reload keeps it`.
  - `init marks leftover streaming events as interrupted`.
  - `stop aborts and marks interrupted`.
  - `server error event marks assistant message error and keeps user message`.
  - `HTTP 401 JSON error marks error with its message`.
  - `refuses oversize file with notice and writes nothing`.
  - `refuses send while streaming`.
  - `first complete reply sets auto title; title failure uses fallback`.
  - `compacts before sending when over compactAtTokens` (lower
    `compactAtTokens` via the `/api/models` response).
  - `regenerate replaces last assistant message`.
  - `editLastUserMessage replaces text and drops later events`.
  - `deleteChat removes it and opens the next most recent`.
- [ ] **Step 2: Run** `npx vitest run src/lib/harness/client`. Expected: FAIL.
- [ ] **Step 3: Implement** the controller, then the hooks. The default
  `readFile` uses `FileReader.readAsDataURL`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(harness): client chat controller`.

### Task 15: be-promptful theme and app frame

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/components/ui/sheet.tsx`, `src/components/ui/sonner.tsx`

**Interfaces:**
- Produces, as CSS utilities and tokens available to all components:
  - tokens `--text-1/2/3`, `--card`, `--card-inner`, `--btn`, `--track`, `--ring-subtle`, `--highlight`, `--shadow-soft`
  - `@theme` colours `text-1/2/3`, `inner`, `btn`, `track`, `surface`, `surface-raised`
  - radii `card` (20px), `row` (12px), `chip` (10px)
  - utilities `surface-card`, `surface-inner`, `type-greeting`, `type-title`, `type-section`, `type-label`, `scrollbar-hide`, `text-balance`
  - the touch-input 16px rule
- Produces:
  - `Sheet`, `SheetContent({side: 'left' | 'right'})`, `SheetTitle`, built on `@radix-ui/react-dialog`
  - `Toaster`, styled exactly as in be-promptful `components/app-shell.tsx`

- [ ] **Step 1: Copy the tokens.** Copy the `:root` tokens, the extra
  `@theme` entries and the utilities verbatim from
  `/home/user/be-promptful/app/globals.css` (lines 1–140) into
  `src/app/globals.css`.
  - Keep the existing tokens.
  - Keep the `module-glow`, `shimmer` and `typing-dots` styles.
  - Keep the `tw-animate-css` import.
  - Don't copy the landing `@source not` line.
- [ ] **Step 2: Update the layout.**
  - `layout.tsx`: metadata title `'Harness'`, description
    `'A private chat harness for Venice models.'`
  - Mount `<Toaster />`.
  - `body` gets `h-dvh overflow-hidden`.
- [ ] **Step 3: Build Sheet and Toaster,** mirroring be-promptful's
  `components/ui/sheet.tsx` and `sonner.tsx` (read them first).
- [ ] **Step 4: Verify.** `npm run lint && npm run typecheck && npm test`
  all pass. `npm run dev` renders the existing optimizer page with no CSS
  errors.
- [ ] **Step 5: Commit** `feat(ui): be-promptful theme tokens, sheet and toaster`.

### Task 16: Message rendering

**Files:**
- Create: `src/lib/harness/citations.ts`, `src/components/chat/{markdown,thinking-block,sources,usage-badge,user-message,assistant-message,message-list}.tsx`
- Test: `src/lib/harness/citations.test.ts`, `src/components/chat/assistant-message.test.tsx`

**Interfaces:**
- Consumes: `SessionEvent`, `AssistantStep`, `Citation`, `copyToClipboard` (`src/lib/clipboard.ts`).
- Produces:
  - `linkCitations(text: string, citations: Citation[]): string`. It
    rewrites `^n^` and `^n,m^` into markdown links
    `[<sup>n</sup>](url)`, one per index, for indices 1..citations.length.
    Out-of-range indices are left as plain `^n^`. Code spans and fenced
    blocks are untouched.
  - `<Markdown text={string} />`: react-markdown with remark-gfm,
    remark-breaks and rehype-highlight. Links open in a new tab with
    `rel="noopener noreferrer"`. No raw HTML: `sup` is allowed only through
    the `components` map, `skipHtml` is set, and `linkCitations` output is
    rendered via a custom `a` that renders `<sup>` children. Code blocks get
    a copy button.
  - `<ThinkingBlock text={string} streaming={boolean} />`: collapsed by
    default, labelled `Thinking` while streaming and `Thought for a moment`
    when done.
  - `<Sources citations={Citation[]} />`: a numbered chip row of hostnames.
  - `<UsageBadge usage={Usage | null} costUsd={number | null} />`, shown as
    `1.2k in · 340 out · $0.0012`.
  - `<UserMessage event />`: a `surface-inner` bubble with attachment chips.
    Evicted IDs show an "out of context" tag.
  - `<AssistantMessage event onRetry />`: per step it shows thinking, tool
    call rows (name, args collapsed, result collapsed, error in destructive
    colour), then markdown. Then sources, a usage badge, a copy action, and
    status lines:
    - interrupted: `Stopped.`
    - error: the message plus a `Retry` button
    - max-steps: `Stopped after 8 tool steps.`
  - `<MessageList events evictedIds streaming onRetry />`: auto-scrolls to
    the bottom while the user is at the bottom. Compaction events render as
    a divider: `Earlier messages summarised for the model`.

- [ ] **Step 1: Write failing tests** in `citations.test.ts`:
  - `^1^` becomes a link to `citations[0].url`
  - `^1,2^` becomes two links
  - `^5^` with 2 citations stays as is
  - text in backticks is untouched
- [ ] **Step 2: Write failing tests** in `assistant-message.test.tsx` (jsdom):
  - `renders markdown and a highlighted code block with a copy button`
  - `thinking is collapsed by default and expands on click`
  - `citation carets become links to sources`
  - `error status shows message and Retry calls onRetry`
  - `raw HTML in model text is not rendered as elements` (`<img src=x onerror>` doesn't create an `img`)
- [ ] **Step 3: Run** `npx vitest run src/lib/harness/citations.test.ts src/components/chat`. Expected: FAIL.
- [ ] **Step 4: Implement.** Styles use the Task 15 utilities: mint
  `primary` for links and focus, `text-2` for meta, `surface-card` for tool
  rows.
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(ui): message rendering`.

### Task 17: Composer, model picker, settings sheet

**Files:**
- Create: `src/components/chat/{composer,model-picker,settings-sheet}.tsx`
- Test: `src/components/chat/composer.test.tsx`

**Interfaces:**
- Consumes: `ChatController` / `useControllerState` (Task 14), `ModelInfo`, `MAX_FILE_BYTES`, `Sheet` (Task 15), the existing `Select` and `Button`.
- Produces:
  - `<Composer onSend(text, files) onStop streaming supportsVision webSearch onWebSearchChange />`. It shows:
    - an auto-growing textarea, where Enter sends and Shift+Enter adds a
      new line
    - a 📎 file input
    - attachment chips with remove
    - a web-search toggle that cycles `off → auto → on`, with a globe icon
      and label
    - send, which becomes stop while streaming
    - drag and drop and paste for files

    It refuses locally: a file over 4 MB gives the inline error
    `"<name>" is over 4 MB.`, and an image with `!supportsVision` gives
    `This model can’t read images.`. The surface is `surface-card` with the
    existing `module-glow` on focus.
  - `<ModelPicker models value onChange />`: shows the name, plus small
    capability icons (vision, tools, web) and the input/output price per 1M.
  - `<SettingsSheet chatId />`, a right sheet with:
    - system prompt textarea
    - reasoning effort (only `model.reasoningEffortOptions`, hidden if empty)
    - temperature (slider 0–2, with a "default" option = null)
    - Venice system prompt toggle
    - MCP servers (from `GET /api/tools`, with status dots, toggled per chat)
    - presets: save the current settings as a named preset, and apply or
      delete presets, kept in `localStorage['harness.presets']` with
      try/catch
    - a "Use for new chats" button (calls `saveDefaults`)
    - a "Compact now" button
    - a Venice balance readout (from the last `meta` event, if any)

- [ ] **Step 1: Write failing tests** in `composer.test.tsx` (jsdom):
  - `Enter sends trimmed text and clears; Shift+Enter inserts newline`
  - `send disabled for empty text and no files`
  - `oversize file shows inline error and is not attached`
  - `image refused when supportsVision false`
  - `while streaming the send button is a Stop button calling onStop`
  - `web search toggle cycles off→auto→on`
- [ ] **Step 2: Run** `npx vitest run src/components/chat/composer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** all three components.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): composer, model picker, settings`.

### Task 18: Sidebar, chat view, unlock screen, page

**Files:**
- Create: `src/components/chat/{sidebar,chat-view,unlock-screen,harness-app}.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/components/chat/sidebar.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 14–17, plus `GET /api/unlock`.
- Produces:
  - `<Sidebar />`: `+ New chat`, a search box (filters titles,
    case-insensitive), chats grouped `Today / Yesterday / Previous 7 days /
    Older` by `updatedAt`, rename (inline) and delete (confirm) per row, and
    a settings button at the bottom. At `md` and wider it's a fixed 260 px
    column. Below `md` it's a left `Sheet`, opened from a header menu button.
  - `<ChatView />`: a header with the title, `ModelPicker`, the chat total
    `$` and a settings button; a `MessageList`; and a `Composer` pinned at the
    bottom with `pb-[env(safe-area-inset-bottom)]`. The empty state shows the
    `type-greeting` line `What are we working on?` with the model name
    underneath. `notice` from the controller appears as a sonner toast.
  - `<UnlockScreen onUnlocked />`: a `surface-card` holding a passcode field
    and a mint primary button. It POSTs `/api/unlock`, and on 401 shows
    `That passcode isn’t right.`
  - `<HarnessApp />` (client): checks `GET /api/unlock`, then renders
    `UnlockScreen` or `Sidebar + ChatView`, and calls `controller.init()`.
  - `page.tsx` renders `<HarnessApp />`.

- [ ] **Step 1: Write failing tests** in `sidebar.test.tsx` (jsdom):
  - `groups chats by date bucket` (fixed `now`)
  - `search filters by title`
  - `delete asks for confirmation before calling controller.deleteChat`
- [ ] **Step 2: Run** `npx vitest run src/components/chat/sidebar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire `page.tsx`.
- [ ] **Step 4: Run the tests again.** Expected: PASS. Then
  `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(ui): sidebar, chat view, unlock, page`.

### Task 19: Remove the optimizer; docs and env

**Files:**
- Delete:
  - `src/lib/optimizer/`, `src/components/optimizer/`, `src/app/api/optimize/`
  - `src/lib/openrouter.ts`, `src/lib/openrouter.test.ts`
  - `public/platforms/`, `public/{next,vercel,globe,window,file}.svg`
- Modify:
  - `package.json` (`npm uninstall diff`, rename `name` to `"venice-harness"`)
  - `.env.example`, rewritten with every variable in design §8 and a comment each, in the existing style
  - `README.md`, rewritten: what it is, run locally, env, deploy to Vercel (set env vars in Project Settings, set `HARNESS_PASSCODE` + `HARNESS_SESSION_SECRET`), the architecture table (design §5), known gaps (per-process rate limits, no accounts or DB yet)
  - `next.config.ts` (drop the `images.unoptimized` comment about platform marks, and keep the headers)

- [ ] **Step 1: Delete and uninstall** as listed. Search with
  `grep -rn "optimizer\|openrouter\|OPENROUTER" src` and expect no matches.
- [ ] **Step 2: Rewrite** `.env.example` and `README.md`.
- [ ] **Step 3: Verify.** `npm run lint && npm run typecheck && npm test && npm run build`
  all pass, and `npm audit --omit=dev --audit-level=high` exits 0.
- [ ] **Step 4: Commit** `chore: remove the optimizer; document the harness`.

### Task 20: Live smoke test against Venice

**Files:**
- Possibly modify: `src/lib/harness/llm/__fixtures__/*.json`, if real chunks differ.

- [ ] **Step 1: Get the owner's Venice key** into this environment, via the
  secure credential form for host `api.venice.ai`. Locally the owner puts
  `VENICE_API_KEY` in `.env.local`.
- [ ] **Step 2: Capture one real stream per fixture type** (text, tools,
  search) with `curl -N`. If any shape differs from the Task 3 fixtures
  (citation location, usage fields, balance header name), update the
  fixtures and adapter, and re-run `npx vitest run src/lib/harness/llm`.
- [ ] **Step 3: Run the app** with `npm run dev`. Drive it with Playwright
  at `http://localhost:3000` and check each of these:
  - a streamed reply on each default model
  - Thinking appears and collapses
  - web search `on` shows Sources and linked carets
  - a PDF attachment is answered from its contents
  - an image is described
  - a title appears after the first reply
  - with `COMPACT_AT_TOKENS=2000`, the compaction divider appears and the
    chat continues
  - reloading mid-stream keeps the partial reply as `Stopped.`
  - with `HARNESS_PASSCODE` set, the unlock screen gates the API

  Take a screenshot of the main screen at deviceScaleFactor 2 for the owner.
- [ ] **Step 4: Run the full checks** `npm run lint && npm run typecheck && npm test && npm run build`. All must pass.
- [ ] **Step 5: Commit** any fixture or adapter fixes:
  `test(harness): fixtures from live Venice streams`. Then push and update
  PR #5's description.
