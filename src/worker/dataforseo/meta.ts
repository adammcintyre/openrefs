/**
 * The zero-cost reference lists: which locations and languages the API will
 * accept. This is the only family that uses `cacheScope: "global"`, and the
 * only one whose requests are GET with no body.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/dataforseo_labs/
 * locations_and_languages/ and .../serp/google/languages/ (2026-08-29). All of
 * these state "Your account will not be charged for using this API".
 *
 * **Which locations list to use is a correctness question, not a preference.**
 * The SERP appendix (`serp/google/locations`) lists ~100k locations down to
 * individual airports, but DataForSEO Labs accepts only the country-level
 * codes in `dataforseo_labs/locations_and_languages`. Since every keyword and
 * domain endpoint in Phase 1 is a Labs endpoint, offering the SERP list in the
 * picker would let a user choose a location that then fails every request they
 * make. So the Labs list is the source, and it brings each country's valid
 * languages nested inside it — which is strictly better than a global language
 * list the user can pair wrongly with a country.
 */
import { z } from "zod";

import type { DataForSeoClient } from "./client";
import type { WrappedMeta } from "./schema";
import { nullableNumber, nullableString } from "./schema";

export const LABS_LOCATIONS_AND_LANGUAGES =
  "dataforseo_labs/locations_and_languages";
export const SERP_GOOGLE_LANGUAGES = "serp/google/languages";

const languageSchema = z.object({
  language_name: nullableString,
  language_code: nullableString,
});

const availableLanguageSchema = z.object({
  language_name: nullableString,
  language_code: nullableString,
  /** Which APIs have data for this country/language pair. */
  available_sources: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  /** Rows DataForSEO holds — a decent proxy for "is this market useful". */
  keywords: nullableNumber,
  serps: nullableNumber,
});

const locationSchema = z.object({
  location_code: z.number(),
  location_name: nullableString,
  /** Always null on this endpoint: Labs supports countries only. */
  location_code_parent: nullableNumber,
  country_iso_code: nullableString,
  /** "Country" — the only value this endpoint returns. */
  location_type: nullableString,
  available_languages: z
    .array(availableLanguageSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export interface MetaLanguage {
  code: string;
  name: string | null;
}

export interface MetaLocationLanguage extends MetaLanguage {
  availableSources: string[];
  keywords: number | null;
  serps: number | null;
}

export interface MetaLocation {
  /** The `location_code` every other endpoint takes. */
  code: number;
  name: string | null;
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  countryIsoCode: string | null;
  locationType: string | null;
  /** Languages valid for THIS location. Pairing outside this list errors. */
  languages: MetaLocationLanguage[];
}

export interface MetaLocationsResult extends WrappedMeta {
  locations: MetaLocation[];
}

export interface MetaLanguagesResult extends WrappedMeta {
  languages: MetaLanguage[];
}

export interface MetaApi {
  /** Country-level locations Labs accepts, with each one's languages. */
  locations(options?: { fresh?: boolean }): Promise<MetaLocationsResult>;
  /** The global language list. */
  languages(options?: { fresh?: boolean }): Promise<MetaLanguagesResult>;
}

export function createMetaApi(client: DataForSeoClient): MetaApi {
  return {
    async locations(options = {}) {
      const response = await client.request<unknown>({
        endpoint: LABS_LOCATIONS_AND_LANGUAGES,
        // GET, so nothing is sent. The empty payload still keys the cache.
        payload: [],
        method: "GET",
        // 30 days: this list changes when DataForSEO adds a market, which is
        // a few times a year at most.
        ttl: "long",
        cacheScope: "global",
        fresh: options.fresh,
      });

      const locations: MetaLocation[] = [];
      for (const raw of response.results) {
        const parsed = locationSchema.safeParse(raw);
        // One unreadable row must not cost the user the whole picker.
        if (!parsed.success) continue;
        const item = parsed.data;
        locations.push({
          code: item.location_code,
          name: item.location_name,
          countryIsoCode: item.country_iso_code,
          locationType: item.location_type,
          languages: item.available_languages.flatMap((language) =>
            language.language_code === null
              ? []
              : [
                  {
                    code: language.language_code,
                    name: language.language_name,
                    availableSources: language.available_sources,
                    keywords: language.keywords,
                    serps: language.serps,
                  },
                ],
          ),
        });
      }

      return {
        locations: locations.sort(byName),
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async languages(options = {}) {
      const response = await client.request<unknown>({
        endpoint: SERP_GOOGLE_LANGUAGES,
        payload: [],
        method: "GET",
        ttl: "long",
        cacheScope: "global",
        fresh: options.fresh,
      });

      const languages: MetaLanguage[] = [];
      for (const raw of response.results) {
        const parsed = languageSchema.safeParse(raw);
        if (!parsed.success) continue;
        const { language_code: code, language_name: name } = parsed.data;
        if (code === null) continue;
        languages.push({ code, name });
      }

      return {
        languages: languages.sort(byName),
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },
  };
}

/** Alphabetical by display name, so the picker needs no client-side sort. */
function byName(a: { name: string | null }, b: { name: string | null }): number {
  return (a.name ?? "").localeCompare(b.name ?? "");
}
