/**
 * The search handler's orchestration, with the adapter and the logger as test doubles: which answer each outcome
 * becomes, which of them a cache may keep, that every response echoes a `rid` that parsed, and that `admit=0` never
 * builds or calls a source adapter (ADR-0055 points 2 and 6).
 */
import { describe, expect, it } from 'vitest';

import type { RemoteSourceAdapter, SourceSearchOutcome } from '../../sources/remoteSourceAdapter.js';
import { SourceConfigurationError } from '../../sources/sourceConfigurationError.js';
import type { SearchLogAttributes } from '../../logging/searchLogAttributes.js';
import type { LogLevel, SearchLogger } from '../../logging/searchLogger.js';
import { makeSearchEvent, VALID_RID } from '../__fixtures__/searchEvent.js';
import {
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchAnswerSchema,
    remoteSearchErrorSchema,
    remoteSearchNotAdmittedSchema,
    type RemoteSearchSource,
} from '../remoteSearch.schema.js';
import { handleSearchRequest, type SearchDependencies } from '../searchHandler.js';
import type { SearchResponse } from '../searchResponse.js';

/** One line a {@link RecordingLogger} received. */
interface LoggedLine {
    readonly level: LogLevel;
    readonly message: string;
    readonly attributes: SearchLogAttributes;
}

/** A logger that keeps what it is given. */
interface RecordingLogger extends SearchLogger {
    readonly lines: LoggedLine[];
}

/**
 * Build a {@link RecordingLogger}.
 *
 * @returns The logger.
 */
function recordingLogger(): RecordingLogger {
    const lines: LoggedLine[] = [];

    const record =
        (level: LogLevel) =>
        (message: string, attributes: SearchLogAttributes): void => {
            lines.push({ level, message, attributes });
        };

    return { lines, info: record('info'), warn: record('warn'), error: record('error') };
}

/** The dependencies, with counters on what the handler asked of them. */
interface Harness {
    readonly dependencies: SearchDependencies;
    readonly logger: RecordingLogger;
    /** Each source an adapter was built for, in order. */
    readonly built: RemoteSearchSource[];
    /** Each term an adapter was asked to search, in order. */
    readonly searched: string[];
}

/**
 * Dependencies whose adapter answers with one outcome.
 *
 * @param answer - What the adapter's search does.
 * @param build - What building the adapter does, before it is returned.
 * @returns The harness.
 */
function harness(answer: () => Promise<SourceSearchOutcome>, build: () => void = () => undefined): Harness {
    const logger = recordingLogger();
    const built: RemoteSearchSource[] = [];
    const searched: string[] = [];
    const adapter: RemoteSourceAdapter = {
        search: (term) => {
            searched.push(term);

            return answer();
        },
    };

    return {
        logger,
        built,
        searched,
        dependencies: {
            logger,
            adapterFor: (source) => {
                built.push(source);
                build();

                return adapter;
            },
        },
    };
}

const ITEM = { externalKey: '747447', name: 'Broccoli, raw', lineageKey: 'foundation:11090' } as const;

const QUOTA = { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '997' } as const;

/**
 * The response's body, parsed with the contract.
 *
 * @param response - The response.
 * @returns The answer or the error the body holds.
 */
function contractBody(response: SearchResponse): unknown {
    const body: unknown = JSON.parse(response.body);

    switch (response.statusCode) {
        case 200:
            return remoteSearchAnswerSchema.parse(body);
        case 428:
            return remoteSearchNotAdmittedSchema.parse(body);
        default:
            return remoteSearchErrorSchema.parse(body);
    }
}

