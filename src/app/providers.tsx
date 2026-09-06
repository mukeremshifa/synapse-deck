import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { GlobalErrorListener, RouteErrorBoundary } from './ErrorBoundary';
import { ThemeProvider } from './theme';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Card and deck data changes only when this user changes it, so refetching
        // on every window focus is wasted traffic. Practice queues are invalidated
        // explicitly after each review instead.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // useState so the client survives Fast Refresh but is never shared across
  // renders of different trees (matters once tests mount this).
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          {/* Errors React never sees — an async throw, a chunk that will not
              load. Renders nothing; it only listens. Outside the boundary on
              purpose, so it keeps listening while the fallback is up. */}
          <GlobalErrorListener />

          {/* The outermost boundary, but still inside the router: it resets on
              navigation, so it needs a location. Everything a render can reach
              is below it.

              `homeTo="/"` because this one catches the layout itself failing:
              offering /dashboard here would re-render what just threw, and for a
              signed-out visitor it is a protected route — a "way out" that
              bounces to /login. */}
          <RouteErrorBoundary homeTo="/">
            {/* Inside the Query client: signing out clears the cache, so one
                account's decks are never left on screen for the next. */}
            <AuthProvider>
              {children}
              <Toaster position="top-center" richColors />
            </AuthProvider>
          </RouteErrorBoundary>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
