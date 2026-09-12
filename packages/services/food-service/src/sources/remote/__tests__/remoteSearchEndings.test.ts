/**
 * How a remote search ended, as food counts it (ADR-0055 point 6). The ending is named beside the adapter's own
 * branching, so this suite drives the REAL {@link SearchServiceRemoteSearch} through every ending over a stub CDN and
 * reads back what it recorded: if the adapter's branching moves and the naming does not, a row here fails.
 *
 * The second half pins the stage-bound recorder against real EMF lines: every ending is counted under its reason, and
 * the unavailable rate counts only the endings where the search went dark, never the cook leaving.
 */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { REMOTE_SEARCH_RID_HEADER, type RemoteSearchSource } from '@kitchensink/schema-remote-search';

import type { BudgetCharge, BudgetWindow } from '../../../foods/dao/requesterSourceBudget.dao.js';
import { FoodMetrics, type EmfPayload } from '../../../observability/emfMetrics.js';
import type { Admission, FetchFn } from '../../transport/transportPorts.js';
import { RemoteSearchEndingMetrics, type RemoteSearchEnding } from '../remoteSearchEndings.js';
import type { RemoteSourceOutcome } from '../remoteSearchPort.js';
import { SearchServiceRemoteSearch } from '../SearchServiceRemoteSearch.js';

const NOW = Date.UTC(2026, 9, 3, 5, 0, 0);
const RID = '0d7c1f0e-5b7a-4d36-9a3e-2b4f6c1d8e90';
const OTHER_RID = 'another-request-0000';
const { privateKey: SIGNING_KEY } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** One CDN answer: a status, its echo (`null` for none, absent for this request's), and a body. */
interface Answer {
    readonly status: number;
    readonly echo?: string | null;
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
}

/** One recorded ending. */
interface Recorded {
    readonly source: RemoteSearchSource;
    readonly ending: RemoteSearchEnding;
    readonly outcome: RemoteSourceOutcome;
}

/** What a case varies. */
interface Case {
    readonly answers: readonly (Answer | Error)[];
    readonly charge?: BudgetCharge | Error;
    readonly window?: Admission;
    readonly term?: string;
    readonly callerLeft?: boolean;
}

const NOT_ADMITTED: Answer = { status: 428, body: { outcome: 'notAdmitted' } };

/**
 * Search once through the real adapter over a stub CDN, and return what it recorded and what it answered.
 *
 * @param given - The case.
 * @returns Every recorded ending, and the outcome.
 */
async function endingsOf(given: Case): Promise<{ readonly recorded: Recorded[]; readonly outcome: unknown }> {
    const recorded: Recorded[] = [];
    let sent = 0;

    const upstream: FetchFn = async () => {
        const answer = given.answers[sent];

        sent += 1;

        if (answer === undefined) {
            throw new Error('unexpected request');
        }

        if (answer instanceof Error) {
            throw answer;
        }

        const headers = new Headers(answer.headers);
        const echo = answer.echo === undefined ? RID : answer.echo;

        if (echo !== null) {
            headers.set(REMOTE_SEARCH_RID_HEADER, echo);
        }

        return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers });
    };

    const remote = new SearchServiceRemoteSearch({
        origin: 'https://d111111abcdef8.cloudfront.net',
        keyPairId: 'K2JCJMDEHXQW5F',
        signingKey: SIGNING_KEY,
        window: { admit: async () => given.window ?? { admitted: true } },
        budget: {
            charge: async (input) => {
                if (given.charge instanceof Error) {
                    throw given.charge;
                }

                return (
                    given.charge ?? {
                        admitted: true,
                        receipt: {
                            requesterId: input.requesterId,
                            cost: input.cost,
                            window: '2026-10-03T06:00:00.000000Z' as BudgetWindow,
                        },
                    }
                );
            },
            refund: async () => 'refunded',
        },
        blocks: { record: async () => undefined },
        metrics: { recordSourceRateLimit: () => undefined },
        endings: { record: (source, ending, outcome) => void recorded.push({ source, ending, outcome }) },
        upstream,
        now: () => NOW,
        newRequestId: () => RID,
        logger: { warn: () => undefined, error: () => undefined },
    });
    const caller = new AbortController();

    if (given.callerLeft === true) {
        caller.abort();
    }

    const outcome = await remote.search({
        source: 'usda',
        term: given.term ?? 'kale',
        requesterId: '01JREQUESTER0000000000000A',
        signal: caller.signal,
    });

    return { recorded, outcome };
}

