/**
 * The OpenAPI drift test.
 *
 * `src/worker/openapi.ts` is hand-maintained, which is a deliberate trade: the
 * document carries prose that no generator could write, and in exchange it can
 * fall behind the code. This file is the thing that stops it.
 *
 * It works from the route registry rather than from a list of paths, so it
 * fails in both directions:
 *
 *  - **A module gains no documentation.** Mount a new router in
 *    `routes/index.ts` and forget the document, and the first test fails
 *    naming your module.
 *  - **A module is removed and its documentation is left behind.** Delete a
 *    router and its paths become orphaned, and the second test fails naming
 *    them.
 *
 * What it cannot check is whether an individual operation's parameters still
 * match its handler's zod schema — nothing short of deriving the document from
 * the schemas could, and that is the generator we chose not to have. Treat the
 * per-operation detail as prose that a reviewer keeps honest, and this file as
 * the guard on the shape.
 */
import { describe, expect, it } from "vitest";

import { ERROR_STATUS } from "../shared/api";
import { APP_VERSION } from "../shared/version";
import {
  UNDOCUMENTED_MODULES,
  listOperations,
  openApiDocument,
  operationCount,
} from "./openapi";
import { API_PREFIX, routeModules } from "./routes";

/**
 * Which documented paths belong to which mounted module, keyed the same way
 * `routeModules` keys itself: `label ?? path`.
 *
 * A table rather than a prefix match, because three modules do not own the
 * paths their mount point would suggest. AI Visibility mounts on `/projects`
 * but owns only `/projects/{id}/ai/*`; the audits module is mounted twice and
 * owns `/audits/*` plus `/projects/{id}/audits`; and the projects module owns
 * what is left. Path parameter names are matched loosely (`{...}`) so renaming
 * one in the document is not a test failure.
 */
const MODULE_PATHS: Record<string, RegExp> = {
  "/health": /^\/health$/,
  "/auth": /^\/auth(\/|$)/,
  "/workspaces": /^\/workspaces(\/|$)/,
  "/usage": /^\/usage(\/|$)/,
  "/keywords": /^\/keywords\//,
  "/domains": /^\/domains\//,
  "/backlinks": /^\/backlinks\//,
  "/gap": /^\/gap\//,
  "/collections": /^\/collections(\/|$)/,
  "/history": /^\/history(\/|$)/,
  "/content": /^\/content\//,
  "/projects": /^\/projects$|^\/projects\/\{[^}]+\}$|^\/projects\/\{[^}]+\}\/keywords/,
  "/projects/ai": /^\/projects\/\{[^}]+\}\/ai(\/|$)/,
  "/audits": /^\/audits\/|^\/projects\/\{[^}]+\}\/audits$/,
  "/dashboard": /^\/dashboard$/,
  "/gsc": /^\/gsc\//,
  "/meta": /^\/meta\//,
  "/openapi.json": /^\/openapi\.json$/,
  "/mcp": /^\/mcp$/,
};

/** Every mounted module, keyed as the registry keys it. */
const mountedKeys = routeModules.map(({ path, label }) => label ?? path);

/** The keys we expect to find documentation for. */
const documentedKeys = mountedKeys.filter((key) => !UNDOCUMENTED_MODULES.includes(key));

const operations = listOperations();
const paths = Object.keys(openApiDocument.paths);

describe("route registry ↔ OpenAPI document", () => {
  it("documents every mounted module", () => {
    for (const key of documentedKeys) {
      const pattern = MODULE_PATHS[key];
      expect(
        pattern,
        `add a MODULE_PATHS entry for the newly mounted module ${key}`,
      ).toBeDefined();

      const owned = operations.filter((entry) => (pattern as RegExp).test(entry.path));
      expect(
        owned.length,
        `module ${key} is mounted but has no operations in src/worker/openapi.ts`,
      ).toBeGreaterThan(0);
    }
  });

  it("has no documentation for a module that is no longer mounted", () => {
    const live = documentedKeys
      .map((key) => MODULE_PATHS[key])
      .filter((pattern): pattern is RegExp => pattern !== undefined);

    const orphans = paths.filter((path) => !live.some((pattern) => pattern.test(path)));
    expect(
      orphans,
      "these documented paths belong to no mounted module — was a router removed?",
    ).toEqual([]);
  });

  it("keeps the ownership table itself in step with the registry", () => {
    // Otherwise a stale entry could keep a deleted module's paths "owned" and
    // silently disarm the orphan check above.
    for (const key of Object.keys(MODULE_PATHS)) {
      expect(mountedKeys, `MODULE_PATHS names ${key}, which is not mounted`).toContain(key);
    }
  });

  it("only excludes modules that are mounted, and says why", () => {
    // `/dev` is excluded because every route in it 404s unless APP_ENV is
    // development: publishing it would document endpoints that do not exist on
    // any real deployment. The exclusion is a named list rather than a silent
    // skip so removing the module fails here rather than passing quietly.
    for (const key of UNDOCUMENTED_MODULES) {
      expect(mountedKeys, `${key} is excluded from the document but is not mounted`).toContain(
        key,
      );
    }
    expect(UNDOCUMENTED_MODULES).toEqual(["/dev"]);
  });
});

describe("document shape", () => {
  it("is OpenAPI 3.1, versioned with the app", () => {
    expect(openApiDocument.openapi).toMatch(/^3\.1\./);
    expect(openApiDocument.info.version).toBe(APP_VERSION);
  });

  it("serves paths relative to the versioned prefix", () => {
    // The whole ownership table above assumes this. If the server URL ever
    // stops carrying the prefix, every pattern here is wrong.
    expect(openApiDocument.servers?.[0]?.url).toBe(API_PREFIX);
    for (const path of paths) {
      expect(path, "paths must not repeat the prefix the server URL carries").not.toContain(
        API_PREFIX,
      );
      expect(path.startsWith("/"), `${path} should start with a slash`).toBe(true);
    }
  });

  it("covers the whole surface", () => {
    // A floor, not a target. It exists so a document that silently loses half
    // its paths — a bad merge, a truncated edit — fails rather than passing the
    // per-module check on one surviving operation each.
    expect(operationCount()).toBeGreaterThan(40);
  });

  it("gives every operation a unique operationId", () => {
    const ids = operations.map((entry) => entry.operationId);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
    for (const id of ids) expect(id).not.toBe("");
  });

  it("gives every operation at least one response and a tag", () => {
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const where = `${method.toUpperCase()} ${path}`;
        expect(Object.keys(operation.responses).length, where).toBeGreaterThan(0);
        expect(operation.tags.length, where).toBeGreaterThan(0);
        expect(operation.summary, where).toBeTruthy();
      }
    }
  });

  it("declares both authentication schemes", () => {
    const schemes = openApiDocument.components.securitySchemes ?? {};
    expect(Object.keys(schemes).sort()).toEqual(["apiKey", "session"]);
  });

  it("publishes the whole error code table", () => {
    // Generated from ERROR_STATUS in the document, so this asserts the
    // generation actually happened rather than re-checking a copy.
    const codes = openApiDocument.components.schemas?.ErrorCode as
      | { enum?: string[] }
      | undefined;
    expect(codes?.enum?.slice().sort()).toEqual(Object.keys(ERROR_STATUS).sort());
  });

  it("leaves the public endpoints public", () => {
    // Requiring a key to read the document that explains how to get a key
    // would be a closed loop.
    for (const path of ["/openapi.json", "/health"]) {
      expect(openApiDocument.paths[path]?.get?.security, path).toEqual([]);
    }
  });
});
