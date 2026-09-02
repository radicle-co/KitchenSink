/**
 * The ASYNC PARSE-JOB transport (`/api/v1/recipe-parse-jobs`) — verb, URL, outbound body, success status,
 * parsed response, and the two domain errors this resource introduces.
 *
 * Written FROM the published contract (`packages/schemas/recipe/src/schemas/parseJobs.schema.ts` and the
 * service's `parseJobs.controller.ts`), not from an implementation: all four endpoints answer the SAME
 * `ParseJobResponse`, the three writes answer `202` (they re-open asynchronous work) and the read answers
 * `200`.
 *
 * ## Three things asserted here that a happy-path suite would miss
 *
 *  1. **The outbound parse REFUSES an inadmissible paste without touching the network.** The service's
 *     `superRefine` runs `refuseParseJobLines` — the same shared splitter — so an over-long line is a
 *     `400` the caller can avoid entirely. `InvalidRequestError`, not `BadRequestError`: no request went
 *     out (see `errors.ts`'s three-way distinction).
 *  2. **`409 PARSE_JOB_EXPIRED` is its OWN typed error.** A cook's remedy for an expired job is a fresh
 *     paste, never a retry — a different sentence and a different control from every other failure — and
 *     before this the only way to tell was to string-compare `.code` off a generic `UnexpectedResponseError`.
 *  3. **`404 PARSE_JOB_NOT_FOUND` maps to `NotFoundError`.** The service answers it for a STRANGER's job
 *     as well as an absent one (deliberately — a `403` would confirm the id exists), so a client that
 *     rendered it as an authorization failure would leak exactly what the `404` exists to hide.
 */
import { describe, expect, it } from 'vitest';

import { InvalidRequestError, NotFoundError, ParseJobExpiredError, RecipeServiceClient } from '../index.js';
import {
    FIXTURE_PARSE_JOB_UUID,
    makeCompleteParseJob,
    makeParseJob,
    makeParseJobLine,
} from '../__fixtures__/parseJobs.js';
import { callsOf, requestAt, stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';

/** Construct a client wired to the given fetch double and a literal token (so auth attach is exercised). */
function makeClient(fetchMock: typeof fetch): RecipeServiceClient {
    return new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });
}

/** Parse the captured JSON request body of the first recorded call. */
function jsonBody(fetchMock: typeof fetch): unknown {
    return JSON.parse(requestAt(fetchMock).body as string);
}

/** A `fetch` double that fails the test if it is ever reached — the local-refusal assertions' oracle. */
function unreachableFetch(): typeof fetch {
    return stubFetch(500, { code: 'INTERNAL_ERROR', message: 'the transport should not have been reached' });
}

