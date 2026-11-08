/**
 * The specs that skip when the run has no deployed identity service or no live local backend.
 *
 * They skip on purpose, never fail for want of a target, and prove nothing when skipped. A local run owes them: it lists
 * them every time and still may move the green stamp, where any other skip refuses it. Held equal to the files on disk by
 * `__tests__/deployedOnlySpecs.test.ts`.
 */
export const DEPLOYED_ONLY_SPECS: readonly string[] = [
    // Reads the DEPLOYED identity service (`deployedTargetOrigin`).
    'paidFeatureRoles.spec.ts',
    // Needs a live local backend (`E2E_LIVE_BACKEND=1`, recipe and identity services running).
    'recipeLive.spec.ts',
];
