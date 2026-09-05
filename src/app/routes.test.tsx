import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeProvider } from './theme';

vi.stubEnv('VITE_SUPABASE_URL', 'https://example-project.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_notarealkey0000000000');

// The route table as text, so the specifiers under test are the ones that ship.
import routesSource from './routes.tsx?raw';

// The route table reaches AuthProvider, which reaches the Supabase client, which
// refuses to construct without real env values. `session` is mutable because the
// answer to "what is at `/`?" depends on it, and that is the P7 question.
const auth = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: auth.session }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

// The only query hook reachable in these renders is AccountMenu's. Stubbed so a
// route test is not also a test of TanStack Query against a mock client.
vi.mock('@/lib/queries', () => ({
  useProfile: () => ({ data: null }),
}));

// Where a signed-in visitor to `/` has to end up. Stubbed because the real page
// fetches decks, due counts and history; the destination is what is under test.
// The text is deliberately not "Dashboard" — AppLayout's nav already contains
// that word, and matching it would prove only that the shell rendered.
vi.mock('@/features/decks/DashboardPage', () => ({
  DashboardPage: () => <p>Dashboard stand-in</p>,
}));

const { AppRoutes } = await import('./routes');

/** jsdom has no matchMedia; ThemeProvider reads it on first render. */
function stubMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.session = null;
  localStorage.clear();
  stubMatchMedia();
});

describe('the route table', () => {
  it('answers an unknown path with the 404 page', () => {
    renderAt('/decks/../nope');

    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument();
  });

  /**
   * P7 moved `/` out of the guarded layout. Before it, the index route was a
   * `<Navigate>` inside `ProtectedRoute`, so the front door was private: a
   * stranger asking for the site was redirected to /dashboard and bounced
   * straight on to /login, and the login card was the entire pitch.
   */
  it('shows a visitor with no session the landing page, not a redirect', async () => {
    renderAt('/');

    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Forgetting is the schedule.' },
        // Waits on the landing route's lazy chunk; see the note in
        // landing-requests.test.tsx. 1s is a timer racing a dynamic import.
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    // Not the login form: that bounce is the exact failure P7 exists to remove.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  /**
   * The mirror image, and the reason `/` is under `PublicOnlyRoute` rather than
   * simply unguarded: somebody with a session who types the bare domain wants
   * their due queue, not a pitch for a product they already use.
   */
  it('sends a visitor with a session from `/` to the app', async () => {
    auth.session = { user: { id: 'user-1' } };

    renderAt('/');

    expect(
      await screen.findByText('Dashboard stand-in', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Forgetting is the schedule.')).not.toBeInTheDocument();
  });

  /**
   * A lazy route's import path is not checked by the compiler in any way a user
   * feels: it fails at runtime, in a chunk nobody loads until they click. This
   * reads the specifiers out of routes.tsx itself rather than repeating them, so
   * a renamed page cannot pass by being renamed in two places at once.
   */
  it('resolves every lazily imported page', async () => {
    const lazyImports = [
      ...routesSource.matchAll(/import\('(@\/[^']+)'\)[^;]*?default: module\.(\w+),/g),
    ].flatMap(([, specifier, exportName]) =>
      specifier && exportName ? [{ specifier, exportName }] : [],
    );

    // Six split routes at P4 task 4, seven since P7 made the landing page lazy.
    // A drop to zero would make this test pass by testing nothing, which is the
    // only reason the count is asserted at all — update it, never delete it.
    expect(lazyImports).toHaveLength(7);

    const modules = import.meta.glob<Record<string, unknown>>('/src/features/**/*.tsx');

    for (const { specifier, exportName } of lazyImports) {
      const path = `${specifier.replace('@/', '/src/')}.tsx`;
      const load = modules[path];
      expect(load, `${specifier} does not resolve to a file`).toBeDefined();

      const module = await load!();
      expect(module[exportName], `${specifier} has no export ${exportName}`).toBeTypeOf(
        'function',
      );
    }
  });
});
