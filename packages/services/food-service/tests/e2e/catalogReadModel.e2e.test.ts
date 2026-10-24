/**
 * LOCAL e2e — the curated catalog's read model against a REAL migrated Postgres (curated plan U8 S1, S2). Target:
 * LOCAL (`docs/CODING_STANDARDS.md` §7.1a); it proves the code and the schema, never a deploy. The readers connect as
 * `food_app` (ADR-0039); the seeded roots are written as the owner, whom `catalog_guard` admits (R47).
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | KTD-21 energy order | a root storing only Atwater Specific energy reads those calories, through the batch and search reads |
 * | KTD-23 carbohydrate, R53 | a by-difference trace reads 0 and a protein trace reads absent, off the real view |
 * | R17 variant read model | `listLive` answers live variants only, parts in contract order, each with its own nutrition |
 * | R17 on the wire | `GET /{id}` carries `variants`, parsed by the PUBLISHED schema |
 * | SC-013 | the citation key exists in the database (positive control) and never reaches the body |
 * | S6 batch, R18 | a variant id reads its own row, a forwarded id its target's, under the requested ids; a root with no
 *   row reads every macro absent; `hasLiveVariants` on roots only; an authored id is unknown; no citation key leaks |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import {
    foodNutritionBatchResponseSchema as publishedNutritionSchema,
    foodResponseSchema as publishedFoodResponseSchema,
} from '@kitchensink/schema-food';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: no read here dials a source, and stubbing the adapter means none can.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodVariantDao } from '../../src/foods/dao/foodVariant.dao.js';
import { projectStoredNutrition } from '../../src/foods/nutrition/nutrientSelection.js';
import { nutritionEntryFor } from '../../src/foods/nutrition/nutritionEntry.js';
import { newFoodId } from '../../src/db/ulid.js';
import { makeCatalogFood, makeSeededRoot } from '../__fixtures__/catalogFood.js';
import {
    insertCitation,
    insertHeader,
    insertItem,
    insertNutrient,
    insertRoot,
    makeCatalogWorld,
    newId,
    nextNumber,
    WORLD_AUTHOR,
} from './__fixtures__/catalogWorld.js';
import { makeDb } from '../support/db.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';

const keypair = generateClerkKeypair();
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_catalog_read',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});

/** Brisket, with the flat and point cuts live and a retired third, its parts written out of contract order. */
const BRISKET = {
    name: 'beef brisket',
    synonyms: ['first cut brisket'],
    values: [
        { key: 'energyKcalAtwaterSpecific', amount: 118 },
        { key: 'carbohydrateByDifference', amount: null },
        { key: 'protein', amount: null },
    ],
    variants: [
        {
            parts: [
                { attribute: 'cookingMethod', text: 'braised' },
                { attribute: 'cut', text: 'flat' },
            ],
            values: [{ key: 'energyKcal', amount: 155 }],
        },
        {
            parts: [
                { attribute: 'cut', text: 'point', ordinal: 1 },
                { attribute: 'cut', text: 'deckle', ordinal: 0 },
            ],
            values: [{ key: 'energyKcalAtwaterGeneral', amount: 240 }],
        },
        { parts: [{ attribute: 'cut', text: 'whole' }], retired: true },
    ],
} as const;

