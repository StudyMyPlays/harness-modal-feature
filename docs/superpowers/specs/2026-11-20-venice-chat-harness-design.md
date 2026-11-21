# Venice Chat Harness: Design

Status: draft for approval · 2026-11-20 · repo `harness-modal-feature`

## 1. Intent

Turn this repo, currently a single-page prompt optimizer, into a **chat harness
with a ChatGPT-style interface**:

- It talks to **Venice AI** so the owner can use uncensored models, starting
  with DeepSeek V4.1 Flash 1017 Uncensored and GLM 5.3 Flash Uncensored.
- It **runs locally first** (`npm run dev`) and later **deploys to Vercel**
  without restructuring.
- It takes its **architecture** from `deepseek-ai/deepseek-harness`: a model
  adapter, an agent loop, a tool registry, a session log with projection,
  persistence behind an interface, compaction, titles and a token meter. The
  parts that need a machine that stays on are left out.
- It takes its **look** from `StudyMyPlays/be-promptful`.

A database comes later. The persistence layer is shaped so that adding one
means swapping one implementation, not rewriting the app.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**

1. Chat UI: a sidebar of chats (new, rename, delete, search), streaming
   replies, Markdown with code highlighting and copy buttons, stop and
   regenerate, and edit-and-resend of the last user message.
2. A model picker over a server-side allow-list, defaulting to the two models
   above.
3. Reasoning shown in a collapsible "Thinking" block, plus a reasoning-effort
   control where the model supports it.
4. **All mandatory harness core pieces**: model adapter, agent loop, tool
   registry and executor, session log and projection, system prompt and
   presets, persistence interface, and retry.
5. **All optional pieces**:
   - LLM chat titles
   - compaction
   - web search (with citations)
   - file and image attachments
   - token and cost meter
   - MCP client (remote HTTP servers only)
6. Works with no setup beyond `VENICE_API_KEY` in `.env.local`.
7. Safe to put on a public Vercel URL: the Venice key never reaches the
   browser, a passcode gate is available, and the existing rate limits and
   budget are kept.

**Non-goals (v1)**

- User accounts and a server-side database. Chats live in the browser.
- Anything that needs a lasting machine: shell, terminals, filesystem tools,
  sandboxes, background jobs, subagents and teams, scheduling, stdio MCP
  servers.
- Image, audio or video generation.
- Mobile apps.

**Anti-goals (a failure even if it technically works)**

- The Venice key, or Venice's raw error text, reaching the browser.
- A public deployment that anyone can use to spend the owner's Venice credit.
- Losing a chat because a tab reloaded mid-stream. Partial replies are saved
  as they arrive.
- Hard-coding things that change often (model list, prices) where Venice's
  `/models` endpoint can provide them.
- Copying DeepSeek Harness's plugin runtime (Cordis), which doesn't fit Next.js
  on Vercel.

## 3. Constraints and verified facts

**Venice API** (checked 2026-11-20 against `GET /api/v1/models` and
docs.venice.ai):

- OpenAI-compatible chat completions at `https://api.venice.ai/api/v1/chat/completions`,
  authenticated with `Authorization: Bearer <key>`. Streaming is OpenAI-style SSE.
- Model IDs:
  - `deepseek-v4-1-flash-1017-uncensored`: 1M context, 131k max output,
    tools, vision (up to 10 images), reasoning effort `none|low|high|max`,
    web search, and Venice's own `default` trait. $0.33 / $1.32 per M
    input/output tokens.
  - `glm-5-3-flash-uncensored`: 1,048,576 context, 131k max output, tools,
    vision, reasoning effort `low|high|max`, web search. $0.165 / $0.55 per M.
  - Venice lists no non-Flash "GLM 5.3 uncensored". The Flash variant is the
    uncensored one.
- Reasoning arrives in a separate `reasoning_content` field, both in messages
  and in stream deltas.
- `venice_parameters` include:
  - `enable_web_search: off|on|auto`
  - `enable_web_citations` (citations rendered as `^1^` carets)
  - `include_search_results_in_stream` (experimental: results arrive as the
    first chunk)
  - `include_venice_system_prompt` (default `true`, which appends Venice's
    own system prompt to ours)
  - `strip_thinking_response`
- File inputs: a `type: "file"` content block with a base64 data URL. Venice
  extracts PDF, DOCX, PPTX, XLSX, CSV, text and code files to text itself,
  up to 25 MB per file. **No PDF parsing package is needed.**
