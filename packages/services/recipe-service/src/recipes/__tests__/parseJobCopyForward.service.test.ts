/**
 * `ParseJobsService.create` with copy-forward dedup — the business rules over fake ports.
 *
 * Written RED-first from `docs/plans/2026-09-19-001-feat-parse-job-enqueue-dedup-plan.md` §5. Separate
 * from `parseJobs.service.test.ts` so the pre-existing rules stay pinned by their own suite.
 *
 * ⛔ THE RULE THIS SUITE OWNS: a line the caller has already had answered is inserted WITH that answer and
 * produces NO message. The identity is the existing `lineDigest` — there is no second identity for a line.
 *
 * ⛔ AND THE TRAP IT EXISTS TO CATCH. A copied line never lands, so the worker never runs
 * `PARSE_JOB_AGGREGATE_SQL` for it. A job whose lines are ALL copies would therefore sit `running` forever
 * with zero pending lines — invisible to `POST :id/retry` (which re-drives only `failed_retryable`) and
 * swept only by the 24-hour TTL. That is the SECOND way to hang a job on this path, beside the 93%
 * landing-discard the brief records, and it is invisible to any test that leaves one line uncopied. Hence
 * the explicit all-copied case below.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import type { ParseLineJobMessage } from '@kitchensink/recipe-core/parsing/parse-job-message';

import { ParseJobsService } from '../parseJobs.service.js';
import { sha256Hex } from '../../common/sha256.js';
import type { CopyForwardCandidate } from '../domain/copyForwardPolicy.js';
import type { ParseJobRecord, ParseJobsDalPort } from '../parseJobs.service.js';

const OWNER = 'user_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const STRANGER = 'user_01ARZ3NDEKTSV4RRFFQ69G5FZZ';
const JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const FLOUR = '2 cups flour';
const EGGS = '3 large eggs';

function digestOf(line: string): string {
    return lineDigest(line, sha256Hex);
}

function proposalFor(raw: string): Record<string, unknown> {
    return {
        raw,
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [{ name: 'flour', prep: null }],
        reviewReasons: [],
    };
}

function candidateFor(line: string, overrides: Partial<CopyForwardCandidate> = {}): CopyForwardCandidate {
    return {
        lineDigest: digestOf(line),
        status: 'parsed',
        proposal: proposalFor(line),
        llmAttempts: 1,
        landedAt: new Date(Date.now() - 3_600_000),
        ...overrides,
    };
}

type MockedDal = { readonly [Method in keyof ParseJobsDalPort]: Mock<ParseJobsDalPort[Method]> };

/**
 * A DAL fake that honours the decision it is handed: a `copy` line is inserted TERMINAL with its proposal,
 * an `enqueue` line is inserted `pending`. Modelling that faithfully is what makes the "only pending lines
 * get a message" assertion mean anything.
 */
function makeDal(candidates: readonly CopyForwardCandidate[] = []): MockedDal {
    return {
        findCopyForwardCandidates: vi.fn<ParseJobsDalPort['findCopyForwardCandidates']>(async (ownerId, digests) =>
            ownerId === OWNER ? candidates.filter((c) => digests.includes(c.lineDigest)) : [],
        ),
        createJob: vi.fn<ParseJobsDalPort['createJob']>(async (_ownerId, lines, expiresAt) => {
            const built: ParseJobRecord = {
                id: JOB_ID,
                status: lines.every((line) => line.decision.kind === 'copy') ? 'complete' : 'running',
                createdAt: new Date('2026-09-19T00:00:00.000Z'),
                expiresAt,
                lines: lines.map((line, index) => ({
                    lineIndex: index,
                    sourceLine: line.sourceLine,
                    lineDigest: line.lineDigest,
                    status: line.decision.kind === 'copy' ? line.decision.status : ('pending' as const),
                    proposal: line.decision.kind === 'copy' ? line.decision.proposal : null,
                    llmAttempts: line.decision.kind === 'copy' ? line.decision.llmAttempts : null,
                })),
            };

            return built;
        }),
        correctionsChangedAt: vi.fn<ParseJobsDalPort['correctionsChangedAt']>(async () => null),
        getJob: vi.fn<ParseJobsDalPort['getJob']>(async () => undefined),
        markLinesFailedRetryable: vi.fn<ParseJobsDalPort['markLinesFailedRetryable']>(async () => undefined),
        resetForRetry: vi.fn<ParseJobsDalPort['resetForRetry']>(async () => ({ kind: 'ok' as const, lines: [] })),
        editLine: vi.fn<ParseJobsDalPort['editLine']>(async () => ({
            kind: 'ok' as const,
            line: { lineIndex: 0, sourceLine: EGGS, lineDigest: digestOf(EGGS) },
        })),
    };
}

