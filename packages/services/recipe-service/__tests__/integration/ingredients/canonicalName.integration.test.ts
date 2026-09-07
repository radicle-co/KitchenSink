/**
 * U3 — THE CATALOG STOPS MINTING CALLER PROSE AS ITS DISPLAY NAME (integration, real Docker Postgres).
 *
 * The `ingredients` table is a shared, OWNERLESS catalog that every user's typeahead searches. Before this
 * unit, `addByName` wrote the caller's own string as that shared row's permanent label — from the picker that
 * is the user's search term ("butter"), but from the cookbook importer it is a fragment of recipe prose
 * ("1 cup of sifted pastry flour, well packed"). 92.8% of the 448-recipe import's lines were decided against
 * this local table, so the table was polluting the ranker that reads it.
 *
 * ⛔ WHY THIS TIER, AND NOT A MOCKED DAL TEST. Two of the three failure modes are invisible to a mock:
 *
 *  1. `ingredients` has **no `search_vector` trigger** — `0001_initial.sql` creates exactly one and it is on
 *     `recipes`. The DAL owns the vector. So a rename that does not recompute `to_tsvector('english', name)`
 *     in the SAME statement leaves the ranker matching the ORIGINAL prose forever, which is the precise defect
 *     this unit exists to close. Only a real Postgres can be asked whether the vector moved with the name.
 *  2. The convergence property — two users typing different prose for one food ending on ONE row with ONE
 *     name — is a property of the `food_id` unique index plus the rename, not of any single call.
 *
 * The food service (003) is stubbed at the `FoodServiceClient` boundary — the one dependency 001 does not own
 * — so the assertions are about what recipe-service PERSISTS given a status response, not about food's
 * behaviour. Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness simply skips.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import type { CanonicalIngredientName } from '../../../src/ingredients/domain/ingredientName.js';
import type { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeAddResult,
    makeCanonicalName,
    makeFoodView,
    makeStatusResult,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Food ids unique to this suite so its rows never collide with another integration spec's. */
const FLOUR_FOOD_ID = '01JU3CANON000000000000FLOUR';
const BUTTER_FOOD_ID = '01JU3CANON00000000000BUTTER';
const NAMELESS_FOOD_ID = '01JU3CANON0000000000NAMELESS';
const ABSENT_FOOD_ID = '01JU3CANON00000000000ABSENT';
const INVISIBLE_FOOD_ID = '01JU3CANON000000000INVISIBLE';
const PICKED_FOOD_ID = '01JU3CANON00000000000PICKED';

/** Every food id this suite writes — the cleanup set. */
const SUITE_FOOD_IDS = [
    FLOUR_FOOD_ID,
    BUTTER_FOOD_ID,
    NAMELESS_FOOD_ID,
    ABSENT_FOOD_ID,
    INVISIBLE_FOOD_ID,
    PICKED_FOOD_ID,
];

/** A seeded recipe (`tests/globalSetup.ts`) to hang a `recipe_ingredients` line off. */
const SEEDED_RECIPE_ID = '11111111-1111-4111-8111-111111111101';

/**
 * U+200B ZERO WIDTH SPACE, U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM) and U+00A0 NO-BREAK SPACE — written as
 * escapes rather than pasted, because a reviewer cannot check a case they cannot see.
 */
const ZWSP = '\u200B';
const BOM = '\uFEFF';
const NBSP = '\u00A0';

/**
 * The importer's prose — a real shape from the 448-recipe corpus, not a tidy search term.
 *
 * ⚠️ It is a perfectly VALID `CanonicalIngredientName`: canonicalization is Unicode hygiene, not de-prosing.
 * That is exactly why this unit exists — nothing at the boundary can tell recipe prose from a food's name, so
 * only food-service's own answer can settle the label.
 */
const FLOUR_PROSE = makeCanonicalName('1 cup of sifted pastry flour, well packed');

/** What food-service publishes for the same thing: the golden record's canonical name. */
const FLOUR_CANONICAL = 'Flour, wheat, all-purpose, enriched, bleached';

/** A minimally-stubbed food client: only the two calls this vertical makes. */
function makeFoodClientStub(): FoodServiceClient {
    return { addByName: vi.fn(), getStatus: vi.fn() } as unknown as FoodServiceClient;
}

