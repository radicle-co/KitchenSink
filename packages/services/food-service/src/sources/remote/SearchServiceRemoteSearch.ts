/**
 * Food's Adapter over the remote search service, through its CDN (ADR-0055 points 3, 6 and 7; review rulings 2 and
 * 8). Food calls the search service; the apps never do.
 *
 * - **Every request is a CloudFront signed URL** (`@aws-sdk/cloudfront-signer`, a canned policy with a short expiry),
 *   built over the whole URL, so `q`, `admit` and `rid` are inside the signature. The distribution keeps `admit` and
 *   `rid` out of its cache key and forwards them.
 * - **Cache-first**: {@link CacheFirstAdmissionTransport} asks with admission off, and admits a miss against the cook's
 *   hourly budget, then the shared window ({@link RequesterWindowAdmission}).
 * - **Every ending is an outcome**, logged where it is a fault, so one source's failure is its own frame and never the
 *   whole answer.
 *
 * @pattern Adapter — the search service's CDN behind the `RemoteSearchPort`
 * @module
 */
import { randomUUID } from 'node:crypto';

import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { Logger } from '@nestjs/common';
import {
    REMOTE_SEARCH_LATENCY_BOUND_MS,
    remoteSearchAnswerSchema,
    remoteSearchPath,
    type RemoteSearchSource,
} from '@kitchensink/schema-remote-search';

import { RequesterWindowAdmission } from '../../common/throttle/RequesterWindowAdmission.js';
import type { RequesterSourceBudgetDao } from '../../foods/dao/requesterSourceBudget.dao.js';
import { isCanonicalSearchTerm } from '../../foods/foods.schema.js';
import { isSourceAccountingError, isSourceBusyError } from '../foodSource.errors.js';
import { CacheFirstAdmissionTransport, type CacheFirstAnswer } from '../transport/CacheFirstAdmissionTransport.js';
import { secondsUntil } from '../transport/secondsUntil.js';
import type { AdmissionPolicy, BlockLedger, FetchFn, QuotaMetrics } from '../transport/transportPorts.js';
import { isRemoteSearchUnavailableError } from './remoteSearch.errors.js';
import {
    endingOfAnswer,
    endingOfFailure,
    type RemoteSearchEnding,
    type RemoteSearchEndings,
} from './remoteSearchEndings.js';
import type { RemoteSearchPort, RemoteSearchRequest, RemoteSourceOutcome } from './remoteSearchPort.js';

/**
 * How long a signed URL is good for, in seconds. Each request is signed as it is sent, so this only has to outlast
 * the request's journey to the distribution, and a URL seen in a log is useless a minute later.
 */
export const SIGNED_URL_LIFETIME_SECONDS = 60;

/**
 * What an admitted request allows beyond the CDN's wait on the origin, in milliseconds: the CDN's connection to the
 * origin (CloudFront's default connection timeout, one attempt) and the answer's journey back.
 */
const ADMITTED_SEARCH_HEADROOM_MS = 15_000;

/**
 * The longest an admitted request may take, in milliseconds. ⛔ Above {@link REMOTE_SEARCH_LATENCY_BOUND_MS}: food must
 * never end an admitted request the distribution is still waiting on, because a request its viewer ends is not cached.
 */
export const ADMITTED_SEARCH_TIMEOUT_MS = REMOTE_SEARCH_LATENCY_BOUND_MS + ADMITTED_SEARCH_HEADROOM_MS;

/** The lane every remote search call is charged to: a cook is waiting on it. */
const REMOTE_SEARCH_LANE = 'interactive';

/** Where the Adapter reports a fault. Nest's `Logger` satisfies it. */
export interface RemoteSearchLogger {
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
}

