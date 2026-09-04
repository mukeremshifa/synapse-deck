import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The acceptance criterion P7 could not otherwise check: `/` makes **zero**
 * network requests for a visitor with no session.
 *
 * `LandingPage.test.tsx` proves the module graph never reaches `@/lib/queries`
 * or `@/lib/supabase`, which is the rule. This proves the consequence, and it
 * proves it about the whole tree rather than one module — `Providers` still
 * mounts `AuthProvider` above every route, so the honest question is not "does
 * the page import Supabase" but "does anything fire while the page is on
 * screen". A marketing page that opens a socket and 401s in the console is a bad
 * first impression whether the request came from the page or from the shell
 * around it.
 *
 * So: the real client, the real providers, the real route table, with `fetch`
 * and `WebSocket` replaced by spies that fail loudly if they are ever used. The
 * plan said to check this in a network panel; a test says the same thing every
 * time, to whoever changes this next.
 *
 * Everything is imported dynamically because `src/lib/env.ts` reads
 * `import.meta.env` at module scope and throws when it is unset — the stubs
 * below have to be in place before the first import, and static imports hoist
 * above them.
 */

vi.stubEnv('VITE_SUPABASE_URL', 'https://example-project.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_notarealkey0000000000');

const requests: string[] = [];

// Rejecting rather than resolving: a stub that answers politely lets a request
// happen and hides it in a `.then`. This one shows up in both places.
vi.stubGlobal(
  'fetch',
  vi.fn((input: unknown) => {
    requests.push(`fetch ${String(input)}`);
    return Promise.reject(new Error('the landing page must not make a request'));
  }),
);

vi.stubGlobal(
  'WebSocket',
  class {
    constructor(url: string) {
      requests.push(`websocket ${url}`);
      throw new Error('the landing page must not open a socket');
    }
  },
);

vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

const { Providers } = await import('@/app/providers');
const { AppRoutes } = await import('@/app/routes');

beforeEach(() => {
  requests.length = 0;
  localStorage.clear();
  // Providers uses BrowserRouter, so the route under test is jsdom's own URL.
  window.history.pushState({}, '', '/');
});

describe('the front door, for a visitor with no session', () => {
  it('renders the landing page without touching the network', async () => {
    render(
      <Providers>
        <AppRoutes />
      </Providers>,
    );

    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Forgetting is the schedule.' },
        // This test renders the whole router, so the first paint waits on the
        // landing route's lazy chunk. findByRole's 1s default is a timer racing
        // a dynamic import: it passes alone and fails under load, which reads
        // like a broken page rather than a slow one. The assertion is unchanged
        // — only how long it is willing to wait for it.
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    // Let anything the providers scheduled — a deferred session refresh, a
    // realtime connect — have a turn before declaring the page quiet.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(requests, `the landing page made requests:\n${requests.join('\n')}`).toEqual(
      [],
    );
  });
});
