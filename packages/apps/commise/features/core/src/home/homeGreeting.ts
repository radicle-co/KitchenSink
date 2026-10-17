/**
 * @module @commise/features-core/home — Home's greeting, so web and mobile greet identically (FR-044).
 */
import { greetingBucketForHour, type GreetingBucket } from '../utils/timeOfDay.js';

/** The two greeting sets an app's copy gives Home, one phrase per time-of-day bucket. */
export interface HomeGreetingCopy {
    /** The greeting when the cook has no name yet: "Good afternoon". */
    readonly greetings: Readonly<Record<GreetingBucket, string>>;
    /** The greeting with the cook's name in `{name}`: "Good afternoon, {name}". */
    readonly greetingsNamed: Readonly<Record<GreetingBucket, string>>;
}

/**
 * Home's title for the hour: the bucket's greeting, with the cook's name when there is one.
 *
 * The name goes in through a replacer function, not as a replacement string, so a name that happens to hold a
 * replacement pattern (`$&`, `$'`) is inserted as typed.
 *
 * @param copy - The app's greeting sets.
 * @param name - The cook's display name, if any.
 * @param hour - The viewer's LOCAL hour of day (0-23). The caller reads the clock; this stays pure.
 * @returns The greeting. Pure.
 */
export function homeGreetingOf(copy: HomeGreetingCopy, name: string | undefined, hour: number): string {
    const bucket = greetingBucketForHour(hour);

    return name === undefined ? copy.greetings[bucket] : copy.greetingsNamed[bucket].replace('{name}', () => name);
}
