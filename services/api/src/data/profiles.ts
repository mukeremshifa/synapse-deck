/**
 * The `profiles` table.
 *
 * ── The rule this file exists to obey ─────────────────────────────────────
 *
 * `userId` is the first parameter of every export, it is never optional and
 * never defaulted, and **every statement filters on it** — including the
 * single-row fetches by primary key below. On `profiles` the primary key *is*
 * the user id, so `where id = $1` is already the ownership check and a second
 * clause would be noise. Every other module in this directory carries an
 * explicit `where user_id = $1`.
 *
 * Until P9 this was a Postgres guarantee (15 RLS policies, `force row level
 * security`). It is now a convention with a lint behind it
 * (`scripts/check-data-access.mjs`). See ADR 0008, and read the header of
 * `services/api/migrations/0001_schema.sql` before adding a table.
 */

import { query } from '../lib/db.ts';
import type { ProfileRow } from '../lib/rows.ts';

const COLUMNS = 'id, display_name, timezone, daily_new_limit, fsrs_params, created_at, updated_at';

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const result = await query<ProfileRow>(
    `select ${COLUMNS} from public.profiles where id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch the profile, creating it if this is the account's first authenticated
 * request.
 *
 * On Supabase a `handle_new_user` trigger on `auth.users` created this row at
 * signup. `auth.users` does not exist in RDS — identity lives in Cognito,
 * outside the database entirely — so that trigger is gone and the row has to
 * appear on demand instead. This is where it appears.
 *
 * `on conflict do nothing` rather than a check-then-insert: two requests from
 * a freshly signed-up client can race (the dashboard fetches the profile and
 * the queue at once), and the loser of that race must get the row rather than a
 * unique-violation. The trailing select covers the do-nothing case, where the
 * insert returns no row precisely because someone else won.
 */
export async function ensureProfile(
  userId: string,
  /**
   * The zone to seed a *new* row with, if the caller knows one.
   *
   * On Supabase the signup screen passed `detectTimeZone()` into user metadata
   * and the `handle_new_user` trigger wrote it into the profile. There is no
   * trigger any more and no session at signup to carry it, so the browser's
   * zone would otherwise be lost and every new account would silently start on
   * UTC — which quietly shifts the 04:00 day boundary, and therefore the daily
   * new-card cap and the streak, for most of the world (SPEC §6).
   *
   * It is only ever used for the INSERT. An existing row's zone is whatever the
   * user chose in settings, and a browser opened in another country must not
   * overwrite that. This is a convenience value, not an authority: it comes
   * from the client, it is validated below, and the worst a bad one can do is
   * give someone the wrong day boundary until they fix it in settings.
   */
  detectedTimeZone?: string,
): Promise<ProfileRow> {
  // `Intl` is the same check the client's `resolveTimeZone` makes. An
  // unrecognised zone falls back to the column default rather than raising:
  // a wrong-but-working day beats a signup that 500s.
  let seed: string | null = null;
  if (detectedTimeZone !== undefined && detectedTimeZone !== '') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: detectedTimeZone }).format(new Date());
      seed = detectedTimeZone;
    } catch {
      seed = null;
    }
  }

  const inserted = await query<ProfileRow>(
    `insert into public.profiles (id, timezone)
     values ($1, coalesce($2, 'UTC'))
     on conflict (id) do nothing
     returning ${COLUMNS}`,
    [userId, seed],
  );
  const row = inserted.rows[0];
  if (row) return row;

  const existing = await getProfile(userId);
  if (existing) return existing;

  // Neither inserted nor found. The only way here is a delete landing between
  // the two statements, which nothing in this application does — so this is a
  // genuine "should not happen" rather than a case to handle gracefully.
  throw new Error(`Profile ${userId} could neither be created nor read.`);
}

export interface ProfilePatch {
  display_name: string | null;
  timezone: string;
  daily_new_limit: number;
}

export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileRow | null> {
  const result = await query<ProfileRow>(
    `update public.profiles
        set display_name = $2, timezone = $3, daily_new_limit = $4
      where id = $1
      returning ${COLUMNS}`,
    [userId, patch.display_name, patch.timezone, patch.daily_new_limit],
  );
  return result.rows[0] ?? null;
}
