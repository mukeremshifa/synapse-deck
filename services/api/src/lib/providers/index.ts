/**
 * Choosing a provider. D6's seam, resolved from configuration.
 *
 * **There is no default.** `CARD_PROVIDER` must name one, and an unset or
 * unrecognised value throws rather than falling back to anything.
 *
 * That is the point rather than an inconvenience. The only implementation that
 * works offline today is the stub, so a "sensible default" would mean a
 * deployment silently generating fake cards because an environment variable was
 * forgotten — and fake cards are indistinguishable from real ones to everything
 * downstream of this call. Failing to start is loud; generating placeholder
 * content is not.
 */

import { GroqProvider } from './groq.ts';
import { StubProvider } from './stub.ts';
import type { AnsweringProvider, CardProvider, ProviderName } from './types.ts';

const PROVIDER_NAMES = ['stub', 'bedrock', 'groq'] as const;

function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

let cached: CardProvider | undefined;

export function resolveProvider(): CardProvider {
  if (cached !== undefined) return cached;

  const configured = process.env['CARD_PROVIDER'];

  if (configured === undefined || configured === '') {
    throw new Error(
      'CARD_PROVIDER is not set. It must name a provider explicitly — there is ' +
        'no default, because defaulting would mean silently generating ' +
        `placeholder cards. One of: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }

  if (!isProviderName(configured)) {
    throw new Error(
      `CARD_PROVIDER is "${configured}", which is not a provider. ` +
        `One of: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }

  switch (configured) {
    case 'stub':
      // Logged at construction, every cold start, at error level. A stub that
      // runs quietly is the whole risk; one that announces itself in CloudWatch
      // on every container start is findable.
      console.error(
        '⚠ CARD_PROVIDER=stub — generating PLACEHOLDER cards. No model is being ' +
          'called. Every card produced is fake and is recorded as provider="stub".',
      );
      cached = new StubProvider();
      return cached;

    case 'groq':
      // The first real provider (DS1 task 4). Nothing is logged here: a real
      // model producing real cards is the ordinary case, and a line on every
      // cold start would train the reader to skim past the stub's warning
      // sitting one branch above it.
      cached = new GroqProvider();
      return cached;

    case 'bedrock':
      // Still deliberately not "coming soon". Model access has not been
      // granted, and a deployment configured for Bedrock must fail loudly
      // rather than quietly serving something else — least of all stub content.
      //
      // When the grant arrives this becomes `new BedrockProvider()` and lands
      // *beside* groq.ts rather than replacing it: two providers answering the
      // same question is what the seam was built for and what Phase E's eval
      // harness needs. See DEMO-SPRINT-BRIEF D1.
      throw new Error(
        'CARD_PROVIDER="bedrock" is not implemented: model access has not been ' +
          'granted on this account (docs/plans/DEMO-SPRINT-BRIEF.md §1). ' +
          'Use CARD_PROVIDER=groq, which calls a real model today.',
      );
  }
}

/** Test seam: forget the cached provider so a changed env var takes effect. */
export function resetProviderCache(): void {
  cached = undefined;
}

export type {
  AnswerRequest,
  AnswerResult,
  AnsweringProvider,
  CardProvider,
  GenerateChunkRequest,
  GenerateChunkResult,
  ProviderName,
} from './types.ts';
export { ProviderRetryableError } from './types.ts';

/**
 * The provider, if it can answer questions. DS2 task 6.
 *
 * ── Why this can return null, and what that means at the endpoint ─────────
 *
 * `resolveProvider()` above always returns something or throws: every
 * configured provider writes cards, so failing to get one is a configuration
 * error. Answering is different — it is a capability a provider may not have,
 * and exactly one of the three deliberately does not.
 *
 * **`CARD_PROVIDER=stub` returns null here, and that is the feature.** A
 * deployment with no real model has nothing honest to say about a user's
 * documents, so the chat endpoint refuses rather than answering. The
 * alternative — a stub that produces fluent placeholder prose about someone's
 * study material — is precisely what DS2 §3 forbids, and the type system is
 * what prevents it: `StubProvider` does not implement `AnsweringProvider`, so
 * there is no implementation to accidentally reach.
 *
 * Returning `null` rather than throwing because the caller has a genuinely
 * different response for it: a 503 saying chat is unavailable in this
 * deployment, not a 500. Card generation still works with the stub selected,
 * and one unavailable feature should not read as a broken server.
 */
export function resolveAnsweringProvider(): AnsweringProvider | null {
  const provider = resolveProvider();

  // A structural check, not a name check. `provider.name === 'groq'` would
  // have to be edited every time a provider gains the capability — including
  // when BedrockProvider lands — and forgetting to would silently disable chat
  // on a provider that supports it. Asking whether the method exists cannot
  // drift from whether the method exists.
  return 'answer' in provider && typeof provider.answer === 'function'
    ? (provider as AnsweringProvider)
    : null;
}