describe('the catalog read model — DAO reads against the migrated schema', () => {
    let pool: pg.Pool;
    let foodDao: FoodDao;
    let variantDao: FoodVariantDao;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        const db = makeDb(pool);
        foodDao = new FoodDao(db);
        variantDao = new FoodVariantDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    describe('S1 — the read rules over the real view', () => {
        it('the batch reads Atwater energy, a carbohydrate trace as 0 and a protein trace as absent', async () => {
            const root = await makeSeededRoot(foodDb(), BRISKET);

            const [record] = await foodDao.readNutritionBatch([root.id]);
            const entry = nutritionEntryFor(root.id, record!);

            expect(entry.caloriesPer100g).toBe(118);
            expect(entry.carbsGPer100g).toBe(0);
            expect(entry.proteinGPer100g).toBeUndefined();
        });

        it('search’s enrichment read carries the same rows to the same rule', async () => {
            const root = await makeSeededRoot(foodDb(), BRISKET);

            const projection = projectStoredNutrition(await foodDao.nutrientRowsFor([root.id]));

            expect(projection).toStrictEqual({
                caloriesPer100g: 118,
                proteinGPer100g: undefined,
                carbsGPer100g: 0,
                fatGPer100g: undefined,
            });
        });
    });

    describe('R40 second line — a variant read never reaches an authored root', () => {
        /**
         * The R40 trigger makes this state unrepresentable, so the test builds it with that trigger switched off for
         * one owner transaction: a variant under an authored root, with a cited value and a sourced portion.
         *
         * @returns The authored variant's id.
         * @sideEffect Writes the catalog as the owner.
         */
        const forceAuthoredVariant = (): Promise<string> =>
            foodDb().asOwner(async (client) => {
                await client.query('BEGIN');

                try {
                    await client.query('ALTER TABLE food_variant DISABLE TRIGGER food_variant_seed_only');

                    const root = await insertRoot(client, await insertItem(client, null, 'root'), {
                        seedKey: null,
                        userId: WORLD_AUTHOR,
                    });
                    const item = await insertItem(client, `fdc:${nextNumber()}`, 'variant');
                    const variant = newId('variant');

                    await client.query('INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)', [
                        variant,
                        root,
                        item,
                    ]);

                    const header = await insertHeader(client, { variantId: variant });
                    const citation = await insertCitation(client, header);
                    const source = newId('source');

                    await client.query(
                        `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
                         VALUES ($1, $2, 7, 'per_100g', $3)`,
                        [header, await insertNutrient(client), citation],
                    );
                    await client.query(
                        "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)",
                        [source, item, String(nextNumber())],
                    );
                    await client.query(
                        "INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, 'cup', 240, $3)",
                        [newId('portion'), item, source],
                    );
                    await client.query('ALTER TABLE food_variant ENABLE TRIGGER food_variant_seed_only');
                    await client.query('COMMIT');

                    return variant;
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                }
            });

        it('reads no nutrients and no portions for it, and still reads a seed variant (positive control)', async () => {
            const authored = await forceAuthoredVariant();
            const seed = await foodDb().asOwner(async (client) => {
                const world = await makeCatalogWorld(client, 'seed');
                const header = await insertHeader(client, { variantId: world.variant });

                await client.query(
                    `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
                     VALUES ($1, $2, 9, 'per_100g', $3)`,
                    [header, world.nutrient, await insertCitation(client, header)],
                );
                const source = newId('source');

                await client.query(
                    "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)",
                    [source, world.variantItem, String(nextNumber())],
                );
                await client.query(
                    'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, $3, 30, $4)',
                    [newId('portion'), world.variantItem, 'slice', source],
                );

                return world.variant;
            });

            const [authoredRead, seedRead] = await variantDao.readNutrition([authored, seed]);

            expect(authoredRead).toStrictEqual({ id: authored, nutrients: [], portions: [] });
            expect(seedRead?.nutrients.map((value) => value.amount)).toStrictEqual(['9']);
            expect(seedRead?.portions).toStrictEqual([{ label: 'slice', gramWeight: '30' }]);
        });
    });

    describe('S2 — listLive', () => {
        it('answers live variants only, each part list in contract order then ordinal', async () => {
            const root = await makeSeededRoot(foodDb(), BRISKET);
            const [flat, point] = root.variants;

            const variants = await variantDao.listLive([root.id], { withNutrition: false });

            expect(variants.map((variant) => variant.id).sort()).toStrictEqual([flat!.id, point!.id].sort());
            expect(variants.find((variant) => variant.id === flat!.id)?.parts).toStrictEqual([
                { attribute: 'cut', ordinal: 0, text: 'flat' },
                { attribute: 'cookingMethod', ordinal: 0, text: 'braised' },
            ]);
            expect(variants.find((variant) => variant.id === point!.id)?.parts).toStrictEqual([
                { attribute: 'cut', ordinal: 0, text: 'deckle' },
                { attribute: 'cut', ordinal: 1, text: 'point' },
            ]);
            expect(variants.every((variant) => variant.nutrients.length === 0)).toBe(true);
        });

        it('reads each variant’s OWN nutrition, never the root’s', async () => {
            const root = await makeSeededRoot(foodDb(), BRISKET);
            const [flat, point] = root.variants;

            const variants = await variantDao.listLive([root.id], { withNutrition: true });
            const caloriesOf = (id: string): number | undefined =>
                projectStoredNutrition(variants.find((variant) => variant.id === id)?.nutrients ?? []).caloriesPer100g;

            expect(caloriesOf(flat!.id)).toBe(155);
            expect(caloriesOf(point!.id)).toBe(240);
        });

        it('answers each root’s variants under that root, and nothing for a root with none', async () => {
            const brisket = await makeSeededRoot(foodDb(), BRISKET);
            const plain = await makeSeededRoot(foodDb(), { name: 'pizza crust' });

            const variants = await variantDao.listLive([brisket.id, plain.id], { withNutrition: false });

            expect(new Set(variants.map((variant) => variant.rootId))).toStrictEqual(new Set([brisket.id]));
            expect(await variantDao.listLive([plain.id], { withNutrition: true })).toStrictEqual([]);
            expect(await variantDao.listLive([], { withNutrition: true })).toStrictEqual([]);
        });
    });
});

