import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiErrorBody, ApiErrorCode } from "../shared/api";
import { ERROR_STATUS } from "../shared/api";

/**
 * The only sanctioned way to produce an error response. Guarantees the shape
 * documented in CLAUDE.md: `{ "error": { "code", "message" } }`.
 */
export function apiError(
  c: Context,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return c.json(body, ERROR_STATUS[code] as ContentfulStatusCode);
}

/**
 * Throwable equivalent, for use deep in a handler where returning is awkward.
 * The global `onError` unwraps it back into the standard shape.
 */
export class ApiException extends HTTPException {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(ERROR_STATUS[code] as ContentfulStatusCode, { message });
    this.code = code;
    this.details = details;
  }
}

/** Shared handler for every not-yet-implemented module router. */
export function notImplemented(c: Context, what: string): Response {
  return apiError(c, "not_implemented", `${what} is not implemented yet.`);
}
