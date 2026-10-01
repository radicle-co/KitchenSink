/**
 * The one path to an external source (ADR-0053 §3, plan KTD-25). Every request to a callable source is admitted
 * against the source's shared window before it is sent, and every response's block is written where every task
 * reads it, so no caller calls a source at its limit and one task's 429 stops every task.
 *
 * Admission and the block ledger are ports. The limiter owns the count and the ceiling, the ledger owns the block's
 * atomicity, and this Decorator owns only WHEN a call happens and what its response means for the next one.
 *
 * ⚠️ A client must be built over {@link RateLimitedFetch}, never over a bare `fetch`. The brand is a module-private
 * symbol, so only {@link RateLimitedTransport.fetchFor} can produce one, and a client whose `fetch` must be
 * rate-limited can say so in its type.
 *
 * @pattern Decorator — over `fetch`, adding admission before the call and the block after it
 * @module
 */
import { SourceAccountingError, SourceBusyError, type SourceBusyReason } from '../foodSource.errors.js';
import { apiAccessOf, type CallableApiSourceId } from '../sourceRegister.js';
import { blockFor, type BlockReason } from './blockRule.js';
import { readQuota, type QuotaReading } from './quotaHeaders.js';

/**
 * Which lane a source call is charged to (F-W1). The call ledger persists it as the `source_call_channel` enum
 * (`db/schema/operational.ts`, migration `0010`).
 *
 * ⛔ The lane is attribution only. Every lane spends one per-source window and stops at one ceiling
 * (`sourceCeiling.ts`, ADR-0053 §2); no lane may push further into the window than another.
 */
export type SourceCallChannel = 'interactive' | 'worker';

/** The shape of `fetch` every client calls. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The brand only this module can set. */
const RATE_LIMITED: unique symbol = Symbol('RateLimitedFetch');

/**
 * A `fetch` that admits every request against one source's declared limit. Only the transport makes one, and it
 * carries its source, so a client written for one source cannot be handed another source's `fetch`.
 */
export type RateLimitedFetch<Source extends CallableApiSourceId = CallableApiSourceId> = FetchFn & {
    readonly [RATE_LIMITED]: Source;
};

/** Admission's answer: admitted, or busy with the reason and the earliest time a retry may be admitted. */
export type Admission =
    | { readonly admitted: true }
    | { readonly admitted: false; readonly reason: SourceBusyReason; readonly retryAt: string };