- Response headers include rate-limit state (`x-ratelimit-*`) and the account
  balance.
- Venice's docs say to read model IDs from `/models` at runtime instead of
  hard-coding them, because models are added and retired often.

**Vercel**

- Route handlers run as functions with no lasting disk or shell. Each chat
  turn is one stateless request.
- The request body limit is about 4.5 MB. This bounds history plus
  attachments per request (see §6.6).
- Function duration is set with `maxDuration`. The builder confirms the
  current limit for the owner's plan and sets it at or below that.
- Streaming responses are supported.

**Repo**

- Next.js 16.4 (App Router), React 19.2, Tailwind 4, Vitest. AGENTS.md says
  this Next version has breaking changes: **read
  `node_modules/next/dist/docs/` before writing route handlers or config.**
- Reusable as they are:
  - `rate-limit.ts` (token buckets, daily budget, trusted-IP logic including
    `x-vercel-forwarded-for`)
  - `api-response.ts`
  - the cross-site check and limited body reader in
    `src/app/api/optimize/route.ts`
  - the security headers in `next.config.ts`
  - CI (`.github/workflows/ci.yml`)
- The theme tokens in `globals.css` already match be-promptful's base palette.

## 4. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Plain chat**: a chat UI over Venice with no tool loop | Smallest build, but not a harness, and adding tools later means reworking the request flow | Rejected by owner |
| **B. Chat plus tools that work on Vercel**: a stateless agent loop per request, Venice built-in web search, attachments, an MCP tool slot, and the DeepSeek-style core rebuilt in Next.js | Fits Vercel exactly, and the core seams (adapter, persistence, tools) let the DB and new tools slot in later | **Chosen by owner** |
| **C. Full agent**: shell, file edits, background jobs like DeepSeek Harness | Needs a machine that stays on or an external sandbox service, and doesn't fit Vercel functions | Rejected: not Vercel-hostable as asked |

Within B there was one more choice, made by me: **write the Venice adapter and
agent loop by hand instead of using the Vercel AI SDK.** Reasons:

- It mirrors DeepSeek Harness's own seams (`llm` adapter, `agent-loop`), which
  is what the owner asked to copy.
- It keeps Venice-specific fields (`reasoning_content`, `venice_parameters`,
  balance headers) first-class instead of passing them through
  provider-option escape hatches.
- It extends the existing, tested `openrouter.ts` client pattern.

The cost is writing an SSE parser and a tool-call accumulator, about 200 lines
with tests.

## 5. Mapping from DeepSeek Harness

| DeepSeek package | Here | Notes |
|---|---|---|
| `core/agent-loop`, `core/agent` | `src/lib/harness/agent-loop.ts` | One *turn* = up to N *steps*. Each step is one model request plus its tool calls |
| `llm/llm` | `src/lib/harness/llm/types.ts` | Adapter interface: `stream(request) → AsyncIterable<LlmEvent>` |
| `llm/llm-deepseek` | `src/lib/harness/llm/venice.ts` | The only adapter in v1 |
| `llm/llm-retry` | `src/lib/harness/llm/retry.ts` | Retries 429 and 5xx with backoff, before the first token only |
| `llm/token-meter` | `src/lib/harness/usage.ts` + UI | Usage from `stream_options.include_usage`, prices from `/models` |
| `core/session`, `session/session-format` | `src/lib/harness/session/format.ts` | Append-only event log per chat |
| `session/session-projection` | `src/lib/harness/session/projection.ts` | Event log → model messages, respecting compaction |
| `session/session-persistence` | `src/lib/harness/session/store.ts` | `SessionStore` interface. v1 uses `IndexedDbSessionStore` |
| `session/session-title-llm` | `src/app/api/title/route.ts` | Cheap call after the first exchange |
| `core/system-prompt` | `src/lib/harness/system-prompt.ts` | User system prompt and presets, plus a small harness preamble (date, enabled tools) |
| `core/tools`, `core/tool-executor-native` | `src/lib/harness/tools/registry.ts`, `executor.ts` | A registry of tool definitions, with timeouts and size caps |
| `compaction/compaction-basic` | `src/lib/harness/compaction.ts` + `src/app/api/compact/route.ts` | Summarises old turns into a compaction event |
| `web/web-search-*` | Venice `enable_web_search` | A setting, not our own tool |
| `attachment` | Composer, plus `file` and `image_url` content blocks | Data URLs, kept per message in IndexedDB |
| `mcp/mcp-client` | `src/lib/harness/tools/mcp.ts` | Remote Streamable-HTTP servers from server config |

