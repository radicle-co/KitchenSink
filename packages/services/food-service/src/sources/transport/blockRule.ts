/**
 * How long one response blocks its source for every task (ADR-0053 §5, as amended by the U27 blueprint's A1 and A2).
 *
 * | Signal                               | Reason           | Block                                    |
 * | ------------------------------------ | ---------------- | ---------------------------------------- |
 * | 429                                  | `rateLimited`    | `Retry-After`, else `breachBlockSeconds` |
 * | 502, 503 or 504                      | `unavailable`    | `Retry-After`, else `outageBlockSeconds` |
 * | the publisher's quota at 0           | `quotaExhausted` | `breachBlockSeconds`                     |
 * | the publisher's quota at 10% or less | `quotaLow`       | the quota's `probeSeconds`               |
 *
 * The 10% line is our own admission ceiling read against the publisher's count: once the key's other users have
 * spent past it, our next call would spend into the top tenth the ceiling exists to keep (A2).
 *
 * When several rules fire the longest block wins, as the block ledger keeps the later `blocked_until`. The result is
 * a duration, not an instant, so the ledger can add it to its own clock and one clock decides every block.
 *
 * The caller's half of the same rule lives here too: {@link isSourceBackpressure} says which failed call means the
 * source is busy or blocked for every task, and {@link backpressureReasonOf} names it for the log, so every caller
 * that stops on a block reads one definition.
 *
 * @pattern Specification — a pure rule from one response's signals and the source's declaration to a block or none
 * @module
 */
import {
    isSourceAdmissionError,
    isSourceApiError,
    isSourceBusyError,
    type SourceAccountingError,
    type SourceApiError,
    type SourceBusyError,
} from '../foodSource.errors.js';
import type { RateLimitDeclaration } from '../sourceRegister.js';
import type { QuotaReading } from './quotaHeaders.js';
import { retryAfterSeconds } from './retryAfter.js';
import { sourceCeiling } from './sourceCeiling.js';

/** Why a source is blocked. The block ledger's `reason` column holds exactly these. */
export const BLOCK_REASONS = ['rateLimited', 'quotaExhausted', 'quotaLow', 'unavailable'] as const;

/** Why a source is blocked. */
export type BlockReason = (typeof BLOCK_REASONS)[number];

/** A block one response earns. */
export interface BlockVerdict {
    readonly reason: BlockReason;
    /** How long the block lasts from now, in whole seconds, at least 1. */
    readonly seconds: number;
}

/** What the rule reads from one response. */
export interface ResponseSignals {
    readonly status: number;
    /** The `Retry-After` field, or `null` when the response did not carry it. */
    readonly retryAfter: string | null;
    /** The publisher's quota reading, when the source declares one and the response carried it. */
    readonly quota: QuotaReading | undefined;
}

/** The statuses that mean the publisher, or its gateway, is not serving. */
const OUTAGE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * Whether a response status blocks its source on its own: a 429, or a 502, 503 or 504. A caller that sees one stops
 * calling the source, because the transport has already written the block every task reads. Pure.
 *
 * @param status - The HTTP status.
 * @returns True for 429, 502, 503 and 504.
 */
export function isBlockingStatus(status: number): boolean {
    return status === 429 || OUTAGE_STATUSES.has(status);
}

/**
 * Whether a failed call means the source is busy or blocked for every task, so the caller stops calling it and defers
 * its work without charging an attempt (ADR-0053 §4): the transport refused the call, our own accounting failed, or
 * the source answered with a {@link isBlockingStatus blocking status}, whose block the transport has already written.
 * Pure.
 *
 * @param error - The thrown value.
 * @returns True for a {@link SourceBusyError}, a {@link SourceAccountingError}, or a {@link SourceApiError} whose
 *   status blocks.
 */
export function isSourceBackpressure(
    error: unknown,
): error is SourceBusyError | SourceAccountingError | SourceApiError {
    return isSourceAdmissionError(error) || (isSourceApiError(error) && isBlockingStatus(error.statusCode));
}

/**
 * What to log for a call that stopped on back-pressure: the refusal's reason, `accounting` for our own failure, or
 * the source's status. Pure.
 *
 * @param error - The back-pressure error.
 * @returns A short label.
 */
export function backpressureReasonOf(error: SourceBusyError | SourceAccountingError | SourceApiError): string {
    if (isSourceApiError(error)) {
        return String(error.statusCode);
    }

    return isSourceBusyError(error) ? error.reason : 'accounting';
}

/**
 * The block a `Retry-After` states, or the declared one when it states no future time. A stated block is capped at
 * the longer of the source's window and its breach block: a publisher's own limit resets within its window, so one
 * bad header cannot block a source for years. Pure.
 *
 * @param retryAfter - The field, or `null`.
 * @param declaredSeconds - The block to use when the field states no future time.
 * @param limit - The source's declared limit.
 * @param now - The current time, epoch milliseconds.
 * @returns The block, in whole seconds.
 */
function statedOrDeclared(
    retryAfter: string | null,
    declaredSeconds: number,
    limit: RateLimitDeclaration,
    now: number,
): number {
    const stated = retryAfterSeconds(retryAfter, now);

    if (stated === undefined || stated <= 0) {
        return declaredSeconds;
    }

    return Math.min(stated, Math.max(limit.windowSeconds, limit.breachBlockSeconds));
}

/**
 * The block the publisher's own quota count earns, if any. Pure.
 *
 * @param quota - The reading.
 * @param limit - The source's declared limit.
 * @returns The block, or `undefined`.
 */
function quotaBlock(quota: QuotaReading | undefined, limit: RateLimitDeclaration): BlockVerdict | undefined {
    if (limit.quota === undefined || quota?.remaining === undefined) {
        return undefined;
    }

    if (quota.remaining === 0) {
        return { reason: 'quotaExhausted', seconds: limit.breachBlockSeconds };
    }

    const publisherLimit = quota.limit ?? limit.requests;

    if (quota.remaining <= publisherLimit - sourceCeiling(publisherLimit)) {
        return { reason: 'quotaLow', seconds: limit.quota.probeSeconds };
    }

    return undefined;
}

/**
 * The block one response earns its source. Pure.
 *
 * @param signals - The response's status, `Retry-After` field and quota reading.
 * @param limit - The source's declared limit.
 * @param now - The current time, epoch milliseconds, for a `Retry-After` given as a date.
 * @returns The longest block any rule gives, or `undefined` when none fires. On a tie the status rule's reason is
 *   kept, since it is what the publisher said.
 */
export function blockFor(signals: ResponseSignals, limit: RateLimitDeclaration, now: number): BlockVerdict | undefined {
    const verdicts: BlockVerdict[] = [];

    if (signals.status === 429) {
        verdicts.push({
            reason: 'rateLimited',
            seconds: statedOrDeclared(signals.retryAfter, limit.breachBlockSeconds, limit, now),
        });
    }

    if (OUTAGE_STATUSES.has(signals.status)) {
        verdicts.push({
            reason: 'unavailable',
            seconds: statedOrDeclared(signals.retryAfter, limit.outageBlockSeconds, limit, now),
        });
    }

    const fromQuota = quotaBlock(signals.quota, limit);

    if (fromQuota !== undefined) {
        verdicts.push(fromQuota);
    }

    return verdicts.reduce<BlockVerdict | undefined>(
        (longest, verdict) => (longest === undefined || verdict.seconds > longest.seconds ? verdict : longest),
        undefined,
    );
}
