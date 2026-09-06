#!/usr/bin/env node
/**
 * The API, served locally — API Gateway's job, done by `node:http`.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * P9's `SynapseDeck-Api-dev` stack cannot be deployed independently: its
 * Lambdas join the VPC and take the database by reference, so `cdk deploy` on
 * it creates `AWS::RDS::DBInstance` too. RDS is the only billable line in the
 * whole phase (~$14/mo), and the owner's credits are reserved for the Bedrock
 * work in Phase B — so the database stays local until the AI pipeline actually
 * needs one.
 *
 * This server closes that gap. It runs **the real handlers**, unmodified,
 * against the real local Postgres, so everything except API Gateway itself is
 * the production code path:
 *
 *     browser → this server → services/api/src/handlers/* → local Postgres
 *     browser → API Gateway → the same handlers          → RDS
 *
 * ── What it fakes, and what it does not ───────────────────────────────────
 *
 * **It does not fake the token.** The `Authorization` header is a real Cognito
 * access token from the real deployed user pool, and it is verified here
 * against the pool's real JWKS — signature, issuer, audience, expiry, and
 * `token_use`. That is the same set of checks API Gateway's JWT authorizer
 * performs, which is what makes a signup through the app a genuine test of
 * identity rather than a stub.
 *
 * What it does fake is the *plumbing*: route matching and path parameters,
 * which API Gateway would otherwise supply. Those are declared once in ROUTES
 * below and must be kept in step with `infra/lib/api-stack.ts` by hand — a
 * divergence there is the one class of bug this server cannot catch, and the
 * reason it is a development tool rather than a second implementation.
 *
 * **Never deploy this.** It is not a Lambda, it holds no VPC, and it exists
 * only so the phase can be finished without spending credits on an idle
 * database.
 *
 *     npm run dev:api
 */

import { createServer } from 'node:http';
import { createVerify, createPublicKey } from 'node:crypto';

const PORT = Number(process.env['DEV_API_PORT'] ?? 8787);

// Local Postgres, matching what services/api/src/lib/db.ts reads.
process.env['PGHOST'] ??= 'localhost';
process.env['PGPORT'] ??= '5432';
process.env['PGDATABASE'] ??= 'synapsedeck';
process.env['PGUSER'] ??= 'synapsedeck_app';
process.env['CORS_ORIGIN'] ??= 'http://localhost:5173';

/*
 * The three seams, and what the demo path needs from them (DS1).
 *
 * Nothing is defaulted here on purpose. Each resolver throws a sentence naming
 * itself when its variable is missing, which is a better failure than a default
 * that quietly picks the wrong implementation -- a job written to one store and
 * polled from the other reports 404 forever, and the cause is nowhere near the
 * symptom.
 *
 * For the demo path, .env.local sets:
 *
 *     CARD_PROVIDER=groq       GROQ_API_KEY, GROQ_MODEL
 *     JOB_STORE=postgres       the PG* block -- Neon or local
 *     PIPELINE_RUNNER=local    no further configuration
 *     UPLOAD_STORE=local       UPLOAD_DIR, optional
 *
 * For the AWS path, JOB_TABLE_NAME and UPLOAD_BUCKET_NAME must name real
 * resources: there is no local DynamoDB and nothing here signs S3 requests but
 * the AWS SDK reading the caller's own credentials.
 *
 * (No assignment here: .env.local is loaded just below, and setting these there
 * is all that is needed.)

/*
 * The password comes from .env.local as LOCAL_PGPASSWORD rather than
 * PGPASSWORD, so that loading that file does not silently repoint every
 * other psql and pg tool in the shell at this one database. Bridged here
 * because this is where the rest of the local connection defaults live, and
 * because `pg` only reads the standard name.
 *
 * A PGPASSWORD already in the environment wins, which is what makes pointing
 * this server at a different database a matter of exporting one variable.
 */
if (process.env['LOCAL_PGPASSWORD']) process.env['PGPASSWORD'] ??= process.env['LOCAL_PGPASSWORD'];

const USER_POOL_ID = process.env['VITE_COGNITO_USER_POOL_ID'];
const CLIENT_ID = process.env['VITE_COGNITO_CLIENT_ID'];
const REGION = USER_POOL_ID?.split('_')[0] ?? 'us-east-1';

if (!USER_POOL_ID || !CLIENT_ID) {
  console.error(
    '✗ VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID must be set.\n' +
      '  They are in .env.local; run this through `npm run dev:api`, which loads it.',
  );
  process.exit(1);
}

const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

// ---------------------------------------------------------------------------
// Token verification — what API Gateway's JWT authorizer does
// ---------------------------------------------------------------------------

/**
 * The pool's public keys, fetched once and cached.
 *
 * Cognito rotates these rarely and publishes both keys across a rotation, so a
 * process-lifetime cache is correct for a dev server. A Lambda authorizer would
 * do the same; API Gateway's native one caches for us.
 */
