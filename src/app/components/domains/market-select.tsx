/**
 * The location + language pair, as two linked selects.
 *
 * Linked, not independent: the language list is rebuilt from whichever
 * location is chosen, and picking a location that does not support the current
 * language re-resolves it (see market-options.ts). That is the difference
 * between a market switch that works and one that returns an upstream error.
 */
import { useMemo } from "react";

import { Field, Select } from "../ui";
import type { Market } from "../../routes/domain-overview/url-state";
import {
  languageOptionsFor,
  locationOptions,
  resolveLanguage,
} from "./market-options";
import { useMetaLanguages, useMetaLocations } from "./meta-queries";

export function MarketSelects({
  workspaceId,
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  workspaceId: string | null;
  value: Market;
  onChange: (market: Market) => void;
  disabled?: boolean;
  className?: string;
}) {
  const locationsQuery = useMetaLocations(workspaceId);
  const languagesQuery = useMetaLanguages(workspaceId);

  const locations = useMemo(
    () => locationsQuery.data?.locations ?? [],
    [locationsQuery.data],
  );

  const languageNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const language of languagesQuery.data?.languages ?? []) {
      if (language.name !== null) names.set(language.code, language.name);
    }
    return names;
  }, [languagesQuery.data]);

  const locationChoices = useMemo(
    () => locationOptions(locations, value.location),
    [locations, value.location],
  );

  const languageChoices = useMemo(
    () => languageOptionsFor(locations, value.location, value.language, languageNames),
    [locations, value.location, value.language, languageNames],
  );

  const loading = locationsQuery.isPending && workspaceId !== null;
  const failed = locationsQuery.isError;

  return (
    <div className={className}>
      <Field
        label="Location"
        hint={
          failed
            ? "Market list unavailable — keeping the current code."
            : loading
              ? "Loading markets…"
              : undefined
        }
      >
        {(field) => (
          <Select
            {...field}
            value={String(value.location)}
            disabled={disabled}
            onChange={(event) => {
              const location = Number(event.target.value);
              onChange({
                location,
                // Re-resolve rather than carry a language this market rejects.
                language: resolveLanguage(locations, location, value.language),
              });
            }}
          >
            {locationChoices.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Language" hint="Only the languages this market supports.">
        {(field) => (
          <Select
            {...field}
            value={value.language}
            disabled={disabled}
            onChange={(event) =>
              onChange({ location: value.location, language: event.target.value })
            }
          >
            {languageChoices.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
