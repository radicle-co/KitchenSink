/**
 * A cross-region model entry that exists ONLY in tests, for driving the residency REFUSAL.
 *
 * ⛔ WHY A FIXTURE RATHER THAN A REAL MODEL. Proving "an unwarranted model is refused" used to mean naming
 * whichever shipped entry happened to carry no `residencyApproval`. That made the coverage hostage to a
 * product decision: the day the owner warranted that model, the only proof the refusal works disappeared —
 * silently, and precisely when a warrant makes that proof most valuable. A fixture cannot be warranted out
 * from under the suite.
 *
 * ⚠️ The id and regions are deliberately NOT a real vendor's. Nothing here should read as a claim about where
 * any shipped model routes, and a grep for a real model must not land in this file.
 */
import type { ModelRegistryEntry } from '@kitchensink/recipe-core/spend/spend-arithmetic';

/** The fixture's model id — what a test passes as `modelId`/`settings.modelId`. */
export const UNWARRANTED_MODEL_ID = 'vendor.fixture-model-v1:0';

/** The regions the fixture's profile claims to reach, i.e. what a refusal reports. */
export const UNWARRANTED_REACHED_REGIONS: readonly string[] = ['us-east-1', 'eu-west-1'];

/** A one-entry registry holding {@link UNWARRANTED_MODEL_ID} with NO residency warrant. */
export const UNWARRANTED_REGISTRY: Readonly<Record<string, ModelRegistryEntry>> = {
    [UNWARRANTED_MODEL_ID]: {
        rate: {
            inputMicrosPerMillionTokens: 1,
            outputMicrosPerMillionTokens: 1,
            cacheReadMicrosPerMillionTokens: 1,
            cacheWriteMicrosPerMillionTokens: 1,
            effectiveDate: '2026-09-12',
            priceVerified: true,
        },
        invocation: {
            invocationId: `us.${UNWARRANTED_MODEL_ID}`,
            reach: { kind: 'regions', regions: UNWARRANTED_REACHED_REGIONS, readOn: '2026-09-12' },
        },
    },
};
