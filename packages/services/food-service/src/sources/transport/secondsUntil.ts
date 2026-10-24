/**
 * The wait a refusal's instant means to a caller (ADR-0053 §4).
 *
 * @module
 */

/**
 * The whole seconds from now until an instant, rounded up and at least 1. Pure.
 *
 * @param instant - ISO 8601, as a `SourceBusyError`'s `retryAt` carries it.
 * @param now - The current time, epoch milliseconds.
 * @returns The seconds.
 * @throws {RangeError} when the instant does not parse: every refusal carries one from the database clock, so this is
 *   a defect, never a wait of `NaN`.
 */
export function secondsUntil(instant: string, now: number): number {
    const at = Date.parse(instant);

    if (!Number.isFinite(at)) {
        throw new RangeError(`A refusal carried an unreadable instant: ${instant}`);
    }

    return Math.max(1, Math.ceil((at - now) / 1_000));
}
