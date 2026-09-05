#!/usr/bin/env node
/**
 * The checkpoint gate. `npm run verify` — run before a checkpoint and in CI.
 *
 * `check` is the everyday gate and covers only what the current change touched.
 * This one covers the whole repo:
 *
 *   typecheck            whole project
 *   lint                 whole repo, not just changed files
 *   build                production build actually succeeds
 *   deno check           the Edge Function, which tsc and eslint both skip
 *
 * ── There are no tests here ────────────────────────────────────────────────
 *
 * The suite was deleted on 2026-09-05 (ADR 0005). Until a new one is written at
 * a checkpoint, nothing in this repo verifies behaviour — these four steps prove
 * the code compiles, lints and builds, and nothing more. A green `verify` means
 * "it builds", not "it works".
 *
 * When the suite comes back, add the step here rather than in `check`; the
 * per-commit gate stays fast on purpose.
 */

import { spawnSync } from 'node:child_process';

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const win32 = process.platform === 'win32';

const TSC = 'node_modules/typescript/bin/tsc';
const ESLINT = 'node_modules/eslint/bin/eslint.js';
const VITE = 'node_modules/vite/bin/vite.js';

// See scripts/check.mjs for why this is process.execPath and not npx.
function step(label, entry, args) {
  console.log(`\n▸ ${label}`);
  const res = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit' });
  if ((res.status ?? 1) !== 0) {
    console.error(`\n✗ ${label} failed (${elapsed()})`);
    process.exit(1);
  }
}

step('typecheck', TSC, ['-b', '--noEmit']);
step('lint (whole repo)', ESLINT, ['.']);
step('build', VITE, ['build']);

/*
 * The Edge Function is Deno, and both tsc and eslint skip it by config — so
 * without this it is the one part of the codebase nothing typechecks. CI failed
 * on exactly that gap while `verify` stayed green locally.
 *
 * Run from supabase/functions so its own deno.json governs: from the repo root
 * Deno finds the app's package.json and then demands a matching node_modules.
 *
 * Probe for Deno rather than inferring absence from a failed run — with
 * shell:true a missing binary returns exit 1 and no `error`, which is
 * indistinguishable from a real type error, so an absent Deno would be reported
 * as a broken Edge Function. Skipped rather than required locally: it is not an
 * npm dependency, and CI installs it and always runs it, which is where the
 * guarantee actually lives.
 */
console.log('\n▸ typecheck edge function (Deno)');

// `deno` on Windows is deno.exe, which spawns directly; passing args with
// shell:true would concatenate rather than escape them (DEP0190). Probing with
// the bare name works on both platforms without a shell.
const denoBin = win32 ? 'deno.exe' : 'deno';
const hasDeno = spawnSync(denoBin, ['--version'], { stdio: 'ignore' }).status === 0;

if (!hasDeno) {
  console.log('  Deno not installed — skipped. CI installs it and runs this on every push.');
  console.log('  To run it here: npm run fn:check');
} else {
  const res = spawnSync(denoBin, ['check', '--frozen', 'generate-cards/index.ts'], {
    cwd: 'supabase/functions',
    stdio: 'inherit',
  });
  if ((res.status ?? 1) !== 0) {
    console.error(`\n✗ typecheck edge function failed (${elapsed()})`);
    process.exit(1);
  }
}

console.log(`\n✓ verify passed (${elapsed()})`);
console.log('  Note: no tests exist. This proves the code builds, not that it works.');
