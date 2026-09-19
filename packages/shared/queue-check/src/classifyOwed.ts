/**
 * The classifier (plan U11, R28) — pure, over row counts and transport counts.
 *
 * ⛔ "SLOW IS NOT LOST" is the rule this module exists to enforce, and it is the one a human operator gets
 * wrong under pressure. A backlog of owed rows looks identical whether the queue is draining steadily behind
 * it or nothing is carrying the work at all — the difference is entirely in the TRANSPORT, and only a check
 * that reads both can tell them apart. Escalating a healthy backlog trains its reader to ignore the signal,
 * which is worse than not having it.
 */
import type { OwedCondition } from './escalationPayload.js';

/** What the check measured. Counts only — see `escalationPayload.ts` for why there is no text here. */
export interface OwedObservation {
    /** Owed units whose deadline has passed. */
    readonly owedPastDeadline: number;
    /** Owed units that have never been received by a consumer. */
    readonly neverReceived: number;
    /** Owed units whose attempts have reached the allowance. */
    readonly atAllowance: number;
    /** Owed units holding a claim older than any plausible run. */
    readonly claimedTooLong: number;
    /** Messages visible on the transport. */
    readonly transportVisible: number;
    /** Messages in flight on the transport. */
    readonly transportInFlight: number;
    /** Messages on the dead-letter queue. */
    readonly transportDeadLettered: number;
}

/**
 * Classify one class of owed work, or answer `undefined` when there is nothing to say.
 *
 * The order of the branches is the order of severity, and each earlier one would be MISREAD as a later one:
 *
 *  1. **dead-lettered** — work that reached a DLQ is already out of the system's hands, and its rows still
 *     look merely owed. Checked first so a DLQ is never reported as a slow queue.
 *  2. **exhausted** — the consumer gave up by its own rule. Reported regardless of the transport, because a
 *     busy queue does not make an exhausted line any less finished.
 *  3. **stuck** — a claim outliving any plausible run means the holder is gone. Distinct from `lost` because
 *     something DID pick this up; the lease will return it, and saying "lost" would send an operator looking
 *     for a producer bug.
 *  4. **lost** — owed, never received, and NOTHING on the transport. This is the only condition that means
 *     "nobody is coming", and it is the one the whole backstop exists for.
 *  5. **delayed** — owed and past deadline, but the transport is moving. Late, not lost.
 *
 * @param observation - The measured counts.
 * @returns The condition, or `undefined` when nothing is owed and nothing is stranded. Pure.
 */
export function classifyOwed(observation: OwedObservation): OwedCondition | undefined {
    if (observation.transportDeadLettered > 0) {
        return 'dead-lettered';
    }

    if (observation.atAllowance > 0) {
        return 'exhausted';
    }

    if (observation.claimedTooLong > 0) {
        return 'stuck';
    }

    const transportCarrying = observation.transportVisible + observation.transportInFlight;

    if (observation.neverReceived > 0 && transportCarrying === 0) {
        return 'lost';
    }

    if (observation.owedPastDeadline > 0) {
        return 'delayed';
    }

    return undefined;
}
