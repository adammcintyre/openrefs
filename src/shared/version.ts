/**
 * Reported by GET /api/v1/health and shown in the app footer.
 *
 * Kept as a literal rather than imported from package.json so the same value
 * survives the Worker bundle, the SPA bundle and vitest without build-time
 * `define` plumbing. Bump it alongside package.json's `version`.
 */
export const APP_VERSION = "0.1.0";
