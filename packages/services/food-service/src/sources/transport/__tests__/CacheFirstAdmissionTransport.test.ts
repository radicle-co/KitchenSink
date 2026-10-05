/**
 * Food's side of the cache in front of the search service (ADR-0055 point 6, ruling 8, findings 1 and 6). For each
 * search the Decorator:
 *
 * 1. asks the CDN with admission off (the probe), which costs nothing: a cached answer comes back as it is;
 * 2. on "not admitted" (a `200` outcome) that echoes this request, asks admission, and refuses with `SourceBusyError` when it
 *    says no, without asking again;
 * 3. otherwise asks again with admission on, and lets that request run to completion whatever the caller does, so the
 *    cache fills;
 * 4. applies the quota reading and the block a response carries ONLY when the response echoes this request's id, so a
 *    cached answer's stale quota (up to 7 days old) can never block the source.
 *
 * Admission, the block ledger, the quota sink and the CDN are ports here, so these cases pin the protocol.
 */
import { describe, expect, it } from 'vitest';

import { REMOTE_SEARCH_RID_HEADER } from '@kitchensink/schema-remote-search';

import { isSourceAccountingError, isSourceBusyError, type SourceBusyReason } from '../../foodSource.errors.js';
import { isRemoteSearchUnavailableError } from '../../remote/remoteSearch.errors.js';
import type { QuotaReading } from '../quotaHeaders.js';
import { CacheFirstAdmissionTransport, type CacheFirstSearch } from '../CacheFirstAdmissionTransport.js';
import type { Admission, FetchFn, SourceBlock } from '../transportPorts.js';

/**
 * The URL a `fetch` was asked for.
 *
 * @param input - The request target.
 * @returns Its URL.
 */
function urlOf(input: string | URL | Request): string {
    if (typeof input === 'string') {
        return input;
    }

    return input instanceof URL ? input.href : input.url;
}