/** What the Adapter is built over. */
export interface SearchServiceRemoteSearchDeps {
    /** The CDN origin, `https://` with no path. */
    readonly origin: string;
    /** The CloudFront public key id. */
    readonly keyPairId: string;
    /** The RSA private key, PEM, that signs every request. */
    readonly signingKey: string;
    /** The shared window: the limiter, in production. */
    readonly window: AdmissionPolicy;
    /** Every requester's hourly source budget. */
    readonly budget: Pick<RequesterSourceBudgetDao, 'charge' | 'refund'>;
    /** Where a source's block is written. */
    readonly blocks: BlockLedger;
    /** Where the publisher's quota reading is reported. */
    readonly metrics: QuotaMetrics;
    /** Where every search's ending is recorded. */
    readonly endings: RemoteSearchEndings;
    /** The real `fetch`. Defaults to the global one. */
    readonly upstream?: FetchFn;
    /** The current time, epoch milliseconds. Defaults to `Date.now`. */
    readonly now?: () => number;
    /** Makes each search's request id. Defaults to a random UUID, which the contract's `rid` rule admits. */
    readonly newRequestId?: () => string;
    /** Defaults to a Nest `Logger`. */
    readonly logger?: RemoteSearchLogger;
    /** Waits before an admitted request is sent again after the CDN replays a "not admitted". Defaults to a timer. */
    readonly pause?: (ms: number) => Promise<void>;
}

/**
 * Whether a failure is the caller's signal ending the wait. Pure.
 *
 * @param error - The thrown value.
 * @param signal - The caller's signal.
 * @returns True when the signal has aborted.
 */
function isCallerAbort(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted && (error === signal.reason || (error instanceof Error && error.name === 'AbortError'));
}

export class SearchServiceRemoteSearch implements RemoteSearchPort {
    private readonly upstream: FetchFn;
    private readonly now: () => number;
    private readonly newRequestId: () => string;
    private readonly logger: RemoteSearchLogger;

    /** @param deps - The CDN's settings, admission's stores, the block ledger, the quota sink, and the seams. */
    public constructor(private readonly deps: SearchServiceRemoteSearchDeps) {
        this.upstream = deps.upstream ?? globalThis.fetch;
        this.now = deps.now ?? Date.now;
        this.newRequestId = deps.newRequestId ?? randomUUID;
        this.logger = deps.logger ?? new Logger(SearchServiceRemoteSearch.name);
    }

    /**
     * Search one source through the CDN.
     *
     * @param request - The source, the term, the requester and the caller's signal.
     * @returns How the search ended. Never rejects.
     * @sideEffect May call the CDN twice, charge the requester's budget and the shared window, and write a block; logs
     *   a fault; records the ending.
     */
    public async search(request: RemoteSearchRequest): Promise<RemoteSourceOutcome> {
        const { outcome, ending } = await this.settle(request);

        this.deps.endings.record(request.source, ending, outcome);

        return outcome;
    }

    /**
     * How one search ends, and the name of that ending.
     *
     * @param request - The search.
     * @returns The outcome and its ending. Never rejects.
     * @sideEffect As {@link search}, except recording the ending.
     */
    private async settle(
        request: RemoteSearchRequest,
    ): Promise<{ readonly outcome: RemoteSourceOutcome; readonly ending: RemoteSearchEnding }> {
        const { source, term } = request;

        if (!isCanonicalSearchTerm(term)) {
            // The search service refuses any other term, so asking would spend a request on a `400`.
            this.logger.warn('remote-search-term-not-canonical', { source });

            return { outcome: { kind: 'unavailable' }, ending: 'termNotCanonical' };
        }

        try {
            const answer = await this.send(request);
            const outcome = await this.outcomeOf(source, answer);

            return { outcome, ending: endingOfAnswer(answer, outcome) };
        } catch (error) {
            return {
                outcome: this.failureOutcome(request, error),
                ending: endingOfFailure(error, isCallerAbort(error, request.signal)),
            };
        }
    }

