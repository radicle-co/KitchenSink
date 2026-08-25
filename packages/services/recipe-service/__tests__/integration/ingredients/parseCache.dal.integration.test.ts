/**
 * `ParseCacheDal` against a REAL Postgres (plan U20, migration 0028).
 *
 * ⛔ WHY THIS TIER CARRIES THE WEIGHT. This DAL is two statements and no branching logic; mocking the Drizzle
 * handle would prove the mock was called with the arguments the test itself supplied. What can actually be
 * wrong is the SQL: whether `ON CONFLICT DO NOTHING` really leaves the first parse standing, whether the batch
 * read returns EVERY engine's row for a line rather than one, whether the row maps out of Drizzle as the
 * ISO-8601 string the repo's interfaces promise rather than a `Date`. None of those is observable from a mock.
 *
 * The sibling `parseCacheSchema.integration.test.ts` asserts the TABLE's own guarantees (the identity index,
 * the version-prefix CHECKs, the absent owner column). This file asserts what the DAL does with them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import type { LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { ParseCacheDal } from '../../../src/ingredients/dal/parseCache.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Digests unique to this suite, so its rows never collide with another spec's. */
const LINE_A = 'v1:u20dal0000000000000000000000000000000000000000000000000000000a' as LineDigest;
const LINE_B = 'v1:u20dal0000000000000000000000000000000000000000000000000000000b' as LineDigest;
const LINE_ABSENT = 'v1:u20dal000000000000000000000000000000000000000000000000000000ff' as LineDigest;

const KEY_A_CRF = 'v1:u20dalkey00000000000000000000000000000000000000000000000acrf';
const KEY_A_LLM = 'v1:u20dalkey00000000000000000000000000000000000000000000000allm';
const KEY_B_CRF = 'v1:u20dalkey00000000000000000000000000000000000000000000000bcrf';

const CRF_VERSION = 'crf-ingredient-phrase-tagger@0.1.0';
const LLM_VERSION = 'amazon.nova-micro-v1:0+prompt@1';

const CRF_PARSE = { quantity: { kind: 'exact', value: 2 }, unit: 'cup', foods: [{ name: 'flour', prep: null }] };
const LLM_PARSE = { quantity: { kind: 'exact', value: 2 }, unit: 'cup', foods: [{ name: 'flour', prep: 'sifted' }] };

describe.skipIf(!hasDatabaseUrl)('ParseCacheDal (migration 0028)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: ParseCacheDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new ParseCacheDal(db);
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredient_parse_cache WHERE line_digest = ANY($1)`, [[LINE_A, LINE_B]]);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('remembers a parse and reads it back in the domain shape', async () => {
        await dal.remember({
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: CRF_PARSE,
        });

        const [row] = await dal.findForLines([LINE_A]);

        expect(row).toMatchObject({
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: CRF_PARSE,
        });
        // ⛔ ISO 8601 string, never a `Date` — the repo-wide interface rule. Drizzle hands back a `Date`, so
        // this is a real mapping the DAL performs and a real thing to get wrong.
        expect(row?.parsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    });

    it('returns EVERY engine for a line — the comparator would otherwise have one answer', async () => {
        // ⛔ KTD-13 at the read side. A `LIMIT 1` or a `DISTINCT ON (line_digest)` here would silently hand the
        // comparator a single engine's parse and it would adjudicate that answer against itself.
        await dal.remember({
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: CRF_PARSE,
        });
        await dal.remember({
            parseKey: KEY_A_LLM,
            lineDigest: LINE_A,
            engine: 'llm',
            engineVersion: LLM_VERSION,
            parse: LLM_PARSE,
        });

        const rows = await dal.findForLines([LINE_A]);

        expect(rows.map((row) => row.engine).sort()).toEqual(['crf', 'llm']);
    });

    it('reads a BATCH of lines in one call and attributes each row to its own line', async () => {
        await dal.remember({
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: CRF_PARSE,
        });
        await dal.remember({
            parseKey: KEY_B_CRF,
            lineDigest: LINE_B,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: LLM_PARSE,
        });

        const rows = await dal.findForLines([LINE_A, LINE_B, LINE_ABSENT]);

        expect(
            rows.map((row) => [row.lineDigest, row.parseKey]).sort((left, right) => left[0].localeCompare(right[0])),
        ).toEqual([
            [LINE_A, KEY_A_CRF],
            [LINE_B, KEY_B_CRF],
        ]);
    });

    it('returns nothing for a line nobody has parsed — a MISS, not an error', async () => {
        // Absence is the ordinary case on a cold cache, and the pipeline's whole first pass is misses.
        await expect(dal.findForLines([LINE_ABSENT])).resolves.toEqual([]);
    });

    it('is WRITE-ONCE: a second remember of the same key leaves the first parse standing', async () => {
        // ⛔ `DO NOTHING`, not `DO UPDATE`, and the difference is not stylistic. The LLM leg is not
        // deterministic, so an overwriting cache lets a row change under a comparison that already cited it and
        // a re-run of the harness would silently measure different inputs. A corrected parse arrives as a new
        // `engineVersion` — never as a rewrite of a row somebody's measurement depends on.
        await dal.remember({
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: CRF_PARSE,
        });
        await dal.remember({
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: { foods: [{ name: 'REWRITTEN', prep: null }] },
        });

        const rows = await dal.findForLines([LINE_A]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.parse).toEqual(CRF_PARSE);
    });

    it('does not throw on a redelivered write, so a retried pipeline message is safe', async () => {
        const entry = {
            parseKey: KEY_A_CRF,
            lineDigest: LINE_A,
            engine: 'crf',
            engineVersion: CRF_VERSION,
            parse: CRF_PARSE,
        } as const;

        await dal.remember(entry);

        await expect(dal.remember(entry)).resolves.toBeUndefined();
    });
});
