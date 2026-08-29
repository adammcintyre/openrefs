/**
 * `ai_optimization/<engine>/llm_responses/live` — ask a language model a
 * question and keep what it said and what it cited.
 *
 * Verified against https://docs.dataforseo.com/v3/ai_optimization/overview/ and
 * the four per-engine `llm_responses/live` pages (2026-08-29). The things that
 * differ from every other family in this codebase, and from what
 * docs/specs/PHASE6.md assumed:
 *
 *  1. **The prompt field is `user_prompt`**, not `prompt`, and it is capped at
 *     500 characters. The model is `model_name`, and a bare name resolves to
 *     its latest dated version — the response echoes the resolved one, which is
 *     what we record.
 *
 *  2. **Price is not per call.** `cost = $0.0006 + money_spent`, where
 *     `money_spent` is the LLM provider's own charge passed through. See
 *     `AI_LIVE_BASE_FEE_USD` in src/shared/ai.ts for the full story. Nothing
 *     here pretends to know a price in advance; `costUsd` on the result is what
 *     was actually billed.
 *
 *  3. **The four engines take different parameters.** Perplexity has no
 *     `web_search` flag at all (it is always web-backed) and rejects the ones
 *     ChatGPT accepts; Gemini has `web_search` but no `force_web_search` and no
 *     country targeting. Sending a parameter an engine does not know is an
 *     upstream 40501, so the payload is built per engine rather than shared.
 *
 *  4. **`sections[].text` is nullable even on a 20000.** Perplexity's own
 *     documented example returns `text: null` with populated annotations, and
 *     `annotations[].start_index`/`end_index`/`text` are null there too. A
 *     response with no text is a real outcome, not a parse failure.
 *
 *  5. **`annotations` is `null`, not `[]`, when `web_search` was not set** —
 *     and may be empty even when it was. This is why every engine we run is
 *     configured to search: an answer with no sources cannot tell us whether
 *     anyone is cited.
 *
 *  6. **`web_search: true` alone is not enough on ChatGPT.** Measured
 *     2026-08-29: `gpt-4o-mini` with `web_search: true` answered
 *     "best sites for free photoshop templates" from training data — zero
 *     annotations, and a total cost of $0.000774, i.e. $0.000174 of tokens on
 *     top of the base fee, which is far too little to have fetched anything.
 *     `force_web_search` is the documented companion flag ("to enable this
 *     parameter, web_search must also be enabled") and is what actually makes
 *     the engine go and look. Without it a ChatGPT run can never produce a
 *     `cited` verdict, which would quietly report every project as uncited on
 *     the engine most people care about. Set for ChatGPT and Claude; Gemini
 *     and Perplexity do not have it.
 *
 * The `live` flow is used rather than the standard queue because AI Visibility
 * has a "Run now" button. The queue is cheaper per task ($0.0002 plus a
 * refundable $0.01 prepayment) but is documented at "up to 72 hours"; live is
 * "up to 120 seconds", which is why this file is the one caller of
 * `PATIENT_ATTEMPT_TIMEOUTS_MS`.
 */
import { z } from "zod";

import type { AiEngineId } from "../../shared/ai";
import { AI_ENGINES, AI_PROMPT_MAX_CHARS } from "../../shared/ai";
import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import { PATIENT_ATTEMPT_TIMEOUTS_MS } from "./client";
import type { WrappedMeta } from "./schema";
import { nullableNumber, nullableString } from "./schema";

/** `ai_optimization/<engine>/llm_responses/live`. */
export function llmResponsesLiveEndpoint(engine: AiEngineId): string {
  return `ai_optimization/${engine}/llm_responses/live`;
}

/** `ai_optimization/<engine>/llm_responses/models` — GET, and free. */
export function llmResponsesModelsEndpoint(engine: AiEngineId): string {
  return `ai_optimization/${engine}/llm_responses/models`;
}

/**
 * Live endpoints take exactly one task per call, so a prompt × engine pair is
 * always one request. (`task_post` would take up to 100; we do not use it.)
 */
export const LLM_LIVE_MAX_TASKS = 1;

/**
 * Ceiling on the answer we ask for.
 *
 * DataForSEO's documented range is 16–4096 with a default of 2048 (and a
 * minimum of 1024 for reasoning models). 2048 is left alone deliberately: a
 * longer answer costs more output tokens and mentions nothing a shorter one
 * would not, because what we measure is whether the domain came up at all.
 */
export const LLM_MAX_OUTPUT_TOKENS = 2048;

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

