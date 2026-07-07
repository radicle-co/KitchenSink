/**
 * Integration tests for {@link FoodSearchDao} ranked full-text search (T-180) against a REAL Postgres.
 *
 * Requirement → test mapping:
 * - FR-008  → local-store search returns canonical `id`s; ranked FTS (`ts_rank`) over name/description.
 * - FR-010  → results ranked by relevance (a closer lexical match ranks higher).
 * - FR-009  → search is local-only: the DAO has no source dependency and issues a single SQL read
 *             (structurally cannot call a source — there is no adapter/registry seam here).
 *
 * The ranked-FTS path is isolated from the pg_trgm fuzzy fallback by a WORD-ORDER-INDEPENDENT query
 * ("breast chicken"): a substring/`ILIKE`/trigram match cannot match the reversed phrase, but
 * `plainto_tsquery` matches both lexemes regardless of order — so a hit there proves FTS is active.
 *
 * Reuses `tests/support/db.ts` (applies BOTH ordered migrations 0000 + 0001). Shares one database; the
 * suite resets the schema in `beforeAll` and truncates between cases.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { FoodSearchDao } from '../src/foods/dao/food-search.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** Insert a RESOLVED food (search only surfaces RESOLVED golden records). */
async function seedFood(
    pool: pg.Pool,
    input: { id: string; name: string; description?: string | null },
): Promise<void> {
    await pool.query(
        `INSERT INTO food (id, name, normalized_name, description, status)
         VALUES ($1, $2, lower($2), $3, 'RESOLVED')`,
        [input.id, input.name, input.description ?? null],
    );
}

describe.skipIf(!DATABASE_URL)('FoodSearchDao ranked full-text search (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: FoodSearchDao;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
        db = makeDb(pool);
        dao = new FoodSearchDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food CASCADE');
    });

    it('matches a word-order-independent query via ranked FTS (not just substring/trigram)', async () => {
        await seedFood(pool, { id: 'f_chicken', name: 'Chicken breast, raw' });
        await seedFood(pool, { id: 'f_beef', name: 'Beef steak, raw' });

        // "breast chicken" is NOT a substring of "Chicken breast, raw" — only FTS lexeme matching hits.
        const hits = await dao.search('breast chicken');

        expect(hits.map((hit) => hit.id)).toContain('f_chicken');
        expect(hits.map((hit) => hit.id)).not.toContain('f_beef');
    });

    it('ranks a closer match above a tangential one (relevance ordering, FR-010)', async () => {
        // Both match the FTS lexeme "chicken"; the exact short name is the more relevant hit and must
        // rank first, the long tangential name still appears below it (ranked, not filtered out).
        await seedFood(pool, { id: 'f_exact', name: 'Chicken, raw' });
        await seedFood(pool, { id: 'f_long', name: 'Barbecue marinated grilled boneless chicken thigh pieces' });

        const hits = await dao.search('chicken');
        const ids = hits.map((hit) => hit.id);

        expect(ids[0]).toBe('f_exact');
        expect(ids).toContain('f_long');
        const exact = hits.find((hit) => hit.id === 'f_exact')!;
        const long = hits.find((hit) => hit.id === 'f_long')!;
        expect(exact.score).toBeGreaterThan(long.score);
    });

    it('still matches a description-only FTS hit and a fuzzy/typo name via pg_trgm fallback', async () => {
        await seedFood(pool, { id: 'f_desc', name: 'Edamame', description: 'Young soybeans in the pod' });
        await seedFood(pool, { id: 'f_avocado', name: 'Avocado, raw' });

        // FTS hit on the description.
        expect((await dao.search('soybeans')).map((hit) => hit.id)).toContain('f_desc');
        // pg_trgm fuzzy fallback: a typo'd name still matches.
        expect((await dao.search('avacado')).map((hit) => hit.id)).toContain('f_avocado');
    });

    it('returns canonical ids and an empty set on no match (never throws, never calls a source)', async () => {
        await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

        const hits = await dao.search('zzzznotathing');
        expect(hits).toEqual([]);

        const kale = await dao.search('kale');
        expect(kale.map((hit) => hit.id)).toEqual(['f_kale']);
        expect(kale[0]).toMatchObject({ id: 'f_kale', name: 'Kale, raw' });
        expect(typeof kale[0]!.score).toBe('number');
    });
});
