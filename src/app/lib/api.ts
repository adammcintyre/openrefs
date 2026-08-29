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
 * serves both the assets and /api/v1 — so cookies ride along without CORS.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });

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