const requestSchema = z.object({
  engine: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(AI_PROMPT_MAX_CHARS),
  /**
   * ISO 3166-1 alpha-2, upper case. Optional: only ChatGPT, Claude and
   * Perplexity accept it, and Claude documents a closed enum of 36 countries —
   * so an unrecognised code is dropped rather than sent, on the principle that
   * a slightly less local answer beats a rejected paid call.
   */
  countryIsoCode: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .optional(),
});

export interface LlmResponseParams {
  engine: AiEngineId;
  prompt: string;
  countryIsoCode?: string;
}

/**
 * Countries Claude's `web_search_country_iso_code` accepts, verbatim from
 * https://docs.dataforseo.com/v3/ai_optimization/claude/llm_responses/live/.
 *
 * The only engine that documents a closed set. Sending anything else is an
 * upstream rejection on a call we would still be billed for, so a code outside
 * this list is simply not sent for Claude.
 */
const CLAUDE_WEB_SEARCH_COUNTRIES: ReadonlySet<string> = new Set([
  "AR", "AT", "AU", "BE", "BR", "CA", "CH", "CL", "CN", "DE", "DK", "ES",
  "FI", "FR", "GB", "HK", "ID", "IN", "IT", "JP", "KR", "MX", "MY", "NL",
  "NO", "NZ", "PH", "PL", "PT", "RU", "SA", "SE", "TR", "TW", "US", "ZA",
]);

/**
 * The task object for one engine.
 *
 * Written as a switch rather than a merge of optional fields because the
 * differences are not decoration — each engine rejects the others' parameters,
 * and a rejected task is a paid round trip that returns nothing. Keeping the
 * four shapes visibly separate is what makes a future engine's quirks easy to
 * add without disturbing the three that work.
 */
export function buildLlmPayload(params: LlmResponseParams): Record<string, unknown> {
  const engine = AI_ENGINES[params.engine];
  const base: Record<string, unknown> = {
    user_prompt: params.prompt,
    model_name: engine.model,
    max_output_tokens: LLM_MAX_OUTPUT_TOKENS,
  };
  const country = params.countryIsoCode?.toUpperCase();

  switch (params.engine) {
    case "perplexity":
      // No `web_search`: Sonar models are always web-backed, and the parameter
      // does not exist on this engine.
      if (country !== undefined) base["web_search_country_iso_code"] = country;
      return base;

    case "gemini":
      // Has `web_search`, but no `force_web_search` and no geo targeting.
      base["web_search"] = true;
      return base;

    case "claude":
      base["web_search"] = true;
      base["force_web_search"] = true;
      if (country !== undefined && CLAUDE_WEB_SEARCH_COUNTRIES.has(country)) {
        base["web_search_country_iso_code"] = country;
      }
      return base;

    case "chat_gpt":
      base["web_search"] = true;
      base["force_web_search"] = true;
      if (country !== undefined) base["web_search_country_iso_code"] = country;
      return base;
  }
}

/* -------------------------------------------------------------------------- */
/* Response                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One source. `url` is the field name — not `link`, which is what every other
 * DataForSEO family calls it, and the single easiest thing to get wrong here.
 */
const annotationSchema = z.object({
  title: nullableString,
  url: nullableString,
  start_index: nullableNumber,
  end_index: nullableNumber,
  text: nullableString,
});

const sectionSchema = z.object({
  /** `"text"` on a message, `"summary_text"` on a reasoning chain. */
  type: nullableString,
  /** Nullable on a perfectly successful response — see the file header. */
  text: nullableString,
  annotations: z.array(annotationSchema).nullish().transform((v) => v ?? []),
});

const itemSchema = z.object({
  /** `"message"` or `"reasoning"`. */
  type: nullableString,
  sections: z.array(sectionSchema).nullish().transform((v) => v ?? []),
});

const resultSchema = z.object({
  /** The *resolved* model, e.g. `gpt-4o-mini-2024-07-18`. */
  model_name: nullableString,
  input_tokens: nullableNumber,
  output_tokens: nullableNumber,
  reasoning_tokens: nullableNumber,
  web_search: z.boolean().nullish().transform((v) => v ?? null),
  /** The LLM provider's own charge. `cost` is this plus the base fee. */
  money_spent: nullableNumber,
  /** "yyyy-mm-dd hh-mm-ss +00:00". */
  datetime: nullableString,
  items: z.array(itemSchema).nullish().transform((v) => v ?? []),
  /** Related queries the engine fanned out to. Absent on some engines. */
  fan_out_queries: z.array(z.string()).nullish().transform((v) => v ?? []),
});

export interface LlmAnnotation {
  title: string | null;
  url: string | null;
}