    /**
     * Send one search through the cache-first transport, admitting a miss for this request's requester.
     *
     * @param request - The search.
     * @returns The CDN's answer.
     * @sideEffect Calls the CDN; may charge admission and write a block.
     */
    private async send(request: RemoteSearchRequest): Promise<CacheFirstAnswer> {
        const rid = this.newRequestId();
        const transport = new CacheFirstAdmissionTransport({
            admission: new RequesterWindowAdmission({
                budget: this.deps.budget,
                requesterId: request.requesterId,
                window: this.deps.window,
                now: this.now,
            }),
            blocks: this.deps.blocks,
            metrics: this.deps.metrics,
            upstream: this.upstream,
            now: this.now,
            admittedTimeoutMs: ADMITTED_SEARCH_TIMEOUT_MS,
            ...(this.deps.pause === undefined ? {} : { pause: this.deps.pause }),
        });

        return transport.send({
            source: request.source,
            lane: REMOTE_SEARCH_LANE,
            rid,
            probeUrl: () => this.signedUrl(request, '0', rid),
            admittedUrl: () => this.signedUrl(request, '1', rid),
            signal: request.signal,
        });
    }

    /**
     * A search URL, signed for {@link SIGNED_URL_LIFETIME_SECONDS} from now.
     *
     * @param request - The search.
     * @param admit - Whether the origin may call the source on a miss.
     * @param rid - The request id.
     * @returns The signed URL.
     */
    private signedUrl(request: RemoteSearchRequest, admit: '0' | '1', rid: string): string {
        const url = new URL(remoteSearchPath(request.source), this.deps.origin);

        url.search = new URLSearchParams({ q: request.term, admit, rid }).toString();

        return getSignedUrl({
            url: url.toString(),
            keyPairId: this.deps.keyPairId,
            privateKey: this.deps.signingKey,
            dateLessThan: new Date(this.now() + SIGNED_URL_LIFETIME_SECONDS * 1_000),
            algorithm: 'SHA256',
        });
    }

    /**
     * What an answer means for its source: its items, busy for the block it earned, or unavailable.
     *
     * @param source - The source.
     * @param answer - The CDN's answer.
     * @returns The outcome.
     * @sideEffect Logs an answer that is not usable.
     */
    private async outcomeOf(source: RemoteSearchSource, answer: CacheFirstAnswer): Promise<RemoteSourceOutcome> {
        const { response, block } = answer;

        if (response.status !== 200) {
            if (block !== undefined) {
                return { kind: 'busy', retryAfterSeconds: block.seconds };
            }

            this.logger.warn('remote-search-not-answered', { source, status: response.status });

            return { kind: 'unavailable' };
        }

        const parsed = remoteSearchAnswerSchema.safeParse(await response.json());

        if (!parsed.success) {
            this.logger.error('remote-search-contract-broken', { source, status: response.status });

            return { kind: 'unavailable' };
        }

        return { kind: 'answered', items: parsed.data.outcome === 'found' ? parsed.data.items : [] };
    }

    /**
     * The outcome a failure reports, logged unless it is the caller leaving.
     *
     * @param request - The search.
     * @param error - The failure.
     * @returns The outcome.
     * @sideEffect Logs the failure.
     */
    private failureOutcome(request: RemoteSearchRequest, error: unknown): RemoteSourceOutcome {
        const { source } = request;

        if (isSourceBusyError(error)) {
            const retryAfterSeconds = secondsUntil(error.retryAt, this.now());

            return error.reason === 'requesterLimit'
                ? { kind: 'limited', retryAfterSeconds }
                : { kind: 'busy', retryAfterSeconds };
        }

        if (isCallerAbort(error, request.signal)) {
            return { kind: 'unavailable' };
        }

        if (isSourceAccountingError(error)) {
            // Our own budget, window or block ledger failed: logged as ours, never as the source's.
            this.logger.error('remote-search-accounting-failed', {
                source,
                step: error.step,
                cause: String(error.cause),
            });
        } else if (isRemoteSearchUnavailableError(error)) {
            this.logger.warn('remote-search-unavailable', { source, reason: error.reason, status: error.status });
        } else {
            this.logger.warn('remote-search-failed', {
                source,
                errorName: error instanceof Error ? error.name : typeof error,
            });
        }

        return { kind: 'unavailable' };
    }
}
