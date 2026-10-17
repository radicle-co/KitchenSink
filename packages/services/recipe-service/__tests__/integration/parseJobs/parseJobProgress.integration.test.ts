/**
 * A parse job's per-line progress over the REAL HTTP pipeline, with its DAL MOCKED (`docs/CODING_STANDARDS.md` §7.1a;
 * plan 2026-10-15-011): the real `AppModule` — routing, the auth middleware, `ParseJobsService` and `lineProgressOf`,
 * the exception filter — with `PARSE_JOBS_DAL` replaced by a double answering recorded claim facts.
 *
 * It pins what the unit tier cannot: that the phase reaches the WIRE on each line, that a line which is not pending
 * carries `null` rather than an omitted key, and that the body parses against the PUBLISHED copy of the contract
 * (`@kitchensink/schema-recipe`) — the schema a client actually validates with. Whether the real database computes the
 * ages with its own clock is the LOCAL e2e tier's (`tests/e2e/parseJobs/parseJobProgress.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseJobResponseSchema } from '@kitchensink/schema-recipe';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import {
    PARSE_JOBS_DAL,
    type ParseJobLineRecord,
    type ParseJobRecord,
} from '../../../src/recipes/parseJobs.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JPARSEPROGRESSCOOK000001';
const JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const QUIET_JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';

function line(lineIndex: number, overrides: Partial<ParseJobLineRecord> = {}): ParseJobLineRecord {
    return {
        lineIndex,
        sourceLine: `line ${String(lineIndex)}`,
        lineDigest: `v1:${String(lineIndex).padStart(64, '0')}`,
        status: 'pending',
        proposal: null,
        llmAttempts: null,
        attempts: 0,
        claimAgeSeconds: null,
        ...overrides,
    };
}

function job(id: string, quietSeconds: number, lines: readonly ParseJobLineRecord[]): ParseJobRecord {
    return {
        id,
        status: 'running',
        createdAt: new Date('2026-10-15T08:00:00.000Z'),
        expiresAt: new Date('2026-10-16T08:00:00.000Z'),
        lines,
        quietSeconds,
    };
}

const JOBS = new Map<string, ParseJobRecord>([
    [
        JOB_ID,
        job(JOB_ID, 4, [
            line(0, { status: 'parsed', attempts: 1, claimAgeSeconds: 30, proposal: null }),
            line(1, { attempts: 1, claimAgeSeconds: 4 }),
            line(2, { attempts: 2, claimAgeSeconds: 4 }),
            line(3, { attempts: 1, claimAgeSeconds: 200 }),
            line(4),
            line(5, { status: 'failed_retryable', attempts: 21, claimAgeSeconds: 200 }),
        ]),
    ],
    [QUIET_JOB_ID, job(QUIET_JOB_ID, 400, [line(0), line(1, { attempts: 1, claimAgeSeconds: 400 })])],
]);

let booted: BootedServiceApp;

async function get(path: string): Promise<Response> {
    return asPrincipal(COOK, () => fetch(`${booted.baseUrl}${path}`, { headers: { authorization: bearerFor(COOK) } }));
}

beforeAll(async () => {
    booted = await bootMockedRecipeApp({
        doubles: [
            {
                provide: PARSE_JOBS_DAL,
                useValue: {
                    getJob: async (ownerId: string, jobId: string) => (ownerId === COOK ? JOBS.get(jobId) : undefined),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterAll(async () => {
    await booted?.close();
});

describe('GET /api/v1/recipe-parse-jobs/:id — what each line is doing', () => {
    it("puts each pending line's phase on the wire, and null on every other line", async () => {
        const response = await get(`/api/v1/recipe-parse-jobs/${JOB_ID}`);

        expect(response.status).toBe(200);

        const body = parseJobResponseSchema.parse(await response.json());

        expect(body.lines.map((each) => each.progress)).toEqual([
            null,
            { phase: 'reading' },
            { phase: 'retrying' },
            { phase: 'delayed' },
            { phase: 'queued' },
            null,
        ]);
    });

    it('reads every pending line of a paste that has gone quiet as stalled', async () => {
        const response = await get(`/api/v1/recipe-parse-jobs/${QUIET_JOB_ID}`);
        const body = parseJobResponseSchema.parse(await response.json());

        expect(body.lines.map((each) => each.progress?.phase)).toEqual(['stalled', 'stalled']);
    });

    it("still answers a stranger's job with 404, whatever its lines are doing", async () => {
        const response = await asPrincipal('01JPARSEPROGRESSSTRANGER01', () =>
            fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${JOB_ID}`, {
                headers: { authorization: bearerFor('01JPARSEPROGRESSSTRANGER01') },
            }),
        );

        expect(response.status).toBe(404);
    });
});
