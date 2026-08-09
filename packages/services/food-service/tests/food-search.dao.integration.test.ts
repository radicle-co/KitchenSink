/**
 * Integration tests for {@link FoodSearchDao} against a REAL Postgres — both statements it routes to:
 * ranked full-text search for 3+ character queries (T-180) and the word-initial prefix path for 1–2
 * character queries (T-198).
 *
 * Requirement → test mapping:
 * - FR-008  → local-store search returns canonical `id`s; ranked FTS (`ts_rank`) over name/description.
 * - FR-010  → results ranked by relevance (a closer lexical match ranks higher).
 * - FR-009  → search is local-only: the DAO has no source dependency and issues a single SQL read
 *             (structurally cannot call a source — there is no adapter/registry seam here).
 * - SC-007  → a 1–2 character query is served by an INDEX, not the 85–157ms sequential scan T-195
 *             measured; asserted on the query PLAN of the exact statement the DAO runs.
 *
 * The ranked-FTS path is isolated from the pg_trgm fuzzy fallback by a WORD-ORDER-INDEPENDENT query
 * ("breast chicken"): a substring/`ILIKE`/trigram match cannot match the reversed phrase, but
 * `plainto_tsquery` matches both lexemes regardless of order — so a hit there proves FTS is active.
 *
 * Reuses `tests/support/db.ts` (applies every ordered migration). Shares one database; the suite resets
 * the schema in `beforeAll` and truncates between cases.
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

    /**
     * The 1–2 character word-initial prefix statement (T-198, SC-007).
     *
     * Every case here is chosen so that the OLD statement would fail it, or so that a plausible "fix" to
     * the new one would: the `eg` → `Large egg` case fails for a left-anchored `lower(name) LIKE 'eg%'`
     * index (the obvious alternative), the stopword cases fail if the tsquery config is changed from
     * `simple` to `english` (the query becomes empty and matches nothing), the metacharacter cases fail if
     * the token whitelist is removed (`to_tsquery` raises `syntax error in tsquery`), and the plan case
     * fails if the predicate is written in any form a GIN index cannot serve.
     */
    describe('word-initial prefix path for 1–2 character queries (T-198)', () => {
        it('matches word-initially on ONE character and ranks a name-initial hit first', async () => {
            await seedFood(pool, { id: 'f_cheddar', name: 'Cheddar cheese' });
            await seedFood(pool, { id: 'f_cottage', name: 'Large curd cottage cheese' });
            await seedFood(pool, { id: 'f_cottage_long', name: 'Large curd cottage cheese, low sodium, drained' });
            await seedFood(pool, { id: 'f_beef', name: 'Beef, ground' });

            const hits = await dao.search('c');
            const ids = hits.map((hit) => hit.id);

            expect(ids).toContain('f_cheddar');
            expect(ids).toContain('f_cottage');
            // No word in "Beef, ground" begins with "c" — a mid-word 'c' no longer qualifies.
            expect(ids).not.toContain('f_beef');
            // Name-initial outranks merely word-initial, and the score must ENCODE that ordering, because
            // the recipe service's FoodCatalogGateway re-sorts hits by `score DESC, name ASC`.
            expect(ids[0]).toBe('f_cheddar');
            const cheddar = hits.find((hit) => hit.id === 'f_cheddar')!;
            const cottage = hits.find((hit) => hit.id === 'f_cottage')!;
            const cottageLong = hits.find((hit) => hit.id === 'f_cottage_long')!;
            expect(cheddar.score).toBeGreaterThan(cottage.score);
            // Within a tier the shorter (more generic) name ranks higher.
            expect(cottage.score).toBeGreaterThan(cottageLong.score);
            expect(ids.indexOf('f_cottage')).toBeLessThan(ids.indexOf('f_cottage_long'));
        });

        it('ranks a name-initial hit above a SHORTER word-initial one (isolates the name-initial boost)', async () => {
            // The two ranking terms are deliberately put in conflict here. Ordered by name length alone,
            // "Egg chip" wins; only the name-initial bonus lifts the longer "Cheddar…" above it. Without
            // this case the boost could be deleted and every other ranking assertion would still pass,
            // because elsewhere the name-initial hit also happens to be the shorter one.
            await seedFood(pool, { id: 'f_cheddar', name: 'Cheddar cheese, sharp, aged and sliced' });
            await seedFood(pool, { id: 'f_chip', name: 'Egg chip' });

            const hits = await dao.search('ch');
            const cheddar = hits.find((hit) => hit.id === 'f_cheddar')!;
            const chip = hits.find((hit) => hit.id === 'f_chip')!;

            expect(hits.map((hit) => hit.id)[0]).toBe('f_cheddar');
            expect(cheddar.score).toBeGreaterThan(chip.score);
            // The bonus is a TIER, not a nudge: no name-length term can lift a merely word-initial hit
            // across it, which is what keeps the ordering intact when a consumer re-sorts by score.
            expect(cheddar.score).toBeGreaterThan(0.5);
            expect(chip.score).toBeLessThan(0.5);
            // …and still below the `1` FoodsService assigns a barcode/external-key crosswalk hit.
            expect(cheddar.score).toBeLessThan(1);
        });

        it('finds a 2-character word-initial match that is NOT name-initial ("eg" → "Large egg")', async () => {
            await seedFood(pool, { id: 'f_large_egg', name: 'Large egg, whole, raw' });
            await seedFood(pool, { id: 'f_eggplant', name: 'Eggplant, raw' });
            await seedFood(pool, { id: 'f_beef', name: 'Beef, ground' });

            const hits = await dao.search('eg');
            const ids = hits.map((hit) => hit.id);

            // THE case a left-anchored `lower(name) LIKE 'eg%'` prefix index would miss.
            expect(ids).toContain('f_large_egg');
            expect(ids).toContain('f_eggplant');
            expect(ids).not.toContain('f_beef');
            expect(ids[0]).toBe('f_eggplant');
        });

        it.each([
            { query: 'be', id: 'f_beans', name: 'Beans, black' },
            { query: 'on', id: 'f_onion', name: 'Onion, raw' },
            { query: 'it', id: 'f_italian', name: 'Italian dressing' },
            { query: 'is', id: 'f_isomalt', name: 'Isomalt' },
            { query: 'a', id: 'f_apple', name: 'Apple, raw' },
        ])(
            'still finds $name for the English STOPWORD query "$query" (empty-tsquery regression guard)',
            async ({ query, id, name }) => {
                await seedFood(pool, { id, name });

                // `plainto_tsquery('english', 'be')` and `to_tsquery('english', 'be:*')` are both EMPTY —
                // the `english` dictionary drops these as stopwords, so the query matches nothing at all.
                // The prefix statement must use the `simple` config for exactly this reason.
                const hits = await dao.search(query);

                expect(hits.map((hit) => hit.id)).toContain(id);
            },
        );

        it.each(['&', '|', '!', ':', '(', ')', "'", '<', '*', '&&', '::', '<>'])(
            'does not throw on the tsquery metacharacter query %j',
            async (query) => {
                await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

                // Unsanitised, each of these makes Postgres raise `syntax error in tsquery` — a 500 on a
                // keystroke. Sanitised, nothing searchable remains, so the DAO answers without a query.
                await expect(dao.search(query)).resolves.toEqual([]);
            },
        );

        it('keeps the searchable part of a mixed query and still matches', async () => {
            await seedFood(pool, { id: 'f_cheddar', name: 'Cheddar cheese' });

            expect((await dao.search('c&')).map((hit) => hit.id)).toEqual(['f_cheddar']);
            expect((await dao.search("'c")).map((hit) => hit.id)).toEqual(['f_cheddar']);
        });

        it('no longer matches MID-word at 2 characters (the deliberate semantic change)', async () => {
            await seedFood(pool, { id: 'f_chicken', name: 'Chicken breast, raw' });
            await seedFood(pool, { id: 'f_ranch', name: 'Ranch dressing' });

            // Both used to match `ILIKE '%ic%'` / `ILIKE '%an%'` and rank by trigram noise.
            expect(await dao.search('ic')).toEqual([]);
            expect((await dao.search('an')).map((hit) => hit.id)).not.toContain('f_ranch');
            // …while the word-initial forms of the same rows still match.
            expect((await dao.search('ch')).map((hit) => hit.id)).toContain('f_chicken');
            expect((await dao.search('ra')).map((hit) => hit.id)).toContain('f_ranch');
        });

        it('leaves 3+ character behaviour UNCHANGED — a mid-word substring still matches', async () => {
            await seedFood(pool, { id: 'f_chicken', name: 'Chicken breast, raw' });
            await seedFood(pool, { id: 'f_desc', name: 'Edamame', description: 'Young soybeans in the pod' });

            // Only the `ILIKE '%hic%'` / trigram branch of the relevance statement can match a mid-word
            // 3-character needle; routing 3 characters to the prefix statement would return nothing here.
            expect((await dao.search('hic')).map((hit) => hit.id)).toContain('f_chicken');
            // And the relevance statement still searches the DESCRIPTION, which the prefix path does not
            // need to (both USDA ingestion paths set `description := name`).
            expect((await dao.search('soybeans')).map((hit) => hit.id)).toContain('f_desc');
        });

        it('returns only word-initial matches for a highly selective 2-character query', async () => {
            await seedFood(pool, { id: 'f_zquark', name: 'Zquark cheese, raw' });
            await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

            expect((await dao.search('zq')).map((hit) => hit.id)).toEqual(['f_zquark']);
        });
    });

    // ── Why there is NO query-PLAN assertion here ────────────────────────────────────────────────────
    //
    // SC-007's claim is that a 1–2 character query is index-served rather than scanned, and the obvious
    // test is to `EXPLAIN` the statement and assert `food_search_vector_idx` appears. Do not add it: it
    // was written, measured, and REMOVED because it is not an invariant at test scale. Two findings, both
    // reproduced on Postgres 16:
    //
    //  1. Forcing the planner (`enable_seqscan = off`, with or without `enable_indexscan = off`) does not
    //     discriminate. `status = 'RESOLVED'` is always available via `food_status_idx`, so the OLD,
    //     BROKEN 2-character statement ALSO avoids a `Seq Scan` under forcing — a test asserting "no Seq
    //     Scan" passes for the defect it is meant to catch.
    //  2. The natural plan choice is cost-model noise below production scale: for the same statement and
    //     the same filler shape, 3,000 rows chose `food_search_vector_idx`, 6,000 / 12,000 / 25,000 chose
    //     `food_status_idx`, and 50,000 chose `food_search_vector_idx` again. Any threshold picked here
    //     would flake on a planner, statistics, or `random_page_cost` change.
    //
    // The behavioural guard above IS the regression guard: the sequential scan existed *because* of the
    // two `ILIKE '%q%'` branches, so `search('ic') === []` proves they no longer run at 1–2 characters.
    // The latency gate belongs where T-195 put it — the k6 `short` shape in `tests/load/search.load.js`
    // at 50,000 foods — and the measured before/after plans are recorded on T-198 in
    // `specs/003-usda-food-data/tasks.md`.
});
