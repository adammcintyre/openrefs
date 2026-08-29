import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Tracks prefers-reduced-motion, and keeps tracking it — the user can flip the
 * OS setting with the page open, so this subscribes rather than reading once.
 *
 * The CSS rule in theme.css already neutralises CSS transitions and
 * animations. This exists for Recharts, which animates by interpolating SVG
 * attributes in JavaScript where no stylesheet can reach it.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
