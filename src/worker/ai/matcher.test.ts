/**
 * The matcher's contract, pinned.
 *
 * Every mention-rate number in AI Visibility is a count of `matchAnswer`, so
 * these tests are the specification: the near-miss cases in particular are not
 * defensive extras but the reason the implementation is shaped the way it is.
 */
import { describe, expect, it } from "vitest";

import {
  derivableProjectName,
  extractHosts,
  hostFromUrl,
  isSameSite,
  matchAnswer,
  mentionedInText,
  normalizeHost,
  responseExcerpt,
} from "./matcher";

const DOMAIN = "brandpacks.com";

/** Convenience: the mention verdict for one block of prose. */
function mentions(text: string, domain = DOMAIN): boolean {
  return mentionedInText(text, domain) !== null;
}

describe("normalizeHost", () => {
  it("lowercases, strips www. and drops the root dot", () => {
    expect(normalizeHost("WWW.BrandPacks.COM.")).toBe("brandpacks.com");
    expect(normalizeHost("  brandpacks.com ")).toBe("brandpacks.com");
  });

  it("strips only a leading www, not a label that starts with it", () => {
    expect(normalizeHost("wwwbrandpacks.com")).toBe("wwwbrandpacks.com");
    expect(normalizeHost("www2.brandpacks.com")).toBe("www2.brandpacks.com");
  });
});

describe("isSameSite", () => {
  it("matches the domain itself, whatever the case or www", () => {
    expect(isSameSite("brandpacks.com", DOMAIN)).toBe(true);
    expect(isSameSite("BrandPacks.com", DOMAIN)).toBe(true);
    expect(isSameSite("www.brandpacks.com", DOMAIN)).toBe(true);
    expect(isSameSite("brandpacks.com.", DOMAIN)).toBe(true);
  });

  it("matches subdomains, however deep", () => {
    expect(isSameSite("blog.brandpacks.com", DOMAIN)).toBe(true);
    expect(isSameSite("cdn.assets.brandpacks.com", DOMAIN)).toBe(true);
    expect(isSameSite("www.blog.brandpacks.com", DOMAIN)).toBe(true);
  });

  /* The whole point of the dot in `.endsWith("." + root)`. */
  it("rejects near-miss hosts", () => {
    expect(isSameSite("notbrandpacks.com", DOMAIN)).toBe(false);
    expect(isSameSite("brandpacks.co", DOMAIN)).toBe(false);
    expect(isSameSite("brandpacks.com.evil.example", DOMAIN)).toBe(false);
    expect(isSameSite("mybrandpacks.com", DOMAIN)).toBe(false);
    expect(isSameSite("brandpacks-com.net", DOMAIN)).toBe(false);
  });

  it("does not treat a parent as a child", () => {
    // A project registered at a subdomain is not matched by the bare parent:
    // we cannot know the rest of that site is the same owner.
    expect(isSameSite("brandpacks.com", "blog.brandpacks.com")).toBe(false);
  });

  it("says no rather than throwing on empty input", () => {
    expect(isSameSite("", DOMAIN)).toBe(false);
    expect(isSameSite("brandpacks.com", "")).toBe(false);
  });
});

