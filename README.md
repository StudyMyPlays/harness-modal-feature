# Harness

A private, ChatGPT-style chat harness for [Venice](https://venice.ai) models,
built on Next.js. It runs locally with `npm run dev` and deploys to Vercel
unchanged.

The defaults are Venice's uncensored **DeepSeek V4.1 Flash 1017**
(`deepseek-v4-1-flash-1017-uncensored`) and **GLM 5.3 Flash**
(`glm-5-3-flash-uncensored`). Any Venice text model can be added to the
allow-list.

What you get:

- **Chats:** a sidebar of chats (search, rename, delete), streamed replies,
  Markdown with highlighted code and copy buttons. You can stop a reply,
  regenerate it, or edit your last message and resend it.
- **Reasoning:** shown in a collapsible "Thinking" block, with a
  reasoning-effort control where the model offers one.
- **Web search** (off, auto or on), using Venice's built-in search. Sources
  appear as numbered links.
- **Attachments:** images for vision models, and PDF, Office, text and code
  files, which Venice reads.
- **Auto titles, compaction and token/cost meter:** chats get a title after
  the first reply. Long chats have their older turns summarised for the
  model. Each reply and each chat shows its tokens and cost.
- **Tools** from remote MCP servers you configure.
- **A passcode gate** for public deployments.

Chats are stored in your browser (IndexedDB). Nothing about a conversation is
kept on the server.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then set VENICE_API_KEY
npm run dev                  # http://localhost:3000
```

No passcode is needed locally. Every setting is explained in `.env.example`.

Checks, which also run in CI (`.github/workflows/ci.yml`):

```bash
npm run lint
npm run typecheck   # runs `next typegen` first; bare `tsc` cannot see Next's route types
npm test            # vitest
npm run build
```

## Deploy to Vercel

1. Import the repository in Vercel. It is detected as Next.js, and no
   `vercel.json` is needed.
2. In **Project Settings → Environment Variables**, set:
   - `VENICE_API_KEY`
   - `HARNESS_PASSCODE`
   - `HARNESS_SESSION_SECRET` (a long random string, for example from
     `openssl rand -base64 32`)

   Production refuses to serve the API without a passcode, unless you set
   `HARNESS_PUBLIC=1` on purpose.
3. Deploy. The chat route asks for `maxDuration = 300` seconds. If your plan
   allows less, lower it in `src/app/api/chat/route.ts`.

Set a spending limit on the Venice key too. The rate limits and daily budget
below protect against accidents, but they are not a quota.

## How it is built

The structure follows [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
rebuilt for stateless Vercel functions:

| DeepSeek Harness | Here | What it does |
| --- | --- | --- |
| `llm`, `llm-deepseek` | `src/lib/harness/llm/` | The model-adapter seam and the Venice adapter: SSE parsing, tool-call accumulation, reasoning, citations, balance header, and error mapping that never forwards Venice's text |
| `llm-retry` | `llm/retry.ts` | Retries 429, 5xx and network errors, only before anything has streamed |
| `core/agent-loop` | `agent-loop.ts` | A turn is up to 8 steps; a step is one model call plus its tool calls. Usage is summed and costed |
| `core/tools`, `tool-executor-native` | `tools/registry.ts` | Tool registry. The executor never throws: it applies timeouts (20 s), size caps (16k characters) and bad-argument handling |
| `mcp-client` | `tools/mcp.ts` | Tools from remote Streamable-HTTP MCP servers (`MCP_SERVERS`), cached for 5 minutes |
| `core/session`, `session-format` | `session/format.ts` | The per-chat event log |
| `session-projection` | `session/projection.ts` | Event log → model messages. It applies compaction, never sends reasoning, and evicts old attachments to fit the 4 MB request budget |
| `session-persistence` | `session/store.ts`, `session/indexeddb.ts` | The `SessionStore` interface, implemented on IndexedDB. A database later implements the same interface |
| `compaction-basic` | `session/compaction.ts`, `/api/compact` | Summarises older turns past `COMPACT_AT_TOKENS` |
| `session-title-llm` | `/api/title` | A title of up to 6 words after the first reply |
| `token-meter` | `catalog.ts` | Prices and capabilities from Venice's `/models` (cached for 10 minutes), and cost per reply |
| `system-prompt`, `time-context` | `prompts.ts` | Your system prompt plus a short harness preamble (date, search, tools) |

The browser (`client/controller.ts`) owns the session log. Each turn, it sends
the projected history to `/api/chat`, which runs the agent loop against Venice
and streams typed events back (`protocol.ts`). The browser persists those
events as they arrive.

Every API route goes through `guard.ts`, which checks, in order:

1. the request isn't cross-site
2. the passcode
3. the Venice key is configured
4. the caller can be identified
5. the rate limit
6. the daily budget

The UI (`src/components/chat/`) uses be-promptful's design tokens: borderless
`surface-card`s, the mint accent, and its type scale (`src/app/globals.css`).

## Known gaps

- **The rate limits and daily budget are per process.** They are kept in
  memory, so several instances count separately and a redeploy resets them.
- **There are no accounts and no server-side history yet.** Chats live in the
  browser they were made in. Clearing site data deletes them.
- **No CSP `script-src`.** Next's inline hydration scripts would need a nonce
  per request. `next.config.ts` covers framing, sniffing, referrer and
  form/base targets.
- **Dev-only `npm audit` advisories.** `npm audit` reports advisories in the
  lint toolchain (`eslint-config-next`). CI audits production dependencies
  only.
