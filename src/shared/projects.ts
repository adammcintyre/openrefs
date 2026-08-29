/**
 * Contract for `/api/v1/projects` — the "a site you own" half of the product.
 *
 * A project is pure D1: creating one costs nothing and spends nothing, so none
 * of these carry `ResultMeta`. Timestamps are ISO 8601 strings (the DB stores
 * epoch milliseconds; the boundary converts once, in the route).
 *
 * Every project belongs to exactly one workspace and is reached as
 * `?workspace=<id>` + `/:id`, never by id alone — a project id from another
 * tenant reads as "not found" rather than leaking its existence.
 */
import { z } from "zod";

/** Longest name a project may have. */
export const PROJECT_NAME_MAX_LENGTH = 120;

/**
 * Mirrors `DEVICES` in src/db/schema.ts. Re-declared rather than imported so
 * the SPA never pulls the Drizzle schema into the client bundle — the same
 * reason `WORKSPACE_ROLES` is duplicated in shared/workspaces.ts.
 */
export const DEVICES = ["desktop", "mobile"] as const;
export type Device = (typeof DEVICES)[number];
export const deviceSchema = z.enum(DEVICES);

/**
 * A bare hostname. The route normalises with `normalizeDomain` before this ever
 * sees the value, so `https://www.example.com/pricing` arrives as
 * `example.com`; this only has to reject what is left over.
 */
export const projectDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .describe("Bare hostname, e.g. example.com");

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "A project needs a name.")
  .max(PROJECT_NAME_MAX_LENGTH);

/** DataForSEO's numeric location code. UK is 2826, US is 2840. */
export const locationCodeSchema = z.number().int().positive();

/** ISO 639-1, occasionally with a region suffix. */
export const languageCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .regex(/^[A-Za-z-]+$/, "language must be an ISO language code, e.g. 'en'.");

export const createProjectSchema = z.object({
  name: projectNameSchema,
  domain: projectDomainSchema,
  /** Defaults match the `projects` table: UK / English. */
  locationCode: locationCodeSchema.optional(),
  languageCode: languageCodeSchema.optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    domain: projectDomainSchema.optional(),
    locationCode: locationCodeSchema.optional(),
    languageCode: languageCodeSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.domain !== undefined ||
      body.locationCode !== undefined ||
      body.languageCode !== undefined,
    { message: "Provide at least one field to change." },
  );
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

/* ------------------------------ responses --------------------------------- */

/** One project, as every project-shaped response returns it. */
export interface Project {
  id: string;
  name: string;
  /** Bare hostname, normalised: no scheme, no `www.`, no path. */
  domain: string;
  /** Defaults for anything tracked under this project. */
  locationCode: number;
  languageCode: string;
  /** ISO 8601. */
  createdAt: string;
  /** Tracked keywords in this project. Computed, not stored. */
  keywordCount: number;
  /**
   * ISO 8601 of the newest rank snapshot across the project's keywords, or
   * null when nothing has been checked yet. This is the header's "last
   * checked" — it is snapshot time, not job time, so it only moves when real
   * data lands.
   */
  lastCheckedAt: string | null;
}

/** GET /api/v1/projects?workspace=<id> — newest first. */
export interface ProjectListResponse {
  projects: Project[];
}

/** POST /api/v1/projects, PATCH /api/v1/projects/:id */
export interface ProjectMutationResponse {
  project: Project;
}

/** DELETE /api/v1/projects/:id — children cascade with the row. */
export interface ProjectDeletedResponse {
  deleted: true;
  id: string;
}