let jwksPromise;
function getJwks() {
  jwksPromise ??= fetch(`${ISSUER}/.well-known/jwks.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`JWKS fetch failed: ${r.status}`);
      return r.json();
    })
    .then((j) => new Map(j.keys.map((k) => [k.kid, k])));
  return jwksPromise;
}

const b64urlToBuf = (s) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify an RS256 JWT against the pool's JWKS.
 *
 * Hand-rolled rather than pulling in `aws-jwt-verify`, for one reason: this is
 * a dev-only script and `node:crypto` can already import a JWK directly, so the
 * whole verification is ~30 lines with no dependency. The checks below are
 * deliberately the same ones API Gateway performs — dropping any of them would
 * make local development pass where production fails.
 */
async function verifyToken(token) {
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) throw new Error('malformed token');

  const header = JSON.parse(b64urlToBuf(headerB64).toString('utf8'));
  const payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));

  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg}`);

  const jwk = (await getJwks()).get(header.kid);
  if (!jwk) throw new Error('unknown key id');

  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(key, b64urlToBuf(signatureB64))) {
    throw new Error('bad signature');
  }

  if (payload.iss !== ISSUER) throw new Error('wrong issuer');
  if (payload.exp * 1000 < Date.now()) throw new Error('token expired');
  // An access token carries `client_id`; an id token carries `aud`. The
  // authorizer is configured against the access token, so accept that shape and
  // say so rather than quietly taking either.
  if (payload.token_use !== 'access') throw new Error('not an access token');
  if (payload.client_id !== CLIENT_ID) throw new Error('wrong client id');

  return payload;
}

// ---------------------------------------------------------------------------
// Routes — mirroring infra/lib/api-stack.ts
// ---------------------------------------------------------------------------

/*
 * Every handler the route table names.
 *
 * `jobs` and `uploads` were declared in ROUTES from P10 and **never imported
 * here**, so every one of those six routes resolved to `undefined` and threw
 * `handlers[route.fn] is not a function` — a 500 with nothing useful in it.
 * The whole ingestion pipeline was unreachable locally for that reason, and it
 * is why nothing in it had ever run before DS1.
 *
 * `scripts/check-routes.mjs` could not see it: that check compares route
 * *tables*, and its header says plainly that it does not check a route reaches
 * a handler. This object is now the thing that must stay complete, so a missing
 * key is worth noticing — hence the assertion below rather than trusting that
 * anyone reads this comment.
 */
const handlers = {
  profile: (await import('../services/api/src/handlers/profile.ts')).handler,
  decks: (await import('../services/api/src/handlers/decks.ts')).handler,
  cards: (await import('../services/api/src/handlers/cards.ts')).handler,
  reviews: (await import('../services/api/src/handlers/reviews.ts')).handler,
  uploads: (await import('../services/api/src/handlers/uploads.ts')).handler,
  jobs: (await import('../services/api/src/handlers/jobs.ts')).handler,
  chat: (await import('../services/api/src/handlers/chat.ts')).handler,
};

/**
 * Ordered, and the order matters exactly as it does in API Gateway: the more
 * specific literal paths are matched before the ones with parameters, so
 * `/cards/accept` never falls into `/cards/{cardId}`.
 */
const ROUTES = [
  { method: 'GET', pattern: /^\/profile$/, fn: 'profile' },
  { method: 'PATCH', pattern: /^\/profile$/, fn: 'profile' },

  { method: 'GET', pattern: /^\/decks$/, fn: 'decks' },
  { method: 'POST', pattern: /^\/decks$/, fn: 'decks' },
  { method: 'POST', pattern: /^\/decks\/([^/]+)\/finish-gate$/, fn: 'decks', params: ['deckId'] },
  // Grounded chat (DS2). `decks`, not `notebooks` -- the P11 rename stops at the
  // frontend adapter. See src/lib/notebooks.ts.
  { method: 'POST', pattern: /^\/decks\/([^/]+)\/ask$/, fn: 'chat', params: ['deckId'] },
  { method: 'GET', pattern: /^\/decks\/([^/]+)\/cards$/, fn: 'cards', params: ['deckId'] },
  { method: 'POST', pattern: /^\/decks\/([^/]+)\/cards$/, fn: 'cards', params: ['deckId'] },
  { method: 'GET', pattern: /^\/decks\/([^/]+)$/, fn: 'decks', params: ['deckId'] },
  { method: 'PATCH', pattern: /^\/decks\/([^/]+)$/, fn: 'decks', params: ['deckId'] },
  { method: 'DELETE', pattern: /^\/decks\/([^/]+)$/, fn: 'decks', params: ['deckId'] },

  { method: 'POST', pattern: /^\/cards\/accept$/, fn: 'cards' },
  { method: 'POST', pattern: /^\/cards\/status$/, fn: 'cards' },
  { method: 'POST', pattern: /^\/cards\/delete$/, fn: 'cards' },
  { method: 'PATCH', pattern: /^\/cards\/([^/]+)$/, fn: 'cards', params: ['cardId'] },

  { method: 'POST', pattern: /^\/uploads$/, fn: 'uploads' },
  // The local upload store's write path (DS1). Reachable only when
  // UPLOAD_STORE=local; with UPLOAD_STORE=s3 the browser PUTs to a presigned
  // URL and never comes here. Declared in infra/lib/api-stack.ts too, so
  // check-routes stays green -- see the comment there for why parity is kept
  // rather than excepted.
  { method: 'PUT', pattern: /^\/uploads\/([^/]+)$/, fn: 'uploads', params: ['objectId'] },

  { method: 'POST', pattern: /^\/jobs$/, fn: 'jobs' },
  { method: 'GET', pattern: /^\/jobs$/, fn: 'jobs' },
  { method: 'GET', pattern: /^\/jobs\/([^/]+)$/, fn: 'jobs', params: ['jobId'] },
  { method: 'GET', pattern: /^\/quota$/, fn: 'jobs' },

  { method: 'GET', pattern: /^\/queue$/, fn: 'reviews' },
  { method: 'GET', pattern: /^\/summary$/, fn: 'reviews' },
  { method: 'POST', pattern: /^\/reviews$/, fn: 'reviews' },
  { method: 'POST', pattern: /^\/reviews\/undo$/, fn: 'reviews' },
];