export interface LlmResponseResult extends WrappedMeta {
  engine: AiEngineId;
  /** The model that actually answered, as resolved upstream. */
  model: string | null;
  /**
   * Every `message` section's text, joined by blank lines. Empty string when
   * the engine returned none — a real outcome, not an error.
   */
  answerText: string;
  /** Every annotation across every message section, in order. */
  annotations: LlmAnnotation[];
  /** Just the URLs, nulls dropped — what the matcher consumes. */
  citationUrls: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  /** The provider's charge. `costUsd` is this plus DataForSEO's base fee. */
  moneySpentUsd: number | null;
  webSearch: boolean | null;
  fanOutQueries: string[];
  /** Everything upstream sent, for the R2 archive. */
  raw: unknown;
}

export interface AiOptimizationApi {
  /**
   * One prompt, one engine, one live answer. Billed; see the file header for
   * what "billed" means on this family.
   */
  llmResponseLive(params: LlmResponseParams): Promise<LlmResponseResult>;
  /** Free. The `model_name` values an engine currently accepts. */
  llmModels(engine: AiEngineId): Promise<LlmModel[]>;
}

/** One row of the free `models` endpoint. */
export interface LlmModel {
  modelName: string;
  reasoning: boolean;
  webSearchSupported: boolean;
  taskPostSupported: boolean;
}

const modelSchema = z.object({
  model_name: nullableString,
  reasoning: z.boolean().nullish().transform((v) => v ?? false),
  web_search_supported: z.boolean().nullish().transform((v) => v ?? false),
  task_post_supported: z.boolean().nullish().transform((v) => v ?? false),
});

export function createAiOptimizationApi(
  client: DataForSeoClient,
): AiOptimizationApi {
  return {
    async llmResponseLive(params) {
      const parsed = requestSchema.safeParse(params);
      if (!parsed.success) {
        throw new ApiException(
          "validation_failed",
          `Invalid AI prompt request (a prompt is 1–${AI_PROMPT_MAX_CHARS} characters).`,
          z.flattenError(parsed.error),
        );
      }
      if (AI_ENGINES[params.engine] === undefined) {
        throw new ApiException(
          "validation_failed",
          `Unknown AI engine "${params.engine}".`,
        );
      }

      const endpoint = llmResponsesLiveEndpoint(params.engine);
      const response = await client.request<unknown>({
        endpoint,
        payload: [buildLlmPayload(params)],
        /*
         * Never cached. Re-running the same prompt is the entire product —
         * the question is "has the answer changed?", so a cache hit would
         * answer "no" for free and be wrong. Results persist to D1 and R2.
         */
        ttl: "none",
        // One long attempt, no retry: see PATIENT_ATTEMPT_TIMEOUTS_MS.
        timeoutsMs: PATIENT_ATTEMPT_TIMEOUTS_MS,
      });

      const result = resultSchema.safeParse(response.results[0]);
      if (!result.success) {
        throw new ApiException(
          "upstream_error",
          `DataForSEO ${endpoint} returned an unrecognised result shape.`,
        );
      }
      const data = result.data;

      const texts: string[] = [];
      const annotations: LlmAnnotation[] = [];
      for (const item of data.items) {
        // Reasoning chains are the model's scratchpad, not its answer. Counting
        // a domain mentioned there as "mentioned" would credit visibility to
        // text no user ever sees.
        if (item.type !== "message") continue;
        for (const section of item.sections) {
          if (section.text !== null && section.text !== "") texts.push(section.text);
          for (const annotation of section.annotations) {
            annotations.push({ title: annotation.title, url: annotation.url });
          }
        }
      }

      return {
        engine: params.engine,
        model: data.model_name,
        answerText: texts.join("\n\n"),
        annotations,
        citationUrls: annotations
          .map((a) => a.url)
          .filter((url): url is string => url !== null && url !== ""),
        inputTokens: data.input_tokens,
        outputTokens: data.output_tokens,
        moneySpentUsd: data.money_spent,
        webSearch: data.web_search,
        fanOutQueries: data.fan_out_queries,
        raw: response.results[0],
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
      };
    },

    async llmModels(engine) {
      const response = await client.request<unknown>({
        endpoint: llmResponsesModelsEndpoint(engine),
        payload: [],
        method: "GET",
        ttl: "none",
        // DataForSEO bills this at $0 — it is a reference list, like
        // `tasks_ready`. A workspace at its cap must still be able to see
        // which models it could run.
        spendCapExempt: true,
      });

      const models: LlmModel[] = [];
      for (const raw of response.results) {
        const parsed = modelSchema.safeParse(raw);
        if (!parsed.success || parsed.data.model_name === null) continue;
        models.push({
          modelName: parsed.data.model_name,
          reasoning: parsed.data.reasoning,
          webSearchSupported: parsed.data.web_search_supported,
          taskPostSupported: parsed.data.task_post_supported,
        });
      }
      return models;
    },
  };
}
