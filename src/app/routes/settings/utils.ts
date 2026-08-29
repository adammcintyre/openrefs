/**
 * Plain helpers used across the settings screens. Pulled out of the old
 * ui.tsx grab-bag on its removal — these two have nothing to do with
 * presentation (that's `components/ui/` now) and everything to do with this
 * folder's data, so they stay local rather than moving to `lib/`.
 */

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Copy-to-clipboard that reports whether it worked. The API is unavailable in
 * insecure contexts and can be denied, so callers must handle false.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
