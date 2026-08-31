/**
 * Unit tests for `ParseJobsService` (plan U9, origin D9/R13) — the business rules over fake ports.
 *
 * Written RED-first from the plan's test scenarios. What the unit tier owns here:
 *
 *  - create splits with the SHARED splitter, digests each stored line with recipe-core's `lineDigest`,
 *    and enqueues one contract-shaped message per line;
 *  - an enqueue failure is not swallowed and not a 500: affected lines become `failed_retryable` (the
 *    retry endpoint's population) and the job view is still returned — the job EXISTS, its work does not;
 *  - retry re-enqueues ONLY what the DAL reset (`failed_retryable` lines), stranger/missing → 404,
 *    expired → 409;
 *  - a line edit re-enqueues the NEW phrase with the NEW digest (R17's re-drive half);
 *  - the stored proposal is projected onto the strict wire shape, and unknown stored fields do not leak.
 *
 * The SQL truth (owner scoping, atomicity, digest guards) is the integration tier's:
 * `tests/parseJobs.dal.integration.test.ts`.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';
import type { ParseLineJobMessage } from '@kitchensink/recipe-core/parsing/parse-job-message';

import { ParseJobsService, PARSE_JOB_TTL_HOURS } from '../parseJobs.service.js';
import { sha256Hex } from '../../common/sha256.js';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import type { ParseJobRecord, ParseJobsDalPort } from '../parseJobs.service.js';

const OWNER = 'user_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function makeRecord(overrides: Partial<ParseJobRecord> = {}): ParseJobRecord {
    return {
        id: JOB_ID,
        status: 'running',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
        lines: [
            {
                lineIndex: 0,
                sourceLine: '2 cups flour',
                lineDigest: lineDigest('2 cups flour', sha256Hex),
                status: 'pending',
                proposal: null,
                llmAttempts: null,
            },
        ],
        ...overrides,
    };
}

type MockedDal = { readonly [Method in keyof ParseJobsDalPort]: Mock<ParseJobsDalPort[Method]> };

function makeDal(overrides: Partial<MockedDal> = {}): MockedDal {
    return {
        createJob: vi.fn<ParseJobsDalPort['createJob']>(async (_ownerId, lines, expiresAt) =>
            makeRecord({
                expiresAt,
                lines: lines.map((line, index) => ({
                    lineIndex: index,
                    sourceLine: line.sourceLine,
                    lineDigest: line.lineDigest,
                    status: 'pending',
                    proposal: null,
                    llmAttempts: null,
                })),
            }),
        ),
        getJob: vi.fn<ParseJobsDalPort['getJob']>(async () => makeRecord()),
        markLinesFailedRetryable: vi.fn<ParseJobsDalPort['markLinesFailedRetryable']>(async () => undefined),
        resetForRetry: vi.fn<ParseJobsDalPort['resetForRetry']>(async () => ({ kind: 'ok' as const, lines: [] })),
        editLine: vi.fn<ParseJobsDalPort['editLine']>(async () => ({
            kind: 'ok' as const,
            line: { lineIndex: 0, sourceLine: '3 eggs', lineDigest: lineDigest('3 eggs', sha256Hex) },
        })),
        ...overrides,
    };
}

function makeQueue(): { enqueue: Mock<(messages: readonly ParseLineJobMessage[]) => Promise<void>> } {
    return { enqueue: vi.fn<(messages: readonly ParseLineJobMessage[]) => Promise<void>>(async () => undefined) };
}

describe('create', () => {
    it('splits, digests each stored line, and enqueues one message per line', async () => {
        const dal = makeDal();
        const queue = makeQueue();
        const service = new ParseJobsService(dal, queue);

        const view = await service.create(OWNER, '2 cups flour\n\n  1 tsp salt  ');

        expect(dal.createJob).toHaveBeenCalledWith(
            OWNER,
            [
                { sourceLine: '2 cups flour', lineDigest: lineDigest('2 cups flour', sha256Hex) },
                { sourceLine: '1 tsp salt', lineDigest: lineDigest('1 tsp salt', sha256Hex) },
            ],
            expect.any(Date),
        );
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        const messages = queue.enqueue.mock.calls[0]?.[0] ?? [];
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
            jobId: JOB_ID,
            lineIndex: 0,
            sourceLine: '2 cups flour',
            lineDigest: lineDigest('2 cups flour', sha256Hex),
            userId: OWNER,
        });
        expect(view.status).toBe('running');
        expect(view.lines).toHaveLength(2);
    });

    it('sets the TTL from PARSE_JOB_TTL_HOURS', async () => {
        const dal = makeDal();
        const before = Date.now();
        await new ParseJobsService(dal, makeQueue()).create(OWNER, 'flour');
        const after = Date.now();

        const expiresAt = dal.createJob.mock.calls[0]?.[2] ?? new Date(0);
        const ttlMs = PARSE_JOB_TTL_HOURS * 3_600_000;
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs);
        expect(expiresAt.getTime()).toBeLessThanOrEqual(after + ttlMs);
    });

    it('marks every line failed_retryable when the enqueue throws — the job exists, its work does not', async () => {
        const dal = makeDal();
        const queue = makeQueue();
        queue.enqueue.mockRejectedValueOnce(new Error('sqs is down'));
        const service = new ParseJobsService(dal, queue);

        const view = await service.create(OWNER, 'flour\nsalt');

        expect(dal.markLinesFailedRetryable).toHaveBeenCalledWith(JOB_ID, [0, 1]);
        // the view reflects the failure so the caller is not told 'running' about a job nobody is running
        expect(view.lines.every((line) => line.status === 'failed_retryable')).toBe(true);
    });
});

describe('get', () => {
    it('throws PARSE_JOB_NOT_FOUND when the DAL answers nothing (stranger or missing)', async () => {
        const dal = makeDal({ getJob: vi.fn<ParseJobsDalPort['getJob']>(async () => undefined) });

        await expect(new ParseJobsService(dal, makeQueue()).get(OWNER, JOB_ID)).rejects.toMatchObject({
            code: RecipeErrorCode.PARSE_JOB_NOT_FOUND,
        });
    });

    it('projects a stored proposal onto the strict wire shape, dropping internal fields', async () => {
        const stored = {
            raw: '2 cups flour, sifted',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            statedMeasure: '2 cups',
            foods: [{ name: 'flour', prep: 'sifted' }],
            reviewReasons: [],
            provenance: { quantity: 'crf', unit: 'crf', foods: 'llm', statedMeasure: 'crf' },
            llmAttempts: 2,
        };
        const dal = makeDal({
            getJob: vi.fn<ParseJobsDalPort['getJob']>(async () =>
                makeRecord({
                    status: 'complete',
                    lines: [
                        {
                            lineIndex: 0,
                            sourceLine: '2 cups flour, sifted',
                            lineDigest: lineDigest('2 cups flour, sifted', sha256Hex),
                            status: 'parsed',
                            proposal: stored,
                            llmAttempts: 2,
                        },
                    ],
                }),
            ),
        });

        const view = await new ParseJobsService(dal, makeQueue()).get(OWNER, JOB_ID);

        expect(view.lines[0]?.proposal).toEqual({
            raw: '2 cups flour, sifted',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            statedMeasure: '2 cups',
            foods: [{ name: 'flour', prep: 'sifted' }],
            reviewReasons: [],
        });
    });
});

describe('retry', () => {
    it('re-enqueues exactly the lines the DAL reset', async () => {
        const digest = lineDigest('bad line', sha256Hex);
        const dal = makeDal({
            resetForRetry: vi.fn<ParseJobsDalPort['resetForRetry']>(async () => ({
                kind: 'ok' as const,
                lines: [{ lineIndex: 3, sourceLine: 'bad line', lineDigest: digest }],
            })),
        });
        const queue = makeQueue();

        await new ParseJobsService(dal, queue).retry(OWNER, JOB_ID);

        const messages = queue.enqueue.mock.calls[0]?.[0] ?? [];
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ jobId: JOB_ID, lineIndex: 3, sourceLine: 'bad line', lineDigest: digest });
    });

    it('does not call the queue when nothing was retryable', async () => {
        const queue = makeQueue();

        await new ParseJobsService(makeDal(), queue).retry(OWNER, JOB_ID);

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('answers 404 for a stranger and 409 for an expired job', async () => {
        const missing = makeDal({
            resetForRetry: vi.fn<ParseJobsDalPort['resetForRetry']>(async () => ({ kind: 'missing' as const })),
        });
        const expired = makeDal({
            resetForRetry: vi.fn<ParseJobsDalPort['resetForRetry']>(async () => ({ kind: 'expired' as const })),
        });

        await expect(new ParseJobsService(missing, makeQueue()).retry(OWNER, JOB_ID)).rejects.toMatchObject({
            code: RecipeErrorCode.PARSE_JOB_NOT_FOUND,
        });
        await expect(new ParseJobsService(expired, makeQueue()).retry(OWNER, JOB_ID)).rejects.toMatchObject({
            code: RecipeErrorCode.PARSE_JOB_EXPIRED,
        });
    });
});

describe('editLine', () => {
    it('stores the TRIMMED replacement and re-enqueues the new phrase under its NEW digest (R17)', async () => {
        const dal = makeDal();
        const queue = makeQueue();

        await new ParseJobsService(dal, queue).editLine(OWNER, JOB_ID, 0, '  3 eggs  ');

        expect(dal.editLine).toHaveBeenCalledWith(OWNER, JOB_ID, 0, '3 eggs', lineDigest('3 eggs', sha256Hex));
        const messages = queue.enqueue.mock.calls[0]?.[0] ?? [];
        expect(messages[0]).toMatchObject({
            jobId: JOB_ID,
            lineIndex: 0,
            sourceLine: '3 eggs',
            lineDigest: lineDigest('3 eggs', sha256Hex),
        });
    });

    it('answers 404 for a missing line and 409 for an expired job', async () => {
        const missing = makeDal({
            editLine: vi.fn<ParseJobsDalPort['editLine']>(async () => ({ kind: 'missing' as const })),
        });
        const expired = makeDal({
            editLine: vi.fn<ParseJobsDalPort['editLine']>(async () => ({ kind: 'expired' as const })),
        });

        await expect(new ParseJobsService(missing, makeQueue()).editLine(OWNER, JOB_ID, 9, 'x')).rejects.toMatchObject({
            code: RecipeErrorCode.PARSE_JOB_NOT_FOUND,
        });
        await expect(new ParseJobsService(expired, makeQueue()).editLine(OWNER, JOB_ID, 0, 'x')).rejects.toMatchObject({
            code: RecipeErrorCode.PARSE_JOB_EXPIRED,
        });
    });

    it('marks the edited line failed_retryable when its re-enqueue throws', async () => {
        const dal = makeDal();
        const queue = makeQueue();
        queue.enqueue.mockRejectedValueOnce(new Error('sqs is down'));

        await new ParseJobsService(dal, queue).editLine(OWNER, JOB_ID, 0, '3 eggs');

        expect(dal.markLinesFailedRetryable).toHaveBeenCalledWith(JOB_ID, [0]);
    });
});
