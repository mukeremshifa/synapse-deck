import { isApiClientError, type ApiErrorCode } from '@/lib/api';

/**
 * What a generation failure means, and what the user can do about it. **FR4 §3.**
 *
 * ═══ Why this is a table and not a string at each call site ══════════════
 *
 * The contract made `ApiErrorCode` a closed union for exactly this, and says so:
 *
 * > A closed union means a surface can `switch` on it and TypeScript will say
 * > when a new code has no handler — which is the property FR4 needs to design
 * > the generation and error surfaces properly.
 *
 * A `Record<ApiErrorCode, …>` collects that property: adding a code to the
 * contract fails to compile here until someone decides what it should say. The
 * alternative — `error.message` rendered wherever a mutation rejects — has the
 * server writing the UI's copy, and gives every failure the same shape whether
 * the user can retry, must wait, or has run out of allowance.
 *
 * ── Three fields, because there are three different questions ────────────
 *
 * `title` is what went wrong, `detail` is why, and `retry` decides whether a
 * "Try again" button is honest. That last one is the reason this table exists
 * at all: **offering a retry that cannot work is worse than offering none.** A
 * `quota_exceeded` retry fails identically every time, and a `refused` retry
 * asks the model the same question expecting a different answer. Both get
 * `retry: false` and a sentence saying what would actually help.
 */
export interface GenerationFailure {
  title: string;
  detail: string;
  /** Whether trying the same thing again could plausibly succeed. */
  retry: boolean;
}

/**
 * Every code the contract defines, with what generation should say about it.
 *
 * Some of these cannot arise from a generation job today — `stale_card` belongs
 * to review, `not_found` to a deleted notebook. They are here anyway because
 * the union is closed and partial coverage is how a surface renders an empty
 * error box the first time an unexpected code arrives.
 */
const FAILURES: Record<ApiErrorCode, GenerationFailure> = {
  quota_exceeded: {
    title: 'You have used this month’s generation allowance',
    detail:
      'Nothing was generated and nothing was charged against next month. The allowance resets at the start of the month; until then you can still study everything you already have.',
    retry: false,
  },
  rate_limited: {
    title: 'Too many requests just now',
    detail:
      'The model provider is throttling. This usually clears within a minute — waiting and trying again is the fix, and nothing was lost.',
    retry: true,
  },
  input_too_long: {
    title: 'Those sources are too long for one generation',
    detail:
      'The selected text exceeds what the model can be given at once. Choose fewer sources, or generate from them in two passes.',
    retry: false,
  },
  refused: {
    title: 'The model declined to answer',
    detail:
      'It would not generate from this material. Retrying asks the same question and gets the same answer, so try different sources or a different depth.',
    retry: false,
  },
  provider_error: {
    title: 'The model failed partway through',
    detail:
      'A fault at the provider, not in your sources. Nothing was written, so trying again is safe.',
    retry: true,
  },
  network: {
    title: 'The request did not reach us',
    detail: 'Check your connection and try again.',
    retry: true,
  },
  invalid_input: {
    title: 'That request was not valid',
    detail:
      'Something in the form was rejected — most often a source that no longer exists. Reopen the modal and choose your sources again.',
    retry: false,
  },
  unauthorized: {
    title: 'You are signed out',
    detail: 'Your session expired. Sign in again and the notebook will be as you left it.',
    retry: false,
  },
  forbidden: {
    title: 'This notebook is not yours',
    detail: 'You do not have access to generate here.',
    retry: false,
  },
  not_found: {
    title: 'This notebook no longer exists',
    detail: 'It may have been deleted in another tab.',
    retry: false,
  },
  stale_card: {
    title: 'That card changed somewhere else',
    detail: 'It was edited in another tab. Reload to see the current version.',
    retry: true,
  },
  not_implemented: {
    title: 'Generation is not available on this backend yet',
    detail:
      'This route exists in the contract and not yet in the live API — FR7 builds it. In fake mode it works; against the live backend it does not.',
    retry: false,
  },
  internal: {
    title: 'Something went wrong on our side',
    detail: 'Not your sources and not your request. Trying again is safe.',
    retry: true,
  },
};

/** The failure copy for a code. */
export function failureFor(code: ApiErrorCode): GenerationFailure {
  return FAILURES[code];
}

/**
 * A thrown value from a mutation, as something renderable.
 *
 * Falls back rather than throwing on a value that is not an `ApiClientError`:
 * a catch site can see a `TypeError` from a broken fetch, and a progress panel
 * that itself crashes while reporting a crash is the worst version of this.
 */
export function failureFromError(error: unknown): GenerationFailure {
  if (isApiClientError(error)) return failureFor(error.code);
  return {
    title: 'Generation could not be started',
    detail: error instanceof Error ? error.message : 'An unknown error occurred.',
    retry: true,
  };
}

/**
 * A failed job, as something renderable.
 *
 * `Job.error` is nullable even on a failed job, which is not defensiveness —
 * the contract allows a job to fail without an attributable code. Rendering
 * that as a blank box is how a user learns the app does not know what happened,
 * so it gets its own sentence.
 */
export function failureFromJob(error: { code: ApiErrorCode } | null): GenerationFailure {
  if (error === null) {
    return {
      title: 'Generation failed',
      detail: 'The job stopped without reporting a reason. Trying again is safe.',
      retry: true,
    };
  }
  return failureFor(error.code);
}
