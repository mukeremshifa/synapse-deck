import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { InfoIcon } from 'lucide-react';

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
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Page, PageHeader } from '@/components/layout';
import { LoadingState, ErrorState } from '@/components/states';
import { detectTimeZone, DAY_BOUNDARY_HOUR, isValidTimeZone } from '@/lib/day';
import { formatDate } from '@/lib/format';
import { ProfileSettings, type ProfileSettingsInput } from '@/lib/schemas';
import { useProfile, useQuotaUsage, useUpdateProfile } from '@/lib/queries';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * Settings — the screen FR1 rebuilt to prove the design system on something
 * real (FR1 task 7).
 *
 * It was chosen because it is small, self-contained, already working, and
 * FR2–FR6 do not replace it — so the rebuild is a demonstration rather than
 * work that gets thrown away. It exercises, on one screen: the layout
 * vocabulary, three of the four states, the form primitives on the new palette,
 * the spacing tokens, the typography rule, and `Alert`.
 *
 * What changed, and why each is the system rather than taste:
 *
 *   - The page frame is `Page width="prose"` + `PageHeader`, not a hand-rolled
 *     `max-w-xl space-y-6`. The serif title now comes from the component, which
 *     is how the typography rule gets *enforced* rather than merely written.
 *   - The whole-page skeleton became `LoadingState`, which reserves the shape
 *     of what is coming instead of one grey slab of arbitrary height.
 *   - The quota card's failure was a sentence of muted text with no way
 *     forward; it is now `ErrorState` with the retry the query already had.
 *   - The two explanatory paragraphs became `Alert variant="info"`. They are
 *     conditions that stay true, not asides — which is the alert/toast
 *     distinction the primitive documents.
 *   - Every number is `font-mono tabular-nums`, per the typography rule.
 */

/** Every zone the runtime knows, with a fallback for older ICU builds. */
function timeZones(): string[] {
  const supported = Intl.supportedValuesOf?.('timeZone');
  if (supported && supported.length > 0) return [...supported];
  return [...new Set(['UTC', detectTimeZone()])];
}

export function SettingsPage() {
  const { user, signOut } = useAuth();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const quota = useQuotaUsage();
  const zones = useMemo(timeZones, []);

  // Three generics: the form holds raw input, zod coerces, the submit handler
  // receives the parsed shape.
  const form = useForm<ProfileSettingsInput, unknown, ProfileSettings>({
    resolver: zodResolver(ProfileSettings),
    defaultValues: { display_name: '', timezone: 'UTC', daily_new_limit: 20 },
  });

  const { reset } = form;
  useEffect(() => {
    if (!profile.data) return;
    reset({
      display_name: profile.data.display_name ?? '',
      timezone: isValidTimeZone(profile.data.timezone)
        ? profile.data.timezone
        : detectTimeZone(),
      daily_new_limit: profile.data.daily_new_limit,
    });
  }, [profile.data, reset]);

  const onSubmit = form.handleSubmit(async values => {
    try {
      await updateProfile.mutateAsync(values);
      toast.success('Settings saved');
    } catch (error) {
      toast.error('Could not save settings', {
        description: (error as Error).message,
      });
    }
  });

  const browserZone = detectTimeZone();
  const chosenZone = form.watch('timezone');

  return (
    <Page width="prose">
      <PageHeader
        title="Settings"
        description="How practice behaves, and what the account has left."
      />

      {profile.isPending ? (
        // Shaped like the form it replaces, so nothing jumps when it lands.
        <Card>
          <CardContent className="py-gutter">
            <LoadingState lines={6} label="Loading your settings" />
          </CardContent>
        </Card>
      ) : profile.isError ? (
        <ErrorState
          title="Could not load your settings"
          detail={(profile.error as Error).message}
          onRetry={() => void profile.refetch()}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Practice</CardTitle>
            <CardDescription>
              How many unseen cards a day, and where your day begins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-base" noValidate>
              <div className="flex flex-col gap-tight">
                <Label htmlFor="display_name">Display name</Label>
                <Input id="display_name" {...form.register('display_name')} />
              </div>

              <div className="flex flex-col gap-tight">
                <Label htmlFor="daily_new_limit">New cards per day</Label>
                <Input
                  id="daily_new_limit"
                  type="number"
                  min={0}
                  max={500}
                  className="w-32 font-mono tabular-nums"
                  aria-invalid={Boolean(form.formState.errors.daily_new_limit)}
                  {...form.register('daily_new_limit')}
                />
                <Alert variant="info">
                  <InfoIcon aria-hidden />
                  <AlertDescription>
                    Every new card becomes a review tomorrow, and the day after. Twenty a
                    day settles at roughly two hundred reviews a day once it catches up.
                  </AlertDescription>
                </Alert>
                {form.formState.errors.daily_new_limit && (
                  <p role="alert" className="text-destructive text-sm">
                    {form.formState.errors.daily_new_limit.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-tight">
                <Label htmlFor="timezone">Timezone</Label>
                <Select id="timezone" {...form.register('timezone')}>
                  {zones.map(zone => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
                <Alert variant="info">
                  <InfoIcon aria-hidden />
                  <AlertDescription>
                    This matters more than it looks: your study day starts at{' '}
                    <span className="font-mono tabular-nums">
                      {String(DAY_BOUNDARY_HOUR).padStart(2, '0')}:00
                    </span>{' '}
                    here, so a late-night session still counts towards the previous day.
                  </AlertDescription>
                </Alert>
                {chosenZone !== browserZone && (
                  <p className="text-muted-foreground text-xs">
                    This browser is in <span className="font-mono">{browserZone}</span>.{' '}
                    <button
                      type="button"
                      className="decoration-primary underline decoration-2 underline-offset-4"
                      onClick={() =>
                        form.setValue('timezone', browserZone, { shouldDirty: true })
                      }
                    >
                      Use that instead
                    </button>
                  </p>
                )}
              </div>

              <Separator />

              <Button
                type="submit"
                className="self-start"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? 'Saving…' : 'Save settings'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Card generation</CardTitle>
          <CardDescription>
            How much of this month&rsquo;s allowance is left, in units &mdash; one unit per
            section of text sent to the model, so a pasted passage costs one and a document
            costs what it splits into. The count comes from the generations themselves, so
            it is what the server will enforce.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-snug">
          {quota.isPending ? (
            <LoadingState lines={2} label="Loading your generation allowance" />
          ) : quota.isError ? (
            <ErrorState
              title="Could not read your generation history"
              detail={(quota.error as Error).message}
              onRetry={() => void quota.refetch()}
            />
          ) : (
            <>
              <p className="font-mono text-3xl leading-none tabular-nums">
                {quota.data.remaining}
                <span className="text-muted-foreground ml-tight font-sans text-base">
                  of {quota.data.limit} left
                </span>
              </p>
              <p className="text-muted-foreground text-sm">
                {quota.data.used === 0
                  ? 'You have not generated any cards this month.'
                  : `${quota.data.used} units used since the 1st.`}{' '}
                The allowance resets on {formatDate(new Date(quota.data.resetsAt), 'UTC')}{' '}
                (UTC).
              </p>
              <Button variant="outline" className="self-start" asChild>
                <Link to="/create/text">Generate cards</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          {/* Mono: an email is a value you might compare or type. */}
          <CardDescription className="font-mono">{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </Page>
  );
}