describe('GET /api/v1/foods/{id} — variants on the wire (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('lists the root’s live variants with their own calories, in the PUBLISHED shape', async () => {
        const root = await makeSeededRoot(foodDb(), BRISKET);
        const [flat, point] = root.variants;

        const res = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/${root.id}`, { token: userToken });

        expect(res.status).toBe(200);

        const variants = publishedFoodResponseSchema.parse(res.body).variants;

        expect(variants).toHaveLength(2);
        expect(variants).toContainEqual({
            id: flat!.id,
            parts: [
                { attribute: 'cut', text: 'flat' },
                { attribute: 'cookingMethod', text: 'braised' },
            ],
            caloriesPer100g: 155,
        });
        expect(variants).toContainEqual({
            id: point!.id,
            parts: [
                { attribute: 'cut', text: 'deckle' },
                { attribute: 'cut', text: 'point' },
            ],
            caloriesPer100g: 240,
        });
    });

    it('⛔ SC-013: the citation keys exist in the database, and none reaches the body', async () => {
        const root = await makeSeededRoot(foodDb(), BRISKET);
        const keys = [root.citationKey, ...root.variants.map((variant) => variant.citationKey)].filter(
            (key): key is string => key !== null,
        );
        const stored = await pool.query<{ external_key: string }>(
            'SELECT external_key FROM food_nutrition_citation WHERE external_key = ANY($1)',
            [keys],
        );

        // Positive control: without these rows the negative assertion below would pass vacuously.
        expect(stored.rows.map((row) => row.external_key).sort()).toStrictEqual([...keys].sort());

        const res = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/${root.id}`, { token: userToken });

        expect(res.status).toBe(200);

        for (const key of keys) {
            expect(res.text).not.toContain(key);
        }

        expect(res.text).not.toContain('usdaSrFoundation');
        expect(res.text).not.toContain('external');
    });
});

