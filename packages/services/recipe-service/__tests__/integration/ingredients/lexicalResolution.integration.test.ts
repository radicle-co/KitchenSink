/**
 * U4 — THE LEXICAL TIER IN THE REAL CASCADE (plan U4 / KTD-A, KTD-C; R20).
 *
 * The unit suite (`resolution/__tests__/lexicalTier.test.ts`) proves the tier's judgement against a mocked
 * gateway. This is the tier that plan U4's Files list calls the "cascade integration test", and it exists
 * because four of the tier's load-bearing claims are STRUCTURALLY invisible to a mock:
 *
 *  1. **Consultation order.** `['curated', 'lexical', 'memo']` is R11's PRECEDENCE, not an implementation
 *     detail. A mocked tier array asserts the array; only the real registry running against a real mapping
 *     row proves that a curated hit stops the chain before the catalog is ever searched — the "the call that
 *     does NOT happen" assertion `curatedResolution.integration.test.ts` established.
 *  2. **The KTD-C shortlist round-trips through JSONB.** The verification producer re-parses the stored
 *     `ScoredCandidate[]` with a zod schema and DOWNGRADES a line to `unattributed` when it does not parse
 *     (`verificationRequests.ts`). A unit test hands the producer an in-memory array and can never observe
 *     the column that actually feeds it.
 *  3. **`author_augmented` (R20) is a persisted column** added by migration 0040. A unit test cannot observe
 *     a migration that did not apply, and this flag is what excludes one user's private catalog from shared
 *     band statistics on BOTH sides.
 *  4. **The reach itself.** The cascade is consulted on the WRITE path (`addByName`) and nowhere else — the
 *     read routes (`/suggest`, `/search/live`, `/{id}/resolve`) present candidates to a human who decides.
 *     Asserted here as a live fact about the shipped service rather than as a sentence in a docstring.
 *
 * The food service is stubbed at its client boundary — the one dependency 001 does not own — but the
 * GATEWAY above it is real, so the availability discipline (`ok` / `disabled` / degraded) under test is the
 * production one rather than a fixture's idea of it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { queryShapeOf } from '@kitchensink/recipe-core/resolution/band-policy';
import { RANKER_VERSION } from '@kitchensink/recipe-core/resolution/ranking-tiers';
import type { FoodServiceClient } from '@kitchensink/food-service-client';

import type { Principal } from '../../../src/auth/principal.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { CURATOR_MAPPING_SCOPE } from '../../../src/ingredients/domain/mappingScopePolicy.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { createCuratedTier } from '../../../src/ingredients/resolution/curatedTier.js';
import { createLexicalTier } from '../../../src/ingredients/resolution/lexicalTier.js';
import { createMemoTier } from '../../../src/ingredients/resolution/memoTier.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import { MappingPromotionAudit } from '../../../src/ingredients/resolution/mappingPromotionAudit.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { ResolutionMappingsService } from '../../../src/ingredients/resolution/resolutionMappings.service.js';
import {
    CALLER_TOKEN as CALLER,
    makeCanonicalName,
    makeFoodView,
    makeStatusResult,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Every phrase this suite resolves shares this prefix, so cleanup is exact. */
const PREFIX = 'u4 lexical';

const TOP_FOOD = '01JU4LEXICAL00000000000TOP';
const RUNNER_FOOD = '01JU4LEXICAL0000000RUNNER1';
const CURATED_FOOD = '01JU4LEXICAL000000CURATED1';
const EGGPLANT_FOOD = '01JU4LEXICAL00000EGGPLANT1';
const PRIVATE_FOOD = '01JU4LEXICAL000000PRIVATE1';
const FALLTHROUGH_FOOD = '01JU4LEXICAL00000FALLTHRU1';

const AUTHOR = '01JU4LEXICAL000000000AUTHR';
const CURATOR = '01JU4LEXICAL00000000CURATR';

/** A principal with the given grants. */
function principal(userId: string, scopes: string[] = []): Principal {
    return { userId, sub: `clerk_${userId}`, scopes, permissions: [] };
}

/** One food-service search row, in the wire spelling the gateway narrows. */
function searchRow(id: string, name: string, score: number, visibility?: 'private' | 'promoted') {
    return {
        id,
        name,
        score,
        caloriesPer100g: 364,
        proteinGPer100g: 10.3,
        ...(visibility === undefined ? {} : { visibility }),
    };
}

