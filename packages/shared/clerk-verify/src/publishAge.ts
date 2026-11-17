/**
 * The publish age claim: publishing needs age 16 or over; the claim is written by identity's age assurance.
 *
 * `public_metadata.ageFloorMet` is the age floor the cook has met, as a number. It is read through
 * {@link parsePublishAgeMet} and nothing else: only an integer of 16 or more counts, so an absent, malformed,
 * string, fractional or NaN value is false.
 *
 * @pattern Parser — `parsePublishAgeMet`, parse-don't-validate at the token boundary
 */

/** The `public_metadata` key the age floor lives under. */
export const AGE_FLOOR_METADATA_KEY = 'ageFloorMet';

/** The youngest age that may publish. */
export const PUBLISH_MIN_AGE = 16;

/** True only when `value` is an integer of {@link PUBLISH_MIN_AGE} or more. */
export function parsePublishAgeMet(value: unknown): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= PUBLISH_MIN_AGE;
}