describe('GET /api/v1/foods/nutrition — roots, variants and forwards (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('answers each id under ITSELF: a variant’s own row, a forward’s target, a root with no row as absent', async () => {
        const brisket = await makeSeededRoot(foodDb(), BRISKET);
        const crust = await makeSeededRoot(foodDb(), { name: 'pizza crust' });
        const old = await makeSeededRoot(foodDb(), { name: 'brisket, old', retired: true });
        const [flat] = brisket.variants;
        await foodDb().asOwner((client) =>
            client.query(
                "INSERT INTO food_forward (source_id, source_kind, target_variant_id) VALUES ($1, 'root', $2)",
                [old.id, flat!.id],
            ),
        );
        const ids = [brisket.id, crust.id, old.id, flat!.id].sort();

        const res = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/nutrition?ids=${ids.join(',')}`, {
            token: userToken,
        });

        expect(res.status).toBe(200);

        const { foods, unknownIds } = publishedNutritionSchema.parse(res.body);
        const entry = (id: string) => foods.find((food) => food.id === id);

        expect(unknownIds).toStrictEqual([]);
        expect(entry(brisket.id)).toMatchObject({ caloriesPer100g: 118, carbsGPer100g: 0, hasLiveVariants: true });
        expect(entry(brisket.id)).not.toHaveProperty('proteinGPer100g');
        expect(entry(crust.id)).toStrictEqual({
            id: crust.id,
            status: 'RESOLVED',
            portions: [],
            hasLiveVariants: false,
        });
        expect(entry(flat!.id)).toStrictEqual({
            id: flat!.id,
            status: 'RESOLVED',
            caloriesPer100g: 155,
            portions: [],
        });
        expect(entry(old.id)).toStrictEqual({ id: old.id, status: 'RESOLVED', caloriesPer100g: 155, portions: [] });
    });

    it('R9: a variant reads its OWN item’s portions and the root its own; a retired variant is not a live one', async () => {
        const brisket = await makeSeededRoot(foodDb(), BRISKET);
        const lonely = await makeSeededRoot(foodDb(), {
            name: 'beef shank',
            variants: [{ parts: [{ attribute: 'cut', text: 'fore' }], retired: true }],
        });
        const [flat] = brisket.variants;
        // A catalog portion cites its item's source row: the provenance trigger refuses an uncited one.
        await foodDb().asOwner(async (client) => {
            for (const [itemId, label, grams] of [
                [flat!.itemId, '1 cup', 140],
                [brisket.itemId, '1 slice', 28],
            ] as const) {
                const sourceId = newFoodId();

                await client.query(
                    "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)",
                    [sourceId, itemId, `portion-${sourceId}`],
                );
                await client.query(
                    'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, $3, $4, $5)',
                    [newFoodId(), itemId, label, grams, sourceId],
                );
            }
        });
        const ids = [brisket.id, flat!.id, lonely.id].sort();

        const res = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/nutrition?ids=${ids.join(',')}`, {
            token: userToken,
        });
        const { foods } = publishedNutritionSchema.parse(res.body);
        const entry = (id: string) => foods.find((food) => food.id === id);

        expect(entry(flat!.id)?.portions).toStrictEqual([{ unit: 'cup', gramsPerUnit: 140 }]);
        expect(entry(brisket.id)?.portions).toStrictEqual([{ unit: 'slice', gramsPerUnit: 28 }]);
        expect(entry(lonely.id)?.hasLiveVariants).toBe(false);
    });

    it('⛔ ADR-0020: an authored food is unknown on the shared batch, and no citation key reaches the body', async () => {
        const brisket = await makeSeededRoot(foodDb(), BRISKET);
        // An authored food is a live row the service role writes itself.
        const { id: authored } = await makeCatalogFood(pool, {
            id: newFoodId(),
            name: 'my blend',
            userId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
        });
        const keys = [brisket.citationKey, ...brisket.variants.map((variant) => variant.citationKey)].filter(
            (key): key is string => key !== null,
        );
        const stored = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM food_nutrition_citation WHERE external_key = ANY($1)',
            [keys],
        );

        // Positive control: the citations exist, so the negative assertion below cannot pass vacuously.
        expect(Number(stored.rows[0]?.n)).toBe(keys.length);

        const ids = [brisket.id, ...brisket.variants.map((variant) => variant.id), authored].sort();
        const res = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/nutrition?ids=${ids.join(',')}`, {
            token: userToken,
        });

        // Rewritten for curated U9 P0 (R29): the retired third cut has no successor, so it answers its OWN numbers
        // under its id — a line bound to it keeps them. It used to be pinned unknown here.
        const retiredCut = brisket.variants[2]!.id;
        const body = publishedNutritionSchema.parse(res.body);

        expect(body.unknownIds).toStrictEqual([authored]);
        expect(body.foods.map((food) => food.id)).toContain(retiredCut);

        for (const key of keys) {
            expect(res.text).not.toContain(key);
        }
    });
});
