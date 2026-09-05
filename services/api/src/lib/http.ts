/**
 * The handler plumbing: who is calling, what they sent, and what comes back.
 *
 * ── The one place `userId` may enter the system ───────────────────────────
 *
 * `requireUserId` reads the `sub` claim out of the API Gateway JWT authorizer's
 * context. **That is the only source of a user id in this codebase.** It is
 * never a request body field, never a query parameter, never a client-set
 * header — those are all attacker-controlled, and with RLS retired (ADR 0008)
 * nothing downstream would notice.
 *
 * The authorizer has already verified the token's signature, issuer, audience
 * and expiry against the Cognito pool before the Lambda is invoked at all. A
 * request that reaches this code has a valid token; what `requireUserId` guards
 * against is a *misconfigured route* — one wired up without the authorizer —
 * where `claims` would simply be absent. Failing closed there is the point.
 */

import { ApiError, pgErrorCode, PG_ERROR } from './rows.ts';

/**
 * The slice of API Gateway's HTTP API v2 payload this code uses.
 *
 * Hand-written rather than imported from `@types/aws-lambda`. The package would
 * be a dependency carried into every bundle for four field declarations, and
 * `services/api` deliberately has one runtime dependency (`pg`) so a Lambda
 * bundle stays small enough that cold start is about the VPC and nothing else.
 */
export interface ApiEvent {
  version: string;
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    requestId: string;
    http: { method: string; path: string };
    authorizer?: {
      jwt?: {
        claims?: Record<string, string | number | boolean>;
        scopes?: string[];
      };
    };
  };
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * The verified `sub`, or a 401.
 *
 * `sub` is a Cognito user id — a uuid — and it goes straight into
 * `where user_id = $1`. It is checked for shape rather than trusted blindly:
 * the authorizer guarantees the token is authentic, not that a claim is the
 * type this code assumes, and a non-uuid reaching a `uuid` parameter is a 500
 * from Postgres rather than a clean refusal.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUserId(event: ApiEvent): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.['sub'];
  if (typeof sub !== 'string' || !UUID.test(sub)) {
    throw new ApiError(401, 'Not signed in.');
  }
  return sub;
}

/** The JSON body, or a 400. */
export function readJsonBody(event: ApiEvent): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'The request body is not valid JSON.');
  }
}

/** A required path parameter, or a 400. */
export function pathParam(event: ApiEvent, name: string): string {
  const value = event.pathParameters?.[name];
  if (typeof value !== 'string' || value === '') {
    throw new ApiError(400, `Missing path parameter: ${name}.`);
  }
  return value;
}

export function queryParam(event: ApiEvent, name: string): string | undefined {
  const value = event.queryStringParameters?.[name];
  return value === '' ? undefined : value;
}

/**
 * CORS. The SPA is served from a different origin than the API for the whole of
 * P9 — Vite on localhost in development, and whatever Phase G's CloudFront
 * distribution becomes later.
 *
 * `CORS_ORIGIN` is set per environment rather than `*`, because `*` and
 * `Authorization` are a combination that works and should not: it lets any page
 * on the internet make authenticated calls with a token it has stolen from
 * local storage. An explicit origin does not stop token theft, but it stops the
 * theft being usable from an arbitrary page.
 */
function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function json(statusCode: number, body: unknown): ApiResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

export function noContent(): ApiResponse {
  return { statusCode: 204, headers: corsHeaders(), body: '' };
}

/**
 * Map an error to a response, and log what happened.
 *
 * ── The Postgres codes, mapped explicitly ─────────────────────────────────
 *
 * PostgREST turned a `PTxxx` SQLSTATE into HTTP status xxx automatically, which
 * is why the RPCs raise the codes they do. There is no PostgREST here, so this
 * function does that translation on purpose. The codes did not change; what
 * changed is that something has to translate them, and if this function is
 * wrong the client's `isStaleCardError` silently stops matching.
 *
 * Anything unrecognised is a 500 with a generic message. The real error goes to
 * the log, never to the client: a Postgres error string names tables, columns
 * and constraints, and the client has no use for any of it.
 */
interface ZodLikeError {
  issues: { path: (string | number)[]; message: string }[];
}

function isZodError(error: unknown): error is ZodLikeError {
  const issues = (error as { issues?: unknown } | null)?.issues;
  return (
    Array.isArray(issues) &&
    issues.every(
      issue =>
        typeof issue === 'object' &&
        issue !== null &&
        Array.isArray((issue as { path?: unknown }).path) &&
        typeof (issue as { message?: unknown }).message === 'string',
    )
  );
}

export function errorResponse(error: unknown, requestId: string, userId?: string): ApiResponse {
  const log = (level: string, fields: Record<string, unknown>) =>
    console.error(JSON.stringify({ level, requestId, userId, ...fields }));

  if (error instanceof ApiError) {
    log('warn', { msg: error.message, status: error.status, code: error.code });
    return json(error.status, { error: error.message, code: error.code });
  }

  // A Zod failure is a bad request, not a server fault. Detected structurally
  // rather than with `instanceof ZodError`, so this stays correct if the API
  // bundle and the client ever resolve different copies of zod — which
  // `instanceof` across module instances does not survive.
  if (isZodError(error)) {
    log('warn', { msg: 'validation failed', issues: error.issues });
    return json(400, {
      error: 'The request was not valid.',
      // Field paths, so the client can attach the message to an input. The
      // messages come from the shared schemas, which is why they read like
      // something a person wrote.
      issues: error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const code = pgErrorCode(error);
  switch (code) {
    case PG_ERROR.notFound:
      // Not found, or not yours. Deliberately indistinguishable.
      log('warn', { msg: 'not found', code });
      return json(404, { error: 'Not found.', code });
    case PG_ERROR.staleCard:
      log('warn', { msg: 'stale card', code });
      return json(409, {
        error: 'This card was already rated somewhere else.',
        code,
      });
    case PG_ERROR.appendOnly:
      log('warn', { msg: 'append-only violation', code });
      return json(403, { error: 'Reviews cannot be rewritten.', code });
    case PG_ERROR.invalidInput:
      log('warn', { msg: 'invalid input', code });
      return json(400, { error: 'The request was not valid.', code });
    default:
      break;
  }

  log('error', {
    msg: 'unhandled error',
    code,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return json(500, { error: 'Something went wrong.' });
}

/**
 * Structured request logging, into the log groups P8's retention config
 * already covers.
 *
 * `userId` is included deliberately. It is a Cognito `sub` — an opaque uuid,
 * not an email — and it is the only way to answer "which account saw this
 * error" now that the database no longer refuses the wrong one for us.
 */
export function logRequest(
  event: ApiEvent,
  fields: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level: 'info',
      requestId: event.requestContext.requestId,
      method: event.requestContext.http.method,
      path: event.requestContext.http.path,
      ...fields,
    }),
  );
}
