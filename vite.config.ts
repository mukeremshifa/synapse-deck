import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  /*
   * `global` for a Node library that reached the browser.
   *
   * `amazon-cognito-identity-js@6` (ADR 0007, arriving at P9) depends on
   * `buffer@4`, whose very first statements read `global.TYPED_ARRAY_SUPPORT`.
   * `global` is Node's, not the browser's — so the module throws a
   * `ReferenceError` while it is being *evaluated*, which is before `main.tsx`
   * calls `createRoot`.
   *
   * That timing is the whole reason this is a config fix and not an application
   * one: **no error boundary can catch it.** A boundary is React code, and React
   * has not started. The symptom is a blank page whose only trace is one line in
   * the console — the exact failure `src/app/ErrorBoundary.tsx` exists to prevent
   * and structurally cannot.
   *
   * Aliasing `global` to `globalThis` is the standard remedy and the narrowest
   * one available: a bare identifier substituted at build time, no polyfill
   * bundled, nothing shipped that was not already there.
   *
   * **It has to be declared twice, and both are load-bearing.** The two halves
   * cover different pipelines, and either one alone leaves the app blank:
   *
   *   `define`                          — Rollup, i.e. `vite build`.
   *   `optimizeDeps.esbuildOptions`     — esbuild, i.e. the dev server's
   *                                       pre-bundled dependency cache.
   *
   * `buffer` is a dependency, so in dev it is served from `node_modules/.vite/deps`,
   * which esbuild produced and which top-level `define` never touched. Setting
   * only the first substitutes `global` in the production bundle and leaves
   * `npm run dev` throwing — which is exactly the wrong way round for a bug that
   * shows up while developing.
   *
   * After changing either, restart with `--force`: the dep cache is keyed on
   * config, but a stale cache is precisely what this bug hides behind, so do not
   * trust the hash to have moved on its own.
   *
   * Delete both when Cognito stops pulling in `buffer`. Verify by loading the
   * app with them removed rather than by reading the dependency tree: it is a
   * transitive dependency, so it can return without this file changing.
   */
  define: {
    global: 'globalThis',
  },

  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Vite warns at 500 kB. The eager chunk is past that and is staying there:
    // the vendor floor is measured in docs/plans/P4-ship.md, and there is no
    // size target for this project. A warning nobody is allowed to act on is
    // noise that trains people to skim the build output.
    //
    // This raises the threshold; it does not disable reporting. Run
    // `npm run build` and read the chunk table when the dependency set changes.
    chunkSizeWarningLimit: 2000,
  },
});
