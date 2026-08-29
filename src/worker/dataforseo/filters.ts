/**
 * DataForSEO Labs `filters` and `order_by` construction.
 *
 * Labs endpoints can filter and sort server-side, and using that is not an
 * optimisation — it is the difference between paying for 1000 rows to show 50
 * and paying for 50. Every route that exposes a filter UI builds its request
 * through here.
 *
 * The wire format is idiosyncratic enough to be worth stating exactly (verified
 * against https://docs.dataforseo.com/v3/dataforseo_labs/filters/):
 *
 *   // ONE condition — a flat triple, NOT wrapped in an outer array
 *   "filters": ["keyword_data.keyword_info.search_volume", ">=", 50]
 *
 *   // TWO OR MORE — triples separated by a bare "and" / "or" string
 *   "filters": [
 *     ["ranked_serp_element.serp_item.rank_group", "<=", 10],
 *     "and",
 *     ["ranked_serp_element.serp_item.type", "<>", "paid"]
 *   ]
 *
 * The single-condition case really is shaped differently from the plural one —
 * that asymmetry is the easiest thing on this endpoint to get wrong, and it is
 * why `toLabsFilters` is a function rather than an array literal at each call
 * site. `order_by` is a different format again: `["field,desc"]`, comma-joined.
 *
 * The field paths are endpoint-specific and must match that endpoint's row
 * nesting: `keyword_info.search_volume` on keyword_suggestions (flat rows) but
 * `keyword_data.keyword_info.search_volume` on related_keywords and
 * ranked_keywords (wrapped rows). Getting this wrong is not a silent no-op —
 * DataForSEO rejects the task with an "Invalid Field" status.
 */
import { ApiException } from "../http";

/** Documented ceiling: 8 filter conditions per request. */
export const LABS_MAX_FILTERS = 8;

/** Documented ceiling: 3 sort rules per request. */
export const LABS_MAX_SORTS = 3;

/**
 * The operators we expose. DataForSEO accepts more (`match`, `not_match`,
 * regex forms); this is the subset the Phase 1 UI needs, kept small because
 * every operator here is a promise about what a filter row can do.
 */
export const LABS_FILTER_OPERATORS = [
  "<",
  "<=",
  ">",
  ">=",
  "=",
  "<>",
  "in",
  "not_in",
  "like",
  "not_like",
] as const;

export type LabsFilterOperator = (typeof LABS_FILTER_OPERATORS)[number];

export type LabsFilterValue = string | number | boolean | (string | number)[];

export interface LabsFilter {
  /** Dotted path into the row, e.g. "keyword_data.keyword_info.search_volume". */
  field: string;
  operator: LabsFilterOperator;
  value: LabsFilterValue;
}

export type LabsLogicalOperator = "and" | "or";

export interface LabsSort {
  field: string;
  direction: "asc" | "desc";
}

/** One condition on the wire: a 3-element tuple. */
export type LabsFilterTuple = [string, LabsFilterOperator, LabsFilterValue];

/**
 * What `filters` may be: a single bare tuple, or tuples interleaved with bare
 * logical operators. Both forms are documented; which one applies depends only
 * on how many conditions there are.
 */
export type LabsFilterExpression =
  | LabsFilterTuple
  | (LabsFilterTuple | LabsLogicalOperator)[];

/**
 * Builds the `filters` value, or `undefined` when there is nothing to filter —
 * an empty array is not the same as an absent key to DataForSEO, and sending
 * `[]` errors the task.
 *
 * Conditions are joined with a single logical operator (`"and"` by default).
 * Nested and/or trees are possible on their side but no Phase 1 surface needs
 * one, and pretending to support it would mean pretending we had tested it.
 */
export function toLabsFilters(
  filters: readonly LabsFilter[],
  join: LabsLogicalOperator = "and",
): LabsFilterExpression | undefined {
  if (filters.length === 0) return undefined;
  if (filters.length > LABS_MAX_FILTERS) {
    throw new ApiException(
      "validation_failed",
      `Too many filters: DataForSEO accepts at most ${LABS_MAX_FILTERS} per request, got ${filters.length}.`,
    );
  }

  const tuples: LabsFilterTuple[] = filters.map((filter) => [
    filter.field,
    filter.operator,
    filter.value,
  ]);

  // The documented single-condition form is the bare tuple. Wrapping it would
  // be sending a shape the docs never show.
  const [only] = tuples;
  if (tuples.length === 1 && only !== undefined) return only;

  const expression: (LabsFilterTuple | LabsLogicalOperator)[] = [];
  for (const tuple of tuples) {
    if (expression.length > 0) expression.push(join);
    expression.push(tuple);
  }
  return expression;
}

/**
 * Builds the `order_by` value, or `undefined` when unsorted. Format is
 * `"<field>,<asc|desc>"` — a single comma-joined string per rule, not an
 * object and not a tuple.
 */
export function toLabsOrderBy(
  sorts: readonly LabsSort[],
): string[] | undefined {
  if (sorts.length === 0) return undefined;
  if (sorts.length > LABS_MAX_SORTS) {
    throw new ApiException(
      "validation_failed",
      `Too many sort rules: DataForSEO accepts at most ${LABS_MAX_SORTS} per request, got ${sorts.length}.`,
    );
  }
  return sorts.map((sort) => `${sort.field},${sort.direction}`);
}

/**
 * Turns an optional min/max pair into 0–2 conditions on one numeric field.
 *
 * `>=` / `<=` rather than `>` / `<` because a user typing "min volume 100"
 * means "at least 100". Undefined bounds contribute nothing, so a filter row
 * left blank costs no filter slot.
 */
export function rangeFilters(
  field: string,
  min: number | undefined,
  max: number | undefined,
): LabsFilter[] {
  const out: LabsFilter[] = [];
  if (min !== undefined) out.push({ field, operator: ">=", value: min });
  if (max !== undefined) out.push({ field, operator: "<=", value: max });
  return out;
}

/**
 * A substring match. DataForSEO's `like` requires the caller to supply its own
 * wildcards — `"like", "seo"` matches only the exact string — so the needle is
 * wrapped in `%`.
 *
 * User-typed `%` and `_` are deliberately NOT escaped: their filter docs
 * define no escape syntax, so a backslash would most likely be matched
 * literally and turn a working search into one that finds nothing. Leaving
 * them as wildcards keeps the search too broad in a rare case instead of
 * silently empty, which is the better failure of the two. Worth revisiting if
 * they ever document an escape character.
 */
export function containsFilter(
  field: string,
  needle: string,
  negate = false,
): LabsFilter {
  return {
    field,
    operator: negate ? "not_like" : "like",
    value: `%${needle}%`,
  };
}
