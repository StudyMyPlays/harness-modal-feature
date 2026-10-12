export type OptimizerMode =
  | 'co-work'
  | 'comet'
  | 'claude-project'
  | 'gemini-gem'
  | 'gpt-project'

/**
 * Two families of output live behind one optimizer.
 *
 * `task` modes rewrite a one-off request into a prompt you paste into an agent
 * and run once. `workspace` modes write the *standing* instructions that sit
 * behind a saved workspace — a Claude Project, a Gemini Gem, a ChatGPT Project
 * — and steer every future conversation inside it. The second kind is written
 * once and read hundreds of times, so it is longer, it is addressed to the
 * model rather than about a task, and it needs a description of the knowledge
 * base it will be paired with. That difference is what `kind` carries.
 */
export type OptimizerKind = 'task' | 'workspace'

/**
 * Rules every mode's OUTPUT RULES block ends with.
 *
 * They were written out per prompt and had already drifted — some modes said
 * "needs to customize", others "must customize". The plain-text contract is the
 * one that matters: `OutputBlock` parses the reply line by line, so a mode that
 * quietly starts wrapping its answer in a fence renders as a fence.
 */
const NO_FENCES = 'No markdown fences. No backticks. No preamble.'
const PLAIN_TEXT_RULE = `Output plain text only. ${NO_FENCES}`
const CUSTOMIZE_RULE = 'Mark anything the user must customize with ⚠️.'

const COWORK_SYSTEM = `You are a Claude Cowork prompt optimizer. Take the user's raw request and rewrite it into a clean task prompt for Claude Cowork. Output ONLY the rewritten prompt — no code blocks, no backticks, no preamble, no explanation.
# WHAT COWORK NEEDS TO KNOW
Cowork is an AI assistant that runs tasks on your Mac — it can read and create files, browse the web, and connect to apps like Google Drive, Notion, Gmail, and Calendar. It works best when you describe the outcome and constraints rather than step-by-step instructions.
# OUTPUT FORMAT — use exactly this structure:
GOAL
[One sentence: what the finished result looks like]
SUCCESS CRITERIA
- [Something you can verify]
- [Something you can verify]
INPUTS
- [Which files, folders, or apps to use]
CONSTRAINTS
- [What to include or exclude]
- [What not to change]
- [If task touches important files, emails, or calendar events: "Ask me to confirm before sending, deleting, moving, or overwriting anything."]
# OUTPUT RULES
- ${PLAIN_TEXT_RULE}
- ${CUSTOMIZE_RULE}`

const COMET_SYSTEM = `You are a Perplexity Comet prompt optimizer. Take the user's raw request and rewrite it into a clean task prompt for Comet. Output ONLY the rewritten prompt — no code blocks, no backticks, no preamble, no explanation.
# WHAT COMET NEEDS TO KNOW
Comet is a web-browsing AI agent by Perplexity that can open tabs, read websites, interact with web apps, fill forms, and take actions online. It works best with clear goals, explicit source constraints, approval rules, and a defined output format.
# OUTPUT FORMAT — use exactly this structure:
GOAL
[What should be true when this task is done — one clear sentence]
SOURCES
- [Which tabs, sites, or accounts to use]
CONSTRAINTS
- [Budget / time range / brands / domains to include]
- [What to ignore or avoid]
OUTPUT FORMAT
[Table / bullets / prose / action taken — be specific]
APPROVAL RULES
Ask before: [e.g., placing orders, sending messages, submitting forms]
Auto-proceed for: [e.g., reading, summarizing, comparing]
ERROR HANDLING
[What to do if data is missing, out of stock, or unavailable]
# OUTPUT RULES
- ${PLAIN_TEXT_RULE}
- ${CUSTOMIZE_RULE}`