## 6. Design

### 6.1 Request flow

```
Browser (IndexedDB session log)
  │ POST /api/chat  { model, messages(projected), settings }
  ▼
Route handler (nodejs runtime, streaming)
  passcode → cross-site → size → validate → rate limit → budget
  ▼
agentLoop(adapter=venice, tools=registry)
  step: venice.stream() ──► SSE events to browser
        tool_calls? ─► executor (MCP) ─► append results ─► next step
  ends: final text, max steps, abort, or error
  ▼
Browser appends each event to the session log as it arrives
```

**The server is stateless.** The browser owns the session log and sends the
projected history each turn. With a database later, the route will load
history by chat ID instead. That is the one seam that changes.

### 6.2 Stream protocol (server → browser)

The response is `text/event-stream` of our own typed events, never Venice's
raw chunks:

- `step-start`
- `reasoning-delta {text}`
- `text-delta {text}`
- `search-results {results[]}`
- `tool-call {id, name, args}`
- `tool-result {id, ok, content (truncated)}`
- `usage {input, output, cachedInput, costUsd}`
- `step-end`
- `done {finishReason}`
- `error {message, status}`

Error messages pass through the existing `upstreamMessage` mapping, so
Venice's text never reaches the browser. The client aborts with
`AbortController`, and the server forwards the abort to Venice.

### 6.3 Session format and persistence

- `Chat { id, title, createdAt, updatedAt, model, settings }`
- `SessionEvent`: a union of
  - `user-message` (text and attachment refs)
  - `assistant-message` (text, reasoning, citations, tool calls,
    finishReason, usage)
  - `tool-result`
  - `compaction` (summary, covers up-to-event-id)
  - `title-set`
- Each event carries `id`, `chatId`, `ts` and `v: 1`, the format version, so
  a migration chain can be added later the way DeepSeek does it.
- `SessionStore` interface:
  - `listChats`, `getChat`, `putChat`, `deleteChat`
  - `appendEvent`, `updateEvent` (for a streaming assistant message)
  - `listEvents(chatId)`
  - `putAttachment`, `getAttachment`
- v1 implementation: IndexedDB, written as a small in-repo wrapper with no
  dependency.
- Streaming assistant text is written throttled (about every 500 ms) and on
  completion, so a reload keeps the partial reply, marked "interrupted".

### 6.4 Agent loop

- Max steps per turn: 8. If it's hit, the last step ends with
  `finishReason: 'max-steps'`, and the UI says so.
- Each tool call has a 20 s timeout, and its result is capped at 16k
  characters, marked as truncated.
- Malformed tool-call JSON goes back to the model as a tool error, not a crash.
- A deadline sits inside `maxDuration`, so the route can finish with an
  `error` event instead of being killed.
- Retry, from `llm/retry`, applies only before the first streamed byte of a
  step.

### 6.5 Tools

- The registry merges built-in tools (v1 ships none beyond what MCP provides)
  with MCP tools.
- Web search isn't a registry tool. It's Venice's `enable_web_search`. The UI
  offers a toggle with off, on and auto. Citations are on whenever search is
  on: `^n^` carets become superscript links, and search results show in a
  "Sources" row.
- **MCP:**
  - Servers are listed server-side in env `MCP_SERVERS`, as a JSON array of
    `{name, url, headers?}`. Secrets in headers stay on the server.
  - Only Streamable HTTP is supported. stdio is impossible on Vercel.
  - Tool lists are cached per process for 5 minutes.
  - Tools are exposed as `mcp__<server>__<tool>`.
  - The settings panel shows which servers and tools are available, and lets
    the user switch servers on or off per chat.
  - No MCP servers are configured by default.

### 6.6 Attachments and the request size limit

- Images (png, jpg, webp, gif) are sent as `image_url` data URLs, only to
  models whose `/models` entry has `supportsVision`. Documents in Venice's
  supported file types are sent as `file` blocks.
- Limits per file: 2.9 MB raw, for images and documents. Files travel base64-encoded (4 bytes per 3), so a larger file could never fit the 4 MB request budget. (Changed from 4 MB after review.)
- **Per-request budget: 4 MB.** This comes from Vercel's 4.5 MB body limit
  less JSON overhead. When history plus attachments would exceed it, the
  oldest attachments in the projection are replaced with
  `[Attachment "<name>" was shared earlier and is no longer in context]`, and
  the UI marks them "out of context". If the new message alone is over
  budget, the composer refuses it before sending.
