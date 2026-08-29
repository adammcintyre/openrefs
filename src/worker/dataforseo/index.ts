/**
 * The composition point for DataForSEO access.
 *
 * Routes call `createDataForSeoApi(env, db, workspaceId)` and get one object
 * carrying the raw client plus the typed per-family wrappers, all bound to a
 * single workspace's credentials, cache namespace and spend cap. There is no
 * way to build a wrapper without a workspace, which is the point.
 */
import type { Db } from "../../db";
import type { CreateClientOptions, DataForSeoClient } from "./client";
import { createDataForSeoClient } from "./client";
import { resolveWorkspaceCredentials } from "./credentials";
import type { KeywordsDataApi } from "./keywords-data";
import { createKeywordsDataApi } from "./keywords-data";
import type { LabsApi } from "./labs";
import { createLabsApi } from "./labs";
import type { MetaApi } from "./meta";
import { createMetaApi } from "./meta";
import type { SerpApi } from "./serp";
import { createSerpApi } from "./serp";

export * from "./client";
export * from "./credentials";
export * from "./filters";
export * from "./keywords-data";
export * from "./labs";
export * from "./meta";
export * from "./metering";
export * from "./schema";
export * from "./serp";

export interface DataForSeoApi {
  /** Escape hatch for endpoints without a wrapper yet. Still cached + metered. */
  client: DataForSeoClient;
  keywordsData: KeywordsDataApi;
  labs: LabsApi;
  serp: SerpApi;
  /** The zero-cost reference lists. The only globally-cached family. */
  meta: MetaApi;
}

/** Binds an already-resolved client to the typed wrappers. */
export function createDataForSeoApiFromClient(
  client: DataForSeoClient,
): DataForSeoApi {
  return {
    client,
    keywordsData: createKeywordsDataApi(client),
    labs: createLabsApi(client),
    serp: createSerpApi(client),
    meta: createMetaApi(client),
  };
}

/**
 * Resolves the workspace's credentials (D1, or the env fallback in
 * development) and returns the API bound to them.
 *
 * @throws ApiException `no_credentials` (409) when the workspace has no
 *         credentials and no fallback applies.
 */
export async function createDataForSeoApi(
  env: Env,
  db: Db,
  workspaceId: string,
  options: Pick<CreateClientOptions, "baseUrl"> = {},
): Promise<DataForSeoApi> {
  const credentials = await resolveWorkspaceCredentials(env, db, workspaceId);
  const client = createDataForSeoClient({
    env,
    db,
    workspaceId,
    credentials,
    baseUrl: options.baseUrl,
  });
  return createDataForSeoApiFromClient(client);
}
