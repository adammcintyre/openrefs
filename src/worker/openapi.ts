/**
 * The OpenRefs OpenAPI 3.1 description, served at `GET /api/v1/openapi.json`.
 *
 * ## This file is hand-maintained. That is the design, not an oversight.
 *
 * The obvious alternative is generation: decorate the Hono routes, or run the
 * zod schemas through a `zod-to-openapi` bridge and emit the document from the
 * code that already exists. Both were rejected, for two reasons.
 *
 * **No new dependency.** OpenRefs runs on the Cloudflare free plan and the
 * dependency list in package.json is deliberately short — every package is
 * bundle weight, a supply-chain surface and one more thing to keep current for
 * a Worker that is mostly glue. A generator would earn its place if the routes
 * were uniform; they are not. `POST /backlinks/scores` takes its workspace in
 * the body, `POST /content/wordcount` takes it in the query, `/domains/countries`
 * has no `location`, `/gap/keywords/export.csv` accepts a `limit` it then
 * ignores. Every one of those would need a hand-written override anyway, and a
 * generator with an override for half its output is a worse hand-written
 * document with extra steps.
 *
 * **The document is a product surface.** This is what an integrator reads
 * before writing a line of code, and what the MCP server's tool descriptions
 * are derived from. The valuable part is not the field list — a generator can
 * produce that — it is the prose that says `paid=true` changes what is
 * *fetched* rather than what is *shown*, that `maxDomainScore` keeps unknown
 * scores while `minTraffic` drops them, that a Search Console `to` is clamped
 * rather than rejected. Those sentences cost real money to learn and they live
 * nowhere a generator could find them. So they live here, next to the
 * operation they describe, written for a human.
 *
 * ## The drift test
 *
 * Hand-maintenance has one failure mode: a module gets mounted, or grows a
 * route, and nobody documents it. `src/worker/openapi.test.ts` closes that gap.
 * It walks `routeModules` in src/worker/routes/index.ts, and fails when a
 * mounted module has no documented operations — so adding a feature module
 * without adding its operations here breaks the build rather than shipping a
 * quietly incomplete API reference. `UNDOCUMENTED_MODULES` below is the single
 * escape hatch, and it is an allowlist of one.
 *
 * ## Conventions
 *
 *  - **Paths are written without the `/api/v1` prefix.** `servers[0].url`
 *    carries it, so a key here is `/keywords/overview`, never
 *    `/api/v1/keywords/overview`. The drift test relies on this.
 *  - **OpenAPI 3.1 is JSON Schema 2020-12**, so a nullable field is
 *    `type: ["number", "null"]`. The 3.0-era `nullable: true` is typed as
 *    `never` on `JsonSchema` below, which turns the habit into a compile error.
 *  - **Response schemas mirror src/shared/*.ts verbatim.** Field names, and
 *    which fields are nullable, are copied from the TypeScript contract the
 *    Worker and the SPA both import. If the two disagree, the shared type wins
 *    and this file is wrong.
 *  - **Prose is rationed.** A long `description` means the behaviour genuinely
 *    surprises people who have read the field names. Everything else gets a
 *    one-line `summary` and nothing more.
 */

import {
  AI_ENGINE_IDS,
  AI_PROMPT_MAX_CHARS,
  AI_PROMPTS_MAX_PER_PROJECT,
  AI_RUN_WINDOW_SECONDS,
} from "../shared/ai";
import { ERROR_STATUS } from "../shared/api";
import {
  AUDIT_CATEGORIES,
  AUDIT_CRAWL_SIZES,
  AUDIT_ISSUES_PAGE_SIZE,
  AUDIT_SEVERITIES,
  AUDIT_STATUSES,
} from "../shared/audits";
import {
  BACKLINKS_HISTORY_MIN_DATE,
  BACKLINKS_LIST_MODES,
  BACKLINKS_SCORES_MAX_TARGETS,
} from "../shared/backlinks";
import {
  COLLECTION_KEYWORDS_BULK_MAX,
  COLLECTION_NAME_MAX_LENGTH,
} from "../shared/collections";
import {
  CONTENT_DEFAULT_ROWS,
  CONTENT_EXPAND_OPTIONS,
  CONTENT_MAX_ROWS,
  CONTENT_SORTS,
  CONTENT_WORDCOUNT_MAX_URLS,
} from "../shared/content";
import {
  GAP_MAX_COMPETITORS,
  GAP_MAX_PAGES,
  GAP_MODE_DESCRIPTIONS,
  GAP_MODES,
} from "../shared/gap";
import {
  HISTORY_DEFAULT_LIMIT,
  HISTORY_KEEP,
  HISTORY_MAX_LIMIT,
  HISTORY_MODULES,
} from "../shared/history";
import {
  GSC_DATA_LAG_DAYS,
  GSC_DEFAULT_RANGE_DAYS,
  GSC_OPPORTUNITY_RULES,
  GSC_ROW_LIMIT,
} from "../shared/gsc";
import { DEVICES, PROJECT_NAME_MAX_LENGTH } from "../shared/projects";
import { TRACKED_KEYWORDS_BULK_MAX } from "../shared/tracking";
import { APP_VERSION } from "../shared/version";
import { WORKSPACE_ROLES } from "../shared/workspaces";
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS } from "./lib/rate-limit";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./lib/research";

/* -------------------------------------------------------------------------- */
/* Minimal structural types                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Just enough of OpenAPI 3.1 to describe this API, and no more. Deliberately
 * not `openapi-types` or `openapi3-ts`: a dependency whose only job is to type
 * an object literal is a dependency that can break a build without changing
 * behaviour, and the subset below is a few dozen lines.
 */

/** A `$ref` to somewhere in `components`. */
export interface Reference {
  $ref: string;
}

/**
 * A JSON Schema 2020-12 subset — what OpenAPI 3.1 schemas actually are.
 *
 * `nullable` is typed `never` on purpose. It is the single most common 3.0
 * habit to carry into a 3.1 document, it validates as an unknown keyword
 * rather than erroring, and the result is a schema that silently rejects the
 * `null`s this API really returns. Typing it away makes it a compile error.
 */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: (string | number | boolean | null)[];
  const?: string | number | boolean;
  default?: string | number | boolean;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: JsonSchema | boolean;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  /** Never valid here — 3.1 spells this `type: [..., "null"]`. */
  nullable?: never;
}

export interface ParameterObject {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema: JsonSchema;
}

/** Written out inline, or `$ref`d into `components.parameters`. */
export type Parameter = ParameterObject | Reference;

export interface MediaType {
  schema: JsonSchema;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content: Record<string, MediaType>;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaType>;
}

/** Written out inline, or `$ref`d into `components.responses`. */
export type Response = ResponseObject | Reference;

/** `{ apiKey: [] }` — the scheme name, and the scopes it needs (never any). */
export type SecurityRequirement = Record<string, string[]>;

export interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: Parameter[];
  requestBody?: RequestBodyObject;
  responses: Record<string, Response>;
  /** Overrides the document-level requirement. `[]` means public. */
  security?: SecurityRequirement[];
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type PathItem = Partial<Record<HttpMethod, Operation>>;

export interface SecurityScheme {
  type: "http" | "apiKey";
  scheme?: string;
  bearerFormat?: string;
  in?: "cookie" | "header" | "query";
  name?: string;
  description: string;
}

export interface OpenApiComponents {
  schemas: Record<string, JsonSchema>;
  parameters: Record<string, ParameterObject>;
  responses: Record<string, ResponseObject>;
  securitySchemes: Record<string, SecurityScheme>;
}

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
  license: { name: string; identifier: string };
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiTag {
  name: string;
  description: string;
}

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  tags?: OpenApiTag[];
  security?: SecurityRequirement[];
  paths: Record<string, PathItem>;
  components: OpenApiComponents;
}

/** Every method this document uses, in the order `listOperations` reports. */
const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
];

/* -------------------------------------------------------------------------- */
/* Deliberate omissions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mounted route modules that are intentionally absent from `paths`.
 *
 * `/dev` is the whole list and is expected to stay that way. Every route in
 * src/worker/routes/dev.ts 404s unless `APP_ENV === "development"`, so it does
 * not exist on any deployment an integrator can reach — documenting it would
 * describe endpoints that answer 404 in production, which is worse than
 * silence. The drift test reads this array so the exclusion is a decision on
 * the record rather than a gap nobody noticed.
 */
export const UNDOCUMENTED_MODULES: readonly string[] = ["/dev"];

/* -------------------------------------------------------------------------- */
/* Schema helpers                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Function declarations rather than arrow consts: the document is built at
 * module load, and hoisting means the definition order below never has to
 * match the order the document uses them in.
 */

function ref(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` };
}

function parameterRef(name: string): Reference {
  return { $ref: `#/components/parameters/${name}` };
}

function responseRef(name: string): Reference {
  return { $ref: `#/components/responses/${name}` };
}

interface ObjectOptions {
  /** Keys optional in the TypeScript interface (`foo?: T`). Everything else is required. */
  optional?: string[];
  description?: string;
}

/**
 * An object schema whose `required` list is derived rather than retyped.
 *
 * The shared types are overwhelmingly all-required, so listing the exceptions
 * is both shorter and harder to get wrong than listing the rule: a field added
 * to `properties` is required unless someone says otherwise, which is exactly
 * how the TypeScript interface reads.
 */
function obj(
  properties: Record<string, JsonSchema>,
  options: ObjectOptions = {},
): JsonSchema {
  const optional = new Set(options.optional ?? []);
  const required = Object.keys(properties).filter((key) => !optional.has(key));
  const schema: JsonSchema = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  if (options.description !== undefined) schema.description = options.description;
  return schema;
}

/** An object that also carries `ResultMeta` — the DataForSEO-backed responses. */
function metered(
  properties: Record<string, JsonSchema>,
  options: ObjectOptions = {},
): JsonSchema {
  const body = obj(properties, { optional: options.optional });
  const schema: JsonSchema = { allOf: [ref("ResultMeta"), body] };
  if (options.description !== undefined) schema.description = options.description;
  return schema;
}

function str(description?: string): JsonSchema {
  return { type: "string", description };
}

function num(description?: string): JsonSchema {
  return { type: "number", description };
}

function int(description?: string): JsonSchema {
  return { type: "integer", description };
}

function bool(description?: string): JsonSchema {
  return { type: "boolean", description };
}

function nullableStr(description?: string): JsonSchema {
  return { type: ["string", "null"], description };
}

function nullableNum(description?: string): JsonSchema {
  return { type: ["number", "null"], description };
}

function nullableInt(description?: string): JsonSchema {
  return { type: ["integer", "null"], description };
}

function nullableBool(description?: string): JsonSchema {
  return { type: ["boolean", "null"], description };
}

/** `T | null` where `T` is a named schema — 3.1 has no `$ref` + `null` shorthand. */
function nullableRef(name: string, description?: string): JsonSchema {
  return { anyOf: [ref(name), { type: "null" }], description };
}

function arrayOf(items: JsonSchema, description?: string): JsonSchema {
  return { type: "array", items, description };
}

/** `Record<string, T>`. */
function mapOf(values: JsonSchema, description?: string): JsonSchema {
  return { type: "object", additionalProperties: values, description };
}

/** `Record<string, T> | null`. */
function nullableMapOf(values: JsonSchema, description?: string): JsonSchema {
  return { type: ["object", "null"], additionalProperties: values, description };
}

function enumOf(values: readonly string[], description?: string): JsonSchema {
  return { type: "string", enum: [...values], description };
}

function numberEnum(values: readonly number[], description?: string): JsonSchema {
  return { type: "integer", enum: [...values], description };
}

/** A single-value field, e.g. `deleted: true` or `status: "ok"`. */
function literal(value: string | number | boolean, description?: string): JsonSchema {
  const type =
    typeof value === "string"
      ? "string"
      : typeof value === "number"
        ? "number"
        : "boolean";
  return { type, const: value, description };
}

/* -------------------------------------------------------------------------- */
/* Parameter and response helpers                                              */
/* -------------------------------------------------------------------------- */

function queryParam(
  name: string,
  schema: JsonSchema,
  options: { required?: boolean; description?: string } = {},
): ParameterObject {
  return {
    name,
    in: "query",
    required: options.required ?? false,
    description: options.description,
    schema,
  };
}

function pathParam(
  name: string,
  description: string,
  format?: string,
): ParameterObject {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: format === undefined ? { type: "string" } : { type: "string", format },
  };
}

