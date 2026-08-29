/**
 * The R2 layout for AI answers.
 *
 * Small, but load-bearing twice over: CLAUDE.md hard rule #6 says every blob
 * holding workspace data must sit under the prefix workspace deletion sweeps,
 * and the drill-down finds an archive by rebuilding this key. A key that
 * drifted from `workspaceR2Prefix` would leave a deleted tenant's answers in
 * the bucket, which is the failure this pins.
 */
import { describe, expect, it } from "vitest";

import { workspaceR2Prefix } from "../lib/deletion";
import { aiSnapshotR2Key } from "./snapshot";

const WORKSPACE = "10bf20b1-8ac7-4ca2-9862-7bfd943c5c84";
const SNAPSHOT = "d5b2dc4e-21ba-4d64-8410-6939d7b026fc";

describe("aiSnapshotR2Key", () => {
  it("is `ws:<workspaceId>/ai/<snapshotId>.json`", () => {
    expect(aiSnapshotR2Key(WORKSPACE, SNAPSHOT)).toBe(
      `ws:${WORKSPACE}/ai/${SNAPSHOT}.json`,
    );
  });

  it("sits under the prefix workspace deletion sweeps", () => {
    // The sweep is `bucket.list({ prefix: workspaceR2Prefix(id) })`, so this
    // is the whole of "AI archives are covered by the deletion cascade".
    expect(aiSnapshotR2Key(WORKSPACE, SNAPSHOT).startsWith(
      workspaceR2Prefix(WORKSPACE),
    )).toBe(true);
  });

  it("keeps one workspace's answers out of another's namespace", () => {
    const other = "00000000-0000-4000-8000-000000000000";
    expect(aiSnapshotR2Key(other, SNAPSHOT)).not.toContain(WORKSPACE);
  });

  it("separates AI archives from audit blobs under the same workspace", () => {
    // Both live under `ws:<id>/`; only the second segment tells them apart, so
    // a change to either must not make one a prefix of the other.
    expect(aiSnapshotR2Key(WORKSPACE, SNAPSHOT)).toContain("/ai/");
    expect(aiSnapshotR2Key(WORKSPACE, SNAPSHOT)).not.toContain("/audits/");
  });
});