/** The policy that admits a call against its source's shared window, and charges the window when it does. */
export interface AdmissionPolicy {
    /**
     * @param source - The source to be called.
     * @param lane - Who is spending the call. Both lanes share one count and one ceiling (FR-019).
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

/** What the transport is built over. */
export interface RateLimitedTransportPorts {
    readonly admission: AdmissionPolicy;
    readonly blocks: BlockLedger;
    readonly metrics: QuotaMetrics;
    /** The real `fetch`, which only this Decorator calls. */
    readonly upstream: FetchFn;
    /** The current time, epoch milliseconds, for a `Retry-After` given as a date. Defaults to `Date.now`. */
    readonly now?: () => number;
}

/**
 * The signal a request carries, on its init or on the `Request` itself. Pure.
 *
 * @param input - The request target.
 * @param init - The request init.
 * @returns The signal, or `undefined`.
 */
function signalOf(input: string | URL | Request, init: RequestInit | undefined): AbortSignal | undefined {
    return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

/** Builds a rate-limited `fetch` per source and lane, over one set of ports. */
export class RateLimitedTransport {
    private readonly now: () => number;

    /**
     * @param ports - Admission, the block ledger, the quota metric sink and the real `fetch`.
     */
    public constructor(private readonly ports: RateLimitedTransportPorts) {
        this.now = ports.now ?? Date.now;
    }

    /**
     * A `fetch` for one source and lane.
     *
     * @param source - A callable source. A held or file source is not one, by type.
     * @param lane - Who spends the calls made through it.
     * @returns The rate-limited `fetch`.
     */
    public fetchFor<Source extends CallableApiSourceId>(
        source: Source,
        lane: SourceCallChannel,
    ): RateLimitedFetch<Source> {
        const fetchThroughLimit: FetchFn = async (input, init) => this.send(source, lane, input, init);

        return Object.assign(fetchThroughLimit, { [RATE_LIMITED]: source });
    }

    /**
     * Admit, call, then record the block and the quota reading the response carries.
     *
     * Admission runs inside the caller's own deadline on purpose: a request the caller abandons after it was counted
     * over-counts the window by one, which is the safe direction.
     *
     * @param source - The source.
     * @param lane - The lane.
     * @param input - The request target.
     * @param init - The request init.
     * @returns The source's response, unchanged and unread.
     * @throws The signal's abort reason when it has already aborted; nothing is admitted.
     * @throws {SourceBusyError} when admission refuses; the source is not called.
     * @throws {SourceAccountingError} with step `admit` when admission itself fails; the source is not called.
     * @throws {SourceAccountingError} with step `record` when the ledger cannot write the block the response earned.
     *   The response is withheld, so a lost block is never silent.
     * @throws Any error from the source's `fetch`, unchanged, since that failure is the source's to classify.
     * @sideEffect Charges the source's window, calls the source, and may write a block.
     */
    private async send(
        source: CallableApiSourceId,
        lane: SourceCallChannel,
        input: string | URL | Request,
        init: RequestInit | undefined,
    ): Promise<Response> {
        signalOf(input, init)?.throwIfAborted();

        const admission = await this.admit(source, lane);

        if (!admission.admitted) {
            throw new SourceBusyError(source, admission.reason, admission.retryAt);
        }

        const response = await this.ports.upstream(input, init);
        const { rateLimit } = apiAccessOf(source);
        const quota = rateLimit.quota === undefined ? undefined : readQuota(response.headers, rateLimit.quota);
        const block = blockFor(
            { status: response.status, retryAfter: response.headers.get('Retry-After'), quota },
            rateLimit,
            this.now(),
        );

        if (block !== undefined) {
            await this.record({ source, ...block });
        }

        if (quota !== undefined) {
            this.reportQuota(source, quota);
        }

        return response;
    }

    /**
     * Ask admission, wrapping its own failure. Only this call is wrapped, never the source's `fetch`.
     *
     * @param source - The source.
     * @param lane - The lane.
     * @returns Admission's answer.
     * @throws {SourceAccountingError} with step `admit` and the failure as its cause.
     * @sideEffect Charges the source's window when admitting.
     */
    private async admit(source: CallableApiSourceId, lane: SourceCallChannel): Promise<Admission> {
        try {
            return await this.ports.admission.admit(source, lane);
        } catch (error) {
            throw new SourceAccountingError(source, 'admit', error);
        }
    }

    /**
     * Write a block, wrapping the ledger's own failure.
     *
     * @param block - The block.
     * @throws {SourceAccountingError} with step `record` and the failure as its cause.
     * @sideEffect Writes the block.
     */
    private async record(block: SourceBlock): Promise<void> {
        try {
            await this.ports.blocks.record(block);
        } catch (error) {
            throw new SourceAccountingError(block.source, 'record', error);
        }
    }

    /**
     * Report the publisher's quota reading.
     *
     * ⛔ The sink's own failure is swallowed on purpose: it is a metric, and letting it throw would turn a response
     * we received into a failed call, so measuring the quota would lose the call it measured. The block, which is the
     * reading's protective use, has already been recorded above.
     *
     * @param source - The source.
     * @param quota - The reading.
     * @sideEffect Emits a metric.
     */
    private reportQuota(source: CallableApiSourceId, quota: QuotaReading): void {
        try {
            this.ports.metrics.recordSourceRateLimit(source, quota);
        } catch {
            // Deliberately ignored — see the docstring above.
        }
    }
}
