/**
 * Integration tests for {@link FoodSearchDao} against a REAL Postgres — the one statement it routes to
 * (T-180), and the FR-010a minimum below which it routes to none (plan U37).
 *
 * Requirement → test mapping:
 * - FR-008  → local-store search returns canonical `id`s; ranked FTS (`ts_rank`) over name/description.
 * - FR-010  → results ranked by relevance (a closer lexical match ranks higher).
 * - FR-010a → a query below the three-character minimum returns nothing, and the fifteen genuine
 *             three-character foods are searched. Asserted against a real catalogue-shaped store here,
 *             because "returns nothing" is only meaningful when rows that WOULD have matched exist.
 * - FR-009  → search is local-only: the DAO has no source dependency and issues a single SQL read
 *             (structurally cannot call a source — there is no adapter/registry seam here).
 * - SC-007  → the `ILIKE '%q%'` / `name % q` branches cannot be index-served below 3 characters (the
 *             85–157ms sequential scan T-195 measured). They are now unreachable at that length because
 *             NO statement is. Deliberately NOT asserted on the query PLAN — see the long note at the
 *             foot of this file for the two measurements that ruled it out.
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

import { FoodSearchDao } from '../src/foods/dao/foodSearch.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** Insert a RESOLVED food (search only surfaces RESOLVED golden records). */
async function seedFood(
    pool: pg.Pool,
    input: { id: string; name: string; description?: string | null; userId?: string; visibility?: string },
): Promise<void> {
    await pool.query(
        `INSERT INTO food (id, name, normalized_name, description, status, user_id, visibility)
         VALUES ($1, $2, lower($2), $3, 'RESOLVED', $4, $5)`,
        [input.id, input.name, input.description ?? null, input.userId ?? null, input.visibility ?? 'public'],
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
        const hits = await dao.search('breast chicken', 'search-it-caller');

        expect(hits.map((hit) => hit.id)).toContain('f_chicken');
        expect(hits.map((hit) => hit.id)).not.toContain('f_beef');
    });

    it('ranks a closer match above a tangential one (relevance ordering, FR-010)', async () => {
        // Both match the FTS lexeme "chicken"; the exact short name is the more relevant hit and must
        // rank first, the long tangential name still appears below it (ranked, not filtered out).
        await seedFood(pool, { id: 'f_exact', name: 'Chicken, raw' });
        await seedFood(pool, { id: 'f_long', name: 'Barbecue marinated grilled boneless chicken thigh pieces' });

        const hits = await dao.search('chicken', 'search-it-caller');
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
        expect((await dao.search('soybeans', 'search-it-caller')).map((hit) => hit.id)).toContain('f_desc');
        // pg_trgm fuzzy fallback: a typo'd name still matches.
        expect((await dao.search('avacado', 'search-it-caller')).map((hit) => hit.id)).toContain('f_avocado');
    });

    it('returns canonical ids and an empty set on no match (never throws, never calls a source)', async () => {
        await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

        const hits = await dao.search('zzzznotathing', 'search-it-caller');
        expect(hits).toEqual([]);

        const kale = await dao.search('kale', 'search-it-caller');
        expect(kale.map((hit) => hit.id)).toEqual(['f_kale']);
        expect(kale[0]).toMatchObject({ id: 'f_kale', name: 'Kale, raw' });
        expect(typeof kale[0]!.score).toBe('number');
    });

    /**
     * The FR-010a minimum against a REAL store (plan U37).
     *
     * ⚠️ **REPLACES the T-198 `word-initial prefix path` suite, which is deleted with the strategy it
     * described.** That suite proved a 1–2 character query matched word-initially, ranked name-initial
     * hits first, survived English stopwords via the `simple` config, and did not raise
     * `syntax error in tsquery` on a metacharacter. None of those behaviours exists any more: FR-010a
     * removed the question rather than the latency, so there is nothing at that length to rank, to
     * configure, or to sanitise. Its ONE surviving obligation — that a short query cannot return an
     * arbitrary slice of the catalog — is asserted below, and asserted more strictly than before (it must
     * return NOTHING, where the prefix path returned a ranked page).
     *
     * ⛔ Every case seeds rows that the OLD behaviour DID return, so "returns nothing" cannot pass
     * vacuously on an empty table — which is the way this suite would rot into theatre.
     */
    describe('the FR-010a three-character minimum (plan U37)', () => {
        /** The catalogue shape the short-query cases are measured against. */
        async function seedShortQueryCatalog(): Promise<void> {
            await seedFood(pool, { id: 'f_cheddar', name: 'Cheddar cheese' });
            await seedFood(pool, { id: 'f_cottage', name: 'Large curd cottage cheese' });
            await seedFood(pool, { id: 'f_chicken', name: 'Chicken breast, raw' });
            await seedFood(pool, { id: 'f_beef', name: 'Beef, ground' });
            await seedFood(pool, { id: 'f_eggplant', name: 'Eggplant, raw' });
            await seedFood(pool, { id: 'f_large_egg', name: 'Large egg, whole, raw' });
        }

        it.each(['c', 'ch', 'e', 'eg', 'be', 'a'])(
            'returns NOTHING for the below-minimum query %j, against rows it used to match',
            async (query) => {
                await seedShortQueryCatalog();

                // Pre-U37 every one of these returned a ranked page (`ch` → Cheddar/Chicken, `eg` →
                // Eggplant/Large egg, `be` → Beef). On the real 8,094-row catalog one character matched
                // 51% of rows and two characters 23%, against a surface showing ten to twenty — so the
                // page was an arbitrary slice, and FR-010a rules that worse than nothing.
                await expect(dao.search(query, 'search-it-caller')).resolves.toEqual([]);
            },
        );

        it('returns nothing for a below-minimum query even when a row matches it EXACTLY', async () => {
            // The strongest form of the rule: not "we could not find a good match" but "we did not look".
            await seedFood(pool, { id: 'f_ox', name: 'Ox' });

            await expect(dao.search('Ox', 'search-it-caller')).resolves.toEqual([]);
        });

        it.each(['&', '|', '!', ':', '(', ')', "'", '<', '*', '&&', '::', '<>'])(
            'does not throw on the tsquery metacharacter query %j',
            async (query) => {
                await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

                // ⚠️ KEPT from the deleted suite, and it now proves something different. It used to prove
                // the character whitelist stripped these before `to_tsquery` could raise
                // `syntax error in tsquery` — a 500 on a keystroke. There is no whitelist and no
                // `to_tsquery`; these are simply below the minimum. The case stays because the failure it
                // guards (a 500 rather than a result) is the one that hurts, and it must keep holding
                // however the code arrives at it.
                await expect(dao.search(query, 'search-it-caller')).resolves.toEqual([]);
            },
        );

        it.each(['&&&', ':::', '<->', '2%!', 'a&b', "o'brien", '!!!', '(((', '|||'])(
            'does not throw on the ABOVE-minimum metacharacter query %j, which now reaches SQL',
            async (query) => {
                await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

                // ⛔ THIS is where the deleted whitelist's real coverage went. Below the minimum a
                // metacharacter never reaches Postgres at all, so those cases prove nothing about
                // sanitisation. These DO reach the statement, with the metacharacter bound as a value, and
                // they must not raise — `plainto_tsquery` sanitises, `name % $n` compares text, and the
                // `ILIKE` pattern is escaped where it is built.
                await expect(dao.search(query, 'search-it-caller')).resolves.toBeInstanceOf(Array);
            },
        );

        it.each([
            'egg',
            'ham',
            'rye',
            'cod',
            'soy',
            'oat',
            'fig',
            'yam',
            'nut',
            'tea',
            'pie',
            'elk',
            'gin',
            'rum',
            'poi',
        ])('still searches the genuine three-character food %j', async (food) => {
            // ⛔ THE REASON THE FLOOR IS THREE AND NOT FOUR. FR-010a enumerates fifteen real
            // three-character foods; a floor of four would pass every "short queries return nothing"
            // case above and silently break all fifteen. Seeded with a longer name so the hit is
            // earned by the search rather than by an exact-name coincidence.
            await seedFood(pool, { id: `f_${food}`, name: `${food}, raw` });
            await seedFood(pool, { id: 'f_kale', name: 'Kale, raw' });

            expect((await dao.search(food, 'search-it-caller')).map((hit) => hit.id)).toContain(`f_${food}`);
        });

        it('matches MID-word again at three characters, which is the 3+ behaviour unchanged', async () => {
            await seedFood(pool, { id: 'f_chicken', name: 'Chicken breast, raw' });
            await seedFood(pool, { id: 'f_desc', name: 'Edamame', description: 'Young soybeans in the pod' });

            // Only the `ILIKE '%hic%'` / trigram branch can match a mid-word 3-character needle, so this is
            // also the assertion that the minimum did not accidentally swallow the third character.
            expect((await dao.search('hic', 'search-it-caller')).map((hit) => hit.id)).toContain('f_chicken');
            // And the statement still searches the DESCRIPTION.
            expect((await dao.search('soybeans', 'search-it-caller')).map((hit) => hit.id)).toContain('f_desc');
        });

        it('surfaces ONLY RESOLVED rows — an in-flight or terminal food is not a search result', async () => {
            await seedFood(pool, { id: 'f_resolved', name: 'Cheddar cheese' });

            // A non-RESOLVED row can carry a provisional name (`normalized_name` is required, and the
            // add-by-name path writes one on creation), so `name IS NOT NULL` does NOT exclude it. Only the
            // status filter does — and a PENDING/UNRESOLVED/NOT_FOUND row is a request in flight, not a
            // golden record anyone may be shown (FR-008). `seedFood` writes RESOLVED, so these go direct.
            for (const status of ['PENDING', 'UNRESOLVED', 'NOT_FOUND', 'FAILED']) {
                await pool.query(
                    `INSERT INTO food (id, name, normalized_name, status)
                     VALUES ($1, $2, lower($2), $3)`,
                    [`f_${status.toLowerCase()}`, `Cheddar ${status}`, status],
                );
            }

            expect((await dao.search('ched', 'search-it-caller')).map((hit) => hit.id)).toEqual(['f_resolved']);
        });

        it('caps the result set at the FR-010 limit', async () => {
            // 25 > the 20-row default, so an unbounded statement shows up here as 25.
            for (let index = 0; index < 25; index += 1) {
                await seedFood(pool, { id: `f_c_${index}`, name: `Cheese variety ${index}` });
            }

            expect(await dao.search('cheese', 'search-it-caller')).toHaveLength(20);
            expect(await dao.search('cheese', 'search-it-caller', 5)).toHaveLength(5);
        });
    });

    // ── Why there is NO query-PLAN assertion here ────────────────────────────────────────────────────
    //
    // SC-007's claim is that search is index-served rather than scanned, and the obvious test is to
    // `EXPLAIN` the statement and assert `food_search_vector_idx` appears. Do not add it: it was written,
    // measured, and REMOVED because it is not an invariant at test scale. Two findings, both reproduced on
    // Postgres 16:
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
    // What guards this instead, and where (all three run on EVERY pull request except the last):
    //
    //  - BEHAVIOUR (here, the `integration-food` job): the sequential scan existed *because* of the
    //    `ILIKE '%q%'` / `name % q` branches, and below the minimum no statement runs at all, so
    //    `search('ch') === []` against rows that used to match proves they cannot be running. This tier
    //    also owns everything only real Postgres can answer — that a metacharacter which now REACHES the
    //    statement does not raise, and that each of the fifteen three-character foods is genuinely found.
    //  - STATEMENT SHAPE (`src/foods/dao/__tests__/foodSearch.dao.test.ts`, the `unit` job): the executed
    //    SQL is rendered through `PgDialect`; below the minimum there is no statement, and above it the
    //    statement is asserted to call no bare `to_tsquery`. A revert fails there with no dependence on
    //    the planner, on row count, or on timing.
    //  - LATENCY (the k6 shapes in `tests/load/search.load.js` at 50,000 foods): the only tier that can
    //    catch a regression whose symptom is time rather than shape — a dropped index, or population
    //    growth. It is HEAVY-TIER (`heavy-e2e` label, nightly schedule, or manual dispatch), so it is a
    //    backstop and not the primary guard. ⚠️ Its `short` (two-character) shape is DELETED with plan
    //    U37: a shape that is answered without touching the database measures nothing, and leaving it in
    //    would have reported a green 0ms p95 as evidence that search is fast.
    //
    // The measured before/after plans are recorded on T-198 in `specs/003-usda-food-data/tasks.md`.
});