describe('handleSearchRequest — what each source outcome answers', () => {
    it.each<[string, SourceSearchOutcome, number, string, unknown, Record<string, string>]>([
        [
            'hits',
            { kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA },
            200,
            'public, s-maxage=604800',
            { outcome: 'found', items: [ITEM] },
            QUOTA,
        ],
        [
            'no hits',
            { kind: 'answered', items: [], passthroughHeaders: QUOTA },
            200,
            'public, s-maxage=86400',
            { outcome: 'empty' },
            QUOTA,
        ],
        [
            'a source rate limit',
            { kind: 'sourceStatus', sourceStatus: 429, passthroughHeaders: { ...QUOTA, 'Retry-After': '1800' } },
            502,
            'no-store',
            { code: 'SOURCE_ERROR', message: 'The source answered 429.', details: { sourceStatus: 429 } },
            { ...QUOTA, 'Retry-After': '1800' },
        ],
        [
            'a source outage',
            { kind: 'sourceStatus', sourceStatus: 503, passthroughHeaders: {} },
            502,
            'no-store',
            { code: 'SOURCE_ERROR', message: 'The source answered 503.', details: { sourceStatus: 503 } },
            {},
        ],
        [
            'a drifted body',
            { kind: 'invalidResponse', passthroughHeaders: QUOTA },
            502,
            'no-store',
            {
                code: 'SOURCE_INVALID_RESPONSE',
                message: 'The source answered with a body this service cannot read.',
            },
            QUOTA,
        ],
        [
            'a timeout',
            { kind: 'timeout', passthroughHeaders: {} },
            504,
            'no-store',
            { code: 'SOURCE_TIMEOUT', message: 'The source did not answer in time.' },
            {},
        ],
    ])('answers %s', async (_label, outcome, status, cacheControl, body, passed) => {
        const { dependencies, searched } = harness(() => Promise.resolve(outcome));

        const response = await handleSearchRequest(makeSearchEvent(), dependencies);

        expect(response.statusCode).toBe(status);
        expect(response.headers['cache-control']).toBe(cacheControl);
        expect(response.headers['content-type']).toBe('application/json');
        expect(response.headers[REMOTE_SEARCH_RID_HEADER]).toBe(VALID_RID);
        expect(contractBody(response)).toStrictEqual(body);
        expect(searched).toStrictEqual(['chicken breast']);

        for (const [name, value] of Object.entries(passed)) {
            expect(response.headers[name], name).toBe(value);
        }
    });
});

describe('handleSearchRequest — admission', () => {
    it('answers admit=0 as not admitted, never stored, without building or calling an adapter', async () => {
        const { dependencies, built, searched } = harness(() =>
            Promise.resolve({ kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA }),
        );

        const response = await handleSearchRequest(makeSearchEvent({ query: { admit: '0' } }), dependencies);

        expect(response.statusCode).toBe(428);
        expect(response.headers['cache-control']).toBe('no-store, max-age=0');
        expect(response.headers[REMOTE_SEARCH_RID_HEADER]).toBe(VALID_RID);
        expect(contractBody(response)).toStrictEqual({ outcome: 'notAdmitted' });
        expect(built).toStrictEqual([]);
        expect(searched).toStrictEqual([]);
    });

    it('calls the source exactly once with admit=1', async () => {
        const { dependencies, built, searched } = harness(() =>
            Promise.resolve({ kind: 'answered', items: [], passthroughHeaders: {} }),
        );

        await handleSearchRequest(makeSearchEvent(), dependencies);

        expect(built).toStrictEqual(['usda']);
        expect(searched).toStrictEqual(['chicken breast']);
    });
});

describe('handleSearchRequest — refusals', () => {
    it.each<[string, Parameters<typeof makeSearchEvent>[0], number, unknown, Record<string, string>]>([
        [
            'a term that is not canonical',
            { query: { q: 'Chicken Breast' } },
            400,
            {
                code: 'INVALID_REQUEST',
                message: 'The q parameter is missing, repeated or malformed.',
                details: { parameter: 'q' },
            },
            {},
        ],
        [
            'a malformed admit',
            { query: { admit: 'yes' } },
            400,
            {
                code: 'INVALID_REQUEST',
                message: 'The admit parameter is missing, repeated or malformed.',
                details: { parameter: 'admit' },
            },
            {},
        ],
        [
            'an unknown path',
            { rawPath: '/v1/usda/99/search' },
            404,
            { code: 'NOT_FOUND', message: 'No search at this path.' },
            {},
        ],
        [
            'a POST',
            { method: 'POST' },
            405,
            { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is served.' },
            { allow: 'GET' },
        ],
    ])('refuses %s, never stored, echoing rid', async (_label, event, status, body, extra) => {
        const { dependencies, built } = harness(() =>
            Promise.resolve({ kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA }),
        );

        const response = await handleSearchRequest(makeSearchEvent(event), dependencies);

        expect(response.statusCode).toBe(status);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers[REMOTE_SEARCH_RID_HEADER]).toBe(VALID_RID);
        expect(contractBody(response)).toStrictEqual(body);
        expect(built).toStrictEqual([]);

        for (const [name, value] of Object.entries(extra)) {
            expect(response.headers[name], name).toBe(value);
        }
    });

    it('refuses a rid that does not parse, never stored, and echoes nothing', async () => {
        const { dependencies, built } = harness(() =>
            Promise.resolve({ kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA }),
        );

        const response = await handleSearchRequest(makeSearchEvent({ query: { rid: 'x\r\ninjected' } }), dependencies);

        expect(response.statusCode).toBe(400);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers).not.toHaveProperty(REMOTE_SEARCH_RID_HEADER);
        expect(contractBody(response)).toMatchObject({ code: 'INVALID_REQUEST', details: { parameter: 'rid' } });
        expect(built).toStrictEqual([]);
    });
});

