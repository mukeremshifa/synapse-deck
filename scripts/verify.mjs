#!/usr/bin/env node
/**
 * The checkpoint gate. `npm run verify` — what runs before a checkpoint,
 * before asking the owner to merge, and in CI.
 *
 * This is the slow, complete one: typecheck, repo-wide lint, the whole test
 * suite, and a production build. Run it when you are done, not while you work.
 *
 * ── On the test split ──────────────────────────────────────────────────────
 *
 * `vitest run` over all 31 suites takes ~87s. Run in two passes it takes ~57s:
 *
 *   src/test/**  (PGlite: 10 suites boot Postgres-in-WASM)   ~26s
 *   everything else (jsdom components + pure lib units)      ~31s
 *
 * The 30-second difference is contention, not work. Vitest fans suites across
 * workers, so ten PGlite instances compile and boot WASM at the same moment as
 * the jsdom environments are being constructed, and both slow down. Serialising
 * the two groups costs one extra process start and wins back half a minute.
 *
 * `--sequence.concurrent=false` would not fix this: the cost is across worker
 * processes, not within a file.
 */

import { spawnSync } from 'node:child_process';

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const TSC = 'node_modules/typescript/bin/tsc';
const ESLINT = 'node_modules/eslint/bin/eslint.js';
const VITEST = 'node_modules/vitest/vitest.mjs';
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
step('test — db suites (PGlite)', VITEST, ['run', 'src/test']);
step('test — unit + component suites', VITEST, ['run', '--exclude', 'src/test/**']);
step('build', VITE, ['build']);

console.log(`\n✓ verify passed (${elapsed()})`);