- Attachments are stored in IndexedDB, separately from events, so the chat
  list stays fast.

### 6.7 Compaction

- **Trigger:** the projected history's estimated tokens (characters ÷ 4)
  exceed `COMPACT_AT_TOKENS` (default 150k, set by env), or the request body
  would exceed the 4 MB budget even after dropping attachments.
- **Action:** the client calls `POST /api/compact` with the older turns,
  keeping the last 6 messages verbatim. A cheap model
  (`glm-5-3-flash-uncensored` by default, set by env) writes a structured
  summary. The client stores a `compaction` event.
- Projection then sends the summary in place of the covered events. The UI
  still shows every original message, with a divider: "Earlier messages
  summarised for the model".
- There's also a manual "Compact now" action.

### 6.8 Titles

After the first assistant reply finishes, the client calls `POST /api/title`
with the first user message and the start of the reply. A cheap model returns
a title of 6 words or fewer. The title appears in the sidebar and can be
renamed. If the call fails, the first 40 characters of the user message are
used.

### 6.9 Token and cost meter

- Requests send `stream_options: { include_usage: true }`.
- Each assistant message shows input and output tokens, plus cost from
  `/models` pricing, including the cached-input price.
- Each chat shows its running total in the header.
- `GET /api/models` returns the allow-listed models with name, context size,
  capabilities and prices, cached on the server for 10 minutes.
- If Venice sends a balance header, a small "Venice balance" readout appears
  in settings.

### 6.10 System prompt and presets

- Settings per chat:
  - system prompt
  - model
  - reasoning effort (only the options the model lists)
  - web search mode
  - temperature
  - MCP servers on or off
- Global defaults live in browser storage. Saved presets are name plus
  system prompt plus settings.
- `include_venice_system_prompt` defaults to **false**, so the user's own
  system prompt is the only one, with a toggle to turn Venice's back on.
- The harness adds a short preamble: the current date, plus a note that web
  search or tools are available when enabled.

### 6.11 Security and abuse controls

- `VENICE_API_KEY` is read only on the server.
- **Passcode gate:**
  - With `HARNESS_PASSCODE` set, every `/api/*` route needs a signed,
    HttpOnly session cookie, obtained from `POST /api/unlock` (checked with
    a constant-time compare).
  - The UI shows an unlock screen.
  - In production with no passcode, the API refuses requests (503) unless
    `HARNESS_PUBLIC=1` is set explicitly. This is a placeholder until
    accounts exist.
- The existing limits are kept and re-keyed:
  - 20 requests per minute per IP for chat
  - a daily upstream-call budget (`HARNESS_DAILY_CALL_BUDGET`)
  - the cross-site refusal
  - limited body reading
  - field-by-field validation
- Model allow-list: `HARNESS_MODELS` (comma-separated). It defaults to the two
  models above, and the client can't request anything outside it.
- The security headers in `next.config.ts` stay as they are.

### 6.12 Look and feel (from be-promptful)

- Theme: be-promptful's tokens and utilities carried over into `globals.css`:
  - `--card`, `--card-inner`, `--ring-subtle`, `--highlight`, `--text-1..3`
  - `surface-card`, `surface-inner`
  - the type scale (`type-title` and others)
  - radii (card 20 px, row 12 px, chip 10 px)
  - `scrollbar-hide`
  - the 16 px inputs on touch screens
- Palette: near-black background, mint primary `hsl(151 100% 68%)`, no
  visible card borders (inset highlight plus a 1 px ring plus a soft shadow).
- Layout:

  ```
  ┌────────────┬───────────────────────────────────────────┐
  │ + New chat │  Chat title          DeepSeek 1017 ▾  $0.04│
  │ ⌕ Search   │───────────────────────────────────────────│
  │            │        ┌───────────────────────────┐      │
  │ Today      │        │ user bubble (surface-inner)│      │
  │  • Chat A  │        └───────────────────────────┘      │
  │  • Chat B  │  ▸ Thinking (12s)                          │
  │ Yesterday  │  assistant markdown, code blocks…          │
  │  • Chat C  │  Sources: [1] site.com [2] …   1.2k tok    │
  │            │                                            │
  │ ⚙ Settings │  ┌─ surface-card composer ────────────┐   │
  │            │  │ 📎  Message…          🌐 auto  ➤    │   │
  └────────────┴──┴───────────────────────────────────────┴┘
  ```

