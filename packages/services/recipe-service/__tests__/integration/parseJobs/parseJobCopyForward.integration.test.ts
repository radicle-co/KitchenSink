/**
 * Copy-forward dedup through the REAL app, database and LocalStack queue.
 *
 * Written RED-first from `docs/plans/2026-09-19-001-feat-parse-job-enqueue-dedup-plan.md` §5.
 *
 * ⛔ WHAT ONLY THIS TIER CAN PROVE. The unit suite's fakes replace the two things the whole change is
 * about — the SQL that decides what a copied line looks like, and the QUEUE that is supposed to stay
 * empty. A fake queue returns whatever it was told; `drainQueue` here reads real SQS, so "no message was
 * produced for this line" is a fact about the system rather than about a spy.
 *
 *  1. **The message is never sent.** Counted off the real `recipe-parse-line` queue after a purge.
 *  2. **The copy commits with the job.** One transaction, read back from `recipe_parse_job_lines`.
 *  3. **The aggregate is recomputed at create.** A copied line NEVER lands, so the worker never runs
 *     `PARSE_JOB_AGGREGATE_SQL` for it — an all-copied job would otherwise sit `running` with zero pending
 *     lines until its 24-hour TTL. That is the second way to hang a job on this path and it is only
 *     observable by reading `recipe_parse_jobs.status` back out of the database.
 *  4. **Concurrent submission.** Two real requests for the same unanswered line, in flight together. The
 *     design takes NO lock and relies on the substrate that already exists (the cache's
 *     `ON CONFLICT DO NOTHING`, `claimLine`'s lease, the R17 digest guard), so the claim under test is that
 *     the race costs at most one extra parse and never a wrong or missing answer.
 *
 * `landAs` mirrors the worker's own landing UPDATE (`recipe-workers/handlers/parseLine.ts`), exactly as
 * `parseJobs.integration.test.ts` does — this tier stands in for the worker, which does not run here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PurgeQueueCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { PARSE_JOB_AGGREGATE_SQL } from '@kitchensink/recipe-core/parsing/parse-job-aggregate';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_PARSE_QUEUE_URL } from '../../../tests/globalSetup.js';
import { recipeDb } from '../../../tests/support/roleDb.js';
import { sha256Hex } from '../../../src/common/sha256.js';

const OWNER = '01JCOPYFWDOWNER000000000AA';
const STRANGER = '01JCOPYFWDSTRANGER0000000AA';
const roleDb = recipeDb();

const FLOUR = '2 cups copyfwd flour';
const EGGS = '3 large copyfwd eggs';

interface JobView {
    id: string;
    status: string;
    lines: { lineIndex: number; sourceLine: string; status: string; proposal: { raw: string } | null }[];
}

describe.skipIf(!hasDatabaseUrl)('parse-job copy-forward (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let sqs: SQSClient;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        sqs = new SQSClient({
            region: 'us-east-1',
            endpoint: process.env['SQS_ENDPOINT'] ?? process.env['S3_ENDPOINT'] ?? 'http://localhost:4566',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
        // ⚠️ The parse queue is SHARED across this tier's files (`fileParallelism: false` orders them but
        // does not empty it), so a sibling suite's leftovers would otherwise be counted as this suite's
        // first send. Purge once up front; `afterEach` keeps it clean thereafter.
        await sqs.send(new PurgeQueueCommand({ QueueUrl: SEED_PARSE_QUEUE_URL }));
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id IN ($1, $2)`, [OWNER, STRANGER]);
        await pool.query(`DELETE FROM ingredient_parse_corrections WHERE normalized_key LIKE 'copyfwd-%'`);
        await sqs.send(new PurgeQueueCommand({ QueueUrl: SEED_PARSE_QUEUE_URL }));
    });

    afterAll(async () => {
        await pool.end();
        sqs.destroy();
        await booted.close();
    });

    /**
     * Every message THIS SUITE produced that is currently on the queue.
     *
     * ⚠️ Filtered to this suite's own principals, not merely drained. The queue is shared across the tier's
     * files, and a count that includes a neighbour's messages would fail in the direction that looks like a
     * product defect — or, worse, PASS a "no message was sent" assertion by cancelling out.
     */
    async function drainQueue(): Promise<Record<string, unknown>[]> {
        const bodies: Record<string, unknown>[] = [];

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SEED_PARSE_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 1,
                }),
            );

            for (const message of received.Messages ?? []) {
                const body = JSON.parse(message.Body ?? '{}') as Record<string, unknown>;

                if (body['userId'] === OWNER || body['userId'] === STRANGER) {
                    bodies.push(body);
                }
            }
        }

        return bodies;
    }

    /** Create a job as the booted identity ({@link OWNER}). */
    async function createJob(text: string): Promise<JobView> {
        const response = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
        });

        expect(response.status).toBe(202);

        return (await response.json()) as JobView;
    }

    /**
     * Create a job as a DIFFERENT principal.
     *
     * ⚠️ `asPrincipal` flips a process-global env var, so this is only ever used around a SEQUENTIAL
     * request — never inside the concurrency case below.
     */
    async function createJobAs(userId: string, text: string): Promise<JobView> {
        return asPrincipal(userId, async () => createJob(text));
    }

    /** Edit one line's text through the real PATCH route, as the booted identity. */
    async function editLine(jobId: string, lineIndex: number, sourceLine: string): Promise<void> {
        const response = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${jobId}/lines/${lineIndex}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceLine }),
        });

        expect(response.status).toBe(202);
    }

    /** The WORKER's landing UPDATE, mirrored — this tier stands in for the worker. */
    async function landAs(jobId: string, lineIndex: number, sourceLine: string, status = 'parsed'): Promise<void> {
        const result = await pool.query(
            `UPDATE recipe_parse_job_lines
                SET status = $4, proposal = $5::jsonb, llm_attempts = 1, updated_at = now()
              WHERE job_id = $1 AND line_index = $2 AND line_digest = $3`,
            [
                jobId,
                lineIndex,
                lineDigest(sourceLine, sha256Hex),
                status,
                JSON.stringify({
                    raw: sourceLine,
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: '2 cups',
                    foods: [{ name: 'copyfwd flour', prep: null }],
                    reviewReasons: [],
                }),
            ],
        );

        expect(result.rowCount).toBe(1);
    }

    it('sends a message for a line nobody has answered, and none for the repeat', async () => {
        const first = await createJob(FLOUR);
        expect(await drainQueue()).toHaveLength(1);
        await landAs(first.id, 0, FLOUR);

        const second = await createJob(FLOUR);

        // ⛔ THE WHOLE POINT: the second submission produces NO message on the real queue.
        expect(await drainQueue()).toEqual([]);
        expect(second.lines[0]?.status).toBe('parsed');
        expect(second.lines[0]?.proposal).not.toBeNull();
    });

    it('stores the copied line terminal in the same transaction as the job', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await drainQueue();

        const second = await createJob(FLOUR);

        const { rows } = await pool.query<{ status: string; proposal: { raw: string }; attempts: number | null }>(
            `SELECT status, proposal, attempts FROM recipe_parse_job_lines WHERE job_id = $1`,
            [second.id],
        );

        expect(rows[0]?.status).toBe('parsed');
        expect(rows[0]?.proposal?.raw).toBe(FLOUR);
        // A copied line was never delivered, so it has spent none of its delivery allowance.
        expect(rows[0]?.attempts ?? 0).toBe(0);
    });

    /** ⛔ The hang trap, read straight off the job row. */
    it('marks an all-copied job complete rather than leaving it running until the TTL', async () => {
        const first = await createJob(`${FLOUR}\n${EGGS}`);
        await landAs(first.id, 0, FLOUR);
        await landAs(first.id, 1, EGGS);
        await drainQueue();

        const second = await createJob(`${FLOUR}\n${EGGS}`);

        const { rows } = await pool.query<{ status: string }>(`SELECT status FROM recipe_parse_jobs WHERE id = $1`, [
            second.id,
        ]);

        expect(await drainQueue()).toEqual([]);
        expect(rows[0]?.status).toBe('complete');
        expect(second.status).toBe('complete');
    });

    it('leaves a partly-copied job running and enqueues only its unanswered line', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await drainQueue();

        const second = await createJob(`${FLOUR}\n${EGGS}`);
        const messages = await drainQueue();

        expect(messages).toHaveLength(1);
        expect(messages[0]?.['sourceLine']).toBe(EGGS);
        expect(second.status).toBe('running');
    });

    it('does not copy across owners — a stranger’s identical line is re-queued', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await drainQueue();

        const stranger = await createJobAs(STRANGER, FLOUR);

        expect(await drainQueue()).toHaveLength(1);
        expect(stranger.lines[0]?.status).toBe('pending');
    });

    /**
     * ⛔ REVERSED BY OWNER RULING (2026-09-19): "let's not cache failed_retryable and unparseable". This
     * case previously asserted the opposite — that an `unparseable` answer was copied and produced no
     * message — on the argument that it is a terminal reading rather than a failure.
     *
     * ⚠️ The status cannot tell a genuinely food-free line ("spoonfuls") from one an exhausted validator
     * loop gave up on, so carrying it forward meant a line the parser could not read was never re-read.
     * The cost of reversing it is one message per resubmission, which is what this case now asserts.
     */
    it('⛔ does NOT copy an unparseable answer — it is re-queued for another attempt', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR, 'unparseable');
        await drainQueue();

        const second = await createJob(FLOUR);

        expect(await drainQueue()).toHaveLength(1);
        expect(second.lines[0]?.status).toBe('pending');
    });

    /**
     * ⛔ `failed_retryable` is ABSENCE, not a reading — "we kept trying and could not get to it". Copying it
     * would turn a transient outage into a permanent fact about an ingredient (ADR-0026 §3's rule that
     * `single-engine` is not `differ`, one table over).
     *
     * ⚠️ THE ROW IS LANDED FIRST AND ONLY THEN DEMOTED, which is what makes this test mean anything. An
     * earlier version merely flipped the status on a never-landed line, leaving `proposal` NULL — so the
     * row was excluded by the `proposal IS NOT NULL` predicate and the test passed no matter what the
     * status rule said. Measured: admitting `failed_retryable` as copyable left that version GREEN. With a
     * proposal present, the status is the ONLY thing excluding it.
     */
    it('re-queues a failed_retryable line even though it carries a proposal — that is not an answer', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await pool.query(`UPDATE recipe_parse_job_lines SET status = 'failed_retryable' WHERE job_id = $1`, [first.id]);

        const { rows } = await pool.query<{ proposal: unknown }>(
            `SELECT proposal FROM recipe_parse_job_lines WHERE job_id = $1`,
            [first.id],
        );
        expect(rows[0]?.proposal).not.toBeNull();
        await drainQueue();

        await createJob(FLOUR);

        expect(await drainQueue()).toHaveLength(1);
    });

    /**
     * HAZ-041 through a real `jsonb` round trip: the digest collapses whitespace, so the two spellings share
     * a digest — but the copied proposal must quote THIS submission's bytes.
     */
    it('rewrites the copied proposal’s raw to the submitted spelling', async () => {
        const spaced = '2  cups   copyfwd flour';
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await drainQueue();

        const second = await createJob(spaced);

        expect(second.lines[0]?.proposal?.raw).toBe(spaced);
        expect(second.lines[0]?.sourceLine).toBe(spaced);
    });

    /**
     * ⛔ GENERATION LAUNDERING — the defect that makes `copied_at` load-bearing rather than bookkeeping.
     *
     * `landedAt` is read from `updated_at`, and a COPIED row's `updated_at` is its INSERT time, not the
     * original landing. So without `copied_at IS NULL` in the candidate predicate, an answer landed at T0,
     * copied at T1, then copied again FROM THAT COPY at T2 would present as having landed at T1 — and the
     * answer would never age out, defeating BOTH the recency window and the corrections watermark through a
     * chain of copies.
     *
     * Proven by removing the original: once only the COPY survives, there must be no candidate left.
     */
    it('never treats a copied line as a copy source', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await drainQueue();

        const second = await createJob(FLOUR);
        expect(second.lines[0]?.status).toBe('parsed');

        const { rows: copied } = await pool.query<{ copied_at: Date | null }>(
            `SELECT copied_at FROM recipe_parse_job_lines WHERE job_id = $1`,
            [second.id],
        );
        expect(copied[0]?.copied_at).not.toBeNull();

        // Remove the worker-landed original, leaving ONLY the copy as a possible source.
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE id = $1`, [first.id]);

        const third = await createJob(FLOUR);

        expect(await drainQueue()).toHaveLength(1);
        expect(third.lines[0]?.status).toBe('pending');
    });

    /**
     * ⛔ The job status is DERIVED IN THE CREATE TRANSACTION, not recomputed after it. This pins that the two
     * representations agree: running the shared aggregate afterwards must be a NO-OP, so a future refactor
     * cannot let `create`'s ternary and `PARSE_JOB_AGGREGATE_SQL` drift into disagreeing.
     */
    it('derives a status the shared aggregate agrees with — re-running it changes nothing', async () => {
        const first = await createJob(`${FLOUR}\n${EGGS}`);
        await landAs(first.id, 0, FLOUR);
        await landAs(first.id, 1, EGGS);
        await drainQueue();

        const second = await createJob(`${FLOUR}\n${EGGS}`);

        // ⛔ BEFORE the aggregate — this is the claim. Asserting only the end state would pass even if
        // `create` inserted `running` and the aggregate did the work, which is precisely the durability gap
        // this design exists to close (in the all-copies case NOTHING else ever calls the aggregate).
        // Measured: mutating `create` to always insert `running` leaves an end-state-only assertion GREEN.
        const before = await pool.query<{ status: string }>(`SELECT status FROM recipe_parse_jobs WHERE id = $1`, [
            second.id,
        ]);
        expect(before.rows[0]?.status).toBe('complete');

        // ...and running the shared aggregate afterwards changes nothing, so the two representations of
        // "what this job's status is" cannot drift apart.
        await pool.query(PARSE_JOB_AGGREGATE_SQL, [second.id]);

        const after = await pool.query<{ status: string }>(`SELECT status FROM recipe_parse_jobs WHERE id = $1`, [
            second.id,
        ]);
        expect(after.rows[0]?.status).toBe('complete');
    });

    /**
     * ⛔ THE CORRECTIONS ORDERING RULE, end to end. Copy-forward is a tier above `corrections` that cannot
     * consult it; the watermark is the discharge. A correction recorded after an answer landed must stop
     * that answer being served, or a cook corrects a parse and silently gets the old one back forever.
     */
    it('stops copying once a correction is recorded after the answer landed', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);
        await drainQueue();

        await pool.query(
            `INSERT INTO ingredient_parse_corrections
                 (normalized_key, scope, origin, surfacing, corrected_facts, created_at)
             VALUES ($1, 'global', 'curator', 'silent', $2::jsonb, now() + interval '1 minute')`,
            [`copyfwd-${Date.now()}`, JSON.stringify({ foods: [] })],
        );

        const second = await createJob(FLOUR);

        expect(await drainQueue()).toHaveLength(1);
        expect(second.lines[0]?.status).toBe('pending');
    });

    /**
     * ⛔ Q4 — concurrency, with NO lock by design. Both requests miss, both enqueue, both would parse; the
     * race costs one extra parse and never a wrong answer. Asserted as: both jobs exist, both lines are
     * pending, and exactly one message exists per submitted line (no message is lost, none is doubled).
     */
    it('lets two simultaneous submissions of the same unanswered line both proceed, losing nothing', async () => {
        const [a, b] = await Promise.all([createJob(FLOUR), createJob(FLOUR)]);

        const messages = await drainQueue();

        expect(a.id).not.toBe(b.id);
        expect(messages).toHaveLength(2);
        expect(a.lines[0]?.status).toBe('pending');
        expect(b.lines[0]?.status).toBe('pending');
    });

    /**
     * ⛔ AN EDITED LINE IS A DIFFERENT PHRASE, SO IT MUST NOT STAY MARKED AS A COPY.
     *
     * `editLine` rewrites `line_digest` — the row is now ABOUT something else — and clears every other
     * field that described the old phrase, for the reason the DAL states at its own edit statement:
     * "`failure_code` goes for the same reason: it described the old phrase." `copied_at` is in that same
     * class and was the one field left behind.
     *
     * Three things break while it persists, and none of them raises:
     *
     *  1. The column's own `COMMENT ON COLUMN` (migration 0048) says NULL means the worker landed it. That
     *     is false for every copied → edited → landed row.
     *  2. `copied_at` is the only observable measure of copy-forward's hit rate, so it over-counts forever.
     *  3. ⛔ The one that costs a cook: the candidate predicate is `l.copied_at IS NULL`, so a genuinely
     *     worker-landed answer is excluded from the candidate pool PERMANENTLY. The edited line is the line
     *     a cook is most likely to paste again — they just fixed it — and it is exactly the line that would
     *     never dedup.
     *
     * Reachable from the route: `editLine`'s `WHERE` is `(jobId, lineIndex)` with no status filter, so any
     * copied line can be edited.
     */
    it('⛔ clears copied_at on edit, so the re-landed answer can be copied forward again', async () => {
        const first = await createJob(FLOUR);
        await landAs(first.id, 0, FLOUR);

        // A second submission copies it — the row under test is now a COPY.
        const second = await createJob(FLOUR);
        const copied = await pool.query<{ copiedAt: Date | null }>(
            `SELECT copied_at AS "copiedAt" FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [second.id],
        );

        expect(copied.rows[0]?.copiedAt).not.toBeNull();

        // The cook edits that copied line to a new phrase, and the worker lands the new one for real.
        await editLine(second.id, 0, EGGS);

        const afterEdit = await pool.query<{ copiedAt: Date | null; status: string }>(
            `SELECT copied_at AS "copiedAt", status FROM recipe_parse_job_lines
              WHERE job_id = $1 AND line_index = 0`,
            [second.id],
        );

        // ⛔ THE ASSERTION. The row no longer describes the phrase that was copied, so nothing about it is
        // a copy any more.
        expect(afterEdit.rows[0]?.status).toBe('pending');
        expect(afterEdit.rows[0]?.copiedAt).toBeNull();

        // And the consequence that makes it matter: this row is now eligible to answer a later submission
        // of the phrase it actually holds.
        await landAs(second.id, 0, EGGS);
        await drainQueue();

        const third = await createJob(EGGS);
        const messages = await drainQueue();

        expect(messages).toHaveLength(0);
        expect(third.lines[0]?.status).toBe('parsed');
    });

    /**
     * ⛔ THE ASSERTION THAT PROTECTS NEWEST-WINS. The rule and the argument for it live at
     * `COPY_FORWARD_CANDIDATES_SQL`'s docstring in `src/recipes/dal/parseJobs.dal.ts`, which owns the
     * `ORDER BY … DESC` that decides it; this comment deliberately does not restate that reasoning, because
     * restating it at each site is how it came to be stated four ways and wrong in three of them.
     *
     * What belongs HERE is only what this tier does that no other can: it builds two landed answers for ONE
     * digest, both inside the window and both eligible, distinguishable by their stored proposal, and
     * asserts the copy carries the NEWER one. The unit tier cannot — one row per digest reaches the policy
     * in production, so its loop is exercised there only as a contract, never as this decision.
     */
    it("⛔ copies the most recently landed answer when a digest has several — the DAL's ordering", async () => {
        const older = await createJob(FLOUR);
        await landAs(older.id, 0, FLOUR);
        await pool.query(
            `UPDATE recipe_parse_job_lines
                SET proposal = jsonb_set(proposal, '{unit}', '"older"'), updated_at = now() - interval '2 hours'
              WHERE job_id = $1 AND line_index = 0`,
            [older.id],
        );

        const newer = await createJob(FLOUR);
        // The second job copied the first, so mark it worker-landed to make it an eligible candidate.
        await pool.query(
            `UPDATE recipe_parse_job_lines
                SET proposal = jsonb_set(proposal, '{unit}', '"newer"'), copied_at = NULL, updated_at = now()
              WHERE job_id = $1 AND line_index = 0`,
            [newer.id],
        );
        await drainQueue();

        const third = await createJob(FLOUR);
        const landed = await pool.query<{ proposal: { unit: string } }>(
            `SELECT proposal FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [third.id],
        );

        expect(third.lines[0]?.status).toBe('parsed');
        expect(landed.rows[0]?.proposal.unit).toBe('newer');
    });
});