describe.skipIf(!hasDatabaseUrl)('U4 — the lexical tier inside the real cascade', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let mappings: ResolutionMappingsDal;
    let resolutions: IngredientResolutionsDal;
    let corrections: ResolutionMappingsService;
    let foodClient: {
        search: ReturnType<typeof vi.fn>;
        addByName: ReturnType<typeof vi.fn>;
        getStatus: ReturnType<typeof vi.fn>;
    };
    let ingredients: IngredientsService;

    /** Build the service over a REAL gateway whose blend switch the test controls. */
    function serviceWith(enabled: boolean): IngredientsService {
        const clients = {
            standard: () => foodClient as unknown as FoodServiceClient,
            typeahead: () => foodClient as unknown as FoodServiceClient,
        } as never;
        const catalog = new FoodCatalogGateway(clients, { enabled });

        return new IngredientsService(
            new IngredientsDal(db),
            clients,
            catalog,
            [createCuratedTier(mappings), createLexicalTier(catalog), createMemoTier(mappings)],
            resolutions,
        );
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        mappings = new ResolutionMappingsDal(db);
        resolutions = new IngredientResolutionsDal(db);
        corrections = new ResolutionMappingsService(mappings, {
            recordPromotion: vi.fn(),
        } as unknown as MappingPromotionAudit);

        foodClient = { search: vi.fn(), addByName: vi.fn(), getStatus: vi.fn() };
        ingredients = serviceWith(true);
    });

    afterEach(async () => {
        // ⛔ RESET, not CLEAR. `clearAllMocks` forgets the CALLS and keeps the queued `mockResolvedValueOnce`
        // implementations, so a spec whose reformulation retry did not fire would leave its second queued
        // answer to be served to the NEXT spec — a mutation run caught exactly that cross-contamination, one
        // failing assertion manufacturing a second, unrelated one.
        vi.resetAllMocks();
        await pool.query(
            `DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1 AND origin = 'corroboration'`,
            [`${PREFIX}%`],
        );
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await pool.query(
            'DELETE FROM ingredient_resolutions WHERE ingredient_id IN (SELECT id FROM ingredients WHERE food_id = ANY($1))',
            [[TOP_FOOD, RUNNER_FOOD, CURATED_FOOD, EGGPLANT_FOOD, PRIVATE_FOOD, FALLTHROUGH_FOOD]],
        );
        await pool.query('DELETE FROM ingredients WHERE food_id = ANY($1)', [
            [TOP_FOOD, RUNNER_FOOD, CURATED_FOOD, EGGPLANT_FOOD, PRIVATE_FOOD, FALLTHROUGH_FOOD],
        ]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Point the food client's `getStatus` at one RESOLVED golden record. */
    function goldenRecord(id: string, name: string, visibility?: 'private'): void {
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({
                id,
                status: FoodResolutionStatus.RESOLVED,
                food: makeFoodView({ id, name, ...(visibility === undefined ? {} : { visibility }) }),
            }),
        );
    }

    /** Add the phrase by name, as the given user, through the REAL cascade. */
    async function addByName(phrase: string, userId: string | undefined = AUTHOR) {
        return ingredients.addByName(CALLER, makeCanonicalName(`${PREFIX} ${phrase}`), userId);
    }

    /** The persisted provenance event for an admitted ingredient. */
    async function provenanceOf(ingredientId: string) {
        return (await resolutions.latestResolutionsByIngredientIds([ingredientId])).get(ingredientId);
    }

    it('resolves from the ranked catalog and persists the FULL KTD-C provenance through JSONB', async () => {
        foodClient.search.mockResolvedValue({
            results: [
                searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 0.91),
                searchRow(RUNNER_FOOD, 'Carob flour', 0.62),
            ],
        });
        goldenRecord(TOP_FOOD, 'Flour, wheat, all-purpose');

        const admitted = await addByName('flour');

        // The tier answered, so the expensive add-by-name path was never reached.
        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(TOP_FOOD);

        const event = await provenanceOf(admitted.id);

        expect(event).toMatchObject({
            tier: 'lexical',
            rung: 'head',
            queryShape: queryShapeOf(`${PREFIX} flour`),
            rankerVersion: RANKER_VERSION,
            authorAugmented: false,
        });
        // The measured margin, stored as numeric and read back as a number.
        expect(event?.margin).toBeCloseTo(0.29, 5);
        // ⛔ The shortlist the verification producer re-parses. Stored as JSONB, so this is the only tier
        // that can prove the nutrient snapshot survives the round trip — the producer downgrades the whole
        // line to `unattributed` when it does not.
        expect(event?.shortlist).toEqual([
            { foodId: TOP_FOOD, score: 0.91, energyKcalPer100g: 364, proteinGPer100g: 10.3 },
            { foodId: RUNNER_FOOD, score: 0.62, energyKcalPer100g: 364, proteinGPer100g: 10.3 },
        ]);
    });

    it('⛔ a CURATED mapping stops the chain — the catalog is never searched (R11 precedence)', async () => {
        await corrections.recordCorrection({
            principal: principal(CURATOR, [CURATOR_MAPPING_SCOPE]),
            phrase: `${PREFIX} plain flour`,
            foodId: CURATED_FOOD,
            surfacing: 'picker_correction',
        });
        goldenRecord(CURATED_FOOD, 'Flour, wheat, all-purpose');
        foodClient.search.mockResolvedValue({ results: [searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 0.99)] });

        const admitted = await addByName('plain flour');

        // The call that does NOT happen is the requirement: tier 1 answered, so tier 2 was never consulted.
        expect(foodClient.search).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(CURATED_FOOD);
        expect(await provenanceOf(admitted.id)).toMatchObject({ tier: 'curated', rung: null });
    });

    it('an EMPTY catalog passes and the add falls through to the food service — never a false bind', async () => {
        foodClient.search.mockResolvedValue({ results: [] });
        foodClient.addByName.mockResolvedValue({ id: FALLTHROUGH_FOOD, status: FoodResolutionStatus.PENDING });
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({ id: FALLTHROUGH_FOOD, status: FoodResolutionStatus.PENDING }),
        );

        const admitted = await addByName('blorvik');

        expect(foodClient.addByName).toHaveBeenCalledTimes(1);
        expect(admitted.foodId).toBe(FALLTHROUGH_FOOD);
        // A tier that PASSED records nothing: absence is what the producer reads as `unattributed`.
        expect(await provenanceOf(admitted.id)).toBeUndefined();
    });

    it('the synonym reformulation retries ONCE and the resolution says so (origin D11)', async () => {
        foodClient.search
            .mockResolvedValueOnce({ results: [] })
            .mockResolvedValueOnce({ results: [searchRow(EGGPLANT_FOOD, 'Eggplant, raw', 0.9)] });
        goldenRecord(EGGPLANT_FOOD, 'Eggplant, raw');

        const admitted = await addByName('aubergine');

        expect(foodClient.search).toHaveBeenCalledTimes(2);
        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(EGGPLANT_FOOD);
        expect(await provenanceOf(admitted.id)).toMatchObject({ tier: 'lexical' });
    });

    it('R20 — a hit that is the CALLER’s own private food flags the resolution author-augmented', async () => {
        foodClient.search.mockResolvedValue({
            results: [
                searchRow(PRIVATE_FOOD, 'Gran’s pie filling', 0.95, 'private'),
                searchRow(TOP_FOOD, 'Pie filling, canned', 0.4),
            ],
        });
        goldenRecord(PRIVATE_FOOD, 'Gran’s pie filling', 'private');

        const admitted = await addByName('grans pie filling');
        const event = await provenanceOf(admitted.id);

        expect(admitted.foodId).toBe(PRIVATE_FOOD);
        // The flag rides the persisted column added by 0040 — it is what excludes one user's private catalog
        // from shared band statistics, so no band epoch is observed for it either.
        expect(event).toMatchObject({ tier: 'lexical', authorAugmented: true, bandEpoch: null });
    });

    it('⛔ a DISABLED blend passes quietly and the add falls through — an operator switch is not an outage', async () => {
        const disabled = serviceWith(false);

        foodClient.addByName.mockResolvedValue({ id: FALLTHROUGH_FOOD, status: FoodResolutionStatus.PENDING });
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({ id: FALLTHROUGH_FOOD, status: FoodResolutionStatus.PENDING }),
        );

        const admitted = await disabled.addByName(CALLER, makeCanonicalName(`${PREFIX} switched off`), AUTHOR);

        expect(foodClient.search).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(FALLTHROUGH_FOOD);
    });

    it('⛔ THE CASCADE IS THE WRITE PATH’S — the blended typeahead resolves nothing and admits nothing', async () => {
        foodClient.search.mockResolvedValue({ results: [searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 0.91)] });

        const suggestions = await ingredients.suggest(CALLER, `${PREFIX} flour`, AUTHOR, 5);

        // The catalog hit is OFFERED, not bound: no ingredient row, no provenance event, no `getStatus`
        // round-trip, and no verification obligation incurred on a per-keystroke read.
        expect(suggestions.catalogAvailability).toBe('ok');
        expect(foodClient.getStatus).not.toHaveBeenCalled();

        const { rows } = await pool.query('SELECT id FROM ingredients WHERE food_id = $1', [TOP_FOOD]);

        expect(rows).toHaveLength(0);
    });
});
