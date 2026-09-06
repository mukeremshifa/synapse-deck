#!/usr/bin/env node
/**
 * The data-access lint. P9 task 11, and the mechanical quarter of what replaced
 * Row Level Security.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Until P9, cross-tenant isolation was a Postgres guarantee: 15 RLS policies,
 * `force row level security`, and a query that forgot `where user_id = …`
 * returned nothing because the database refused. That is gone (ADR 0008). The
 * same forgetful query now returns every user's rows.
 *
 * Four mechanisms compensate, all chosen to fail closed and none depending on a
 * human remembering something. This script is the fourth: it runs in `verify`,
 * on every push, and fails the build on the shapes that make the other three
 * unenforceable.
 *
 * It is a lint in the spirit of the `dangerouslySetInnerHTML` ESLint rule that
 * already guards untrusted card content — crude, mechanical, and worth more
 * than a convention because it runs whether or not anyone remembers it.
 *
 * ── What it checks, and what it cannot ────────────────────────────────────
 *
 * Checks:
 *   1. No SQL **and no DynamoDB call** in `handlers/`. Handlers call the data
 *      layer; the data layer is the only place that reaches a datastore. This is
 *      what makes rule 2 auditable by reading one directory.
 *
 *      DynamoDB was added at P10, when job state stopped being a Postgres table.
 *      The rule is about *where the tenancy boundary is enforced*, not about
 *      which engine enforces it - so a `DynamoDBDocumentClient.send(...)` in a
 *      handler is exactly as wrong as a SELECT, and for the same reason. The
 *      lint had never been taught about it, which is the kind of gap that turns
 *      a rule back into a convention.
 *   2. Every exported function in `data/` takes `userId` as its first parameter.
 *      Not optional, not defaulted — a caller that forgets does not compile.
 *   3. No `user_id` string in a handler. It should only ever appear in the data
 *      layer; in a handler it means the boundary is being reasoned about in the
 *      wrong place, and often that the value came from the request body.
 *
 * **It cannot check that `userId` is actually used in the query.** A function
 * that takes `userId` and ignores it passes every gate in this repository. That
 * is stated in P9's "What went unverified" and it is the honest limit of this
 * approach: the lint checks the *shape* of the code, not its meaning. It makes
 * the boundary legible to a reviewer. It does not make it true.
 *
 * ── The escape hatch ──────────────────────────────────────────────────────
 *
 * `// data-access-lint-disable-next-line <reason>` — the reason is required and
 * must be more than a few characters, because the entire value of an exception
 * is the sentence explaining it. Grep for the marker to audit every one at once.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const API_ROOT = 'services/api/src';
const HANDLERS_DIR = join(API_ROOT, 'handlers');
const DATA_DIR = join(API_ROOT, 'data');

const DISABLE_MARKER = 'data-access-lint-disable-next-line';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tsFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await tsFilesUnder(full)));
    } else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blank out comments and string/template literals before pattern matching.
 *
 * Without this the checks are unusable: every one of them would fire on the
 * comments explaining the rule, and this file's own header would fail the lint
 * it implements. Replacing with spaces rather than deleting keeps every offset
 * intact, so reported line numbers still point at the real line.
 *
 * A hand-rolled scanner rather than a TypeScript parse. The trade is deliberate
 * — the full parser is the correct tool and it costs a dependency plus seconds
 * of `verify` for a check whose value is that it is cheap enough to always run.
 * Being fooled by a pathological string is an acceptable failure mode for a
 * lint that is a backstop, not the primary guarantee.
 */
function stripCommentsAndStrings(source) {
  const out = Array.from(source);
  const n = source.length;
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < n) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
      continue;
    }

    if (two === '/*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? n : end + 2;
      blank(i, end);
      i = end;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j += 1;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, n);
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/** Lines carrying a disable marker, so the NEXT line is exempt. */
function exemptLines(source) {
  const exempt = new Set();
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (!line.includes(DISABLE_MARKER)) return;
    const reason = line.slice(line.indexOf(DISABLE_MARKER) + DISABLE_MARKER.length).trim();
    // A bare marker is a silenced check with no argument behind it, which is
    // exactly what the escape hatch must not become.
    if (reason.length >= 10) exempt.add(index + 2); // 1-based, next line
  });
  return exempt;
}

const violations = [];

function report(file, line, rule, message) {
  violations.push({ file: file.split(sep).join('/'), line, rule, message });
}

// ---------------------------------------------------------------------------
// Rule 1 & 3 — handlers hold no SQL, no DynamoDB call, and no user_id
// ---------------------------------------------------------------------------