/**
 * Retrieval, not ranking — the half U6 fixed on the wrong table.
 *
 * ⛔ Measured 2026-08-22 against 8,094 real USDA foods: every one of these queries returned ZERO rows, so
 * U5's tier ladder was never consulted for any of them. `rankingTiers.integration.test.ts` already proves
 * the ladder bridges `jalapeño` → `jalapeno` at the `exact` rung, and that test is CORRECT and was passing
 * the whole time — a green test over behaviour the product could not reach, because the retrieval predicate
 * never returned the row for the ladder to rank.
 *
 * U6's plan entry names two files, both in recipe-service, and its head-term branch went onto
 * `IngredientsDal.search` — the recipe-LOCAL table. The catalog kept
 * `plainto_tsquery OR aliases_tsquery OR name % OR name ILIKE OR description ILIKE`, and that set has two
 * holes these cases pin:
 *
 *  - **the tsquery is a CONJUNCTION.** `Fresh oregano` becomes `fresh & oregano`; the catalog's only oregano
 *    row is `Spices, oregano, dried`, which has no `fresh`, so it matched nothing and the query came back
 *    with `Basil, fresh` and `Thyme, fresh` — hits earned on the modifier the cook did not care about.
 *  - **trigram is measured on the WHOLE name.** `similarity('Peppers, jalapeno, raw', 'jalapeño') = 0.250`
 *    against the 0.3 threshold — and 0.429 once the diacritic is folded. `Kerrygold butter` against
 *    `Butter, salted` is 0.292, short by 0.008.
 *
 * The fix reuses what U5 already stores: `rank_tokens` is the name's folded, singularized token array, so
 * `rank_tokens @> ARRAY[head]` is head-term retrieval and diacritic folding in one predicate. ⛔ It is NOT
 * the `unaccent` extension: migration 0008 explicitly rejected that because its rules file is not NFD and
 * could not be mirrored in TypeScript, and the two engines must agree.
 */
