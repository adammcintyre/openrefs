/**
 * The per-engine request payloads.
 *
 * These four engines share one endpoint family and almost no parameters, and
 * sending a field an engine does not know is an upstream rejection on a call
 * that still costs money. So the shapes are pinned here rather than trusted to
 * a shared object with optional keys.
 */
import { describe, expect, it } from "vitest";

import { AI_ENGINE_IDS, AI_ENGINES, estimateRunCostUsd } from "../../shared/ai";
import {
  buildLlmPayload,
  llmResponsesLiveEndpoint,
  llmResponsesModelsEndpoint,
} from "./ai";

describe("llmResponsesLiveEndpoint", () => {
  it("builds the documented path for every engine", () => {
    expect(llmResponsesLiveEndpoint("chat_gpt")).toBe(
      "ai_optimization/chat_gpt/llm_responses/live",
    );
    expect(llmResponsesLiveEndpoint("perplexity")).toBe(
      "ai_optimization/perplexity/llm_responses/live",
    );
    expect(llmResponsesModelsEndpoint("gemini")).toBe(
      "ai_optimization/gemini/llm_responses/models",
    );
  });

  it("has an endpoint for every engine we offer", () => {
    for (const id of AI_ENGINE_IDS) {
      expect(llmResponsesLiveEndpoint(id)).toContain(`/${id}/`);
    }
  });
});

describe("buildLlmPayload", () => {
  const prompt = "best sites for free photoshop templates";

  it("uses `user_prompt` and `model_name`, not `prompt` and `model`", () => {
    // The single easiest field to get wrong in this family.
    const payload = buildLlmPayload({ engine: "chat_gpt", prompt });
    expect(payload["user_prompt"]).toBe(prompt);
    expect(payload["model_name"]).toBe(AI_ENGINES.chat_gpt.model);
    expect(payload).not.toHaveProperty("prompt");
    expect(payload).not.toHaveProperty("model");
  });

  /*
   * Measured 2026-08-29: `web_search: true` alone left gpt-4o-mini answering
   * from training data — zero annotations, $0.000774. With force_web_search it
   * searched, cited three of our pages, and cost $0.027. Without this flag a
   * ChatGPT run can never produce a `cited` verdict.
   */
  it("forces the web search on the engines that support forcing it", () => {
    for (const engine of ["chat_gpt", "claude"] as const) {
      const payload = buildLlmPayload({ engine, prompt });
      expect(payload["web_search"]).toBe(true);
      expect(payload["force_web_search"]).toBe(true);
    }
  });

  it("sends no web_search flag to Perplexity, which is always web-backed", () => {
    const payload = buildLlmPayload({ engine: "perplexity", prompt });
    expect(payload).not.toHaveProperty("web_search");
    expect(payload).not.toHaveProperty("force_web_search");
  });

  it("sends web_search but not force_web_search to Gemini", () => {
    const payload = buildLlmPayload({ engine: "gemini", prompt });
    expect(payload["web_search"]).toBe(true);
    expect(payload).not.toHaveProperty("force_web_search");
  });

  it("never sends geo targeting to Gemini, which has no such parameter", () => {
    const payload = buildLlmPayload({
      engine: "gemini",
      prompt,
      countryIsoCode: "GB",
    });
    expect(payload).not.toHaveProperty("web_search_country_iso_code");
    expect(payload).not.toHaveProperty("web_search_city");
  });

  it("passes a country through where the engine accepts one", () => {
    for (const engine of ["chat_gpt", "claude", "perplexity"] as const) {
      const payload = buildLlmPayload({ engine, prompt, countryIsoCode: "gb" });
      expect(payload["web_search_country_iso_code"]).toBe("GB");
    }
  });

  /*
   * Claude documents a closed 36-country enum. Sending anything else is a
   * rejected task we would still be billed for, so an unlisted code is dropped
   * rather than forwarded.
   */
  it("drops a country Claude's documented enum does not list", () => {
    const payload = buildLlmPayload({
      engine: "claude",
      prompt,
      countryIsoCode: "NG",
    });
    expect(payload).not.toHaveProperty("web_search_country_iso_code");
    // ChatGPT documents no such restriction, so it still gets it.
    expect(
      buildLlmPayload({ engine: "chat_gpt", prompt, countryIsoCode: "NG" })[
        "web_search_country_iso_code"
      ],
    ).toBe("NG");
  });

  it("asks every engine for a bounded answer", () => {
    for (const id of AI_ENGINE_IDS) {
      expect(buildLlmPayload({ engine: id, prompt })["max_output_tokens"]).toBe(2048);
    }
  });
});

describe("estimateRunCostUsd", () => {
  it("sums the per-engine estimates", () => {
    expect(estimateRunCostUsd(["perplexity"])).toBe(
      AI_ENGINES.perplexity.estimatedCostUsd,
    );
    expect(estimateRunCostUsd(["perplexity", "chat_gpt"])).toBeCloseTo(
      AI_ENGINES.perplexity.estimatedCostUsd + AI_ENGINES.chat_gpt.estimatedCostUsd,
      6,
    );
  });

  it("is zero for no engines rather than NaN", () => {
    expect(estimateRunCostUsd([])).toBe(0);
  });

  it("keeps binary floating point out of the API response", () => {
    const total = estimateRunCostUsd(["perplexity", "chat_gpt", "claude", "gemini"]);
    expect(String(total).length).toBeLessThan(10);
  });

  it("orders the catalogue cheapest-first, as the UI presents it", () => {
    const costs = AI_ENGINE_IDS.map((id) => AI_ENGINES[id].estimatedCostUsd);
    // Perplexity is the cheapest and is the default engine for a new prompt.
    expect(Math.min(...costs)).toBe(AI_ENGINES.perplexity.estimatedCostUsd);
  });
});
