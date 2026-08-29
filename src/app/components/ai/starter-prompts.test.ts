import { describe, expect, it } from "vitest";

import { AI_PROMPT_MAX_CHARS } from "../../../shared/ai";
import { brandName, starterPrompts } from "./starter-prompts";

describe("brandName", () => {
  it("uses the project name when there is one", () => {
    expect(brandName({ name: "BrandPacks", domain: "brandpacks.com" })).toBe(
      "BrandPacks",
    );
  });

  it("falls back to the domain's own label, not the whole host", () => {
    expect(brandName({ name: "", domain: "brandpacks.com" })).toBe("brandpacks");
    expect(brandName({ name: "   ", domain: "www.brandpacks.com" })).toBe(
      "brandpacks",
    );
  });

  /*
   * "everything before the last dot" would render "Best alternatives to
   * brandpacks.co" — a URL fragment where a brand name belongs.
   */
  it("drops a two-part public suffix", () => {
    expect(brandName({ name: "", domain: "brandpacks.co.uk" })).toBe(
      "brandpacks",
    );
    expect(brandName({ name: "", domain: "www.example.com.au" })).toBe(
      "example",
    );
  });

  it("reads a hyphenated label as words", () => {
    expect(brandName({ name: "", domain: "photo-booth-templates.com" })).toBe(
      "photo booth templates",
    );
  });

  it("degrades to something sayable rather than throwing", () => {
    expect(brandName({ name: "", domain: "" })).toBe("this site");
    expect(brandName({ name: "", domain: "localhost" })).toBe("localhost");
  });
});

describe("starterPrompts", () => {
  const project = { name: "BrandPacks", domain: "brandpacks.com" };

  it("offers three distinct suggestions naming the brand", () => {
    const prompts = starterPrompts(project);

    expect(prompts).toHaveLength(3);
    expect(new Set(prompts).size).toBe(3);
    for (const prompt of prompts) {
      expect(prompt).toContain("BrandPacks");
    }
  });

  /*
   * Every suggestion is posted straight to an endpoint that rejects anything
   * over the cap with a 422, so a long project name must not be able to build
   * a chip that cannot be saved.
   */
  it("stays inside the prompt length cap even for an absurd brand name", () => {
    const prompts = starterPrompts({
      name: "x".repeat(400),
      domain: "example.com",
    });

    for (const prompt of prompts) {
      expect(prompt.length).toBeLessThanOrEqual(AI_PROMPT_MAX_CHARS);
    }
  });
});
