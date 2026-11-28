/** Every save-refusal cause, shared by the policy and the rewrite seam tests. */
import type { SaveRefusalCause } from '@kitchensink/recipe-core/recipe-state';

import type { BlockCause } from '../rewriteWay.js';

/** Every refusal cause. A `Record` keyed by the type makes a new cause a compile error here, not a silent gap. */
const CAUSE_BY_KIND: Record<SaveRefusalCause, BlockCause> = {
    heldSource: { kind: 'heldSource' },
    tooClose: { kind: 'tooClose' },
    notApproved: { kind: 'notApproved' },
    sourceCorrected: { kind: 'sourceCorrected' },
};

export const CAUSES: readonly BlockCause[] = Object.values(CAUSE_BY_KIND);
