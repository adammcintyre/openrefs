/**
 * `on_page/content_parsing/live` — and the word count it does not return.
 *
 * The endpoint has no `word_count` field of any kind, so the number this
 * product shows is derived from the text blocks. What is worth pinning is
 * exactly which blocks feed it (the article, not the nav) and that a page the
 * crawler could not read comes back as a null rather than an exception.
 */
import { describe, expect, it } from "vitest";

import type {
  DataForSeoClient,
  DataForSeoRequest,
  DataForSeoResponse,
} from "./client";
import {
  CONTENT_PARSING_PRICE_PER_URL_USD,
  ON_PAGE_CONTENT_PARSING_LIVE,
  countWords,
  createOnPageApi,
  toParsedPageContent,
} from "./on-page";

function fakeClient(result: unknown): {
  client: DataForSeoClient;
  requests: DataForSeoRequest<unknown>[];
} {
  const requests: DataForSeoRequest<unknown>[] = [];
  const client: DataForSeoClient = {
    async request<TResult>(
      req: DataForSeoRequest<unknown>,
    ): Promise<DataForSeoResponse<TResult>> {
      requests.push(req);
      return {
        results: [result as TResult],
        tasks: [],
        costUsd: CONTENT_PARSING_PRICE_PER_URL_USD,
        cached: false,
        stale: false,
        statusCode: 20000,
        statusMessage: "Ok.",
      };
    },
    async balance() {
      return { balanceUsd: 0 };
    },
  };
  return { client, requests };
}

/** A parsed page, in the documented shape. Body: 6 + 4 words. */
const parsedItem = {
  type: "content_parsing_element",
  status_code: 200,
  page_content: {
    header: {
      primary_content: [{ text: "Home Products Pricing Blog About Contact" }],
    },
    main_topic: [
      {
        h_title: "Photo booth templates",
        level: 1,
        primary_content: [{ text: "Six words of real body text" }],
        secondary_content: [{ text: "and four more here" }],
      },
    ],
    secondary_topic: [],
    footer: {
      primary_content: [{ text: "Copyright 2026 all rights reserved everywhere" }],
    },
  },
};

const okResult = { items: [parsedItem] };

describe("countWords", () => {
  it("counts whitespace-separated tokens carrying a letter or digit", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  padded   out  ")).toBe(2);
    expect(countWords("")).toBe(0);
  });

  it("ignores punctuation-only tokens, so bullets do not inflate a count", () => {
    expect(countWords("- item one — item two")).toBe(4);
    expect(countWords("• • •")).toBe(0);
  });

  it("counts numbers and accented words as words", () => {
    expect(countWords("2026 déjà vu")).toBe(3);
  });
});

describe("toParsedPageContent", () => {
  it("counts the article body and excludes the nav and footer", () => {
    // The whole reason for deriving this rather than using instant_pages'
    // whole-page `plain_text_word_count`: "how long is this article" must not
    // include the menu.
    const parsed = toParsedPageContent("https://example.com/a", parsedItem, {
      costUsd: CONTENT_PARSING_PRICE_PER_URL_USD,
      cached: false,
    });
    expect(parsed.wordCount).toBe(10);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.itemType).toBe("content_parsing_element");
  });

  it('returns null for DataForSEO\'s "broken" marker, not a zero', () => {
    // A page that refused the crawler has an unknown length, and 0 would read
    // as "this article is empty".
    const parsed = toParsedPageContent(
      "https://example.com/blocked",
      { type: "broken", status_code: 403, page_content: null },
      { costUsd: CONTENT_PARSING_PRICE_PER_URL_USD, cached: false },
    );
    expect(parsed.wordCount).toBeNull();
    expect(parsed.itemType).toBe("broken");
    expect(parsed.statusCode).toBe(403);
  });

  it("returns null for a non-2xx page even when it parsed", () => {
    const parsed = toParsedPageContent(
      "https://example.com/gone",
      { ...parsedItem, status_code: 404 },
      { costUsd: CONTENT_PARSING_PRICE_PER_URL_USD, cached: false },
    );
    expect(parsed.wordCount).toBeNull();
  });

  it("returns null when there was no item at all", () => {
    const parsed = toParsedPageContent("https://example.com/x", undefined, {
      costUsd: 0,
      cached: true,
    });
    expect(parsed.wordCount).toBeNull();
    expect(parsed.url).toBe("https://example.com/x");
  });

  it("counts 0 for a reachable page with no body — a real answer, not unknown", () => {
    const parsed = toParsedPageContent(
      "https://example.com/empty",
      {
        type: "content_parsing_element",
        status_code: 200,
        page_content: { main_topic: [], secondary_topic: [] },
      },
      { costUsd: CONTENT_PARSING_PRICE_PER_URL_USD, cached: false },
    );
    expect(parsed.wordCount).toBe(0);
  });
});

describe("contentParsingLive", () => {
  it("sends ONE url per call and never the expensive rendering flags", async () => {
    const { client, requests } = fakeClient(okResult);

    await createOnPageApi(client).contentParsingLive({
      url: "https://example.com/a",
    });

    expect(requests[0]?.endpoint).toBe(ON_PAGE_CONTENT_PARSING_LIVE);
    expect(requests[0]?.ttl).toBe("long");
    const payload = requests[0]?.payload as Record<string, unknown>[];
    expect(payload).toHaveLength(1);
    expect(payload[0]?.["url"]).toBe("https://example.com/a");
    // 10× and 34× the per-page price respectively; a word count is not worth
    // either.
    expect(payload[0]?.["enable_javascript"]).toBeUndefined();
    expect(payload[0]?.["enable_browser_rendering"]).toBeUndefined();
    // Their documented fix for the "broken" failure mode, and it is free.
    expect(payload[0]?.["accept_language"]).toBeDefined();
  });

  it("reports the URL it was asked about, so a fan-out can align by it", async () => {
    const { client } = fakeClient(okResult);
    const parsed = await createOnPageApi(client).contentParsingLive({
      url: "https://example.com/a",
    });
    expect(parsed.url).toBe("https://example.com/a");
    expect(parsed.wordCount).toBe(10);
    expect(parsed.costUsd).toBe(CONTENT_PARSING_PRICE_PER_URL_USD);
  });

  it("does not throw when the response carries no items", async () => {
    const { client } = fakeClient({ items: [] });
    const parsed = await createOnPageApi(client).contentParsingLive({
      url: "https://example.com/a",
    });
    expect(parsed.wordCount).toBeNull();
  });
});