/**
 * Bare `\b(select|insert|update|delete)\b` is far too eager — `update` is an
 * ordinary word and a handler legitimately holds `updateDeck(...)`. So each
 * pattern requires the *shape* of a statement: a SELECT with its FROM, an
 * INSERT with its INTO, and so on.
 */
const SQL_PATTERNS = [
  { re: /\bselect\b[\s\S]{0,200}?\bfrom\b/i, what: 'a SELECT statement' },
  { re: /\binsert\s+into\b/i, what: 'an INSERT statement' },
  { re: /\bupdate\b\s+[\w."]+\s+\bset\b/i, what: 'an UPDATE statement' },
  { re: /\bdelete\s+from\b/i, what: 'a DELETE statement' },
  // The query-builder and raw-client calls. `client.query(` is how `pg` runs
  // anything at all, so its presence in a handler means SQL is being issued
  // there regardless of how the string was assembled.
  { re: /\b(?:client|pool|db|tx|conn)\s*\.\s*query\s*\(/i, what: 'a database query call' },
  { re: /\bsql\s*`/, what: 'a SQL template tag' },
  { re: /\.\s*from\s*\(\s*['"`]/, what: 'a query-builder call' },
  // ── DynamoDB, added at P10 ───────────────────────────────────────────────
  //
  // The client constructors are unambiguous: their presence in a handler means
  // that handler is talking to DynamoDB directly.
  {
    re: /\b(?:DynamoDBClient|DynamoDBDocumentClient)\b/,
    what: 'a DynamoDB client',
  },
  // The command classes, which is what a handler would reach for even if it
  // somehow obtained a client from elsewhere.
  {
    re: /\bnew\s+(?:Get|Put|Update|Delete|Query|Scan|BatchGet|BatchWrite|TransactGet|TransactWrite)(?:Item)?Command\b/,
    what: 'a DynamoDB command',
  },
  // `.send(` is the SDK's universal dispatch call - the DynamoDB equivalent of
  // `client.query(`. Deliberately narrower than a bare `send(`: an unqualified
  // `send(...)` is an ordinary word a handler may legitimately use (an email, a
  // message, a response), and a lint that fires on it would be disabled rather
  // than obeyed. Requiring the receiver keeps it specific to an SDK client
  // without needing to know that client's variable name.
  {
    re: /\b(?:client|ddb|dynamo|docClient|documentClient)\s*(?:\(\s*\))?\s*\.\s*send\s*\(/i,
    what: 'an AWS SDK client send() call',
  },
];

async function checkHandlers() {
  for (const file of await tsFilesUnder(HANDLERS_DIR)) {
    const raw = await readFile(file, 'utf8');
    const exempt = exemptLines(raw);
    const code = stripCommentsAndStrings(raw);

    // SQL is matched against the ORIGINAL text, not the stripped copy: SQL in a
    // handler almost always lives inside a string literal, which is precisely
    // what stripping removes. Comments are still excluded, so prose about a
    // query does not trip it.
    const withoutComments = raw
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

    withoutComments.split('\n').forEach((line, index) => {
      const lineNo = index + 1;
      if (exempt.has(lineNo)) return;

      for (const { re, what } of SQL_PATTERNS) {
        if (re.test(line)) {
          report(
            file,
            lineNo,
            'no-datastore-in-handlers',
            `${what} in a handler. Handlers call ${DATA_DIR.split(sep).join('/')}; ` +
              'only the data layer reaches a datastore. This holds for DynamoDB ' +
              'exactly as it does for SQL (P10) - the rule is about where the ' +
              'tenancy boundary lives, not which engine sits behind it.',
          );
          break;
        }
      }
    });

    // `user_id` (snake_case, the column name) belongs to the data layer. The
    // camelCase `userId` is the handler's own variable and is expected.
    // Checked against the stripped copy so the rule's own documentation does
    // not trip it.
    code.split('\n').forEach((line, index) => {
      const lineNo = index + 1;
      if (exempt.has(lineNo)) return;
      if (/\buser_id\b/.test(line)) {
        report(
          file,
          lineNo,
          'no-user-id-in-handlers',
          "`user_id` is a database column and belongs in the data layer. A handler " +
            'should read `sub` from the authorizer and pass `userId` down.',
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Rule 2 — every exported function in data/ takes userId first
// ---------------------------------------------------------------------------

/**
 * Matches `export function f(`, `export async function f(`, and the
 * `export const f = async (` / `= (` arrow forms, capturing the name and
 * everything up to the matching close paren.
 */
const EXPORTED_FN = new RegExp(
  [
    // export [async] function name(
    String.raw`export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>)?\s*\(`,
    // export const name = [async] ( ... ) =>
    String.raw`export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^(]*>)?\s*\(`,
  ].join('|'),
  'g',
);

/** Read a balanced parameter list starting at the char after `(`. */
function readParams(source, start) {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    i += 1;
  }
  return source.slice(start, i - 1);
}

/**
 * The first parameter's name, with its type annotation and any destructuring
 * stripped. Returns null for an empty list.
 */
function firstParamName(params) {
  const trimmed = params.trim();
  if (trimmed === '') return null;

  // Split on the first top-level comma.
  let depth = 0;
  let end = trimmed.length;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    else if (ch === ',' && depth === 0) {
      end = i;
      break;
    }
  }

  const first = trimmed.slice(0, end).trim();
  // Strip a type annotation, a default, a rest marker, and the optional `?`.
  //
  // The `?` matters: without stripping it, `userId?: string` is reported as a
  // parameter *named* `userId?` and therefore as the wrong-name violation,
  // which sends the reader looking for a renamed parameter instead of the real
  // problem. It is the more specific `userid-not-optional` rule's job, and that
  // rule only gets a chance to run if the name matches first.
  return first
    .split(':')[0]
    .split('=')[0]
    .replace(/^\.\.\./, '')
    .replace(/\?\s*$/, '')
    .trim();
}

async function checkDataLayer() {
  for (const file of await tsFilesUnder(DATA_DIR)) {
    const raw = await readFile(file, 'utf8');
    const exempt = exemptLines(raw);
    const code = stripCommentsAndStrings(raw);

    EXPORTED_FN.lastIndex = 0;
    let match;
    while ((match = EXPORTED_FN.exec(code)) !== null) {
      const name = match[1] ?? match[2];
      const lineNo = code.slice(0, match.index).split('\n').length;
      if (exempt.has(lineNo)) continue;

      const params = readParams(code, EXPORTED_FN.lastIndex);
      const first = firstParamName(params);

      if (first === null) {
        report(
          file,
          lineNo,
          'userid-first-param',
          `Exported \`${name}()\` takes no parameters. Every data-access export ` +
            'must take `userId` first, so a caller that forgets does not compile.',
        );
        continue;
      }

      if (first !== 'userId') {
        report(
          file,
          lineNo,
          'userid-first-param',
          `Exported \`${name}()\` takes \`${first}\` first; it must be \`userId\`. ` +
            'This is what makes the ownership check auditable by reading one directory.',
        );
        continue;
      }

      // `userId?: string` or `userId = something` reintroduces exactly the
      // silent failure the rule exists to prevent: a default is how a bug
      // stops being a compile error.
      const firstRaw = params.split(',')[0] ?? '';
      if (/userId\s*\?/.test(firstRaw)) {
        report(
          file,
          lineNo,
          'userid-not-optional',
          `Exported \`${name}()\` has \`userId\` optional. It must be required — ` +
            'an optional owner is not an owner.',
        );
      }
      if (/userId[^,]*=[^,]*/.test(firstRaw)) {
        report(
          file,
          lineNo,
          'userid-no-default',
          `Exported \`${name}()\` gives \`userId\` a default. A default is how a ` +
            'bug becomes silent.',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Both directories arrive over the course of P9 (tasks 5 and 7). Until then
  // there is nothing to lint, and that is reported rather than passed over in
  // silence — a lint that quietly checks nothing is worse than no lint, because
  // it reads as a guarantee in `verify`'s output.
  const present = [HANDLERS_DIR, DATA_DIR].filter((d) => existsSync(d));
  if (present.length === 0) {
    console.log(
      `  ${API_ROOT}/{handlers,data} do not exist yet — nothing to check.\n` +
        '  (P9 tasks 5 and 7 create them. This lint is wired up in advance so it ' +
        'cannot be forgotten.)',
    );
    return;
  }

  await checkHandlers();
  await checkDataLayer();

  if (violations.length === 0) {
    console.log(`  ✓ data-access rules hold across ${present.length} directory/ies.`);
    return;
  }

  console.error(
    `\n  ${violations.length} data-access violation(s). These are the rules that ` +
      'replaced RLS (ADR 0008):\n',
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    [${v.rule}] ${v.message}\n`);
  }
  console.error(
    `  If one is genuinely wrong, exempt the line with:\n` +
      `    // ${DISABLE_MARKER} <why, in a sentence>\n`,
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(`\n✗ check-data-access crashed: ${error?.stack ?? error}`);
  process.exit(1);
});
