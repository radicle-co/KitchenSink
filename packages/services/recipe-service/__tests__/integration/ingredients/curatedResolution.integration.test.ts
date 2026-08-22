/**
 * U10 — THE LEARNING LOOP CLOSES: one user's correction resolves another user's line (plan U10 / R19, AE6).
 *
 * This is the unit's verification line — "a user correction reaches the mapping table and the next occurrence
 * of that phrase resolves at tier 1" — proved end to end through the REAL service, the REAL policy and a REAL
 * Postgres, with only the food service stubbed at its client boundary (the one dependency 001 does not own).
 *
 * ⛔ WHY THIS TIER AND NOT A MOCKED SERVICE TEST. The loop's two hard parts are both invisible to a mock: the
 * correction is written under a scope the pure policy decided from rows that must actually EXIST, and the
 * corroboration count is a count of live rows enforced by a partial unique index. A mocked DAL returning
 * "two corroborators" proves the policy, which is already truth-tested; it proves nothing about whether two
 * real corrections produce two real rows.
 *
 * ⚠️ **AE6 AS WRITTEN IS UNSATISFIABLE UNDER THE OWNER'S RULING, AND THIS SUITE DOCUMENTS THAT RATHER THAN
 * PAPERING OVER IT.** AE6 says: one correction, then "the next occurrence of the same normalized phrase,
 * submitted by a DIFFERENT user, resolves at the curated tier". The owner ruling implemented here is that an
 * ungranted caller's first correction stays AUTHOR-SCOPED until a second independent user corroborates — so
 * after exactly one ungranted correction a different user gets no tier-1 hit, by design. The two paths that
 * DO satisfy the spirit of AE6 are asserted below (a curator's single correction, and two ungranted users
 * agreeing), and the third spec pins the gap itself so it cannot be "fixed" silently in either direction.
 * Flagged for the owner: either AE6 says "the same user", or a single uncorroborated mapping resolves
 * globally at a lower confidence band.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodServiceClient } from '@kitchensink/food-service-client';

import type { Principal } from '../../../src/auth/principal.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { CURATOR_MAPPING_SCOPE } from '../../../src/ingredients/domain/mappingScopePolicy.js';
import type { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { createCuratedTier } from '../../../src/ingredients/resolution/curatedTier.js';
import { createMemoTier } from '../../../src/ingredients/resolution/memoTier.js';
import { MappingPromotionAudit } from '../../../src/ingredients/resolution/mappingPromotionAudit.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { ResolutionMappingsService } from '../../../src/ingredients/resolution/resolutionMappings.service.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeCanonicalName,
    makeFoodView,
    makeStatusResult,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const MAPPED_FOOD = '01JU10LOOP0000000000MAPPED';
const MAPPED_NAME = 'All-purpose flour';
const AUTHOR_A = '01JU10LOOP0000000000AUTHA';
const AUTHOR_B = '01JU10LOOP0000000000AUTHB';
const AUTHOR_C = '01JU10LOOP0000000000AUTHC';
const CURATOR = '01JU10LOOP000000000CURATOR';

/** Every phrase this suite corrects shares this prefix, so cleanup is exact. */
const PREFIX = 'u10 loop';

/** A principal with the given grants. */
function principal(userId: string, scopes: string[] = []): Principal {
    return { userId, sub: `clerk_${userId}`, scopes, permissions: [] };
}

