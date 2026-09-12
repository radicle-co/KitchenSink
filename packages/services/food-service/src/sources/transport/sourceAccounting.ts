/**
 * The accounting both source transports share (ADR-0053 §3 and §5): asking admission, writing a block, and applying
 * what one answer of the source's says about the next call. A failure of admission or of the block ledger is ours, so
 * it is raised as {@link SourceAccountingError}, never as the source's.
 *
 * The status the signals are judged by is the caller's to read: the rate-limited transport passes the response's own,
 * and the cache-first transport passes the status the source answered inside the search service's wrapper.
 *
 * @module
 */
import { SourceAccountingError } from '../foodSource.errors.js';
import { apiAccessOf, type CallableApiSourceId } from '../sourceRegister.js';
import { blockFor, type BlockVerdict } from './blockRule.js';
import { readQuota, type HeaderBag } from './quotaHeaders.js';
import { reportQuotaReading } from './quotaReport.js';
import type {
    Admission,
    AdmissionPolicy,
    BlockLedger,
    QuotaMetrics,
    SourceBlock,
    SourceCallChannel,
} from './transportPorts.js';

/** What one answer of the source's carries for the block rule. */
export interface SourceSignals {
    /** The status the SOURCE answered with. */
    readonly status: number;
    /** The headers carrying its `Retry-After` and quota counts. */
    readonly headers: HeaderBag;
}

/**
 * Ask admission, wrapping its own failure.
 *
 * @param admission - The policy.
 * @param source - The source to be called.
 * @param lane - Who spends the call.
 * @returns Admission's answer.
 * @throws {SourceAccountingError} with step `admit` and the failure as its cause.
 * @sideEffect Charges the source's window when admitting.
 */
export async function admitOrThrow(
    admission: AdmissionPolicy,
    source: CallableApiSourceId,
    lane: SourceCallChannel,
): Promise<Admission> {
    try {
        return await admission.admit(source, lane);
    } catch (error) {
        throw new SourceAccountingError(source, 'admit', error);
    }
}

/**
 * Write a block, wrapping the ledger's own failure.
 *
 * @param blocks - The ledger.
 * @param block - The block.
 * @throws {SourceAccountingError} with step `record` and the failure as its cause.
 * @sideEffect Writes the block.
 */
async function recordOrThrow(blocks: BlockLedger, block: SourceBlock): Promise<void> {
    try {
        await blocks.record(block);
    } catch (error) {
        throw new SourceAccountingError(block.source, 'record', error);
    }
}

/**
 * Apply one answer's signals: write the block its status, `Retry-After` and quota earn, then report the publisher's
 * quota reading. The block is written first, so a reading is never reported for an answer whose block was lost.
 *
 * @param ports - The block ledger and the quota sink.
 * @param source - The source that answered.
 * @param signals - The source's status and the answer's headers.
 * @param now - The current time, epoch milliseconds, for a `Retry-After` given as a date.
 * @returns The block written, or `undefined` when the answer earned none.
 * @throws {SourceAccountingError} with step `record` when the block cannot be written.
 * @sideEffect May write a block and report a quota reading.
 */
export async function applySourceSignals(
    ports: { readonly blocks: BlockLedger; readonly metrics: QuotaMetrics },
    source: CallableApiSourceId,
    signals: SourceSignals,
    now: number,
): Promise<BlockVerdict | undefined> {
    const { rateLimit } = apiAccessOf(source);
    const quota = rateLimit.quota === undefined ? undefined : readQuota(signals.headers, rateLimit.quota);
    const block = blockFor(
        { status: signals.status, retryAfter: signals.headers.get('Retry-After'), quota },
        rateLimit,
        now,
    );

    if (block !== undefined) {
        await recordOrThrow(ports.blocks, { source, ...block });
    }

    if (quota !== undefined) {
        reportQuotaReading(ports.metrics, source, quota);
    }

    return block;
}
