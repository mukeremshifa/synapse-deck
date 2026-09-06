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

import { StubProvider } from './stub.ts';
import type { CardProvider, ProviderName } from './types.ts';

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

    case 'bedrock':
    case 'groq':
      // Deliberately not "coming soon". P10 task 10 adds these; until then a
      // deployment configured for a real provider must fail loudly rather than
      // quietly serving stub content.
      throw new Error(
        `CARD_PROVIDER="${configured}" is not implemented yet (P10 task 10). ` +
          'Bedrock model access is blocked and GROQ_API_KEY is not reachable ' +
          'from Lambda; see docs/plans/P10-SESSION-2.md.',
      );
  }
}

/** Test seam: forget the cached provider so a changed env var takes effect. */
export function resetProviderCache(): void {
  cached = undefined;
}

export type { CardProvider, GenerateChunkRequest, GenerateChunkResult, ProviderName } from './types.ts';
export { ProviderRetryableError } from './types.ts';
