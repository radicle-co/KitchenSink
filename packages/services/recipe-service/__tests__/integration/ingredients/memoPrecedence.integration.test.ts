/**
 * THE CASCADE'S PRECEDENCE, PROVED AGAINST A REAL DATABASE — a gate-agreed memo is not overruled by a
 * catalog guess (plan U10 / R11, R12, R14, AE8; the defect KTD-A opened).
 *
 * ## Why this tier and not the mocked guard beside it
 *
 * `src/ingredients/resolution/__tests__/resolutionRegistry.test.ts` proves the ORDER: it drives the real
 * registry with doubles and asserts the stronger authority answers. What a double cannot prove is that the
 * memo tier answers at all against a real `ingredient_resolution_memos` — R14 forbids equality-only matching,
 * so the tier's read is an indexed k-NN scan over a GiST trigram index with a `MEMO_SIMILARITY_FLOOR`, and a
 * stubbed `findMemo` returning a hit demonstrates none of that. AE8 is specifically about the NEAR-TWIN
 * path ("a phrase not present verbatim … resolves from the knowledge base without an LLM call"), which only
 * exists inside Postgres.
 *
 * ## What each spec would have caught
 *
 *  - **The exact-key case** is the shipped bug at its plainest: a memo and a catalog hit for the same phrase.
 *    Before the reordering this resolved to the CATALOG's food and enqueued a verification for an identity
 *    the gate had already agreed — a user's settled answer silently replaced by a machine guess.
 *  - **The near-twin case** is AE8, and it is the one that stayed broken longest: a near-twin's catalog
 *    search almost always returns SOMETHING, so under the old order tier 3's whole reason for existing —
 *    matching what is not present verbatim — was unreachable in production.
 *  - **The no-memo case** pins that this is a precedence fix and not a disabling of tier 2: with nothing
 *    remembered, the lexical tier still answers from the catalog exactly as it did.
 *  - **The curated case** pins that nothing displaced R19's top of the ladder.
 *
 * The food service is stubbed at its client boundary — the one dependency 001 does not own — and the
 * assertion that it was NEVER called is the requirement, not a detail: it is the whole of AE8's "without an
 * LLM call", since a resolution that reaches food-service is the resolution that gets verified.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import type { CatalogHit } from '../../../src/ingredients/ingredientSuggestion.js';
import type { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { createResolutionRegistry } from '../../../src/ingredients/resolution/resolutionRegistry.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeCanonicalName,
    makeFoodView,
    makeStatusResult,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** The food the GATE agreed with — what a memo remembers. */
const MEMO_FOOD = '01JU10PREC00000000000MEMOFD';
/** The food the CATALOG ranks first — a guess with no authority behind it (KTD-A). */
const CATALOG_FOOD = '01JU10PREC0000000CATALOGFD';
/** The food a human CURATOR bound the phrase to (R19). */
const CURATED_FOOD = '01JU10PREC0000000CURATEDFD';

const AUTHOR = '01JU10PREC0000000000AUTHOR';
const VERIFIER = 'test-model-v1';

/** Every phrase this suite writes shares this prefix, so cleanup is exact. */
const PREFIX = 'u10 precedence';

