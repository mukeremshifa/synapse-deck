import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { RouteErrorBoundary } from './ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage';
import { LoginPage, SignupPage } from '@/features/auth/AuthPages';
import { ProtectedRoute, PublicOnlyRoute } from '@/features/auth/ProtectedRoute';
import { NotebookListPage } from '@/features/notebooks/NotebookListPage';

/**
 * The route table, rewritten for the notebook shell (P11).
 *
 * ── What changed, and why the shape of this file changed with it ──────────
 *
 * P6's table was six sibling destinations under one layout, because the product
 * was six activities. P11's top-level object is a **notebook**, so there are now
 * three kinds of route and they want three different frames:
 *
 * 1. **`AppShell`** — the notebook list and settings. A max-width page with a
 *    thin header.
 * 2. **`NotebookPage`** — the three-pane shell. Full-viewport, its own header,
 *    no outer chrome; nesting it inside `AppShell` would put a header above a
 *    header and cost the panes the vertical space they need.
 * 3. **Full-screen routes** — practice, exam, the review gate. Launched *from* a
 *    notebook and owning the screen while they run. These are deliberately not
 *    children of the notebook layout: a timed exam inside a 380px rail is a
 *    worse exam (P11 §2), and focus mode needs the viewport.
 *
 * The guard still wraps a layout rather than each leaf, so no route can be added
 * later that quietly skips it — but there are now three guarded groups instead
 * of one, and each `ProtectedRoute` below is load-bearing.
 *
 * ── `/` is no longer public ───────────────────────────────────────────────
 *
 * P7 made `/` a landing page and called it "the one thing in P7 that altered
 * what an anonymous request can reach". P11 reverses that: the marketing page is
 * gone (P11 §4), and `/` now redirects to the notebook list, which is guarded.
 * A signed-out visitor to `/` lands on `/login`. This is a deliberate product
 * change, not an oversight — recorded in P11 §8.
 *
 * ── What is eager ─────────────────────────────────────────────────────────
 *
 * The auth pages and the notebook list. That is the whole of what a user needs
 * to see something real after signing in. Everything else is behind
 * `React.lazy`: the notebook shell and its panes, the generation pipeline and
 * its schemas, `ts-fsrs`, the exam engine and its timer.
 */

const NotebookPage = lazy(() =>
  import('@/features/notebooks/NotebookPage').then(module => ({
    default: module.NotebookPage,
  })),
);
const NotebookCardsPage = lazy(() =>
  import('@/features/notebooks/NotebookCardsPage').then(module => ({
    default: module.NotebookCardsPage,
  })),
);
const CreateFromTextPage = lazy(() =>
  import('@/features/generate/CreateFromTextPage').then(module => ({
    default: module.CreateFromTextPage,
  })),
);
const CreateFromDocumentPage = lazy(() =>
  import('@/features/generate/CreateFromDocumentPage').then(module => ({
    default: module.CreateFromDocumentPage,
  })),
);
const ReviewGatePage = lazy(() =>
  import('@/features/generate/ReviewGatePage').then(module => ({
    default: module.ReviewGatePage,
  })),
);
const PracticePage = lazy(() =>
  import('@/features/practice/PracticePage').then(module => ({
    default: module.PracticePage,
  })),
);
const ExamPage = lazy(() =>
  import('@/features/exam/ExamPage').then(module => ({
    default: module.ExamPage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(module => ({
    default: module.SettingsPage,
  })),
);

/** Page-shaped, so the layout does not jump when the real page arrives. */
function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * The fallback for routes that own the viewport. A blank of the right height
 * rather than the skeleton above, which is sized for the inside of `AppShell`
 * and would draw three grey bars where a full-screen header is about to be.
 */
function FullScreen({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-dvh" />}>{children}</Suspense>;
}

/**
 * The frame for routes that own the viewport. It contributes no chrome of its
 * own — it exists so the guard and the Suspense boundary are declared once
 * rather than repeated on each of the five routes beneath it.
 */
function FullScreenOutlet() {
  return (
    <FullScreen>
      <RouteErrorBoundary>
        <Outlet />
      </RouteErrorBoundary>
    </FullScreen>
  );
}

/**
 * `/decks/:id` → `/notebooks/:id`. The ids are the same — the rename never
 * crossed the wire (`src/lib/notebooks.ts`), so an old deck link addresses a
 * notebook correctly and only the noun in the path has to change.
 */
function LegacyDeckRedirect() {
  const { notebookId } = useParams<{ notebookId: string }>();
  return <Navigate replace to={notebookId ? `/notebooks/${notebookId}` : '/notebooks'} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/notebooks" />} />

      {/* ── The list and settings, inside the page shell ─────────────────── */}
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="notebooks" element={<NotebookListPage />} />
        <Route
          path="notebooks/:notebookId/cards"
          element={
            <Lazy>
              <NotebookCardsPage />
            </Lazy>
          }
        />
        <Route
          path="settings"
          element={
            <Lazy>
              <SettingsPage />
            </Lazy>
          }
        />
        <Route path="account" element={<Navigate replace to="/settings" />} />
      </Route>

      {/* ── The notebook itself: three panes, no outer chrome ────────────── */}
      <Route
        path="notebooks/:notebookId"
        element={
          <ProtectedRoute>
            <FullScreen>
              <NotebookPage />
            </FullScreen>
          </ProtectedRoute>
        }
      />

      {/* ── Full-screen routes launched from a notebook ──────────────────── */}
      <Route
        element={
          <ProtectedRoute>
            <FullScreenOutlet />
          </ProtectedRoute>
        }
      >
        <Route path="notebooks/:notebookId/practice" element={<PracticePage />} />
        <Route path="notebooks/:notebookId/exam" element={<ExamPage />} />

        {/*
          Generation and the review gate. The gate's path keeps `:deckId`
          rather than `:notebookId`, because it is the one route the pipeline's
          own code constructs and P10-SESSION-4 protects that contract. See
          `notebookPath.gate`.
        */}
        <Route path="create/text" element={<CreateFromTextPage />} />
        <Route path="create/document" element={<CreateFromDocumentPage />} />
        <Route path="create/review/:deckId" element={<ReviewGatePage />} />
      </Route>

      {/* ── Public ───────────────────────────────────────────────────────── */}
      <Route
        path="login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="signup"
        element={
          <PublicOnlyRoute>
            <SignupPage />
          </PublicOnlyRoute>
        }
      />
      <Route path="auth/callback" element={<AuthCallbackPage />} />

      {/* Old paths, kept as redirects. A bookmark or a link in the owner's
          notes should not 404 because the nouns changed. */}
      <Route path="dashboard" element={<Navigate replace to="/notebooks" />} />
      <Route path="decks" element={<Navigate replace to="/notebooks" />} />
      <Route path="decks/:notebookId" element={<LegacyDeckRedirect />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
