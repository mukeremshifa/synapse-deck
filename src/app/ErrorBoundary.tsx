import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The one failure mode a deployed SPA must not have.
 *
 * An exception anywhere in the tree unmounts everything above it and leaves a
 * white page — indistinguishable, from the outside, from the site being down.
 * React still has no hook for this, so this stays a class component.
 *
 * There is deliberately no reporting service (P4: a third-party script on a page
 * that renders untrusted LLM output is a security decision v1 does not need to
 * make). `reportError` below is the seam where one goes when that changes; today
 * it writes to the console and nothing else.
 *
 * ── What this handles beyond a render throw ───────────────────────────────
 *
 * A render boundary alone was not enough, because two of the three ways this app
 * can go blank never reach `componentDidCatch`:
 *
 * 1. **A lazy chunk that will not load.** Every route in `routes.tsx` is behind
 *    `React.lazy`. When a deploy replaces the hashed chunk a loaded tab is still
 *    pointing at, the import rejects — and "Try again" cannot fix it, because the
 *    URL it would retry is the one that is gone. That case needs a reload, so it
 *    is detected and offered one. See `isChunkLoadError`.
 * 2. **An async throw.** A rejected promise outside render — a bad `await` in an
 *    effect, a queued callback — bypasses the boundary entirely.
 *    `GlobalErrorListener` catches those at the window and routes them here, so
 *    they stop being silent.
 */

/** Set before a chunk-error reload, so it can only happen once per tab. */
const RELOAD_MARK = 'synapsedeck.chunk-reload';

/**
 * A failed dynamic import, as each engine spells it.
 *
 * There is no error code for this and no shared class, so matching is on message
 * text: V8 and JSC word it differently, and Vite prepends its own sentence in
 * dev. The consequence of a false negative is only that the user is offered
 * "Try again" instead of "Reload", so this errs toward matching loosely.
 */
function isChunkLoadError(error: Error): boolean {
  const text = `${error.name}: ${error.message}`;
  return (
    /ChunkLoadError/i.test(text) ||
    /Loading chunk \d+ failed/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(text) ||
    /Importing a module script failed/i.test(text)
  );
}

/**
 * The seam a reporting service drops into later.
 *
 * Deliberately the only place that knows an error happened, so wiring Sentry (or
 * whatever replaces it) means editing this function and nothing else. Keep it
 * total: a throw from inside error handling is how a fallback becomes its own
 * white screen.
 */
function reportError(error: Error, context: Record<string, unknown> = {}) {
  try {
    console.error('[SynapseDeck] Unhandled error:', error, context);
  } catch {
    /* Console can be absent in odd embeddings. Losing the log is survivable. */
  }
}

type FallbackProps = {
  error: Error;
  /** Clears the caught error and re-renders the children. */
  reset: () => void;
};

type Props = {
  children: ReactNode;
  fallback: (props: FallbackProps) => ReactNode;
  /**
   * Changing this clears a caught error.
   *
   * Without it a user who navigates away stays on the fallback forever: the
   * boundary's state survives the route change, so the new page never renders.
   * A `key` on the boundary would also reset it, but it would remount the whole
   * subtree on every navigation — including the auth provider at the root.
   */
  resetKey?: string;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  override componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (error) return this.props.fallback({ error, reset: this.reset });
    return this.props.children;
  }
}

/**
 * The recovery card: what happened, a way to retry, and a way out.
 *
 * A solid card rather than the dashed `EmptyState` this borrowed through P4–P5.
 * An empty state says "there is nothing here yet", which is a normal thing for a
 * page to say; a caught exception is not that, and wearing the same clothes made
 * a real failure look like an unfinished screen. This is the one screen in the
 * app whose entire job is to be reassuring, so P6 built it like a screen that
 * meant to exist.
 *
 * `homeTo` exists because this renders at two depths. Inside `AppLayout` the way
 * out is /dashboard. At the root it must not be: if the layout itself is what
 * threw, /dashboard re-renders the thing that just broke — and for a signed-out
 * visitor it is a protected route, so the offer of a way out is a bounce to
 * /login. The root passes "/".
 */