describe("hostFromUrl", () => {
  it("parses real URLs", () => {
    expect(hostFromUrl("https://brandpacks.com/free/templates?a=1#b")).toBe(
      "brandpacks.com",
    );
    expect(hostFromUrl("http://WWW.BrandPacks.com:8080/x")).toBe("brandpacks.com");
    expect(hostFromUrl("https://blog.brandpacks.com")).toBe("blog.brandpacks.com");
  });

  it("accepts a scheme-less host that still looks like one", () => {
    expect(hostFromUrl("brandpacks.com/templates")).toBe("brandpacks.com");
    expect(hostFromUrl("www.brandpacks.com")).toBe("brandpacks.com");
  });

  it("survives garbage without throwing", () => {
    for (const junk of [
      null,
      undefined,
      42,
      {},
      [],
      "",
      "   ",
      "not a url at all",
      "://",
      "https://",
      "http://[",
      "see their website",
    ]) {
      expect(hostFromUrl(junk)).toBeNull();
    }
  });

  it("refuses non-web schemes", () => {
    expect(hostFromUrl("javascript:alert(1)")).toBeNull();
    expect(hostFromUrl("data:text/html,<b>hi</b>")).toBeNull();
    expect(hostFromUrl("ftp://brandpacks.com/pub")).toBeNull();
    expect(hostFromUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("extractHosts", () => {
  it("finds hosts with and without a scheme and reports their range", () => {
    const text = "See https://brandpacks.com/a and also example.org today.";
    expect(extractHosts(text).map((h) => h.host)).toEqual([
      "brandpacks.com",
      "example.org",
    ]);
    const [first] = extractHosts(text);
    expect(text.slice(first?.start, first?.end)).toBe("brandpacks.com");
  });

  it("does not swallow a sentence-ending period", () => {
    const [host] = extractHosts("Try brandpacks.com.");
    expect(host?.host).toBe("brandpacks.com");
  });

  it("reads a longer host as itself, never as a suffix of it", () => {
    expect(extractHosts("notbrandpacks.com").map((h) => h.host)).toEqual([
      "notbrandpacks.com",
    ]);
  });

  it("ignores decimal numbers and version strings", () => {
    expect(extractHosts("3.14 and 1.2.3 and 2024.10").map((h) => h.host)).toEqual(
      [],
    );
  });
});

describe("mentionedInText — domain rule", () => {
  it("matches the plain domain", () => {
    expect(mentions("You could try brandpacks.com for that.")).toBe(true);
  });

  it("is case- and www-insensitive and ignores the path", () => {
    expect(mentions("Visit WWW.BrandPacks.COM/free-templates today")).toBe(true);
    expect(mentions("[link](https://brandpacks.com/templates/psd)")).toBe(true);
  });

  it("matches a subdomain", () => {
    expect(mentions("their blog at blog.brandpacks.com covers it")).toBe(true);
  });

  it("reports which substring matched, for highlighting", () => {
    const hit = mentionedInText("Go to www.BrandPacks.com now", DOMAIN);
    expect(hit).toMatchObject({ kind: "domain", text: "www.BrandPacks.com" });
    expect(hit?.index).toBe(6);
  });

  /* ---- the near-miss cases the feature's credibility rests on ---- */

  it("does NOT match a domain that merely ends with ours", () => {
    expect(mentions("Have you seen notbrandpacks.com?")).toBe(false);
    expect(mentions("mybrandpacks.com is unrelated")).toBe(false);
  });

  it("does NOT match the same name on another TLD", () => {
    expect(mentions("Have you seen brandpacks.co?")).toBe(false);
    expect(mentions("brandpacks.co.uk is a different company")).toBe(false);
    expect(mentions("brandpacks.net has other stuff")).toBe(false);
  });

  it("does NOT match our domain used as a subdomain of someone else", () => {
    expect(mentions("phishing at brandpacks.com.evil.example")).toBe(false);
  });

  it("does NOT match a hyphenated impostor", () => {
    expect(mentions("brandpacks-com.net is not us")).toBe(false);
  });
});

describe("mentionedInText — name rule", () => {
  it("matches the derivable name as a word", () => {
    const hit = mentionedInText("I'd recommend BrandPacks for those.", DOMAIN);
    expect(hit).toMatchObject({ kind: "name", text: "BrandPacks" });
  });

  it("does not match the name inside a longer word", () => {
    expect(mentions("superbrandpacks is something else")).toBe(false);
    expect(mentions("brandpacksters are a band")).toBe(false);
    expect(mentions("the super-brandpacks-clone site")).toBe(false);
  });

  /*
   * The reason `mentionedInText` blanks foreign hosts before the name pass:
   * "brandpacks.co" contains the literal token "brandpacks", so without that
   * step the near-miss would sneak back in through the name rule.
   */
  it("does not let a near-miss domain satisfy the name rule", () => {
    expect(mentions("Try brandpacks.co for templates")).toBe(false);
    expect(mentions("notbrandpacks.com is popular")).toBe(false);
    expect(mentions("see brandpacks.co.uk and brandpacks.net")).toBe(false);
  });

  it("still sees the brand named in prose beside a rival's domain", () => {
    // The prose genuinely names us; the link happens to go elsewhere.
    const hit = mentionedInText("BrandPacks (see brandpacks.co)", DOMAIN);
    expect(hit).toMatchObject({ kind: "name", text: "BrandPacks" });
  });

  it("accepts the ways a hyphenated brand gets written", () => {
    for (const text of ["brand-packs", "brand packs", "brandpacks", "Brand-Packs"]) {
      expect(mentions(`I like ${text} a lot`, "brand-packs.com")).toBe(true);
    }
  });

  it("is off for a name too generic to be evidence", () => {
    // "templates" appears in every answer about templates; only the domain and
    // the citations speak for a project named like this.
    expect(mentions("there are lots of free templates around", "templates.com")).toBe(
      false,
    );
    expect(mentions("go to templates.com", "templates.com")).toBe(true);
  });

  it("is off for a name too short to be evidence", () => {
    expect(mentions("the abc of design", "abc.com")).toBe(false);
  });
});

describe("derivableProjectName", () => {
  it("takes the label left of the public suffix", () => {
    expect(derivableProjectName("brandpacks.com")).toBe("brandpacks");
    expect(derivableProjectName("www.brandpacks.com")).toBe("brandpacks");
    expect(derivableProjectName("blog.brandpacks.com")).toBe("brandpacks");
    expect(derivableProjectName("cdn.assets.brandpacks.io")).toBe("brandpacks");
  });

  it("understands two-level country suffixes", () => {
    expect(derivableProjectName("brandpacks.co.uk")).toBe("brandpacks");
    expect(derivableProjectName("shop.brandpacks.com.au")).toBe("brandpacks");
    // `.co` on its own is a TLD, not a suffix pair.
    expect(derivableProjectName("brandpacks.co")).toBe("brandpacks");
  });

  it("returns null when no name is clearly derivable", () => {
    expect(derivableProjectName("templates.com")).toBeNull();
    expect(derivableProjectName("abc.com")).toBeNull();
    expect(derivableProjectName("123.com")).toBeNull();
    expect(derivableProjectName("localhost")).toBeNull();
    expect(derivableProjectName("")).toBeNull();
  });

  it("keeps a hyphenated name whole", () => {
    expect(derivableProjectName("brand-packs.com")).toBe("brand-packs");
  });
});

describe("matchAnswer — citations", () => {
  const answer = "There are lots of options for free PSD templates.";

  it("marks a citation on our domain as ours", () => {
    const result = matchAnswer({
      domain: DOMAIN,
      answerText: answer,
      citationUrls: [
        "https://www.brandpacks.com/free-templates",
        "https://example.org/other",
      ],
    });
    expect(result.cited).toBe(true);
    expect(result.citedUrls).toEqual(["https://www.brandpacks.com/free-templates"]);
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0]).toMatchObject({ host: "brandpacks.com", ours: true });
    expect(result.citations[1]).toMatchObject({ host: "example.org", ours: false });
  });

  it("counts a subdomain citation as ours", () => {
    const result = matchAnswer({
      domain: DOMAIN,
      answerText: answer,
      citationUrls: ["https://blog.brandpacks.com/post/1"],
    });
    expect(result.cited).toBe(true);
  });

  it("does NOT count a near-miss citation", () => {
    const result = matchAnswer({
      domain: DOMAIN,
      answerText: answer,
      citationUrls: [
        "https://notbrandpacks.com/x",
        "https://brandpacks.co/y",
        "https://brandpacks.com.evil.example/z",
      ],
    });
    expect(result.cited).toBe(false);
    expect(result.citedUrls).toEqual([]);
    expect(result.citations).toHaveLength(3);
  });

  it("keeps unusable citations with a null host instead of dropping them", () => {
    const result = matchAnswer({
      domain: DOMAIN,
      answerText: answer,
      citationUrls: ["javascript:alert(1)", "not a url", null, 7, ""],
    });
    expect(result.cited).toBe(false);
    // The two non-empty strings survive as unusable; null, 7 and "" carry
    // nothing a UI could render.
    expect(result.citations.map((c) => c.host)).toEqual([null, null]);
  });

  it("is independent of the mention verdict", () => {
    const cited = matchAnswer({
      domain: DOMAIN,
      answerText: "Several sites offer these.",
      citationUrls: ["https://brandpacks.com/a"],
    });
    expect(cited).toMatchObject({ mentioned: false, cited: true });

    const named = matchAnswer({
      domain: DOMAIN,
      answerText: "BrandPacks is one option.",
      citationUrls: ["https://example.org/a"],
    });
    expect(named).toMatchObject({ mentioned: true, cited: false });
  });

  it("reports the terms the UI should highlight", () => {
    const result = matchAnswer({
      domain: DOMAIN,
      answerText: "Try WWW.BrandPacks.com/free for those.",
      citationUrls: [],
    });
    expect(result.mentionTerms).toEqual(["www.brandpacks.com"]);
    expect(result.mentionKind).toBe("domain");
    expect(result.mentionIndex).toBe(4);
  });
});

describe("responseExcerpt", () => {
  it("returns a short answer whole", () => {
    expect(responseExcerpt("short answer")).toBe("short answer");
  });

  it("caps at the limit, ellipsis included", () => {
    const long = "a".repeat(5000);
    const excerpt = responseExcerpt(long);
    expect(excerpt.length).toBeLessThanOrEqual(2000);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("centres the window on the mention so the drill-down proves something", () => {
    const mentionAt = 4000;
    const text = `${"x".repeat(mentionAt)}brandpacks.com${"y".repeat(2000)}`;
    const excerpt = responseExcerpt(text, mentionAt);
    expect(excerpt).toContain("brandpacks.com");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(2000);
  });

  it("takes the opening when there is no mention", () => {
    const text = `START${"z".repeat(5000)}`;
    expect(responseExcerpt(text, -1).startsWith("START")).toBe(true);
  });

  it("never exceeds a custom limit, even a degenerate one", () => {
    for (const limit of [1, 2, 5, 50]) {
      expect(responseExcerpt("q".repeat(500), 200, limit).length).toBeLessThanOrEqual(
        limit + 1,
      );
    }
  });
});

describe("matchAnswer — a realistic answer", () => {
  const answer = [
    "If you're after free Photoshop templates, a few sites stand out.",
    "BrandPacks (brandpacks.com) publishes free PSD and AI templates,",
    "while Freepik and notbrandpacks.com cover a wider range.",
  ].join(" ");

  it("reports mentioned + cited with the right citation", () => {
    const result = matchAnswer({
      domain: DOMAIN,
      answerText: answer,
      citationUrls: [
        "https://www.brandpacks.com/free-photoshop-templates/",
        "https://www.freepik.com/",
        "https://notbrandpacks.com/",
      ],
    });

    expect(result.mentioned).toBe(true);
    expect(result.mentionKind).toBe("domain");
    expect(result.cited).toBe(true);
    expect(result.citedUrls).toHaveLength(1);
    expect(result.citations.filter((c) => c.ours)).toHaveLength(1);
  });
});
