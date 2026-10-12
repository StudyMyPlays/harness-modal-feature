# Optimizer

The prompt optimizer, extracted from `StudyMyPlays/be-promptful` so it can be
developed on its own. Paste a rough request, pick the agent or workspace it is
for, and get back a prompt written the way that product expects one.

Two families of output live behind one surface, which is why the modes are
grouped in the picker:

- **Task modes** (Claude Co-Work, Perplexity Comet) return a single clean prompt
  to paste into a chat.
- **Workspace modes** (Claude Projects, Gemini Gems, ChatGPT Projects) return the
  standing instructions that sit behind a saved workspace, and take an optional
  description of the knowledge base alongside the request.

## Running it

```bash
npm install
cp .env.example .env.local   # then set OPENROUTER_API_KEY
npm run dev
```

Without `OPENROUTER_API_KEY` the app renders and the route answers 503, so the
UI reports that optimization is not configured rather than failing at the model
provider.

Checks (also run in CI, `.github/workflows/ci.yml`):

```bash
npm run lint
npm run typecheck   # runs `next typegen` first; bare `tsc` cannot see Next's route types
npm test            # vitest: route, rate limiter, pipeline, components
```

## What is here

| Path | What it is |
| --- | --- |
| `src/lib/optimizer/optimizer.ts` | The whole feature definition: mode configs, system prompts, per-mode accents, input ceilings, the allow-list of models. |
| `src/lib/optimizer/score.ts` | The quality-score judge: a mode-agnostic 0-100 rubric (specificity/completeness/clarity/structure), run against both the raw input and every draft. The headline score is the sum of the four categories, and the judged text is passed as delimited data. Best-effort — returns `null` rather than throwing. |
| `src/lib/optimizer/refine.ts` | `runOptimize()`, the orchestrator: the generate call, the always-on baseline/draft scoring, and — when `deepOptimize` is requested — up to two critique-and-revise passes. It keeps the best-scoring draft (not the last), discards a revision that was cut off, and works inside a wall-clock deadline. `toResponse()` decides what the client is allowed to see. |
| `src/app/api/optimize/route.ts` | The server route. Checks origin, content type, size and every field's runtime type, then rate limits, spends the daily budget, calls `runOptimize()`. |
| `src/components/optimizer/` | `prompt-optimizer` (request state; each result is kept with the mode that made it), `search-input` (the composer, mode picker, Deep Optimize toggle, visible length counters), `prompt-result` (structure-aware rendering, truncation and refinement notices), `quality-score` (score/delta pills, breakdown when entitled), `before-after-diff` (word diff when entitled). |
| `src/lib/openrouter.ts` | One call to OpenRouter, with a per-call timeout and the upstream response reduced to "text, or the status that went wrong". |
| `src/lib/rate-limit.ts`, `src/lib/api-response.ts` | In-process token buckets (checked together, atomically), the daily call budget, and the shared `{ error }` failure shapes. |
| `src/components/ui/` | The five shadcn components the optimizer uses: button, select, skeleton, spinner, empty. |

## Differences from the app it came from

**There is no auth gate.** In `be-promptful` this route required a signed-in
user — the OpenRouter key is billable, and the session id was both the
authorization and the rate-limit key. This repo has no accounts, so the caller
is identified by IP and the limit stays at 20 per minute.

That is weaker on purpose. An IP is shared by everyone behind a NAT and rotated
freely by anyone who wants more than 20 calls a minute, so **before deploying
this anywhere the public can reach it, put an account check back in front of the
route** — `unauthorized()` is still in `src/lib/api-response.ts` for that, and
the rate-limit key should go back to the user id.

What stands in for it until then:

- The IP is only read from a header that can be trusted: `x-vercel-forwarded-for`
  on Vercel, `x-forwarded-for` with `TRUST_PROXY_HEADERS=1` behind a proxy that
  overwrites it. With neither, in production, the route refuses (503) rather
  than putting every caller in one shared bucket.
- A process-wide daily call budget (`OPTIMIZER_DAILY_CALL_BUDGET`) caps total
  spend however many callers show up.
- The client cannot choose a model beyond the cheap tier in `ALLOWED_MODELS`.
- Cross-site browser requests are refused.

Set a spend limit on the OpenRouter key too; none of the above is a quota.

**The rate limit is per-process.** `src/lib/rate-limit.ts` holds its buckets in
memory, so on a platform that runs several instances each one counts
separately, and a redeploy resets the count. It is a brake on accidental
hammering, not a quota.

**Deep Optimize has its own, tighter limit.** Every request scores the raw
input and the draft (2 extra calls); opting into Deep Optimize adds a
two-pass critique-and-revise loop (up to 4 more), so a `deepOptimize: true`
request can cost up to 7 calls instead of 1. Those requests are capped at 5
per minute per IP, on top of — not instead of — the base 20/minute limit; a
request refused by the deep limit does not use a base slot.

**"Pro" detail is decided by the server.** The category breakdown, the issues
list and the first draft are left out of the response unless `OPTIMIZER_PRO`
allows them (see `.env.example`); the UI renders from what it was sent, so
there is nothing to unlock client-side. There is still no billing: this is one
switch per deployment until accounts exist.

**Entrance animations work.** The components use `animate-in` /
`slide-in-from-*`; the original had `tw-animate-css` installed but never
imported, so those classes were inert there. `src/app/globals.css` imports it.

## Known gaps

- `npm audit` still reports advisories in the **dev-only** lint toolchain
  (`eslint-config-next` → `fast-glob`/`micromatch`/`braces`). The only fix npm
  offers is downgrading to `eslint-config-next@14`; CI audits production
  dependencies only.
- No CSP `script-src`: Next's inline hydration scripts would need a per-request
  nonce. The headers in `next.config.ts` cover framing, sniffing, referrer and
  form/base targets.