/*
 * Fail at startup, not at the first request, if a route names a handler that was
 * not imported. That is exactly the bug described above, and it survived for a
 * whole phase because its symptom was a 500 on one route rather than anything
 * visible at boot.
 */
{
  const missing = [...new Set(ROUTES.map((r) => r.fn))].filter((fn) => !handlers[fn]);
  if (missing.length > 0) {
    console.error(
      `✗ ROUTES names ${missing.length} handler(s) that are not imported: ${missing.join(', ')}.
` +
        '  Add them to the `handlers` object above. Every route would 500 otherwise.',
    );
    process.exit(1);
  }
}

const CORS = {
  'access-control-allow-origin': process.env['CORS_ORIGIN'],
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-max-age': '86400',
};

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }

    const route = ROUTES.find(
      (r) => r.method === req.method && r.pattern.test(path),
    );
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: 'No such route.' }));
      return;
    }

    // The token, verified exactly as the authorizer would. A failure here is a
    // 401 before any handler runs — which is also what API Gateway does, so a
    // handler never sees an unauthenticated request in either environment.
    let claims;
    try {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) throw new Error('no bearer token');
      claims = await verifyToken(token);
    } catch (error) {
      console.log(`  401 ${req.method} ${path} — ${error.message}`);
      res.writeHead(401, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: 'Not signed in.' }));
      return;
    }

    /*
     * The raw bytes, decoded the way API Gateway decides to decode them.
     *
     * Gateway base64-encodes a body whose content type it does not consider
     * text and sets `isBase64Encoded`; a JSON or text body arrives as a plain
     * string. Reproducing that here matters for `PUT /uploads/{objectId}`,
     * which is the first route in this project to carry a non-JSON body -- a
     * handler that only ever saw UTF-8 locally would corrupt every binary
     * upload the moment it ran behind Gateway, and the corruption would look
     * like a bad file rather than a bad decode.
     */
    const raw = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const contentType = req.headers['content-type'] ?? '';
    const isText =
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType === '';
    const body = isText ? raw.toString('utf8') : raw.toString('base64');
    const isBase64Encoded = !isText && raw.length > 0;

    const match = route.pattern.exec(path);
    const pathParameters = Object.fromEntries(
      (route.params ?? []).map((name, i) => [name, decodeURIComponent(match[i + 1])]),
    );

    // The API Gateway HTTP API v2 event shape, as the handlers expect it.
    const event = {
      version: '2.0',
      rawPath: path,
      rawQueryString: url.search.replace(/^\?/, ''),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
      ),
      queryStringParameters: Object.fromEntries(url.searchParams),
      pathParameters,
      body: body === '' ? undefined : body,
      isBase64Encoded,
      requestContext: {
        requestId: Math.random().toString(36).slice(2, 10),
        http: { method: req.method, path },
        authorizer: { jwt: { claims, scopes: [] } },
      },
    };

    try {
      const result = await handlers[route.fn](event);
      console.log(`  ${result.statusCode} ${req.method} ${path}`);
      res.writeHead(result.statusCode, { ...result.headers, ...CORS });
      res.end(result.body ?? '');
    } catch (error) {
      // A handler that throws rather than returning is a bug in the handler —
      // every one of them wraps its body in try/catch. Report it loudly.
      console.error(`  500 ${req.method} ${path} — handler threw:`, error);
      res.writeHead(500, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: 'Handler threw.' }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`\n  Local API on http://localhost:${PORT}`);
  console.log(`  Postgres:  ${process.env['PGUSER']}@${process.env['PGHOST']}/${process.env['PGDATABASE']}`);
  console.log(`  Cognito:   ${USER_POOL_ID} (real tokens, verified against live JWKS)`);
  console.log(`  CORS:      ${process.env['CORS_ORIGIN']}`);
  console.log(`\n  Not a Lambda, never deployed. See the header.\n`);
});
