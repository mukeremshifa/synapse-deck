#!/usr/bin/env node
/**
 * The fast gate. `npm run check` — what an agent runs before every commit.
 *
 * Budget: about 25 seconds. That number is the whole design constraint.
 *
 *   tsc -b --noEmit          ~22s   incremental; the second run is far less
 *   eslint <changed files>    ~3s   scoped, because repo-wide eslint is ~39s
 *
 * What it deliberately does NOT run: the test suite (87s), the production build
 * (~30s). Those belong to `npm run verify`, which is a checkpoint gate, not a
 * per-commit one. See docs/AGENTS.md — "Two gates, and why".
 *
 * The scoping is the entire trick. Repo-wide eslint costs more than the
 * typecheck; eslint on the four files a commit touched costs about three
 * seconds. Correctness is not weakened, because `verify` lints everything
 * before anything merges.
 *
 * Flags:
 *   --all     lint the whole repo instead of changed files (what CI uses)
 *   --staged  scope to staged files only (for a pre-commit hook)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const lintAll = args.has('--all');
const stagedOnly = args.has('--staged');

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

/**
 * Run a tool's JS entrypoint on the current Node, streaming output.
 * Returns the exit code.
 *
 * Deliberately not `npx`, and deliberately not the node_modules/.bin shim:
 *   - npx with shell:true concatenates rather than escapes arguments (DEP0190),
 *     and breaks on any path containing a space.
 *   - the .bin/*.cmd shim cannot be spawned without a shell on Windows — Node
 *     rejects it with EINVAL.
 * Resolving the package's own entrypoint and running it with process.execPath
 * sidesteps both, and behaves identically on win32 and POSIX.
 */
function run(entry, cmdArgs) {
  const res = spawnSync(process.execPath, [entry, ...cmdArgs], { stdio: 'inherit' });
  return res.status ?? 1;
}

const TSC = 'node_modules/typescript/bin/tsc';
const ESLINT = 'node_modules/eslint/bin/eslint.js';

/** Files changed vs the merge-base with dev, plus anything uncommitted. */
function changedFiles() {
  const git = (a) => {
    try {
      return execFileSync('git', a, { encoding: 'utf8' }).split('\n');
    } catch {
      return [];
    }
  };

  if (stagedOnly) {
    return git(['diff', '--name-only', '--cached', '--diff-filter=ACMR']);
  }

  // Committed-on-this-branch, plus staged, plus unstaged. A file that appears
  // in more than one is deduped by the Set below.
  let base = '';
  try {
    base = execFileSync('git', ['merge-base', 'HEAD', 'dev'], { encoding: 'utf8' }).trim();
  } catch {
    /* no dev branch, or a fresh repo — fall through to working-tree only */
  }

  return [
    ...(base ? git(['diff', '--name-only', '--diff-filter=ACMR', base]) : []),
    ...git(['diff', '--name-only', '--diff-filter=ACMR']),
    ...git(['diff', '--name-only', '--cached', '--diff-filter=ACMR']),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ];
}

// ── 1. Typecheck ────────────────────────────────────────────────────────────
// Whole-project, always. There is no cheap way to typecheck one file when the
// error you care about is the one your change caused three modules away.
console.log('▸ typecheck');
if (run(TSC, ['-b', '--noEmit']) !== 0) {
  console.error(`\n✗ typecheck failed (${elapsed()})`);
  process.exit(1);
}

// ── 2. Lint ─────────────────────────────────────────────────────────────────
const lintable = (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !f.startsWith('supabase/functions/');

let targets;
if (lintAll) {
  targets = ['.'];
} else {
  targets = [...new Set(changedFiles())].filter((f) => f && lintable(f) && existsSync(f));
}

if (targets.length === 0) {
  console.log('▸ lint — no changed files to lint, skipping');
} else {
  console.log(`▸ lint ${lintAll ? '(whole repo)' : `(${targets.length} changed file(s))`}`);
  // --max-warnings 0 would fail on the four pre-existing react-refresh warnings,
  // so warnings stay visible but non-blocking here. `verify` treats them the same
  // way; if they should block, fix them first and then tighten this in one place.
  if (run(ESLINT, targets) !== 0) {
    console.error(`\n✗ lint failed (${elapsed()})`);
    process.exit(1);
  }
}

console.log(`\n✓ check passed (${elapsed()})`);