describe.skipIf(!DATABASE_URL)('FoodSearchDao head-term retrieval (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: FoodSearchDao;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        await resetSchema(pool);
        dao = new FoodSearchDao(db);
    });

    afterAll(async () => {
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food CASCADE');
    });

    it('⛔ retrieves across a DIACRITIC the catalog does not carry', async () => {
        await seedFood(pool, { id: 'f-jal', name: 'Peppers, jalapeno, raw' });

        expect((await dao.search('jalapeño', 'search-it-caller', 20)).map((row) => row.name)).toContain(
            'Peppers, jalapeno, raw',
        );
    });

    it('⛔ retrieves the head noun when the cook supplied a modifier the row does not have', async () => {
        // The conjunction case. `Basil, fresh` is seeded precisely because it is what the query used to
        // return INSTEAD — so this fails if the head-term branch is removed AND if it ever ranks below it.
        await seedFood(pool, { id: 'f-ore', name: 'Spices, oregano, dried' });
        await seedFood(pool, { id: 'f-bas', name: 'Basil, fresh' });

        const names = (await dao.search('Fresh oregano', 'search-it-caller', 20)).map((row) => row.name);

        expect(names).toContain('Spices, oregano, dried');

        // ⚠️ RETRIEVED, and still ranked BELOW `Basil, fresh` — asserted so the residual is pinned rather
        // than discovered again later. Both rows land on the `base` rung: `covered` needs EVERY query token
        // (neither row has both `fresh` and `oregano`), and `head` compares the NAME's head to the query's,
        // which for `Spices, oregano, dried` is `spice` because USDA inverts its names. So the base metric
        // decides and the shorter name wins on trigram length penalty.
        //
        // ⛔ This is a RANKING gap, not a retrieval one, and closing it means a new rung — "the query's head
        // appears as a token in the name", which is stronger evidence than sharing an adjective. That is a
        // change to U5's ladder shape, felt on BOTH surfaces, and it needs its own before/after measurement.
        // Recorded in `docs/reports/2026-08-22-001-ingredient-resolution-measurement.md` rather than smuggled
        // in behind a retrieval fix.
        expect(names.indexOf('Basil, fresh')).toBeLessThan(names.indexOf('Spices, oregano, dried'));
    });

    it('retrieves the generic food behind a brand the catalog has never heard of', async () => {
        await seedFood(pool, { id: 'f-but', name: 'Butter, salted' });

        expect((await dao.search('Kerrygold butter', 'search-it-caller', 20)).map((row) => row.name)).toContain(
            'Butter, salted',
        );
    });

    it('⛔ does NOT retrieve on a typo — widening retrieval must not become matching anything', async () => {
        // `chikcen` is a transposition; trigram similarity to the chicken rows measured 0.067–0.075. If this
        // starts returning rows, the predicate has stopped discriminating rather than started bridging.
        await seedFood(pool, { id: 'f-chk', name: 'Chicken, broilers or fryers, breast' });

        expect(await dao.search('chikcen', 'search-it-caller', 20)).toHaveLength(0);
    });

    it('leaves a single-token query that already worked exactly as it was', async () => {
        await seedFood(pool, { id: 'f-flr', name: 'Flour, wheat, all-purpose' });

        expect((await dao.search('flour', 'search-it-caller', 20)).map((row) => row.name)).toContain(
            'Flour, wheat, all-purpose',
        );
    });
});

