import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { LogoLockup } from '@/components/Logo';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';

/**
 * The `*` route (SPEC §8.2).
 *
 * Deliberately outside the protected layout: a stranger who mistypes a URL gets
 * an answer, not a redirect to a login form they did not ask for. The way out
 * is /dashboard, which sends a signed-out visitor to /login on its own.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-12">
      <Link to="/notebooks" className="mb-8 self-center">
        <LogoLockup />
      </Link>
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description={
          <>
            <p className="bg-muted text-foreground rounded-md px-2 py-1.5 font-mono text-xs break-all">
              {pathname}
            </p>
            <p className="mt-3">
              That address does not match any page in this app. It may have been a typo,
              or a link to something that has since been deleted.
            </p>
          </>
        }
        action={
          <Button asChild>
            <Link to="/notebooks">Go to notebooks</Link>
          </Button>
        }
      />
    </main>
  );
}
