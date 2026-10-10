/**
 * Food's one path to the remote search service's CDN (ADR-0055 point 6; ADR-0053 §3 across a process boundary). A
 * search costs a source call only when the CDN does not hold its answer:
 *
 * 1. The probe asks with admission off. A cached answer comes back from the CDN, and nothing is charged.
 * 2. A miss reaches the origin, which answers "not admitted" (a `200` outcome) without calling the source. Admission
 *    is then asked, and a refusal is a {@link SourceBusyError}. The CDN keeps that answer for a second, so it may be
 *    another probe's (it carries no source signal, so its echo does not matter; having none still does).
 * 3. The admitted request asks again with admission on. It runs to completion whatever the caller does: the CDN keeps
 *    an answer only when its viewer reads it to the end, and the window was spent the moment admission said yes. When
 *    it lands inside that second it is answered with the kept "not admitted", costs the source nothing, and is sent
 *    once more after the second lapses. (Never refuse the CDN's storage of "not admitted": an uncacheable response
 *    stops the next answer for the key being kept for minutes, so the admitted answer would never be cached.)
 *
 * The source's signals (its status, `Retry-After` and quota headers, which the search service passes through) are
 * applied only from a response that echoes THIS request's id. A cached answer replays the quota headers it was stored
 * with, up to 7 days old, so reading them would turn a stale count into a block. A response that is never cached and
 * echoes another request, or no request, did not come from the origin for this request, and is
 * {@link RemoteSearchUnavailableError}.
 *
 * It shares `RateLimitedTransport`'s ports (`transportPorts.ts`) and accounting (`sourceAccounting.ts`), and adds only
 * the probe and the echo. It is not built over that transport, which would charge the probe.
 *
 * ⚠️ An admitted request that the CDN answers from a cache filled in the meantime spent a window call the source never
 * received. The ledger has no refund, and over-counting is the safe direction.
 *
 * @pattern Gateway — one `send(search)` over the CDN's two requests, admission, and the source's signals
 * @module
 */
import {
    REMOTE_SEARCH_NOT_ADMITTED_RETRY_DELAY_MS,
    REMOTE_SEARCH_NOT_ADMITTED_STATUS,
    REMOTE_SEARCH_RID_HEADER,
    REMOTE_SEARCH_SOURCE_FAILURE_STATUS,
    remoteSearchErrorSchema,
    remoteSearchNotAdmittedSchema,
} from '@kitchensink/schema-remote-search';

import { SourceBusyError } from '../foodSource.errors.js';
import { RemoteSearchUnavailableError } from '../remote/remoteSearch.errors.js';
import type { CallableApiSourceId } from '../sourceRegister.js';
import type { BlockVerdict } from './blockRule.js';
import { admitOrThrow, applySourceSignals } from './sourceAccounting.js';
import type { AdmissionPolicy, BlockLedger, FetchFn, QuotaMetrics, SourceCallChannel } from './transportPorts.js';

/** What the transport is built over. */
export interface CacheFirstAdmissionPorts {
    /** Admission for a miss: the cook's budget and the shared window, in production. */
    readonly admission: AdmissionPolicy;
    /** Where a block a source signal earns is written. */
    readonly blocks: BlockLedger;
    /** Where the publisher's quota reading is reported. */
    readonly metrics: QuotaMetrics;
    /** The real `fetch`, which only this Decorator calls. */
    readonly upstream: FetchFn;
    /** The current time, epoch milliseconds. Defaults to `Date.now`. */
    readonly now?: () => number;
    /** The longest an admitted request may take. Its own bound: the caller's signal never reaches it. */
    readonly admittedTimeoutMs: number;
    /** Waits, in milliseconds, before the admitted request is sent again. Defaults to a timer. */
    readonly pause?: (ms: number) => Promise<void>;
}

/** One search, as the transport sends it. */
export interface CacheFirstSearch {
    readonly source: CallableApiSourceId;
    readonly lane: SourceCallChannel;
    /** The request id both requests carry, which the search service echoes in its `rid` header. */
    readonly rid: string;
    /** The signed URL with admission off. */
    readonly probeUrl: () => string;
    /** The signed URL with admission on, signed when it is sent. */
    readonly admittedUrl: () => string;
    /** Ends the probe. Never reaches the admitted request. */
    readonly signal: AbortSignal;
}

