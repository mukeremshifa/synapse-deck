import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage';
import { LoginPage, SignupPage } from '@/features/auth/AuthPages';
import { ProtectedRoute, PublicOnlyRoute } from '@/features/auth/ProtectedRoute';
import { DashboardPage } from '@/features/decks/DashboardPage';
import { DecksPage } from '@/features/decks/DecksPage';

/**
 * The route table from SPEC §8.2.
 *
 * Everything inside the AppLayout needs a session, so the guard wraps the layout
 * route rather than each child — one place to get right, and no route can be
 * added later that quietly skips it.
 *
 * **`/` is public from P7.** It used to be a `<Navigate>` index route *inside*
 * the guarded layout, which made the front door private: a stranger asking for
 * the site got redirected to /dashboard and bounced straight on to /login. It is
 * now a top-level route rendering the landing page, and the guard protects one
 * fewer path. Nothing about RLS changes — `LandingPage` reaches no data layer at
 * all, and a test asserts that — but the change is the one thing in P7 that
 * altered what an anonymous request can reach, so it is worth naming here.
 *
 * **What is eager and why.** The bundle that matters is the one a signed-out
 * visitor downloads to see a login form. So the auth pages stay eager, and so do
 * the dashboard and the deck list — they are the first screen after signing in,
 * and a spinner there costs more than the bytes save. Everything else is behind
 * `React.lazy`: the generation pipeline and its schemas, the card editor and its
 * dialogs, `ts-fsrs`, Recharts — and, from P7, the landing page, so that a
 * signed-in user's first load does not fetch marketing they are about to be
 * redirected away from. P4 task 4; measured in docs/plans/P4-ship.md.
 *
 * A lazy route only pays off if nothing eager imports the same heavy module —
 * `DashboardPage` importing `streaks` from `src/lib/progress.ts` is why that
 * module stays in the main chunk. Check the build table after touching imports.
 */

const LandingPage = lazy(() =>
  import('@/features/marketing/LandingPage').then(module => ({
    default: module.LandingPage,
  })),
);
const DeckDetailPage = lazy(() =>
  import('@/features/decks/DeckDetailPage').then(module => ({
    default: module.DeckDetailPage,
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
const ProgressPage = lazy(() =>
  import('@/features/progress/ProgressPage').then(module => ({
    default: module.ProgressPage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(module => ({
    default: module.SettingsPage,
  })),
);

/**
 * One fallback for every split route. Page-shaped rather than a centred
 * spinner: the layout does not jump when the real page arrives.
 */
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

export function AppRoutes() {
  return (
    <Routes>
      {/*
        The front door. Under `PublicOnlyRoute`, so a signed-in visitor to `/`
        is sent to /dashboard rather than shown a pitch for a product they
        already use — someone who typed the bare domain out of habit wants the
        app, and a returning user who has to click past marketing to reach their
        due queue has been charged for arriving.

        Its own Suspense, not `Lazy`: that fallback is a page-shaped skeleton
        sized for the inside of AppLayout, and floating it on an empty page
        would draw three grey bars where a header is about to be. A full-height
        blank holds the scroll position and shows nothing that turns out to be
        a lie.
      */}
      <Route
        path="/"
        element={
          <PublicOnlyRoute>
            <Suspense fallback={<div className="min-h-dvh" />}>
              <LandingPage />
            </Suspense>
          </PublicOnlyRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="dashboard" element={<DashboardPage />} />

        <Route path="decks" element={<DecksPage />} />
        <Route
          path="decks/:deckId"
          element={
            <Lazy>
              <DeckDetailPage />
            </Lazy>
          }
        />

        <Route
          path="create/text"
          element={
            <Lazy>
              <CreateFromTextPage />
            </Lazy>
          }
        />
        <Route
          path="create/document"
          element={
            <Lazy>
              <CreateFromDocumentPage />
            </Lazy>
          }
        />
        <Route
          path="create/review/:deckId"
          element={
            <Lazy>
              <ReviewGatePage />
            </Lazy>
          }
        />

        <Route
          path="practice"
          element={
            <Lazy>
              <PracticePage />
            </Lazy>
          }
        />
        <Route
          path="practice/:deckId"
          element={
            <Lazy>
              <PracticePage />
            </Lazy>
          }
        />

        <Route
          path="exam"
          element={
            <Lazy>
              <ExamPage />
            </Lazy>
          }
        />

        <Route
          path="progress"
          element={
            <Lazy>
              <ProgressPage />
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
      {/* Where Supabase sends a confirmation or recovery link. Deliberately not
          behind PublicOnlyRoute — see AuthCallbackPage. */}
      <Route path="auth/callback" element={<AuthCallbackPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
