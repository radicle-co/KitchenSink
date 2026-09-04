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
 * Runs against `DATABASE_URL` (a recipe database with migrations applied); skipped without it.
 */
import { createHash } from 'node:crypto';

import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { createParseCachePort, createParseCorrectionsPort } from '../../../src/parsing/parsePorts.js';
import { processParseLine, type ParseLineDeps } from '../../../src/handlers/parseLine.js';
import { disposableDatabaseUrl } from '../disposableDatabaseUrl.js';

const DATABASE_URL = disposableDatabaseUrl();
const canRun = Boolean(DATABASE_URL);

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const LINE = '2 cups u8 integration flour';

describe.skipIf(!canRun)('the parse leg storage (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredient_parse_cache WHERE engine_version = 'u8-test'`);
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id = 'u8-test-owner'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    const queryable = () => ({ query: (text: string, params: unknown[]) => pool.query(text, params) });

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

        const deps: ParseLineDeps = {
            stage: 'sandbox',
            gated: {
                stage: 'sandbox',
                settings: {
                    resolve: async () => ({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
                },
                ledger: {
                    reserve: async () => ({ kind: 'reserved' as const, reservedMicros: 1 }),
                    settle: async () => undefined,
                } as never,
                bedrock: {
                    converse: async () => ({
                        kind: 'answered' as const,
                        text: '[]',
                        stopReason: 'end_turn',
                        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    }),
                } as never,
                emit: () => undefined,
                now: () => new Date(),
            } as never,
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
            pool: queryable() as never,
            digest,
            parseModelId: 'amazon.nova-micro-v1:0',
        };

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
});
