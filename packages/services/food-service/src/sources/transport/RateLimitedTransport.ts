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
import { SourceBusyError } from '../foodSource.errors.js';
import type { CallableApiSourceId } from '../sourceRegister.js';
import { admitOrThrow, applySourceSignals } from './sourceAccounting.js';
import type { AdmissionPolicy, BlockLedger, FetchFn, QuotaMetrics, SourceCallChannel } from './transportPorts.js';

/** The brand only this module can set. */
const RATE_LIMITED: unique symbol = Symbol('RateLimitedFetch');

/**
 * A `fetch` that admits every request against one source's declared limit. Only the transport makes one, and it
 * carries its source, so a client written for one source cannot be handed another source's `fetch`.
 */
export type RateLimitedFetch<Source extends CallableApiSourceId = CallableApiSourceId> = FetchFn & {
    readonly [RATE_LIMITED]: Source;
};

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

        const admission = await admitOrThrow(this.ports.admission, source, lane);

        if (!admission.admitted) {
            throw new SourceBusyError(source, admission.reason, admission.retryAt);
        }

        const response = await this.ports.upstream(input, init);

        await applySourceSignals(
            this.ports,
            source,
            { status: response.status, headers: response.headers },
            this.now(),
        );

        return response;
    }
}
