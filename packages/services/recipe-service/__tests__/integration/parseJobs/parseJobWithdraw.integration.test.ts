/**
 * `POST /api/v1/recipe-parse-jobs/:id/withdraw-lines` over the REAL HTTP pipeline, with its DAL MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a; plan 2026-10-15-011, open question 8): routing, the auth middleware, the zod
 * pipe, `ParseJobsService`, the exception filter, and the body parsed against the PUBLISHED contract copy
 * (`@kitchensink/schema-recipe`).
 *
 * What it pins: the route exists and answers `200` (no async work is started, so not `202`); the owner's id — never a
 * body field — reaches the DAL; a stranger and an absent job are both `404`; an expired job is `409`; an inadmissible
 * body is `400` and never reaches the DAL; and the wire shows a withdrawn line as `withdrawn` with no progress. The
 * SQL (owner scoping, the status guard, atomicity against the worker's claim) is the LOCAL e2e tier's.
 */
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseJobResponseSchema } from '@kitchensink/schema-recipe';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { PARSE_JOBS_DAL, type ParseJobRecord } from '../../../src/recipes/parseJobs.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JPARSEWITHDRAWCOOK000001';
const STRANGER = '01JPARSEWITHDRAWSTRANGER01';
const JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const EXPIRED_JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';

const JOB: ParseJobRecord = {
    id: JOB_ID,
    status: 'running',
    createdAt: new Date('2026-10-15T08:00:00.000Z'),
    expiresAt: new Date('2026-10-16T08:00:00.000Z'),
    quietSeconds: 400,
    lines: [
        {
            lineIndex: 0,
            sourceLine: '2 cups flour',
            lineDigest: `v1:${'0'.repeat(64)}`,
            status: 'withdrawn',
            proposal: null,
            llmAttempts: null,
            attempts: 1,
            claimAgeSeconds: 400,
        },
        {
            lineIndex: 1,
            sourceLine: '1 tsp salt',
            lineDigest: `v1:${'1'.repeat(64)}`,
            status: 'pending',
            proposal: null,
            llmAttempts: null,
            attempts: 0,
            claimAgeSeconds: null,
        },
    ],
};

const withdrawLines = vi.fn();
let booted: BootedServiceApp;

async function post(principal: string, jobId: string, body: unknown): Promise<Response> {
    return asPrincipal(principal, () =>
        fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${jobId}/withdraw-lines`, {
            method: 'POST',
            headers: { authorization: bearerFor(principal), 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
    );
}

beforeAll(async () => {
    booted = await bootMockedRecipeApp({
        doubles: [
            {
                provide: PARSE_JOBS_DAL,
                useValue: {
                    withdrawLines,
                    getJob: async (ownerId: string, jobId: string) =>
                        ownerId === COOK && jobId === JOB_ID ? JOB : undefined,
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

beforeEach(() => {
    withdrawLines.mockReset();
    withdrawLines.mockImplementation(async (ownerId: string, jobId: string) =>
        ownerId === COOK && jobId === JOB_ID
            ? { kind: 'ok' }
            : jobId === EXPIRED_JOB_ID
              ? { kind: 'expired' }
              : { kind: 'missing' },
    );
});

afterAll(async () => {
    await booted?.close();
});

describe('POST /api/v1/recipe-parse-jobs/:id/withdraw-lines', () => {
    it('answers 200 with the job view, a withdrawn line carrying no progress', async () => {
        const response = await post(COOK, JOB_ID, { lineIndexes: [0] });

        expect(response.status).toBe(200);

        const body = parseJobResponseSchema.parse(await response.json());

        expect(body.lines[0]).toMatchObject({ status: 'withdrawn', progress: null, proposal: null });
        expect(withdrawLines).toHaveBeenCalledWith(COOK, JOB_ID, [0]);
    });

    it("⛔ answers a stranger's request with 404, exactly as for an absent job", async () => {
        const response = await post(STRANGER, JOB_ID, { lineIndexes: [0] });

        expect(response.status).toBe(404);
        expect(withdrawLines).toHaveBeenCalledWith(STRANGER, JOB_ID, [0]);
    });

    it('answers an expired job with 409', async () => {
        const response = await post(COOK, EXPIRED_JOB_ID, { lineIndexes: [0] });

        expect(response.status).toBe(409);
    });

    it.each([
        ['an empty list', { lineIndexes: [] }],
        ['a negative index', { lineIndexes: [-1] }],
        ['a body-supplied owner', { lineIndexes: [0], ownerId: STRANGER }],
    ])('refuses %s with 400 before it reaches the DAL', async (_name, body) => {
        const response = await post(COOK, JOB_ID, body);

        expect(response.status).toBe(400);
        expect(withdrawLines).not.toHaveBeenCalled();
    });
});
