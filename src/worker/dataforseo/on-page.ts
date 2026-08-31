/**
 * `on_page/*` — DataForSEO's crawler. We orchestrate, ingest and present; the
 * crawling is theirs.
 *
 * Shapes and prices verified against https://docs.dataforseo.com/v3/on_page/
 * (2026-08-29). Six things here are counter-intuitive enough to state plainly,
 * because each one is a bug if you assume otherwise:
 *
 *  1. **Only `task_post` is billed.** Every result endpoint says so verbatim:
 *     "Your account will not be charged for using this function. You can get
 *     the results of the task within the next 30 days for free." `summary` and
 *     `lighthouse/task_get` say "charged only for posting a task". So retrieval
 *     is `spendCapExempt` + `resultsPrepaid`, exactly like SERP `task_get` —
 *     a workspace at its cap must still be able to collect a crawl it paid for.
 *  2. **The crawl is charged per page, up front, and refunded.** "Your account
 *     is charged for the actual number of crawled pages. If you specified more
 *     pages than a website contains, the difference will be refunded to your
 *     account after a task is completed." So `max_crawl_pages` × rate is a
 *     ceiling, not a bill.
 *  3. **`summary` is a GET with the id in the path**; the section endpoints are
 *     POSTs with the id in the body. They are not symmetrical.
 *  4. **`duplicate_tags` requires `type`, and its values are
 *     `duplicate_title` / `duplicate_description`** — not `title` /
 *     `description`, which is the natural guess and returns an error.
 *  5. **`broken_links`, `broken_resources`, `duplicate_title`,
 *     `duplicate_description` and `duplicate_content` are top-level booleans on
 *     a page item, NOT members of its `checks` map.** The taxonomy folds them
 *     in as synthetic checks; reading only `checks` silently loses them.
 *  6. **Lighthouse is raw Lighthouse JSON — camelCase, scores 0–1**, and its
 *     category keys are hyphenated (`best-practices`) even though the request
 *     takes underscores (`best_practices`).
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import {
  DFS_RESULTS_EXPIRED_STATUS,
  DFS_TASK_CREATED_STATUS,
  DFS_TASK_HANDED_STATUS,
  DFS_TASK_IN_QUEUE_STATUS,
  DFS_TASK_NOT_FOUND_STATUS,
} from "./client";
import { nullableNumber, nullableString } from "./schema";

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export const ON_PAGE_CONTENT_PARSING_LIVE = "on_page/content_parsing/live";
export const ON_PAGE_TASK_POST = "on_page/task_post";
export const ON_PAGE_SUMMARY = "on_page/summary";
export const ON_PAGE_PAGES = "on_page/pages";
export const ON_PAGE_NON_INDEXABLE = "on_page/non_indexable";
export const ON_PAGE_DUPLICATE_TAGS = "on_page/duplicate_tags";
export const ON_PAGE_REDIRECT_CHAINS = "on_page/redirect_chains";
export const ON_PAGE_LINKS = "on_page/links";
export const LIGHTHOUSE_TASK_POST = "on_page/lighthouse/task_post";
/** Family label for metering; the id goes in the URL. */
export const LIGHTHOUSE_TASK_GET = "on_page/lighthouse/task_get/json";

/** `summary/<id>` — GET, id in the path. */
export function summaryEndpoint(taskId: string): string {
  return `${ON_PAGE_SUMMARY}/${encodeURIComponent(taskId)}`;
}

