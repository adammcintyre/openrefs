/**
 * The market reference lists behind the location/language pickers.
 *
 * DataForSEO bills these at $0 and the Worker caches them once for the whole
 * deployment (the one documented exception to per-workspace cache keys), so
 * unlike everything else in this module they are safe to fetch eagerly and to
 * keep for the life of the tab.
 */
import { useQuery } from "@tanstack/react-query";

import type {
  MetaLanguagesResponse,
  MetaLocationsResponse,
} from "../../../shared/keywords";
import { api } from "../../lib/api";

/** They change roughly never; refetching them mid-session is pure noise. */
const REFERENCE_DATA = {
  staleTime: 24 * 60 * 60_000,
  gcTime: 24 * 60 * 60_000,
} as const;

/**
 * Locations come from DataForSEO Labs, not the SERP appendix: Labs accepts
 * country-level codes only, and every endpoint this module calls is a Labs
 * endpoint. Each entry carries the languages valid *for that location*, which
 * is what drives the language select.
 */
export function useMetaLocations(workspaceId: string | null) {
  return useQuery({
    queryKey: ["meta", "locations", workspaceId],
    queryFn: () =>
      api.get<MetaLocationsResponse>(
        `/meta/locations?workspace=${encodeURIComponent(workspaceId ?? "")}&engine=google`,
      ),
    enabled: workspaceId !== null,
    ...REFERENCE_DATA,
  });
}

/** The global list, used only to put a readable name on a language code. */
export function useMetaLanguages(workspaceId: string | null) {
  return useQuery({
    queryKey: ["meta", "languages", workspaceId],
    queryFn: () =>
      api.get<MetaLanguagesResponse>(
        `/meta/languages?workspace=${encodeURIComponent(workspaceId ?? "")}`,
      ),
    enabled: workspaceId !== null,
    ...REFERENCE_DATA,
  });
}