/** The CDN's answer to one search. */
export interface CacheFirstAnswer {
    /** The response, its body already read in full. */
    readonly response: Response;
    /** The block the response earned its source, when the origin answered this request; else `undefined`. */
    readonly block: BlockVerdict | undefined;
}

/** A response with its body read. */
interface ReadResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly body: ArrayBuffer;
}

/**
 * The status the SOURCE answered with, when this response carries one. Pure.
 *
 * A found or empty answer means the source answered a success. A `SOURCE_ERROR` names the source's own status, which
 * the block rule must read instead of the `502` the search service wraps it in. A body the source sent that did not
 * have its published shape was still a success from the source. Every other answer carries no signal of the source's.
 *
 * @param read - The response.
 * @returns The source's status, or `undefined`.
 */
function sourceStatusOf(read: ReadResponse): number | undefined {
    if (read.status === 200) {
        return 200;
    }

    const body = read.status === REMOTE_SEARCH_SOURCE_FAILURE_STATUS ? jsonOf(read.body) : undefined;
    // A body that is not the search service's JSON carries no signal of the source's; the caller reads it as unusable.
    const parsed = body?.ok === true ? remoteSearchErrorSchema.safeParse(body.value) : undefined;

    if (parsed?.success !== true) {
        return undefined;
    }

    switch (parsed.data.code) {
        case 'SOURCE_ERROR':
            return parsed.data.details.sourceStatus;
        case 'SOURCE_INVALID_RESPONSE':
            return 200;
        default:
            return undefined;
    }
}

/**
 * A body read as JSON, or the error that says why it is not. Pure.
 *
 * @param body - The body.
 * @returns The value, or the parse failure.
 */
function jsonOf(
    body: ArrayBuffer,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown } {
    try {
        return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) };
    } catch (error) {
        return { ok: false, error };
    }
}

/**
 * Whether a response is the search service's own "not admitted". Pure.
 *
 * It is a `200` OUTCOME, like a found or empty answer, so the status alone cannot tell it from an answer the cache
 * kept: the body does. (It was a `428` until 2026-10-05, when a deployed stage proved CloudFront error-caches that
 * status and the cached error poisons the slot an admitted answer needs.)
 *
 * @param read - The response.
 * @returns Whether it is "not admitted".
 */
function isNotAdmitted(read: ReadResponse): boolean {
    if (read.status !== REMOTE_SEARCH_NOT_ADMITTED_STATUS) {
        return false;
    }

    const body = jsonOf(read.body);

    return body.ok && remoteSearchNotAdmittedSchema.safeParse(body.value).success;
}

/**
 * A response as a fresh `Response` over its read body. Pure.
 *
 * @param read - The response.
 * @returns The response.
 */
function responseOf(read: ReadResponse): Response {
    return new Response(read.body.byteLength === 0 ? null : read.body, {
        status: read.status,
        headers: read.headers,
    });
}

/** Asks the search service's CDN cache-first, admitting a miss before it reaches the source. */
export class CacheFirstAdmissionTransport {
    private readonly now: () => number;
    private readonly pause: (ms: number) => Promise<void>;

