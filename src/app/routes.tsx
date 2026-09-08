import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { Placeholder } from './Placeholder';
import { RouteErrorBoundary } from './ErrorBoundary';
import { ModalProvider } from './modals';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage';
import { LoginPage, SignupPage } from '@/features/auth/AuthPages';
import { ProtectedRoute, PublicOnlyRoute } from '@/features/auth/ProtectedRoute';
import { HomePage } from '@/features/home/HomePage';
import { NotebookPage } from '@/features/notebook/NotebookPage';

/**
 * The route table, rewritten for the notebook model (FR2 task 1, brief §3.1).
 *
 * ═══ What changed, and the one rule behind all of it ═════════════════════
 *
 * > **Every screen answers "which notebook?" from the route, never from a
 * > heuristic.** A surface that cannot name its notebook is not a valid
 * > surface. (Brief §1.)
 *
 * P11's table had three top-level frames because the model had no centre:
 * `/home` prompted, `/notebooks` listed, and `/create/*` created — and the
 * dashboard had to *guess* a notebook to prompt about, because nothing in the
 * URL told it. That guess is deleted with this file (see `HomePage`).
 *
 * Four consequences, each a deliberate deletion rather than a move:
 *
 * 1. **One home.** `/home` and `/notebooks` were two views of one list behind
 *    two nav items. `/` is now the only front door.
 * 2. **Every runner names its artifact.** `/notebooks/:id/exam` could only ever
 *    mean "the exam", which is what made an exam open from nowhere. It is now
 *    `/notebooks/:id/exams/:examId`, and "many exams per notebook" is
 *    expressible for the first time.
 * 3. **`/create/*` is gone.** Creating is a modal over the place you already
 *    are (brief §3.2), so the flow that made a *new notebook* when the user
 *    meant to add to an existing one no longer exists to be walked into.
 * 4. **The `/decks/*` redirects are gone.** They dated from a rename two
 *    phases back; the paths they forwarded are themselves now gone, so they
 *    would have been redirects to 404s.
 *
 * ── Three frames, for three kinds of screen ──────────────────────────────
 *
 * 1. **`AppShell`** — home and settings. A page with a thin header.
 * 2. **The notebook** — FR3's three-pane shell. Full-viewport and its own
 *    header, so it is not nested inside `AppShell`: a header above a header
 *    would cost the panes the vertical space they exist for.
 * 3. **Full-screen runners** — practice, quiz, exam, and the note reader.
 *    Launched *from* a notebook and owning the screen while they run. A timed
 *    exam inside a 380px rail is a worse exam.
 *
 * The guard wraps each frame rather than each leaf, so a route added later
 * cannot quietly skip it — each `ProtectedRoute` below is load-bearing.
 *
 * ── Placeholders are finished work here ──────────────────────────────────
 *
 * FR2 creates the routes FR3–FR6 fill. A route that renders `Placeholder` and
 * names the phase that owns it is a *complete* FR2 deliverable (plan §2); a
 * route filled in early is another phase done badly and in the wrong commit.
 * Each one below says which plan builds it.
 *
 * **FR3 has since filled `/notebooks/:notebookId`** with the three-pane shell.
 * The overview, the quiz runner and the note reader are still placeholders and
 * still name their phase.
 *
 * ── Two data stacks, on purpose, until FR6 ───────────────────────────────
 *
 * `HomePage` was the first screen on FR0's contract (`@/lib/api`), and **FR3
 * added the notebook**. Every screen still routed to below — settings, the
 * runners — remains on the old `src/lib/queries.ts` stack until the phase that
 * owns it re-points it. That split is recorded in FR2 §1c and the drift log;
 * the route table is the seam.
 */

