import type { ApiClient } from './contract';
import { env } from '../env';
import { fakeClient, configure, currentConfig, reset } from './fake';
import { liveClient } from './client';

/**
 * Which implementation the app talks to.
 *
 * `VITE_API_MODE` picks: `'fake'` (default) or `'live'`. Components talk to
 * TanStack Query hooks, hooks talk to `api`, and `api` is one of these two.
 * Switching backends is an env var and a reload.
 *
 * **The default is `fake`, deliberately.** A fresh clone has no AWS credentials
 * and no Supabase project, and `npm run dev` has to work anyway — that is brief
 * §2.2(3), and it is what lets FR1–FR6 be built without a backend. The AWS
 * variables are required only in `live` mode (`env-schema.ts`), which is the
 * other half of the same change.
 */
export const api: ApiClient = env.VITE_API_MODE === 'live' ? liveClient : fakeClient;

export type { ApiClient } from './contract';
export * from './contract';

/**
 * The fake's controls, re-exported so a dev panel or the console can reach them.
 *
 * They are no-ops in `live` mode by construction — nothing consults `config`
 * there — so importing them unconditionally is safe.
 */
export const fake = { configure, currentConfig, reset };

/**
 * In development, hang the fake's controls off `window` so latency and error
 * states can be dialled from the console without a rebuild:
 *
 *     fakeApi.configure({ latencyMs: 2000 })
 *     fakeApi.configure({ failNext: 'quota_exceeded' })
 *     fakeApi.configure({ failNextJob: { at: 'immediately', code: 'quota_exceeded' } })
 *     fakeApi.reset()
 *
 * **This is how an error surface gets looked at rather than reasoned about**,
 * which is the entire argument for a typed fake over `json-server` (brief
 * §2.2(2)). Guarded by `import.meta.env.DEV`, so it is absent from a build.
 *
 * The `typeof window` check is not defensive padding: this module is imported
 * by everything, and without it any context with no DOM — an SSR pass, a
 * prerender, a node script that loads the module graph to check it boots —
 * throws `window is not defined` on import. Found exactly that way.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.defineProperty(window, 'fakeApi', {
    value: fake,
    writable: false,
    configurable: true,
  });
}
