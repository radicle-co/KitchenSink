/**
 * `POST /api/v1/recipe-parse-jobs` when the daily import allowance is spent (004 FR-022), over the REAL HTTP pipeline
 * with its DAL MOCKED (`docs/CODING_STANDARDS.md` §7.1a): routing, the auth middleware, the zod pipe,
 * `ParseJobsService`, the exception filter, and the body parsed against the PUBLISHED contract
 * (`@kitchensink/schema-recipe`).
 *
 * What it pins: a spent allowance is `429` with the DISTINCT code `IMPORT_QUOTA_EXCEEDED` and a required
 * `details.resetsAt`, not the generic throttle answer; the refusal sends nothing to the parse queue; an admitted paste
 * is still `202`; and the DAL is asked to admit exactly one `paste` unit for the verified caller (never a body field).
 * Whether the DATABASE keeps that count right under concurrency is the LOCAL e2e tier's.
 */
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiErrorSchema, parseJobResponseSchema, recipeApiErrorSchema } from '@kitchensink/schema-recipe';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { PARSE_JOB_QUEUE } from '../../../src/recipes/parseJob.queue.js';
import { PARSE_JOBS_DAL, type ParseJobsDalPort } from '../../../src/recipes/parseJobs.service.js';
import { makeParseJobLine, makeParseJobRecord } from '../../../src/recipes/__fixtures__/parseJobMatches.fixture.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JPARSEQUOTACOOK0000001A';
const RESETS_AT = new Date('2026-10-27T03:30:00.000Z');

const createJob = vi.fn<ParseJobsDalPort['createJob']>();
const enqueue = vi.fn(async () => undefined);
let booted: BootedServiceApp;

async function paste(text: string): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { authorization: bearerFor(COOK), 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
        }),
    );
}

beforeAll(async () => {
    booted = await bootMockedRecipeApp({
        doubles: [
            {
                provide: PARSE_JOBS_DAL,
                useValue: {
                    createJob: (...args: Parameters<ParseJobsDalPort['createJob']>) => createJob(...args),
                    findCopyForwardCandidates: async () => [],
                    correctionsChangedAt: async () => null,
                    getJob: async () => undefined,
                    markLinesFailedRetryable: async () => undefined,
                },
            },
            { provide: PARSE_JOB_QUEUE, useValue: { enqueue } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

beforeEach(() => {
    createJob.mockReset();
    enqueue.mockClear();
});

afterAll(async () => {
    await booted?.close();
});

describe('POST /api/v1/recipe-parse-jobs — the daily import allowance', () => {
    it('⛔ answers a spent allowance with 429 IMPORT_QUOTA_EXCEEDED carrying resetsAt, and sends nothing', async () => {
        createJob.mockResolvedValue({ kind: 'refused', resetsAt: RESETS_AT });

        const response = await paste('2 cups flour\n1 tsp salt');

        expect(response.status).toBe(429);

        const raw: unknown = await response.json();
        const envelope = apiErrorSchema.parse(raw);

        expect(envelope.code).toBe('IMPORT_QUOTA_EXCEEDED');
        // The typed view the client narrows with: a body missing `details.resetsAt` would fail here.
        const typed = recipeApiErrorSchema.parse(raw);

        expect(typed).toMatchObject({ code: 'IMPORT_QUOTA_EXCEEDED', details: { resetsAt: RESETS_AT.toISOString() } });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('does not leak the ledger: the refusal names when the allowance reopens and nothing about the count', async () => {
        createJob.mockResolvedValue({ kind: 'refused', resetsAt: RESETS_AT });

        const body = apiErrorSchema.parse(await (await paste('2 cups flour')).json());

        expect(Object.keys(body.details ?? {})).toEqual(['resetsAt']);
    });

    it('still answers 202 with the job view when the allowance admits the paste', async () => {
        createJob.mockResolvedValue({
            kind: 'created',
            record: makeParseJobRecord({
                status: 'running',
                lines: [
                    makeParseJobLine({
                        sourceLine: '2 cups flour',
                        status: 'pending',
                        proposal: null,
                        llmAttempts: null,
                        attempts: 0,
                    }),
                ],
            }),
        });

        const response = await paste('2 cups flour');

        expect(response.status).toBe(202);
        parseJobResponseSchema.parse(await response.json());
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it("asks the DAL to admit ONE paste unit for the verified caller's tier", async () => {
        createJob.mockResolvedValue({ kind: 'refused', resetsAt: RESETS_AT });

        await paste('a\nb\nc');

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob.mock.calls[0]?.[0]).toBe(COOK);
        expect(createJob.mock.calls[0]?.[3]).toEqual({
            kind: 'charge',
            channel: 'paste',
            units: 1,
            tier: { isPremium: false },
        });
    });
});
