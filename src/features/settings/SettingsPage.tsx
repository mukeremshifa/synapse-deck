import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

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
import { Skeleton } from '@/components/ui/skeleton';
import { detectTimeZone, DAY_BOUNDARY_HOUR, isValidTimeZone } from '@/lib/day';
import { formatDate } from '@/lib/format';
import { ProfileSettings, type ProfileSettingsInput } from '@/lib/schemas';
import { useProfile, useQuotaUsage, useUpdateProfile } from '@/lib/queries';
import { useAuth } from '@/features/auth/AuthProvider';

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

  if (profile.isPending) {
    return <Skeleton className="h-96 w-full max-w-xl rounded-xl" />;
  }

  const browserZone = detectTimeZone();
  const chosenZone = form.watch('timezone');

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="font-serif text-3xl tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Practice</CardTitle>
          <CardDescription>
            How many unseen cards a day, and where your day begins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input id="display_name" {...form.register('display_name')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="daily_new_limit">New cards per day</Label>
              <Input
                id="daily_new_limit"
                type="number"
                min={0}
                max={500}
                className="w-32"
                aria-invalid={Boolean(form.formState.errors.daily_new_limit)}
                {...form.register('daily_new_limit')}
              />
              <p className="text-muted-foreground text-xs">
                Every new card becomes a review tomorrow, and the day after. Twenty a day
                settles at roughly two hundred reviews a day once it catches up.
              </p>
              {form.formState.errors.daily_new_limit && (
                <p role="alert" className="text-destructive text-sm">
                  {form.formState.errors.daily_new_limit.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select id="timezone" {...form.register('timezone')}>
                {zones.map(zone => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
              <p className="text-muted-foreground text-xs">
                This matters more than it looks: your study day starts at{' '}
                {String(DAY_BOUNDARY_HOUR).padStart(2, '0')}:00 here, so a late-night
                session still counts towards the previous day.
              </p>
              {chosenZone !== browserZone && (
                <p className="text-muted-foreground text-xs">
                  This browser is in {browserZone}.{' '}
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() =>
                      form.setValue('timezone', browserZone, { shouldDirty: true })
                    }
                  >
                    Use that instead
                  </button>
                </p>
              )}
            </div>

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save settings'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Card generation</CardTitle>
          <CardDescription>
            How much of this month&rsquo;s allowance is left, in units &mdash; one unit
            per section of text sent to the model, so a pasted passage costs one and a
            document costs what it splits into. The count comes from the generations
            themselves, so it is what the server will enforce.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {quota.isPending ? (
            <Skeleton className="h-10 w-48" />
          ) : quota.isError ? (
            <p className="text-muted-foreground text-sm">
              Could not read your generation history.
            </p>
          ) : (
            <>
              <p className="font-mono text-3xl leading-none tabular-nums">
                {quota.data.remaining}
                <span className="text-muted-foreground ml-2 font-sans text-base">
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
              <Button variant="outline" asChild>
                <Link to="/create/text">Generate cards</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription className="font-mono">{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
