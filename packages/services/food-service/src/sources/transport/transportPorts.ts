/**
 * The ports both source transports are built over (ADR-0053 §3): admission, the block ledger, the quota sink and the
 * real `fetch`. `RateLimitedTransport` and `CacheFirstAdmissionTransport` each read them; neither transport is built
 * over the other, because the cache-first probe must never be charged.
 *
 * @module
 */
import type { SourceBusyReason } from '../foodSource.errors.js';
import type { CallableApiSourceId } from '../sourceRegister.js';
import type { BlockReason } from './blockRule.js';
import type { QuotaReading } from './quotaHeaders.js';

/**
 * Which lane a source call is charged to (F-W1). The call ledger persists it as the `source_call_channel` enum
 * (`db/schema/operational.ts`, migration `0010`).
 *
 * ⛔ Every lane spends one per-source window, counted once over all lanes. The lane picks only the ceiling its
 * admission stops at (`LANE_CEILING` in `RollingWindowLimiter.ts`).
 */
export type SourceCallChannel = 'interactive' | 'worker';

/** The shape of `fetch` every client calls. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Admission's answer: admitted, or busy with the reason and the earliest time a retry may be admitted. */
export type Admission =
    | { readonly admitted: true }
    | { readonly admitted: false; readonly reason: SourceBusyReason; readonly retryAt: string };

/** The policy that admits a call against its source's shared window, and charges the window when it does. */
export interface AdmissionPolicy {
    /**
     * @param source - The source to be called.
     * @param lane - Who is spending the call. Both lanes share one count; the lane picks the ceiling (FR-019).
     * @returns Whether the call is admitted. An admitted call has been counted.
     * @sideEffect Charges the source's window when admitting.
     */
    admit(source: CallableApiSourceId, lane: SourceCallChannel): Promise<Admission>;
}

/** A block one response earned its source. */
export interface SourceBlock {
    readonly source: CallableApiSourceId;
    readonly reason: BlockReason;
    /** How long the block lasts from when it is written, in whole seconds. */
    readonly seconds: number;
}

/** Where blocks are written, for every task to read at admission. */
export interface BlockLedger {
    /**
     * @param block - The block.
     * @sideEffect Writes the block, keeping the later end when one is already live.
     */
    record(block: SourceBlock): Promise<void>;
}

/** Where the publisher's quota reading is reported. `FoodMetrics` satisfies it. */
export interface QuotaMetrics {
    /**
     * @param source - The source.
     * @param reported - The publisher's reading.
     * @sideEffect Emits a metric.
     */
    recordSourceRateLimit(source: string, reported: QuotaReading): void;
}
