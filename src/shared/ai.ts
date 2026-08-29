/**
 * Contract for `/api/v1/projects/:id/ai/*` — AI Visibility.
 *
 * A project defines **prompts** a buyer might type into an assistant. Each
 * prompt is run against a set of **engines**; every run records whether the
 * project's domain was *mentioned* in the answer and whether it was *cited* as
 * a source. Over weeks that becomes a mention rate and a citation rate per
 * engine, which is the actual product.
 *
 * Powered by DataForSEO's AI Optimization API — `ai_optimization/<engine>/
 * llm_responses/live`. Everything below was verified against
 * https://docs.dataforseo.com/v3/ai_optimization/overview/ and the per-engine
 * live pages on 2026-08-29.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Engines                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The engines DataForSEO's LLM Responses API offers, using **their** path
 * segments verbatim so an engine id is also the URL fragment it maps to.
 *
 * All four support the **live** flow. `chat_gpt`, `claude` and `gemini` also
 * have a standard task queue; `perplexity` is live-only. We use live
 * everywhere — see `AI_LIVE_BASE_FEE_USD` for the price of that choice.
 */
export const AI_ENGINE_IDS = ["chat_gpt", "claude", "gemini", "perplexity"] as const;
export type AiEngineId = (typeof AI_ENGINE_IDS)[number];

export const aiEngineIdSchema = z.enum(AI_ENGINE_IDS);

/**
 * How an engine gets web results — which is what decides whether it can cite
 * anything at all.
 *
 * `"parameter"` engines answer from training data unless `web_search: true` is
 * sent, and their `annotations` array is **null**, not empty, when it is not.
 * We always send it: an AI Visibility run with no sources measures nothing.
 * `"always"` is Perplexity, which is web-backed by design and has no such flag.
 */
export type WebSearchMode = "parameter" | "always";

export interface AiEngine {
  id: AiEngineId;
  /** Badge label. */
  label: string;
  /**
   * The `model_name` we send. DataForSEO resolves a bare name to its latest
   * dated version and echoes the resolved one back, which is what we store on
   * the snapshot — so this is the request, not the record.
   */
  model: string;
  webSearch: WebSearchMode;
  /** See `AI_LIVE_BASE_FEE_USD`. An estimate, and knowingly a rough one. */
  estimatedCostUsd: number;
}

/**
 * DataForSEO's platform fee for one **live** LLM response, USD.
 *
 * Source: https://dataforseo.com/pricing/ai-optimization/llm-responses —
 * "Live mode … Price per task: $0.0006 + price charged by LLM". Confirmed
 * arithmetically against their own worked examples: the ChatGPT live example
 * reports `money_spent: 0.0290312` and `cost: 0.029631` (difference
 * $0.0005998), the Perplexity one `money_spent: 0.006124` / `cost: 0.006724`
 * (difference exactly $0.0006).
 *
 * The standard queue is cheaper per task ($0.0002 + a refundable $0.01
 * prepayment) but is documented at "up to 72 hours", which is not a "Run now".
 */
export const AI_LIVE_BASE_FEE_USD = 0.0006;

/**
 * **The pricing surprise, stated plainly, because every cost hint in this
 * product depends on understanding it.**
 *
 * docs/specs/PHASE6.md assumes a per-call price per engine. There is no such
 * thing for this API and no per-model price table exists anywhere on
 * DataForSEO. What they charge is:
 *
 *     cost = AI_LIVE_BASE_FEE_USD + money_spent
 *
 * where `money_spent` is, verbatim from their response-field docs, "the price
 * charged by the third-party AI model provider" — a token bill, plus whatever
 * that provider charges for a web search, passed straight through. A search
 * charge dominates it: their ChatGPT example burned **8,174 input tokens** for
 * a twenty-word prompt because `web_search: true` stuffs retrieved pages into
 * the context, and cost $0.0296 — fifty times the base fee.
 *
 * So a pre-call number is necessarily an estimate, and the constants below say
 * so. The authoritative figure is `cost` on the response, which the client
 * meters into `api_usage` exactly as it does for every other endpoint; the
 * per-snapshot `costUsd` is what the UI should show once a run has happened.
 */
export const AI_COST_IS_AN_ESTIMATE = true;