describe.skipIf(!DATABASE_URL)('U11/R20 — a private authored food is retrievable ONLY by its author', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: FoodSearchDao;

    const AUTHOR = '01JU11AUTHOR00000000000AAA';
    const STRANGER = '01JU11STRANGER000000000BBB';

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
        await seedFood(pool, { id: 'f_catalog', name: 'Quinoa, uncooked' });
        await seedFood(pool, {
            id: 'f_private',
            name: 'Quinoa, grandma blend',
            userId: AUTHOR,
            visibility: 'private',
        });
        await seedFood(pool, {
            id: 'f_promoted',
            name: 'Quinoa, promoted blend',
            userId: AUTHOR,
            visibility: 'promoted',
        });
    });

    it("a stranger's search sees the catalog and PROMOTED rows, never the private one", async () => {
        const ids = (await dao.search('quinoa', STRANGER)).map((hit) => hit.id);

        expect(ids).toContain('f_catalog');
        expect(ids).toContain('f_promoted');
        expect(ids).not.toContain('f_private');
    });

    it("the author's own search includes their private food, with the raw ownership columns", async () => {
        const hits = await dao.search('quinoa', AUTHOR);

        const privateHit = hits.find((hit) => hit.id === 'f_private');
        expect(privateHit).toBeDefined();
        expect(privateHit?.visibility).toBe('private');
        expect(privateHit?.userId).toBe(AUTHOR);
    });

    it("a promoted authored food is flagged 'promoted' for EVERYONE — strangers included", async () => {
        const hits = await dao.search('quinoa', STRANGER);

        expect(hits.find((hit) => hit.id === 'f_promoted')?.visibility).toBe('promoted');
        // The DAO carries the RAW column; the service maps 'public' to "no flag on the wire"
        // (foods.service.test.ts pins that projection), so the raw value is what is asserted here.
        expect(hits.find((hit) => hit.id === 'f_catalog')?.visibility).toBe('public');
    });
});
