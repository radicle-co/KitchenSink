/**
 * A VANISHED CRF ENGINE LEAVES NOTHING BEHIND — against a real PostgreSQL.
 *
 * ## ⛔ WHY THIS TIER IS MANDATORY, and what the unit tier structurally cannot prove
 *
 * `parseLine.test.ts` drives `processParseLine` through a fake `pool` and asserts that no `UPDATE
 * recipe_parse_job_lines` statement was ISSUED. That proves the handler's control flow. It cannot prove the
 * thing an operator actually depends on, which is a claim about the DATABASE: that after a CRF outage the
 * row is still `pending` and its job is still `running`, so SQS redelivery re-runs the line and the job
 * never reaches a terminal state on a half-parsed answer. A fake pool returns whatever it was seeded with no
 * matter what the statement says — the argument `ParseCachePort`'s own docstring makes for asserting its two
 * rules only here.
 *
 * The defect this is the regression test for: `kitchensink-ingredient-parser-{stage}` had never been
 * deployed, the adapter mapped the failed invoke to per-line absence, and the pipeline landed the LLM's
 * SINGLE-ENGINE reading as the line's permanent answer — an outage becoming a fact about an ingredient,
 * which is exactly what ADR-0026's 2026-08-31 transient/terminal rule forbids.
 *
 * ⚠️ THE LLM LEG IS SERVED FROM THE CACHE, deliberately, and it is not a shortcut. It makes every case here
 * the REDELIVERY scenario — the one that matters, since the whole design rests on KTD-F's claim that a retry
 * re-pays only for what never landed. It also means nothing in this file reaches Bedrock or the spend
 * ledger, which is asserted rather than assumed.
 *
 * Runs against `DATABASE_URL` (a recipe database with migrations applied); skipped without it.
 */
import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { lineDigest, parseKey } from '@kitchensink/recipe-core/parsing/parse-key';
import { PARSE_PROMPT_VERSION } from '@kitchensink/recipe-core/parsing/parse-prompt';
import type { EngineAnswer, ParsedLine, ParseEnginePort } from '@kitchensink/recipe-import-core';

import { NOVA_2_LITE_MODEL_ID } from '@kitchensink/recipe-core/spend/spend-arithmetic';

import { PARSE_LEG_MODEL_ID, processParseLine, type ParseLineDeps } from '../../../src/handlers/parseLine.js';
import { CrfEngineUnavailableError } from '../../../src/parsing/crfInvoke.js';
import { disposableDatabaseUrl } from '../disposableDatabaseUrl.js';

const DATABASE_URL = disposableDatabaseUrl();
const canRun = Boolean(DATABASE_URL);

const OWNER = 'crf-absence-test-owner';
const LINE = '2 cups all-purpose flour';
const CRF_ENGINE_VERSION = 'ingredient-parser-nlp==2.3.0';
/** What `createValidatedLlmEngine` reports — `${modelId}@${promptVersion}`, derived, never a literal. */
const LLM_ENGINE_VERSION = `${PARSE_LEG_MODEL_ID}@${PARSE_PROMPT_VERSION}`;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The stored FACTS shape a cached row holds — the cook's line is deliberately not among them. */
const CACHED_FACTS = {
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: [{ name: 'all-purpose flour', prep: null }],
};

/** A CRF port that answers every line with `answer`, or rejects when `answer` is an Error. */
function crfPort(answer: EngineAnswer | Error): ParseEnginePort<'crf'> {
    return {
        engine: 'crf',
        engineVersion: CRF_ENGINE_VERSION,
        parse: async (lines: readonly string[]): Promise<readonly EngineAnswer[]> => {
            if (answer instanceof Error) {
                throw answer;
            }

            return lines.map(() => answer);
        },
    };
}

