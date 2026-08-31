/**
 * The Rank Tracking overview rollup.
 *
 * Three things are worth pinning, and each is a distinct way the chart could
 * lie:
 *
 *  - **The window.** A date cutoff, not "the newest N dates" — the difference
 *    is whether an abandoned project shows its gap or quietly rescales three
 *    months of stale checks onto a 30-day axis.
 *  - **The nulls.** A keyword that did not rank is a real observation, and
 *    averaging it as zero would draw the best day the project never had.
 *  - **The scoping.** The rollup must see one project's snapshots and no
 *    other's, including no other tenant's.
 *
 * The SQL is asserted by rendering it (these tests run in plain Node with no
 * D1); its aggregate semantics were verified against SQLite directly while it
 * was written, and the shapes here encode what that showed.
 */
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "../../db";
import {
  RANK_SUMMARY_DEFAULT_DAYS,
  RANK_SUMMARY_MAX_DAYS,
  RANK_SUMMARY_MIN_DAYS,
  clampSummaryDays,
  rankSummary,
  rankSummarySince,
} from "./projects";

const dialect = new SQLiteSyncDialect();
const WS = "ws-1";
const PROJECT = "p-1";
const NOW = new Date("2026-08-31T09:00:00.000Z");

/** One row as the grouped query returns it. */
interface AggregateRow {
  date: string;
  tracked: number;
  ranked: number;
  total_position: number | null;
  top3: number;
  top10: number;
  top100: number;
}

/** A Db that answers `requireProject` and hands back canned aggregate rows. */
function fakeDb(rows: AggregateRow[]): { db: Db; sql: () => SQL } {
  let captured: SQL | undefined;
  const projectChain: Record<string, unknown> = {
    from: () => projectChain,
    where: () => projectChain,
    limit: () => projectChain,
    then: (resolve: (value: unknown[]) => unknown) =>
      resolve([
        {
          id: PROJECT,
          name: "Site",
          domain: "example.com",
          locationCode: 2826,
          languageCode: "en",
          createdAt: new Date(0),
        },
      ]),
  };
  const db = {
    select: () => projectChain,
    all: (statement: SQL) => {
      captured = statement;
      return Promise.resolve(rows);
    },
  };
  return {
    db: db as unknown as Db,
    sql: () => {
      if (captured === undefined) throw new Error("no aggregate was run");
      return captured;
    },
  };
}