function makeQueue(): { enqueue: Mock<(messages: readonly ParseLineJobMessage[]) => Promise<void>> } {
    return { enqueue: vi.fn<(messages: readonly ParseLineJobMessage[]) => Promise<void>>(async () => undefined) };
}

/** Every line the queue was actually asked to carry, flattened across calls. */
function enqueuedLines(queue: ReturnType<typeof makeQueue>): string[] {
    return queue.enqueue.mock.calls.flatMap(([messages]) => messages.map((message) => message.sourceLine));
}

describe('create — dedup before queuing', () => {
    it('enqueues every line when the caller has never submitted any of them', async () => {
        const dal = makeDal();
        const queue = makeQueue();

        await new ParseJobsService(dal, queue).create(OWNER, `${FLOUR}\n${EGGS}`);

        expect(enqueuedLines(queue)).toEqual([FLOUR, EGGS]);
    });

    it('looks candidates up by the SAME lineDigest the messages and stored rows carry', async () => {
        const dal = makeDal();

        await new ParseJobsService(dal, makeQueue()).create(OWNER, FLOUR);

        expect(dal.findCopyForwardCandidates).toHaveBeenCalledWith(OWNER, [digestOf(FLOUR)], expect.any(Number));
    });

    it('sends NO message for a line the caller has already had answered', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue).create(OWNER, FLOUR);

        expect(queue.enqueue).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
        expect(enqueuedLines(queue)).toEqual([]);
        expect(view.lines[0]?.status).toBe('parsed');
        expect(view.lines[0]?.proposal).not.toBeNull();
    });

    it('enqueues only the unanswered lines of a mixed paste', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue).create(OWNER, `${FLOUR}\n${EGGS}`);

        expect(enqueuedLines(queue)).toEqual([EGGS]);
        expect(view.lines.map((line) => line.status)).toEqual(['parsed', 'pending']);
    });

    /**
     * ⛔ THE HANG TRAP. Zero messages must not mean a job nobody ever finishes. With every line copied there
     * is no landing, so the worker never recomputes the aggregate — `create` must have done it.
     */
    it('reports a job whose lines were ALL copied as complete, with no message sent at all', async () => {
        const dal = makeDal([candidateFor(FLOUR), candidateFor(EGGS)]);
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue).create(OWNER, `${FLOUR}\n${EGGS}`);

        expect(enqueuedLines(queue)).toEqual([]);
        expect(view.status).toBe('complete');
        expect(view.lines.every((line) => line.status === 'parsed')).toBe(true);
    });

    it('leaves a partially-copied job running, because its remaining line is still outstanding', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);

        const view = await new ParseJobsService(dal, makeQueue()).create(OWNER, `${FLOUR}\n${EGGS}`);

        expect(view.status).toBe('running');
    });

    it('copies an answer to EVERY position of a line repeated inside one paste', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue).create(OWNER, `${FLOUR}\n${FLOUR}`);

        expect(view.lines).toHaveLength(2);
        expect(view.lines.map((line) => line.status)).toEqual(['parsed', 'parsed']);
        expect(enqueuedLines(queue)).toEqual([]);
    });

    /**
     * A recipe legitimately lists the same ingredient twice and the paste is POSITIONAL, so an unanswered
     * repeat yields TWO lines and TWO messages. Collapsing them would strand the twin `pending` forever —
     * the worker's landing is keyed on `line_index`.
     */
    it('still produces one line and one message per position for an unanswered repeat', async () => {
        const dal = makeDal();
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue).create(OWNER, `${EGGS}\n${EGGS}`);

        expect(view.lines).toHaveLength(2);
        expect(enqueuedLines(queue)).toEqual([EGGS, EGGS]);
    });

    it('does not copy another owner’s answer — the lookup is owner-scoped', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue).create(STRANGER, FLOUR);

        expect(enqueuedLines(queue)).toEqual([FLOUR]);
        expect(view.lines[0]?.status).toBe('pending');
    });

    it('carries THIS submission’s spelling in the copied proposal (HAZ-041)', async () => {
        const spaced = '2  cups   flour';
        const dal = makeDal([candidateFor(spaced, { proposal: proposalFor(FLOUR) })]);

        const view = await new ParseJobsService(dal, makeQueue()).create(OWNER, spaced);

        expect((view.lines[0]?.proposal as { raw: string } | null)?.raw).toBe(spaced);
    });
});