/** `lighthouse/task_get/json/<id>` — GET, id in the path. */
export function lighthouseTaskGetEndpoint(taskId: string): string {
  return `${LIGHTHOUSE_TASK_GET}/${encodeURIComponent(taskId)}`;
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where every price below came from, so the next person can re-check them
 * rather than trust a constant:
 *
 *   https://dataforseo.com/pricing/on-page/onpage-api
 *   https://dataforseo.com/help-center/cost-of-onpage-api-parameters
 *   https://dataforseo.com/pricing/on-page/lighthouse-api
 *
 * Verified 2026-08-29. Note that the worked examples inside the API *docs*
 * (`"cost": 0.00125` on the task_post page, `0.00425` on Lighthouse) are stale
 * — they date from a 2020 response sample and do not match the current price
 * list. The pricing pages are authoritative; the doc samples are not.
 */
export const ON_PAGE_PRICE_SOURCE =
  "https://dataforseo.com/pricing/on-page/onpage-api";

/** Basic crawl, USD per crawled page. $0.15 per 1000. */
export const ON_PAGE_PRICE_PER_PAGE_USD = 0.00015;

/**
 * With `enable_javascript: true`, USD per page — **10× basic**.
 *
 * Their formula is `basic + basic × 9`, which is why the UI's "≈2× cost" hint
 * in docs/specs/PHASE4.md is wrong by five times. The spec was written before
 * the price list was checked; this constant is the number to show.
 */
export const ON_PAGE_PRICE_PER_PAGE_JS_USD = 0.0015;

/**
 * With `load_resources: true`, USD per page (`basic + basic × 2`). Not used by
 * the audit flow yet — kept because it is the other half of the cost model and
 * the next person to add a toggle will need it.
 */
export const ON_PAGE_PRICE_PER_PAGE_RESOURCES_USD = 0.00045;

/**
 * With `enable_browser_rendering: true`, USD per page (`basic + basic × 33`,
 * and it implies the other two). This is what real LCP/CLS/FID in
 * `page_timing` would cost — 34× basic — which is why v1 takes Core Web Vitals
 * from one Lighthouse run on the homepage instead.
 */
export const ON_PAGE_PRICE_PER_PAGE_RENDERING_USD = 0.0051;

/**
 * One Lighthouse task, USD. Flat per scanned page, identical for the standard
 * queue and live mode ("Your account will be billed only for setting a task").
 *
 * Worth noticing: at $0.005 a single Lighthouse run costs more than an entire
 * 25-page basic crawl ($0.00375). That is the whole argument for homepage-only
 * Lighthouse in v1.
 */
export const LIGHTHOUSE_PRICE_PER_TASK_USD = 0.005;

/** USD per page for a crawl with these options. */
export function perPageCostUsd(renderJs: boolean): number {
  return renderJs
    ? ON_PAGE_PRICE_PER_PAGE_JS_USD
    : ON_PAGE_PRICE_PER_PAGE_USD;
}

/**
 * What an audit is expected to cost: the crawl ceiling plus one Lighthouse run.
 *
 * A ceiling, not a bill — DataForSEO refund the difference when a site turns
 * out to have fewer pages than requested (see note 2 at the top). The UI must
 * present it as "up to".
 */
export function estimateCrawlCostUsd(
  maxCrawlPages: number,
  renderJs: boolean,
): number {
  const crawl = maxCrawlPages * perPageCostUsd(renderJs);
  return round6(crawl + LIGHTHOUSE_PRICE_PER_TASK_USD);
}

function round6(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * One `content_parsing/live` call, USD — "$0.00015 /per parsed page", the same
 * rate as a crawled page and as Instant Pages. Their docs say so explicitly:
 * "The cost is identical to that of Instant Pages".
 *
 * We send no `enable_javascript` and no `enable_browser_rendering`, so the
 * 10× and 34× multipliers documented for the crawl parameters cannot apply —
 * which is deliberate, because a word count is not worth ten times its price.
 */
export const CONTENT_PARSING_PRICE_PER_URL_USD = 0.00015;

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

/** Documented ceiling on `limit` for every paged section endpoint. */
export const ON_PAGE_MAX_SECTION_LIMIT = 1000;

/**
 * Pages we pull per section, per audit.
 *
 * One call covers the largest crawl we offer (1000 pages), so this is a single
 * request in every real case; the cap exists so a section that unexpectedly
 * pages forever cannot turn one job into hundreds of subrequests.
 */
export const ON_PAGE_MAX_SECTION_PULLS = 5;

/**
 * The two `duplicate_tags` types. Not `"title"` / `"description"` — see note 4
 * at the top of this file.
 */
export const DUPLICATE_TAG_TYPES = [
  "duplicate_title",
  "duplicate_description",
] as const;
export type DuplicateTagType = (typeof DUPLICATE_TAG_TYPES)[number];

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

const crawlStatusSchema = z
  .object({
    max_crawl_pages: nullableNumber,
    pages_in_queue: nullableNumber,
    pages_crawled: nullableNumber,
  })
  .nullish();

const domainInfoSchema = z
  .object({
    name: nullableString,
    cms: nullableString,
    ip: nullableString,
    server: nullableString,
    crawl_start: nullableString,
    crawl_end: nullableString,
    /**
     * How the crawl went at the domain level. The only place a blocked crawler
     * is reported — a site that refuses us still returns a *finished* task, so
     * this field is the difference between "clean site" and "we saw nothing".
     * Values: no_errors | site_unreachable | invalid_page_status_code |
     * forbidden_meta_tag | forbidden_robots | forbidden_http_header |
     * too_many_redirects | unknown.
     */
    extended_crawl_status: nullableString,
    total_pages: nullableNumber,
    checks: z.record(z.string(), z.unknown()).nullish(),
  })
  .nullish();

const pageMetricsSchema = z
  .object({
    links_external: nullableNumber,
    links_internal: nullableNumber,
    duplicate_title: nullableNumber,
    duplicate_description: nullableNumber,
    duplicate_content: nullableNumber,
    broken_links: nullableNumber,
    broken_resources: nullableNumber,
    links_relation_conflict: nullableNumber,
    redirect_loop: nullableNumber,
    /** 0–100, DataForSEO's own. Our "Page Score". */
    onpage_score: nullableNumber,
    non_indexable: nullableNumber,
    checks: z.record(z.string(), z.unknown()).nullish(),
  })
  .nullish();

const summaryResultSchema = z.object({
  /** Only two documented values: "in_progress" and "finished". */
  crawl_progress: nullableString,
  crawl_status: crawlStatusSchema,
  /** limit_exceeded | empty_queue | force_stopped | unexpected_exception */
  crawl_stop_reason: nullableString,
  domain_info: domainInfoSchema,
  page_metrics: pageMetricsSchema,
});

export interface OnPageSummary {
  /** True only when `crawl_progress === "finished"`. */
  finished: boolean;
  crawlProgress: string;
  crawlStopReason: string | null;
  pagesCrawled: number;
  pagesInQueue: number;
  maxCrawlPages: number | null;
  /** 0–100, or null before anything has been crawled. */
  onPageScore: number | null;
  domain: string | null;
  /** See `domain_info.extended_crawl_status`. */
  extendedCrawlStatus: string | null;
  /** Site-level boolean checks (sitemap, robots_txt, ssl, http2, test_*). */
  domainChecks: Record<string, boolean>;
  brokenLinks: number;
  brokenResources: number;
  nonIndexable: number;
  duplicateTitle: number;
  duplicateDescription: number;
  duplicateContent: number;
}

/**
 * One crawled page. Deliberately a *partial* projection of a very large item:
 * only the fields the audit renders or classifies are named, and `checks` is
 * kept as an open record because the taxonomy — not this parser — decides what
 * a check means.
 */
const pageItemSchema = z.object({
  resource_type: nullableString,
  status_code: nullableNumber,
  url: nullableString,
  onpage_score: nullableNumber,
  size: nullableNumber,
  encoded_size: nullableNumber,
  total_transfer_size: nullableNumber,
  click_depth: nullableNumber,
  /** Top-level booleans, NOT inside `checks`. See note 5 at the top. */
  broken_links: z.boolean().nullish(),
  broken_resources: z.boolean().nullish(),
  duplicate_title: z.boolean().nullish(),
  duplicate_description: z.boolean().nullish(),
  duplicate_content: z.boolean().nullish(),
  checks: z.record(z.string(), z.unknown()).nullish(),
  meta: z
    .object({
      title: nullableString,
      description: nullableString,
      canonical: nullableString,
      title_length: nullableNumber,
      description_length: nullableNumber,
      internal_links_count: nullableNumber,
      external_links_count: nullableNumber,
      images_count: nullableNumber,
      scripts_count: nullableNumber,
      render_blocking_scripts_count: nullableNumber,
      cumulative_layout_shift: nullableNumber,
      htags: z.record(z.string(), z.unknown()).nullish(),
      /**
       * Open Graph and Twitter card tags, keyed by tag name (`og:title`,
       * `twitter:card`, …). There is no `checks` entry for social markup, so
       * this object being absent or empty is the only signal — which is what
       * the derived `no_social_media_tags` check reads.
       */
      social_media_tags: z.record(z.string(), z.unknown()).nullish(),
      content: z
        .object({
          plain_text_word_count: nullableNumber,
          plain_text_rate: nullableNumber,
          automated_readability_index: nullableNumber,
        })
        .nullish(),
    })
    .nullish(),
  page_timing: z
    .object({
      time_to_interactive: nullableNumber,
      dom_complete: nullableNumber,
      largest_contentful_paint: nullableNumber,
      first_input_delay: nullableNumber,
      waiting_time: nullableNumber,
      duration_time: nullableNumber,
    })
    .nullish(),
});

export type OnPagePageItem = z.infer<typeof pageItemSchema>;

const sectionResultSchema = z.object({
  crawl_progress: nullableString,
  total_items_count: nullableNumber,
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

/** `duplicate_tags` uses a different envelope — pages, not items. */
const duplicateTagsResultSchema = z.object({
  crawl_progress: nullableString,
  total_pages_count: nullableNumber,
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

export interface SectionPull<T> {
  items: T[];
  totalItems: number;
  /** The raw response results, stored to R2 verbatim. */
  raw: unknown[];
}

/* -------------------------------------------------------------------------- */
/* Content parsing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `on_page/content_parsing/live` — one page's text, structured.
 *
 * Verified against https://docs.dataforseo.com/v3/on_page/content_parsing/
 * live/ (2026-08-29). Three findings shape everything below, and two of them
 * contradict what a caller would reasonably assume:
 *
 *  1. **ONE URL PER CALL.** `url` is singular and their live-endpoint rule is
 *     explicit: "each Live API call can contain only one task". There is no
 *     array form and no batching — N URLs is N POSTs, which is why the wrapper
 *     exposes a single-URL function and the route fans out.
 *  2. **It returns NO word count.** There is no `word_count`, no
 *     `plain_text_word_count`, and no `meta` object anywhere in this response.
 *     The count has to be derived from the text blocks, which `countWords`
 *     below does — walking `main_topic`/`secondary_topic` and deliberately
 *     skipping `header`, `footer` and `comments`, so the number means "how long
 *     is this article" rather than "how much text is on this page including the
 *     nav". (`on_page/instant_pages` *does* return
 *     `meta.content.plain_text_word_count` at the same price — but that is a
 *     whole-page figure with the boilerplate in it, which is the wrong number
 *     for a content-length column.)
 *  3. **A page it could not fetch is not a task error.** `items[].type` comes
 *     back `"broken"` (their word, documented against `accept_language`), and
 *     `items[].status_code` is the *page's* HTTP status, not DataForSEO's. So
 *     both have to be checked before reading `page_content`, and a failure is
 *     a null word count rather than a thrown request.
 */

/**
 * One text block. `text` is the field carrying prose; `urls` carries the
 * anchors inside it, which we do not consume but which is why a block is an
 * object rather than a string.
 */
const contentBlockSchema = z.object({
  text: nullableString,
});

/**
 * A content section: the shape shared by `header`, `footer` and every entry of
 * `main_topic` / `secondary_topic`.
 */
const contentSectionSchema = z
  .object({
    primary_content: z.array(contentBlockSchema).nullish(),
    secondary_content: z.array(contentBlockSchema).nullish(),
  })
  .nullish();

const contentParsingItemSchema = z.object({
  /** "content_parsing_element" on success, "broken" when access was refused. */
  type: nullableString,
  /** The fetched page's own HTTP status — not DataForSEO's task status. */
  status_code: nullableNumber,
  page_content: z
    .object({
      /**
       * Both are ARRAYS of sections here, unlike `header`/`footer` which are
       * single objects. The article body is `main_topic`.
       */
      main_topic: z.array(contentSectionSchema).nullish(),
      secondary_topic: z.array(contentSectionSchema).nullish(),
      header: contentSectionSchema,
      footer: contentSectionSchema,
    })
    .nullish(),
});

const contentParsingResultSchema = z.object({
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

/** What one URL's parse yielded. Every field is null when the fetch failed. */
export interface ParsedPageContent {
  /** The URL as asked for, so a caller can align a fan-out by it. */
  url: string;
  /**
   * Words in the article body — `main_topic` plus `secondary_topic`, excluding
   * nav, footer and comments. Null when the page could not be parsed.
   */
  wordCount: number | null;
  /** The page's own HTTP status, when it answered at all. */
  statusCode: number | null;
  /** `items[].type`; "broken" is DataForSEO's marker for a refused fetch. */
  itemType: string | null;
  /** USD billed for this one URL. */
  costUsd: number;
  cached: boolean;
  stale?: boolean;
}

/**
 * Words in a run of text.
 *
 * Whitespace-separated tokens containing at least one letter or digit, so
 * markdown bullets, stray punctuation and the separators between blocks do not
 * inflate the count. Deliberately naive about languages that do not delimit
 * words with spaces — for those the number is an undercount, which is honest
 * enough for a "how long is this article" column and better than pretending to
 * segment Japanese.
 */
export function countWords(text: string): number {
  let words = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) words += 1;
  }
  return words;
}

/** Every `text` in a section's primary and secondary blocks. */
function sectionWords(
  section: z.infer<typeof contentSectionSchema>,
): number {
  if (!section) return 0;
  let words = 0;
  for (const blocks of [section.primary_content, section.secondary_content]) {
    for (const block of blocks ?? []) {
      if (block.text) words += countWords(block.text);
    }
  }
  return words;
}

/**
 * The article's word count, or null when this item is not a parsed page.
 *
 * Header, footer and comments are excluded on purpose — see note 2 at the top
 * of this section. A 200-page with genuinely empty `main_topic` counts 0, which
 * is a real answer ("this page has no body text"), distinct from null.
 */
export function toParsedPageContent(
  url: string,
  raw: unknown,
  meta: { costUsd: number; cached: boolean; stale?: boolean },
): ParsedPageContent {
  const parsed = contentParsingItemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      url,
      wordCount: null,
      statusCode: null,
      itemType: null,
      costUsd: meta.costUsd,
      cached: meta.cached,
      stale: meta.stale,
    };
  }

  const item = parsed.data;
  const reachable =
    item.type === "content_parsing_element" &&
    item.status_code !== null &&
    item.status_code >= 200 &&
    item.status_code < 300;

  if (!reachable || !item.page_content) {
    return {
      url,
      wordCount: null,
      statusCode: item.status_code,
      itemType: item.type,
      costUsd: meta.costUsd,
      cached: meta.cached,
      stale: meta.stale,
    };
  }

  let words = 0;
  for (const topic of item.page_content.main_topic ?? []) {
    words += sectionWords(topic);
  }
  for (const topic of item.page_content.secondary_topic ?? []) {
    words += sectionWords(topic);
  }

  return {
    url,
    wordCount: words,
    statusCode: item.status_code,
    itemType: item.type,
    costUsd: meta.costUsd,
    cached: meta.cached,
    stale: meta.stale,
  };
}

/* -------------------------------------------------------------------------- */
/* Lighthouse                                                                  */
/* -------------------------------------------------------------------------- */

const lighthouseAuditSchema = z.object({
  /** 0–1, or null for informative audits. */
  score: nullableNumber,
  numericValue: nullableNumber,
  numericUnit: nullableString,
  displayValue: nullableString,
});

const lighthouseResultSchema = z.object({
  lighthouseVersion: nullableString,
  requestedUrl: nullableString,
  finalUrl: nullableString,
  fetchTime: nullableString,
  categories: z.record(z.string(), z.unknown()).nullish(),
  audits: z.record(z.string(), z.unknown()).nullish(),
});

/**
 * The audit ids we read. Verified present in the Lighthouse 13 performance
 * category (2026-08-29).
 *
 * **There is no `interaction-to-next-paint` audit.** INP needs field data; a
 * lab run reports Total Blocking Time instead, which is why `tbtMs` exists in
 * the published shape and the UI falls back to it.
 */
export const LIGHTHOUSE_AUDIT_IDS = {
  lcp: "largest-contentful-paint",
  cls: "cumulative-layout-shift",
  fcp: "first-contentful-paint",
  tbt: "total-blocking-time",
  speedIndex: "speed-index",
} as const;

/**
 * Category keys **as they appear in the response** — hyphenated. The request
 * takes `best_practices`; the response says `best-practices`. Sending one and
 * reading the other is the trap this pair of constants exists to avoid.
 */
export const LIGHTHOUSE_RESPONSE_CATEGORIES = {
  performance: "performance",
  accessibility: "accessibility",
  bestPractices: "best-practices",
  seo: "seo",
} as const;

/** Category names as the **request** spells them. */
export const LIGHTHOUSE_REQUEST_CATEGORIES = [
  "performance",
  "accessibility",
  "best_practices",
  "seo",
] as const;

export interface LighthouseScores {
  url: string;
  mobile: boolean;
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  fcpMs: number | null;
  tbtMs: number | null;
  speedIndexMs: number | null;
}

export type LighthouseOutcome =
  | { state: "ready"; lighthouse: LighthouseScores }
  | { state: "pending"; statusCode: number; statusMessage: string }
  | { state: "gone"; statusCode: number; statusMessage: string };

/* -------------------------------------------------------------------------- */
/* API                                                                         */
/* -------------------------------------------------------------------------- */

export interface CrawlTaskParams {
  /** Bare hostname — no scheme, no `www.`. */
  target: string;
  maxCrawlPages: number;
  enableJavascript: boolean;
}

export interface PostedCrawl {
  taskId: string;
  costUsd: number;
}

export interface OnPageApi {
  /** The only billed call in this family. */
  taskPost(params: CrawlTaskParams): Promise<PostedCrawl>;
  /** Free. Where the crawl has got to, and the site-level rollup. */
  summary(taskId: string): Promise<OnPageSummary>;
  /** Free. Crawled pages, up to `ON_PAGE_MAX_SECTION_LIMIT` per call. */
  pages(
    taskId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<SectionPull<OnPagePageItem>>;
  /** Free. Pages search engines cannot index, with the reason. */
  nonIndexable(
    taskId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<SectionPull<unknown>>;
  /** Free. Duplicate title or description groups. `type` is required. */
  duplicateTags(
    taskId: string,
    type: DuplicateTagType,
    options?: { limit?: number; offset?: number },
  ): Promise<SectionPull<unknown>>;
  /** Free. Redirect chains and loops. */
  redirectChains(
    taskId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<SectionPull<unknown>>;
  /** Free. Every link the crawl saw, with its broken/dofollow flags. */
  links(
    taskId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<SectionPull<unknown>>;
  /**
   * Billed per page. **One URL per call** — see note 1 in the content-parsing
   * section; callers wanting several run several of these concurrently.
   *
   * Never throws for a page that could not be fetched: that comes back as a
   * `ParsedPageContent` with a null `wordCount` and the reason in `itemType` /
   * `statusCode`, because one dead URL out of ten must not fail the other nine.
   */
  contentParsingLive(params: {
    url: string;
    fresh?: boolean;
  }): Promise<ParsedPageContent>;
  /** Billed, flat per task. One homepage run per audit. */
  lighthouseTaskPost(params: {
    url: string;
    forMobile?: boolean;
  }): Promise<PostedCrawl>;
  /** Free. The finished Lighthouse run, or why it is not finished. */
  lighthouseTaskGet(taskId: string, url: string): Promise<LighthouseOutcome>;
}

export function createOnPageApi(client: DataForSeoClient): OnPageApi {
  /** Every free retrieval takes the same options; declared once. */
  const retrieval = {
    ttl: "none",
    // Free, and exempt so a workspace at its cap can still collect the crawl
    // it has already paid for. Same reasoning as SERP task_get.
    spendCapExempt: true,
    // Their docs are explicit that retrieval is free; recording $0 keeps our
    // meter equal to what DataForSEO actually bills even if a response starts
    // echoing the task's original price.
    resultsPrepaid: true,
  } as const;

  /** One paged section pull. All five sections share this shape. */
  async function section(
    endpoint: string,
    taskId: string,
    options: { limit?: number; offset?: number } | undefined,
    extra: Record<string, unknown> = {},
    envelope: typeof sectionResultSchema | typeof duplicateTagsResultSchema =
      sectionResultSchema,
  ): Promise<SectionPull<unknown>> {
    const response = await client.request<unknown>({
      endpoint,
      payload: [
        {
          id: taskId,
          limit: options?.limit ?? ON_PAGE_MAX_SECTION_LIMIT,
          offset: options?.offset ?? 0,
          ...extra,
        },
      ],
      ...retrieval,
    });

    const parsed = envelope.safeParse(response.results[0]);
    if (!parsed.success) {
      return { items: [], totalItems: 0, raw: response.results };
    }
    const data = parsed.data;
    const total =
      "total_items_count" in data
        ? (data.total_items_count ?? 0)
        : (data.total_pages_count ?? 0);

    return {
      items: data.items,
      totalItems: total,
      // Stored to R2 verbatim: the drill-down is built from our projection, but
      // the raw pull is what makes a later question answerable without paying
      // to crawl again.
      raw: response.results,
    };
  }

  return {
    async taskPost(params) {
      const response = await client.request<unknown>({
        endpoint: ON_PAGE_TASK_POST,
        payload: [
          {
            target: params.target,
            max_crawl_pages: params.maxCrawlPages,
            enable_javascript: params.enableJavascript,
            /*
             * Explicit rather than defaulted, because each one is money or
             * meaning:
             *  - load_resources triples the per-page price and we do not read
             *    resource data, so it stays off;
             *  - enable_browser_rendering is 34× and only buys page_timing
             *    CWV, which the Lighthouse run already gives us for the page
             *    that matters;
             *  - validate_micromarkup is free and is what populates the
             *    structured-data checks, so it stays on.
             */
            load_resources: false,
            validate_micromarkup: true,
            /*
             * Sitewide checks (canonicalisation, www redirect, 404 handling)
             * are disabled by DataForSEO when max_crawl_pages is 1. We offer a
             * 25-page minimum so that never applies, but asking explicitly
             * means a future single-page mode does not silently lose them.
             */
            force_sitewide_checks: true,
          },
        ],
        // A crawl is bought, not cached: the task id is a one-shot handle and
        // re-serving a cached one would hand back someone else's crawl.
        ttl: "none",
        // A created task reports 20100, not 20000.
        okTaskStatusCodes: [DFS_TASK_CREATED_STATUS],
      });

      const task = response.tasks[0];
      if (task === undefined || task.id === null) {
        throw new ApiException(
          "upstream_error",
          "DataForSEO accepted the crawl but returned no task id.",
        );
      }
      return { taskId: task.id, costUsd: response.costUsd };
    },

    async summary(taskId) {
      const endpoint = summaryEndpoint(taskId);
      const response = await client.request<unknown>({
        endpoint,
        payload: [],
        method: "GET",
        // The id stays in the URL; the meter records the family, or the usage
        // report degenerates into one row per audit.
        meterAs: ON_PAGE_SUMMARY,
        ...retrieval,
        okTaskStatusCodes: [
          DFS_TASK_HANDED_STATUS,
          DFS_TASK_IN_QUEUE_STATUS,
          DFS_TASK_NOT_FOUND_STATUS,
          DFS_RESULTS_EXPIRED_STATUS,
        ],
      });

      const parsed = summaryResultSchema.safeParse(response.results[0]);
      if (!parsed.success) {
        // Before the crawl starts there may be no result at all — that is
        // "not finished", not a malformed response.
        return {
          finished: false,
          crawlProgress: "in_progress",
          crawlStopReason: null,
          pagesCrawled: 0,
          pagesInQueue: 0,
          maxCrawlPages: null,
          onPageScore: null,
          domain: null,
          extendedCrawlStatus: null,
          domainChecks: {},
          brokenLinks: 0,
          brokenResources: 0,
          nonIndexable: 0,
          duplicateTitle: 0,
          duplicateDescription: 0,
          duplicateContent: 0,
        };
      }

      const data = parsed.data;
      const metrics = data.page_metrics ?? null;
      const status = data.crawl_status ?? null;
      const domainInfo = data.domain_info ?? null;

      return {
        finished: data.crawl_progress === "finished",
        crawlProgress: data.crawl_progress ?? "in_progress",
        crawlStopReason: data.crawl_stop_reason ?? null,
        pagesCrawled: status?.pages_crawled ?? 0,
        pagesInQueue: status?.pages_in_queue ?? 0,
        maxCrawlPages: status?.max_crawl_pages ?? null,
        onPageScore: metrics?.onpage_score ?? null,
        domain: domainInfo?.name ?? null,
        extendedCrawlStatus: domainInfo?.extended_crawl_status ?? null,
        domainChecks: booleanRecord(domainInfo?.checks),
        brokenLinks: metrics?.broken_links ?? 0,
        brokenResources: metrics?.broken_resources ?? 0,
        nonIndexable: metrics?.non_indexable ?? 0,
        duplicateTitle: metrics?.duplicate_title ?? 0,
        duplicateDescription: metrics?.duplicate_description ?? 0,
        duplicateContent: metrics?.duplicate_content ?? 0,
      };
    },

    async pages(taskId, options) {
      const pull = await section(ON_PAGE_PAGES, taskId, options);
      const items: OnPagePageItem[] = [];
      for (const raw of pull.items) {
        const parsed = pageItemSchema.safeParse(raw);
        // A malformed row costs one page, not the audit.
        if (parsed.success) items.push(parsed.data);
      }
      return { items, totalItems: pull.totalItems, raw: pull.raw };
    },

    nonIndexable(taskId, options) {
      return section(ON_PAGE_NON_INDEXABLE, taskId, options);
    },

    duplicateTags(taskId, type, options) {
      // `type` is required upstream and its values are `duplicate_title` /
      // `duplicate_description` — see note 4 at the top of this file.
      return section(
        ON_PAGE_DUPLICATE_TAGS,
        taskId,
        options,
        { type },
        duplicateTagsResultSchema,
      );
    },

    redirectChains(taskId, options) {
      return section(ON_PAGE_REDIRECT_CHAINS, taskId, options);
    },

    links(taskId, options) {
      return section(ON_PAGE_LINKS, taskId, options);
    },

    async contentParsingLive(params) {
      const response = await client.request<unknown>({
        endpoint: ON_PAGE_CONTENT_PARSING_LIVE,
        payload: [
          {
            // Singular, and one task per POST — the endpoint has no array form.
            url: params.url,
            /*
             * `url` and NOTHING ELSE. Verified live 2026-08-31: sending
             * `accept_language` — which the on_page docs list, and which they
             * name as the fix for the `"type": "broken"` refusal mode — is
             * rejected by THIS endpoint with 40501 "Invalid Field:
             * 'accept_language'". The parameter tables on the on_page family
             * pages are not uniformly applicable to content_parsing/live, so
             * anything added here must be proven against the live endpoint
             * rather than read off a sibling's docs.
             *
             * Two that are deliberately absent for a different reason —
             * money: enable_javascript is 10× the per-page price and
             * enable_browser_rendering is 34×. A word count off the
             * server-rendered HTML is worth its $0.00015 and is not worth
             * $0.0051.
             */
          },
        ],
        // A page's body text is about the most stable thing DataForSEO sells —
        // articles are not rewritten weekly — so this takes the longest bucket.
        ttl: "long",
        fresh: params.fresh,
      });

      const meta = {
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
      const parsed = contentParsingResultSchema.safeParse(response.results[0]);
      // No result at all is the same outcome as an unparseable one: null, not
      // an exception. The caller asked about ten URLs and is owed nine answers.
      const item = parsed.success ? parsed.data.items[0] : undefined;
      return toParsedPageContent(params.url, item, meta);
    },

    async lighthouseTaskPost(params) {
      const response = await client.request<unknown>({
        endpoint: LIGHTHOUSE_TASK_POST,
        payload: [
          {
            url: params.url,
            for_mobile: params.forMobile ?? true,
            // Underscored in the request; hyphenated in the response.
            categories: [...LIGHTHOUSE_REQUEST_CATEGORIES],
          },
        ],
        ttl: "none",
        okTaskStatusCodes: [DFS_TASK_CREATED_STATUS],
      });

      const task = response.tasks[0];
      if (task === undefined || task.id === null) {
        throw new ApiException(
          "upstream_error",
          "DataForSEO accepted the Lighthouse task but returned no task id.",
        );
      }
      return { taskId: task.id, costUsd: response.costUsd };
    },

    async lighthouseTaskGet(taskId, url) {
      const endpoint = lighthouseTaskGetEndpoint(taskId);
      const response = await client.request<unknown>({
        endpoint,
        payload: [],
        method: "GET",
        meterAs: LIGHTHOUSE_TASK_GET,
        ...retrieval,
        okTaskStatusCodes: [
          DFS_TASK_HANDED_STATUS,
          DFS_TASK_IN_QUEUE_STATUS,
          DFS_TASK_NOT_FOUND_STATUS,
          DFS_RESULTS_EXPIRED_STATUS,
        ],
      });

      const task = response.tasks[0];
      const statusCode = task?.statusCode ?? response.statusCode;
      const statusMessage = task?.statusMessage ?? response.statusMessage;

      if (
        statusCode === DFS_TASK_HANDED_STATUS ||
        statusCode === DFS_TASK_IN_QUEUE_STATUS
      ) {
        return { state: "pending", statusCode, statusMessage };
      }
      if (
        statusCode === DFS_TASK_NOT_FOUND_STATUS ||
        statusCode === DFS_RESULTS_EXPIRED_STATUS
      ) {
        return { state: "gone", statusCode, statusMessage };
      }

      const parsed = lighthouseResultSchema.safeParse(response.results[0]);
      if (!parsed.success) {
        return {
          state: "gone",
          statusCode,
          statusMessage: "Lighthouse returned an unrecognised result shape.",
        };
      }

      return {
        state: "ready",
        lighthouse: toLighthouseScores(parsed.data, url),
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Parsing helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Keeps only the boolean members of a checks map. */
export function booleanRecord(
  raw: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (raw === null || raw === undefined) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Lighthouse's raw JSON to our published shape.
 *
 * Two conversions matter: category scores are **0–1** upstream and 0–100 here
 * (a 0.93 rendered as "93" is what everyone expects from Lighthouse), and the
 * metric audits carry their real value in `numericValue`, in milliseconds —
 * except CLS, which is unitless and must not be scaled.
 */
export function toLighthouseScores(
  result: z.infer<typeof lighthouseResultSchema>,
  requestedUrl: string,
): LighthouseScores {
  const categories = result.categories ?? {};
  const audits = result.audits ?? {};

  return {
    url: result.finalUrl ?? result.requestedUrl ?? requestedUrl,
    // We always request the mobile run; see `lighthouseTaskPost`.
    mobile: true,
    performance: categoryScore(
      categories,
      LIGHTHOUSE_RESPONSE_CATEGORIES.performance,
    ),
    accessibility: categoryScore(
      categories,
      LIGHTHOUSE_RESPONSE_CATEGORIES.accessibility,
    ),
    bestPractices: categoryScore(
      categories,
      LIGHTHOUSE_RESPONSE_CATEGORIES.bestPractices,
    ),
    seo: categoryScore(categories, LIGHTHOUSE_RESPONSE_CATEGORIES.seo),
    lcpMs: auditValue(audits, LIGHTHOUSE_AUDIT_IDS.lcp),
    // Unitless — deliberately not rounded to an integer like the millisecond
    // metrics, because a CLS of 0.08 rounds to zero.
    cls: auditValue(audits, LIGHTHOUSE_AUDIT_IDS.cls, false),
    // Lighthouse has no INP audit in lab mode; TBT is the stand-in and is
    // reported separately so the UI can say which it is showing.
    inpMs: null,
    fcpMs: auditValue(audits, LIGHTHOUSE_AUDIT_IDS.fcp),
    tbtMs: auditValue(audits, LIGHTHOUSE_AUDIT_IDS.tbt),
    speedIndexMs: auditValue(audits, LIGHTHOUSE_AUDIT_IDS.speedIndex),
  };
}

/** A category's score, rescaled from Lighthouse's 0–1 to 0–100. */
function categoryScore(
  categories: Record<string, unknown>,
  key: string,
): number | null {
  const category = categories[key];
  if (typeof category !== "object" || category === null) return null;
  const score = (category as Record<string, unknown>)["score"];
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.round(score * 100);
}

/** An audit's `numericValue`, rounded for millisecond metrics only. */
function auditValue(
  audits: Record<string, unknown>,
  id: string,
  roundToInteger = true,
): number | null {
  const audit = audits[id];
  const parsed = lighthouseAuditSchema.safeParse(audit);
  if (!parsed.success) return null;
  const value = parsed.data.numericValue;
  if (value === null || !Number.isFinite(value)) return null;
  return roundToInteger ? Math.round(value) : Math.round(value * 1000) / 1000;
}
