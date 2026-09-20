/**
 * U8 — the parse leg's STORAGE claims against a real PostgreSQL: the cache round trip, the corrections
 * precedence mirror, and R17's digest-guarded landing.
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the cache's `ON CONFLICT (parse_key) DO NOTHING`, the corrections
 * statement's three-way predicate, and the landing's zero-row discard are all claims about the DATABASE —
 * a fake pool answers whatever it is told (`handle-sync-worker`'s lesson).
 *
 * ## Where the deleted `ParseCacheDal`'s coverage went
 *
 * `recipe-service`'s `ParseCacheDal` was a second, UNCALLED implementation of these same two statements; it
 * and its two suites were deleted rather than kept as a "reference statement shape", because a copy nothing
 * runs and no compiler checks cannot be authoritative — `ParseCachePort` already holds that contract. Its
 * `DO NOTHING` and redelivery claims were already proven here. Its two claims that were NOT — that the read
 * returns EVERY engine, and that a MULTI-line batch attributes each row to its own line — moved into this
 * file, against the live port. Both were previously asserted only against in-memory doubles and a fake pool,
 * which is exactly what this file's own docstring says cannot prove a claim about the database.
 *
 * ⚠️ Its `parsedAt` ISO-8601 mapping did NOT move: the live port neither selects `parsed_at` nor carries it
 * on `CachedParseRow`, so there is no live behaviour left to assert. The column itself is still pinned by
 * `recipe-service`'s `parseCacheSchema.integration.test.ts`, which asserts the table's column set by equality.
 *
 * Runs against the role-split fixture (`../roleDb.js`) as `recipe_app`; skipped when no admin server is
 * configured.
 */
import { createHash } from 'node:crypto';

import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { createParseCachePort, createParseCorrectionsPort } from '../../../src/parsing/parsePorts.js';
import { processParseLine, type ParseLineDeps } from '../../../src/handlers/parseLine.js';
import { makeParseLineDeps } from './__fixtures__/parseLineDeps.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

/** The subject connects as `recipe_app` (ADR-0039): DML and nothing else, which is what the workers hold. */
const roleDb = recipeWorkersDb();
const canRun = hasTestDatabase;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const LINE = '2 cups u8 integration flour';