- On phones the sidebar becomes a slide-over sheet, and the composer stays
  pinned above the safe area.
- Toasts use `sonner`, styled as in be-promptful's `app-shell.tsx`.
- The animated glow and shimmer keyframes already in `globals.css` are reused
  for the composer focus state and the loading skeleton.

### 6.13 What gets removed

- The optimizer: `src/lib/optimizer/*`, `src/components/optimizer/*` and their
  tests.
- `src/app/api/optimize/`.
- The `diff` dependency.
- `public/platforms/*` and the starter SVGs.
- The optimizer settings in `.env.example`.
- `src/lib/openrouter.ts` becomes `src/lib/harness/llm/venice.ts`, with its
  error mapping kept.

## 7. Packages

To be installed with the owner's knowledge. All are widely used and none is
large.

| Package | Why |
|---|---|
| `react-markdown`, `remark-gfm`, `remark-breaks` | Markdown rendering, the same stack be-promptful uses |
| `rehype-highlight` | Code-block syntax highlighting (lighter than Shiki) |
| `@modelcontextprotocol/sdk` | The official MCP client (Streamable HTTP) |
| `zod` | Request validation in routes. The MCP SDK already depends on it |
| `sonner` | Toasts, as in be-promptful |
| `@radix-ui/react-dialog` | Settings sheet and mobile sidebar, as in be-promptful |

Removed: `diff`. No Vercel AI SDK, no IndexedDB library, no PDF library.

## 8. Environment variables

| Var | Required | Default |
|---|---|---|
| `VENICE_API_KEY` | yes | none |
| `HARNESS_MODELS` | no | `deepseek-v4-1-flash-1017-uncensored,glm-5-3-flash-uncensored` |
| `HARNESS_DEFAULT_MODEL` | no | `deepseek-v4-1-flash-1017-uncensored` |
| `HARNESS_UTILITY_MODEL` | no | `glm-5-3-flash-uncensored` (titles, compaction) |
| `HARNESS_PASSCODE`, `HARNESS_SESSION_SECRET` | yes in production unless `HARNESS_PUBLIC=1` | none |
| `HARNESS_DAILY_CALL_BUDGET` | no | 2000 |
| `COMPACT_AT_TOKENS` | no | 150000 |
| `MCP_SERVERS` | no | none |
| `TRUST_PROXY_HEADERS`, `ALLOWED_ORIGINS` | no | as today |

## 9. Testing

- Vitest unit tests for:
  - the Venice SSE parser and tool-call delta accumulation (recorded-fixture
    chunks)
  - retry
  - the agent loop with a fake adapter and fake tools: multi-step, max steps,
    tool error, abort, deadline
  - projection with compaction and attachment eviction
  - the compaction trigger
  - usage and cost maths
  - route validation and the passcode gate
- Component tests for:
  - message rendering (Markdown, Thinking, citations)
  - composer limits
- A manual local smoke test against the real Venice API with the owner's key:
  - a streamed reply on each model
  - reasoning
  - web search with citations
  - a PDF attachment
  - an image attachment
  - title generation
  - compaction (lowered threshold)
- CI stays: lint, typecheck, test, production audit, build.

## 10. My calls (owner to check)

1. Hand-written adapter and loop, no Vercel AI SDK (§4).
2. Venice's built-in web search rather than our own search tool (§6.5).
3. `include_venice_system_prompt` off by default (§6.10).
4. A passcode gate, required in production unless explicitly public (§6.11).
5. GLM 5.3 Flash Uncensored as the cheap utility model for titles and
   compaction (§8).
6. A compaction threshold of 150k tokens, well under the 1M context, for cost
   and the Vercel body limit (§6.7).
7. Per-request attachment budget of 4 MB, with oldest-first eviction (§6.6).
8. MCP limited to remote HTTP servers configured by env, none by default
   (§6.5).
9. Max 8 tool steps per turn, 20 s per tool, 16k-character result cap (§6.4).

## 11. Left to the builder

- Exact component breakdown and file names under `src/components/chat/`.
- Throttle intervals, animation details, empty-state copy.
- The `maxDuration` value after checking the current Vercel plan limits and
  the Next 16 docs in `node_modules/next/dist/docs/`.
- How to record SSE fixtures for tests.
