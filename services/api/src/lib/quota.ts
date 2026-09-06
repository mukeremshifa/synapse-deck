/**
 * The shared quota policy, re-exported for the API.
 *
 * The same bridge as `schemas.ts` beside it, and for the same reason: the
 * policy has exactly one definition, in `src/lib/quota.ts`, shared by the
 * client and every server that enforces it. The client counts to *show* a user
 * what is left; the API counts to *refuse*. Both read the thresholds from the
 * same module, so the figure on the screen and the figure that refuses the
 * request cannot disagree — which is the entire point, because a user told they
 * have 40 units left and then refused has been lied to by one of the two.
 *
 * This file adds nothing but a path that survives the bundle.
 */

export {
  GENERATION_QUOTA,
  countsTowardQuota,
  decideGeneration,
  estimateTokens,
  monthWindow,
  rateWindowStart,
  remainingUnits,
  staleRunningBefore,
  unitsForChunks,
  type GenerationCounts,
  type GenerationDecision,
} from '../../../../src/lib/quota.ts';
