#!/usr/bin/env node
/**
 * The route-parity check. P10 task 1b.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `scripts/dev-api.mjs` is a hand-maintained mirror of the routes declared in
 * `infra/lib/api-stack.ts`. The local server runs the real handlers against
 * local Postgres, which is what lets this phase be built without deploying RDS
 * — but it means the route table exists twice, in two languages, kept in step
 * by nothing but a convention in the plan.
 *
 * That is the one failure mode this development setup introduces that
 * production does not have: a route added to one file and forgotten in the
 * other works perfectly all through development and 404s the first time it runs
 * behind API Gateway. Weeks later, at the RDS checkpoint, in the least
 * convenient place to be debugging.
 *
 * P10 task 1b called a mechanical check "cheap, and it removes the only failure
 * mode this development setup introduces". This is it. It runs in `verify`, so
 * the drift is caught on the push that creates it rather than at the deploy.
 *
 * ── What it checks, and what it cannot ────────────────────────────────────
 *
 * It compares two sets of `METHOD /path` pairs and fails on any difference in
 * either direction. Paths are normalised to a common form, because the two
 * files spell parameters differently by necessity:
 *
 *     api-stack.ts    /decks/{deckId}/cards      API Gateway's syntax
 *     dev-api.mjs     /^\/decks\/([^/]+)\/cards$/  a JS regex
 *
 * Both normalise to `/decks/{}/cards`, so a renamed path parameter is not
 * reported as drift — the *name* is internal to each file, and dev-api.mjs
 * carries it separately in `params`. What matters is that the same method
 * reaches the same shape of path.
 *
 * **It does not check that a route reaches the same handler.** Both files name
 * a function per route and the names differ by construction (`decksFn` vs
 * `'decks'`), so matching them would encode a mapping that is itself a thing to
 * keep in step. The set of routes is where the bug actually lives.
 *
 * Nor does it check the authorizer. Every route in `api-stack.ts` passes one
 * and there is a comment there saying why it is never omitted; that is a
 * different property and a reader can audit it in one screen.
 */

import { readFile } from 'node:fs/promises';

const STACK = 'infra/lib/api-stack.ts';
const DEV_API = 'scripts/dev-api.mjs';

/** Strip line and block comments, so a commented-out route is not counted. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * `/decks/{deckId}/cards` → `/decks/{}/cards`.
 *
 * The parameter's name is internal to each file, so comparing names would
 * report a rename as drift when nothing about the API changed.
 */
const normaliseStackPath = (path) => path.replace(/\{[^}]+\}/g, '{}');

/**
 * A dev-api regex source → the same normalised form.
 *
 * `/^\/decks\/([^/]+)\/cards$/` → `/decks/{}/cards`. The escaping is mechanical
 * and the shapes in that file are uniform, so this stays a small transform
 * rather than a regex parser.
 */
function normaliseDevApiPattern(source) {
  return source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\(\[\^\/\]\+\)/g, '{}')
    .replace(new RegExp('\\\\/', 'g'), '/');
}

// ---------------------------------------------------------------------------
// infra/lib/api-stack.ts — `route('/path', [HttpMethod.GET, ...], fn, 'Id')`
// ---------------------------------------------------------------------------

async function stackRoutes() {
  const source = stripComments(await readFile(STACK, 'utf8'));
  const routes = new Set();

  // The `route(...)` helper wraps addRoutes and is the only way routes are
  // declared in that file. Matching the helper rather than addRoutes keeps this
  // anchored to one call shape.
  const CALL = /\broute\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*\[([^\]]*)\]/g;

  for (const match of source.matchAll(CALL)) {
    const path = normaliseStackPath(match[2]);
    for (const method of match[3].matchAll(/HttpMethod\.(\w+)/g)) {
      routes.add(`${method[1].toUpperCase()} ${path}`);
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// scripts/dev-api.mjs — `{ method: 'GET', pattern: /^\/x$/, fn: '...' }`
// ---------------------------------------------------------------------------

async function devApiRoutes() {
  const source = stripComments(await readFile(DEV_API, 'utf8'));
  const routes = new Set();

  const ENTRY = new RegExp("\\{\\s*method:\\s*['\\\"`](\\w+)['\\\"`]\\s*,\\s*pattern:\\s*\\/((?:\\\\.|\\[(?:[^\\]]|\\\\.)*\\]|[^\\/\\\\])*)\\/", 'g');

  for (const match of source.matchAll(ENTRY)) {
    routes.add(`${match[1].toUpperCase()} ${normaliseDevApiPattern(match[2])}`);
  }

  return routes;
}

// ---------------------------------------------------------------------------

const stack = await stackRoutes();
const devApi = await devApiRoutes();

/*
 * A parse that finds nothing is a broken check, not a passing one. If either
 * file is refactored into a shape these patterns do not match, this must fail
 * loudly — a silent zero-versus-zero comparison would pass forever and guard
 * nothing, which is the worst way for a lint to die.
 */
if (stack.size === 0 || devApi.size === 0) {
  console.error('✗ route parity: parsed no routes.');
  console.error(`  ${STACK}: ${stack.size}`);
  console.error(`  ${DEV_API}: ${devApi.size}`);
  console.error('\n  One of these files changed shape. Fix the patterns in this script —');
  console.error('  a check that parses nothing passes everything.');
  process.exit(1);
}

const missingFromDevApi = [...stack].filter((r) => !devApi.has(r)).sort();
const missingFromStack = [...devApi].filter((r) => !stack.has(r)).sort();

if (missingFromDevApi.length === 0 && missingFromStack.length === 0) {
  console.log(`✓ route parity: ${stack.size} routes, identical in both files.`);
  process.exit(0);
}

console.error('✗ route parity: the two route tables have drifted.\n');

if (missingFromDevApi.length > 0) {
  console.error(`  In ${STACK} but not ${DEV_API}:`);
  for (const route of missingFromDevApi) console.error(`    ${route}`);
  console.error('');
  console.error('  These exist in production and 404 locally.\n');
}

if (missingFromStack.length > 0) {
  console.error(`  In ${DEV_API} but not ${STACK}:`);
  for (const route of missingFromStack) console.error(`    ${route}`);
  console.error('');
  console.error('  These work locally and 404 in production — the dangerous direction,');
  console.error('  because nothing here will fail until the API is deployed.\n');
}

console.error('  Add the route to both files, in the same commit (P10 task 1b).');
process.exit(1);