function ErrorFallback({ error, reset, homeTo }: FallbackProps & { homeTo: string }) {
  const isChunkError = isChunkLoadError(error);

  return (
    <Card className="mx-auto max-w-lg py-8">
      <CardContent className="flex flex-col items-center space-y-4 text-center">
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <TriangleAlert className="size-6" aria-hidden />
        </span>

        <div className="space-y-2">
          <h1 className="font-serif text-2xl tracking-tight">
            {isChunkError ? 'This page needs a reload' : 'Something went wrong'}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {isChunkError
              ? // Almost always a deploy landing under an open tab. Say the cause,
                // because "something went wrong" invites a retry that cannot work.
                'The app was updated while this tab was open, so part of it could no longer be loaded. Reloading picks up the new version.'
              : 'This page hit an unexpected error and stopped rendering. Your decks and your review history are stored server-side — nothing was lost.'}
          </p>
        </div>

        <ErrorDetail error={error} />

        <div className="flex flex-wrap justify-center gap-2 pt-1">
          {isChunkError ? (
            <Button onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden />
              Reload
            </Button>
          ) : (
            <Button onClick={reset}>Try again</Button>
          )}
          <Button variant="outline" asChild>
            <Link to={homeTo}>{homeTo === '/' ? 'Go home' : 'Back to dashboard'}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The message, and the stack behind a disclosure.
 *
 * The stack is collapsed rather than absent because there is no reporting
 * service: when a user hits this, the only way the detail reaches anyone is if
 * the screen itself can produce it. Collapsed keeps the card calm; "Copy"
 * exists so the report is a paste rather than a retyped screenshot.
 */
function ErrorDetail({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false);

  // A component can throw a value that is not an Error, in which case React
  // hands it over as-is and `.stack` is undefined.
  const stack = typeof error.stack === 'string' ? error.stack : null;
  const message = error.message || String(error);

  if (!message && !stack) return null;

  const copy = () => {
    void navigator.clipboard
      ?.writeText([message, stack].filter(Boolean).join('\n\n'))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      // Clipboard is permission-gated and absent over plain http on some
      // browsers. A copy button that silently does nothing is better than an
      // error thrown from inside the error screen.
      .catch(() => undefined);
  };

  return (
    <div className="w-full space-y-2">
      {message && (
        <p className="bg-muted text-muted-foreground w-full rounded-md px-3 py-2 text-left font-mono text-xs break-words">
          {message}
        </p>
      )}

      {stack && (
        <details className="group w-full text-left">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs select-none">
            Technical details
          </summary>
          <pre className="bg-muted text-muted-foreground mt-2 max-h-48 overflow-auto rounded-md px-3 py-2 text-left font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {stack}
          </pre>
          <Button variant="ghost" size="xs" className="mt-2" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </details>
      )}
    </div>
  );
}

/**
 * The boundary as the app uses it: standard fallback, reset on navigation.
 *
 * Must be rendered inside the router — both the reset key and the way out of
 * the fallback are route-based.
 */
export function RouteErrorBoundary({
  children,
  homeTo = '/notebooks',
}: {
  children: ReactNode;
  homeTo?: string;
}) {
  const location = useLocation();
  return (
    <ErrorBoundary
      resetKey={location.pathname}
      fallback={props => <ErrorFallback {...props} homeTo={homeTo} />}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * The errors React never sees.
 *
 * `componentDidCatch` fires for throws during render, and for nothing else. An
 * `await` that rejects in an effect, a `setTimeout` callback that throws, a
 * failed `import()` the router does not own — all of those reach `window` and,
 * without this, are visible only to whoever has DevTools open. That is the exact
 * shape of "the page looks fine but does nothing".
 *
 * **It does not render a fallback.** Promoting an arbitrary rejection to a
 * full-screen error would be wrong: a cancelled fetch would blank a working
 * page. The job here is that the error is *reported* rather than swallowed —
 * with one exception, below, where it is also actionable.
 */
export function GlobalErrorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error ? event.error : new Error(event.message || 'Unknown error');
      reportError(error, { kind: 'window.onerror', source: event.filename, line: event.lineno });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      reportError(error, { kind: 'unhandledrejection' });

      /*
       * The one rejection worth acting on.
       *
       * A lazy route whose chunk has gone rejects here when Suspense retries it
       * outside a render, and the tab is then wedged: every navigation to that
       * route fails the same way, and no boundary ever sees it. A reload is the
       * only fix, so offer it — once per session, because a reload loop against
       * a genuinely broken deploy is worse than the wedge.
       */
      if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_MARK)) {
        try {
          sessionStorage.setItem(RELOAD_MARK, '1');
          window.location.reload();
        } catch {
          /* Private mode can throw on sessionStorage; skip the reload. */
        }
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