describe.skipIf(!hasDatabaseUrl)('cascade precedence against a real knowledge base', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let mappings: ResolutionMappingsDal;
    let foodClient: { addByName: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> };
    let catalogSearch: ReturnType<typeof vi.fn>;
    let ingredients: IngredientsService;

    /** What the stubbed catalog offers. Reset per case; `undefined` means the catalog found nothing. */
    let catalogHit: CatalogHit | undefined;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        mappings = new ResolutionMappingsDal(db);

        foodClient = {
            addByName: vi.fn(),
            getStatus: vi.fn(),
        };
        catalogSearch = vi.fn(async () => ({
            availability: 'ok' as const,
            hits: catalogHit === undefined ? [] : [catalogHit],
        }));

        ingredients = new IngredientsService(
            new IngredientsDal(db),
            foodClientsOf(foodClient as unknown as FoodServiceClient),
            { search: catalogSearch } as unknown as FoodCatalogGateway,
            // ⛔ THE REAL REGISTRY, not a hand-listed pair. A suite that re-lists the tiers proves its own
            // list, not production's — the drift `natEgressConsumers.test.ts` exists to stop.
            createResolutionRegistry(mappings, { search: catalogSearch } as unknown as FoodCatalogGateway),
        );
    });

    afterEach(async () => {
        // `mockReset`, not `clearAllMocks` alone: one spec installs a per-id `mockImplementation`, and a
        // cleared-but-not-reset mock would carry that implementation into the next spec's expectations.
        foodClient.getStatus.mockReset();
        foodClient.addByName.mockReset();
        catalogSearch.mockClear();
        catalogHit = undefined;
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1::text[])', [
            [MEMO_FOOD, CATALOG_FOOD, CURATED_FOOD],
        ]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Remember a gate-agreed resolution for `phrase`, through the real DAL. */
    async function remember(phrase: string, foodId: string): Promise<void> {
        await mappings.recordMemo({
            normalizedKey: normalizedIngredientKey(`${PREFIX} ${phrase}`)!,
            foodId,
            sourcePhrase: `${PREFIX} ${phrase}`,
            verifiedBy: VERIFIER,
        });
    }

    /** Make food-service answer for whichever food the cascade admits. */
    function foodServiceResolves(foodId: string, name: string): void {
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({ id: foodId, status: 'RESOLVED', food: makeFoodView({ id: foodId, name }) }),
        );
    }

    /** Add the phrase by name, as {@link AUTHOR}. */
    async function addByName(phrase: string) {
        return ingredients.addByName(CALLER, makeCanonicalName(`${PREFIX} ${phrase}`), AUTHOR);
    }

    it('a gate-agreed MEMO outranks a catalog hit for the same phrase', async () => {
        await remember('bread flour', MEMO_FOOD);
        catalogHit = { foodId: CATALOG_FOOD, name: 'Flour, bread', score: 9.5 };
        foodServiceResolves(MEMO_FOOD, 'Bread flour');

        const admitted = await addByName('Bread Flour');

        // The memo is a resolution a model ALREADY agreed with; the catalog hit is a guess KTD-A gives zero
        // authority and withholds on. Believing the guess replaces a settled answer with an unsettled one.
        expect(admitted.foodId).toBe(MEMO_FOOD);
        expect(foodClient.addByName).not.toHaveBeenCalled();
    });

    it('AE8 — a NEAR-TWIN of a remembered phrase resolves from the knowledge base, with no food-service call', async () => {
        await remember('caster sugar', MEMO_FOOD);
        // The catalog answers, as it nearly always does for a near-twin — which is exactly why the old order
        // made tier 3's whole reason for existing unreachable.
        catalogHit = { foodId: CATALOG_FOOD, name: 'Sugars, granulated', score: 8.1 };
        foodServiceResolves(MEMO_FOOD, 'Caster sugar');

        // Not present verbatim: `castor` for `caster`, above the trigram floor.
        const admitted = await addByName('Castor Sugar');

        expect(admitted.foodId).toBe(MEMO_FOOD);
        expect(foodClient.addByName).not.toHaveBeenCalled();
    });

    it('a CURATED mapping still outranks the memo — R19 keeps the top of the ladder', async () => {
        await remember('plain flour', MEMO_FOOD);
        await pool.query(
            `INSERT INTO ingredient_resolution_mappings
                 (normalized_key, food_id, scope, origin, user_id, source_phrase, surfacing)
             VALUES ($1, $2, 'global', 'curator', NULL, $3, 'integration_fixture')`,
            [normalizedIngredientKey(`${PREFIX} plain flour`)!, CURATED_FOOD, `${PREFIX} plain flour`],
        );
        catalogHit = { foodId: CATALOG_FOOD, name: 'Flour, plain', score: 9.9 };
        foodServiceResolves(CURATED_FOOD, 'All-purpose flour');

        const admitted = await addByName('Plain Flour');

        expect(admitted.foodId).toBe(CURATED_FOOD);
        expect(foodClient.addByName).not.toHaveBeenCalled();
    });

    it('with NOTHING remembered, the lexical tier still answers from the catalog', async () => {
        // The counterweight: this change is a PRECEDENCE fix, not a disabling of tier 2. A guard that only
        // asserted the memo wins would pass on a chain that had dropped the lexical tier entirely.
        catalogHit = { foodId: CATALOG_FOOD, name: 'Flour, rye', score: 7.2 };
        foodServiceResolves(CATALOG_FOOD, 'Rye flour');

        const admitted = await addByName('Rye Flour');

        expect(admitted.foodId).toBe(CATALOG_FOOD);
        expect(catalogSearch).toHaveBeenCalled();
        expect(foodClient.addByName).not.toHaveBeenCalled();
    });

    it('a STALE memo falls through to the ordinary path — not to the lexical tier (accepted, pinned)', async () => {
        // The cost of promoting the memo tier, made a decision rather than a discovery. `food_id` has no
        // foreign key and U12's reseed mints fresh ULIDs, so a memo can name a food that is gone.
        // `resolveThroughCascade` treats an unadmittable food as a MISS and returns `undefined` — it does not
        // resume the chain — so the request drops to `foodClient.addByName` and the catalog hit beside it is
        // NOT consulted. That is exactly the pre-cascade behaviour and never worse than no cascade at all;
        // resuming the chain instead would give the cascade knowledge of admission, a layering price the
        // curated tier's header already declined to pay for the same reason.
        await remember('semolina flour', MEMO_FOOD);
        catalogHit = { foodId: CATALOG_FOOD, name: 'Semolina', score: 8.8 };

        // The memo's food no longer carries a golden record — U12's reseed minted fresh ULIDs — so the
        // admission raises `UNKNOWN_INGREDIENT`, which is the one error the cascade deliberately swallows.
        foodClient.addByName.mockResolvedValue({ id: 'FRESH-FOOD', status: 'PENDING' });
        foodClient.getStatus.mockImplementation(async (id: string) =>
            id === MEMO_FOOD
                ? makeStatusResult({ id: MEMO_FOOD, status: 'UNRESOLVED' })
                : makeStatusResult({ id: 'FRESH-FOOD', status: 'PENDING' }),
        );

        const admitted = await addByName('Semolina Flour');

        expect(admitted.foodId).toBe('FRESH-FOOD');
        expect(foodClient.addByName).toHaveBeenCalledTimes(1);

        await pool.query('DELETE FROM ingredients WHERE food_id = $1', ['FRESH-FOOD']);
    });

    it('with nothing remembered AND an empty catalog, the ordinary food-service path still runs', async () => {
        // Exhaustion must remain a fall-through to the ordinary path, never a withheld answer: the cascade is
        // a shortcut to a better answer and may never take the ordinary one away.
        foodClient.addByName.mockResolvedValue({ id: 'FRESH-FOOD', status: 'PENDING' });
        foodClient.getStatus.mockResolvedValue(makeStatusResult({ id: 'FRESH-FOOD', status: 'PENDING' }));

        const admitted = await addByName('Spelt Flour');

        expect(foodClient.addByName).toHaveBeenCalledTimes(1);
        expect(admitted.foodId).toBe('FRESH-FOOD');

        await pool.query('DELETE FROM ingredients WHERE food_id = $1', ['FRESH-FOOD']);
    });
});
