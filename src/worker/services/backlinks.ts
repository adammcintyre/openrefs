/**
 * Backlinks, as functions rather than routes.
 *
 * Only the summary lives here — it is the one the MCP server exposes as
 * `backlinks_summary`, and the tool and `GET /api/v1/backlinks/summary` must
 * return the same object. The list/anchors/history/scores routes have a single
 * caller each and stay in `routes/backlinks.ts`.
 *
 * No location or language: a link profile is a property of the web, not of a
 * market, and none of these endpoints accepts a `location_code`.
 */
import type { Db } from "../../db";
import type { BacklinksSummaryResponse } from "../../shared/backlinks";
import { createDataForSeoApi } from "../dataforseo";

export interface BacklinksSummaryInput {
  workspace: string;
  /** A bare domain, a subdomain, or an absolute page URL. */
  target: string;
  fresh?: boolean;
}

/**
 * The MetricCard strip: Domain Score, backlinks, referring domains, dofollow
 * share, broken links.
 *
 * Authority is published as Domain Score (0–100); the provider's raw 0–1000
 * rank is converted inside the wrapper and never reaches this shape.
 */
export async function backlinksSummary(
  env: Env,
  db: Db,
  input: BacklinksSummaryInput,
): Promise<BacklinksSummaryResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const result = await dfs.backlinks.summaryLive({
    target: input.target,
    fresh: input.fresh,
  });

  return {
    target: result.target,
    domainScore: result.domainScore,
    backlinks: result.backlinks,
    referringDomains: result.referringDomains,
    referringMainDomains: result.referringMainDomains,
    referringPages: result.referringPages,
    dofollow: result.dofollow,
    brokenBacklinks: result.brokenBacklinks,
    brokenPages: result.brokenPages,
    crawledPages: result.crawledPages,
    internalLinksCount: result.internalLinksCount,
    externalLinksCount: result.externalLinksCount,
    referringIps: result.referringIps,
    referringSubnets: result.referringSubnets,
    spamScore: result.spamScore,
    firstSeen: result.firstSeen,
    lostDate: result.lostDate,
    server: result.server,
    countryIsoCode: result.countryIsoCode,
    linkAttributes: result.linkAttributes,
    linkTypes: result.linkTypes,
    costUsd: result.costUsd,
    cached: result.cached,
  };
}