describe('RecipeServiceClient — parse jobs', () => {
    it('createParseJob POSTs the pasted text to /api/v1/recipe-parse-jobs and returns the job view (202)', async () => {
        const job = makeParseJob();
        const fetchMock = stubFetch(202, job);

        const result = await makeClient(fetchMock).createParseJob({ text: '2 cups flour\n1 tsp salt' });

        expect(result).toEqual(job);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipe-parse-jobs`);
        expect(jsonBody(fetchMock)).toEqual({ text: '2 cups flour\n1 tsp salt' });
    });

    it('createParseJob refuses an over-long line locally, without sending a request', async () => {
        // One character past `PARSE_JOB_LINE_MAX_CHARS` (1000) — the exact boundary the shared splitter
        // refuses, so the service's `superRefine` would answer 400 for this body.
        const fetchMock = unreachableFetch();

        await expect(makeClient(fetchMock).createParseJob({ text: 'x'.repeat(1001) })).rejects.toBeInstanceOf(
            InvalidRequestError,
        );
        expect(callsOf(fetchMock)).toHaveLength(0);
    });

    it('createParseJob refuses a paste with no non-empty lines locally, without sending a request', async () => {
        const fetchMock = unreachableFetch();

        await expect(makeClient(fetchMock).createParseJob({ text: '   \n\n  ' })).rejects.toBeInstanceOf(
            InvalidRequestError,
        );
        expect(callsOf(fetchMock)).toHaveLength(0);
    });

    it('getParseJob GETs /api/v1/recipe-parse-jobs/{id} and returns the job view (200)', async () => {
        const job = makeCompleteParseJob();
        const fetchMock = stubFetch(200, job);

        const result = await makeClient(fetchMock).getParseJob(FIXTURE_PARSE_JOB_UUID);

        expect(result).toEqual(job);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/recipe-parse-jobs/${FIXTURE_PARSE_JOB_UUID}`);
    });

    it('retryParseJob POSTs /api/v1/recipe-parse-jobs/{id}/retry and returns the re-driven job view (202)', async () => {
        const job = makeParseJob({ status: 'running' });
        const fetchMock = stubFetch(202, job);

        const result = await makeClient(fetchMock).retryParseJob(FIXTURE_PARSE_JOB_UUID);

        expect(result).toEqual(job);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipe-parse-jobs/${FIXTURE_PARSE_JOB_UUID}/retry`);
    });

    it('editParseJobLine PATCHes /{id}/lines/{lineIndex} with the replacement line (202)', async () => {
        const job = makeParseJob({
            lines: [makeParseJobLine({ lineIndex: 3, sourceLine: '1 tsp salt', status: 'pending' })],
        });
        const fetchMock = stubFetch(202, job);

        const result = await makeClient(fetchMock).editParseJobLine(FIXTURE_PARSE_JOB_UUID, 3, {
            sourceLine: '1 tsp salt',
        });

        expect(result).toEqual(job);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/api/v1/recipe-parse-jobs/${FIXTURE_PARSE_JOB_UUID}/lines/3`);
        expect(jsonBody(fetchMock)).toEqual({ sourceLine: '1 tsp salt' });
    });

    it('editParseJobLine refuses a whitespace-only replacement locally (an edit is not a delete)', async () => {
        const fetchMock = unreachableFetch();

        await expect(
            makeClient(fetchMock).editParseJobLine(FIXTURE_PARSE_JOB_UUID, 0, { sourceLine: '   ' }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
        expect(callsOf(fetchMock)).toHaveLength(0);
    });

    it('maps 404 PARSE_JOB_NOT_FOUND to NotFoundError (a stranger and an absent job are one answer)', async () => {
        const fetchMock = stubFetch(404, { code: 'PARSE_JOB_NOT_FOUND', message: 'Parse job not found.' });

        await expect(makeClient(fetchMock).getParseJob(FIXTURE_PARSE_JOB_UUID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('maps 409 PARSE_JOB_EXPIRED to its OWN typed error, carrying the status and code', async () => {
        const fetchMock = stubFetch(409, { code: 'PARSE_JOB_EXPIRED', message: 'Parse job expired.' });

        const error = await makeClient(fetchMock)
            .retryParseJob(FIXTURE_PARSE_JOB_UUID)
            .catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(ParseJobExpiredError);
        expect(error).toMatchObject({ status: 409, code: 'PARSE_JOB_EXPIRED' });
    });

    it('editParseJobLine surfaces the same expiry error — the TTL bounds every mutation, not just retry', async () => {
        const fetchMock = stubFetch(409, { code: 'PARSE_JOB_EXPIRED', message: 'Parse job expired.' });

        await expect(
            makeClient(fetchMock).editParseJobLine(FIXTURE_PARSE_JOB_UUID, 0, { sourceLine: '1 tsp salt' }),
        ).rejects.toBeInstanceOf(ParseJobExpiredError);
    });

    it('rejects a success body that does not satisfy the published job schema (parse, do not validate)', async () => {
        // A `lines` entry missing `status` — the exact shape a drifted server would answer, and the one a
        // cast would have let through to surface as `undefined` inside a component.
        const fetchMock = stubFetch(202, {
            ...makeParseJob(),
            lines: [{ lineIndex: 0, sourceLine: '2 cups flour', proposal: null }],
        });

        await expect(makeClient(fetchMock).createParseJob({ text: '2 cups flour' })).rejects.toThrow();
    });
});