describe('handleSearchRequest — its own failures', () => {
    it('answers an adapter failure it cannot classify as INTERNAL, never stored, and logs only its name', async () => {
        const secret = 'https://usda.test/?api_key=leaked';
        const { dependencies, logger } = harness(() => Promise.reject(new RangeError(secret)));

        const response = await handleSearchRequest(makeSearchEvent(), dependencies);

        expect(response.statusCode).toBe(500);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers[REMOTE_SEARCH_RID_HEADER]).toBe(VALID_RID);
        expect(contractBody(response)).toStrictEqual({ code: 'INTERNAL', message: 'The search failed.' });
        expect(logger.lines.filter((line) => line.level === 'error')).toStrictEqual([
            {
                level: 'error',
                message: 'remote-search-failed',
                attributes: { rid: VALID_RID, source: 'usda', status: 500, errorName: 'RangeError' },
            },
        ]);
        expect(JSON.stringify(logger.lines)).not.toContain(secret);
        expect(response.body).not.toContain(secret);
    });

    it('answers a source it cannot configure as INTERNAL, and logs the variables it lacks', async () => {
        const { dependencies, logger, searched } = harness(
            () => Promise.resolve({ kind: 'answered', items: [], passthroughHeaders: {} }),
            () => {
                throw new SourceConfigurationError('usda', ['USDA_API_KEY_SECRET_ID']);
            },
        );

        const response = await handleSearchRequest(makeSearchEvent(), dependencies);

        expect(response.statusCode).toBe(500);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers[REMOTE_SEARCH_RID_HEADER]).toBe(VALID_RID);
        expect(searched).toStrictEqual([]);
        expect(logger.lines.filter((line) => line.level === 'error')).toStrictEqual([
            {
                level: 'error',
                message: 'remote-search-failed',
                attributes: {
                    rid: VALID_RID,
                    source: 'usda',
                    status: 500,
                    errorName: 'SourceConfigurationError',
                    variables: ['USDA_API_KEY_SECRET_ID'],
                },
            },
        ]);
    });
});

describe('handleSearchRequest — the log', () => {
    it.each<[string, Parameters<typeof makeSearchEvent>[0], SourceSearchOutcome, LogLevel, SearchLogAttributes]>([
        [
            'an answer',
            {},
            { kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA },
            'info',
            { rid: VALID_RID, source: 'usda', status: 200, outcome: 'found' },
        ],
        [
            'a refusal of admission',
            { query: { admit: '0' } },
            { kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA },
            'info',
            { rid: VALID_RID, source: 'usda', status: 428, outcome: 'notAdmitted' },
        ],
        [
            'a source failure',
            {},
            { kind: 'sourceStatus', sourceStatus: 429, passthroughHeaders: QUOTA },
            'warn',
            { rid: VALID_RID, source: 'usda', status: 502, code: 'SOURCE_ERROR', sourceStatus: 429 },
        ],
        [
            'a bad request',
            { query: { q: 'Egg' } },
            { kind: 'answered', items: [ITEM], passthroughHeaders: QUOTA },
            'info',
            { rid: VALID_RID, status: 400, code: 'INVALID_REQUEST', parameter: 'q' },
        ],
    ])('writes one line for %s', async (_label, event, outcome, level, attributes) => {
        const { dependencies, logger } = harness(() => Promise.resolve(outcome));

        await handleSearchRequest(makeSearchEvent(event), dependencies);

        expect(logger.lines).toStrictEqual([{ level, message: 'remote-search', attributes }]);
    });
});
