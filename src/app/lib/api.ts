import type { ApiErrorCode } from "../../shared/api";
import { isApiErrorBody } from "../../shared/api";

/** A non-2xx response from /api/v1, carrying the server's error code. */
export class ApiError extends Error {
  readonly code: ApiErrorCode | "unknown";
  readonly status: number;
  readonly details: unknown;

  constructor(
    status: number,
    code: ApiErrorCode | "unknown",
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The one place the SPA talks to the API. Always same-origin — the Worker
 * serves both the assets and /api/v1 — so the session cookie rides along
 * without CORS.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  /*
   * Headers are merged into a Headers object rather than spread: `...init`
   * after a `headers` literal would replace the merged object wholesale and
   * drop the content type.
   */
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  // 204 from logout / delete endpoints: no body to parse.
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(
        res.status,
        body.error.code,
        body.error.message,
        body.error.details,
      );
    }
    throw new ApiError(res.status, "unknown", `Request failed (${res.status}).`);
  }

  return body as T;
}

const withBody = (method: string) =>
  function send<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: withBody("POST"),
  put: withBody("PUT"),
  patch: withBody("PATCH"),
  del: withBody("DELETE"),
};

/**
 * Per-field messages from a 422, for highlighting inputs. Returns an empty
 * object for every other kind of failure, so callers can read it unguarded.
 */
export function fieldErrors(error: unknown): Record<string, string[]> {
  if (!(error instanceof ApiError)) return {};
  const { details } = error;
  if (typeof details !== "object" || details === null) return {};
  const { fieldErrors: fields } = details as {
    fieldErrors?: Record<string, string[]>;
  };
  return fields ?? {};
}

/** A message safe to put in front of a user, whatever went wrong. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message !== "") return error.message;
  return fallback;
}
