/**
 * The location + language pair every research query runs in.
 *
 * The language select is driven by the *chosen location*, not by a global
 * language list. DataForSEO treats a location/language pair outside its own
 * table as an upstream error, so offering "Japanese" against "United Kingdom"
 * would build a query that can only fail — after being billed for the attempt.
 * `MetaLocationOption.languages` is the authority, and changing location
 * re-resolves the language against the new market's list.
 */
import { useMemo } from "react";

import type { MetaLocationOption } from "../../../shared/keywords";
import { Label, Select, Skeleton } from "../ui";
import type { MarketSelection } from "./market";
import { resolveLanguageForLocation } from "./market";
import { useMetaLocations } from "./queries";

/**
 * Markets to surface above the full list. Codes are DataForSEO's (ISO 3166-1
 * numeric + 2000); each is only rendered if the API actually returned it, so
 * this can never invent a market or a name — the labels always come from the
 * response.
 */
const COMMON_LOCATION_CODES = [
  2826, // United Kingdom
  2840, // United States
  2276, // Germany
  2250, // France
  2724, // Spain
  2380, // Italy
  2528, // Netherlands
  2036, // Australia
  2124, // Canada
  2356, // India
];

function byName(a: MetaLocationOption, b: MetaLocationOption): number {
  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function MarketSelect({
  workspaceId,
  market,
  onChange,
  disabled = false,
}: {
  workspaceId: string | null;
  market: MarketSelection;
  onChange: (next: MarketSelection) => void;
  disabled?: boolean;
}) {
  const { data, isPending, isError } = useMetaLocations(workspaceId);

  const locations = useMemo(() => data?.locations ?? [], [data]);

  const { common, rest } = useMemo(() => {
    const commonSet = new Set(COMMON_LOCATION_CODES);
    return {
      common: COMMON_LOCATION_CODES.map((code) =>
        locations.find((location) => location.code === code),
      ).filter((location): location is MetaLocationOption => location !== undefined),
      rest: locations.filter((location) => !commonSet.has(location.code)).sort(byName),
    };
  }, [locations]);

  const selected = locations.find((location) => location.code === market.locationCode);

  /*
   * Until the list loads — or if it fails — the selects still have to show the
   * market the app is actually querying in, so they fall back to rendering the
   * current codes as their own single option. The controls degrade to
   * read-only rather than silently resetting the user's market to something
   * else.
   */
  const languages = selected?.languages ?? [];

  function changeLocation(rawCode: string) {
    const locationCode = Number(rawCode);
    if (!Number.isInteger(locationCode) || locationCode <= 0) return;

    const next = locations.find((location) => location.code === locationCode);
    const languageCode =
      next === undefined
        ? market.languageCode
        : (resolveLanguageForLocation(market.languageCode, next.languages) ??
          market.languageCode);

    onChange({ locationCode, languageCode });
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-56">
          <Label htmlFor="market-location">Location</Label>
          <Skeleton className="h-9 w-full rounded-app" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-44">
          <Label htmlFor="market-language">Language</Label>
          <Skeleton className="h-9 w-full rounded-app" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="flex min-w-0 flex-col gap-1.5 sm:w-56">
        <Label htmlFor="market-location">Location</Label>
        <Select
          id="market-location"
          value={String(market.locationCode)}
          disabled={disabled || isError}
          onChange={(event) => changeLocation(event.target.value)}
        >
          {selected === undefined ? (
            <option value={String(market.locationCode)}>
              {`Location ${market.locationCode}`}
            </option>
          ) : null}
          {common.length > 0 ? (
            <optgroup label="Common markets">
              {common.map((location) => (
                <option key={location.code} value={String(location.code)}>
                  {location.name ?? `Location ${location.code}`}
                </option>
              ))}
            </optgroup>
          ) : null}
          {rest.length > 0 ? (
            <optgroup label="All markets">
              {rest.map((location) => (
                <option key={location.code} value={String(location.code)}>
                  {location.name ?? `Location ${location.code}`}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 sm:w-44">
        <Label htmlFor="market-language">Language</Label>
        <Select
          id="market-language"
          value={market.languageCode}
          disabled={disabled || isError || languages.length === 0}
          onChange={(event) =>
            onChange({ ...market, languageCode: event.target.value })
          }
        >
          {/* The current language stays selectable even if this market does not
              list it, so the control always reflects what is being queried. */}
          {languages.some((language) => language.code === market.languageCode) ? null : (
            <option value={market.languageCode}>{market.languageCode}</option>
          )}
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name ?? language.code}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