/**
 * The engines, cheapest first.
 *
 * Model choice is "the cheapest model on this engine that supports web
 * search", because a run that cannot cite sources cannot answer the question
 * this feature exists to ask. Every id here was confirmed present in that
 * engine's `llm_responses/models` list with `web_search_supported: true`.
 *
 * **About `estimatedCostUsd`.** Two of these are measured, two are derived:
 *
 *  - `perplexity` — **measured**. DataForSEO's own live example for
 *    `sonar-reasoning-pro` totals $0.006724. `sonar` is their cheapest model,
 *    so this is an upper bound for it.
 *  - `chat_gpt` — **measured**. Their live example for `gpt-4.1-mini` with
 *    `web_search: true` totals $0.029631; the bulk of that is OpenAI's
 *    per-call web-search charge, which does not vary much by model, so a
 *    4o-mini run lands in the same region.
 *  - `claude` and `gemini` — **derived**, and the softest numbers here: no
 *    first-party example exists for either, so these extrapolate the same
 *    token bill plus the provider's published web-search tool fee. Treat them
 *    as order-of-magnitude. They are used only for the pre-run hint.
 */
export const AI_ENGINES: Readonly<Record<AiEngineId, AiEngine>> = {
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    // Their cheapest Sonar model; every Sonar model is web-backed.
    model: "sonar",
    webSearch: "always",
    estimatedCostUsd: 0.007,
  },
  claude: {
    id: "claude",
    label: "Claude",
    model: "claude-3-5-haiku-latest",
    webSearch: "parameter",
    estimatedCostUsd: 0.012,
  },
  chat_gpt: {
    id: "chat_gpt",
    label: "ChatGPT",
    model: "gpt-4o-mini",
    webSearch: "parameter",
    estimatedCostUsd: 0.03,
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    model: "gemini-2.5-flash-lite",
    webSearch: "parameter",
    estimatedCostUsd: 0.037,
  },
};

/** The engine list an empty prompt form starts with: the cheapest one. */
export const AI_DEFAULT_ENGINES: readonly AiEngineId[] = ["perplexity"];