function row(overrides: Partial<AggregateRow> & { date: string }): AggregateRow {
  return {
    tracked: 0,
    ranked: 0,
    total_position: null,
    top3: 0,
    top10: 0,
    top100: 0,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

describe("clampSummaryDays", () => {
  it("defaults to 30 when nothing was asked for", () => {
    expect(clampSummaryDays(undefined)).toBe(RANK_SUMMARY_DEFAULT_DAYS);
  });

  it("clamps rather than refuses, at both ends", () => {
    // A hand-edited URL asking for a decade should get the longest window we
    // serve. Refusing would be pedantry about a request whose intent is clear.
    expect(clampSummaryDays(1)).toBe(RANK_SUMMARY_MIN_DAYS);
    expect(clampSummaryDays(100_000)).toBe(RANK_SUMMARY_MAX_DAYS);
  });

  it("passes a value inside the range through untouched", () => {
    expect(clampSummaryDays(90)).toBe(90);
  });

  it("truncates a fractional request and survives a nonsense one", () => {
    expect(clampSummaryDays(30.9)).toBe(30);
    expect(clampSummaryDays(Number.NaN)).toBe(RANK_SUMMARY_DEFAULT_DAYS);
  });
});

describe("rankSummarySince", () => {
  it("counts back inclusively — 7 days means today and the six before", () => {
    expect(rankSummarySince(7, NOW)).toBe("2026-08-25");
  });

  it("crosses a month boundary", () => {
    expect(rankSummarySince(30, NOW)).toBe("2026-08-02");
    expect(rankSummarySince(90, NOW)).toBe("2026-06-03");
  });

  it("is a cutoff from today, not the newest N dates on record", () => {
    // The distinction that makes an abandoned project look abandoned: the
    // window is anchored to now, so months of silence render as a gap rather
    // than being rescaled to fill the axis.
    expect(rankSummarySince(30, new Date("2026-12-25T00:00:00.000Z"))).toBe(
      "2026-11-26",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The rollup                                                                  */
/* -------------------------------------------------------------------------- */

describe("rankSummary", () => {
  it("bounds the query by the window and by this project alone", async () => {
    const { db, sql } = fakeDb([]);
    await rankSummary(db, WS, PROJECT, 30, NOW);

    const rendered = dialect.sqlToQuery(sql());
    expect(rendered.params).toContain("2026-08-02");
    expect(rendered.params).toContain(PROJECT);
    // Scoped through tracked_keywords rather than by a bound id list, so the
    // statement carries two parameters however many keywords are tracked.
    expect(rendered.sql).toContain("tracked_keywords");
    expect(rendered.sql).toContain("project_id");
  });

  it("echoes the window it actually applied", async () => {
    const { db } = fakeDb([]);
    await expect(rankSummary(db, WS, PROJECT, 90, NOW)).resolves.toMatchObject({
      days: 90,
    });
  });

  it("averages only the keywords that ranked, to one decimal", async () => {
    const { db } = fakeDb([
      // Three keywords checked, two ranked at 2 and 8: the mean is 5, not 3.33.
      row({ date: "2026-08-01", tracked: 3, ranked: 2, total_position: 10, top3: 1, top10: 2, top100: 2 }),
    ]);
    const summary = await rankSummary(db, WS, PROJECT, 30, NOW);

    expect(summary.points[0]).toEqual({
      date: "2026-08-01",
      avgPosition: 5,
      top3: 1,
      top10: 2,
      top100: 2,
      // The denominator counts the keyword that did not rank — it was checked.
      tracked: 3,
    });
  });

  it("rounds an awkward average to one decimal place", async () => {
    const { db } = fakeDb([
      row({ date: "2026-08-01", tracked: 3, ranked: 3, total_position: 10 }),
    ]);
    const summary = await rankSummary(db, WS, PROJECT, 30, NOW);
    expect(summary.points[0]?.avgPosition).toBe(3.3);
  });

  it("reports no average for a day when nothing ranked", async () => {
    // Zero would be the best position possible, drawn from an absence — the
    // one value this must never invent.
    const { db } = fakeDb([
      row({ date: "2026-08-01", tracked: 4, ranked: 0, total_position: null }),
    ]);
    const summary = await rankSummary(db, WS, PROJECT, 30, NOW);

    expect(summary.points[0]?.avgPosition).toBeNull();
    expect(summary.points[0]?.tracked).toBe(4);
    expect(summary.points[0]?.top100).toBe(0);
  });

  it("leaves unchecked days out rather than zero-filling them", async () => {
    // A project first checked on a Tuesday has no Monday. Inventing one would
    // draw a cliff to zero tracked keywords that never happened, which is why
    // the shared type says to plot by `date` and never by index.
    const { db } = fakeDb([
      row({ date: "2026-08-01", tracked: 2, ranked: 2, total_position: 6 }),
      row({ date: "2026-08-05", tracked: 2, ranked: 2, total_position: 4 }),
    ]);
    const summary = await rankSummary(db, WS, PROJECT, 30, NOW);

    expect(summary.points.map((point) => point.date)).toEqual([
      "2026-08-01",
      "2026-08-05",
    ]);
  });

  it("keeps the bands nested, as the SQL's <= thresholds make them", async () => {
    const { db } = fakeDb([
      row({ date: "2026-08-01", tracked: 10, ranked: 8, total_position: 200, top3: 2, top10: 5, top100: 8 }),
    ]);
    const [point] = (await rankSummary(db, WS, PROJECT, 30, NOW)).points;

    // top3 ⊆ top10 ⊆ top100 ⊆ tracked. A chart that stacks these would double
    // count; one that layers them relies on exactly this ordering.
    expect(point?.top3).toBeLessThanOrEqual(point?.top10 ?? 0);
    expect(point?.top10).toBeLessThanOrEqual(point?.top100 ?? 0);
    expect(point?.top100).toBeLessThanOrEqual(point?.tracked ?? 0);
  });

  it("answers an empty series for a project with no snapshots", async () => {
    const { db } = fakeDb([]);
    await expect(rankSummary(db, WS, PROJECT, 30, NOW)).resolves.toEqual({
      days: 30,
      points: [],
    });
  });
});
