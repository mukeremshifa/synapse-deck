/**
 * Cost-allocation tags (D9): `project`, `env`, `owner` on every resource.
 *
 * Applied at App level via Tags.of(app), not per-stack and certainly not per
 * resource, because the failure mode is a resource added in Phase C that nobody
 * remembers to tag and that is then invisible in Cost Explorer forever after.
 * Tagging the App means a future resource cannot forget.
 *
 * One manual step this cannot do for you: tags must be *activated* as
 * cost-allocation tags in the Billing console before Cost Explorer will group by
 * them, and activation is not retroactive in any hurry — it can take up to 24
 * hours to appear. Until that is done these tags are present on the resources
 * and useless for reporting, which is a confusing state to debug. See
 * infra/README.md.
 */

import { Tags } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import type { EnvConfig } from './config.ts';

export function applyTags(scope: IConstruct, config: EnvConfig): void {
  const tags = Tags.of(scope);
  for (const [key, value] of Object.entries(config.tags)) {
    tags.add(key, value);
  }
}
