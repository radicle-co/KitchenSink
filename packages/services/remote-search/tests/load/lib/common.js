/**
 * The remote search service's k6 library: the profile seam every service's load tier shares
 * (`packages/infra/global/__tests__/loadProfileThresholds.test.ts`).
 *
 * The remote search service has ONE profile today, `deployed`. Its scenario measures CloudFront's signature check and
 * its cache, and nothing on a runner stands in for either, so `remoteSearch.load.js` refuses every other profile.
 * `whenSubstrate` is here because the seam is the harness's contract: a scenario that gains a calibrated machine
 * gates its latency through it, as identity's, food's and recipe's do.
 */

/**
 * Which profile this run measures: `substrate` (a calibrated runner-local machine) or `deployed`.
 *
 * ⛔ THE ONLY THING IT CHANGES IS WHICH THRESHOLDS ARE IN FORCE, as in the other services' libraries.
 */
export const LOAD_PROFILE = __ENV['LOAD_PROFILE'] || 'substrate';

/**
 * The given thresholds, in force ONLY on the substrate profile.
 *
 * ⛔ NOT an env-tunable budget set to a huge number on the deployed profile. That leaves a threshold that LOOKS
 * gated and can never fire, the coverage theatre `docs/CODING_STANDARDS.md` §7.1 forbids.
 *
 * @param thresholds - The latency thresholds to gate on a calibrated machine.
 * @returns The thresholds on `substrate`, an empty object on any other profile.
 */
export function whenSubstrate(thresholds) {
    return LOAD_PROFILE === 'substrate' ? thresholds : {};
}
