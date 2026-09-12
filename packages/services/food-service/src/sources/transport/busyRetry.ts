/**
 * One short wait on a busy source, for a caller with a person waiting on it (ADR-0053 §4, U27 blueprint). PATCH
 * resolve uses it: a refusal that clears within two seconds, such as a contended lock, is worth one wait and one
 * retry, and anything later answers busy at once so the cook is told to come back.
 *
 * @module
 */
import { isSourceBusyError } from '../foodSource.errors.js';

/**
 * How far past `retryAt` the retry is sent. `retryAt` is the database's instant at which the window frees a call, and a
 * timer can fire a millisecond or two early by the process clock; a retry that lands before that instant is refused
 * again and spends the one wait for nothing.
 */
export const BUSY_RETRY_MARGIN_MS = 50;

/** How long the caller may wait, and the clock and timer it waits by. */
export interface BusyRetryOptions {
    /** The longest wait worth making, in milliseconds. */
    readonly maxWaitMs: number;
    /** The current time, epoch milliseconds. Defaults to `Date.now`. */
    readonly now?: () => number;
    /** Wait this many milliseconds. Defaults to a timer. */
    readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Wait with a timer.
 *
 * @param ms - The wait, in milliseconds.
 * @returns When the wait is over.
 * @sideEffect Schedules a timer.
 */
async function timerSleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Run `call`; when the transport refuses it and the refusal clears within `maxWaitMs`, wait until then and run it
 * once more.
 *
 * @param call - The call, which goes through the rate-limited transport.
 * @param options - The longest wait, and the clock and timer.
 * @returns The call's answer.
 * @throws {SourceBusyError} when the refusal clears later than `maxWaitMs`, or the retry is refused too.
 * @throws Any other failure of the call, unchanged and without waiting.
 * @sideEffect Runs the call up to twice and may wait between.
 */
export async function retryOnceWhenSoon<T>(call: () => Promise<T>, options: BusyRetryOptions): Promise<T> {
    try {
        return await call();
    } catch (error) {
        if (!isSourceBusyError(error)) {
            throw error;
        }

        const waitMs = Math.max(0, Date.parse(error.retryAt) - (options.now ?? Date.now)());

        if (!(waitMs <= options.maxWaitMs)) {
            throw error;
        }

        await (options.sleep ?? timerSleep)(waitMs + BUSY_RETRY_MARGIN_MS);

        return call();
    }
}