/** A CRF reading good enough to land, for the negative control. */
const crfParse: ParsedLine = {
    raw: LINE,
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: [{ name: 'all-purpose flour', prep: null }],
    reviewReasons: [],
    provenance: { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' },
};

describe.skipIf(!canRun)('a CRF outage never lands (integration)', () => {
    let pool: pg.Pool;
    let converse: ReturnType<typeof vi.fn>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
        await pool.query('DELETE FROM ingredient_parse_cache WHERE line_digest = $1', [lineDigest(LINE, digest)]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Seed one running job with one pending line, plus the LLM's already-cached reading of that line. */
    async function seed(): Promise<{ jobId: string; storedDigest: string }> {
        const job = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, status, expires_at)
             VALUES ($1, 'running', now() + interval '1 day')
             RETURNING id`,
            [OWNER],
        );
        const jobId = (job.rows[0] as { id: string }).id;
        const storedDigest = lineDigest(LINE, digest);

        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
             VALUES ($1, 0, $2, $3)`,
            [jobId, LINE, storedDigest],
        );
        await pool.query(
            `INSERT INTO ingredient_parse_cache (parse_key, line_digest, engine, engine_version, parse)
             VALUES ($1, $2, 'llm', $3, $4::jsonb)`,
            [
                parseKey({ lineDigest: storedDigest, engine: 'llm', engineVersion: LLM_ENGINE_VERSION }, digest),
                storedDigest,
                LLM_ENGINE_VERSION,
                JSON.stringify(CACHED_FACTS),
            ],
        );

        return { jobId, storedDigest };
    }

    /** The handler's deps over the REAL pool. The gated leg is present but must never be reached. */
    function deps(crf: ParseEnginePort<'crf'>): ParseLineDeps {
        converse = vi.fn();

        return {
            stage: 'integration',
            gated: {
                stage: 'integration',
                settings: { resolve: vi.fn() },
                ledger: { reserve: vi.fn(), settle: vi.fn() },
                bedrock: { converse },
                emit: vi.fn(),
                now: () => new Date('2026-09-02T12:00:00.000Z'),
            },
            crf,
            pool: { query: async (text: string, params: unknown[]) => pool.query(text, params) },
            digest,
            parseModelId: PARSE_LEG_MODEL_ID,
        } as unknown as ParseLineDeps;
    }

    /** Run one line, returning the rejection if there was one. */
    async function run(crf: ParseEnginePort<'crf'>, jobId: string, storedDigest: string): Promise<unknown> {
        return processParseLine(deps(crf), {
            jobId,
            lineIndex: 0,
            sourceLine: LINE,
            lineDigest: storedDigest,
            userId: OWNER,
            requestedAt: '2026-09-02T12:00:00.000Z',
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
    }

    it('⛔ leaves the row PENDING — the single-engine answer is not written as the line’s parse', async () => {
        const { jobId, storedDigest } = await seed();
        const gone = new CrfEngineUnavailableError('unreachable', 'ResourceNotFoundException: Function not found');
        const rejection = await run(crfPort(gone), jobId, storedDigest);

        expect(rejection).toBeInstanceOf(Error);

        const line = await pool.query(
            'SELECT status, proposal FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0',
            [jobId],
        );

        // ⛔ `pending`, and NOTHING else. `parsed` would be the outage published as the answer, and
        // `failed_retryable` would be terminal-shaped — U9's per-line retry re-runs exactly those, and the
        // job aggregate moves to `partial` — for a line that was never adjudicated at all.
        expect(line.rows[0]).toEqual({ status: 'pending', proposal: null });
    });

    it('leaves the JOB running, so a redelivered line can still complete it', async () => {
        const { jobId, storedDigest } = await seed();
        const gone = new CrfEngineUnavailableError('unreachable', 'AccessDeniedException: not authorized');

        expect(await run(crfPort(gone), jobId, storedDigest)).toBeInstanceOf(Error);

        const job = await pool.query('SELECT status FROM recipe_parse_jobs WHERE id = $1', [jobId]);

        expect((job.rows[0] as { status: string }).status).toBe('running');
    });

    it('⛔ KTD-F: the redelivery re-pays ONLY the CRF — the cached LLM reading is not re-bought', async () => {
        // This is what makes the retry affordable, and therefore what makes "an engine outage retries" a
        // sound rule rather than a spend amplifier against ADR-0024's single $100 pool. It is also why the
        // failed engine must write NOTHING: a cached absence would make the outage permanent for this line.
        const { jobId, storedDigest } = await seed();
        const gone = new CrfEngineUnavailableError('unreachable', 'Function not found');

        expect(await run(crfPort(gone), jobId, storedDigest)).toBeInstanceOf(Error);
        expect(converse).not.toHaveBeenCalled();

        const cached = await pool.query('SELECT engine FROM ingredient_parse_cache WHERE line_digest = $1', [
            storedDigest,
        ]);

        expect(cached.rows.map((row) => (row as { engine: string }).engine)).toEqual(['llm']);
    });

    it('the SAME line lands `parsed` once the CRF answers — the outage was the only thing stopping it', async () => {
        // The negative control. Without it every assertion above is satisfied by a handler that never lands
        // anything at all, which is not a fix — it is the same silence facing the other way.
        const { jobId, storedDigest } = await seed();

        expect(await run(crfPort(crfParse), jobId, storedDigest)).toBeUndefined();

        const line = await pool.query(
            'SELECT status FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0',
            [jobId],
        );
        const job = await pool.query('SELECT status FROM recipe_parse_jobs WHERE id = $1', [jobId]);

        expect((line.rows[0] as { status: string }).status).toBe('parsed');
        // Every line terminal → the aggregate closes the job, which is the statement the two writers share.
        expect((job.rows[0] as { status: string }).status).toBe('complete');
    });
});

/**
 * A RESIDENCY-REFUSED PARSE MODEL NEVER LANDS EITHER — against a real PostgreSQL (ADR-0024 §4b).
 *
 * ## ⛔ WHY THIS TIER, AND NOT ONLY `parseLine.test.ts`
 *
 * The unit tier proves that no `UPDATE recipe_parse_job_lines` was ISSUED. The claim an operator depends on
 * is about the DATABASE: after a refusal the row is still `pending`, its job is still `running`, and the CRF's
 * reading is still cached — so the moment the model is cleared, a redelivered line completes without
 * re-buying anything. A fake pool returns whatever it was seeded with no matter what the statement says.
 *
 * ## ⛔ THE DEFECT THIS IS THE REGRESSION TEST FOR — the one the obvious design ships
 *
 * A residency refusal reads like engine absence, so the natural implementation returns `{ unavailable: true }`
 * from the parse port. Do that and this file's own subject repeats one engine over: `processParseLine` reads
 * absence as a deterministic per-line fact, lands the CRF's SINGLE-ENGINE reading as the line's permanent
 * answer, and a deployment fault becomes a fact about an ingredient — with green unit tests, because the
 * handler behaved exactly as its contract says. `ResidencyRefusedError` exists to keep the refusal on the
 * outage side of that split.
 *
 * ⚠️ AND YET IT IS NOT TRANSIENT: unlike the outage above, `processParseLine` RESOLVES rather than rejecting,
 * because no redelivery can make feature 016 record a warrant. Both halves are asserted below; either one
 * alone is satisfiable by a wrong implementation.
 *
 * ⚠️ NO LLM CACHE ROW IS SEEDED HERE, unlike the suite above — the refusal happens inside `gatedConverse`,
 * which a cache hit would never reach.
 *
 * Runs against `DATABASE_URL`; skipped without it.
 */
describe.skipIf(!canRun)('a residency-refused parse model never lands (integration)', () => {
    let pool: pg.Pool;
    let converse: ReturnType<typeof vi.fn>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [OWNER]);
        await pool.query('DELETE FROM ingredient_parse_cache WHERE line_digest = $1', [lineDigest(LINE, digest)]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** One running job with one pending line, and NO cached LLM reading. */
    async function seedUncached(): Promise<{ jobId: string; storedDigest: string }> {
        const job = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, status, expires_at)
             VALUES ($1, 'running', now() + interval '1 day')
             RETURNING id`,
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

    /**
     * The handler's deps over the REAL pool, with the parse model overridden to a residency-refused one.
     *
     * ⛔ `NOVA_2_LITE_MODEL_ID` is named rather than fabricated: it is a real registry entry, profile-only over
     * three regions and carrying no warrant, which is exactly the state the shipped table is in. A fixture id
     * would test a shape the registry does not have.
     */
    function deps(): ParseLineDeps {
        converse = vi.fn();

        return {
            stage: 'integration',
            gated: {
                stage: 'integration',
                deployRegion: 'us-east-1',
                settings: { resolve: vi.fn().mockResolvedValue({ ceilingMicros: 100_000_000, modelId: 'unused' }) },
                ledger: { reserve: vi.fn(), settle: vi.fn() },
                bedrock: { converse },
                emit: vi.fn(),
                now: () => new Date('2026-09-04T12:00:00.000Z'),
            },
            crf: crfPort({ parsed: crfParse } as unknown as EngineAnswer),
            pool: { query: async (text: string, params: unknown[]) => pool.query(text, params) },
            digest,
            parseModelId: NOVA_2_LITE_MODEL_ID,
        } as unknown as ParseLineDeps;
    }

    /** Run one line, returning the rejection if there was one. */
    async function run(jobId: string, storedDigest: string): Promise<unknown> {
        return processParseLine(deps(), {
            jobId,
            lineIndex: 0,
            sourceLine: LINE,
            lineDigest: storedDigest,
            userId: OWNER,
            requestedAt: '2026-09-04T12:00:00.000Z',
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
    }

    it('⛔ leaves the row PENDING — the CRF-only reading is not written as the line’s parse', async () => {
        const { jobId, storedDigest } = await seedUncached();

        // ⛔ RESOLVES. A rejection here would be the transient path, i.e. twenty redeliveries and a DLQ entry
        // for a fault no redelivery can fix.
        expect(await run(jobId, storedDigest)).toBeUndefined();

        const line = await pool.query(
            'SELECT status, proposal FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0',
            [jobId],
        );

        expect(line.rows[0]).toEqual({ status: 'pending', proposal: null });
    });

    it('leaves the JOB running, so the line completes once 016 clears a model', async () => {
        const { jobId, storedDigest } = await seedUncached();

        await run(jobId, storedDigest);

        const job = await pool.query('SELECT status FROM recipe_parse_jobs WHERE id = $1', [jobId]);

        expect((job.rows[0] as { status: string }).status).toBe('running');
    });

    it('never reaches Bedrock, and writes no LLM cache row for a call that was not made', async () => {
        // ⛔ A cached absence would make the deployment fault PERMANENT for this line — the same reasoning
        // KTD-F applies to the outage case one describe up.
        const { jobId, storedDigest } = await seedUncached();

        await run(jobId, storedDigest);

        expect(converse).not.toHaveBeenCalled();

        const cached = await pool.query('SELECT engine FROM ingredient_parse_cache WHERE line_digest = $1', [
            storedDigest,
        ]);

        expect(cached.rows.map((row) => (row as { engine: string }).engine)).not.toContain('llm');
    });
});
