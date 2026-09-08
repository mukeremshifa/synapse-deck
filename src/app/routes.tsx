import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
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
 * ── Every route is built; the placeholders are gone ──────────────────────
 *
 * FR2 created the routes FR3–FR6 would fill, each rendering a `Placeholder`
 * that named the phase owning it. **FR6 filled the last one** — `/overview` —
 * so `Placeholder` has no caller and `src/app/Placeholder.tsx` is deleted with
 * the pattern it served. FR3 filled the notebook, FR5 the four runners.
 *
 * ── One data stack, finally ──────────────────────────────────────────────
 *
 * The app ran on two at once from FR2 to FR6, and the route table was the seam:
 * `HomePage` was the first screen on FR0's contract, FR3 added the notebook,
 * FR5 the runners, and **FR6 re-pointed the last of it** — `useProfile`, now
 * `src/features/settings/queries.ts`. `src/lib/queries.ts` is deleted and
 * everything below speaks to `@/lib/api`. `src/lib/api-client.ts` **survives**:
 * FR5's handoff expected it to die here, but it is the HTTP transport
 * `src/lib/api/client.ts` sits on, not part of the old query stack.
 */

const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(module => ({
    default: module.SettingsPage,
  })),
);
const PracticePage = lazy(() =>
  import('@/features/study/PracticePage').then(module => ({
    default: module.PracticePage,
  })),
);
const ExamPage = lazy(() =>
  import('@/features/study/ExamPage').then(module => ({
    default: module.ExamPage,
  })),
);
const QuizPage = lazy(() =>
  import('@/features/study/QuizPage').then(module => ({
    default: module.QuizPage,
  })),
);
const NotesPage = lazy(() =>
  import('@/features/study/NotesPage').then(module => ({
    default: module.NotesPage,
  })),
);
const OverviewPage = lazy(() =>
  import('@/features/overview/OverviewPage').then(module => ({
    default: module.OverviewPage,
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
          <Route
            path="notebooks/:notebookId/overview"
            element={
              <Lazy>
                <OverviewPage />
              </Lazy>
            }
          />
          {/*
            Every runner names its artifact — the deck, quiz or exam it is a
            sitting of. This is the fix for the exam that opened from nowhere,
            and what makes many-per-notebook expressible.
          */}
          <Route
            path="notebooks/:notebookId/decks/:deckId/practice"
            element={<PracticePage />}
          />
          <Route path="notebooks/:notebookId/quizzes/:quizId" element={<QuizPage />} />
          <Route path="notebooks/:notebookId/exams/:examId" element={<ExamPage />} />
          <Route
            path="notebooks/:notebookId/notes/:noteSetId"
            element={<NotesPage />}
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