describe('create — what copy-forward must not disturb', () => {
    /**
     * ⛔ An enqueue failure marks the lines it tried to send. A COPIED line was never sent and already holds
     * an answer; regressing it to `failed_retryable` would discard a good parse to report a queue outage.
     */
    it('marks only the lines it tried to send when the enqueue fails', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();
        queue.enqueue.mockRejectedValueOnce(new Error('sqs is down'));

        await new ParseJobsService(dal, queue).create(OWNER, `${FLOUR}\n${EGGS}`);

        expect(dal.markLinesFailedRetryable).toHaveBeenCalledWith(JOB_ID, [1]);
    });

    it('issues no queue call at all when every line was copied', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();

        await new ParseJobsService(dal, queue).create(OWNER, FLOUR);

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('still enqueues the new phrase on a line edit, which copy-forward never short-circuits', async () => {
        const dal = makeDal([candidateFor(EGGS)]);
        const queue = makeQueue();
        dal.getJob.mockResolvedValue({
            id: JOB_ID,
            status: 'running',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3_600_000),
            lines: [],
        });

        await new ParseJobsService(dal, queue).editLine(OWNER, JOB_ID, 0, EGGS);

        expect(enqueuedLines(queue)).toEqual([EGGS]);
    });
});

describe('create — the kill switch', () => {
    /**
     * ⛔ `PARSE_COPY_FORWARD_MAX_AGE_HOURS = 0` must cost NOTHING, not merely change nothing.
     *
     * The DAL's candidate lookup short-circuits on a zero window by itself, but the corrections watermark
     * does not — and that read is a measured SEQ SCAN of `ingredient_parse_corrections` (20,000 rows →
     * 254 buffers, 1.7 ms). Leaving it in place would mean the documented kill switch disabled the
     * behaviour while keeping a per-request scan on the create hot path, which is the opposite of what a
     * kill switch is for. The guard therefore sits in the SERVICE, ahead of both reads.
     */
    it('issues neither lookup when the window is zero, and still enqueues every line', async () => {
        const dal = makeDal([candidateFor(FLOUR)]);
        const queue = makeQueue();

        const view = await new ParseJobsService(dal, queue, 0).create(OWNER, `${FLOUR}\n${EGGS}`);

        expect(dal.findCopyForwardCandidates).not.toHaveBeenCalled();
        expect(dal.correctionsChangedAt).not.toHaveBeenCalled();
        expect(enqueuedLines(queue)).toEqual([FLOUR, EGGS]);
        expect(view.lines.every((line) => line.status === 'pending')).toBe(true);
    });
});
