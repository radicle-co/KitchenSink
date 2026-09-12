/**
 * U6 — the parse line is CLAIMED before any paid work (R6/R7/R9/R12/R18), against real PostgreSQL.
 *
 * ⛔ WHY THE CLAIM EXISTS. `processParseLine` used to run the whole pipeline and decide what to land
 * afterwards, so every delivery paid for its engines before anything could observe the work was pointless.
 * Three populations paid that cost for nothing: a line whose JOB had expired (the sweep discards whatever
 * lands), a line ALREADY parsed (the digest guard discards the second landing), and two deliveries of the
 * same line arriving together — which is ordinary, because SQS standard delivery is at-least-once.
 *
 * The claim is ONE statement ahead of the engines that asserts the job is unexpired, the stored digest
 * matches, the line is still claimable, and the lease is free. **Zero rows returned IS the refusal**, and
 * the message completes having invoked nothing.
 *
 * ⛔ WHY THIS TIER. Every one of those predicates is a claim about the DATABASE — about `now()` against a
 * stored `expires_at`, about a row lock serialising two concurrent claims, about `RETURNING` giving the
 * post-increment value. A fake pool answers whatever it is told, which is the lesson `handle-sync-worker`
 * taught this repository. A unit test here would assert the string of an SQL statement.
 *
 * Runs against the role-split fixture as `recipe_app` (ADR-0039); skipped when no admin server is configured.
 */
import { createHash } from 'node:crypto';

import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { processParseLine, type ParseLineDeps } from '../../../src/handlers/parseLine.js';
import type { GatedLlmDeps } from '../../../src/parsing/gatedLlm.js';
import { instantSleep } from './__fixtures__/parseLineDeps.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const LINE = '2 cups u6 claim flour';
const OWNER = 'u6-claim-owner';