const CLAUDE_PROJECT_SYSTEM = `You are a Claude Projects instruction writer. The user describes a workspace they want to build. You write the "Project instructions" block they will paste into Claude Projects. Output ONLY that block — no code blocks, no backticks, no preamble, no explanation, and never address the user in it.
# WHAT CLAUDE PROJECTS NEEDS TO KNOW
A Claude Project is a workspace with its own knowledge base (uploaded files) and its own custom instructions. The instructions are the behavioural system prompt applied to EVERY chat inside that Project — they are onboarding documentation for a capable new team member, not a description of one task.
Individual chats inside a Project do NOT share their message history with each other. What every chat does share is the knowledge base and these instructions. Paid plans additionally offer per-project Memory, which can carry context across chats in the Project — but it is opt-in, summarised, and not guaranteed to retain any particular fact, so anything that MUST survive across chats still belongs in the knowledge base or in these instructions. Say so where it matters.
Write the instructions AS the standing contract, addressed to Claude, in second person ("You are…", "Always…", "Never…").
# OUTPUT FORMAT — use exactly this structure:
ROLE
[Who Claude is in this Project — a specific role with a seniority and a domain, not "a helpful assistant"]
AUDIENCE
[Who Claude is talking to, their expertise level, and what they do with the output]
TONE & STYLE
- [Concrete and measurable — "8th-grade reading level, no jargon", not "write clearly"]
- [Default response length, and when to go longer]
FORMAT
- [Structure of a typical response: sections, bullets, tables, code blocks]
- [Anything required every time — examples, citations, next steps]
ALWAYS
- [High-value behaviours, stated as rules Claude can check itself against]
NEVER
- [Hard limits: out-of-scope topics, claims to avoid, disclaimers required]
KNOWLEDGE BASE
- [Which uploaded documents to consult, when, and how to cite them]
- [What to do when the knowledge base does not cover the question]
FIRST MOVE
[What Claude does at the start of a new chat — e.g. ask up to 3 clarifying questions before producing a deliverable]
# OUTPUT RULES
- ${PLAIN_TEXT_RULE}
- Be specific, not vague. Define ambiguous words inline ("short = under 200 words").
- Keep the whole block under 400 words. Overloaded instructions create conflicts — keep only the highest-impact rules.
- Separate persona (who Claude is) from process (what Claude does). Do not repeat a rule across sections.
- ${CUSTOMIZE_RULE} File names, brand names, and thresholds almost always need it.`

const GEMINI_GEM_SYSTEM = `You are a Google Gemini Gem instruction writer. The user describes a Gem they want to build. You write the block they will paste into the "Instructions" box of a new Gem. Output ONLY that block — no code blocks, no backticks, no preamble, no explanation, and never address the user in it.
# WHAT GEMS NEED TO KNOW
A Gem is a customised Gemini expert: a persistent instruction block plus optional uploaded files, applied to every conversation with that Gem. Google's official guidance is the four-part framework — Persona, Task, Context, Format — and it recommends ALWAYS including examples. Gemini is optimised for direct, well-structured instructions with consistent headings; put role, mission, and must/never rules first, output format second, extras last. Gemini is multimodal, so say explicitly how to treat uploaded images, PDFs, and pasted code.
Write the instructions AS the Gem's contract, addressed to the model, in second person.
# OUTPUT FORMAT — use exactly this structure, keeping the "# " headings verbatim:
# Persona
[Role, target user, temperament, interaction style — 2-4 lines]
# Task
- [Primary goal]
- [Secondary goals]
- [Ambiguity rule: how many clarifying questions to ask before proceeding]
- [Hard scope boundary and how to decline politely]
# Context
- [What to assume about the user's skill level and situation]
- [How to treat uploaded files and pasted text — ground truth vs. background]
- [Grounding rule for anything the provided context does not cover]
- [How to handle each modality the user will actually send: screenshots, PDFs, code]
# Format
- [Response structure, in order]
- [Verbosity ceiling, stated as a number]
- [Closing protocol — what the last line of every response does]
# Examples
Input: [a realistic, typical request]
Output: [a compressed but format-accurate ideal response]
Input: [a harder or edge-case request]
Output: [the ideal response, showing the rule that makes it hard]
# OUTPUT RULES
- Output plain text with the "# " headings above. ${NO_FENCES}
- Give exactly two examples. Make them positive patterns — show what to do, never what to avoid.
- Define ambiguous terms explicitly ("concise = under 150 words", "senior = assumes async/await, Docker, k8s").
- No fluff, no motivational language, no meta-explanation of the instructions themselves.
- Keep the whole block under 450 words.
- ${CUSTOMIZE_RULE}`

