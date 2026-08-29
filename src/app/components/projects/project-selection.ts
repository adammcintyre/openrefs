/**
 * "Which project am I looking at", and where that answer comes from.
 *
 * Two sources, in a fixed order:
 *
 *  1. **`?project=` in the URL wins.** A link to a project is a link to *that*
 *     project. If a remembered selection could override it, pasting a URL to a
 *     colleague would show them their own project under your heading — the
 *     kind of bug that is only noticed after someone acts on the numbers.
 *  2. **Otherwise the last project used in this workspace**, from
 *     localStorage. Per workspace, not global: an agency's workspaces are
 *     different clients, and restoring one client's project inside another's
 *     workspace is both wrong and briefly alarming.
 *
 * Neither source is trusted on sight. A stored id from a deleted project, or a
 * `?project=` belonging to another tenant, must resolve to "nothing selected"
 * — which renders the picker — rather than being used to build a request path.
 * That validation is the reason this takes the project list as an argument.
 *
 * Storage is best-effort throughout: private mode, a quota or a browser policy
 * can make every call here throw, and none of it is worth failing a render for.
 */

const KEY_PREFIX = "openrefs.rankTracking.project:";

/** The query parameter that pins a project in a shareable URL. */
export const PROJECT_PARAM = "project";

/** The shape this module needs of a project. Structural, so `Project` fits. */
interface Identifiable {
  id: string;
}

/**
 * Resolve the selected project id against the projects that actually exist.
 *
 * Returns null when neither source names a live project, which is the module's
 * empty state: the picker, not an error and not a silent fallback to whichever
 * project happens to be first. Auto-selecting would make "you are looking at
 * project X" something the app decided rather than something the user chose.
 */
export function resolveProjectId(
  projects: ReadonlyArray<Identifiable>,
  sources: { fromUrl?: string | null; fromStorage?: string | null },
): string | null {
  const exists = (id: string | null | undefined): id is string =>
    typeof id === "string" &&
    id !== "" &&
    projects.some((project) => project.id === id);

  if (exists(sources.fromUrl)) return sources.fromUrl;
  if (exists(sources.fromStorage)) return sources.fromStorage;
  return null;
}

export function readLastProjectId(workspaceId: string | null): string | null {
  if (workspaceId === null || workspaceId === "") return null;
  try {
    const stored = globalThis.localStorage?.getItem(
      `${KEY_PREFIX}${workspaceId}`,
    );
    return stored === null || stored === undefined || stored === ""
      ? null
      : stored;
  } catch {
    return null;
  }
}

export function writeLastProjectId(
  workspaceId: string | null,
  projectId: string | null,
): void {
  if (workspaceId === null || workspaceId === "") return;
  const key = `${KEY_PREFIX}${workspaceId}`;
  try {
    if (projectId === null || projectId === "") {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, projectId);
    }
  } catch {
    /* Preference only — the module works without it. */
  }
}

/**
 * The query string for a given selection.
 *
 * Built from the existing params so that unrelated state a future sub-screen
 * puts in the URL survives a project switch, and so clearing the selection
 * removes the key rather than leaving `?project=`.
 */
export function projectSearchParams(
  current: URLSearchParams,
  projectId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (projectId === null || projectId === "") next.delete(PROJECT_PARAM);
  else next.set(PROJECT_PARAM, projectId);
  return next;
}