describe.skipIf(!hasTestDatabase)('the parse-line claim (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id = $1`, [OWNER]);
        await pool.query(`DELETE FROM ingredient_parse_cache WHERE engine_version = 'u6-test'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    const queryable = () => ({ query: (text: string, params: unknown[]) => pool.query(text, params) });

    /** A CRF engine that COUNTS its invocations — the cost this unit exists to stop paying. */
    function countingCrf(): { engine: ParseLineDeps['crf']; calls: () => number } {
        const parse = vi.fn(async (lines: readonly string[]) =>
            lines.map(() => ({
                raw: LINE,
                statedMeasure: '2 cups',
                quantity: { kind: 'exact' as const, value: 2 },
                unit: 'cup',
                foods: [{ name: 'u6 claim flour', prep: null }],
                reviewReasons: [],
                provenance: {
                    statedMeasure: 'crf' as const,
                    quantity: 'crf' as const,
                    unit: 'crf' as const,
                    foods: 'crf' as const,
                },
            })),
        );

        return {
            engine: { engine: 'crf', engineVersion: 'u6-test', parse } as ParseLineDeps['crf'],
            calls: () => parse.mock.calls.length,
        };
    }

    /**
     * A gated LLM leg that COUNTS its Bedrock calls.
     *
     * ⚠️ Counted rather than forbidden. A leg that threw on being reached would prove the refusal cases and
     * break the admitted ones, where it legitimately runs beside the CRF — and "the engines were not paid
     * for" is a claim about BOTH legs, so both are counted. Asserting only that nothing LANDED would pass
     * for a run that called Bedrock and then discarded the answer, which is the cost this unit exists to
     * stop paying.
     */
    function countingGated(): { deps: ParseLineDeps['gated']; calls: () => number } {
        const converse = vi.fn(async () => ({
            kind: 'answered' as const,
            text: '[]',
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }));

        // ⛔ TYPED AS THE REAL PORT. `as never` satisfies any parameter, so this double would keep compiling
        // after `GatedLlmDeps` changed shape — and it already had: the cast was silently accepting a literal
        // that omitted `deployRegion` entirely.
        const deps: GatedLlmDeps = {
            stage: 'sandbox',
            deployRegion: 'us-east-1',
            settings: { resolve: async () => ({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }) },
            ledger: {
                reserve: async () => ({ kind: 'reserved' as const, reservedMicros: 1 }),
                settle: async () => undefined,
            },
            bedrock: { converse },
            emit: () => undefined,
            now: () => new Date(),
        };

        return { deps, calls: () => converse.mock.calls.length };
    }

    /** The whole engine cost of a run — what a refused claim must leave at zero. */
    function makeSubject(): {
        deps: ParseLineDeps;
        engineCalls: () => number;
    } {
        const crf = countingCrf();
        const gated = countingGated();

        return {
            deps: {
                stage: 'sandbox',
                gated: gated.deps,
                crf: crf.engine,
                pool: queryable(),
                digest,
                emit: () => {},
                parseModelId: 'amazon.nova-micro-v1:0',
                sleep: instantSleep,
                claimLeaseSeconds: 150,
                deliveryAllowance: 20,
            },
            engineCalls: () => crf.calls() + gated.calls(),
        };
    }

    /** Seed one job + one pending line; `expiresIn` is a Postgres interval literal. */
    async function seed(expiresIn = "interval '1 day'"): Promise<{ jobId: string; storedDigest: string }> {
        const job = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, expires_at) VALUES ($1, now() + ${expiresIn}) RETURNING id`,
            [OWNER],
        );
        const jobId = (job.rows[0] as { id: string }).id;
        const storedDigest = lineDigest(LINE, digest);
        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
             VALUES ($1, 0, $2, $3)`,
            [jobId, LINE, storedDigest],
        );

        return { jobId, storedDigest };
    }

    function message(jobId: string, storedDigest: string) {
        return {
            jobId,
            lineIndex: 0,
            sourceLine: LINE,
            lineDigest: storedDigest,
            userId: OWNER,
            requestedAt: new Date().toISOString(),
        };
    }

    async function lineRow(
        jobId: string,
    ): Promise<{ status: string; attempts: number | null; failure_code: string | null }> {
        const result = await pool.query(
            `SELECT status, attempts, failure_code FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [jobId],
        );

        return result.rows[0] as { status: string; attempts: number | null; failure_code: string | null };
    }

    it('⛔ a message for an EXPIRED job completes with no engine call', async () => {
        const { jobId, storedDigest } = await seed("- interval '1 second'");
        const subject = makeSubject();

        await processParseLine(subject.deps, message(jobId, storedDigest));

        expect(subject.engineCalls()).toBe(0);
        expect((await lineRow(jobId)).status).toBe('pending');
    });

    it('⛔ a message whose line is ALREADY PARSED completes with no engine call', async () => {
        const { jobId, storedDigest } = await seed();
        await pool.query(`UPDATE recipe_parse_job_lines SET status = 'parsed' WHERE job_id = $1`, [jobId]);
        const subject = makeSubject();

        await processParseLine(subject.deps, message(jobId, storedDigest));

        expect(subject.engineCalls()).toBe(0);
        expect((await lineRow(jobId)).status).toBe('parsed');
    });

    /**
     * The lease half. Two deliveries of one line arriving together is the ORDINARY case on a standard queue,
     * and before the claim both ran the pipeline. The second is refused because the first's claim is younger
     * than the handler's own timeout; a genuine redelivery only arrives after the queue's visibility timeout,
     * which is deliberately longer than that.
     */
    it('⛔ two deliveries of one line produce ONE engine call and ONE landing', async () => {
        const { jobId, storedDigest } = await seed();
        const subject = makeSubject();

        await processParseLine(subject.deps, message(jobId, storedDigest));
        const afterFirst = subject.engineCalls();
        await processParseLine(subject.deps, message(jobId, storedDigest));

        expect(afterFirst).toBeGreaterThan(0);
        expect(subject.engineCalls()).toBe(afterFirst);

        const row = await lineRow(jobId);
        expect(row.status).toBe('parsed');
        expect(row.attempts).toBe(1);
    });

    it('a claim RECORDS the delivery, so a line being redelivered stops being invisible', async () => {
        const { jobId, storedDigest } = await seed();

        await processParseLine(makeSubject().deps, message(jobId, storedDigest));

        const row = await lineRow(jobId);
        expect(row.attempts).toBe(1);
        expect(row.failure_code).toBeNull();
    });

    /**
     * Past the allowance the line becomes the population `POST :id/retry` re-drives, with a code saying why
     * — instead of staying `pending` until its job's TTL sweeps the whole import with no signal and nothing
     * the cook can do.
     */
    it('⛔ a line past the delivery allowance becomes RETRYABLE with a failure code, and pays no engine', async () => {
        const { jobId, storedDigest } = await seed();
        await pool.query(`UPDATE recipe_parse_job_lines SET attempts = 20 WHERE job_id = $1`, [jobId]);
        const subject = makeSubject();

        await processParseLine(subject.deps, message(jobId, storedDigest));

        expect(subject.engineCalls()).toBe(0);

        const row = await lineRow(jobId);
        expect(row.status).toBe('failed_retryable');
        expect(row.failure_code).toBe('delivery_allowance_exhausted');
    });

    it('a pre-migration row (NULL attempts) claims normally — expand-first means no backfill', async () => {
        const { jobId, storedDigest } = await seed();
        const subject = makeSubject();

        expect((await lineRow(jobId)).attempts).toBeNull();

        await processParseLine(subject.deps, message(jobId, storedDigest));

        expect(subject.engineCalls()).toBeGreaterThan(0);
        expect((await lineRow(jobId)).attempts).toBe(1);
    });
});
