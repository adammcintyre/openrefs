/**
 * Turning the /meta/* reference lists into <option> lists.
 *
 * Pure, and separated from the select markup, because the interesting rule
 * here is a correctness one rather than a presentational one: **a DataForSEO
 * Labs location accepts only its own languages.** Germany is `de`, France is
 * `fr`; pairing the location code for Germany with `en` is an upstream error,
 * not an empty result. So the language list is derived from the chosen
 * location, and changing location has to re-resolve the language rather than
 * leave a now-invalid pair in place.
 */
import type { MetaLocationOption } from "../../../shared/keywords";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Locations A–Z, with the current selection guaranteed present.
 *
 * The guarantee matters while the list is still loading, or if a URL carries a
 * code the list does not contain: a <select> whose value matches no option
 * silently shows the first entry, which would misreport which market the
 * results on screen actually came from.
 */
export function locationOptions(
  locations: ReadonlyArray<MetaLocationOption>,
  current: number,
): SelectOption[] {
  const options = locations
    .map((location) => ({
      value: String(location.code),
      label: location.name ?? `Location ${location.code}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!options.some((option) => option.value === String(current))) {
    options.unshift({ value: String(current), label: `Location ${current}` });
  }
  return options;
}

/** The languages one location actually supports, named where we have a name. */
export function languageOptionsFor(
  locations: ReadonlyArray<MetaLocationOption>,
  locationCode: number,
  current: string,
  languageNames: ReadonlyMap<string, string> = new Map(),
): SelectOption[] {
  const location = locations.find((entry) => entry.code === locationCode);
  const options = (location?.languages ?? []).map((language) => ({
    value: language.code,
    label: language.name ?? languageNames.get(language.code) ?? language.code,
  }));

  if (!options.some((option) => option.value === current)) {
    options.unshift({
      value: current,
      label: languageNames.get(current) ?? current,
    });
  }
  return options;
}

/**
 * The language to use for a location: the one asked for if that market
 * supports it, otherwise the market's own primary language.
 *
 * This is the client-side twin of `marketLanguage()` in the Worker, and it is
 * why switching the location select can also change the language select.
 * Falling back to the requested value when the location is unknown (list still
 * loading) keeps the control usable rather than blanking it.
 */
export function resolveLanguage(
  locations: ReadonlyArray<MetaLocationOption>,
  locationCode: number,
  wanted: string,
): string {
  const location = locations.find((entry) => entry.code === locationCode);
  if (location === undefined || location.languages.length === 0) return wanted;
  const supported = location.languages.some(
    (language) => language.code === wanted,
  );
  return supported ? wanted : (location.languages[0]?.code ?? wanted);
}

/** Human label for a market, e.g. "United Kingdom · en". */
export function marketLabel(
  locations: ReadonlyArray<MetaLocationOption>,
  locationCode: number,
  languageCode: string,
): string {
  const location = locations.find((entry) => entry.code === locationCode);
  const name = location?.name ?? `Location ${locationCode}`;
  return `${name} · ${languageCode}`;
}