/** `?from=2026-01-31` — the date form every window parameter in this API uses. */
function isoDateParam(name: string, description: string): ParameterObject {
  return queryParam(
    name,
    { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    { description },
  );
}

/** The workspace + market triple every Labs-backed route requires. */
function marketParams(): Parameter[] {
  return [
    parameterRef("WorkspaceQuery"),
    parameterRef("LocationQuery"),
    parameterRef("LanguageQuery"),
  ];
}

function pagingParams(): Parameter[] {
  return [parameterRef("LimitQuery"), parameterRef("OffsetQuery")];
}

/**
 * The six row filters the Labs-backed list routes share.
 *
 * All of them are applied **upstream**, in the DataForSEO request, not to rows
 * already fetched — which is why a filtered page costs one call rather than
 * pulling a thousand rows to show fifty.
 */
function filterParams(): Parameter[] {
  return [
    queryParam("minVolume", { type: "number", minimum: 0 }, {
      description: "Keep rows with at least this monthly search volume.",
    }),
    queryParam("maxVolume", { type: "number", minimum: 0 }, {
      description: "Keep rows at or below this monthly search volume.",
    }),
    queryParam("minDifficulty", { type: "number", minimum: 0, maximum: 100 }, {
      description: "Keep rows with at least this keyword difficulty (0–100).",
    }),
    queryParam("maxDifficulty", { type: "number", minimum: 0, maximum: 100 }, {
      description: "Keep rows at or below this keyword difficulty (0–100).",
    }),
    queryParam("include", { type: "string", minLength: 1 }, {
      description: "Keep rows whose keyword contains this substring.",
    }),
    queryParam("exclude", { type: "string", minLength: 1 }, {
      description: "Drop rows whose keyword contains this substring.",
    }),
  ];
}

function jsonResponse(schemaName: string, description: string): ResponseObject {
  return {
    description,
    content: { "application/json": { schema: ref(schemaName) } },
  };
}

/** A `text/csv` download. The only responses in this document that are not JSON. */
function csvResponse(description: string): ResponseObject {
  return {
    description,
    content: { "text/csv": { schema: { type: "string" } } },
  };
}

function noContent(description: string): ResponseObject {
  return { description };
}

function jsonBody(schema: JsonSchema, description?: string): RequestBodyObject {
  return {
    required: true,
    description,
    content: { "application/json": { schema } },
  };
}

/** A one-off error response, for a status whose meaning is route-specific. */
function errorResponse(description: string): ResponseObject {
  return {
    description,
    content: { "application/json": { schema: ref("ApiError") } },
  };
}

/**
 * The reusable error responses, and the status each answers on.
 *
 * Keyed by name rather than by status so an operation lists what can go wrong
 * in words — `errors("Unauthorized", "SpendCapExceeded")` — and the numbers are
 * filled in from one table.
 */
const REUSABLE_ERROR_STATUS = {
  SpendCapExceeded: "402",
  Unauthorized: "401",
  Forbidden: "403",
  NotFound: "404",
  NoCredentials: "409",
  ValidationFailed: "422",
  RateLimited: "429",
  UpstreamError: "502",
  UpstreamTimeout: "504",
} as const;

type ReusableError = keyof typeof REUSABLE_ERROR_STATUS;

function errors(...names: ReusableError[]): Record<string, Response> {
  const out: Record<string, Response> = {};
  for (const name of names) out[REUSABLE_ERROR_STATUS[name]] = responseRef(name);
  return out;
}

/**
 * Everything that can go wrong on a DataForSEO-backed read.
 *
 * Attached as a set because these genuinely travel together: any route that
 * spends can be refused by the cap, can find no credentials, and can be failed
 * or timed out by the provider. Routes that never call DataForSEO must not
 * carry 402 or `no_credentials`, and do not.
 */
function dataForSeoErrors(): Record<string, Response> {
  return errors(
    "SpendCapExceeded",
    "Unauthorized",
    "Forbidden",
    "NoCredentials",
    "ValidationFailed",
    "UpstreamError",
    "UpstreamTimeout",
  );
}

/** `GscOpportunityList<T>` — generics do not survive into JSON Schema. */
function opportunityList(itemSchemaName: string): JsonSchema {
  return obj({
    items: arrayOf(ref(itemSchemaName), "Already sorted and already capped."),
    total: int(
      "Matches before the cap. `total > items.length` is the truncation test.",
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* info.description                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The error-code table, generated from `ERROR_STATUS` itself.
 *
 * Written out by hand this would be nineteen rows that nobody re-checks after
 * the first review. Generated, a new code appears in the published document
 * the moment it appears in src/shared/api.ts, and a status change cannot leave
 * a stale number behind.
 */
function errorCodeTable(): string {
  const rows = Object.entries(ERROR_STATUS).map(
    ([code, status]) => `| \`${code}\` | ${status} |`,
  );
  return ["| Code | HTTP status |", "| --- | --- |", ...rows].join("\n");
}

const INFO_DESCRIPTION = `
OpenRefs is open-source SEO intelligence that runs on **your own DataForSEO
account**. There is no OpenRefs credit, no markup and no reseller tier: every
keyword, domain, backlink, gap, audit and AI-visibility call in this API is
billed by DataForSEO to the credentials stored on the workspace that made it.

## Authentication

Two schemes, either of which satisfies every authenticated operation.

### \`apiKey\` — \`Authorization: Bearer orf_<token>\`

Programmatic access. Keys are minted in the app under **Settings → API Keys**,
where the plaintext is shown **once** and never again; only a hash is stored.

A key is bound to exactly one workspace and always acts with the **\`member\`**
role, whatever the role of the person who created it. That is deliberate: a key
can read everything and spend against the workspace's DataForSEO account, but
it cannot rename a workspace, change the spend cap, manage members, mint
further keys, or create and delete projects. Those need a signed-in human.

### \`session\` — the \`orf_session\` cookie

What the SPA uses. Set by \`POST /auth/register\` and \`POST /auth/login\`, cleared
by \`POST /auth/logout\`. A handful of operations are session-only and answer
**403** to an API key — \`GET /auth/me\` and the Google OAuth redirects among
them — because they are about the *person*, not the workspace.

## Workspace scoping

Every workspace-scoped endpoint takes \`?workspace=<id>\` **explicitly**. There is
no implicit "current workspace" and no "the caller's first workspace" fallback:
a request that does not name a workspace is a validation failure, not a guess.

Membership is verified on every call. **A workspace the caller does not belong
to and a workspace that does not exist both answer 403**, never 404. That is on
purpose — a 404 for one and a 403 for the other would turn this API into an
oracle for which workspace ids are real.

Ids in a path are the same story: a project, collection or audit id belonging to
another tenant reads as "not found" rather than "not yours".

## Errors

Every non-2xx response has exactly this body:

\`\`\`json
{ "error": { "code": "spend_cap_exceeded", "message": "...", "details": {} } }
\`\`\`

\`code\` is one of the values below and is what a client should switch on;
\`message\` is human-readable and safe to display; \`details\` is present on
validation failures and carries the flattened field errors.

${errorCodeTable()}

## What things cost

Every DataForSEO-backed call spends the calling workspace's own credits, and
every one of them is metered into that workspace's monthly usage and checked
against its **monthly spend cap** before the request goes out. Responses from
those endpoints carry a \`costUsd\` / \`cached\` pair (\`ResultMeta\`) saying what
this particular answer cost — \`0\` with \`cached: true\` is the normal case for a
repeated query, and passing \`fresh=true\` is how you deliberately pay for a new
one.

Reads that touch only OpenRefs' own storage — collections, projects, the
dashboard rollup, usage reporting, Search Console — cost nothing, carry no
\`ResultMeta\`, and cannot trip the cap.
`.trim();

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

const TAGS: OpenApiTag[] = [
  {
    name: "Auth",
    description: "Registration, sign-in, and the signed-in user's own account.",
  },
  {
    name: "Workspaces",
    description:
      "Workspaces, their members, invites, API keys and DataForSEO credentials.",
  },
  {
    name: "Usage",
    description:
      "What this workspace has spent with DataForSEO, and what is left in the account.",
  },
  {
    name: "Keywords",
    description:
      "Keyword research: overview, ideas, suggestions, related keywords and live SERPs.",
  },
  {
    name: "Domains",
    description:
      "Domain Overview: traffic and keyword profile, history, top pages, competitors and markets.",
  },
  {
    name: "Backlinks",
    description:
      "Link profile: summary, individual links, referring domains, anchors, history and bulk Domain Scores.",
  },
  {
    name: "Gap Analysis",
    description:
      "Keyword and page intersections — what competitors rank for and you do not.",
  },
  {
    name: "Collections",
    description:
      "Saved keyword lists. Pure storage: no DataForSEO call, no cost, no spend cap.",
  },
  {
    name: "History",
    description:
      "The workspace's research trail — every Keyword Research, Domain Overview " +
      "and Gap Analysis search, recorded automatically and re-openable for free.",
  },
  {
    name: "Content Discovery",
    description:
      "Pages winning traffic without much authority — the topics a small site can realistically take.",
  },
  {
    name: "Projects",
    description: "Sites you own. The container for tracking, audits and AI visibility.",
  },
  {
    name: "Rank Tracking",
    description: "Tracked keywords, their positions over time, and on-demand checks.",
  },
  {
    name: "Site Audit",
    description:
      "Crawl-based technical audits. Asynchronous: create, then poll until done.",
  },
  {
    name: "Search Console",
    description:
      "Google Search Console reports for a project, on the user's own OAuth grant. " +
      "**Config-gated:** a deployment without a Google OAuth client cannot serve this " +
      "module, and every route here except `GET /gsc/status` answers 409 " +
      "`gsc_not_configured` when one is absent. Nothing here costs anything — the " +
      "data is Google's, not DataForSEO's — and every report is clamped to the " +
      `newest day Search Console has finalised (roughly ${GSC_DATA_LAG_DAYS} days back), reported as ` +
      "`freshTo`.",
  },
  {
    name: "AI Visibility",
    description:
      "Whether AI assistants mention and cite your site for the prompts your buyers type.",
  },
  {
    name: "Meta",
    description: "Reference lists: the locations and languages every market picker uses.",
  },
  {
    name: "Dashboard",
    description: "The workspace home screen's rollup, in one free call.",
  },
  { name: "Health", description: "Liveness. Public, and touches no binding." },
  {
    name: "Developer",
    description: "This document, and the Model Context Protocol endpoint.",
  },
];

/* -------------------------------------------------------------------------- */
/* components.securitySchemes                                                  */
/* -------------------------------------------------------------------------- */

const SECURITY_SCHEMES: Record<string, SecurityScheme> = {
  apiKey: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "orf_<token>",
    description:
      "A workspace API key, sent as `Authorization: Bearer orf_...`. Minted under " +
      "Settings → API Keys, shown once, stored only as a hash. Bound to one " +
      "workspace and always acting at the `member` role.",
  },
  session: {
    type: "apiKey",
    in: "cookie",
    name: "orf_session",
    description:
      "The browser session cookie, set by register/login and cleared by logout. " +
      "HttpOnly and same-site; a client cannot read it. Required by the operations " +
      "that act on a person rather than a workspace.",
  },
};

/** Either scheme satisfies any operation that does not override this. */
const ROOT_SECURITY: SecurityRequirement[] = [{ apiKey: [] }, { session: [] }];

/** Public: no credentials of any kind. */
const PUBLIC: SecurityRequirement[] = [];

/** Session cookie only — an API key gets 403. */
const SESSION_ONLY: SecurityRequirement[] = [{ session: [] }];

/** API key only, because there is no browser flow for it. */
const API_KEY_ONLY: SecurityRequirement[] = [{ apiKey: [] }];

/* -------------------------------------------------------------------------- */
/* components.parameters                                                       */
/* -------------------------------------------------------------------------- */

const PARAMETERS: Record<string, ParameterObject> = {
  WorkspaceQuery: queryParam(
    "workspace",
    { type: "string", minLength: 1 },
    {
      required: true,
      description:
        "The workspace this call reads, spends and is metered against. Always " +
        "explicit; membership is verified, and both non-membership and a " +
        "nonexistent id answer 403.",
    },
  ),
  LocationQuery: queryParam(
    "location",
    { type: "integer", minimum: 1 },
    {
      required: true,
      description:
        "DataForSEO location code — a number, never a name. UK is 2826, US is 2840. " +
        "`GET /meta/locations` is the list.",
    },
  ),
  LanguageQuery: queryParam(
    "language",
    { type: "string", minLength: 2, maxLength: 8, pattern: "^[A-Za-z-]+$" },
    {
      required: true,
      description:
        "ISO 639-1 language code, occasionally with a region suffix. Must be one " +
        "the chosen location accepts — see `MetaLocationOption.languages`.",
    },
  ),
  LimitQuery: queryParam(
    "limit",
    { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
    {
      description: `Rows per page, 1–${MAX_LIMIT}. Below DataForSEO's own ceiling on purpose: each row is money, so a hand-edited URL cannot turn one click into a much larger bill.`,
    },
  ),
  OffsetQuery: queryParam(
    "offset",
    { type: "integer", minimum: 0, default: 0 },
    { description: "Rows to skip. `offset += limit` is how Load more pages." },
  ),
  FreshQuery: queryParam(
    "fresh",
    { type: "boolean" },
    {
      description:
        "Bypass the cache and buy a new answer. `?fresh`, `?fresh=true` and " +
        "`?fresh=1` all mean true. Costs money every time — omit it unless the " +
        "user asked for a refresh.",
    },
  ),
};

/* -------------------------------------------------------------------------- */
/* components.responses                                                        */
/* -------------------------------------------------------------------------- */

const RESPONSES: Record<string, ResponseObject> = {
  Unauthorized: errorResponse(
    "`unauthorized` — no session cookie and no API key, or the credential " +
      "presented is unknown or expired.",
  ),
  Forbidden: errorResponse(
    "`forbidden` — authenticated, but not allowed. Also the answer for a " +
      "workspace that does not exist, and for an API key attempting an " +
      "admin-or-owner operation.",
  ),
  NotFound: errorResponse(
    "`not_found` — no such resource in this workspace. A resource belonging to " +
      "another tenant answers this rather than 403.",
  ),
  ValidationFailed: errorResponse(
    "`validation_failed` — a parameter or body field is missing, malformed or out " +
      "of range. `details` carries the flattened field errors.",
  ),
  SpendCapExceeded: errorResponse(
    "`spend_cap_exceeded` — this call would take the workspace past its monthly " +
      "DataForSEO spend cap, so it was refused **before** anything was bought. " +
      "A cap of 0 blocks every paid call, which is how a workspace is put in " +
      "read-only mode. Cached reads are always allowed: serving an answer already " +
      "paid for costs nothing, so the cap never hides data you own.",
  ),
  NoCredentials: errorResponse(
    "`no_credentials` — this workspace has no DataForSEO credentials stored " +
      "(`PUT /workspaces/{id}/credentials`), and there is no development fallback " +
      "on this deployment.",
  ),
  RateLimited: errorResponse(
    "`rate_limited` / `too_many_attempts` — too many attempts in the window. " +
      "Where the limit is per-project rather than per-credential, `details.nextAllowedAt` " +
      "is the ISO timestamp at which the next attempt is allowed.",
  ),
  UpstreamError: errorResponse(
    "`upstream_error` — DataForSEO (or, on `/gsc/*`, Google) answered with a " +
      "failure. Their message is forwarded; nothing of ours is echoed back.",
  ),
  UpstreamTimeout: errorResponse(
    "`upstream_timeout` — DataForSEO did not answer inside the client's timeout. " +
      "Where a stale cache entry exists it is served instead, flagged " +
      "`stale: true`; this status means there was none.",
  ),
};

/* -------------------------------------------------------------------------- */
/* components.schemas                                                          */
/* -------------------------------------------------------------------------- */

/*
 * Field names, and which fields are nullable, are copied from src/shared/*.ts.
 * `null` in this API means "the provider did not tell us", never "zero" — that
 * distinction is the reason almost every metric below is nullable, and a client
 * that renders null as 0 is showing a number nobody measured.
 */
const SCHEMAS: Record<string, JsonSchema> = {
  /* ----------------------------- core (api.ts) ---------------------------- */

  ApiError: obj(
    {
      error: obj(
        {
          code: ref("ErrorCode"),
          message: str("Human-readable and safe to show a user."),
          details: {
            description:
              "Present on validation failures: the flattened field errors.",
          },
        },
        { optional: ["details"] },
      ),
    },
    { description: "The body of every non-2xx response." },
  ),

  ErrorCode: enumOf(
    Object.keys(ERROR_STATUS),
    "The canonical error codes. Switch on this, never on `message`.",
  ),

  ResultMeta: obj(
    {
      costUsd: num("USD billed for this response. Always 0 when `cached` is true."),
      cached: bool("True when the answer came from cache rather than the provider."),
      stale: bool(
        "True when the cache entry served had already passed its normal lifetime " +
          "and was returned because refreshing it timed out upstream. `cached` is " +
          "true alongside it. Never set on a `fresh=true` request, which must fail " +
          "rather than return the copy the caller paid to bypass. Absent means false.",
      ),
    },
    {
      optional: ["stale"],
      description:
        "What a DataForSEO-backed answer cost, attached to every such payload.",
    },
  ),

  /* -------------------------------- health -------------------------------- */

  HealthResponse: obj({
    status: literal("ok"),
    version: str("The running OpenRefs version, e.g. `" + APP_VERSION + "`."),
  }),

  /* --------------------------- developer surface -------------------------- */

  OpenApiDocumentBody: {
    type: "object",
    description:
      "An OpenAPI 3.1 document — this one. Left unconstrained rather than " +
      "restating the OpenAPI meta-schema, which is large, versioned separately " +
      "and not ours to pin.",
  },

  JsonRpcRequest: {
    type: "object",
    description:
      "A single JSON-RPC 2.0 request or notification object. Arrays (batches) " +
      "are rejected with `-32600`.",
  },

  JsonRpcResponse: {
    type: "object",
    description: "A single JSON-RPC 2.0 response object.",
  },

  /* --------------------------- auth (auth.ts) ----------------------------- */

  MeWorkspace: obj({
    id: str(),
    name: str(),
    role: ref("WorkspaceRole"),
  }),

  MeResponse: obj(
    {
      user: obj({ id: str(), email: str("Lowercased. Addresses are stored lowercase.") }),
      workspaces: arrayOf(ref("MeWorkspace"), "Every workspace this user belongs to."),
    },
    { description: "The signed-in user and their workspace memberships." },
  ),

  /* ----------------------- workspaces (workspaces.ts) --------------------- */

  WorkspaceRole: enumOf(
    WORKSPACE_ROLES,
    "`owner` can do anything including delete; `admin` manages settings, members " +
      "and keys; `member` reads and spends. API keys always act as `member`.",
  ),

  WorkspaceCredentials: obj(
    {
      configured: bool(),
      login: nullableStr(
        'A masked hint, e.g. `te***@example.com`. Null when nothing is stored.',
      ),
    },
    {
      description:
        "Everything a client is allowed to know about stored DataForSEO " +
        "credentials. There is no variant of this that carries the password, " +
        "encrypted or otherwise — it never leaves the Worker.",
    },
  ),

  Workspace: obj({
    id: str("UUID."),
    name: str(),
    role: ref("WorkspaceRole"),
    spendCapUsd: num("USD per UTC calendar month. 0 blocks every paid call."),
    credentials: ref("WorkspaceCredentials"),
    createdAt: int("Epoch milliseconds."),
  }),

  WorkspaceListResponse: arrayOf(
    ref("Workspace"),
    "Every workspace the caller belongs to.",
  ),

  WorkspaceMember: obj({
    userId: str("UUID."),
    email: str(),
    role: ref("WorkspaceRole"),
    createdAt: int("Epoch milliseconds — when they joined."),
  }),

  WorkspaceMemberListResponse: arrayOf(ref("WorkspaceMember")),

  WorkspaceInvite: obj(
    {
      id: str("UUID."),
      email: str(),
      role: ref("WorkspaceRole"),
      expiresAt: int("Epoch milliseconds."),
      createdAt: int("Epoch milliseconds."),
    },
    { description: "A pending invite. Never carries the token." },
  ),

  WorkspaceInviteListResponse: arrayOf(ref("WorkspaceInvite")),

  CreatedInvite: {
    description:
      "A freshly minted invite. `inviteUrl` embeds the plaintext token and is " +
      "not recoverable afterwards — send it now or mint another.",
    allOf: [ref("WorkspaceInvite"), obj({ inviteUrl: str() })],
  },

  ApiKeySummary: obj({
    id: str("UUID."),
    name: str(),
    createdAt: int("Epoch milliseconds."),
    lastUsedAt: nullableInt(
      "Epoch milliseconds, or null if never used. Written asynchronously, so it " +
        "lags a key's most recent request by a little.",
    ),
  }),

  ApiKeySummaryListResponse: arrayOf(ref("ApiKeySummary")),

  CreatedApiKey: {
    description: "A freshly minted key. `key` is the only time the plaintext exists.",
    allOf: [
      ref("ApiKeySummary"),
      obj({ key: str("The plaintext token, `orf_...`. Shown once.") }),
    ],
  },

  MemberRoleResponse: obj({
    userId: str(),
    role: ref("WorkspaceRole"),
  }),

  WorkspaceDeletedResponse: obj(
    {
      deleted: literal(true),
      purged: obj({
        kvKeys: int("Cache and rate-limit entries removed under this workspace's prefix."),
        r2Objects: int("Audit blobs and AI response bodies removed."),
        googleGrants: obj({
          attempted: int("Search Console refresh tokens found."),
          revoked: int("Of those, the ones Google accepted a revocation for."),
        }),
      }),
    },
    {
      description:
        "Proof of what the cascade actually removed, across D1, KV, R2 and " +
        "Google's token endpoint.",
    },
  ),

  /* ------------------------- usage (api.ts) ------------------------------- */

  EndpointUsage: obj({
    endpoint: str('DataForSEO path, e.g. `keywords_data/google_ads/search_volume/live`.'),
    requests: int(),
    costUsd: num(),
  }),

  UsageResponse: obj({
    periodStart: str("ISO 8601 — the start of the reported month, UTC."),
    totalUsd: num(),
    requestCount: int(),
    cacheHitRate: num("Share of requests served from cache, 0–1. Zero when there were none."),
    byEndpoint: arrayOf(ref("EndpointUsage")),
  }),

  BalanceResponse: obj({
    balanceUsd: num("Money left in the workspace's own DataForSEO account."),
    cached: bool("True when served from the 60-second micro-cache."),
  }),

  /* ------------------------ keywords (keywords.ts) ------------------------ */

  CompetitionLevel: enumOf(
    ["LOW", "MEDIUM", "HIGH"],
    "Google Ads' competition bucket. The 0–1 float is `competition`.",
  ),

  MonthlyVolumePoint: obj({
    year: nullableInt(),
    month: nullableInt(),
    period: nullableStr("`YYYY-MM`, derived. Null when the year/month pair was unusable."),
    searchVolume: nullableInt(),
  }),

  KeywordRow: obj(
    {
      keyword: str(),
      searchVolume: nullableInt(),
      cpc: nullableNum(),
      competition: nullableNum("0–1."),
      competitionLevel: nullableRef("CompetitionLevel"),
      keywordDifficulty: nullableNum("0–100."),
      intent: nullableStr("`informational` | `navigational` | `commercial` | `transactional`, and whatever else the provider adds."),
      depth: nullableInt("`/keywords/related` only: hops from the seed keyword."),
      relatedKeywords: arrayOf(str(), "`/keywords/related` only: sibling keywords."),
    },
    {
      optional: ["depth", "relatedKeywords"],
      description:
        "One row of the keyword tables. Ideas, suggestions and related come back " +
        "from three endpoints with three wire shapes; the Worker flattens all of " +
        "them to this so a single table serves all three.",
    },
  ),

  KeywordOverviewResponse: metered({
    keyword: str(),
    locationCode: int(),
    languageCode: str(),
    searchVolume: nullableInt(),
    cpc: nullableNum(),
    competition: nullableNum("0–1."),
    competitionLevel: nullableRef("CompetitionLevel"),
    lowTopOfPageBid: nullableNum("Low end of the top-of-page bid range, USD."),
    highTopOfPageBid: nullableNum("High end of the top-of-page bid range, USD."),
    keywordDifficulty: nullableNum("0–100."),
    intent: nullableStr(),
    intentProbability: nullableNum(
      "**Always null on this endpoint.** The overview reports intent as a bare " +
        "label; only the separate, separately billed search-intent endpoint " +
        "attaches a confidence figure.",
    ),
    secondaryIntents: arrayOf(
      obj({
        intent: nullableStr(),
        probability: nullableNum("Always null here, for the same reason."),
      }),
      "Supplementary intents. Often empty.",
    ),
    monthlySearches: arrayOf(
      ref("MonthlyVolumePoint"),
      "Up to 12 months, oldest first.",
    ),
  }),

  KeywordListResponse: metered(
    {
      keyword: str("The seed keyword."),
      locationCode: int(),
      languageCode: str(),
      items: arrayOf(ref("KeywordRow")),
      totalCount: nullableInt("How many exist upstream, before this page window."),
      itemsCount: nullableInt("How many this page holds."),
      limit: int(),
      offset: int(),
    },
    {
      description:
        "The paged list shape shared by `/keywords/ideas`, `/keywords/suggestions` " +
        "and `/keywords/related`. Load more stops when " +
        "`offset + items.length >= totalCount`.",
    },
  ),

  SerpRow: obj({
    position: nullableInt("Organic rank."),
    positionAbsolute: nullableInt("Rank counting every SERP element, features included."),
    title: nullableStr(),
    url: nullableStr(),
    domain: nullableStr(),
    description: nullableStr(),
    breadcrumb: nullableStr(),
  }),

  KeywordSerpResponse: metered({
    keyword: nullableStr(),
    locationCode: int(),
    languageCode: str(),
    checkUrl: nullableStr("The Google URL this SERP was read from."),
    fetchedAt: nullableStr("When DataForSEO fetched it."),
    serpFeatures: arrayOf(
      str(),
      "Every feature type on the page (`organic`, `people_also_ask`, " +
        "`ai_overview`, …). Not derived from `items`, which is organic only.",
    ),
    totalResults: nullableInt('Google\'s "about N results".'),
    items: arrayOf(ref("SerpRow"), "Organic results only."),
  }),

  /* ------------------------- domains (domains.ts) ------------------------- */

  PositionBuckets: obj(
    {
      pos1: nullableInt(),
      pos2to3: nullableInt(),
      pos4to10: nullableInt(),
      pos11to20: nullableInt(),
      pos21to30: nullableInt(),
      pos31to40: nullableInt(),
      pos41to50: nullableInt(),
      pos51to60: nullableInt(),
      pos61to70: nullableInt(),
      pos71to80: nullableInt(),
      pos81to90: nullableInt(),
      pos91to100: nullableInt(),
    },
    { description: "Keyword counts by SERP position band." },
  ),

  RankMetrics: obj(
    {
      keywordCount: nullableInt("Ranking keywords."),
      traffic: nullableNum("**Estimated** monthly visits, not measured analytics."),
      trafficValueUsd: nullableNum("USD/month the same traffic would cost as ads."),
      positions: ref("PositionBuckets"),
      isNew: nullableInt(),
      isUp: nullableInt(),
      isDown: nullableInt(),
      isLost: nullableInt(),
    },
    { description: "One side (organic or paid) of a domain's or page's profile." },
  ),

  DomainOverviewResponse: metered({
    domain: str(),
    locationCode: int(),
    languageCode: str(),
    organic: ref("RankMetrics"),
    paid: ref("RankMetrics"),
  }),

  DomainHistoryPoint: obj({
    year: nullableInt(),
    month: nullableInt(),
    period: nullableStr("`YYYY-MM`, derived."),
    organic: ref("RankMetrics"),
    paid: ref("RankMetrics"),
  }),

  DomainHistoryResponse: metered({
    domain: str(),
    locationCode: int(),
    languageCode: str(),
    items: arrayOf(ref("DomainHistoryPoint"), "Monthly, oldest first."),
  }),

  DomainKeywordRow: obj(
    {
      keyword: nullableStr(),
      searchVolume: nullableInt(),
      cpc: nullableNum(),
      competition: nullableNum(),
      competitionLevel: nullableRef("CompetitionLevel"),
      keywordDifficulty: nullableNum(),
      intent: nullableStr(),
      position: nullableInt("The domain's rank for this keyword."),
      positionAbsolute: nullableInt(),
      url: nullableStr("The ranking page."),
      title: nullableStr(),
      serpItemType: nullableStr('`organic` | `paid` | `featured_snippet` | `local_pack` | …'),
      traffic: nullableNum("Estimated monthly visits this one ranking brings."),
    },
    { optional: ["intent"] },
  ),

  DomainKeywordsResponse: metered({
    domain: str(),
    locationCode: int(),
    languageCode: str(),
    paid: bool("Which side was fetched — see the operation's description."),
    items: arrayOf(ref("DomainKeywordRow")),
    totalCount: nullableInt(),
    itemsCount: nullableInt(),
    limit: int(),
    offset: int(),
  }),

  DomainPageRow: obj({
    url: nullableStr("Absolute URL."),
    organic: ref("RankMetrics"),
    paid: ref("RankMetrics"),
  }),

  DomainPagesResponse: metered({
    domain: str(),
    locationCode: int(),
    languageCode: str(),
    items: arrayOf(ref("DomainPageRow")),
    totalCount: nullableInt(),
    itemsCount: nullableInt(),
    limit: int(),
    offset: int(),
  }),

  CompetitorRow: obj(
    {
      domain: nullableStr(),
      commonKeywords: nullableInt("Keywords both domains rank for."),
      avgPosition: nullableNum("Average position over the shared keywords only."),
      organic: ref("RankMetrics"),
      paid: ref("RankMetrics"),
      sharedOrganic: ref("RankMetrics"),
      sharedPaid: ref("RankMetrics"),
    },
    {
      description:
        "**One row mixes two domains' data.** `organic` and `paid` are the " +
        "competitor's own totals — a \"their traffic\" column. `sharedOrganic` and " +
        "`sharedPaid` describe the **target's** performance on the keywords the two " +
        "domains share, which is a different domain's numbers entirely. Labelling " +
        "the shared block as the competitor's is the mistake this shape exists to " +
        "prevent.",
    },
  ),

  DomainCompetitorsResponse: metered({
    domain: str(),
    locationCode: int(),
    languageCode: str(),
    items: arrayOf(ref("CompetitorRow")),
    totalCount: nullableInt(),
    itemsCount: nullableInt(),
    limit: int(),
    offset: int(),
  }),

  DomainCountryRow: obj({
    locationCode: int(),
    countryIsoCode: str(),
    countryName: str(),
    languageCode: str(
      "The language this market was **actually** queried in, which is not " +
        "necessarily the one requested — see the operation's description.",
    ),
    organic: ref("RankMetrics"),
    paid: ref("RankMetrics"),
  }),

  DomainCountriesResponse: metered({
    domain: str(),
    languageCode: str("The language requested. Per-row `languageCode` may differ."),
    items: arrayOf(ref("DomainCountryRow"), "Sorted by organic traffic, highest first."),
    failedCountries: arrayOf(str(), "ISO codes of markets that errored. Usually empty."),
    requestedCount: int("Markets attempted, failures included."),
  }),

  /* ----------------------- backlinks (backlinks.ts) ----------------------- */

  DofollowSplit: obj(
    {
      dofollowPages: nullableInt("Referring pages carrying at least one dofollow link."),
      nofollowPages: nullableInt(),
      dofollowRatio: nullableNum("0–1. Null when it cannot be computed."),
    },
    {
      description:
        "**Derived, not reported.** The provider publishes nofollow counts and " +
        "totals but no dofollow count, so every field here is `total - nofollow` " +
        "and is null when there was not enough to compute it. Null is neither 0% " +
        "nor 100%.",
    },
  ),

  BacklinksSummaryResponse: metered({
    target: nullableStr("Echoed back as the provider resolved it."),
    domainScore: nullableNum("0–100. The headline metric."),
    backlinks: nullableInt(),
    referringDomains: nullableInt(),
    referringMainDomains: nullableInt(
      "Domains counted once regardless of subdomain — always ≤ `referringDomains`.",
    ),
    referringPages: nullableInt(),
    dofollow: ref("DofollowSplit"),
    brokenBacklinks: nullableInt(),
    brokenPages: nullableInt(),
    crawledPages: nullableInt(),
    internalLinksCount: nullableInt(),
    externalLinksCount: nullableInt(),
    referringIps: nullableInt(),
    referringSubnets: nullableInt(),
    spamScore: nullableNum("The provider's own 0–100 spam estimate. Not one of ours."),
    firstSeen: nullableStr("`yyyy-mm-dd hh-mm-ss +00:00`."),
    lostDate: nullableStr(),
    server: nullableStr(),
    countryIsoCode: nullableStr(),
    linkAttributes: nullableMapOf(int(), 'Counts by link attribute, e.g. `{"nofollow": 42}`.'),
    linkTypes: nullableMapOf(int()),
  }),

  BacklinksListMode: enumOf(
    BACKLINKS_LIST_MODES,
    "`one_per_domain` answers \"which domains link to me\" with one example link " +
      "each; `as_is` is every individual link. `groupCount` is only meaningful in " +
      "a grouped mode and comes back 0 under `as_is`.",
  ),

  BacklinkRow: obj({
    domainFrom: nullableStr("The linking domain."),
    urlFrom: nullableStr("The linking page."),
    urlTo: nullableStr("The page on the target being linked to."),
    anchor: nullableStr(),
    dofollow: nullableBool("False means the link is nofollow."),
    isBroken: nullableBool(),
    isNew: nullableBool(),
    isLost: nullableBool(),
    firstSeen: nullableStr(),
    lastSeen: nullableStr(),
    pageScore: nullableNum("0–100 for the linking page."),
    domainScore: nullableNum("0–100 for the linking domain."),
    pageFromTitle: nullableStr(),
    pageFromLanguage: nullableStr(),
    linksCount: nullableInt("Duplicate links from the same page, collapsed into this row."),
    groupCount: nullableInt("Total links from this domain. Grouped modes only."),
    itemType: nullableStr("`anchor` | `image` | `meta` | `canonical` | `alternate` | `redirect`."),
    spamScore: nullableNum("0–100 for this individual link."),
  }),

  BacklinksListResponse: metered({
    target: nullableStr(),
    mode: ref("BacklinksListMode"),
    items: arrayOf(ref("BacklinkRow")),
    totalCount: nullableInt(),
    itemsCount: nullableInt(),
    limit: int(),
    offset: int(),
  }),

  ReferringDomainRow: obj({
    domain: nullableStr(),
    domainScore: nullableNum("0–100."),
    backlinks: nullableInt(),
    referringPages: nullableInt(),
    dofollow: ref("DofollowSplit"),
    brokenBacklinks: nullableInt(),
    firstSeen: nullableStr(),
    lostDate: nullableStr(),
    spamScore: nullableNum(),
  }),

  ReferringDomainsResponse: metered(
    {
      target: nullableStr(),
      items: arrayOf(ref("ReferringDomainRow")),
      totalCount: nullableInt("Counts **main** domains."),
      itemsCount: nullableInt(),
      limit: int(),
      offset: int(),
    },
    {
      description:
        "`totalCount` counts main domains while `items` are domains **including " +
        "subdomains** — the provider's own documented asymmetry. The two " +
        "legitimately disagree, so do not drive paging off their difference alone.",
    },
  ),

  AnchorRow: obj({
    anchor: nullableStr(),
    score: nullableNum("0–100 — the authority the links using this anchor carry."),
    backlinks: nullableInt(),
    referringDomains: nullableInt(),
    referringPages: nullableInt(),
    dofollow: ref("DofollowSplit"),
    brokenBacklinks: nullableInt(),
    firstSeen: nullableStr(),
    lostDate: nullableStr(),
  }),

  AnchorsResponse: metered({
    target: nullableStr(),
    items: arrayOf(ref("AnchorRow")),
    totalCount: nullableInt(),
    itemsCount: nullableInt(),
    limit: int(),
    offset: int(),
  }),

  BacklinksHistoryPoint: obj({
    period: nullableStr("`YYYY-MM`."),
    date: nullableStr("The provider's raw timestamp."),
    domainScore: nullableNum("0–100."),
    backlinks: nullableInt(),
    newBacklinks: nullableInt(),
    lostBacklinks: nullableInt(),
    referringDomains: nullableInt(),
    newReferringDomains: nullableInt(),
    lostReferringDomains: nullableInt(),
    referringMainDomains: nullableInt(),
    referringPages: nullableInt(),
    brokenBacklinks: nullableInt(),
    crawledPages: nullableInt(),
  }),

  BacklinksHistoryResponse: metered(
    {
      target: nullableStr(),
      dateFrom: nullableStr("`yyyy-mm-dd`, as resolved by the provider."),
      dateTo: nullableStr("`yyyy-mm-dd`, after clamping."),
      items: arrayOf(ref("BacklinksHistoryPoint"), "Monthly, oldest first."),
      itemsCount: nullableInt(),
    },
    {
      description:
        "**Months can be missing** from `items` — plot by `period`, never by index.",
    },
  ),

  TargetScore: obj({
    target: nullableStr("Echoed as the provider resolved it. Match by this, never by index."),
    domainScore: nullableNum("0–100."),
  }),

  BacklinksScoresResponse: metered({
    items: arrayOf(ref("TargetScore")),
    itemsCount: nullableInt(),
  }),

  /* ---------------------------- gap (gap.ts) ------------------------------ */

  GapMode: enumOf(
    GAP_MODES,
    GAP_MODES.map((mode) => `\`${mode}\`: ${GAP_MODE_DESCRIPTIONS[mode]}`).join(" "),
  ),

  GapPosition: obj({
    domain: str("Normalised: no scheme, no `www.`. On `/gap/pages` this holds a page URL."),
    position: nullableInt(
      "SERP rank, or **null when the domain does not rank for this keyword at " +
        "all**. Never 0, and never \"unknown\".",
    ),
    url: nullableStr("The ranking page. Null when `position` is."),
    traffic: nullableNum("Estimated monthly visits this ranking brings that domain."),
  }),

  GapKeywordRow: obj({
    keyword: str(),
    searchVolume: nullableInt(),
    cpc: nullableNum(),
    competition: nullableNum(),
    competitionLevel: nullableRef("CompetitionLevel"),
    keywordDifficulty: nullableNum("0–100."),
    intent: nullableStr(),
    target: ref("GapPosition"),
    competitors: arrayOf(
      ref("GapPosition"),
      "One entry per competitor **in the order requested**, so a table can render " +
        "a fixed column each. A competitor that does not rank is still present, " +
        "with a null position.",
    ),
    bestCompetitorTraffic: nullableNum("Null when no competitor ranks."),
  }),

  GapKeywordsResponse: metered({
    target: str('The domain being analysed ("you").'),
    competitors: arrayOf(str(), "Normalised competitor domains, in the order requested."),
    locationCode: int(),
    languageCode: str(),
    mode: ref("GapMode"),
    items: arrayOf(ref("GapKeywordRow")),
    totalCount: nullableInt("See the operation description — this is a maximum, not a sum."),
    itemsCount: nullableInt("Rows on this page **after** the mode filter."),
    filteredOut: int(
      "Rows this page fetched and then dropped because they did not match the " +
        "mode. A large number beside a small `items` means the next page is worth " +
        "loading; it is not an error.",
    ),
    limit: int(),
    offset: int(),
  }),

  GapPageRow: obj({
    keyword: str(),
    searchVolume: nullableInt(),
    cpc: nullableNum(),
    competition: nullableNum(),
    competitionLevel: nullableRef("CompetitionLevel"),
    keywordDifficulty: nullableNum(),
    intent: nullableStr(),
    pages: arrayOf(
      ref("GapPosition"),
      "One entry per compared page, **positional**: index `n` is the `n`th URL in " +
        "the `pages` request parameter. Each entry's `domain` field holds a page " +
        "URL, not a hostname.",
    ),
  }),

  GapPagesResponse: metered({
    pages: arrayOf(str(), "The compared page URLs, in the order requested."),
    locationCode: int(),
    languageCode: str(),
    items: arrayOf(ref("GapPageRow")),
    totalCount: nullableInt(),
    itemsCount: nullableInt(),
    limit: int(),
    offset: int(),
  }),

  /* ------------------------- content (content.ts) ------------------------- */

  ContentSort: enumOf(CONTENT_SORTS, "What the table is ordered by, descending."),

  ContentPageKeyword: obj({
    keyword: str(),
    position: int("Organic rank on that keyword's SERP."),
    volume: nullableInt(),
  }),

  ContentPageRow: obj({
    url: str("Absolute URL, normalised for deduplication."),
    domain: str("Bare host, for the Domain Score join."),
    title: nullableStr("The SERP's title for this page, when one was captured."),
    domainScore: nullableNum("0–100. Null when the provider has never crawled the domain."),
    pageScore: nullableNum(
      "0–100 for this exact URL. Null is common and does not mean zero: the bulk " +
        "ranks index holds far fewer pages than domains.",
    ),
    estTraffic: nullableNum("Estimated monthly organic visits to this page."),
    keywords: arrayOf(ref("ContentPageKeyword"), "Every keyword this page ranked for."),
    totalVolume: int("Summed volume of those keywords."),
    bestPosition: int("Its best position across them."),
    wordCount: nullableInt("**Always null here** — see the operation description."),
  }),

  ContentDiscoverCosts: obj(
    {
      serpUsd: num("The topic's SERP, plus one per expansion keyword."),
      serpCalls: int("How many SERPs that was."),
      expansionUsd: num("The keyword-suggestions lookup that produced the expansion."),
      scoresUsd: num("Bulk ranks — Domain and Page Scores."),
      trafficUsd: num("Bulk traffic estimation — the traffic column."),
      totalUsd: num("The sum, and what `ResultMeta.costUsd` reports."),
    },
    {
      description:
        "A composed answer has no single price, so the parts are itemised. One " +
        "number would be unexplainable: the same query costs nothing on a repeat, " +
        "and the difference between `expand=0` and `expand=10` is ten more SERPs.",
    },
  ),

  ContentDiscoverResponse: metered({
    topic: str(),
    locationCode: int(),
    languageCode: str(),
    expand: int(),
    keywordsSearched: arrayOf(
      str(),
      "The keywords whose SERPs were actually fetched — the topic first, then the " +
        "expansion. Shown so a caller can see what the result is made of.",
    ),
    items: arrayOf(ref("ContentPageRow"), "After filters and sort, windowed by limit/offset."),
    totalCount: int("Unique pages found **before** any filter."),
    itemsCount: int("Rows in `items`."),
    filteredOut: int('Pages the filters removed — the "loosen the cap?" number.'),
    limit: int(),
    offset: int(),
    sort: ref("ContentSort"),
    costs: ref("ContentDiscoverCosts"),
    pageScoresAvailable: bool(
      "Whether page-level scores came back at all. A whole result set can " +
        "legitimately have every `pageScore` null, and saying so lets a client hide " +
        "the column rather than render one that looks broken.",
    ),
  }),

  ContentWordCountRow: obj({
    url: str(),
    wordCount: nullableInt(
      "Words in the article body — headers, footers and comments excluded. Null " +
        "means **could not count** (the page refused the crawler, answered non-2xx, " +
        "or was unparseable), which is distinct from 0.",
    ),
    statusCode: nullableInt("The page's own HTTP status, when it answered."),
  }),

  ContentWordCountResponse: metered({
    items: arrayOf(ref("ContentWordCountRow")),
    counted: int("URLs that produced a count."),
    submitted: int("Distinct URLs in the request, after de-duplication."),
  }),

  /* --------------------- collections (collections.ts) --------------------- */

  CollectionSummary: obj({
    id: str(),
    name: str(),
    keywordCount: int("Computed, not stored."),
    createdAt: str("ISO 8601."),
  }),

  CollectionKeywordRow: obj({
    keyword: str(),
    volumeSnapshot: nullableInt(
      "Search volume at the moment it was saved, so a list stays comparable " +
        "against itself over time. Null when it was added without one.",
    ),
    locationCode: nullableInt(
      "**Null means \"unknown market\", not a default.** The same keyword has a " +
        "different volume in every market, so there is nothing safe to infer.",
    ),
    languageCode: nullableStr("Null for the same reason as `locationCode`."),
    addedAt: str("ISO 8601."),
  }),

  CollectionListResponse: obj({ collections: arrayOf(ref("CollectionSummary")) }),

  CollectionDetailResponse: {
    description: "The collection, plus its keywords, newest first.",
    allOf: [
      ref("CollectionSummary"),
      obj({ keywords: arrayOf(ref("CollectionKeywordRow")) }),
    ],
  },

  CollectionMutationResponse: obj({ collection: ref("CollectionSummary") }),

  CollectionKeywordsAddedResponse: obj({
    added: int("Rows actually inserted."),
    skipped: int("Rows that were already present."),
    submitted: int("Distinct keywords in the request, after trimming and de-duplication."),
    keywordCount: int("The collection's size afterwards."),
  }),

  CollectionKeywordsRemovedResponse: obj({
    removed: int(),
    keywordCount: int(),
  }),

  CollectionDeletedResponse: obj({ deleted: literal(true), id: str() }),

  /* -------------------------- history (history.ts) ------------------------ */

  HistoryModule: enumOf(
    HISTORY_MODULES,
    "Which research module a trail row belongs to.",
  ),

  KeywordHistoryParams: obj({
    keyword: str(),
    location: int("DataForSEO location code."),
    language: str(),
  }),

  DomainHistoryParams: obj({
    target: str("Normalised hostname, as the module's URL state stores it."),
    location: int(),
    language: str(),
  }),

  GapHistoryParams: obj(
    {
      target: str(),
      competitors: arrayOf(
        str(),
        "Normalised competitor hostnames, in column order.",
      ),
      location: int(),
      language: str(),
    },
    {
      description:
        "The comparison's inputs. `mode` is **absent on purpose**: it selects a " +
        "view over rows the query already covers, so switching modes is not a " +
        "new search and does not create a second row.",
    },
  ),

  KeywordHistorySummary: obj({
    volume: nullableInt("Monthly search volume."),
    difficulty: nullableNum("0–100."),
    cpc: nullableNum(),
    intent: nullableStr(),
  }),

  DomainHistorySummary: obj({
    domainScore: nullableNum(
      "0–100. Always null from this endpoint: Domain Score is a link-graph " +
        "metric and the overview is a traffic query, so filling it in would " +
        "mean buying a second call per trail row.",
    ),
    organicTraffic: nullableNum(),
    organicKeywords: nullableInt(),
  }),

  GapHistorySummary: obj({
    keywordCount: nullableInt("Rows the comparison found, before mode filtering."),
    competitorCount: int(),
  }),

  HistoryEntry: obj(
    {
      id: str(),
      module: ref("HistoryModule"),
      params: {
        description:
          "Exactly what re-runs this search. The shape follows `module`: " +
          "`KeywordHistoryParams`, `DomainHistoryParams` or `GapHistoryParams`.",
        anyOf: [
          ref("KeywordHistoryParams"),
          ref("DomainHistoryParams"),
          ref("GapHistoryParams"),
        ],
      },
      summary: {
        description:
          "The headline metrics captured when the search last returned some — " +
          "what makes the list scannable without re-running anything. Null " +
          "until a search returns metrics; a later run that returns none does " +
          "not erase one already captured. Shape follows `module`.",
        anyOf: [
          ref("KeywordHistorySummary"),
          ref("DomainHistorySummary"),
          ref("GapHistorySummary"),
          { type: "null" },
        ],
      },
      hitCount: int("Times this exact search has been run or reopened here."),
      firstSearchedAt: str("ISO 8601."),
      lastSearchedAt: str("ISO 8601."),
    },
    {
      description:
        "One remembered search. Re-running one updates this row rather than " +
        "adding another, so the trail is what the workspace does, not a log.",
    },
  ),

  HistoryListResponse: obj({
    items: arrayOf(ref("HistoryEntry"), "Newest first."),
    total: int("Rows stored for this module, which can exceed `items.length`."),
  }),

  HistoryDeletedResponse: obj({ deleted: int("Rows removed.") }),

  /* ------------------------ projects (projects.ts) ------------------------ */

  Device: enumOf(DEVICES),

  Project: obj({
    id: str(),
    name: str(),
    domain: str("Bare hostname, normalised: no scheme, no `www.`, no path."),
    locationCode: int("Default market for anything tracked under this project."),
    languageCode: str(),
    createdAt: str("ISO 8601."),
    keywordCount: int("Tracked keywords. Computed, not stored."),
    lastCheckedAt: nullableStr(
      "ISO 8601 of the newest rank snapshot across the project's keywords. " +
        "Snapshot time, not job time, so it only moves when real data lands.",
    ),
  }),

  ProjectListResponse: obj({ projects: arrayOf(ref("Project"), "Newest first.") }),

  ProjectMutationResponse: obj({ project: ref("Project") }),

  ProjectDeletedResponse: obj({ deleted: literal(true), id: str() }),

  /* ------------------------ tracking (tracking.ts) ------------------------ */

  RankPoint: obj(
    {
      date: str("`YYYY-MM-DD`, UTC."),
      position: nullableInt('Null means "checked, and not in the top 100".'),
    },
    {
      description:
        "One observation. Sparse by design: only days actually checked appear, so " +
        "a sparkline must tolerate gaps rather than assume a point per day.",
    },
  ),

  RankSnapshot: {
    description: "The newest observation, with the detail only the latest row carries.",
    allOf: [
      ref("RankPoint"),
      obj({
        url: nullableStr("The ranking URL. Null when the domain did not rank."),
        serpFeatures: arrayOf(str(), 'e.g. `["organic", "people_also_ask"]`.'),
      }),
    ],
  },

  TrackedKeywordRow: obj({
    id: str("The tracked-keyword id. This, not the keyword text, is what deletes take."),
    keyword: str(),
    device: ref("Device"),
    locationCode: int(),
    languageCode: str(),
    createdAt: str("ISO 8601."),
    latest: nullableRef(
      "RankSnapshot",
      "Null when this keyword has **never been checked** — a different state from " +
        "`latest.position === null`, which means checked and not in the top 100.",
    ),
    previous: nullableRef("RankPoint", "The observation before `latest`, however long ago."),
    change1d: nullableNum("**Positive means the ranking improved.** Position counts downward."),
    change7d: nullableNum(),
    change30d: nullableNum(),
    bestPosition: nullableInt("Best position ever recorded. Null if never ranked."),
    aiOverview: bool(
      "Google showed an AI Overview for this keyword at the last check. False also " +
        "means never checked — disambiguate with `latest`.",
    ),
    series: arrayOf(ref("RankPoint"), "Oldest first, last 30 days. Sparse."),
  }),

  TrackedKeywordsResponse: obj({
    projectId: str(),
    domain: str("The project's domain, so ranking URLs can be rendered relative to it."),
    keywords: arrayOf(ref("TrackedKeywordRow")),
    lastCheckedAt: nullableStr("Newest snapshot across the whole project. ISO 8601."),
    checkInProgress: bool("True while a rank check for this project is queued or running."),
  }),

  TrackedKeywordsAddedResponse: obj({
    added: int(),
    skipped: int("Already tracked under the same market and device."),
    submitted: int("Distinct keywords after trimming and de-duplication."),
    keywordCount: int(),
    checkEnqueued: bool(
      "True when a rank check was enqueued for the new keywords. False when " +
        "everything was a duplicate and there was nothing to check.",
    ),
  }),

  TrackedKeywordsRemovedResponse: obj({ removed: int(), keywordCount: int() }),

  RankCheckEnqueuedResponse: obj({
    enqueued: literal(true),
    keywordCount: int("Keywords the check covers."),
    estimatedCostUsd: num("A hint, not a bill — see the operation description."),
    nextAllowedAt: str("ISO 8601 — when another check becomes allowed for this project."),
  }),

  /* -------------------------- audits (audits.ts) -------------------------- */

  AuditCategory: enumOf(
    AUDIT_CATEGORIES,
    "The fixed issue categories, in display order. `other` is last and is not " +
      "decorative: an upstream check we have not explicitly mapped lands there " +
      "rather than vanishing from an audit that claims to be complete.",
  ),

  AuditSeverity: enumOf(
    AUDIT_SEVERITIES,
    "`error` breaks indexing or serving, `warning` measurably hurts, `notice` is " +
      "worth knowing.",
  ),

  AuditStatus: enumOf(AUDIT_STATUSES),

  AuditCheckCount: obj({
    check: str("The provider's own check key, e.g. `title_too_long`."),
    label: str("Human-readable label from our mapping table."),
    severity: ref("AuditSeverity"),
    pages: int("Pages failing this check."),
  }),

  AuditCategoryResult: obj({
    category: ref("AuditCategory"),
    label: str(),
    description: str("One line explaining what this category covers."),
    severity: ref("AuditSeverity"),
    affectedPages: int(
      "Distinct pages affected by at least one check in this category. **Not the " +
        "sum of `checks[].pages`** — one page failing three checks counts once " +
        "here and three times there.",
    ),
    checks: arrayOf(ref("AuditCheckCount"), "Highest count first. Empty when nothing fired."),
  }),

  AuditLighthouse: obj(
    {
      url: str("The URL actually measured."),
      mobile: bool("Whether the run emulated a mobile device."),
      performance: nullableNum("0–100."),
      accessibility: nullableNum("0–100."),
      bestPractices: nullableNum("0–100."),
      seo: nullableNum("0–100."),
      lcpMs: nullableNum("Largest Contentful Paint, milliseconds."),
      cls: nullableNum("Cumulative Layout Shift — unitless, already the real value."),
      inpMs: nullableNum(
        "Interaction to Next Paint, milliseconds. Often null: INP needs field " +
          "data, and a lab run reports `tbtMs` instead.",
      ),
      fcpMs: nullableNum("First Contentful Paint, milliseconds."),
      tbtMs: nullableNum("Total Blocking Time, milliseconds. The lab proxy for INP."),
      speedIndexMs: nullableNum(),
    },
    {
      description:
        "Lighthouse for the **homepage only** — per-page Lighthouse is priced per " +
        "run, so auditing every page would cost more than the crawl.",
    },
  ),

  AuditSummary: obj({
    score: nullableNum("OnPage score, 0–100. Null until the crawl finishes."),
    pagesCrawled: int(),
    pagesLimit: int("The requested ceiling."),
    renderJs: bool(),
    domain: str(),
    categories: arrayOf(
      ref("AuditCategoryResult"),
      "**Always all of them**, in category order, whether or not each has issues. " +
        "That is what makes two summaries directly subtractable for a " +
        '"+3 / −7 vs previous" chip with no extra request.',
    ),
    pagesWithIssues: int("Distinct pages with at least one issue of any category."),
    totalIssues: int('Total failing (check, page) pairs — the "issues found" headline.'),
    lighthouse: nullableRef("AuditLighthouse"),
    lighthouseNote: nullableStr("Why `lighthouse` is null, when it is."),
    brokenLinks: int(),
    brokenResources: int(),
    nonIndexablePages: int(),
    duplicateTitlePages: int(),
    duplicateDescriptionPages: int(),
    duplicateContentPages: int(),
    ingestedAt: nullableStr("ISO 8601. Null while still crawling."),
  }),

  AuditListItem: obj(
    {
      id: str(),
      projectId: str(),
      status: ref("AuditStatus"),
      createdAt: str("ISO 8601."),
      score: nullableNum("Null until the crawl finishes."),
      pagesCrawled: int(),
      pagesLimit: int(),
      renderJs: bool(),
      error: nullableStr("Present on a failed audit — the upstream reason, ready to display."),
      errorCode: nullableStr(
        "The machine-readable half of `error`, currently `spend_cap_exceeded` or " +
          "`no_credentials`. A crawl is bought **after** creation was already " +
          "answered with a 202, so a refusal cannot arrive as an HTTP status — it " +
          "arrives here instead. Absent means \"no code\", not \"no error\".",
      ),
    },
    { optional: ["errorCode"] },
  ),

  AuditListResponse: obj({
    projectId: str(),
    domain: str(),
    audits: arrayOf(ref("AuditListItem")),
    auditInProgress: bool("True while an audit for this project is queued or crawling."),
  }),

  AuditProgress: obj({
    state: str("The provider's `crawl_progress`, e.g. `in_progress` | `finished`."),
    pagesCrawled: int(),
    pagesInQueue: int(),
    pagesLimit: int(),
  }),

  AuditComparison: obj(
    {
      auditId: str(),
      createdAt: str("ISO 8601."),
      score: nullableNum(),
      categoryCounts: mapOf(int(), "Affected-page count per category id."),
    },
    { description: 'Enough of the previous audit to render "vs previous" chips.' },
  ),

  AuditDetailResponse: obj({
    id: str(),
    projectId: str(),
    domain: str(),
    status: ref("AuditStatus"),
    createdAt: str("ISO 8601."),
    summary: nullableRef(
      "AuditSummary",
      "Null while `status` is `pending`. An empty rollup would render as a site " +
        "with a score of zero and no issues, which is the opposite of the truth.",
    ),
    error: nullableStr(),
    progress: nullableRef(
      "AuditProgress",
      'So a client can show "48 of 250 pages" rather than a spinner. Null before ' +
        "the first poll.",
    ),
    previous: nullableRef("AuditComparison"),
  }),

  AuditCreatedResponse: obj({
    audit: ref("AuditListItem"),
    taskId: nullableStr("Exposed for support. **Always null on creation** — see the description."),
    estimatedCostUsd: num("A ceiling, not a price — see the description."),
    costPerPageUsd: num("The per-page price the estimate used."),
    pagesLimit: int("Pages the estimate assumed."),
    renderJs: bool("True when JS rendering inflated the estimate."),
  }),

  AuditIssuePage: obj({
    url: str(),
    statusCode: nullableInt("HTTP status the crawler saw."),
    checks: arrayOf(str(), "Which of this category's checks this page fails."),
    details: mapOf(
      { type: ["string", "number", "null"] },
      "The specific failing values, where the section data carries them — current " +
        "title and its length, redirect target, response time. Keys are stable per " +
        "category; render whatever is present.",
    ),
  }),

  AuditIssuesResponse: obj({
    auditId: str(),
    category: ref("AuditCategory"),
    label: str(),
    severity: ref("AuditSeverity"),
    page: int("1-based."),
    pageSize: int(`Always ${AUDIT_ISSUES_PAGE_SIZE}.`),
    total: int("Total affected pages across every page of this drill-down."),
    pages: arrayOf(ref("AuditIssuePage")),
  }),

  AuditDeletedResponse: obj({
    deleted: literal(true),
    id: str(),
    blobsDeleted: int("R2 objects removed with the row. Proof the blobs went too."),
  }),

  /* ---------------------------- gsc (gsc.ts) ------------------------------ */

  GscStatusResponse: obj(
    {
      configured: bool("This deployment has a Google OAuth client (both id and secret)."),
      connected: bool("This project has a stored refresh token."),
      property: nullableStr("The chosen Search Console property, or null if none picked."),
      broken: bool(
        "Google refused the stored refresh token the last time we used it. The " +
          "connection exists but is dead; only reconnecting fixes it.",
      ),
    },
    {
      description:
        "Four client states fall out of this one call: `configured: false` → " +
        "self-host setup card; `connected: false` → connect CTA; `broken: true` → " +
        "reconnect CTA; `property: null` → property picker; otherwise, the reports.",
    },
  ),

  GscSite: obj({
    siteUrl: str("e.g. `sc-domain:example.com` or `https://example.com/`."),
    permissionLevel: str(
      "Google's own enum: `siteOwner`, `siteFullUser`, `siteRestrictedUser`, " +
        "`siteUnverifiedUser`.",
    ),
  }),

  GscSitesResponse: obj({
    sites: arrayOf(ref("GscSite")),
    property: nullableStr("Currently selected, so a picker can show what is chosen."),
  }),

  GscConnectionResponse: obj({ connected: bool(), property: nullableStr() }),

  GscDisconnectedResponse: obj({
    disconnected: literal(true),
    revoked: bool(
      "Whether Google accepted the token revocation. `false` means our row is gone " +
        "and the token is unusable by us, but Google may still list the grant until " +
        "the user removes it — said plainly rather than implying more than happened.",
    ),
  }),

  GscMetrics: obj({
    clicks: int(),
    impressions: int(),
    ctr: num("Fraction, 0–1, exactly as Google returns it."),
    position: num("Average position, 1-based. Lower is better."),
  }),

  GscDailyPoint: {
    allOf: [ref("GscMetrics"), obj({ date: str("`YYYY-MM-DD`.") })],
  },

  GscReportBase: obj(
    {
      from: str("Inclusive start, `YYYY-MM-DD`."),
      to: str("Inclusive end, `YYYY-MM-DD`. Never later than `freshTo`."),
      freshTo: str(
        `The most recent day Search Console has finalised — roughly ${GSC_DATA_LAG_DAYS} days back. ` +
          "Present on every report so a client can say what the numbers are current " +
          "to without re-deriving the lag rule. This is the slot other modules use " +
          "for a cost chip; Search Console costs nothing.",
      ),
      property: str("The property these numbers describe."),
      cached: bool("Served from the 24h cache rather than a fresh Google call."),
    },
    { description: "The fields every Search Console report carries." },
  ),

  GscOverviewResponse: {
    allOf: [
      ref("GscReportBase"),
      obj({ totals: ref("GscMetrics"), daily: arrayOf(ref("GscDailyPoint")) }),
    ],
  },

  GscQueryRow: { allOf: [ref("GscMetrics"), obj({ query: str() })] },

  GscPageRow: { allOf: [ref("GscMetrics"), obj({ page: str() })] },

  GscPagedReport: {
    description: "A window over the fetched set — the paging is ours, not Google's.",
    allOf: [
      ref("GscReportBase"),
      obj({
        total: int("Rows available in the fetched set, before `limit`/`offset`."),
        limit: int(),
        offset: int(),
      }),
    ],
  },

  GscQueriesResponse: {
    allOf: [ref("GscPagedReport"), obj({ rows: arrayOf(ref("GscQueryRow")) })],
  },

  GscPagesResponse: {
    allOf: [ref("GscPagedReport"), obj({ rows: arrayOf(ref("GscPageRow")) })],
  },

  GscOpportunityRule: enumOf(GSC_OPPORTUNITY_RULES),

  GscOpportunityBase: {
    allOf: [
      ref("GscMetrics"),
      obj({
        rule: ref("GscOpportunityRule"),
        query: str(),
        page: nullableStr(
          "The page earning the most clicks for this query — the thing to go and " +
            "edit. Null when the query+page breakdown has no row for it: Search " +
            "Console anonymises rare queries, so the two pulls do not always agree.",
        ),
      }),
    ],
  },

  GscStrikingDistanceOpportunity: {
    description:
      "Position 5–20 with above-median impressions: real demand, just off page one.",
    allOf: [ref("GscOpportunityBase"), obj({ rule: literal("striking_distance") })],
  },

  GscLowCtrOpportunity: {
    description:
      "Ranking well but under-clicked — a title/description problem, not a ranking one.",
    allOf: [
      ref("GscOpportunityBase"),
      obj({
        rule: literal("low_ctr"),
        expectedCtr: num("What the curve says a query at this position should earn."),
        ctrRatio: num("`ctr / expectedCtr`. Below 0.5 by construction."),
      }),
    ],
  },

  GscCannibalizedPage: {
    allOf: [
      ref("GscMetrics"),
      obj({
        page: str(),
        shareOfClicks: num("This page's share of the query's clicks, 0–1."),
      }),
    ],
  },

  GscCannibalizationOpportunity: {
    description: "Two or more pages each taking a meaningful share of one query's clicks.",
    allOf: [
      ref("GscOpportunityBase"),
      obj({
        rule: literal("cannibalization"),
        pages: arrayOf(
          ref("GscCannibalizedPage"),
          "Every page over the share threshold, most clicks first. At least two.",
        ),
      }),
    ],
  },

  GscOpportunityThresholds: obj(
    {
      strikingDistance: obj({
        minPosition: num(),
        maxPosition: num(),
        minImpressions: num("The median impressions of the fetched query set."),
      }),
      lowCtr: obj({
        maxPosition: num(),
        ratio: num("CTR must be below this fraction of the expected curve."),
      }),
      cannibalization: obj({
        minShareOfClicks: num(),
        minPages: num(),
      }),
    },
    {
      description:
        "The numbers the rules actually ran with, returned rather than duplicated " +
        "client-side so the explanation under each table cannot drift from the " +
        "computation.",
    },
  ),

  GscOpportunitiesResponse: {
    allOf: [
      ref("GscReportBase"),
      obj({
        strikingDistance: opportunityList("GscStrikingDistanceOpportunity"),
        lowCtr: opportunityList("GscLowCtrOpportunity"),
        cannibalization: opportunityList("GscCannibalizationOpportunity"),
        thresholds: ref("GscOpportunityThresholds"),
      }),
    ],
  },

  /* ----------------------------- ai (ai.ts) ------------------------------- */

  AiEngineId: enumOf(
    AI_ENGINE_IDS,
    "The provider's own path segments, verbatim — an engine id is also the URL " +
      "fragment it maps to.",
  ),

  AiEngineStatus: obj({
    engine: ref("AiEngineId"),
    lastRunDate: nullableStr("`YYYY-MM-DD` of the newest run, or null if it never ran."),
    mentioned: nullableBool(),
    cited: nullableBool(),
    citationCount: int(),
  }),

  AiPrompt: obj({
    id: str(),
    prompt: str(),
    engines: arrayOf(ref("AiEngineId")),
    createdAt: str("ISO 8601."),
    lastRunAt: nullableStr("Newest run across every engine. ISO 8601."),
    statuses: arrayOf(
      ref("AiEngineStatus"),
      "One entry per engine on the prompt, in the prompt's own engine order.",
    ),
  }),

  AiPromptListResponse: obj({
    projectId: str(),
    domain: str(),
    prompts: arrayOf(ref("AiPrompt")),
    runInProgress: bool("True while a run for this project is queued or running."),
  }),

  AiPromptMutationResponse: obj({
    prompt: ref("AiPrompt"),
    runEnqueued: bool("True when creating the prompt also enqueued its first run."),
  }),

  AiPromptDeletedResponse: obj({ deleted: literal(true), id: str() }),

  AiCitation: obj({
    url: str("Exactly as the provider gave it."),
    title: nullableStr("The source's title or domain."),
    host: nullableStr("Parsed host, `www.` stripped. Null when the URL was not usable."),
    ours: bool("True when this citation points at the project's own site."),
  }),

  AiSnapshot: obj(
    {
      id: str(),
      promptId: str(),
      engine: ref("AiEngineId"),
      date: str("`YYYY-MM-DD`, UTC."),
      mentioned: bool(),
      cited: bool(),
      citations: arrayOf(ref("AiCitation")),
      citedUrls: arrayOf(str(), "Just the ones pointing at us."),
      model: nullableStr("The resolved model that answered, e.g. `gpt-4o-mini-2024-07-18`."),
      costUsd: num("What this single answer actually cost. **Not** an estimate."),
      createdAt: str("ISO 8601."),
    },
    {
      description:
        "One prompt × engine × day. There is at most one per triple: a second run " +
        "on the same day replaces the first, so a day cannot get double weight in " +
        "the mention rate.",
    },
  ),

  AiSnapshotDetail: {
    description: "A snapshot plus the answer text — the drill-down payload.",
    allOf: [
      ref("AiSnapshot"),
      obj({
        responseExcerpt: str(
          "Up to 2000 characters of the answer, centred on the mention when there " +
            "was one. The full response is in object storage.",
        ),
        mentionTerms: arrayOf(
          str(),
          "Substrings to highlight, lowercased. Search case-insensitively rather " +
            "than trusting an offset — the excerpt is a window onto the answer.",
        ),
      }),
    ],
  },

  AiRatePoint: obj({
    date: str("`YYYY-MM-DD`."),
    runs: int("Prompt runs recorded for this engine that day."),
    mentions: int("Runs whose answer mentioned the project."),
    citations: int("Runs that cited the project."),
    mentionRate: nullableNum("`mentions / runs`, 0–1. Null when nothing ran that day."),
    citationRate: nullableNum("`citations / runs`, 0–1. Null when nothing ran that day."),
  }),

  AiEngineTimeline: obj({
    engine: ref("AiEngineId"),
    points: arrayOf(ref("AiRatePoint")),
    mentionRate: nullableNum("Over the whole window. Null when the engine has no runs in it."),
    citationRate: nullableNum(),
  }),

  AiResultsResponse: obj({
    projectId: str(),
    domain: str(),
    from: str("`YYYY-MM-DD`."),
    to: str("`YYYY-MM-DD`."),
    timelines: arrayOf(ref("AiEngineTimeline"), "One per engine with any run in the window."),
    latest: arrayOf(
      ref("AiSnapshotDetail"),
      "The newest run per prompt × engine, with excerpt and citations.",
    ),
    prompts: arrayOf(
      obj({ id: str(), prompt: str(), engines: arrayOf(ref("AiEngineId")) }),
      "Prompt text by id, so a table can label rows without a second call.",
    ),
  }),

  AiRunEnqueuedResponse: obj({
    enqueued: literal(true),
    promptCount: int("Prompts this run covers."),
    callCount: int("Prompt × engine pairs, i.e. how many LLM calls will be made."),
    estimatedCostUsd: num("An estimate — see the operation description."),
    nextAllowedAt: str("ISO 8601 — when another run becomes allowed for this project."),
  }),

  /* ---------------------- meta (keywords.ts) ------------------------------ */

  MetaLocationOption: obj({
    code: int("Pass this as `location` on every other endpoint."),
    name: nullableStr(),
    countryIsoCode: nullableStr("ISO 3166-1 alpha-2, e.g. `GB`."),
    languages: arrayOf(
      obj({ code: str(), name: nullableStr() }),
      "Languages valid for **this** location. Pairing a language from outside this " +
        "list with this location is an upstream error, so a language picker should " +
        "be driven by the chosen location rather than by the global list.",
    ),
  }),

  MetaLocationsResponse: metered({ locations: arrayOf(ref("MetaLocationOption")) }),

  MetaLanguageOption: obj({
    code: str("ISO 639-1, e.g. `en`. Pass as `language`."),
    name: nullableStr(),
  }),

  MetaLanguagesResponse: metered({ languages: arrayOf(ref("MetaLanguageOption")) }),

  /* --------------------- dashboard (dashboard.ts) ------------------------- */

  DashboardRollup: obj(
    {
      trackedKeywords: int("Across every project in the workspace."),
      avgPosition: nullableNum(
        "Mean latest position across tracked keywords that currently rank, to one " +
          "decimal. Keywords never checked, and keywords checked but outside the " +
          "top 100, are both **excluded** rather than counted as 100 — inventing a " +
          "position would drag the average toward a number nobody measured. " +
          "**Null, not 0, when nothing ranks.**",
      ),
      top10Count: int("Tracked keywords whose latest position is 1–10. A count, so 0 is honest."),
      collections: int("Keyword collections in the workspace."),
      monthSpendUsd: num(
        "DataForSEO spend for the current UTC calendar month — the same window and " +
          "the same sum the spend cap enforces, so this and the cap's own " +
          "accounting can never disagree.",
      ),
      latestAuditScore: nullableNum(
        "OnPage score of the most recent completed audit in the workspace, across " +
          "all projects. Null when no audit has finished yet.",
      ),
    },
    { description: "Six figures, all read from tables OpenRefs already owns." },
  ),
};

/* -------------------------------------------------------------------------- */
/* paths                                                                       */
/* -------------------------------------------------------------------------- */

/** `?workspace` + `?project` — the pair every Search Console route takes. */
function gscParams(): Parameter[] {
  return [
    parameterRef("WorkspaceQuery"),
    queryParam(
      "project",
      { type: "string", minLength: 1 },
      {
        required: true,
        description: "The project whose Search Console connection this call uses.",
      },
    ),
  ];
}

/** `/{id}` + `?workspace` — the pair every project-scoped route takes. */
function projectScoped(...extra: Parameter[]): Parameter[] {
  return [
    pathParam("id", "Project id."),
    parameterRef("WorkspaceQuery"),
    ...extra,
  ];
}

/*
 * Keys carry no `/api/v1` prefix — `servers[0].url` has it. Grouped by module,
 * in the order src/worker/routes/index.ts mounts them, so a reader comparing
 * the two files reads down both at the same time.
 */
const PATHS: Record<string, PathItem> = {
  /* -------------------------------- health -------------------------------- */

  "/health": {
    get: {
      operationId: "getHealth",
      summary: "Liveness probe.",
      description:
        "Deliberately touches no database, cache or object store: this is what " +
        "uptime checks and the deploy smoke test hit, so it must not cost anything " +
        "or fail because a binding is cold.",
      tags: ["Health"],
      security: PUBLIC,
      responses: { "200": jsonResponse("HealthResponse", "The service is up.") },
    },
  },

  /* ------------------------------ developer ------------------------------- */

  "/openapi.json": {
    get: {
      operationId: "getOpenApiDocument",
      summary: "This OpenAPI 3.1 document.",
      description:
        "Public, because it documents how to authenticate. Served with " +
        "`cache-control: public, max-age=3600` — the document only changes when the " +
        "Worker is redeployed, so an hour of browser and edge caching costs nothing " +
        "in freshness.",
      tags: ["Developer"],
      security: PUBLIC,
      responses: {
        "200": jsonResponse("OpenApiDocumentBody", "The API description."),
      },
    },
  },

  "/mcp": {
    post: {
      operationId: "postMcp",
      summary: "JSON-RPC 2.0 endpoint for MCP clients.",
      description:
        "A stateless **Streamable HTTP** Model Context Protocol server, hand-rolled " +
        "rather than taken from an SDK: every SDK that speaks this transport wants a " +
        "server object it can keep alive between messages, which on Workers means a " +
        "Durable Object, and OpenRefs runs without those.\n\n" +
        "Protocol revision **2026-07-28**, with backward compatibility for the " +
        "`initialize`-based revisions **2025-11-25** and **2025-06-18**. The era is " +
        "chosen per request from the message itself: an `initialize` request always " +
        "selects legacy, anything carrying a modern protocol version in `params._meta` " +
        "(or a matching `MCP-Protocol-Version` header) is served modern, and anything " +
        "else is served legacy-leniently — a handshaked legacy client sends a bare " +
        "`tools/list`, and nothing in a stateless request distinguishes that from a " +
        "malformed modern one.\n\n" +
        "Authenticated with the same `orf_` bearer API key as the rest of this API, " +
        "which is also how the endpoint knows which workspace to spend against.\n\n" +
        "Also mounted at a bare **`/mcp`**, outside the `/api/v1` prefix, for clients " +
        "that expect an endpoint at the site root. The two are the same handler.\n\n" +
        "**One JSON-RPC message per POST.** No batching (an array gets `-32600`; both " +
        "implemented revisions forbid it), no SSE, no sessions — `Mcp-Session-Id` and " +
        "`Last-Event-ID` are ignored, exactly as the revision instructs a " +
        "non-session server to do.",
      tags: ["Developer"],
      security: API_KEY_ONLY,
      requestBody: jsonBody(
        ref("JsonRpcRequest"),
        "A single JSON-RPC request or notification.",
      ),
      responses: {
        "200": jsonResponse("JsonRpcResponse", "The JSON-RPC response."),
        "202": noContent(
          "The message was a notification, which has no response by definition.",
        ),
        "400": {
          description:
            "Malformed JSON, a JSON-RPC batch, or headers that contradict the body. " +
            "Returned as a JSON-RPC error response (`-32700` / `-32600`), not the " +
            "OpenRefs error envelope.",
          content: { "application/json": { schema: ref("JsonRpcResponse") } },
        },
        ...errors("Unauthorized", "NotFound"),
      },
    },
  },

  /* --------------------------------- auth --------------------------------- */

  "/auth/register": {
    post: {
      operationId: "register",
      summary: "Create an account.",
      description:
        "Creates a default workspace named \"My workspace\" with the new user as " +
        "owner, and sets the session cookie — a fresh account is immediately usable.",
      tags: ["Auth"],
      security: PUBLIC,
      requestBody: jsonBody(
        obj({
          email: {
            type: "string",
            format: "email",
            maxLength: 254,
            description: "Lowercased before storage, so `Ada@x.com` and `ada@x.com` are one account.",
          },
          password: { type: "string", minLength: 10, maxLength: 200 },
        }),
      ),
      responses: {
        "201": jsonResponse("MeResponse", "The new user and their default workspace."),
        "409": errorResponse("`email_taken` — that address is already registered."),
        ...errors("ValidationFailed"),
      },
    },
  },

  "/auth/login": {
    post: {
      operationId: "login",
      summary: "Sign in and set the session cookie.",
      description:
        "**An unknown email and a wrong password both answer 401 `invalid_credentials`.** " +
        "That is deliberate and not a diagnostic gap: distinguishing them would turn " +
        "this endpoint into an account-enumeration oracle, letting anyone test whether " +
        "an address has an OpenRefs account. If you are debugging a failed sign-in, the " +
        "code cannot tell you which half was wrong, and will not be changed to.\n\n" +
        `Failures are throttled to ${LOGIN_MAX_ATTEMPTS} per ${LOGIN_WINDOW_SECONDS / 60} minutes **per email address**, after ` +
        "which the address answers 429 `too_many_attempts` until the window ages out; " +
        "a successful sign-in clears the counter. The counter is keyed by a hash of " +
        "the address, never the address itself.",
      tags: ["Auth"],
      security: PUBLIC,
      requestBody: jsonBody(
        obj({
          email: { type: "string", format: "email", maxLength: 254 },
          password: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description:
              "Deliberately not held to the registration minimum: an account created " +
              "under older rules must stay able to sign in when the rules tighten.",
          },
        }),
      ),
      responses: {
        "200": jsonResponse("MeResponse", "Signed in. The `orf_session` cookie is set."),
        ...errors("Unauthorized", "ValidationFailed", "RateLimited"),
      },
    },
  },

  "/auth/logout": {
    post: {
      operationId: "logout",
      summary: "Clear the session cookie.",
      description:
        "Unconditional and public: it succeeds with no session, an expired one, or " +
        "one belonging to a deleted user, because the only useful outcome of asking " +
        "to be signed out is being signed out.",
      tags: ["Auth"],
      security: PUBLIC,
      responses: { "204": noContent("Signed out. The cookie is cleared.") },
    },
  },

  "/auth/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user and their workspaces.",
      description:
        "Session cookie only — an API key answers 403, because a key identifies a " +
        "workspace and this operation is about a person.",
      tags: ["Auth"],
      security: SESSION_ONLY,
      responses: {
        "200": jsonResponse("MeResponse", "The signed-in user."),
        ...errors("Unauthorized", "Forbidden"),
      },
    },
    delete: {
      operationId: "deleteMe",
      summary: "Delete the signed-in user's account.",
      description:
        "**Irreversible, and wider than it looks:** it deletes every workspace the " +
        "user solely owns, and everything in them — projects, tracked keywords, " +
        "collections, audits and their blobs. Workspaces with another owner survive " +
        "and simply lose a member.\n\n" +
        "Note that this `DELETE` **requires a request body** carrying the current " +
        "password. Some HTTP clients drop bodies on `DELETE` by default; if the " +
        "endpoint answers 422 for a request you believe carries a password, that is " +
        "usually why.",
      tags: ["Auth"],
      security: SESSION_ONLY,
      requestBody: jsonBody(
        obj({ password: { type: "string", minLength: 1, maxLength: 200 } }),
        "The current password, re-entered as confirmation.",
      ),
      responses: {
        "204": noContent("Account deleted. The session cookie is cleared."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  /* ------------------------------ workspaces ------------------------------ */

  "/workspaces/invites/accept": {
    post: {
      operationId: "acceptWorkspaceInvite",
      summary: "Redeem an invite token and join a workspace.",
      description:
        "**Unknown, expired and already-redeemed tokens all answer 410 `invite_invalid`.** " +
        "One code for three causes is the point: a token is a bearer credential, and " +
        "telling a holder which of the three applies leaks whether a token ever " +
        "existed and whether someone else has already used it.\n\n" +
        "A caller who is already a member of the workspace succeeds and **keeps their " +
        "existing role** — accepting a `member` invite never demotes an owner. The " +
        "invite is consumed either way, so the response is the workspace as the caller " +
        "now sees it, not necessarily at the role the invite named.\n\n" +
        "Session cookie only: joining is something a person does.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      requestBody: jsonBody(
        obj({ token: { type: "string", minLength: 1, maxLength: 200 } }),
        "The token from the invite URL.",
      ),
      responses: {
        "200": jsonResponse("Workspace", "The workspace, at the caller's effective role."),
        "410": errorResponse(
          "`invite_invalid` — unknown, expired, or already redeemed. Deliberately " +
            "one code for all three.",
        ),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces": {
    get: {
      operationId: "listWorkspaces",
      summary: "Workspaces the caller belongs to.",
      description:
        "An API key sees exactly one element — its own workspace — with `role` " +
        "reported as `member` regardless of who created the key.",
      tags: ["Workspaces"],
      responses: {
        "200": jsonResponse("WorkspaceListResponse", "The caller's workspaces."),
        ...errors("Unauthorized"),
      },
    },
    post: {
      operationId: "createWorkspace",
      summary: "Create a workspace. The creator becomes its owner.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      requestBody: jsonBody(
        obj({ name: { type: "string", minLength: 1, maxLength: 80 } }),
      ),
      responses: {
        "201": jsonResponse("Workspace", "The new workspace."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}": {
    get: {
      operationId: "getWorkspace",
      summary: "One workspace.",
      tags: ["Workspaces"],
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      responses: {
        "200": jsonResponse("Workspace", "The workspace."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    patch: {
      operationId: "updateWorkspace",
      summary: "Rename a workspace or change its spend cap. Requires `admin`.",
      description:
        "At least one field must be present. **A `spendCapUsd` of 0 blocks every " +
        "paid DataForSEO call** in the workspace — that is how a workspace is put " +
        "into read-only mode, and cached reads keep working.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      requestBody: jsonBody(
        obj(
          {
            name: { type: "string", minLength: 1, maxLength: 80 },
            spendCapUsd: {
              type: "number",
              minimum: 0,
              maximum: 1000000,
              description: "USD per UTC calendar month.",
            },
          },
          { optional: ["name", "spendCapUsd"] },
        ),
      ),
      responses: {
        "200": jsonResponse("Workspace", "The updated workspace."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "deleteWorkspace",
      summary: "Delete a workspace and everything in it. Requires `owner`.",
      description:
        "**Irreversible.** A cascade across every store: the D1 rows, the cache and " +
        "rate-limit keys under the workspace's prefix, the audit and AI blobs in " +
        "object storage, and a revocation request to Google for each stored Search " +
        "Console grant. The response reports what each of those actually removed.\n\n" +
        "`confirmName` must equal the workspace's current name exactly — a typed " +
        "confirmation rather than a checkbox, because there is nothing to undo with.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      requestBody: jsonBody(
        obj({ confirmName: { type: "string", minLength: 1, maxLength: 80 } }),
        "Must equal the workspace's current name.",
      ),
      responses: {
        "200": jsonResponse("WorkspaceDeletedResponse", "Deleted, with a purge report."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/credentials": {
    put: {
      operationId: "setWorkspaceCredentials",
      summary: "Store this workspace's DataForSEO credentials. Requires `admin`.",
      description:
        "Encrypted at rest and **never readable back** — the response says only " +
        "whether credentials are configured, plus a masked hint of the login. There " +
        "is no operation that returns the password.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      requestBody: jsonBody(
        obj({
          login: { type: "string", minLength: 1, maxLength: 254 },
          password: { type: "string", minLength: 1, maxLength: 512 },
        }),
      ),
      responses: {
        "200": jsonResponse("WorkspaceCredentials", "Stored."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "deleteWorkspaceCredentials",
      summary: "Forget this workspace's DataForSEO credentials. Requires `admin`.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      responses: {
        "200": jsonResponse(
          "WorkspaceCredentials",
          "Removed — `{ configured: false, login: null }`.",
        ),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/members": {
    get: {
      operationId: "listWorkspaceMembers",
      summary: "Members of a workspace.",
      tags: ["Workspaces"],
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      responses: {
        "200": jsonResponse("WorkspaceMemberListResponse", "The members."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/members/{userId}": {
    patch: {
      operationId: "updateWorkspaceMemberRole",
      summary: "Change a member's role. Requires `owner`.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [
        pathParam("id", "Workspace id.", "uuid"),
        pathParam("userId", "The member's user id.", "uuid"),
      ],
      requestBody: jsonBody(obj({ role: ref("WorkspaceRole") })),
      responses: {
        "200": jsonResponse("MemberRoleResponse", "The member's new role."),
        "409": errorResponse(
          "`conflict` — this would demote the last owner, leaving the workspace " +
            "with nobody who can delete it or manage owners.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "removeWorkspaceMember",
      summary: "Remove a member. `member` may remove themselves; anyone else needs `admin`.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [
        pathParam("id", "Workspace id.", "uuid"),
        pathParam("userId", "The member's user id.", "uuid"),
      ],
      responses: {
        "204": noContent("Removed."),
        "409": errorResponse("`conflict` — this would remove the last owner."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/invites": {
    post: {
      operationId: "createWorkspaceInvite",
      summary: "Invite an email address to the workspace. Requires `admin`.",
      description:
        "An `admin` cannot mint an `owner` invite (403) — no role may hand out more " +
        "than it holds.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      requestBody: jsonBody(
        obj(
          {
            email: { type: "string", format: "email", maxLength: 254 },
            role: {
              $ref: "#/components/schemas/WorkspaceRole",
              default: "member",
            },
          },
          { optional: ["role"] },
        ),
      ),
      responses: {
        "201": jsonResponse(
          "CreatedInvite",
          "The invite, including the one-time `inviteUrl`.",
        ),
        "409": errorResponse("`conflict` — that address is already a member."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    get: {
      operationId: "listWorkspaceInvites",
      summary: "Pending invites. Requires `admin`.",
      description: "Never includes the token — it exists only in the response that minted it.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      responses: {
        "200": jsonResponse("WorkspaceInviteListResponse", "The pending invites."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/invites/{inviteId}": {
    delete: {
      operationId: "revokeWorkspaceInvite",
      summary: "Revoke a pending invite. Requires `admin`.",
      description: "Idempotent: revoking an invite that is already gone still answers 204.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [
        pathParam("id", "Workspace id.", "uuid"),
        pathParam("inviteId", "Invite id.", "uuid"),
      ],
      responses: {
        "204": noContent("Revoked, or already absent."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/api-keys": {
    post: {
      operationId: "createWorkspaceApiKey",
      summary: "Mint an API key for this workspace. Requires `admin`.",
      description:
        "**The plaintext `key` is returned exactly once, here.** Only a hash is " +
        "stored, so there is no operation — for any role, including `owner` — that " +
        "can show it again. A lost key is replaced, not recovered.\n\n" +
        "The key acts at the `member` role for this workspace only, whatever the role " +
        "of the admin who created it.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      requestBody: jsonBody(
        obj({ name: { type: "string", minLength: 1, maxLength: 80 } }),
        "A label, so a key can be identified and revoked later.",
      ),
      responses: {
        "201": jsonResponse("CreatedApiKey", "The key. Copy `key` now."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    get: {
      operationId: "listWorkspaceApiKeys",
      summary: "API keys for this workspace, without their secrets. Requires `admin`.",
      description:
        "`lastUsedAt` is written asynchronously and lags a key's most recent request " +
        "— read it as \"recently used\", not as an audit log.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [pathParam("id", "Workspace id.", "uuid")],
      responses: {
        "200": jsonResponse("ApiKeySummaryListResponse", "The keys."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/workspaces/{id}/api-keys/{keyId}": {
    delete: {
      operationId: "revokeWorkspaceApiKey",
      summary: "Revoke an API key. Requires `admin`.",
      description: "Idempotent: revoking a key that is already gone still answers 204.",
      tags: ["Workspaces"],
      security: SESSION_ONLY,
      parameters: [
        pathParam("id", "Workspace id.", "uuid"),
        pathParam("keyId", "API key id.", "uuid"),
      ],
      responses: {
        "204": noContent("Revoked, or already absent."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  /* --------------------------------- usage -------------------------------- */

  "/usage": {
    get: {
      operationId: "getUsage",
      summary: "This workspace's DataForSEO spend for the current UTC month.",
      description:
        "Costs nothing: it is rolled up from OpenRefs' own metering table, not from " +
        "DataForSEO. Same window and same sum the spend cap enforces.",
      tags: ["Usage"],
      parameters: [parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("UsageResponse", "The month's spend, by endpoint."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/usage/balance": {
    get: {
      operationId: "getBalance",
      summary: "Money left in this workspace's DataForSEO account.",
      description:
        "The one deliberate exception to \"balance is never cached\": a 60-second " +
        "micro-cache, so a page with five components asking at once costs one call.",
      tags: ["Usage"],
      parameters: [parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("BalanceResponse", "The account balance."),
        ...errors(
          "Unauthorized",
          "Forbidden",
          "NoCredentials",
          "ValidationFailed",
          "UpstreamError",
          "UpstreamTimeout",
        ),
      },
    },
  },

  /* ------------------------------- keywords -------------------------------- */

  "/keywords/overview": {
    get: {
      operationId: "getKeywordOverview",
      summary: "Every headline metric for one keyword, in one billed call.",
      description:
        "`intentProbability`, and the `probability` on each `secondaryIntents` entry, " +
        "are **structurally always null here** — the overview endpoint reports intent " +
        "as bare labels, and only the separate (separately billed) search-intent " +
        "endpoint attaches a confidence figure. Do not wait for values that are never " +
        "coming.",
      tags: ["Keywords"],
      parameters: [
        ...marketParams(),
        queryParam("keyword", { type: "string", minLength: 1, maxLength: 700 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
      ],
      responses: {
        "200": jsonResponse("KeywordOverviewResponse", "The keyword's metrics."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/keywords/ideas": {
    get: {
      operationId: "getKeywordIdeas",
      summary: "Keywords in the same topic space as a seed keyword.",
      tags: ["Keywords"],
      parameters: [
        ...marketParams(),
        queryParam("keyword", { type: "string", minLength: 1, maxLength: 700 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        ...filterParams(),
      ],
      responses: {
        "200": jsonResponse("KeywordListResponse", "A page of keyword rows."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/keywords/suggestions": {
    get: {
      operationId: "getKeywordSuggestions",
      summary: "Longer search terms containing the seed keyword.",
      tags: ["Keywords"],
      parameters: [
        ...marketParams(),
        queryParam("keyword", { type: "string", minLength: 1, maxLength: 700 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        ...filterParams(),
      ],
      responses: {
        "200": jsonResponse("KeywordListResponse", "A page of keyword rows."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/keywords/related": {
    get: {
      operationId: "getRelatedKeywords",
      summary: "Google's \"searches related to\" graph around a seed keyword.",
      description:
        "Rows additionally carry `depth` and `relatedKeywords`, which the other two " +
        "list endpoints leave absent — this one returns a graph rather than a list.",
      tags: ["Keywords"],
      parameters: [
        ...marketParams(),
        queryParam("keyword", { type: "string", minLength: 1, maxLength: 700 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        ...filterParams(),
        queryParam("depth", { type: "integer", minimum: 0 }, {
          description:
            "Hops to expand from the seed. Each level multiplies the row count, so " +
            "it is capped well below anything that would return a graph nobody reads.",
        }),
      ],
      responses: {
        "200": jsonResponse("KeywordListResponse", "A page of keyword rows."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/keywords/serp": {
    get: {
      operationId: "getKeywordSerp",
      summary: "A live Google SERP for one keyword.",
      tags: ["Keywords"],
      parameters: [
        ...marketParams(),
        queryParam("keyword", { type: "string", minLength: 1, maxLength: 700 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        queryParam("device", enumOf(["desktop", "mobile"]), {
          description: "Which device's results to read.",
        }),
      ],
      responses: {
        "200": jsonResponse("KeywordSerpResponse", "The SERP."),
        ...dataForSeoErrors(),
      },
    },
  },

  /* -------------------------------- domains -------------------------------- */

  "/domains/overview": {
    get: {
      operationId: "getDomainOverview",
      summary: "A domain's organic and paid profile in one market.",
      tags: ["Domains"],
      parameters: [
        ...marketParams(),
        queryParam("domain", { type: "string", minLength: 1 }, {
          required: true,
          description:
            "Normalised to a bare hostname: scheme, `www.` and path are stripped, " +
            "because a path turns this into a far narrower page-level query.",
        }),
        parameterRef("FreshQuery"),
      ],
      responses: {
        "200": jsonResponse("DomainOverviewResponse", "The domain's metrics."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/domains/history": {
    get: {
      operationId: "getDomainHistory",
      summary: "A domain's traffic and keyword profile, month by month.",
      description:
        "Items are oldest-first. **The window parameters here are `dateFrom` and " +
        "`dateTo`**, not the `from` / `to` that `/backlinks/history` uses — the two " +
        "endpoints wrap different upstream families and each keeps its own family's " +
        "spelling rather than pretending to a uniformity that does not exist.",
      tags: ["Domains"],
      parameters: [
        ...marketParams(),
        queryParam("domain", { type: "string", minLength: 1 }, { required: true }),
        parameterRef("FreshQuery"),
        isoDateParam("dateFrom", "Inclusive start, `yyyy-mm-dd`."),
        isoDateParam("dateTo", "Inclusive end, `yyyy-mm-dd`."),
      ],
      responses: {
        "200": jsonResponse("DomainHistoryResponse", "Monthly history, oldest first."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/domains/keywords": {
    get: {
      operationId: "getDomainKeywords",
      summary: "The keywords a domain ranks for.",
      description:
        "**`paid=true` does not filter a shared result set — it changes what is " +
        "fetched.** The flag maps onto the upstream `item_types` request field, and " +
        "DataForSEO refuses to sort or filter by a result type that was not asked " +
        "for. So organic and paid are genuinely separate queries with separate cache " +
        "entries and separate bills: toggling the switch costs a call the first time " +
        "each way, and `totalCount` on one side says nothing about the other.\n\n" +
        "It is not a view over one download. Treat `paid` as part of the query key.",
      tags: ["Domains"],
      parameters: [
        ...marketParams(),
        queryParam("domain", { type: "string", minLength: 1 }, { required: true }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        ...filterParams(),
        queryParam("paid", { type: "boolean" }, {
          description: "Fetch the paid (ads) side instead of the organic one.",
        }),
        queryParam("minPosition", { type: "integer", minimum: 1 }, {
          description: "Keep rows ranking at or better than this position.",
        }),
        queryParam("maxPosition", { type: "integer", minimum: 1 }, {
          description: "Keep rows ranking at or worse than this position.",
        }),
      ],
      responses: {
        "200": jsonResponse("DomainKeywordsResponse", "A page of ranking keywords."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/domains/pages": {
    get: {
      operationId: "getDomainPages",
      summary: "A domain's pages, ranked by the traffic they earn.",
      tags: ["Domains"],
      parameters: [
        ...marketParams(),
        queryParam("domain", { type: "string", minLength: 1 }, { required: true }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
      ],
      responses: {
        "200": jsonResponse("DomainPagesResponse", "A page of top pages."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/domains/competitors": {
    get: {
      operationId: "getDomainCompetitors",
      summary: "Domains competing for the same keywords.",
      description:
        "Each row mixes two domains' numbers: `organic` and `paid` are the " +
        "competitor's own totals, while `sharedOrganic` and `sharedPaid` are the " +
        "**target's** performance on the keywords the two share. See `CompetitorRow`.",
      tags: ["Domains"],
      parameters: [
        ...marketParams(),
        queryParam("domain", { type: "string", minLength: 1 }, { required: true }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
      ],
      responses: {
        "200": jsonResponse("DomainCompetitorsResponse", "A page of competitors."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/domains/countries": {
    get: {
      operationId: "getDomainCountries",
      summary: "A domain's profile across roughly ten major markets.",
      description:
        "**The expensive one, and the only domains route with no `location` " +
        "parameter** — it fetches every market itself, at about ten upstream calls " +
        "per request. Put it behind a deliberate action with a cost hint, not on page " +
        "load.\n\n" +
        "Markets are fetched concurrently and independently, and **a market that " +
        "errors is omitted from `items` and named in `failedCountries` rather than " +
        "failing the request** — a partial breakdown is more useful than none. " +
        "`costUsd` therefore covers only the calls that succeeded, and `requestedCount` " +
        "says how many were attempted.\n\n" +
        "**Per-row `languageCode` may differ from the language you asked for.** A " +
        "DataForSEO location accepts only its own languages — Germany is `de`, France " +
        "is `fr` — so asking for all ten markets in `en` would fail most of them. Each " +
        "market falls back to its primary language and the row says which was used, " +
        "which is worth surfacing wherever it differs from the requested one.",
      tags: ["Domains"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        parameterRef("LanguageQuery"),
        queryParam("domain", { type: "string", minLength: 1 }, { required: true }),
        parameterRef("FreshQuery"),
      ],
      responses: {
        "200": jsonResponse(
          "DomainCountriesResponse",
          "The markets that answered, plus the ones that did not.",
        ),
        ...dataForSeoErrors(),
      },
    },
  },

  /* ------------------------------- backlinks ------------------------------- */

  "/backlinks/summary": {
    get: {
      operationId: "getBacklinksSummary",
      summary: "A target's link profile in one row of headline numbers.",
      description:
        "Nothing in this module takes a `location` or `language`: a link profile is " +
        "not per-market.",
      tags: ["Backlinks"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("target", { type: "string", minLength: 1, maxLength: 2048 }, {
          required: true,
          description: "A domain, a subdomain, or an absolute page URL.",
        }),
        parameterRef("FreshQuery"),
      ],
      responses: {
        "200": jsonResponse("BacklinksSummaryResponse", "The link profile summary."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/backlinks/list": {
    get: {
      operationId: "getBacklinksList",
      summary: "Individual backlinks pointing at a target.",
      description:
        "Every filter here is applied **upstream**, in the provider's own query — so " +
        "a filtered page costs one billed call rather than pulling a thousand rows to " +
        "narrow them locally.",
      tags: ["Backlinks"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("target", { type: "string", minLength: 1, maxLength: 2048 }, {
          required: true,
          description: "A domain, a subdomain, or an absolute page URL.",
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        queryParam(
          "mode",
          { $ref: "#/components/schemas/BacklinksListMode", default: "one_per_domain" },
          { description: "How rows are grouped." },
        ),
        queryParam("dofollow", { type: "boolean" }, {
          description: "Keep only dofollow links (or, when false, only nofollow).",
        }),
        queryParam("anchor", { type: "string", minLength: 1 }, {
          description: "Keep rows whose anchor text contains this substring.",
        }),
        queryParam("minDomainScore", { type: "number", minimum: 0, maximum: 100 }, {
          description: "Keep rows whose linking domain scores at least this.",
        }),
      ],
      responses: {
        "200": jsonResponse("BacklinksListResponse", "A page of backlinks."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/backlinks/referring-domains": {
    get: {
      operationId: "getReferringDomains",
      summary: "Domains linking to a target, one row each.",
      description:
        "`totalCount` counts **main** domains while `items` are domains including " +
        "subdomains, so the two legitimately disagree — see `ReferringDomainsResponse`.",
      tags: ["Backlinks"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("target", { type: "string", minLength: 1, maxLength: 2048 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        queryParam("include", { type: "string", minLength: 1 }, {
          description: "Keep rows whose domain contains this substring.",
        }),
        queryParam("minDomainScore", { type: "number", minimum: 0, maximum: 100 }, {
          description: "Keep rows scoring at least this.",
        }),
      ],
      responses: {
        "200": jsonResponse("ReferringDomainsResponse", "A page of referring domains."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/backlinks/anchors": {
    get: {
      operationId: "getBacklinksAnchors",
      summary: "Anchor texts pointing at a target, with the authority behind each.",
      description:
        "Same parameters as `/backlinks/referring-domains`, with one difference that " +
        "is easy to miss: **`include` filters the anchor text here, not the domain.**",
      tags: ["Backlinks"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("target", { type: "string", minLength: 1, maxLength: 2048 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        queryParam("include", { type: "string", minLength: 1 }, {
          description: "Keep rows whose **anchor text** contains this substring.",
        }),
        queryParam("minDomainScore", { type: "number", minimum: 0, maximum: 100 }, {
          description: "Keep rows scoring at least this.",
        }),
      ],
      responses: {
        "200": jsonResponse("AnchorsResponse", "A page of anchors."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/backlinks/history": {
    get: {
      operationId: "getBacklinksHistory",
      summary: "A target's link profile, month by month.",
      description:
        `**\`from\` earlier than ${BACKLINKS_HISTORY_MIN_DATE} is rejected before anything is spent.** ` +
        "The provider's link history begins there, and an earlier date buys an empty " +
        "answer at full price — so it is a 422 from us rather than a paid " +
        "disappointment.\n\n" +
        "**`to` is silently clamped to yesterday UTC**, rather than rejected. Passing " +
        "today fails upstream *after* being billed, which is the worst of both " +
        "outcomes; clamping costs the caller at most a day of history they could not " +
        "have had anyway. The clamped value comes back as `dateTo`, so a client can " +
        "always see the window actually served.\n\n" +
        "One more thing the chart should know: **the four `new*` / `lost*` delta " +
        "series are 0 rather than null before 2021-05.** The provider has no change " +
        "data that far back, and there \"no change\" is indistinguishable from " +
        "\"no data\".",
      tags: ["Backlinks"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("target", { type: "string", minLength: 1, maxLength: 2048 }, {
          required: true,
        }),
        parameterRef("FreshQuery"),
        isoDateParam(
          "from",
          `Inclusive start, \`yyyy-mm-dd\`. Not before ${BACKLINKS_HISTORY_MIN_DATE}.`,
        ),
        isoDateParam("to", "Inclusive end, `yyyy-mm-dd`. Clamped to yesterday UTC."),
      ],
      responses: {
        "200": jsonResponse("BacklinksHistoryResponse", "Monthly history, oldest first."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/backlinks/scores": {
    post: {
      operationId: "postBacklinksScores",
      summary: "Domain Scores for many targets in one call.",
      description:
        "**`workspace` is a body field here, not a query parameter — the only route " +
        "in this API where that is true.** It is a POST with a list body, so the " +
        "workspace travels with the rest of the input rather than being the one field " +
        "that has to be spelled differently.\n\n" +
        "**The provider does not preserve input order** (it returns URL targets before " +
        "bare domains), so results must be matched back by the `target` string in each " +
        "row. Matching by index will silently attribute the wrong score to the wrong " +
        "target.",
      tags: ["Backlinks"],
      requestBody: jsonBody(
        obj(
          {
            workspace: str("The workspace to authorise, spend and meter against."),
            targets: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 2048 },
              minItems: 1,
              maxItems: BACKLINKS_SCORES_MAX_TARGETS,
              description: `Domains, subdomains or absolute URLs. At most ${BACKLINKS_SCORES_MAX_TARGETS} per call — our ceiling, not the provider's, chosen to keep one request's cost predictable.`,
            },
            fresh: bool("Bypass the cache and buy a new answer."),
          },
          { optional: ["fresh"] },
        ),
      ),
      responses: {
        "200": jsonResponse("BacklinksScoresResponse", "One row per target that resolved."),
        ...dataForSeoErrors(),
      },
    },
  },

  /* ------------------------------ gap analysis ----------------------------- */

  "/gap/keywords": {
    get: {
      operationId: "getGapKeywords",
      summary: "Keywords competitors rank for and you do not.",
      description:
        "**This is the most expensive read in the API, and the cost is in the " +
        "`competitors` parameter, not the page size.** The provider's intersection " +
        "endpoint compares exactly two domains per call, so the Worker runs one " +
        `pairwise call per competitor and merges them — up to ${GAP_MAX_COMPETITORS} calls, or ${GAP_MAX_COMPETITORS * 2} when ` +
        "`mode=all`, which needs two per competitor. Adding a competitor adds a bill.\n\n" +
        "**`mode` is free.** It filters rows that were already fetched and paid for, " +
        "so switching between modes costs nothing and buys nothing — it only changes " +
        "how many of a given page's rows survive.\n\n" +
        "Two consequences for paging, both of which look like bugs and are not:\n\n" +
        "- **`totalCount` is the maximum of the per-competitor totals, not a count of " +
        "the merged set.** There is no upstream number for \"rows across N pairwise " +
        "queries\", and summing them would double-count every keyword more than one " +
        "competitor ranks for.\n" +
        "- **`limit` and `offset` apply per pairwise call**, so a page is the union of " +
        "N windows rather than a window over one list. A page can therefore return " +
        "more rows than `limit`, and `filteredOut` tells you how many the mode " +
        "dropped.\n\n" +
        "**What the modes mean.** `missing` and `untapped` are easy to conflate and " +
        "are genuinely different: `missing` is *you do not rank and **every** " +
        "competitor does* — the strong signal, because the whole peer set has it " +
        "covered. `untapped` is *you do not rank and **at least one** competitor does* " +
        "— strictly broader, so **every `missing` keyword is also `untapped`**. " +
        "`weak` is the opposite case, where you rank but at least one competitor ranks " +
        "higher, and `all` applies no filter.\n\n" +
        "A competitor `position` of `null` means **that domain does not rank for this " +
        "keyword**. It is never 0 and never \"unknown\"; render it as a dash.",
      tags: ["Gap Analysis"],
      parameters: [
        ...marketParams(),
        queryParam("target", { type: "string", minLength: 1 }, {
          required: true,
          description: "The domain being analysed — \"you\".",
        }),
        queryParam("competitors", { type: "string", minLength: 1 }, {
          required: true,
          description: `Comma-separated hostnames, 1 to ${GAP_MAX_COMPETITORS}. Each one is another upstream call.`,
        }),
        queryParam(
          "mode",
          { $ref: "#/components/schemas/GapMode", default: "missing" },
          { description: "Filters rows already fetched. Free to change." },
        ),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        ...filterParams(),
      ],
      responses: {
        "200": jsonResponse("GapKeywordsResponse", "A page of gap rows."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/gap/keywords/export.csv": {
    get: {
      operationId: "exportGapKeywordsCsv",
      summary: "The same gap analysis as a CSV download.",
      description:
        "**`limit` is accepted and validated, and then ignored.** The export always " +
        "pulls up to 1000 rows, because a spreadsheet of the fifty rows that happened " +
        "to be on screen is not what anyone means by \"export\". The parameter is " +
        "still validated rather than dropped so that a caller reusing the query string " +
        "from `/gap/keywords` gets the same 422 for a bad value instead of a silent " +
        "difference in behaviour between the two endpoints.\n\n" +
        "Every other parameter behaves exactly as it does on `/gap/keywords`, " +
        "including the per-competitor billing.",
      tags: ["Gap Analysis"],
      parameters: [
        ...marketParams(),
        queryParam("target", { type: "string", minLength: 1 }, { required: true }),
        queryParam("competitors", { type: "string", minLength: 1 }, {
          required: true,
          description: `Comma-separated hostnames, 1 to ${GAP_MAX_COMPETITORS}.`,
        }),
        queryParam("mode", { $ref: "#/components/schemas/GapMode", default: "missing" }),
        parameterRef("FreshQuery"),
        queryParam(
          "limit",
          { type: "integer", minimum: 1, maximum: MAX_LIMIT },
          { description: "**Validated and ignored.** The export always pulls up to 1000 rows." },
        ),
        parameterRef("OffsetQuery"),
        ...filterParams(),
      ],
      responses: {
        "200": csvResponse("The gap rows as CSV."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/gap/pages": {
    get: {
      operationId: "getGapPages",
      summary: "Keywords a set of pages rank for together.",
      description:
        "Compares **URLs**, not domains, and so has no \"you\" and no mode filter — " +
        "every page is just one of the compared set.\n\n" +
        "`items[].pages[]` is **positional**: index `n` is the `n`th URL in the " +
        "`pages` parameter, and each entry's `domain` field holds a page URL rather " +
        "than a hostname. That field name is inherited from the shared position shape; " +
        "do not parse it as a host.",
      tags: ["Gap Analysis"],
      parameters: [
        ...marketParams(),
        queryParam("pages", { type: "string", minLength: 1 }, {
          required: true,
          description: `Comma-separated absolute URLs, 1 to ${GAP_MAX_PAGES}. Wildcards (\`/*\`) are passed through.`,
        }),
        queryParam("excludePages", { type: "string" }, {
          description: "Comma-separated URLs to exclude from the intersection.",
        }),
        queryParam("intersectionMode", enumOf(["union", "intersect"]), {
          description:
            "How the compared pages are combined. No default: omitted means the " +
            "upstream default applies.",
        }),
        parameterRef("FreshQuery"),
        ...pagingParams(),
        ...filterParams(),
      ],
      responses: {
        "200": jsonResponse("GapPagesResponse", "A page of shared keywords."),
        ...dataForSeoErrors(),
      },
    },
  },

  /* --------------------------- content discovery --------------------------- */

  "/content/discover": {
    get: {
      operationId: "getContentDiscover",
      summary: "Pages winning traffic without much authority, for one topic.",
      description:
        "**The cost model here is the opposite of every other module's.** Elsewhere, " +
        "changing a filter or a sort order means a new upstream query and a new bill. " +
        "Here the composed, deduplicated, **pre-filter** result set is what gets " +
        "cached — so every filter, every sort and every page after the first is " +
        "applied worker-side and is **free**. Explore freely; only the topic, the " +
        "market and `expand` decide what you pay.\n\n" +
        "**The two caps treat missing data in opposite directions, on purpose.** " +
        "`maxDomainScore` **keeps** rows whose `domainScore` is null — unknown " +
        "authority is not high authority, and dropping them would hide exactly the " +
        "small sites this endpoint exists to surface. `minTraffic` **drops** rows " +
        "whose `estTraffic` is null — a traffic floor is an assertion about a number, " +
        "and a row with no number cannot satisfy it. Neither is a bug, and inverting " +
        "either would be.\n\n" +
        "**`fresh=true` skips the cache read but still writes**, so a deliberate " +
        "refresh replaces the cached composition for everyone rather than leaving a " +
        "stale copy behind the fresh one.\n\n" +
        "**`items[].wordCount` is always null here.** Counting words costs money per " +
        "URL, so it is a separate `POST /content/wordcount` for the rows a user picked " +
        "rather than a charge on every row of a sweep.",
      tags: ["Content Discovery"],
      parameters: [
        ...marketParams(),
        queryParam("topic", { type: "string", minLength: 1, maxLength: 700 }, {
          required: true,
        }),
        queryParam(
          "expand",
          numberEnum(CONTENT_EXPAND_OPTIONS, "How many related keywords to expand into."),
          {
            description:
              "Each expansion keyword is another SERP, and another slice of the bill. " +
              "A fixed set rather than a free number, because an arbitrary value here " +
              "would be an arbitrary price. Defaults to 0.",
          },
        ),
        parameterRef("FreshQuery"),
        queryParam("maxDomainScore", { type: "number", minimum: 0, maximum: 100 }, {
          description:
            "Keep pages at or below this Domain Score. **Rows with an unknown " +
            "(null) score are kept.**",
        }),
        queryParam("minTraffic", { type: "number", minimum: 0 }, {
          description:
            "Keep pages with at least this estimated monthly traffic. **Rows with " +
            "unknown (null) traffic are dropped.**",
        }),
        queryParam("include", { type: "string", minLength: 1 }, {
          description: "Keep rows matching this substring.",
        }),
        queryParam("exclude", { type: "string", minLength: 1 }, {
          description: "Drop rows matching this substring.",
        }),
        queryParam(
          "sort",
          { $ref: "#/components/schemas/ContentSort", default: "estTraffic" },
          { description: "Free to change — applied worker-side." },
        ),
        queryParam(
          "limit",
          {
            type: "integer",
            minimum: 1,
            maximum: CONTENT_MAX_ROWS,
            default: CONTENT_DEFAULT_ROWS,
          },
          { description: `Rows per page, 1–${CONTENT_MAX_ROWS}.` },
        ),
        parameterRef("OffsetQuery"),
      ],
      responses: {
        "200": jsonResponse("ContentDiscoverResponse", "A page of discovered pages."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/content/wordcount": {
    post: {
      operationId: "postContentWordCount",
      summary: "Count the body words on a handful of URLs.",
      description:
        "Note the shape: `workspace` is a **query parameter on a POST**, because the " +
        "body is the URL list and the workspace is scoping, not input.\n\n" +
        "The upstream content-parsing endpoint takes one URL per call, so this fans " +
        `out to up to ${CONTENT_WORDCOUNT_MAX_URLS} billed calls — it is priced per URL, not per request. URLs are ` +
        "de-duplicated first, so `submitted` is the **deduplicated** count and may be " +
        "smaller than the array you sent.\n\n" +
        "A `wordCount` of `null` means \"could not count\" — the page refused the " +
        "crawler, answered non-2xx, or was unparseable — and is distinct from `0`, " +
        "which means a page that really has no body text.",
      tags: ["Content Discovery"],
      parameters: [parameterRef("WorkspaceQuery")],
      requestBody: jsonBody(
        obj({
          urls: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 2048 },
            minItems: 1,
            maxItems: CONTENT_WORDCOUNT_MAX_URLS,
          },
        }),
      ),
      responses: {
        "200": jsonResponse("ContentWordCountResponse", "One row per deduplicated URL."),
        ...dataForSeoErrors(),
      },
    },
  },

  /* ------------------------------- collections ----------------------------- */

  "/collections": {
    get: {
      operationId: "listCollections",
      summary: "Keyword collections in this workspace.",
      description:
        "Collections are pure storage: no DataForSEO call, no cost, no `ResultMeta`, " +
        "and nothing here can trip the spend cap. `workspace` is a query parameter on " +
        "every route in this module, mutations included.",
      tags: ["Collections"],
      parameters: [parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("CollectionListResponse", "The collections."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    post: {
      operationId: "createCollection",
      summary: "Create a keyword collection.",
      tags: ["Collections"],
      parameters: [parameterRef("WorkspaceQuery")],
      requestBody: jsonBody(
        obj({
          name: { type: "string", minLength: 1, maxLength: COLLECTION_NAME_MAX_LENGTH },
        }),
      ),
      responses: {
        "201": jsonResponse("CollectionMutationResponse", "The new collection."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/collections/{id}": {
    get: {
      operationId: "getCollection",
      summary: "A collection and its keywords, newest first.",
      description:
        "A row's `locationCode` / `languageCode` of null means **unknown market**, " +
        "not a default — see `CollectionKeywordRow`.",
      tags: ["Collections"],
      parameters: [pathParam("id", "Collection id."), parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("CollectionDetailResponse", "The collection."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    patch: {
      operationId: "updateCollection",
      summary: "Rename a collection.",
      tags: ["Collections"],
      parameters: [pathParam("id", "Collection id."), parameterRef("WorkspaceQuery")],
      requestBody: jsonBody(
        obj({
          name: { type: "string", minLength: 1, maxLength: COLLECTION_NAME_MAX_LENGTH },
        }),
      ),
      responses: {
        "200": jsonResponse("CollectionMutationResponse", "The renamed collection."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "deleteCollection",
      summary: "Delete a collection and its keywords.",
      tags: ["Collections"],
      parameters: [pathParam("id", "Collection id."), parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("CollectionDeletedResponse", "Deleted."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/collections/{id}/keywords": {
    post: {
      operationId: "addCollectionKeywords",
      summary: "Add keywords to a collection.",
      description:
        "**Idempotent, and `added + skipped === submitted` always holds.** Adding a " +
        "keyword the collection already has is not an error and is not an update: the " +
        "first save wins, so a re-add **never overwrites the stored " +
        "`volumeSnapshot`** and **never re-stamps the market**. That is what makes the " +
        "snapshot meaningful — it is the volume at the moment the keyword was first " +
        "saved, not the volume the last time someone clicked Save — and it makes " +
        "\"select all → Add\" safe to double-click.\n\n" +
        "`location` and `language` are a pair: **give both, or neither.** One without " +
        "the other is a 422, because half a market is not a market, and storing it " +
        "would produce rows whose snapshot cannot be interpreted.",
      tags: ["Collections"],
      parameters: [pathParam("id", "Collection id."), parameterRef("WorkspaceQuery")],
      requestBody: jsonBody(
        obj(
          {
            keywords: {
              type: "array",
              minItems: 1,
              maxItems: COLLECTION_KEYWORDS_BULK_MAX,
              items: obj(
                {
                  keyword: { type: "string", minLength: 1, maxLength: 700 },
                  volumeSnapshot: nullableInt(
                    "Volume at save time. Omit or send null when unknown.",
                  ),
                },
                { optional: ["volumeSnapshot"] },
              ),
            },
            location: int("DataForSEO location code. Requires `language`."),
            language: {
              type: "string",
              minLength: 2,
              maxLength: 8,
              description: "ISO language code. Requires `location`.",
            },
          },
          { optional: ["location", "language"] },
        ),
      ),
      responses: {
        "200": jsonResponse("CollectionKeywordsAddedResponse", "What was added and skipped."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "removeCollectionKeywords",
      summary: "Remove keywords from a collection.",
      tags: ["Collections"],
      parameters: [pathParam("id", "Collection id."), parameterRef("WorkspaceQuery")],
      requestBody: jsonBody(
        obj({
          keywords: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            maxItems: COLLECTION_KEYWORDS_BULK_MAX,
            description: "Keyword text — collections are keyed by the word itself.",
          },
        }),
      ),
      responses: {
        "200": jsonResponse("CollectionKeywordsRemovedResponse", "What was removed."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/collections/{id}/export.csv": {
    get: {
      operationId: "exportCollectionCsv",
      summary: "A collection as CSV.",
      description:
        "Columns, in order: `keyword`, `volume_snapshot`, `location_code`, " +
        "`language_code`, `added_at`.",
      tags: ["Collections"],
      parameters: [pathParam("id", "Collection id."), parameterRef("WorkspaceQuery")],
      responses: {
        "200": csvResponse("The collection's keywords as CSV."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  /* -------------------------------- history -------------------------------- */

  "/history": {
    get: {
      operationId: "listSearchHistory",
      summary: "The workspace's trail for one research module, newest first.",
      description:
        "Rows are written automatically by `GET /keywords/overview`, " +
        "`GET /domains/overview` and `GET /gap/keywords` — there is no way to " +
        "add one by hand, because the trail is a record of what was actually " +
        "searched. Re-running a search updates its row (`hitCount`, " +
        `\`lastSearchedAt\`) rather than adding another, and only the newest ${HISTORY_KEEP} ` +
        "rows per module are kept.\n\n" +
        "Re-opening a row is free: re-issue its `params` with `stale=true`, " +
        "which serves the cached answer even past its normal lifetime and " +
        "spends nothing. `fresh=true` is the opposite affordance, and the one " +
        "that bills.\n\n" +
        "Pure storage: no DataForSEO call, no cost, no `ResultMeta`.",
      tags: ["History"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("module", ref("HistoryModule"), {
          required: true,
          description: "Which module's trail to read. A trail is always one module's.",
        }),
        queryParam(
          "limit",
          {
            type: "integer",
            minimum: 1,
            maximum: HISTORY_MAX_LIMIT,
            default: HISTORY_DEFAULT_LIMIT,
          },
          {
            description: `Rows to return, 1–${HISTORY_MAX_LIMIT}. Clamped rather than refused above the ceiling: a panel asking for more than we keep gets the most there is.`,
          },
        ),
      ],
      responses: {
        "200": jsonResponse("HistoryListResponse", "The trail."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "clearSearchHistory",
      summary: "Clear one module's trail.",
      description:
        "Clearing an empty trail succeeds with `deleted: 0` — the caller asked " +
        "for it to be empty, and it is.",
      tags: ["History"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        queryParam("module", ref("HistoryModule"), { required: true }),
      ],
      responses: {
        "200": jsonResponse("HistoryDeletedResponse", "How many rows were removed."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/history/{id}": {
    delete: {
      operationId: "deleteSearchHistoryEntry",
      summary: "Forget one search.",
      description:
        "No `module` parameter: the caller has a row id from a list it was " +
        "already given. A row belonging to another workspace answers 404, which " +
        "is the same answer a nonexistent id gets.",
      tags: ["History"],
      parameters: [pathParam("id", "History row id."), parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("HistoryDeletedResponse", "`{ deleted: 1 }`."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  /* -------------------------------- projects ------------------------------- */

  "/projects": {
    get: {
      operationId: "listProjects",
      summary: "Projects in this workspace, newest first.",
      description: "Pure storage: creating and reading projects costs nothing.",
      tags: ["Projects"],
      parameters: [parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("ProjectListResponse", "The projects."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
    post: {
      operationId: "createProject",
      summary: "Create a project. Requires `admin`.",
      description:
        "`domain` is normalised to a bare hostname before it is stored — scheme, " +
        "`www.` and any path are stripped — so pasting a full URL gives the project " +
        "you meant rather than a page-level one.",
      tags: ["Projects"],
      security: SESSION_ONLY,
      parameters: [parameterRef("WorkspaceQuery")],
      requestBody: jsonBody(
        obj(
          {
            name: { type: "string", minLength: 1, maxLength: PROJECT_NAME_MAX_LENGTH },
            domain: { type: "string", minLength: 1, maxLength: 253 },
            locationCode: int("Default market. Defaults to the UK."),
            languageCode: { type: "string", minLength: 2, maxLength: 8 },
          },
          { optional: ["locationCode", "languageCode"] },
        ),
      ),
      responses: {
        "201": jsonResponse("ProjectMutationResponse", "The new project."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },

  "/projects/{id}": {
    patch: {
      operationId: "updateProject",
      summary: "Change a project's name, domain or market. Requires `admin`.",
      description: "All four fields are optional; at least one must be present.",
      tags: ["Projects"],
      security: SESSION_ONLY,
      parameters: projectScoped(),
      requestBody: jsonBody(
        obj(
          {
            name: { type: "string", minLength: 1, maxLength: PROJECT_NAME_MAX_LENGTH },
            domain: { type: "string", minLength: 1, maxLength: 253 },
            locationCode: int(),
            languageCode: { type: "string", minLength: 2, maxLength: 8 },
          },
          { optional: ["name", "domain", "locationCode", "languageCode"] },
        ),
      ),
      responses: {
        "200": jsonResponse("ProjectMutationResponse", "The updated project."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "deleteProject",
      summary: "Delete a project. Requires `admin`.",
      description:
        "Tracked keywords, rank snapshots, audits and AI prompts cascade with the row.",
      tags: ["Projects"],
      security: SESSION_ONLY,
      parameters: projectScoped(),
      responses: {
        "200": jsonResponse("ProjectDeletedResponse", "Deleted."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  /* ------------------------------ rank tracking ---------------------------- */

  "/projects/{id}/keywords": {
    get: {
      operationId: "listTrackedKeywords",
      summary: "Tracked keywords, their positions, movement and 30-day series.",
      description:
        "Two conventions run through every row and a client must honour both.\n\n" +
        "**`position: null` means \"checked, and not in the top 100\"** — a real, " +
        "measured result. A keyword nobody has checked yet has no snapshot at all " +
        "(`latest === null`), which is a genuinely unknown state. Render the first as " +
        "a dash and the second as \"awaiting first check\".\n\n" +
        "**`change*` is positive when the ranking IMPROVED.** Position counts " +
        "downward, so moving from 8 to 3 is `+5`. Colour positive as good.",
      tags: ["Rank Tracking"],
      parameters: projectScoped(),
      responses: {
        "200": jsonResponse("TrackedKeywordsResponse", "The tracking table."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    post: {
      operationId: "addTrackedKeywords",
      summary: "Track keywords in a project.",
      description:
        "**Idempotent, and `added + skipped === submitted` always holds.** The unique " +
        "key is (project, keyword, location, language, device), so re-adding is a " +
        "no-op rather than an error and \"select all → Track\" is safe to " +
        "double-click. A re-add never re-stamps the market a keyword was first tracked " +
        "in.\n\n" +
        "Adding new keywords **enqueues a rank check** for them, reported as " +
        "`checkEnqueued`; it is false when everything was a duplicate and there was " +
        "nothing to check. The check is background work, so the money is spent later " +
        "by the sweeper, under the spend cap — this response is not a bill.",
      tags: ["Rank Tracking"],
      parameters: projectScoped(),
      requestBody: jsonBody(
        obj(
          {
            keywords: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 700 },
              minItems: 1,
              maxItems: TRACKED_KEYWORDS_BULK_MAX,
              description: "Trimmed, lowercased and de-duplicated before storage.",
            },
            device: ref("Device"),
            locationCode: int("Per-batch override; defaults to the project's market."),
            languageCode: { type: "string", minLength: 2, maxLength: 8 },
          },
          { optional: ["device", "locationCode", "languageCode"] },
        ),
      ),
      responses: {
        "200": jsonResponse("TrackedKeywordsAddedResponse", "What was added and skipped."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "removeTrackedKeywords",
      summary: "Stop tracking keywords.",
      description:
        "`ids` are **tracked-keyword ids, not keyword text** — the same word can be " +
        "tracked more than once under different devices or markets, so text would be " +
        "ambiguous. Snapshots cascade with the rows.",
      tags: ["Rank Tracking"],
      parameters: projectScoped(),
      requestBody: jsonBody(
        obj({
          ids: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            maxItems: TRACKED_KEYWORDS_BULK_MAX,
            description: "`TrackedKeywordRow.id` values.",
          },
        }),
      ),
      responses: {
        "200": jsonResponse("TrackedKeywordsRemovedResponse", "What was removed."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/projects/{id}/keywords/check-now": {
    post: {
      operationId: "checkRanksNow",
      summary: "Enqueue an immediate rank check for every keyword in a project. Requires `admin`.",
      description:
        "**Rate limited to once per hour per project**, answering 429 with " +
        "`details.nextAllowedAt` — an ISO timestamp — when the window is still open. " +
        "The limit is about money rather than load: every press buys a SERP per " +
        "keyword, and positions do not move hour to hour.\n\n" +
        "**This enqueues background work and returns 202; it does not spend now.** " +
        "The tasks are posted later by the cron sweeper, under the spend cap in force " +
        "at that moment. So `estimatedCostUsd` is a hint computed from our price " +
        "constants, not a bill: the authoritative figure is what the client meters " +
        "when the tasks actually go out, and a cap raised or lowered in between " +
        "applies to the spend, not to this response.",
      tags: ["Rank Tracking"],
      security: SESSION_ONLY,
      parameters: projectScoped(),
      responses: {
        "202": jsonResponse("RankCheckEnqueuedResponse", "Queued."),
        "409": errorResponse("`conflict` — the project has no tracked keywords to check."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "RateLimited"),
      },
    },
  },

  /* ------------------------------- site audit ------------------------------ */

  "/projects/{id}/audits": {
    get: {
      operationId: "listAudits",
      summary: "Audit history for a project, newest first.",
      tags: ["Site Audit"],
      parameters: projectScoped(),
      responses: {
        "200": jsonResponse("AuditListResponse", "The audits."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    post: {
      operationId: "createAudit",
      summary: "Start a crawl-based site audit. Requires `admin`.",
      description:
        "**Returns 202 with `taskId` always null.** The crawl is bought by a " +
        "background job, not by this request, so there is no provider task id to " +
        "report yet — the field exists for support once one has been assigned, and is " +
        "never populated by this response.\n\n" +
        "The lifecycle is `pending` → `running` → `done` | `failed`, polled via " +
        "`GET /audits/{auditId}`. A refusal that happens after this 202 — spend cap, " +
        "missing credentials — cannot arrive as an HTTP status, so it surfaces as " +
        "`status: \"failed\"` with `errorCode` set.\n\n" +
        "**`estimatedCostUsd` is a ceiling, not a price.** It assumes the full " +
        "`maxCrawlPages`, and DataForSEO refunds the pages a crawl does not use — a " +
        "site with 40 pages audited at a 500-page limit is billed for 40. The number " +
        "is worth showing before the button, but it will usually be too high.",
      tags: ["Site Audit"],
      security: SESSION_ONLY,
      parameters: projectScoped(),
      requestBody: jsonBody(
        obj(
          {
            maxCrawlPages: {
              type: "integer",
              enum: [...AUDIT_CRAWL_SIZES],
              default: 25,
              description:
                "A fixed set rather than a free number: crawl cost is per page, and " +
                "a text field is one typo away from a very large bill.",
            },
            renderJs: {
              type: "boolean",
              default: false,
              description:
                "Render JavaScript before analysing each page. Materially more " +
                "expensive and slower, but the only way to audit a client-rendered site.",
            },
          },
          { optional: ["maxCrawlPages", "renderJs"] },
        ),
      ),
      responses: {
        "202": jsonResponse("AuditCreatedResponse", "Queued."),
        "409": errorResponse(
          "`conflict` — an audit for this project is already pending or running. " +
            "Also `no_credentials`, when the workspace has no DataForSEO credentials " +
            "stored.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/audits/{auditId}": {
    get: {
      operationId: "getAudit",
      summary: "One audit — the polling endpoint.",
      description:
        "`summary` is null while `status` is `pending`; `progress` carries the crawl " +
        "counts while it is `running`.",
      tags: ["Site Audit"],
      parameters: [pathParam("auditId", "Audit id."), parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("AuditDetailResponse", "The audit."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "deleteAudit",
      summary: "Delete an audit and its stored crawl data. Requires `admin`.",
      tags: ["Site Audit"],
      security: SESSION_ONLY,
      parameters: [pathParam("auditId", "Audit id."), parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("AuditDeletedResponse", "Deleted, with a blob count."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/audits/{auditId}/issues/{category}": {
    get: {
      operationId: "getAuditIssues",
      summary: "The pages failing one category of checks.",
      description:
        "**A missing or corrupt drill-down index is an empty list, not a 404.** The " +
        "per-category page lists live in object storage rather than in the audit row, " +
        "and losing one must not make a finished audit look deleted: the rollup is " +
        "still true, the score is still true, and only this one drill-down is " +
        "unavailable. A 404 here would say the audit does not exist, which is a worse " +
        "lie than an empty list.",
      tags: ["Site Audit"],
      parameters: [
        pathParam("auditId", "Audit id."),
        {
          name: "category",
          in: "path",
          required: true,
          description: "Which category to drill into.",
          schema: ref("AuditCategory"),
        },
        parameterRef("WorkspaceQuery"),
        queryParam("page", { type: "integer", minimum: 1, default: 1 }, {
          description: `1-based. ${AUDIT_ISSUES_PAGE_SIZE} pages per page of results.`,
        }),
      ],
      responses: {
        "200": jsonResponse("AuditIssuesResponse", "A page of affected pages."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  /* ----------------------------- search console ---------------------------- */

  "/gsc/status": {
    get: {
      operationId: "getGscStatus",
      summary: "Whether Search Console is configured, connected and healthy.",
      description:
        "**The only `/gsc/*` route with no configuration gate.** Every other route in " +
        "this module answers 409 `gsc_not_configured` when the deployment has no " +
        "Google OAuth client; this one answers `configured: false` in a normal 200 " +
        "body instead.\n\n" +
        "That asymmetry is deliberate. A self-hosted deployment without Google " +
        "credentials is a supported configuration, not a broken one, and a client " +
        "needs to render setup guidance without first provoking an error to discover " +
        "that it should. This endpoint *is* the configuration report, so it cannot " +
        "fail for a configuration reason.",
      tags: ["Search Console"],
      parameters: gscParams(),
      responses: {
        "200": jsonResponse("GscStatusResponse", "The connection state."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/gsc/connect": {
    get: {
      operationId: "startGscConnect",
      summary: "Redirect to Google's consent screen. Requires `admin`.",
      description:
        "A browser navigation, not an XHR: it answers 302 with no JSON body. Signed-in " +
        "users only — an API key has no browser to redirect and answers 403.",
      tags: ["Search Console"],
      security: SESSION_ONLY,
      parameters: gscParams(),
      responses: {
        "302": noContent("`Location` carries the Google authorization URL."),
        "409": errorResponse("`gsc_not_configured` — this deployment has no Google OAuth client."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/gsc/callback": {
    get: {
      operationId: "completeGscConnect",
      summary: "Google's OAuth redirect target. Redirects back to the app.",
      description:
        "Answers 302 in every case, success or failure — it is a browser navigation " +
        "and cannot return a JSON error body, so the reason is handed to the page it " +
        "lands on as an `?error=` parameter.",
      tags: ["Search Console"],
      security: SESSION_ONLY,
      parameters: [
        queryParam("code", { type: "string" }, { description: "Google's authorization code." }),
        queryParam("state", { type: "string" }, { description: "Our signed state token." }),
        queryParam("error", { type: "string" }, { description: "Google's own error, e.g. `access_denied`." }),
      ],
      responses: {
        "302": noContent("Redirect back to the app, with an `?error=` parameter on failure."),
        ...errors("Unauthorized", "Forbidden"),
      },
    },
  },

  "/gsc/sites": {
    get: {
      operationId: "listGscSites",
      summary: "Search Console properties this Google account can read. Requires `admin`.",
      tags: ["Search Console"],
      security: SESSION_ONLY,
      parameters: gscParams(),
      responses: {
        "200": jsonResponse("GscSitesResponse", "The available properties."),
        "409": errorResponse(
          "`gsc_not_configured`, `gsc_not_connected`, or `gsc_reconnect_required`.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "UpstreamError"),
      },
    },
  },

  "/gsc/connection": {
    patch: {
      operationId: "updateGscConnection",
      summary: "Bind this project to a Search Console property. Requires `admin`.",
      description:
        "The property is validated against Google's own site list server-side, so a " +
        "property this grant cannot read is a **422**, not a failure discovered later " +
        "when a report comes back empty.",
      tags: ["Search Console"],
      security: SESSION_ONLY,
      parameters: gscParams(),
      requestBody: jsonBody(obj({ property: { type: "string", minLength: 1 } })),
      responses: {
        "200": jsonResponse("GscConnectionResponse", "The bound property."),
        "409": errorResponse(
          "`gsc_not_configured`, `gsc_not_connected`, or `gsc_reconnect_required`.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "UpstreamError"),
      },
    },
    delete: {
      operationId: "deleteGscConnection",
      summary: "Disconnect Search Console from this project. Requires `admin`.",
      tags: ["Search Console"],
      security: SESSION_ONLY,
      parameters: gscParams(),
      responses: {
        "200": jsonResponse("GscDisconnectedResponse", "Disconnected."),
        "409": errorResponse("`gsc_not_configured`."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/gsc/overview": {
    get: {
      operationId: "getGscOverview",
      summary: "Clicks, impressions, CTR and position for a project, with a daily series.",
      description:
        "**Search Console data lags roughly two days**, so \"today\" is not a question " +
        "anyone can ask. `freshTo` on every response is the newest day Google has " +
        "finalised.\n\n" +
        "**A `to` later than `freshTo` is silently clamped down to it, not rejected.** " +
        "Rejecting would make every naive \"last 30 days including today\" request an " +
        "error for a reason the caller cannot fix; clamping returns the days that " +
        "actually exist and says so in `to`. Read the window you were served from the " +
        "response, not from what you asked for.\n\n" +
        `\`from\` defaults to ${GSC_DEFAULT_RANGE_DAYS} inclusive days back from \`freshTo\`.\n\n` +
        "Costs nothing — the data is Google's, on the user's own grant.",
      tags: ["Search Console"],
      parameters: [
        ...gscParams(),
        isoDateParam("from", `Inclusive start. Defaults to ${GSC_DEFAULT_RANGE_DAYS} days back from \`freshTo\`.`),
        isoDateParam("to", "Inclusive end. Clamped down to `freshTo`."),
      ],
      responses: {
        "200": jsonResponse("GscOverviewResponse", "Totals and a daily series."),
        "409": errorResponse(
          "`gsc_not_configured`, `gsc_not_connected`, `gsc_no_property`, or " +
            "`gsc_reconnect_required`.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "UpstreamError"),
      },
    },
  },

  "/gsc/queries": {
    get: {
      operationId: "getGscQueries",
      summary: "Search queries the property ranks for.",
      description:
        `**The paging is ours, not Google's.** One pull of up to ${GSC_ROW_LIMIT} rows is cached ` +
        "for the window, and `limit`/`offset` slice it in memory — so paging through " +
        "the table costs nothing and never re-queries Google. `total` is the size of " +
        "the fetched set, which is why it can be smaller than the property's true " +
        "query count.",
      tags: ["Search Console"],
      parameters: [
        ...gscParams(),
        isoDateParam("from", "Inclusive start."),
        isoDateParam("to", "Inclusive end. Clamped down to `freshTo`."),
        ...pagingParams(),
      ],
      responses: {
        "200": jsonResponse("GscQueriesResponse", "A page of query rows."),
        "409": errorResponse(
          "`gsc_not_configured`, `gsc_not_connected`, `gsc_no_property`, or " +
            "`gsc_reconnect_required`.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "UpstreamError"),
      },
    },
  },

  "/gsc/pages": {
    get: {
      operationId: "getGscPages",
      summary: "Pages the property earns impressions and clicks on.",
      description: "Paged the same way as `/gsc/queries`: one cached pull, sliced in memory.",
      tags: ["Search Console"],
      parameters: [
        ...gscParams(),
        isoDateParam("from", "Inclusive start."),
        isoDateParam("to", "Inclusive end. Clamped down to `freshTo`."),
        ...pagingParams(),
      ],
      responses: {
        "200": jsonResponse("GscPagesResponse", "A page of page rows."),
        "409": errorResponse(
          "`gsc_not_configured`, `gsc_not_connected`, `gsc_no_property`, or " +
            "`gsc_reconnect_required`.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "UpstreamError"),
      },
    },
  },

  "/gsc/opportunities": {
    get: {
      operationId: "getGscOpportunities",
      summary: "Striking-distance, low-CTR and cannibalisation findings.",
      description:
        "No `limit` or `offset`: **each rule caps its own output**, and each list " +
        "reports the number of matches before that cap. `total > items.length` is the " +
        "truncation test — without it a capped list is indistinguishable from a " +
        "complete one, and \"200 striking-distance keywords\" reads as the whole " +
        "picture when it may be a quarter of it.\n\n" +
        "`thresholds` returns the numbers the rules actually ran with, so an " +
        "explanation rendered beside each table cannot drift from the computation.",
      tags: ["Search Console"],
      parameters: [
        ...gscParams(),
        isoDateParam("from", "Inclusive start."),
        isoDateParam("to", "Inclusive end. Clamped down to `freshTo`."),
      ],
      responses: {
        "200": jsonResponse("GscOpportunitiesResponse", "The three opportunity lists."),
        "409": errorResponse(
          "`gsc_not_configured`, `gsc_not_connected`, `gsc_no_property`, or " +
            "`gsc_reconnect_required`.",
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "UpstreamError"),
      },
    },
  },

  /* ----------------------------- ai visibility ----------------------------- */

  "/projects/{id}/ai/prompts": {
    get: {
      operationId: "listAiPrompts",
      summary: "The prompts this project is measured against.",
      tags: ["AI Visibility"],
      parameters: projectScoped(),
      responses: {
        "200": jsonResponse("AiPromptListResponse", "The prompts and their latest verdicts."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    post: {
      operationId: "createAiPrompt",
      summary: "Add a prompt and run it immediately. Requires `admin`.",
      description:
        "Creating a prompt **enqueues its first run**, so this is the one write in " +
        "the module that leads to spending. The run happens in the background under " +
        "the spend cap.",
      tags: ["AI Visibility"],
      security: SESSION_ONLY,
      parameters: projectScoped(),
      requestBody: jsonBody(
        obj({
          prompt: {
            type: "string",
            minLength: 3,
            maxLength: AI_PROMPT_MAX_CHARS,
            description: `The provider's own ceiling is ${AI_PROMPT_MAX_CHARS} characters; enforcing it here makes a too-long prompt a 422 rather than a paid round trip that fails upstream.`,
          },
          engines: {
            type: "array",
            items: ref("AiEngineId"),
            minItems: 1,
            maxItems: AI_ENGINE_IDS.length,
          },
        }),
      ),
      responses: {
        "201": jsonResponse("AiPromptMutationResponse", "The new prompt."),
        "409": errorResponse(
          `\`conflict\` — this project already has ${AI_PROMPTS_MAX_PER_PROJECT} prompts, the per-project ceiling. A weekly run bills every one of them.`,
        ),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/projects/{id}/ai/prompts/{promptId}": {
    patch: {
      operationId: "updateAiPrompt",
      summary: "Edit a prompt's text or engines. Requires `admin`.",
      description:
        "Both fields are optional; at least one must be present. **Editing never " +
        "re-runs and never spends** — use `POST /projects/{id}/ai/run` when you want " +
        "new answers.",
      tags: ["AI Visibility"],
      security: SESSION_ONLY,
      parameters: projectScoped(pathParam("promptId", "Prompt id.")),
      requestBody: jsonBody(
        obj(
          {
            prompt: { type: "string", minLength: 3, maxLength: AI_PROMPT_MAX_CHARS },
            engines: {
              type: "array",
              items: ref("AiEngineId"),
              minItems: 1,
              maxItems: AI_ENGINE_IDS.length,
            },
          },
          { optional: ["prompt", "engines"] },
        ),
      ),
      responses: {
        "200": jsonResponse("AiPromptMutationResponse", "The updated prompt."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
    delete: {
      operationId: "deleteAiPrompt",
      summary: "Delete a prompt and its history. Requires `admin`.",
      tags: ["AI Visibility"],
      security: SESSION_ONLY,
      parameters: projectScoped(pathParam("promptId", "Prompt id.")),
      responses: {
        "200": jsonResponse("AiPromptDeletedResponse", "Deleted."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/projects/{id}/ai/results": {
    get: {
      operationId: "getAiResults",
      summary: "Mention and citation rates over time, plus the latest answers.",
      description: "Defaults to the last 90 days.",
      tags: ["AI Visibility"],
      parameters: projectScoped(
        isoDateParam("from", "Inclusive start, `yyyy-mm-dd`. Defaults to 90 days back."),
        isoDateParam("to", "Inclusive end, `yyyy-mm-dd`."),
      ),
      responses: {
        "200": jsonResponse("AiResultsResponse", "Timelines, latest runs and prompt labels."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed"),
      },
    },
  },

  "/projects/{id}/ai/run": {
    post: {
      operationId: "runAiPrompts",
      summary: "Run every prompt in the project now. Requires `admin`.",
      description:
        `**Rate limited to once per ${AI_RUN_WINDOW_SECONDS / 60} minutes per project**, answering 429 with ` +
        "`details.nextAllowedAt`. The limit is about money: unlike a rank check, every " +
        "press buys LLM answers at a few cents each, and an assistant's answer to the " +
        "same question does not change hour to hour.\n\n" +
        "**Enqueues background work and returns 202; nothing is spent by this " +
        "request.** The calls are made later by the cron sweeper under the spend cap " +
        "in force at that moment.\n\n" +
        "**`estimatedCostUsd` is explicitly an estimate, and a soft one.** There is no " +
        "per-call price list for this API: the real charge is a small platform base " +
        "fee **plus the third-party model's own bill**, which is token usage plus " +
        "whatever that provider charges for a web search. A search charge dominates — " +
        "the same model costs tens of times more with web search on than off — so a " +
        "pre-call number cannot be precise. The authoritative figure is the sum of " +
        "`costUsd` across the snapshots the run writes.",
      tags: ["AI Visibility"],
      security: SESSION_ONLY,
      parameters: projectScoped(),
      responses: {
        "202": jsonResponse("AiRunEnqueuedResponse", "Queued."),
        "409": errorResponse("`conflict` — the project has no prompts to run."),
        ...errors("Unauthorized", "Forbidden", "NotFound", "ValidationFailed", "RateLimited"),
      },
    },
  },

  /* --------------------------------- meta ---------------------------------- */

  "/meta/locations": {
    get: {
      operationId: "getMetaLocations",
      summary: "Selectable markets, each with the languages valid for it.",
      description:
        "**`engine` is validated but currently unused.** Only Google is wired up; the " +
        "parameter exists because the route is documented with it and other engines " +
        "are a later phase. Accepting an engine we cannot serve and quietly returning " +
        "Google's list would be worse than rejecting it, so an unknown value is a 422 " +
        "rather than a silent substitution.\n\n" +
        "**This is Labs' country-level list, not the SERP appendix.** That difference " +
        "is correctness, not preference: the SERP list runs to about a hundred " +
        "thousand entries down to individual airports, while the Labs endpoints behind " +
        "every keyword and domain route accept country-level codes only. Offering the " +
        "larger list would let someone pick a location that then fails every query " +
        "they make.\n\n" +
        "**Billed at $0 and cached globally** rather than per workspace — it is " +
        "reference data with no tenant content in it. A workspace is still required, " +
        "because a provider call needs credentials and credentials belong to a " +
        "workspace; attributing the zero-cost call keeps the usage record complete.\n\n" +
        "Each location lists the languages valid **for that location**. Pairing a " +
        "language from outside the list with it is an upstream error, so a language " +
        "picker should be driven by the chosen market rather than by " +
        "`/meta/languages`.",
      tags: ["Meta"],
      parameters: [
        parameterRef("WorkspaceQuery"),
        parameterRef("FreshQuery"),
        queryParam("engine", { type: "string", enum: ["google"], default: "google" }, {
          description: "Validated, and currently unused.",
        }),
      ],
      responses: {
        "200": jsonResponse("MetaLocationsResponse", "The selectable markets."),
        ...dataForSeoErrors(),
      },
    },
  },

  "/meta/languages": {
    get: {
      operationId: "getMetaLanguages",
      summary: "The global language list, for display names.",
      description:
        "Use `MetaLocationOption.languages` to decide what is *valid* for a market; " +
        "this list is for labels.",
      tags: ["Meta"],
      parameters: [parameterRef("WorkspaceQuery"), parameterRef("FreshQuery")],
      responses: {
        "200": jsonResponse("MetaLanguagesResponse", "The languages."),
        ...dataForSeoErrors(),
      },
    },
  },

  /* ------------------------------- dashboard ------------------------------- */

  "/dashboard": {
    get: {
      operationId: "getDashboard",
      summary: "The workspace home screen's six figures.",
      description:
        "No DataForSEO call — five reads of our own tables — so the first screen after " +
        "login costs nothing and works in a workspace that has no credentials " +
        "configured yet. `avgPosition` is **null rather than 0** when nothing ranks.",
      tags: ["Dashboard"],
      parameters: [parameterRef("WorkspaceQuery")],
      responses: {
        "200": jsonResponse("DashboardRollup", "The rollup."),
        ...errors("Unauthorized", "Forbidden", "ValidationFailed"),
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The whole API description, assembled once at module load.
 *
 * Built eagerly rather than behind a lazy getter: it is a plain data structure
 * with no I/O, the Worker's isolate builds it once and reuses it for every
 * request to `/openapi.json`, and a module-level constant is what the drift
 * test wants to import.
 */
export const openApiDocument: OpenApiDocument = {
  openapi: "3.1.1",
  info: {
    title: "OpenRefs API",
    version: APP_VERSION,
    description: INFO_DESCRIPTION,
    license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
  },
  servers: [
    {
      url: "/api/v1",
      description:
        "Every path in this document is relative to the versioned prefix. " +
        "Against a deployment, prepend the origin: `https://<host>/api/v1`.",
    },
  ],
  tags: TAGS,
  security: ROOT_SECURITY,
  paths: PATHS,
  components: {
    schemas: SCHEMAS,
    parameters: PARAMETERS,
    responses: RESPONSES,
    securitySchemes: SECURITY_SCHEMES,
  },
};

/* -------------------------------------------------------------------------- */
/* Introspection                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every `(path, method)` pair the document declares, in document order.
 *
 * This is what src/worker/openapi.test.ts walks: it groups the result by mount
 * prefix and asserts that every module in `routeModules` has at least one
 * operation, and that every `operationId` is unique.
 */
export function listOperations(
  doc: OpenApiDocument = openApiDocument,
): { path: string; method: HttpMethod; operationId: string }[] {
  const out: { path: string; method: HttpMethod; operationId: string }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      out.push({ path, method, operationId: operation.operationId });
    }
  }
  return out;
}

/** How many operations the document declares. */
export function operationCount(doc: OpenApiDocument = openApiDocument): number {
  return listOperations(doc).length;
}
