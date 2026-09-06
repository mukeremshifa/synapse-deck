import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { confirmSignUp, resendConfirmationCode, signIn, signUp } from '@/lib/cognito';
import { useAuth } from './AuthProvider';
import { Credentials, SignupInput } from '@/lib/schemas';

/**
 * Sign in and sign up.
 *
 * Supabase's own error text is shown verbatim. "Email not confirmed" and
 * "Invalid login credentials" mean genuinely different things, and replacing
 * them with one friendly sentence leaves a user with an unconfirmed address
 * retyping a password that was right all along.
 *
 * Until P7 builds a landing page, these two screens and the 404 are the entire
 * first impression: a stranger who follows a link here has been told the product
 * name and nothing else. Hence the line under the lockup — it is the only place
 * in the app today that says what SynapseDeck is for.
 */

/** One sentence, and the only marketing claim in the build. It has to be true. */
const TAGLINE =
  'Cards written from your own notes, scheduled by how well you remember them.';

function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <LogoLockup />
        <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">
          {TAGLINE}
        </p>
      </div>
      <Card className="py-7">
        <CardHeader>
          <CardTitle className="font-serif text-2xl font-normal">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
      <p className="text-muted-foreground mt-6 text-center text-sm">{footer}</p>
    </main>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // /auth/callback redirects here with a reason when a confirmation or recovery
  // link fails. Shown in the same place as a sign-in error, and cleared by the
  // next attempt, so there is only ever one message to read.
  const [serverError, setServerError] = useState<string | null>(
    () => (location.state as { authMessage?: string } | null)?.authMessage ?? null,
  );

  const { refresh } = useAuth();

  const form = useForm<Credentials>({
    resolver: zodResolver(Credentials),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async values => {
    setServerError(null);
    try {
      await signIn(values.email, values.password);
      // Cognito has no `onAuthStateChange`, so the provider is told directly
      // rather than finding out. Without this the navigate below races the
      // provider's own refresh and ProtectedRoute bounces straight back here.
      await refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Sign-in failed.');
      return;
    }
    // Resume whatever they were trying to reach before the guard intervened.
    const from = (location.state as { from?: { pathname: string } } | null)?.from;
    navigate(from?.pathname ?? '/notebooks', { replace: true });
  });

  return (
    <AuthShell
      title="Sign in"
      description="Your decks and your review history are waiting."
      footer={
        <>
          No account yet?{' '}
          <Link to="/signup" className="text-foreground underline underline-offset-4">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register('email')}
          />
          <FormError message={form.formState.errors.email?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            {...form.register('password')}
          />
          <FormError message={form.formState.errors.password?.message} />
        </div>

        <FormError message={serverError ?? undefined} />

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [code, setCode] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const form = useForm<SignupInput>({
    resolver: zodResolver(SignupInput),
    defaultValues: { email: '', password: '', display_name: '' },
  });

  /**
   * Confirmation is a second step with its own state rather than another field
   * on the signup form: the account already exists by this point, so a failure
   * here must not read as "signup failed" and must not re-submit the signup.
   */
  const onConfirm = async (event: FormEvent) => {
    event.preventDefault();
    setConfirmError(null);
    setConfirming(true);
    try {
      await confirmSignUp(form.getValues('email'), code);
      // Confirming does not sign the user in — Cognito's ConfirmSignUp
      // establishes no session, and this screen does not hold the password any
      // more. So they go to /login, with the reason stated rather than being
      // dropped on a form with no explanation.
      navigate('/login', {
        replace: true,
        state: { authMessage: 'Your account is confirmed. Sign in to get started.' },
      });
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'That code was not accepted.');
    } finally {
      setConfirming(false);
    }
  };

  const onSubmit = form.handleSubmit(async values => {
    setServerError(null);
    let confirmed = false;
    try {
      // The display name goes to a Cognito custom attribute rather than to a
      // trigger: `auth.users` does not exist on RDS, so the profile row is
      // created by the API on the first authenticated request instead (§5.6).
      // The timezone is no longer sent at signup for the same reason — the
      // profile row does not exist yet to receive it, and the settings screen
      // is where it is set.
      const result = await signUp(
        values.email,
        values.password,
        values.display_name?.trim() || undefined,
      );
      confirmed = result.confirmed;
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Sign-up failed.');
      return;
    }

    // With email confirmation on, sign-up creates an unconfirmed user and no
    // session. Saying "check your inbox" is the whole difference between
    // working and broken here.
    if (!confirmed) {
      setConfirmationSent(true);
      return;
    }
    navigate('/login', { replace: true });
  });

  /**
   * Cognito's built-in email sends a six-digit **code**, not a link.
   *
   * This screen originally said "open the link", which was written against
   * Supabase's confirmation email and carried over unexamined. It was wrong the
   * first time a real account was created against the real pool (2026-09-06):
   * the email contained `982640` and nothing to click, so a user following the
   * instruction would have been stuck with a valid account they could not
   * confirm.
   *
   * Sending a link instead is possible — it needs a custom email template and a
   * hosted verification endpoint — and is deliberately not done: it would mean
   * an Amazon-branded page or another Lambda, and ADR 0007 chose Cognito
   * precisely on the basis that the app keeps its own screens. A code the user
   * pastes here is the smaller, more honest surface.
   */
  if (confirmationSent) {
    return (
      <AuthShell
        title="Check your inbox"
        description={`We sent a six-digit code to ${form.getValues('email')}.`}
        footer={
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <form onSubmit={onConfirm} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="code">Confirmation code</Label>
            <Input
              id="code"
              // `inputMode` and `autoComplete` together are what let a phone
              // offer the code from the notification instead of making someone
              // switch apps to read it.
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
              aria-invalid={Boolean(confirmError)}
            />
            <FormError message={confirmError ?? undefined} />
          </div>

          <Button type="submit" className="w-full" disabled={confirming || code.length < 6}>
            {confirming ? 'Confirming…' : 'Confirm account'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={confirming}
            onClick={async () => {
              setConfirmError(null);
              try {
                await resendConfirmationCode(form.getValues('email'));
                setConfirmError('A new code is on its way.');
              } catch (error) {
                setConfirmError(
                  error instanceof Error ? error.message : 'Could not resend the code.',
                );
              }
            }}
          >
            Send a new code
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create account"
      description="Free, and your decks stay private to you."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="display_name">Name (optional)</Label>
          <Input
            id="display_name"
            autoComplete="name"
            {...form.register('display_name')}
          />
          <FormError message={form.formState.errors.display_name?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register('email')}
          />
          <FormError message={form.formState.errors.email?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            {...form.register('password')}
          />
          <FormError message={form.formState.errors.password?.message} />
        </div>

        <FormError message={serverError ?? undefined} />

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
