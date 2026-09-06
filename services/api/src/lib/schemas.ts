/**
 * The shared Zod schemas, re-exported for the API.
 *
 * Same bridge as `supabase/functions/_shared/schemas.ts`, and for the same
 * reason: `CLAUDE.md` requires one Zod definition per concept, in
 * `src/lib/schemas.ts`, shared by client and server. A card shape defined twice
 * is a card shape that will disagree with itself — the client accepts something
 * the server rejects, and the error arrives as a 400 with no field to attach it
 * to.
 *
 * So this file adds nothing. It exists so that `services/api/` reaches the real
 * module by a path that survives the bundle, rather than importing across the
 * repository root in every handler.
 *
 * **Validation still happens on both sides, and that is not duplication.** The
 * client validates so a mistake is a field-level message instead of a round
 * trip; the server validates because the client is not a security boundary and
 * nothing else stands between a request body and a `jsonb` column. What must
 * not be duplicated is the *definition*, and it is not.
 */

export {
  CardPayload,
  DeckInput,
  GradeSchema,
  ProfileSettings,
  UPLOAD_LIMITS,
  UploadRequest,
  UploadTicket,
  type CardKind,
  type ProfileSettingsInput,
} from '../../../../src/lib/schemas.ts';