/** Estimated USD for one prompt across these engines. A hint, never a bill. */
export function estimateRunCostUsd(engines: readonly AiEngineId[]): number {
  const total = engines.reduce(
    (sum, id) => sum + (AI_ENGINES[id]?.estimatedCostUsd ?? 0),
    0,
  );
  // Six decimals, for the same reason rank tracking rounds: to keep binary
  // floating point out of an API response.
  return Math.round(total * 1_000_000) / 1_000_000;
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * DataForSEO's ceiling on `user_prompt`, verbatim: "you can specify up to 500
 * characters". Enforced here so a too-long prompt is a 422 from us rather than
 * a paid round trip that fails upstream.
 */
export const AI_PROMPT_MAX_CHARS = 500;

/** Prompts one project may keep. A weekly run bills every one of them. */
export const AI_PROMPTS_MAX_PER_PROJECT = 50;

export const createAiPromptSchema = z.object({
  prompt: z.string().trim().min(3).max(AI_PROMPT_MAX_CHARS),
  engines: z.array(aiEngineIdSchema).min(1).max(AI_ENGINE_IDS.length),
});
export type CreateAiPromptBody = z.infer<typeof createAiPromptSchema>;

/** PATCH — both fields optional, at least one required. */
export const updateAiPromptSchema = createAiPromptSchema.partial().refine(
  (value) => value.prompt !== undefined || value.engines !== undefined,
  { message: "Provide a prompt, engines, or both." },
);
export type UpdateAiPromptBody = z.infer<typeof updateAiPromptSchema>;

/** The newest verdict for one engine, for the prompt list's ✓/— columns. */
export interface AiEngineStatus {
  engine: AiEngineId;
  /** `YYYY-MM-DD` of the newest run, or null if this engine never ran. */
  lastRunDate: string | null;
  mentioned: boolean | null;
  cited: boolean | null;
  citationCount: number;
}

export interface AiPrompt {
  id: string;
  prompt: string;
  engines: AiEngineId[];
  /** ISO 8601. */
  createdAt: string;
  /** Newest run across every engine. ISO 8601, or null. */
  lastRunAt: string | null;
  /** One entry per engine on the prompt, in the prompt's own engine order. */
  statuses: AiEngineStatus[];
}

/** GET /api/v1/projects/:id/ai/prompts */
export interface AiPromptListResponse {
  projectId: string;
  domain: string;
  prompts: AiPrompt[];
  /** True while an `ai_run` for this project is queued or running. */
  runInProgress: boolean;
}

/** POST / PATCH /api/v1/projects/:id/ai/prompts[/:promptId] */
export interface AiPromptMutationResponse {
  prompt: AiPrompt;
  /** True when creating the prompt also enqueued its first run. */
  runEnqueued: boolean;
}

export interface AiPromptDeletedResponse {
  deleted: true;
  id: string;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

/** Default width of the results window, in days. */
export const AI_RESULTS_DEFAULT_DAYS = 90;

export const aiResultsQuerySchema = z.object({
  /** `YYYY-MM-DD`. Defaults to `AI_RESULTS_DEFAULT_DAYS` ago. */
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** One source the assistant used. */
export interface AiCitation {
  /** Exactly as the API gave it — the UI links this, safe-scheme checked. */
  url: string;
  /** DataForSEO's `annotations[].title`: the source's title or domain. */
  title: string | null;
  /** Parsed host, `www.` stripped. Null when the URL was not usable. */
  host: string | null;
  /** True when this citation points at the project's own site. */
  ours: boolean;
}

/**
 * One prompt × engine × day. The unit of everything on this page.
 *
 * There is at most one per (prompt, engine, date): a second run on the same day
 * replaces the first, the same way rank tracking keeps one row per keyword per
 * day. A day is the resolution the trend is drawn at, and two rows for one day
 * would silently double that day's weight in the mention rate.
 */
export interface AiSnapshot {
  id: string;
  promptId: string;
  engine: AiEngineId;
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  mentioned: boolean;
  cited: boolean;
  citations: AiCitation[];
  /** Just the ones pointing at us. */
  citedUrls: string[];
  /**
   * The resolved model that answered, e.g. `gpt-4o-mini-2024-07-18`. Null on
   * rows written before this was recorded, or when the API omitted it.
   */
  model: string | null;
  /** What this single answer actually cost, USD. Not an estimate. */
  costUsd: number;
  /** ISO 8601. */
  createdAt: string;
}

/** A snapshot plus the answer text — the drill-down payload. */
export interface AiSnapshotDetail extends AiSnapshot {
  /**
   * Up to 2000 characters of the answer, centred on the mention when there was
   * one. The full response is in R2; this is what renders without a blob fetch.
   */
  responseExcerpt: string;
  /**
   * Substrings the UI should highlight in the excerpt, lowercased. Search for
   * them case-insensitively rather than trusting an offset — the excerpt is a
   * window onto the answer, not the whole of it.
   */
  mentionTerms: string[];
}

/** One point of the per-engine mention-rate trend. */
export interface AiRatePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Prompt runs recorded for this engine that day. */
  runs: number;
  /** Runs whose answer mentioned the project. */
  mentions: number;
  /** Runs that cited the project. */
  citations: number;
  /** `mentions / runs`, 0–1. Null when nothing ran that day. */
  mentionRate: number | null;
  /** `citations / runs`, 0–1. Null when nothing ran that day. */
  citationRate: number | null;
}

export interface AiEngineTimeline {
  engine: AiEngineId;
  points: AiRatePoint[];
  /** Over the whole window. Null when the engine has no runs in it. */
  mentionRate: number | null;
  citationRate: number | null;
}

/** GET /api/v1/projects/:id/ai/results?from&to */
export interface AiResultsResponse {
  projectId: string;
  domain: string;
  from: string;
  to: string;
  /** One per engine that has any run in the window. */
  timelines: AiEngineTimeline[];
  /**
   * The newest run per prompt × engine, with excerpt and citations — the
   * "latest runs" table and its drill-down, in one payload.
   */
  latest: AiSnapshotDetail[];
  /** Prompt text by id, so the table can label rows without a second call. */
  prompts: { id: string; prompt: string; engines: AiEngineId[] }[];
}

/* -------------------------------------------------------------------------- */
/* Run now                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One run per project per hour.
 *
 * The limit is about money: unlike a rank check, every press here buys LLM
 * answers at a few cents each, and an assistant's answer to the same question
 * does not change hour to hour.
 */
export const AI_RUN_WINDOW_SECONDS = 60 * 60;

/** POST /api/v1/projects/:id/ai/run — 202. */
export interface AiRunEnqueuedResponse {
  enqueued: true;
  /** Prompts this run covers. */
  promptCount: number;
  /** Prompt × engine pairs, i.e. how many LLM calls will be made. */
  callCount: number;
  /**
   * Estimated USD. **An estimate** — see `AI_COST_IS_AN_ESTIMATE`. The real
   * figure is the sum of `costUsd` across the snapshots the run writes.
   */
  estimatedCostUsd: number;
  /** ISO 8601 — when another run becomes allowed for this project. */
  nextAllowedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Narrows an arbitrary string to a known engine id. */
export function isAiEngineId(value: unknown): value is AiEngineId {
  return (
    typeof value === "string" && (AI_ENGINE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Engine ids from a stored `engines_json`, filtered to the ones we still
 * support and de-duplicated.
 *
 * Rows outlive code: a prompt saved when an engine existed must not crash a
 * page after that engine is retired, and a run must not post to a path that no
 * longer exists. Unknown ids are dropped, quietly and on purpose.
 */
export function readEngines(raw: unknown): AiEngineId[] {
  if (!Array.isArray(raw)) return [];
  const out: AiEngineId[] = [];
  for (const value of raw) {
    if (isAiEngineId(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

/** `mentions / runs`, or null when there is nothing to divide. */
export function rate(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 10_000) / 10_000;
}