    /**
     * @param ports - Admission, the block ledger, the quota sink, the real `fetch`, and the admitted request's bound.
     */
    public constructor(private readonly ports: CacheFirstAdmissionPorts) {
        this.now = ports.now ?? Date.now;
        this.pause = ports.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    /**
     * Search once: probe, and on an admitted miss, ask again and finish.
     *
     * Once admission has said yes, the returned promise settles when the admitted request does, whatever the caller's
     * signal says, so the caller decides how long to wait.
     *
     * @param search - The source, the lane, the request id, the two URLs and the caller's signal.
     * @returns The CDN's answer and the block it earned.
     * @throws The signal's abort reason when it aborts before admission; nothing is admitted.
     * @throws {SourceBusyError} when admission refuses; the admitted request is not sent.
     * @throws {SourceAccountingError} with step `admit` when admission fails, or `record` when the earned block
     *   cannot be written (the answer is withheld, so a lost block is never silent).
     * @throws {RemoteSearchUnavailableError} when an answer is not this request's.
     * @throws Any error from `fetch`, unchanged.
     * @sideEffect Calls the CDN up to twice, may charge admission and may write a block.
     */
    public async send(search: CacheFirstSearch): Promise<CacheFirstAnswer> {
        search.signal.throwIfAborted();

        const probe = await this.read(search.probeUrl(), search.signal);
        const echo = probe.headers.get(REMOTE_SEARCH_RID_HEADER);

        if (!isNotAdmitted(probe)) {
            return { response: responseOf(this.trustedProbe(search, probe, echo)), block: undefined };
        }

        if (echo === null) {
            throw new RemoteSearchUnavailableError(search.source, 'noEcho', probe.status);
        }

        search.signal.throwIfAborted();

        const admission = await admitOrThrow(this.ports.admission, search.source, search.lane);

        if (!admission.admitted) {
            throw new SourceBusyError(search.source, admission.reason, admission.retryAt);
        }

        return this.completeAdmitted(search);
    }

    /**
     * A probe's answer, when it can be read as one. A cached answer is a `200` echoing whichever request stored it; any
     * other status is never cached, so it must echo this request.
     *
     * @param search - The search.
     * @param probe - The probe's response.
     * @param echo - Its echo, or `null`.
     * @returns The probe's response.
     * @throws {RemoteSearchUnavailableError} when it is not.
     */
    private trustedProbe(search: CacheFirstSearch, probe: ReadResponse, echo: string | null): ReadResponse {
        if (echo === null) {
            throw new RemoteSearchUnavailableError(search.source, 'noEcho', probe.status);
        }

        if (probe.status !== 200 && echo !== search.rid) {
            throw new RemoteSearchUnavailableError(search.source, 'foreignEcho', probe.status);
        }

        return probe;
    }

    /**
     * Send the admitted request and apply what its answer says about the source.
     *
     * @param search - The search.
     * @returns The answer and its block.
     * @throws {RemoteSearchUnavailableError} when the answer is not this request's and not a cached answer.
     * @throws {SourceAccountingError} with step `record` when the earned block cannot be written.
     * @sideEffect Calls the CDN; may write a block and report a quota reading.
     */
    private async completeAdmitted(search: CacheFirstSearch): Promise<CacheFirstAnswer> {
        let answered = await this.read(search.admittedUrl(), AbortSignal.timeout(this.ports.admittedTimeoutMs));

        // The origin answers "not admitted" only to a request with admission off, so this request found the CDN
        // still holding our probe's answer from a second ago. Wait that second out and ask again — whatever the echo
        // says, because our probe and this request carry the same request id, so a replay echoes this request too.
        if (isNotAdmitted(answered)) {
            await this.pause(REMOTE_SEARCH_NOT_ADMITTED_RETRY_DELAY_MS);
            answered = await this.read(search.admittedUrl(), AbortSignal.timeout(this.ports.admittedTimeoutMs));
        }

        const echo = answered.headers.get(REMOTE_SEARCH_RID_HEADER);

        if (isNotAdmitted(answered)) {
            throw new RemoteSearchUnavailableError(search.source, 'unexpectedStatus', answered.status);
        }

        if (echo !== search.rid) {
            // A 200 echoing another request is that request's answer, cached between the probe and now.
            if (answered.status === 200 && echo !== null) {
                return { response: responseOf(answered), block: undefined };
            }

            throw new RemoteSearchUnavailableError(
                search.source,
                echo === null ? 'noEcho' : 'foreignEcho',
                answered.status,
            );
        }

        const sourceStatus = sourceStatusOf(answered);
        const block =
            sourceStatus === undefined
                ? undefined
                : await applySourceSignals(
                      this.ports,
                      search.source,
                      { status: sourceStatus, headers: answered.headers },
                      this.now(),
                  );

        return { response: responseOf(answered), block };
    }

    /**
     * Send one request and read its body in full, refusing a redirect: a signed URL is never followed elsewhere.
     *
     * @param url - The signed URL.
     * @param signal - Ends the request.
     * @returns The status, headers and body.
     * @throws Any error from `fetch` or the body read, unchanged.
     * @sideEffect Calls the CDN.
     */
    private async read(url: string, signal: AbortSignal): Promise<ReadResponse> {
        const response = await this.ports.upstream(url, { signal, redirect: 'error' });

        return { status: response.status, headers: response.headers, body: await response.arrayBuffer() };
    }
}