const GPT_PROJECT_SYSTEM = `You are a ChatGPT Projects instruction writer. The user describes a workspace they want to build. You write the block they will paste into the Project's "Add instructions" field. Output ONLY that block — no code blocks, no backticks, no preamble, no explanation, and never address the user in it.
# WHAT CHATGPT PROJECTS NEEDS TO KNOW
A ChatGPT Project is a workspace with its own files, its own memory, and its own instructions. Project instructions OVERRIDE the user's global custom instructions inside that Project and apply automatically to every new chat in it, so they must stand alone — never assume a global instruction is still in effect.
Projects carry memory across chats, under whichever of two scopes was chosen when the Project was created: default memory can also draw on chats outside the Project, while project-only memory is sealed to this Project alone. That choice is fixed at creation and cannot be changed later, so the instructions must not depend on either one. Memory is also finite — older entries get replaced. Consistent terminology strengthens memory associations, and durable facts are better restated in the instructions than trusted to memory. Reflect this where it matters.
The proven pattern for a multi-purpose Project is a master prompt: one role, then numbered tasks, then formatting and output rules. Use it. Write in second person, addressed to ChatGPT.
# OUTPUT FORMAT — use exactly this structure:
ROLE
[Who ChatGPT is here — specific expertise and seniority — and who it is serving]
TASKS
TASK 1: [The most common request, with enough detail to execute it unprompted]
TASK 2: [The next distinct deliverable]
TASK 3: [The next distinct deliverable — include a 4th only if the workspace genuinely needs it]
FORMATTING REQUIREMENTS
- [Voice, reading level, and default length]
- [Markdown, tables, headings, code blocks — say which and when]
OUTPUT STRUCTURE
- [The shape of a finished deliverable, in order, so every response is comparable]
PROJECT CONTEXT
- [Durable facts to restate every time: audience, product, terminology, constraints]
- [Which uploaded files are authoritative and when to open them]
BOUNDARIES
- [What to refuse or route elsewhere]
- [When to ask before assuming, and what to do with missing information]
# OUTPUT RULES
- ${PLAIN_TEXT_RULE}
- Keep task labels exactly as "TASK 1:", "TASK 2:", "TASK 3:".
- Be concrete: name formats, numbers, and terminology instead of describing them.
- Keep the whole block under 450 words.
- ${CUSTOMIZE_RULE}`

export interface ModeConfig {
  id: OptimizerMode
  kind: OptimizerKind
  label: string
  provider: string
  icon: string
  system: string
  examples: string[]
  headings: Set<string>
  placeholder: string
  readyLabel: string
  tip: string
  /** Upper bound on what the model writes for this mode. Workspace blocks are
   *  several times longer than a task prompt, so a single shared cap would
   *  either truncate them or overpay for the task modes. */
  maxTokens: number
  /** Label + URL of the place the finished output gets pasted, surfaced next to
   *  the copy button so the workflow ends where it is meant to. */
  destination?: { label: string; url: string }
  /** Prompt for the optional second field, mapped to the API's `ctx`. Workspace
   *  modes need to know what the knowledge base holds; task modes do not. */
  contextLabel?: string
  contextPlaceholder?: string
}

const COWORK_EXAMPLES = [
  'Go through my emails and find all invoices from last month, put them in a spreadsheet',
  'Clean up my Downloads folder and organize files by type into subfolders',
  'Draft a follow-up email to everyone I met at the conference last week',
  "Pull this week's calendar and create a daily briefing doc in Notion",
]
const COMET_EXAMPLES = [
  'Find the best noise-cancelling headphones under $300 and compare the top 3',
  'Check if my Amazon order has shipped and tell me the estimated delivery',
  'Search for flights from Seattle to NYC next weekend, show the cheapest options',
  'Compare the latest pricing for Figma, Notion, and Linear in a table',
]
const CLAUDE_PROJECT_EXAMPLES = [
  'A workspace for reviewing pull requests against our TypeScript style guide',
  'A legal workspace that summarizes contracts and flags risky clauses for a non-lawyer founder',
  'A marketing workspace that writes LinkedIn posts in our brand voice from our style guide',
  'A research workspace that synthesizes interview transcripts into themes with citations',
]
const GEMINI_GEM_EXAMPLES = [
  'A patient Spanish tutor for an intermediate learner, correcting me as we chat',
  'A coding partner for a solo React developer who ships weekly',
  'A recipe planner that only uses ingredients I already have',
  'A UX critique Gem that reviews screenshots of my app against Nielsen heuristics',
]
const GPT_PROJECT_EXAMPLES = [
  'A workspace that turns customer support tickets into weekly product feedback reports',
  'A content workspace that drafts, edits, and repurposes newsletter issues',
  'A sales workspace that researches prospects and writes tailored outreach',
  'A study workspace that turns lecture notes into summaries, flashcards, and quizzes',
]

const COWORK_HEADINGS = new Set(['GOAL', 'SUCCESS CRITERIA', 'INPUTS', 'CONSTRAINTS'])
const COMET_HEADINGS = new Set([
  'GOAL',
  'SOURCES',
  'CONSTRAINTS',
  'OUTPUT FORMAT',
  'APPROVAL RULES',
  'ERROR HANDLING',
])
const CLAUDE_PROJECT_HEADINGS = new Set([
  'ROLE',
  'AUDIENCE',
  'TONE & STYLE',
  'FORMAT',
  'ALWAYS',
  'NEVER',
  'KNOWLEDGE BASE',
  'FIRST MOVE',
])
const GEMINI_GEM_HEADINGS = new Set([
  '# Persona',
  '# Task',
  '# Context',
  '# Format',
  '# Examples',
])
const GPT_PROJECT_HEADINGS = new Set([
  'ROLE',
  'TASKS',
  'FORMATTING REQUIREMENTS',
  'OUTPUT STRUCTURE',
  'PROJECT CONTEXT',
  'BOUNDARIES',
])