describe.skipIf(!hasDatabaseUrl)('the curated-resolution learning loop', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let mappings: ResolutionMappingsDal;
    let corrections: ResolutionMappingsService;
    let promotions: ReturnType<typeof vi.fn>;
    let foodClient: { addByName: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> };
    let ingredients: IngredientsService;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        mappings = new ResolutionMappingsDal(db);
        promotions = vi.fn();
        corrections = new ResolutionMappingsService(mappings, {
            recordPromotion: promotions,
        } as unknown as MappingPromotionAudit);

        foodClient = {
            addByName: vi.fn(),
            getStatus: vi.fn().mockResolvedValue(
                makeStatusResult({
                    id: MAPPED_FOOD,
                    status: 'RESOLVED',
                    food: makeFoodView({ name: MAPPED_NAME }),
                }),
            ),
        };
        ingredients = new IngredientsService(
            new IngredientsDal(db),
            foodClientsOf(foodClient as unknown as FoodServiceClient),
            { search: vi.fn() } as unknown as FoodCatalogGateway,
            [createCuratedTier(mappings), createMemoTier(mappings)],
        );
    });

    afterEach(async () => {
        vi.clearAllMocks();
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({ id: MAPPED_FOOD, status: 'RESOLVED', food: makeFoodView({ name: MAPPED_NAME }) }),
        );
        await pool.query(
            `DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1 AND origin = 'corroboration'`,
            [`${PREFIX}%`],
        );
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await pool.query('DELETE FROM ingredients WHERE food_id = $1', [MAPPED_FOOD]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Record one correction through the real service. */
    async function correct(userId: string, phrase: string, scopes: string[] = []) {
        return corrections.recordCorrection({
            principal: principal(userId, scopes),
            phrase: `${PREFIX} ${phrase}`,
            foodId: MAPPED_FOOD,
            surfacing: 'picker_correction',
        });
    }

    /** Add the phrase by name, as the given user. */
    async function addByName(phrase: string, userId: string | undefined) {
        return ingredients.addByName(CALLER, makeCanonicalName(`${PREFIX} ${phrase}`), userId);
    }

    it('a CURATOR’s single correction resolves the phrase for a different user, with no food-service add', async () => {
        await correct(CURATOR, 'plain flour', [CURATOR_MAPPING_SCOPE]);

        const admitted = await addByName('Plain Flour', AUTHOR_B);

        // The call that does NOT happen is the requirement: the phrase resolved at tier 1, so the expensive
        // path (and, once U11 lands, the LLM behind it) was never reached.
        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(MAPPED_FOOD);
        // …and the catalog row is named from food-service's canonical record, not from the caller's phrase.
        expect(admitted.name).toBe(MAPPED_NAME);
    });

    it('TWO ungranted users agreeing bind the phrase for a THIRD, and the promotion is audited', async () => {
        const first = await correct(AUTHOR_A, 'caster sugar');
        const second = await correct(AUTHOR_B, 'caster sugar');

        expect(first.written && first.promotedToGlobal).toBe(false);
        expect(second.written && second.promotedToGlobal).toBe(true);

        // R20's audit signal, emitted exactly once, naming BOTH promoters and the phrase now bound globally.
        expect(promotions).toHaveBeenCalledTimes(1);
        expect(promotions).toHaveBeenCalledWith(
            expect.objectContaining({
                corroboratingAuthorIds: [AUTHOR_A, AUTHOR_B],
                normalizedKey: `${PREFIX} caster sugar`,
            }),
        );

        const admitted = await addByName('Caster Sugar', AUTHOR_C);

        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(MAPPED_FOOD);
    });

    it('⚠️ ONE ungranted correction does NOT resolve for a different user — the AE6 gap, pinned', async () => {
        await correct(AUTHOR_A, 'rye flour');

        foodClient.addByName.mockResolvedValue({ id: 'FRESH-FOOD', status: 'PENDING' });
        foodClient.getStatus.mockResolvedValue(makeStatusResult({ id: 'FRESH-FOOD', status: 'PENDING' }));

        const admitted = await addByName('Rye Flour', AUTHOR_B);

        // AE6 as written expects a tier-1 hit here. The owner's grant-gated-global ruling says otherwise, and
        // THIS is what ships. Pinned so the divergence is a decision on the record rather than a surprise.
        expect(foodClient.addByName).toHaveBeenCalledTimes(1);
        expect(admitted.foodId).toBe('FRESH-FOOD');

        // The author's OWN next occurrence does resolve at tier 1 — the half of AE6 that holds today.
        vi.clearAllMocks();
        await pool.query('DELETE FROM ingredients WHERE food_id = $1', ['FRESH-FOOD']);
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({ id: MAPPED_FOOD, status: 'RESOLVED', food: makeFoodView({ name: MAPPED_NAME }) }),
        );

        const own = await addByName('Rye Flour', AUTHOR_A);

        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(own.foodId).toBe(MAPPED_FOOD);
    });

    it('an UNATTENDED import sees a globally-bound phrase and no personal correction (R22)', async () => {
        await correct(AUTHOR_A, 'spelt flour');

        foodClient.addByName.mockResolvedValue({ id: 'FRESH-FOOD', status: 'PENDING' });
        foodClient.getStatus.mockResolvedValue(makeStatusResult({ id: 'FRESH-FOOD', status: 'PENDING' }));

        // One user's private correction must never silently rewrite an unattended import.
        await addByName('Spelt Flour', undefined);

        expect(foodClient.addByName).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        await pool.query('DELETE FROM ingredients WHERE food_id = $1', ['FRESH-FOOD']);
        foodClient.getStatus.mockResolvedValue(
            makeStatusResult({ id: MAPPED_FOOD, status: 'RESOLVED', food: makeFoodView({ name: MAPPED_NAME }) }),
        );
        await correct(CURATOR, 'spelt flour', [CURATOR_MAPPING_SCOPE]);

        const admitted = await addByName('Spelt Flour', undefined);

        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(admitted.foodId).toBe(MAPPED_FOOD);
    });

    it('⛔ writes NO memo row — nothing in U10 may fill the tier the verification gate owns', async () => {
        await correct(CURATOR, 'bread flour', [CURATOR_MAPPING_SCOPE]);
        await addByName('Bread Flour', AUTHOR_B);

        // The plan's bar for tier 3 is that an entry exists only for a resolution the gate AGREED with, and
        // U10 has no gate. Asserting the negative is what keeps that bar honest before U11 has a writer: if
        // some later change starts memoising resolutions here, it fails this rather than quietly acquiring
        // global reach with none of a curated mapping's review.
        const { rows } = await pool.query('SELECT normalized_key FROM ingredient_resolution_memos');

        expect(rows).toHaveLength(0);
    });
});