describe('SearchServiceRemoteSearch — the ending it records', () => {
    it.each<[string, Case, RemoteSearchEnding, RemoteSourceOutcome['kind']]>([
        [
            'a cached answer',
            { answers: [{ status: 200, echo: OTHER_RID, body: { outcome: 'empty' } }] },
            'answered',
            'answered',
        ],
        [
            'an admitted miss the source answered',
            { answers: [NOT_ADMITTED, { status: 200, body: { outcome: 'empty' } }] },
            'answered',
            'answered',
        ],
        [
            'a miss the cook’s own budget refused',
            { answers: [NOT_ADMITTED], charge: { admitted: false, retryAfterSeconds: 60 } },
            'requesterLimit',
            'limited',
        ],
        ...(['ceiling', 'blocked', 'contended'] as const).map(
            (reason): [string, Case, RemoteSearchEnding, RemoteSourceOutcome['kind']] => [
                `a miss the shared window refused (${reason})`,
                {
                    answers: [NOT_ADMITTED],
                    window: { admitted: false, reason, retryAt: new Date(NOW + 60_000).toISOString() },
                },
                reason,
                'busy',
            ],
        ),
        [
            'a source 429 that earned a block',
            {
                answers: [
                    NOT_ADMITTED,
                    {
                        status: 502,
                        body: {
                            code: 'SOURCE_ERROR',
                            message: 'The source answered 429.',
                            details: { sourceStatus: 429 },
                        },
                        headers: { 'Retry-After': '240' },
                    },
                ],
            },
            'blockEarned',
            'busy',
        ],
        [
            'CloudFront refusing the signature (a 403 with no echo)',
            { answers: [{ status: 403, echo: null, body: '<Error><Code>AccessDenied</Code></Error>' }] },
            'noEcho',
            'unavailable',
        ],
        [
            'a 428 that echoes another request',
            { answers: [{ ...NOT_ADMITTED, echo: OTHER_RID }] },
            'foreignEcho',
            'unavailable',
        ],
        [
            'an admitted request answered "not admitted"',
            { answers: [NOT_ADMITTED, NOT_ADMITTED] },
            'unexpectedStatus',
            'unavailable',
        ],
        [
            'the search service failing',
            { answers: [NOT_ADMITTED, { status: 500, body: { code: 'INTERNAL', message: 'Down.' } }] },
            'upstreamStatus',
            'unavailable',
        ],
        [
            'a source timeout',
            { answers: [NOT_ADMITTED, { status: 504, body: { code: 'SOURCE_TIMEOUT', message: 'Slow.' } }] },
            'upstreamStatus',
            'unavailable',
        ],
        [
            'a 200 whose body breaks the contract',
            { answers: [{ status: 200, echo: OTHER_RID, body: { outcome: 'x' } }] },
            'contractBroken',
            'unavailable',
        ],
        [
            'our own budget store failing',
            { answers: [NOT_ADMITTED], charge: new Error('connection reset') },
            'accountingFailed',
            'unavailable',
        ],
        ['a network failure', { answers: [new TypeError('fetch failed')] }, 'failed', 'unavailable'],
        [
            'the cook leaving before any answer',
            { answers: [new DOMException('aborted', 'AbortError')], callerLeft: true },
            'callerLeft',
            'unavailable',
        ],
        ['a term that is not canonical', { answers: [], term: 'Chicken  Breast' }, 'termNotCanonical', 'unavailable'],
    ])('records %s once, as its ending, beside the outcome it returns', async (_label, given, ending, kind) => {
        const { recorded, outcome } = await endingsOf(given);

        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toEqual({ source: 'usda', ending, outcome });
        expect(outcome).toMatchObject({ kind });
    });
});

/**
 * The EMF lines one recorded ending writes.
 *
 * @param ending - The ending.
 * @param outcome - The outcome it ended in.
 * @returns The parsed lines.
 */
function linesFor(ending: RemoteSearchEnding, outcome: RemoteSourceOutcome): EmfPayload[] {
    const lines: string[] = [];

    new RemoteSearchEndingMetrics(new FoodMetrics((line) => lines.push(line)), 'prod').record('usda', ending, outcome);

    return lines.map((line) => JSON.parse(line) as EmfPayload);
}

/**
 * The one line carrying a metric, if any.
 *
 * @param lines - The lines.
 * @param name - The metric name.
 * @returns The line.
 */
function lineWith(lines: readonly EmfPayload[], name: string): EmfPayload | undefined {
    return lines.find((line) => line[name] !== undefined);
}

describe('RemoteSearchEndingMetrics — what an ending publishes', () => {
    it('counts every ending under its stage, source and reason', () => {
        const lines = linesFor('noEcho', { kind: 'unavailable' });
        const count = lineWith(lines, 'remote-search-ending');

        expect(count?._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['stage', 'source', 'reason']]);
        expect(count?._aws.CloudWatchMetrics[0]?.Metrics).toEqual([{ Name: 'remote-search-ending', Unit: 'Count' }]);
        expect(count).toMatchObject({ stage: 'prod', source: 'usda', reason: 'noEcho', 'remote-search-ending': 1 });
    });

    it.each<[RemoteSearchEnding, RemoteSourceOutcome, number]>([
        ['noEcho', { kind: 'unavailable' }, 100],
        ['upstreamStatus', { kind: 'unavailable' }, 100],
        ['answered', { kind: 'answered', items: [] }, 0],
        ['ceiling', { kind: 'busy', retryAfterSeconds: 60 }, 0],
        ['requesterLimit', { kind: 'limited', retryAfterSeconds: 60 }, 0],
    ])('observes %s as %s%% unavailable, under the stage alone', (ending, outcome, percent) => {
        const rate = lineWith(linesFor(ending, outcome), 'remote-search-unavailable-rate');

        expect(rate?._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['stage']]);
        expect(rate?._aws.CloudWatchMetrics[0]?.Metrics).toEqual([
            { Name: 'remote-search-unavailable-rate', Unit: 'Percent' },
        ]);
        expect(rate).toMatchObject({ stage: 'prod', 'remote-search-unavailable-rate': percent });
    });

    it('counts the cook leaving, but never as the search going dark', () => {
        const lines = linesFor('callerLeft', { kind: 'unavailable' });

        expect(lineWith(lines, 'remote-search-ending')).toMatchObject({ reason: 'callerLeft' });
        expect(lineWith(lines, 'remote-search-unavailable-rate')).toBeUndefined();
    });
});
