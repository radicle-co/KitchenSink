/**
 * @module @commise/features-core — the time-of-day greeting bucket (Home chrome).
 *
 * The Home greeting is time-of-day aware ("Good afternoon, Chef!"). Bucketing an hour is shared product
 * knowledge — web and mobile must greet identically — and it is pure, so it lives here rather than being
 * forked per app. Reading the clock is the CALLER's side effect; this module only maps an hour to a bucket,
 * which is what makes every boundary testable without freezing time.
 */

/** Which greeting a viewer sees. The dictionary in each app carries one string per bucket. */
export type GreetingBucket = 'morning' | 'afternoon' | 'evening' | 'night';

/** Every {@link GreetingBucket}, so a dictionary can be checked exhaustive. */
export const GREETING_BUCKETS: readonly GreetingBucket[] = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Bucket boundaries as [inclusive start hour, bucket]. Night wraps midnight, so it is the fall-through: an
 * hour below the first boundary (00:00–04:59) or at/after the last (22:00–23:59) is night.
 */
const BUCKET_STARTS: readonly (readonly [number, GreetingBucket])[] = [
    [5, 'morning'],
    [12, 'afternoon'],
    [17, 'evening'],
    [22, 'night'],
];

/**
 * Map a local hour-of-day to its greeting bucket.
 *
 * Defined so the error case cannot occur (Ousterhout): any hour outside 0–23, fractional, or non-finite
 * resolves to `night` rather than throwing or returning `undefined`. A greeting is decoration — a surprising
 * clock reading must never be able to break the Home header.
 *
 * @param hour - The local hour of day (0–23). Fractional values are floored.
 * @returns The greeting bucket for that hour. Pure.
 */
export function greetingBucketForHour(hour: number): GreetingBucket {
    if (!Number.isFinite(hour)) {
        return 'night';
    }

    const floored = Math.floor(hour);

    for (const [start, bucket] of [...BUCKET_STARTS].reverse()) {
        if (floored >= start && floored <= 23) {
            return bucket;
        }
    }

    return 'night';
}
