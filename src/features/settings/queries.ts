import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { detectTimeZone } from '@/lib/day';
import type { UpdateProfileInput } from '@/lib/api';

/**
 * Profile and quota, on the contract — **the last of `src/lib/queries.ts`.**
 *
 * FR2 predicted this file: `useProfile` was the one hook of the old stack with
 * consumers outside any single phase (`AccountMenu`, `SettingsPage`, and since
 * FR5 the practice runner), so it could not die with a screen. It dies here,
 * and `src/lib/queries.ts` and `src/lib/api-client.ts` die with it — the app
 * now speaks to exactly one data layer.
 *
 * ── Why it lives beside settings ──────────────────────────────────────────
 *
 * Settings is the screen that *writes* the profile, and the timezone it writes
 * decides every day boundary the rest of the app computes. The other three
 * consumers only read it. Putting the pair beside the writer keeps the
 * invalidation and the mutation in one file rather than splitting a hook from
 * the thing that invalidates it.
 *
 * ── The shape changed, and callers had to change with it ──────────────────
 *
 * The old `ProfileRow` was snake_case straight off the wire —
 * `display_name`, `daily_new_limit`. The contract's `Profile` is camelCase and
 * `getProfile` never returns null for a signed-in user, where the Supabase
 * version could. Both differences are visible at every call site rather than
 * being smoothed over by an adapter: an adapter here would be a third shape to
 * keep in step, and the whole point of the contract is that there is one.
 */
export const profileKeys = {
  profile: ['api', 'profile'] as const,
  quota: ['api', 'quota'] as const,
};

/**
 * The signed-in user's profile.
 *
 * `tz` seeds the row's timezone the first time the server creates it and is
 * ignored on every later call. Without it a new account starts on UTC and
 * quietly gets the wrong day boundary for every review it ever logs (SPEC §6).
 */
export function useProfile() {
  return useQuery({
    queryKey: profileKeys.profile,
    queryFn: () => api.getProfile(detectTimeZone()),
    // The timezone here decides every day boundary; a stale copy shifts the
    // new-card cap. A cheap row, so keep it fresh.
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.updateProfile(input),
    onSuccess: profile => {
      queryClient.setQueryData(profileKeys.profile, profile);
      /*
       * The timezone is the reason this is a broad invalidation rather than a
       * cache write and nothing else. Changing it re-buckets every study day,
       * so the heatmap, the forecast and the global strip are all now answering
       * with the wrong boundary. Refetching everything under `api` is blunt and
       * correct; the alternative is enumerating the aggregates here, which is a
       * list that goes stale the moment one is added.
       */
      void queryClient.invalidateQueries({ queryKey: ['api'] });
    },
  });
}

/** The monthly generation allowance. Advisory — `createArtifact` enforces it. */
export function useQuotaUsage() {
  return useQuery({
    queryKey: profileKeys.quota,
    queryFn: () => api.getQuota(),
    staleTime: 30_000,
  });
}