const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(module => ({
    default: module.SettingsPage,
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

/** Page-shaped, so the layout does not jump when the real page arrives. */
function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-gutter">
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
 * rather than repeated on each runner.
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

/* ── The screens FR5–FR6 replace ──────────────────────────────────────── */

/** `/notebooks/:notebookId/overview` — FR6's centre. */
function OverviewRoute() {
  const { notebookId } = useParams<{ notebookId: string }>();
  return (
    <Placeholder
      title="Overview"
      phase="FR6"
      description="This notebook's artifacts with their provenance, readiness, topic mastery, the review heatmap and the study plan — all scoped to one notebook."
      ids={{ notebookId }}
      backTo={notebookId ? `/notebooks/${notebookId}` : '/'}
      backLabel="Back to the notebook"
    />
  );
}

/** `/notebooks/:notebookId/quizzes/:quizId` — FR5's untimed runner. */
function QuizRoute() {
  const { notebookId, quizId } = useParams<{ notebookId: string; quizId: string }>();
  return (
    <Placeholder
      title="Quiz"
      phase="FR5"
      description="One question per page, revealed when answered, no time limit, resumable."
      ids={{ notebookId, quizId }}
      backTo={notebookId ? `/notebooks/${notebookId}` : '/'}
      backLabel="Back to the notebook"
    />
  );
}

/** `/notebooks/:notebookId/notes/:noteSetId` — FR5's reader. */
function NotesRoute() {
  const { notebookId, noteSetId } = useParams<{
    notebookId: string;
    noteSetId: string;
  }>();
  return (
    <Placeholder
      title="Notes"
      phase="FR5"
      description="The note set's blocks, read and marked read per block so the reader can resume. Editing comes later."
      ids={{ notebookId, noteSetId }}
      backTo={notebookId ? `/notebooks/${notebookId}` : '/'}
      backLabel="Back to the notebook"
    />
  );
}

export function AppRoutes() {
  return (
    <ModalProvider>
      <Routes>
        {/* ── Home and settings, inside the page shell ───────────────────── */}
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          {/*
            Home is eager. It is what `/` resolves to, and lazily loading the
            first screen behind the sign-in would put a spinner where the app's
            content should already be.
          */}
          <Route path="/" element={<HomePage />} />
          <Route
            path="settings"
            element={
              <Lazy>
                <SettingsPage />
              </Lazy>
            }
          />
        </Route>

        {/* ── The notebook: FR3's three panes, no outer chrome ───────────── */}
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

        {/* ── Full-screen surfaces launched from a notebook ──────────────── */}
        <Route
          element={
            <ProtectedRoute>
              <FullScreenOutlet />
            </ProtectedRoute>
          }
        >
          <Route path="notebooks/:notebookId/overview" element={<OverviewRoute />} />
          {/*
            Every runner names its artifact — the deck, quiz or exam it is a
            sitting of. This is the fix for the exam that opened from nowhere,
            and what makes many-per-notebook expressible.
          */}
          <Route
            path="notebooks/:notebookId/decks/:deckId/practice"
            element={<PracticePage />}
          />
          <Route path="notebooks/:notebookId/quizzes/:quizId" element={<QuizRoute />} />
          <Route path="notebooks/:notebookId/exams/:examId" element={<ExamPage />} />
          <Route
            path="notebooks/:notebookId/notes/:noteSetId"
            element={<NotesRoute />}
          />
        </Route>

        {/* ── Public ─────────────────────────────────────────────────────── */}
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

        {/*
          `/home` and `/notebooks` redirect to `/`, and only those two.

          They are kept because they were the app's two nav items until this
          commit — every bookmark and every link in the owner's notes points at
          one of them, and both mean exactly what `/` now means, so the
          redirect is lossless. Recorded in FR2 §6.3.

          `/dashboard`, `/account`, `/decks` and `/create/*` are **not** kept.
          Each was already a redirect to a redirect, or a page whose flow no
          longer exists; forwarding to `/` would tell a user their bookmarked
          "create from document" page still works, which is worse than a 404
          that says plainly it does not.
        */}
        <Route path="home" element={<Navigate replace to="/" />} />
        <Route path="notebooks" element={<Navigate replace to="/" />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ModalProvider>
  );
}
