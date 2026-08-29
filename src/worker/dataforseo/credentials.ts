/**
 * Deciding *whose* DataForSEO account pays for a call.
 *
 * OpenRefs is bring-your-own-key. Each workspace stores its own DataForSEO
 * login/password, AES-256-GCM encrypted with APP_MASTER_KEY. The operator's
 * own credentials exist in the environment only so that a developer running
 * `npm run dev` can exercise the real API — and they are readable **only when
 * APP_ENV === "development"**.
 *
 * That gate is the security boundary of the whole hosted product: without it a
 * tenant who never entered a key would silently bill the operator. It is a
 * single `===` on purpose, tested in credentials.test.ts, and must not grow
 * additional escape hatches (no "unless the workspace is trusted", no
 * "unless the request is local").
 */
import { eq } from "drizzle-orm";

import type { Db } from "../../db";
import { workspaces } from "../../db";
import { ApiException } from "../http";
import { decryptSecret } from "../lib/crypto";
import type { DataForSeoCredentials } from "./client";

/** The one APP_ENV value that unlocks dev-only behaviour. */
export const DEVELOPMENT_APP_ENV = "development";

/**
 * Only the bindings this module reads. Narrow on purpose: tests construct this
 * object literally, with no D1/KV/R2 stubs in sight.
 */
export type CredentialsEnv = Pick<
  Env,
  "APP_ENV" | "APP_MASTER_KEY" | "DATAFORSEO_LOGIN" | "DATAFORSEO_PASSWORD"
>;

export function isDevelopment(env: Pick<Env, "APP_ENV">): boolean {
  return env.APP_ENV === DEVELOPMENT_APP_ENV;
}

const NO_CREDENTIALS_MESSAGE =
  "Add your DataForSEO API credentials in Settings";

/** What `workspaces` holds for one tenant. Either column may be null. */
export interface StoredCredentials {
  loginEnc: string | null;
  passwordEnc: string | null;
}

export type CredentialSource =
  | { source: "workspace"; loginEnc: string; passwordEnc: string }
  | { source: "env" };

/**
 * The pure half of credential resolution: given the environment and what the
 * workspace row holds, decide which account to bill — or refuse.
 *
 * Split out from the D1 read so the security gate is testable as arithmetic.
 * A workspace with only one of the two columns set is treated as unset: half a
 * credential pair cannot authenticate, and falling back is friendlier than a
 * 401 from upstream.
 *
 * @throws ApiException `no_credentials` (409) when there is nothing to use.
 */
export function selectCredentialSource(
  env: CredentialsEnv,
  stored: StoredCredentials,
): CredentialSource {
  const { loginEnc, passwordEnc } = stored;
  if (loginEnc && passwordEnc) {
    return { source: "workspace", loginEnc, passwordEnc };
  }

  // The gate. Note the ordering: production is refused before the env vars are
  // even looked at, so a deploy that carries the operator's key by accident
  // still cannot spend it.
  if (!isDevelopment(env)) {
    throw new ApiException("no_credentials", NO_CREDENTIALS_MESSAGE);
  }

  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw new ApiException("no_credentials", NO_CREDENTIALS_MESSAGE);
  }

  return { source: "env" };
}

/**
 * Resolves the credentials one workspace should use, decrypting the stored
 * pair or falling back to the environment in development.
 *
 * @throws ApiException `not_found` when the workspace does not exist,
 *         `no_credentials` (409) when it has none and no fallback applies,
 *         `internal_error` when the stored ciphertext will not decrypt.
 */
export async function resolveWorkspaceCredentials(
  env: CredentialsEnv,
  db: Db,
  workspaceId: string,
): Promise<DataForSeoCredentials> {
  const rows = await db
    .select({
      loginEnc: workspaces.dfsLoginEnc,
      passwordEnc: workspaces.dfsPasswordEnc,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new ApiException("not_found", "Workspace not found.");
  }

  const choice = selectCredentialSource(env, row);

  if (choice.source === "env") {
    return {
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
    };
  }

  try {
    const [login, password] = await Promise.all([
      decryptSecret(env.APP_MASTER_KEY, choice.loginEnc),
      decryptSecret(env.APP_MASTER_KEY, choice.passwordEnc),
    ]);
    return { login, password };
  } catch {
    // Wrong APP_MASTER_KEY, or a tampered row. The underlying error is not
    // forwarded: WebCrypto messages are useless to the user and the ciphertext
    // is not ours to leak.
    throw new ApiException(
      "internal_error",
      "Stored DataForSEO credentials could not be decrypted. Re-enter them in Settings.",
    );
  }
}

/**
 * Renders a login safe to put in a log line or a dev response: `te***@host`.
 * The only form in which a DataForSEO login may ever leave this Worker.
 */
export function maskLogin(login: string): string {
  const at = login.lastIndexOf("@");
  if (at <= 0) {
    return login.length <= 2 ? "***" : `${login.slice(0, 2)}***`;
  }
  const local = login.slice(0, at);
  const domain = login.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}
