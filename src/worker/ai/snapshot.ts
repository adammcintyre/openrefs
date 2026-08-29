/**
 * Turning one LLM answer into one row of AI Visibility.
 *
 * The split between D1 and R2 is the same bargain the audit module makes: D1
 * gets the verdict and a readable excerpt, because those are read on every page
 * view; R2 gets the whole response, because it is read only when someone opens
 * a drill-down and asks "what did it actually say?".
 *
 * The R2 key is `ws:<workspaceId>/ai/<snapshotId>.json`. That prefix is
 * CLAUDE.md hard rule #6 — workspace deletion is a `ws:<id>/` sweep
 * (`purgeWorkspaceR2`), so an answer stored anywhere else would outlive the
 * tenant it belongs to. Nothing extra was needed to cover it.
 */
import { sql } from "drizzle-orm";

import type { Db } from "../../db";
import { aiSnapshots } from "../../db";
import type { AiCitation, AiEngineId } from "../../shared/ai";
import { workspaceR2Prefix } from "../lib/deletion";
import type { LlmResponseResult } from "../dataforseo/ai";
import { matchAnswer, responseExcerpt } from "./matcher";

/** Where one snapshot's full response lives. */
export function aiSnapshotR2Key(workspaceId: string, snapshotId: string): string {
  return `${workspaceR2Prefix(workspaceId)}ai/${snapshotId}.json`;
}

/** Everything one run produced, as the job reports it. */
export interface AiSnapshotWrite {
  snapshotId: string;
  engine: AiEngineId;
  date: string;
  mentioned: boolean;
  cited: boolean;
  citationCount: number;
  /** Citations pointing at the project's own domain. */
  ownCitationCount: number;
  costUsd: number;
  model: string | null;
  r2Key: string;
  excerptChars: number;
  /** Empty when the engine returned no text — a real outcome. See ai.ts. */
  answerChars: number;
}

/**
 * The archive blob. Deliberately more than the raw response: a year from now
 * the question asked of one of these is "what did we conclude, and from what?",
 * and the verdict is worthless without the prompt that produced it.
 */
export interface AiSnapshotArchive {
  v: 1;
  snapshotId: string;
  promptId: string;
  prompt: string;
  engine: AiEngineId;
  model: string | null;
  domain: string;
  date: string;
  fetchedAt: string;
  mentioned: boolean;
  cited: boolean;
  citations: AiCitation[];
  answerText: string;
  fanOutQueries: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  moneySpentUsd: number | null;
  costUsd: number;
  /** Exactly what DataForSEO returned in `result[0]`, untouched. */
  raw: unknown;
}

export interface WriteAiSnapshotInput {
  db: Db;
  bucket: R2Bucket;
  workspaceId: string;
  promptId: string;
  prompt: string;
  domain: string;
  /** `YYYY-MM-DD` the run belongs to, fixed by the caller. */
  date: string;
  now: Date;
  response: LlmResponseResult;
}

/**
 * Judges one answer, archives it, and records the verdict.
 *
 * Two orderings here are deliberate.
 *
 * **The id is resolved before anything is written.** A re-run on the same day
 * updates the existing row rather than inserting one, so minting a fresh uuid
 * would put the new archive at a key the surviving row does not point to —
 * every drill-down would then render the *previous* run's answer beside this
 * run's verdict. Reusing the id makes the R2 write an overwrite, which is what
 * "this day's answer was refreshed" should mean.
 *
 * **The blob is written before the row.** An answer archived but not recorded
 * is a wasted object the workspace sweep collects; an answer recorded but not
 * archived is a drill-down that 404s while the row insists the archive is
 * there. Blob first makes the survivable failure the likely one.
 */
export async function writeAiSnapshot(
  input: WriteAiSnapshotInput,
): Promise<AiSnapshotWrite> {
  const { db, bucket, workspaceId, promptId, prompt, domain, date, now, response } =
    input;

  const verdict = matchAnswer({
    domain,
    answerText: response.answerText,
    citationUrls: response.citationUrls,
  });

  /*
   * Titles come from the API, hosts and ownership from the matcher. Keyed by
   * URL because `citationUrls` is `annotations` with the URL-less ones
   * dropped, so the two lists are not positionally aligned.
   */
  const titles = new Map<string, string | null>();
  for (const annotation of response.annotations) {
    if (annotation.url !== null) titles.set(annotation.url.trim(), annotation.title);
  }
  const citations: AiCitation[] = verdict.citations.map((citation) => ({
    url: citation.url,
    title: titles.get(citation.url) ?? null,
    host: citation.host,
    ours: citation.ours,
  }));

  const [existing] = await db.all<{ id: string }>(sql`
    SELECT id FROM ai_snapshots
     WHERE prompt_id = ${promptId} AND engine = ${response.engine} AND date = ${date}
     LIMIT 1
  `);
  const snapshotId = existing?.id ?? crypto.randomUUID();
  const r2Key = aiSnapshotR2Key(workspaceId, snapshotId);

  const archive: AiSnapshotArchive = {
    v: 1,
    snapshotId,
    promptId,
    prompt,
    engine: response.engine,
    model: response.model,
    domain,
    date,
    fetchedAt: now.toISOString(),
    mentioned: verdict.mentioned,
    cited: verdict.cited,
    citations,
    answerText: response.answerText,
    fanOutQueries: response.fanOutQueries,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    moneySpentUsd: response.moneySpentUsd,
    costUsd: response.costUsd,
    raw: response.raw,
  };

  await bucket.put(r2Key, JSON.stringify(archive), {
    httpMetadata: { contentType: "application/json" },
  });

  const excerpt = responseExcerpt(response.answerText, verdict.mentionIndex);

  /*
   * Upsert on (prompt, engine, date): a second run the same day refreshes that
   * day's answer rather than adding a row. The id is the one resolved above,
   * so `DO UPDATE` never has to touch it.
   */
  await db
    .insert(aiSnapshots)
    .values({
      id: snapshotId,
      promptId,
      date,
      engine: response.engine,
      mentioned: verdict.mentioned,
      cited: verdict.cited,
      citationsJson: citations,
      responseExcerpt: excerpt,
      model: response.model,
      costUsd: response.costUsd,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [aiSnapshots.promptId, aiSnapshots.engine, aiSnapshots.date],
      set: {
        mentioned: verdict.mentioned,
        cited: verdict.cited,
        citationsJson: citations,
        responseExcerpt: excerpt,
        model: response.model,
        costUsd: response.costUsd,
        createdAt: now,
      },
    });

  return {
    snapshotId,
    engine: response.engine,
    date,
    mentioned: verdict.mentioned,
    cited: verdict.cited,
    citationCount: citations.length,
    ownCitationCount: citations.filter((c) => c.ours).length,
    costUsd: response.costUsd,
    model: response.model,
    r2Key,
    excerptChars: excerpt.length,
    answerChars: response.answerText.length,
  };
}