describe.skipIf(!canRun)('the parse leg storage (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredient_parse_cache WHERE engine_version = 'u8-test'`);
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id = 'u8-test-owner'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    const queryable = () => ({ query: (text: string, params: unknown[]) => pool.query(text, params) });

    /**
     * Seed one job holding one line, and drive the handler for it.
     *
     * ⛔ SHARED because this is the THIRD occurrence with the same reason to change — the
     * `recipe_parse_jobs` / `recipe_parse_job_lines` insert pair — which is the threshold CLAUDE.md's DRY
     * rule names. The tests that use them stay DAMP in what matters: each still declares its own line, its
     * own digest and its own engine double, because those are what each case is ABOUT.
     *
     * @param line - The source line to seed.
     * @param storedDigest - Its digest, as the message will carry it.
     * @returns The new job's id.
     * @sideEffect Inserts a job and a line.
     */
    async function seedJobLine(line: string, storedDigest: string): Promise<string> {
        const jobResult = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, expires_at) VALUES ('u8-test-owner', now() + interval '1 day')
             RETURNING id`,
        );
        const jobId = (jobResult.rows[0] as { id: string }).id;
        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
             VALUES ($1, 0, $2, $3)`,
            [jobId, line, storedDigest],
        );

        return jobId;
    }

    /**
     * Run the handler for one seeded line.
     *
     * @param deps - The handler dependencies the case built.
     * @param jobId - The job to drive.
     * @param line - The source line, carried on the message.
     * @param storedDigest - Its digest, which R17 recomputes and compares.
     * @sideEffect Parses and lands, or refuses.
     */
    async function submitLine(deps: ParseLineDeps, jobId: string, line: string, storedDigest: string): Promise<void> {
        await processParseLine(deps, {
            jobId,
            lineIndex: 0,
            sourceLine: line,
            lineDigest: storedDigest,
            userId: 'u8-test-owner',
            requestedAt: new Date().toISOString(),
        });
    }

    it('the cache remembers once per key and reads back by digest', async () => {
        const cache = createParseCachePort(queryable());
        const stored = {
            parseKey: 'v1:u8testkey0001',
            lineDigest: 'v1:u8testdigest01' as never,
            engine: 'crf' as const,
            engineVersion: 'u8-test',
            parse: { statedMeasure: null, quantity: { kind: 'absent' }, unit: null, foods: [] } as never,
        };

        await cache.remember(stored);
        // Second write under the same key: DO NOTHING — first write wins within a generation.
        await cache.remember({ ...stored, parse: { ...(stored.parse as object), unit: 'cup' } as never });

        const rows = await cache.findForLines(['v1:u8testdigest01' as never]);

        expect(rows).toHaveLength(1);
        const firstRow = rows[0];
        expect(firstRow).toBeDefined();
        expect((firstRow?.parse as { unit: string | null } | undefined)?.unit ?? 'MISSING').not.toBe('cup');
    });

    it('⛔ returns EVERY engine stored for one line, so the comparator never adjudicates one answer against itself', async () => {
        // ⛔ KTD-13 at the read side, against the real SELECT. `ParseCachePort.findForLines`' contract says a
        // narrowing to one row per line would hand the comparator a single parse and it would report `agree`
        // on every line, forever, with nothing failing. A `LIMIT 1` or `DISTINCT ON (line_digest)` added to
        // the statement fails HERE — and only here: the pipeline's own suites assert this over in-memory
        // doubles, which return whatever they were seeded with no matter what the SQL says.
        const cache = createParseCachePort(queryable());
        const digest = 'v1:u8testdigest02' as never;
        const facts = { statedMeasure: null, quantity: { kind: 'absent' }, unit: null, foods: [] } as never;

        await cache.remember({
            parseKey: 'v1:u8testkey02crf',
            lineDigest: digest,
            engine: 'crf',
            engineVersion: 'u8-test',
            parse: facts,
        });
        await cache.remember({
            parseKey: 'v1:u8testkey02llm',
            lineDigest: digest,
            engine: 'llm',
            engineVersion: 'u8-test',
            parse: facts,
        });

        const rows = await cache.findForLines([digest]);

        expect(rows.map((row) => row.engine).sort()).toEqual(['crf', 'llm']);
        // The version is a member of the KEY, not an attribute — a row projected without it could not be
        // generation-checked by the pipeline, which discards a row whose version is not the port's current one.
        expect(rows.map((row) => row.engineVersion)).toEqual(['u8-test', 'u8-test']);
    });

    it('reads a BATCH of digests in one call and attributes every row to its OWN line', async () => {
        // ⛔ `= ANY($1::text[])` with a REAL multi-element array, which nothing else exercises: every other
        // suite reads a single digest. A row mis-attributed here serves one line's parse to another — the
        // worst cache hit available — and a positional zip in place of the carried `lineDigest` would do it.
        //
        // ⚠️ The pairing is asserted through each row's own PAYLOAD, not through `parse_key`: the port does
        // not select that column and `CachedParseRow` does not carry it, so a key-based assertion would be
        // testing the deleted DAL's shape instead of this one's. The payload is what a mis-attribution
        // actually corrupts.
        const cache = createParseCachePort(queryable());
        const digestA = 'v1:u8testdigest03a' as never;
        const digestB = 'v1:u8testdigest03b' as never;
        const digestAbsent = 'v1:u8testdigest03f' as never;
        const factsFor = (name: string) =>
            ({ statedMeasure: null, quantity: { kind: 'absent' }, unit: null, foods: [{ name, prep: null }] }) as never;

        await cache.remember({
            parseKey: 'v1:u8testkey03a',
            lineDigest: digestA,
            engine: 'crf',
            engineVersion: 'u8-test',
            parse: factsFor('line-a-food'),
        });
        await cache.remember({
            parseKey: 'v1:u8testkey03b',
            lineDigest: digestB,
            engine: 'crf',
            engineVersion: 'u8-test',
            parse: factsFor('line-b-food'),
        });

        // ⛔ The ABSENT digest goes FIRST, and that ordering is load-bearing. Asked in insertion order this
        // test passes against a port that ignores `line_digest` and zips rows to the request positionally —
        // measured: that mutation survived until the order was perturbed. A digest with no row can never be
        // a correct label for any row, so leading with it makes a positional answer wrong whichever order
        // PostgreSQL returns the two real rows in.
        const rows = await cache.findForLines([digestAbsent, digestA, digestB]);

        // A line nobody parsed contributes NO row — a miss, never an error and never a placeholder.
        expect(
            rows
                .map((row) => [
                    row.lineDigest,
                    (row.parse as { foods: { name: string }[] }).foods[0]?.name ?? 'MISSING',
                ])
                .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
        ).toEqual([
            [digestA, 'line-a-food'],
            [digestB, 'line-b-food'],
        ]);
    });

    it('the corrections mirror honours scope: global visible to nobody-present, personal only to its author', async () => {
        const corrections = createParseCorrectionsPort(queryable());
        await pool.query(
            `INSERT INTO ingredient_parse_corrections (normalized_key, source_line, corrected_facts, scope, origin, user_id, surfacing)
             VALUES ('u8test global key', 'x', '{"foods": []}'::jsonb, 'global', 'curator', NULL, 'u8-test'),
                    ('u8test personal key', 'x', '{"foods": []}'::jsonb, 'author', 'author', 'u8-author', 'u8-test')`,
        );

        try {
            expect(await corrections.findInForce('u8test global key' as never, undefined)).toBeDefined();
            expect(await corrections.findInForce('u8test personal key' as never, undefined)).toBeUndefined();
            expect(await corrections.findInForce('u8test personal key' as never, 'u8-author')).toBeDefined();
            expect(await corrections.findInForce('u8test personal key' as never, 'someone-else')).toBeUndefined();
        } finally {
            await pool.query(`DELETE FROM ingredient_parse_corrections WHERE normalized_key LIKE 'u8test%'`);
        }
    });

    it('⛔ R17 end-to-end: a landing under the stored digest lands; a stale digest lands NOTHING', async () => {
        const jobResult = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, expires_at) VALUES ('u8-test-owner', now() + interval '1 day')
             RETURNING id`,
        );
        const jobId = (jobResult.rows[0] as { id: string }).id;
        const storedDigest = lineDigest(LINE, digest);
        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
             VALUES ($1, 0, $2, $3)`,
            [jobId, LINE, storedDigest],
        );

        const deps = makeParseLineDeps({
            pool: queryable(),
            digest,
            crf: {
                engine: 'crf',
                engineVersion: 'u8-test',
                parse: async (lines) =>
                    lines.map(() => ({
                        raw: LINE,
                        statedMeasure: '2 cups',
                        quantity: { kind: 'exact' as const, value: 2 },
                        unit: 'cup',
                        foods: [{ name: 'u8 integration flour', prep: null }],
                        reviewReasons: [],
                        provenance: {
                            statedMeasure: 'crf' as const,
                            quantity: 'crf' as const,
                            unit: 'crf' as const,
                            foods: 'crf' as const,
                        },
                    })),
            },
        });

        await processParseLine(deps, {
            jobId,
            lineIndex: 0,
            sourceLine: LINE,
            lineDigest: storedDigest,
            userId: 'u8-test-owner',
            requestedAt: new Date().toISOString(),
        });

        const landed = await pool.query(
            `SELECT status FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [jobId],
        );

        expect((landed.rows[0] as { status: string }).status).toBe('parsed');

        const job = await pool.query(`SELECT status FROM recipe_parse_jobs WHERE id = $1`, [jobId]);

        expect((job.rows[0] as { status: string }).status).toBe('complete');

        // Simulate an EDIT: the stored hash moves on; a replay of the OLD message must land nothing.
        await pool.query(
            `UPDATE recipe_parse_job_lines SET line_digest = 'moved-on', status = 'pending' WHERE job_id = $1`,
            [jobId],
        );
        await processParseLine(deps, {
            jobId,
            lineIndex: 0,
            sourceLine: LINE,
            lineDigest: storedDigest,
            userId: 'u8-test-owner',
            requestedAt: new Date().toISOString(),
        });

        const after = await pool.query(`SELECT status FROM recipe_parse_job_lines WHERE job_id = $1`, [jobId]);

        expect((after.rows[0] as { status: string }).status).toBe('pending');
    });

    /**
     * ⛔ THE DEDUP ROUND TRIP, THROUGH A REAL DATABASE: one string, two submissions, ONE engine ask.
     *
     * ## Why this cannot be proved one tier down
     *
     * `parsePipeline.test.ts`'s dedup block proves the same contract against a write-through fake, which
     * settles the pipeline's own logic and nothing about the STORE. Three of this claim's load-bearing
     * parts are facts about PostgreSQL and are invisible to any in-memory double:
     *
     *  1. **The write is durable and the read finds it** — `remember` INSERTs, a LATER `findForLines` in a
     *     DIFFERENT transaction SELECTs it back. A fake returns what it was handed in the same process.
     *  2. **The identity survives the column round trip** — `parse_key`, `line_digest` and `engine_version`
     *     go out through `pg` and come back through `pg`. A digest that survives a JS `Map` but is truncated
     *     or re-cased by its column is a miss that costs a billed call and raises no error.
     *  3. **`ON CONFLICT (parse_key) DO NOTHING` is what absorbs a genuine race** — the second writer is
     *     silently discarded rather than raising, which is the behaviour the concurrent window relies on.
     *
     * ## What is real here and what is a double, and why that split is the honest one
     *
     * The DATABASE is real, because it is the thing under test. The ENGINES are counting doubles, because
     * an engine invocation is precisely the quantity being counted and the real CRF reports no count — the
     * subject of the assertion must be observable, and this is the only boundary at which it is. Each
     * double records every batch it is handed, so a second ask cannot hide.
     *
     * ⚠️ Scope: this pins dedup across SUBMISSIONS. It is not a claim about an engine generation change
     * (`engine_version` is in the key on purpose, so a model pin re-parses) nor about the retry rules (one
     * submission re-asked after a disputed validation). See the dedup block in `parsePipeline.test.ts`.
     */
    it('⛔ a SECOND submission of the same line asks NO engine — proved against the real cache table', async () => {
        const line = 'u8 dedup: 3 cups of stone-ground cornmeal';
        const storedDigest = lineDigest(line, digest);
        const engineAsks: (readonly string[])[] = [];

        const deps = makeParseLineDeps({
            pool: queryable(),
            digest,
            crf: {
                engine: 'crf',
                engineVersion: 'u8-dedup-test',
                parse: async (lines: readonly string[]) => {
                    engineAsks.push(lines);

                    return lines.map(() => ({
                        raw: line,
                        statedMeasure: '3 cups',
                        quantity: { kind: 'exact' as const, value: 3 },
                        unit: 'cup',
                        foods: [{ name: 'u8 dedup cornmeal', prep: null }],
                        reviewReasons: [],
                        provenance: {
                            statedMeasure: 'crf' as const,
                            quantity: 'crf' as const,
                            unit: 'crf' as const,
                            foods: 'crf' as const,
                        },
                    }));
                },
            },
        });

        // ⛔ The LLM leg's ask is counted by the same rule as the CRF's: a second submission that reached
        // Bedrock would append a second entry. Overridden by name so the substitution is visible here
        // rather than buried inside the factory's defaults.
        deps.gated.bedrock.converse = async () => {
            engineAsks.push(['llm-converse']);

            return {
                kind: 'answered' as const,
                text: '[]',
                stopReason: 'end_turn',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
        };

        // FIRST submission — a line nothing has ever answered. This is the one that pays.
        const firstJob = await seedJobLine(line, storedDigest);
        await submitLine(deps, firstJob, line, storedDigest);

        const asksAfterFirst = engineAsks.length;

        expect(asksAfterFirst).toBeGreaterThan(0);

        const cachedAfterFirst = await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ingredient_parse_cache WHERE line_digest = $1`,
            [storedDigest],
        );

        expect(Number(cachedAfterFirst.rows[0]?.count ?? '0')).toBeGreaterThan(0);

        // SECOND submission — a DIFFERENT job, same string. Nothing in this call knows about the first
        // except what the database now holds.
        const secondJob = await seedJobLine(line, storedDigest);
        await submitLine(deps, secondJob, line, storedDigest);

        // ⛔ NEITHER ENGINE IS ASKED — including the LLM double, which answered `[]`. The owner's ruling
        // against remembering a failure is about the LINE, and this line was READ: the CRF named a food, so
        // it lands `parsed` and both readings are remembered, silence included. Were the LLM's silence
        // dropped instead, this second submission would re-ask it, and a re-ask that failed would arrive as
        // ABSENCE — a different fact from "that engine found no food" (ADR-0026 §3).
        expect(engineAsks.length).toBe(asksAfterFirst);

        // And the second line still landed a real answer, so dedup bought a saving rather than a hole.
        const landed = await pool.query<{ status: string; proposal: unknown }>(
            `SELECT status, proposal FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [secondJob],
        );

        expect(landed.rows[0]?.status).toBe('parsed');
        expect(landed.rows[0]?.proposal).not.toBeNull();
    });

    /**
     * ⛔ TWO SUBMISSIONS OF ONE NEVER-ANSWERED LINE, IN FLIGHT TOGETHER, COST ONE ENGINE ASK.
     *
     * This is the case every other dedup layer misses by construction: copy-forward, the cache and the
     * pipeline's in-paste collapse all need an answer to ALREADY exist, and here none does yet. Before the
     * per-digest lease both callers read the cache, both missed, and both called the engines.
     *
     * ⚠️ In every non-prod stage the deployment hides this — the parse consumer runs at
     * `reservedConcurrentExecutions: 1` with `batchSize: 1`, so messages are handled one at a time. Prod is
     * configured at 5. Calling the handler directly is what makes the prod shape observable here rather
     * than only after it ships.
     *
     * ⛔ The loser is NOT refused: it waits once, then runs the pipeline normally and lands from the cache
     * the winner just filled. Both lines end `parsed`, which is the half that matters — the lease may cost
     * a billed call, never an answer.
     */
    it('⛔ two concurrent submissions of one unanswered line ask the engines ONCE', async () => {
        const line = 'u8 lease: 2 cups of stone-ground cornmeal';
        const storedDigest = lineDigest(line, digest);
        const engineAsks: (readonly string[])[] = [];

        const deps = makeParseLineDeps({
            pool: queryable(),
            digest,
            crf: {
                engine: 'crf',
                engineVersion: 'u8-lease-test',
                parse: async (lines: readonly string[]) => {
                    engineAsks.push(lines);

                    return lines.map(() => ({
                        raw: line,
                        statedMeasure: '2 cups',
                        quantity: { kind: 'exact' as const, value: 2 },
                        unit: 'cup',
                        foods: [{ name: 'u8 lease cornmeal', prep: null }],
                        reviewReasons: [],
                        provenance: {
                            statedMeasure: 'crf' as const,
                            quantity: 'crf' as const,
                            unit: 'crf' as const,
                            foods: 'crf' as const,
                        },
                    }));
                },
            },
        });

        const [firstJob, secondJob] = await Promise.all([
            seedJobLine(line, storedDigest),
            seedJobLine(line, storedDigest),
        ]);

        await Promise.all([
            submitLine(deps, firstJob, line, storedDigest),
            submitLine(deps, secondJob, line, storedDigest),
        ]);

        expect(engineAsks).toHaveLength(1);

        const landed = await pool.query<{ status: string }>(
            `SELECT status FROM recipe_parse_job_lines WHERE job_id = ANY($1::uuid[]) AND line_index = 0`,
            [[firstJob, secondJob]],
        );

        expect(landed.rows.map((row) => row.status)).toEqual(['parsed', 'parsed']);
    });

    /**
     * ⚠️ THE OTHER SIDE OF THE WAIT, PINNED RATHER THAN ASSERTED. The sibling case above proves the lease
     * saves an ask when the winner's parse finishes inside `PARSE_LEASE_WAIT_MS`. Its fake CRF returns
     * synchronously, so it would pass for ANY wait above zero and can say nothing about whether 1.5s is
     * enough for a real parse — nobody has a parse-duration distribution for this leg.
     *
     * ⛔ So this case makes the bound observable: a winner slower than the wait costs TWO asks. That is the
     * documented degradation — exactly what the system did before the lease existed — and pinning it means
     * a future change to the wait has a test that states the trade instead of a comment that claims it.
     *
     * ⚠️ IT PINS N=2 AND NOTHING WIDER. Every loser wakes independently and each asks once, so the bound is
     * N−1 extra asks at concurrency N (ADR-0044) — four at prod's `maximumConcurrency: 5`. Two asks here is
     * this case's value, not a constant, and a third concurrent submission would cost a third ask.
     */
    it('⚠️ a winner slower than the wait costs the loser an ask — the bound, not a regression', async () => {
        const line = 'u8 slowlease: 4 cups of rolled oats';
        const storedDigest = lineDigest(line, digest);
        const engineAsks: (readonly string[])[] = [];
        const SLOWER_THAN_THE_WAIT_MS = 2_500;

        const deps = makeParseLineDeps({
            pool: queryable(),
            digest,
            crf: {
                engine: 'crf',
                engineVersion: 'u8-slowlease-test',
                parse: async (lines: readonly string[]) => {
                    engineAsks.push(lines);
                    await new Promise((resolve) => setTimeout(resolve, SLOWER_THAN_THE_WAIT_MS));

                    return lines.map(() => ({
                        raw: line,
                        statedMeasure: '4 cups',
                        quantity: { kind: 'exact' as const, value: 4 },
                        unit: 'cup',
                        foods: [{ name: 'u8 slowlease oats', prep: null }],
                        reviewReasons: [],
                        provenance: {
                            statedMeasure: 'crf' as const,
                            quantity: 'crf' as const,
                            unit: 'crf' as const,
                            foods: 'crf' as const,
                        },
                    }));
                },
            },
        });

        const [firstJob, secondJob] = await Promise.all([
            seedJobLine(line, storedDigest),
            seedJobLine(line, storedDigest),
        ]);

        await Promise.all([
            submitLine(deps, firstJob, line, storedDigest),
            submitLine(deps, secondJob, line, storedDigest),
        ]);

        expect(engineAsks).toHaveLength(2);
    }, 30_000);
});