export const MODES: Record<OptimizerMode, ModeConfig> = {
  'co-work': {
    id: 'co-work',
    kind: 'task',
    label: 'Co-Work',
    provider: 'Claude',
    icon: '/platforms/claude-color.webp',
    system: COWORK_SYSTEM,
    examples: COWORK_EXAMPLES,
    headings: COWORK_HEADINGS,
    placeholder: 'Describe what you want Cowork to do…',
    readyLabel: 'Ready for Cowork',
    tip: 'Paste into Claude Cowork. Fill in any ⚠️ placeholders first.',
    maxTokens: 1000,
  },
  comet: {
    id: 'comet',
    kind: 'task',
    label: 'Comet',
    provider: 'Perplexity',
    icon: '/platforms/perplexity-color.webp',
    system: COMET_SYSTEM,
    examples: COMET_EXAMPLES,
    headings: COMET_HEADINGS,
    placeholder: 'Describe what you want Comet to do on the web…',
    readyLabel: 'Ready for Comet',
    tip: 'Paste into Perplexity Comet. Fill in any ⚠️ placeholders first.',
    maxTokens: 1000,
  },
  'claude-project': {
    id: 'claude-project',
    kind: 'workspace',
    label: 'Projects',
    provider: 'Claude',
    icon: '/platforms/claude-color.webp',
    system: CLAUDE_PROJECT_SYSTEM,
    examples: CLAUDE_PROJECT_EXAMPLES,
    headings: CLAUDE_PROJECT_HEADINGS,
    placeholder: 'Describe the Project you want to build…',
    readyLabel: 'Project instructions',
    tip: 'Open your Project → Set project instructions → paste → Save. Fill in any ⚠️ placeholders first, then refine as you see real outputs.',
    maxTokens: 1600,
    destination: { label: 'Open Claude', url: 'https://claude.ai/projects' },
    contextLabel: 'Knowledge base',
    contextPlaceholder:
      'Which documents will you upload? Style guides, docs, transcripts, code… (optional)',
  },
  'gemini-gem': {
    id: 'gemini-gem',
    kind: 'workspace',
    label: 'Gems',
    provider: 'Gemini',
    icon: '/platforms/gemini-color.svg',
    system: GEMINI_GEM_SYSTEM,
    examples: GEMINI_GEM_EXAMPLES,
    headings: GEMINI_GEM_HEADINGS,
    placeholder: 'Describe the Gem you want to build…',
    readyLabel: 'Gem instructions',
    tip: 'Gemini → Explore Gems → New Gem → paste into Instructions, add your files, then test in the Preview panel.',
    maxTokens: 1800,
    destination: { label: 'Open Gemini', url: 'https://gemini.google.com/gems/create' },
    contextLabel: 'Knowledge files',
    contextPlaceholder:
      'Which files will you attach to the Gem? PDFs, docs, code, style guides… (optional)',
  },
  'gpt-project': {
    id: 'gpt-project',
    kind: 'workspace',
    label: 'Projects',
    provider: 'ChatGPT',
    icon: '/platforms/openai.webp',
    system: GPT_PROJECT_SYSTEM,
    examples: GPT_PROJECT_EXAMPLES,
    headings: GPT_PROJECT_HEADINGS,
    placeholder: 'Describe the Project you want to build…',
    readyLabel: 'Project instructions',
    tip: 'Open your Project → ⋯ menu → Add instructions → paste. These override your global custom instructions inside this Project only.',
    maxTokens: 1600,
    destination: { label: 'Open ChatGPT', url: 'https://chatgpt.com/projects' },
    contextLabel: 'Project files',
    contextPlaceholder:
      'Which files will you upload to the Project? Docs, spreadsheets, past work… (optional)',
  },
}

/**
 * Per-mode accent classes. Tailwind only sees class names it can find as whole
 * strings in source, so these are written out literally rather than composed
 * from a colour name at runtime. Kept here because both the input and the
 * result panel colour themselves by mode and must agree.
 */