/** A no-op catalog gateway — none of these paths blend (see `blendedSuggest.integration.test.ts`). */
function makeCatalogStub(): FoodCatalogGateway {
    return { search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }) } as unknown as FoodCatalogGateway;
}

describe.skipIf(!hasDatabaseUrl)('ingredient canonical naming (integration: service + real DAL + real SQL)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;
    let food: FoodServiceClient;
    let service: IngredientsService;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1)', [SUITE_FOOD_IDS]);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1)', [SUITE_FOOD_IDS]);
        food = makeFoodClientStub();
        service = new IngredientsService(dal, foodClientsOf(food), makeCatalogStub());
    });

    /** The persisted row, read straight from the database rather than from a service return value. */
    async function readRow(foodId: string): Promise<{ id: string; name: string; status: string | null } | undefined> {
        const { rows } = await pool.query<{ id: string; name: string; food_resolution_status: string | null }>(
            'SELECT id, name, food_resolution_status FROM ingredients WHERE food_id = $1',
            [foodId],
        );
        const row = rows[0];

        return row === undefined ? undefined : { id: row.id, name: row.name, status: row.food_resolution_status };
    }

    /**
     * Does the row's STORED `search_vector` equal the vector its CURRENT name would produce?
     *
     * This is the whole point of the tier. `false` means the name and the index disagree — the row renders as
     * one thing and is found as another — which is exactly what a `SET name` that forgets the vector leaves
     * behind, and what no mocked `db.execute` can observe.
     */
    async function searchVectorMatchesName(foodId: string): Promise<boolean> {
        const { rows } = await pool.query<{ agrees: boolean }>(
            `SELECT search_vector = to_tsvector('english', name) AS agrees
             FROM ingredients WHERE food_id = $1`,
            [foodId],
        );

        return rows[0]?.agrees ?? false;
    }

    /** Does the row's stored `search_vector` still answer to this full-text query? */
    async function ftsMatches(foodId: string, query: string): Promise<boolean> {
        const { rows } = await pool.query<{ hit: boolean }>(
            `SELECT search_vector @@ plainto_tsquery('english', $2) AS hit
             FROM ingredients WHERE food_id = $1`,
            [foodId, query],
        );

        return rows[0]?.hit ?? false;
    }

    /** Drive a food from its by-name add to whatever status the stub then reports. */
    async function addThenPoll(
        name: CanonicalIngredientName,
        foodId: string,
        status: ReturnType<typeof makeStatusResult>,
    ) {
        vi.mocked(food.addByName).mockResolvedValue(
            makeAddResult({ id: foodId, status: FoodResolutionStatus.PENDING }),
        );
        const added = await service.addByName(CALLER, name);

        vi.mocked(food.getStatus).mockResolvedValue(status);

        return service.refreshStatus(CALLER, added.id);
    }

    describe('the RESOLVED transition renames the row to food-service`s canonical name', () => {
        it('replaces the caller`s prose with the golden name AND recomputes search_vector in step', async () => {
            vi.mocked(food.addByName).mockResolvedValue(
                makeAddResult({ id: FLOUR_FOOD_ID, status: FoodResolutionStatus.PENDING }),
            );
            const added = await service.addByName(CALLER, FLOUR_PROSE);

            // Precondition — the prose IS what the shared table currently holds and indexes. Without this the
            // assertions below could pass against a row that never carried the defect.
            expect((await readRow(FLOUR_FOOD_ID))?.name).toBe(FLOUR_PROSE);
            expect(await ftsMatches(FLOUR_FOOD_ID, 'pastry')).toBe(true);

            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: FLOUR_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: FLOUR_FOOD_ID, name: FLOUR_CANONICAL }),
                }),
            );

            const refreshed = await service.refreshStatus(CALLER, added.id);

            expect(refreshed.name).toBe(FLOUR_CANONICAL);
            expect(await readRow(FLOUR_FOOD_ID)).toEqual({
                id: added.id,
                name: FLOUR_CANONICAL,
                status: 'RESOLVED',
            });

            // ⛔ THE MUTATION-DETECTING ASSERTION. A plain `UPDATE … SET name` passes every line above and
            // fails here: the stored vector still spells the prose, so the ranker keeps matching text no user
            // ever typed and no row displays.
            expect(await searchVectorMatchesName(FLOUR_FOOD_ID)).toBe(true);
            expect(await ftsMatches(FLOUR_FOOD_ID, 'pastry')).toBe(false);
            expect(await ftsMatches(FLOUR_FOOD_ID, 'wheat')).toBe(true);
        });

        it('makes the row findable by its canonical name and NOT by the prose, through the real search', async () => {
            await addThenPoll(
                FLOUR_PROSE,
                FLOUR_FOOD_ID,
                makeStatusResult({
                    id: FLOUR_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: FLOUR_FOOD_ID, name: FLOUR_CANONICAL }),
                }),
            );
            const row = await readRow(FLOUR_FOOD_ID);

            // The user-visible consequence, proven through `IngredientsDal.search` itself rather than by
            // re-deriving its SQL here.
            const byCanonical = await dal.search('all-purpose flour', undefined, 50);
            const byProse = await dal.search('sifted pastry', undefined, 50);

            expect(byCanonical.map((hit) => hit.id)).toContain(row?.id);
            expect(byProse.map((hit) => hit.id)).not.toContain(row?.id);
        });

        it('names a row the CATALOG already held from food, never from the caller`s prose', async () => {
            // `addByName` answers `RESOLVED` for a food food-service already holds — the dominant branch once
            // the catalog is warm, and the one that made caller prose PERMANENT, because nothing downstream
            // ever re-reads a terminal row. Proven here against the real table rather than a mocked DAL,
            // because what matters is the row that is actually WRITTEN, index and all.
            vi.mocked(food.addByName).mockResolvedValue(
                makeAddResult({ id: BUTTER_FOOD_ID, status: FoodResolutionStatus.RESOLVED }),
            );
            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: BUTTER_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: BUTTER_FOOD_ID, name: 'Butter, salted' }),
                }),
            );

            const added = await service.addByName(
                CALLER,
                makeCanonicalName('a good lump of the best butter, size of an egg'),
            );

            expect(added.name).toBe('Butter, salted');
            expect(await readRow(BUTTER_FOOD_ID)).toEqual({
                id: added.id,
                name: 'Butter, salted',
                status: 'RESOLVED',
            });
            expect(await searchVectorMatchesName(BUTTER_FOOD_ID)).toBe(true);
            expect(await ftsMatches(BUTTER_FOOD_ID, 'lump')).toBe(false);
        });

        it('renames an EXISTING prose-named row when the food is admitted through the pick path', async () => {
            // The picker's `by-food` admission finds a row the importer already minted under prose. Scoping
            // the rename to `refreshStatus` alone would leave that row serving prose to every other user.
            await dal.createFoodBacked({
                name: makeCanonicalName('a good lump of the best butter, size of an egg'),
                foodId: PICKED_FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: PICKED_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: PICKED_FOOD_ID, name: 'Butter, salted' }),
                }),
            );

            const admitted = await service.addByFoodId(CALLER, PICKED_FOOD_ID);

            expect(admitted.name).toBe('Butter, salted');
            expect((await readRow(PICKED_FOOD_ID))?.name).toBe('Butter, salted');
            expect(await searchVectorMatchesName(PICKED_FOOD_ID)).toBe(true);
        });
    });

    describe('a RESOLVED status that carries no usable name leaves the row alone', () => {
        it('keeps the caller`s text when `food` is absent from the status envelope', async () => {
            // `statusResponseSchema.food` is OPTIONAL while `ingredients.name` is NOT NULL: writing through
            // here would be writing `null` into a non-nullable column.
            const refreshed = await addThenPoll(
                makeCanonicalName('butter the size of a walnut'),
                ABSENT_FOOD_ID,
                makeStatusResult({ id: ABSENT_FOOD_ID, status: FoodResolutionStatus.RESOLVED }),
            );

            expect(refreshed.name).toBe('butter the size of a walnut');
            expect(await readRow(ABSENT_FOOD_ID)).toMatchObject({
                name: 'butter the size of a walnut',
                status: 'RESOLVED',
            });
            expect(await searchVectorMatchesName(ABSENT_FOOD_ID)).toBe(true);
        });

        it('keeps the caller`s text when the golden record`s name is null', async () => {
            // `foodResponseSchema.name` is `z.string().nullable()` — a RESOLVED food may still be nameless.
            const refreshed = await addThenPoll(
                makeCanonicalName('a nameless thing'),
                NAMELESS_FOOD_ID,
                makeStatusResult({
                    id: NAMELESS_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: NAMELESS_FOOD_ID, name: null }),
                }),
            );

            expect(refreshed.name).toBe('a nameless thing');
            expect(await readRow(NAMELESS_FOOD_ID)).toMatchObject({ name: 'a nameless thing', status: 'RESOLVED' });
        });

        it('keeps the caller`s text when the golden name is only invisible characters', async () => {
            // A name of zero-width characters sanitizes to `''`, which would blank a NOT NULL column and make
            // the row unfindable by any query. Record the status, keep the name.
            const refreshed = await addThenPoll(
                makeCanonicalName('suet, chopped fine'),
                INVISIBLE_FOOD_ID,
                makeStatusResult({
                    id: INVISIBLE_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: INVISIBLE_FOOD_ID, name: `${ZWSP}${ZWSP}${BOM}` }),
                }),
            );

            expect(refreshed.name).toBe('suet, chopped fine');
            expect(await readRow(INVISIBLE_FOOD_ID)).toMatchObject({ name: 'suet, chopped fine', status: 'RESOLVED' });
        });
    });

    describe('a non-terminal row keeps the caller`s SANITIZED text and stays visible', () => {
        it('leaves a still-PENDING row`s name untouched, and search still returns it (owner ruling)', async () => {
            const refreshed = await addThenPoll(
                makeCanonicalName('brown sugar'),
                BUTTER_FOOD_ID,
                makeStatusResult({ id: BUTTER_FOOD_ID, status: FoodResolutionStatus.PENDING }),
            );
            const row = await readRow(BUTTER_FOOD_ID);

            expect(refreshed.name).toBe('brown sugar');
            expect(row?.status).toBe('PENDING');

            // ⛔ A food being acquired is something a searcher WANTS to see, and the demand signal is useful.
            // The fix for prose is the WRITE path — never a status filter on the read.
            const hits = await dal.search('brown sugar', undefined, 50);
            expect(hits.map((hit) => hit.id)).toContain(row?.id);
        });

        it('collapses two invisible-character spellings of one name onto ONE shared row', async () => {
            // The parse itself lives at the controller (`visibleName`) and is covered there and in the e2e
            // tier; what only a REAL database can show is the consequence — that two spellings a reader
            // cannot tell apart end as ONE row rather than two, because `idx_ingredients_freeform_name` is
            // unique on `lower(name)` and both spellings now reduce to the same key.
            const plain = await service.createFreeform(makeCanonicalName('Brown sugar'));
            const invisible = await service.createFreeform(makeCanonicalName(`  Bro${ZWSP}wn${NBSP} sugar${BOM} `));

            expect(invisible.id).toBe(plain.id);
            expect(invisible.name).toBe('Brown sugar');

            const { rows } = await pool.query<{ n: string }>(
                `SELECT count(*)::int AS n FROM ingredients WHERE is_user_entered = true AND name = 'Brown sugar'`,
            );
            expect(Number(rows[0]!.n)).toBe(1);
        });
    });

    describe('the shared catalog converges', () => {
        it('two callers submitting different prose for one food end on ONE row with ONE canonical name', async () => {
            vi.mocked(food.addByName).mockResolvedValue(
                makeAddResult({ id: FLOUR_FOOD_ID, status: FoodResolutionStatus.PENDING }),
            );

            const first = await service.addByName(CALLER, FLOUR_PROSE);
            const second = await service.addByName(
                CALLER,
                makeCanonicalName('flour, 2 heaping tablespoonfuls, sifted twice'),
            );

            expect(second.id).toBe(first.id);

            vi.mocked(food.getStatus).mockResolvedValue(
                makeStatusResult({
                    id: FLOUR_FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: FLOUR_FOOD_ID, name: FLOUR_CANONICAL }),
                }),
            );
            await service.refreshStatus(CALLER, first.id);

            const { rows } = await pool.query<{ n: string }>(
                'SELECT count(*)::int AS n FROM ingredients WHERE food_id = $1',
                [FLOUR_FOOD_ID],
            );
            expect(Number(rows[0]!.n)).toBe(1);
            expect((await readRow(FLOUR_FOOD_ID))?.name).toBe(FLOUR_CANONICAL);
        });
    });

    describe('U3 verification — a resolved row carries food`s name, never the caller`s prose', () => {
        /**
         * The unit's verification, made executable — and stated as the invariant this unit can actually
         * GUARANTEE, which is narrower than the plan's wording.
         *
         * ⚠️ The plan says "after a re-import, **no row** in `ingredients` — at any `food_resolution_status` —
         * has a name that is a prose fragment". That cannot hold, and pretending otherwise would hide the gap
         * rather than close it: the rename's only trigger is a transition to `RESOLVED`, a food that never
         * resolves legitimately keeps the caller's text (the same paragraph of the plan mandates exactly that,
         * and the owner ruled such rows stay visible in search), and canonicalization is Unicode hygiene — it
         * does not and cannot recognise prose. Removing prose from the INPUT is U7's parser.
         *
         * So what is asserted here is the guarantee: every row that reached `RESOLVED` carries food-service's
         * canonical name for its `food_id`, its `search_vector` agrees with that name, and none of the caller
         * prose that created those rows survives anywhere in the table. The residual — non-terminal rows still
         * holding caller text — is real, bounded by the poll, and is what U15 should COUNT rather than assert
         * to be zero.
         */
        const CORPUS: readonly {
            readonly prose: CanonicalIngredientName;
            readonly foodId: string;
            readonly canonical: string;
        }[] = [
            { prose: FLOUR_PROSE, foodId: FLOUR_FOOD_ID, canonical: FLOUR_CANONICAL },
            {
                prose: makeCanonicalName('a good lump of the best butter, size of an egg'),
                foodId: BUTTER_FOOD_ID,
                canonical: 'Butter, salted',
            },
            {
                prose: makeCanonicalName('two heaping teaspoonfuls of powdered white sugar'),
                foodId: PICKED_FOOD_ID,
                canonical: 'Sugars, granulated',
            },
        ];

        it('every food-backed row this run produced carries its food`s canonical name, and nothing else', async () => {
            for (const line of CORPUS) {
                vi.mocked(food.addByName).mockResolvedValue(
                    makeAddResult({ id: line.foodId, status: FoodResolutionStatus.PENDING }),
                );
                const added = await service.addByName(CALLER, line.prose);

                vi.mocked(food.getStatus).mockResolvedValue(
                    makeStatusResult({
                        id: line.foodId,
                        status: FoodResolutionStatus.RESOLVED,
                        food: makeFoodView({ id: line.foodId, name: line.canonical }),
                    }),
                );
                await service.refreshStatus(CALLER, added.id);
            }

            const { rows } = await pool.query<{ name: string; agrees: boolean }>(
                `SELECT name, search_vector = to_tsvector('english', name) AS agrees
                 FROM ingredients WHERE food_id = ANY($1) ORDER BY name`,
                [CORPUS.map((line) => line.foodId)],
            );

            expect(rows.map((row) => row.name).sort()).toEqual(CORPUS.map((line) => line.canonical).sort());
            expect(rows.every((row) => row.agrees)).toBe(true);
            // Nothing named by the corpus's prose survives anywhere in the table.
            const { rows: leftovers } = await pool.query<{ n: string }>(
                `SELECT count(*)::int AS n FROM ingredients WHERE name = ANY($1)`,
                [CORPUS.map((line) => line.prose)],
            );
            expect(Number(leftovers[0]!.n)).toBe(0);
        });
    });

    describe('an unresolved line still persists', () => {
        afterEach(async () => {
            await pool.query(`DELETE FROM recipe_ingredients WHERE ingredient_name = 'U3 unresolved line'`);
        });

        it('a recipe line referencing a still-PENDING ingredient satisfies the NOT NULL foreign key', async () => {
            // `recipe_ingredients.ingredient_id` is `NOT NULL REFERENCES ingredients(id)`, so a line that never
            // resolved must still have a row to point at. It does: the by-name add persists the food-backed row
            // BEFORE resolution, and the row simply stays non-terminal.
            vi.mocked(food.addByName).mockResolvedValue(
                makeAddResult({ id: ABSENT_FOOD_ID, status: FoodResolutionStatus.PENDING }),
            );
            const pending = await service.addByName(CALLER, makeCanonicalName('sweet herbs, a small bunch'));

            await expect(
                pool.query(
                    `INSERT INTO recipe_ingredients
                        (recipe_id, ingredient_id, quantity, unit, sort_order, ingredient_name, is_user_entered)
                     VALUES ($1, $2, 1, '', 99, 'U3 unresolved line', false)`,
                    [SEEDED_RECIPE_ID, pending.id],
                ),
            ).resolves.toBeDefined();
        });
    });
});