/** 2026-10-02 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 2, 5, 0, 0);

const RID = '0d7c1f0e-5b7a-4d36-9a3e-2b4f6c1d8e90';
const FOREIGN_RID = 'ffffffff-0000-4000-8000-000000000000';
const PROBE_URL = 'https://cdn.test/v1/usda/1/search?q=kale&admit=0&rid=probe';
const ADMITTED_URL = 'https://cdn.test/v1/usda/1/search?q=kale&admit=1&rid=admitted';

const FOUND_BODY = JSON.stringify({ outcome: 'found', items: [{ externalKey: '1', name: 'Kale', lineageKey: null }] });

/** One CDN answer: status, the echo it carries (or none), and any other headers. */
interface Answer {
    readonly status: number;
    readonly echo: string | null;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A response as the CDN would send it.
 *
 * @param answer - The answer.
 * @returns The response.
 */
function responseOf(answer: Answer): Response {
    const headers = new Headers({ 'content-type': 'application/json', ...answer.headers });

    if (answer.echo !== null) {
        headers.set(REMOTE_SEARCH_RID_HEADER, answer.echo);
    }

    return new Response(answer.body ?? '{}', { status: answer.status, headers });
}

const NOT_ADMITTED: Answer = { status: 200, echo: RID, body: '{"outcome":"notAdmitted"}' };

/** What one case's ports saw. */
interface Harness {
    readonly transport: CacheFirstAdmissionTransport;
    readonly requests: { url: string; signal: AbortSignal | null | undefined }[];
    readonly admissions: string[];
    readonly blocks: SourceBlock[];
    readonly quotas: QuotaReading[];
}

/**
 * A transport over recording fakes. The CDN answers each request with the next answer in order.
 *
 * @param options - The CDN's answers, admission's answer, and whether the ledger fails.
 * @returns The harness.
 */
function makeHarness(options: {
    readonly answers: readonly (Answer | (() => Promise<Response>))[];
    readonly admission?: Admission | Error;
    readonly recordFails?: Error;
}): Harness {
    const requests: Harness['requests'] = [];
    const admissions: string[] = [];
    const blocks: SourceBlock[] = [];
    const quotas: QuotaReading[] = [];

    const upstream: FetchFn = async (input, init) => {
        const answer = options.answers[requests.length];

        requests.push({ url: urlOf(input), signal: init?.signal });

        if (answer === undefined) {
            throw new Error(`unexpected request ${urlOf(input)}`);
        }

        return typeof answer === 'function' ? answer() : responseOf(answer);
    };

    return {
        requests,
        admissions,
        blocks,
        quotas,
        transport: new CacheFirstAdmissionTransport({
            admission: {
                admit: async (source, lane) => {
                    admissions.push(`${source}:${lane}`);

                    if (options.admission instanceof Error) {
                        throw options.admission;
                    }

                    return options.admission ?? { admitted: true };
                },
            },
            blocks: {
                record: async (block) => {
                    if (options.recordFails !== undefined) {
                        throw options.recordFails;
                    }

                    blocks.push(block);
                },
            },
            metrics: { recordSourceRateLimit: (_source, reading) => quotas.push(reading) },
            upstream,
            now: () => NOW,
            admittedTimeoutMs: 1_000,
        }),
    };
}

/**
 * One search of USDA for the fixture's term.
 *
 * @param signal - The caller's signal.
 * @returns The search.
 */
function searchOf(signal: AbortSignal = new AbortController().signal): CacheFirstSearch {
    return {
        source: 'usda',
        lane: 'interactive',
        rid: RID,
        probeUrl: () => PROBE_URL,
        admittedUrl: () => ADMITTED_URL,
        signal,
    };
}

/** The quota headers USDA's api.data.gov gateway sends, passed through by the search service. */
const EXHAUSTED_QUOTA = { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Limit': '1000' };

describe('CacheFirstAdmissionTransport — a cached answer costs nothing', () => {
    it('answers a hit from the probe alone: no admission, one request, admission off', async () => {
        const harness = makeHarness({ answers: [{ status: 200, echo: FOREIGN_RID, body: FOUND_BODY }] });

        const answer = await harness.transport.send(searchOf());

        expect(answer.response.status).toBe(200);
        expect(await answer.response.text()).toBe(FOUND_BODY);
        expect(harness.admissions).toEqual([]);
        expect(harness.requests.map((request) => request.url)).toEqual([PROBE_URL]);
    });

    it('⛔ never blocks the source from a hit, however exhausted its stored quota reads', async () => {
        // The key case: a cached 200 replays the quota headers it was stored with, up to 7 days old.
        const harness = makeHarness({
            answers: [{ status: 200, echo: FOREIGN_RID, body: FOUND_BODY, headers: EXHAUSTED_QUOTA }],
        });

        const answer = await harness.transport.send(searchOf());

        expect(answer.block).toBeUndefined();
        expect(harness.blocks).toEqual([]);
        expect(harness.quotas).toEqual([]);
    });

    it('reads a 200 with no echo at all as the search service unavailable', async () => {
        const harness = makeHarness({ answers: [{ status: 200, echo: null, body: FOUND_BODY }] });

        await expect(harness.transport.send(searchOf())).rejects.toSatisfy(isRemoteSearchUnavailableError);
        expect(harness.admissions).toEqual([]);
    });
});

describe('CacheFirstAdmissionTransport — a miss is admitted, then asked again', () => {
    it('admits a "not admitted" that echoes this request, then asks with admission on', async () => {
        const harness = makeHarness({
            answers: [NOT_ADMITTED, { status: 200, echo: RID, body: FOUND_BODY }],
        });

        const answer = await harness.transport.send(searchOf());

        expect(harness.admissions).toEqual(['usda:interactive']);
        expect(harness.requests.map((request) => request.url)).toEqual([PROBE_URL, ADMITTED_URL]);
        expect(await answer.response.text()).toBe(FOUND_BODY);
    });

    it.each<[string, Answer]>([
        ['carries no echo (the function URL’s own throttle)', { ...NOT_ADMITTED, echo: null }],
        ['echoes another request', { ...NOT_ADMITTED, echo: FOREIGN_RID }],
    ])(
        'admits nothing when the "not admitted" %s, and reports the search service unavailable',
        async (_label, answer) => {
            const harness = makeHarness({ answers: [answer] });

            await expect(harness.transport.send(searchOf())).rejects.toSatisfy(isRemoteSearchUnavailableError);
            expect(harness.admissions).toEqual([]);
            expect(harness.requests).toHaveLength(1);
        },
    );

    it.each<SourceBusyReason>(['ceiling', 'blocked', 'contended', 'requesterLimit'])(
        'refuses with SourceBusyError (%s) and never sends the admitted request',
        async (reason) => {
            const harness = makeHarness({
                answers: [NOT_ADMITTED],
                admission: { admitted: false, reason, retryAt: '2026-10-02T05:10:00.000Z' },
            });

            const failure = harness.transport.send(searchOf());

            await expect(failure).rejects.toSatisfy(isSourceBusyError);
            await expect(failure).rejects.toMatchObject({ reason, retryAt: '2026-10-02T05:10:00.000Z' });
            expect(harness.requests.map((request) => request.url)).toEqual([PROBE_URL]);
        },
    );

    it('wraps a failure of admission itself as our own accounting failure, and sends nothing more', async () => {
        const harness = makeHarness({ answers: [NOT_ADMITTED], admission: new Error('pool exhausted') });

        await expect(harness.transport.send(searchOf())).rejects.toSatisfy(
            (error: unknown) => isSourceAccountingError(error) && error.step === 'admit',
        );
        expect(harness.requests).toHaveLength(1);
    });

    it('takes an admitted 200 that echoes ANOTHER request as the answer (the cache filled in between), and applies none of its quota', async () => {
        const harness = makeHarness({
            answers: [NOT_ADMITTED, { status: 200, echo: FOREIGN_RID, body: FOUND_BODY, headers: EXHAUSTED_QUOTA }],
        });

        const answer = await harness.transport.send(searchOf());

        expect(await answer.response.text()).toBe(FOUND_BODY);
        expect(harness.blocks).toEqual([]);
        expect(harness.quotas).toEqual([]);
    });

    it('reads an admitted error that echoes another request as unavailable, never as a block', async () => {
        const sourceThrottled = JSON.stringify({
            code: 'SOURCE_ERROR',
            message: 'The source answered 429.',
            details: { sourceStatus: 429 },
        });
        const harness = makeHarness({
            answers: [NOT_ADMITTED, { status: 502, echo: FOREIGN_RID, body: sourceThrottled }],
        });

        await expect(harness.transport.send(searchOf())).rejects.toSatisfy(isRemoteSearchUnavailableError);
        expect(harness.blocks).toEqual([]);
    });
});

describe('CacheFirstAdmissionTransport — the origin’s own answer to THIS request carries the source’s signals', () => {
    it('⛔ writes the block a source 429 earns, for as long as its Retry-After says', async () => {
        const harness = makeHarness({
            answers: [
                NOT_ADMITTED,
                {
                    status: 502,
                    echo: RID,
                    body: JSON.stringify({
                        code: 'SOURCE_ERROR',
                        message: 'The source answered 429.',
                        details: { sourceStatus: 429 },
                    }),
                    headers: { 'Retry-After': '120' },
                },
            ],
        });

        const answer = await harness.transport.send(searchOf());

        expect(answer.block).toEqual({ reason: 'rateLimited', seconds: 120 });
        expect(harness.blocks).toEqual([{ source: 'usda', reason: 'rateLimited', seconds: 120 }]);
        expect(answer.response.status).toBe(502);
    });

    it('blocks on the SOURCE’s outage status, never on the 502 the search service wraps it in', async () => {
        const harness = makeHarness({
            answers: [
                NOT_ADMITTED,
                {
                    status: 502,
                    echo: RID,
                    body: JSON.stringify({ code: 'SOURCE_INVALID_RESPONSE', message: 'Unreadable.' }),
                },
            ],
        });

        const answer = await harness.transport.send(searchOf());

        // The source answered with a body the service could not read, not with a 502: nothing blocks.
        expect(answer.block).toBeUndefined();
        expect(harness.blocks).toEqual([]);
    });

    it('applies the publisher’s low quota from an answered miss, and reports the reading', async () => {
        const harness = makeHarness({
            answers: [
                NOT_ADMITTED,
                {
                    status: 200,
                    echo: RID,
                    body: FOUND_BODY,
                    headers: { 'X-RateLimit-Remaining': '50', 'X-RateLimit-Limit': '1000' },
                },
            ],
        });

        const answer = await harness.transport.send(searchOf());

        expect(answer.block).toEqual({ reason: 'quotaLow', seconds: 300 });
        expect(harness.blocks).toEqual([{ source: 'usda', reason: 'quotaLow', seconds: 300 }]);
        expect(harness.quotas).toEqual([{ remaining: 50, limit: 1000 }]);
    });

    it('withholds the answer when the block it earned cannot be written', async () => {
        const harness = makeHarness({
            answers: [
                NOT_ADMITTED,
                { status: 200, echo: RID, body: FOUND_BODY, headers: { 'X-RateLimit-Remaining': '0' } },
            ],
            recordFails: new Error('ledger down'),
        });

        await expect(harness.transport.send(searchOf())).rejects.toSatisfy(
            (error: unknown) => isSourceAccountingError(error) && error.step === 'record',
        );
    });
});

describe('CacheFirstAdmissionTransport — an admitted request runs to completion', () => {
    it('stops at the probe when the caller is already gone, admitting nothing', async () => {
        const caller = new AbortController();

        caller.abort(new Error('caller left'));

        const harness = makeHarness({ answers: [NOT_ADMITTED] });

        await expect(harness.transport.send(searchOf(caller.signal))).rejects.toThrow('caller left');
        expect(harness.requests).toEqual([]);
        expect(harness.admissions).toEqual([]);
    });

    it('admits nothing when the caller goes while the probe is answering a miss', async () => {
        const caller = new AbortController();
        const harness = makeHarness({
            answers: [
                async () => {
                    caller.abort(new Error('caller left'));

                    return responseOf(NOT_ADMITTED);
                },
            ],
        });

        await expect(harness.transport.send(searchOf(caller.signal))).rejects.toThrow('caller left');
        expect(harness.admissions).toEqual([]);
        expect(harness.requests.map((request) => request.url)).toEqual([PROBE_URL]);
    });

    it('passes the caller’s signal to the probe, which the caller may abandon', async () => {
        const caller = new AbortController();
        const harness = makeHarness({ answers: [{ status: 200, echo: FOREIGN_RID, body: FOUND_BODY }] });

        await harness.transport.send(searchOf(caller.signal));

        expect(harness.requests[0]?.signal).toBe(caller.signal);
    });

    it('⛔ finishes an admitted request after the caller has gone, so the cache fills and its block is written', async () => {
        const caller = new AbortController();
        let release: (response: Response) => void = () => undefined;
        const admittedAnswer = new Promise<Response>((resolve) => {
            release = resolve;
        });
        const harness = makeHarness({ answers: [NOT_ADMITTED, async () => admittedAnswer] });

        const sent = harness.transport.send(searchOf(caller.signal));

        await expect.poll(() => harness.requests.length).toBe(2);
        caller.abort(new Error('caller left'));
        release(
            responseOf({
                status: 502,
                echo: RID,
                body: JSON.stringify({
                    code: 'SOURCE_ERROR',
                    message: 'The source answered 503.',
                    details: { sourceStatus: 503 },
                }),
            }),
        );

        const answer = await sent;

        // The admitted request never carried the caller's signal, and its outcome still landed.
        expect(harness.requests[1]?.signal).not.toBe(caller.signal);
        expect(harness.requests[1]?.signal?.aborted).toBe(false);
        expect(answer.block).toEqual({ reason: 'unavailable', seconds: 60 });
        expect(harness.blocks).toEqual([{ source: 'usda', reason: 'unavailable', seconds: 60 }]);
    });

    it('bounds the admitted request by its own deadline, not the caller’s', async () => {
        const harness = makeHarness({
            answers: [
                NOT_ADMITTED,
                async () => new Response(FOUND_BODY, { headers: { [REMOTE_SEARCH_RID_HEADER]: RID } }),
            ],
        });

        await harness.transport.send(searchOf());

        const admittedSignal = harness.requests[1]?.signal;

        expect(admittedSignal).toBeInstanceOf(AbortSignal);
        expect(admittedSignal?.aborted).toBe(false);
    });
});