export interface ModeAccent {
  glow: string
  ring: string
  heading: string
  rule: string
  badge: string
  hairline: string
  subkey: string
  warn: string
}
export const MODE_ACCENT: Record<OptimizerMode, ModeAccent> = {
  'co-work': {
    glow: 'from-amber-500/30 via-amber-400/15 to-transparent',
    ring: 'shadow-amber-500/25',
    heading: 'text-amber-400',
    rule: 'bg-amber-400/30',
    badge: 'bg-amber-400/10 text-amber-300',
    hairline: 'via-amber-400/35',
    subkey: 'text-amber-400',
    warn: 'text-amber-400',
  },
  comet: {
    glow: 'from-violet-500/30 via-violet-400/15 to-transparent',
    ring: 'shadow-violet-500/25',
    heading: 'text-violet-400',
    rule: 'bg-violet-400/30',
    badge: 'bg-violet-400/10 text-violet-300',
    hairline: 'via-violet-400/35',
    subkey: 'text-violet-400',
    warn: 'text-violet-300',
  },
  'claude-project': {
    glow: 'from-orange-500/30 via-orange-400/15 to-transparent',
    ring: 'shadow-orange-500/25',
    heading: 'text-orange-400',
    rule: 'bg-orange-400/30',
    badge: 'bg-orange-400/10 text-orange-300',
    hairline: 'via-orange-400/35',
    subkey: 'text-orange-400',
    warn: 'text-orange-300',
  },
  'gemini-gem': {
    glow: 'from-sky-500/30 via-sky-400/15 to-transparent',
    ring: 'shadow-sky-500/25',
    heading: 'text-sky-400',
    rule: 'bg-sky-400/30',
    badge: 'bg-sky-400/10 text-sky-300',
    hairline: 'via-sky-400/35',
    subkey: 'text-sky-400',
    warn: 'text-sky-300',
  },
  'gpt-project': {
    glow: 'from-emerald-500/30 via-emerald-400/15 to-transparent',
    ring: 'shadow-emerald-500/25',
    heading: 'text-emerald-400',
    rule: 'bg-emerald-400/30',
    badge: 'bg-emerald-400/10 text-emerald-300',
    hairline: 'via-emerald-400/35',
    subkey: 'text-emerald-400',
    warn: 'text-emerald-300',
  },
}

const GROUP_LABELS: Record<OptimizerKind, string> = {
  task: 'Agent tasks',
  workspace: 'Project instructions',
}

/**
 * Display order for the mode picker, grouped by what the output is *for*: a
 * prompt you run once vs. instructions that sit behind a workspace forever.
 *
 * Derived from `MODES` rather than listed again. A hand-written list is a
 * second place to remember a new mode, and forgetting it there does not fail
 * the build — the mode simply never appears in the picker. Order within a
 * group follows the order modes are declared in `MODES`.
 */
export const MODE_GROUPS: { kind: OptimizerKind; label: string; modes: OptimizerMode[] }[] = (
  ['task', 'workspace'] as const
).map(kind => ({
  kind,
  label: GROUP_LABELS[kind],
  modes: Object.values(MODES)
    .filter(m => m.kind === kind)
    .map(m => m.id),
}))

export function isOptimizerMode(value: string): value is OptimizerMode {
  return Object.prototype.hasOwnProperty.call(MODES, value)
}

/**
 * Input ceilings, shared by the route that enforces them and the textarea that
 * shows them. `max_tokens` caps what the model writes, which says nothing about
 * what it reads — and input is the billable side, so without a cap the cost of
 * one request was bounded only by the model's context window.
 *
 * Generous next to what the feature is actually for: a rough request, plus
 * optional context.
 */
export const MAX_RAW_CHARS = 8_000
export const MAX_CTX_CHARS = 4_000
/**
 * Models a caller may request by slug, guarding the optional `model` field on
 * the optimize request. The default (OPENROUTER_MODEL, else Haiku) is what
 * actually runs — nothing in the UI sends `model`.
 *
 * Only the cheap tier is listed. This route is reachable without an account,
 * so a premium slug here would let any anonymous caller pick the most
 * expensive model for every call of a seven-call request. A deployment that
 * wants a bigger model sets OPENROUTER_MODEL, which is the operator's choice
 * and is not checked against this list.
 */
export const ALLOWED_MODELS = new Set(['anthropic/claude-haiku-4.5'])
export function buildUserContent(raw: string, ctx?: string, ctxLabel?: string): string {
  return ctx?.trim()
    ? `RAW REQUEST:\n${raw}\n\n${(ctxLabel || 'EXTRA CONTEXT').toUpperCase()}:\n${ctx}`
    : `RAW REQUEST:\n${raw}`
}
