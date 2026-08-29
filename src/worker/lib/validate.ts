/**
 * Request validation. Every body, path param and query string in this Worker
 * goes through one of these, so no handler ever reads an unchecked value.
 *
 * Failures raise `ApiException`, which `app.onError` renders in the standard
 * `{ error: { code, message, details } }` shape.
 */
import type { Context } from "hono";
import type { ZodType, z } from "zod";
import { flattenError } from "zod";

import { ApiException } from "../http";

function fail(message: string, error: z.ZodError): never {
  throw new ApiException("validation_failed", message, flattenError(error));
}

/** Parses and validates a JSON request body. */
export async function readJson<S extends ZodType>(
  c: Context,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiException("bad_request", "Expected a JSON request body.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) fail("Some fields need attention.", result.error);
  return result.data;
}

/** Validates path parameters, e.g. `{ id: z.uuid() }`. */
export function readParams<S extends ZodType>(c: Context, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) fail("Invalid path.", result.error);
  return result.data;
}

/** Validates the query string. */
export function readQuery<S extends ZodType>(c: Context, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) fail("Invalid query parameters.", result.error);
  return result.data;
}
