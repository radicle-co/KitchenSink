/**
 * Integration suite for the golden-record merge → persistence seam (T-161/T-162/T-163/T-164) against
 * real Postgres. Asserts: every scalar/nutrient/portion of a RESOLVED food carries a resolvable
 * `source_id`; the "which fields came from source X" UNION returns the right fields; the cross-food
 * provenance FK still holds; no raw-payload column is written (SC-013); an UNRESOLVED outcome persists
 * the surviving candidate set under `UNIQUE(food_id, source, external_key)`; the manual-resolution path
 * stores the pick as ordinary provenance; and a malformed candidate value is dropped (reject-not-store)
 * while the food still resolves from the rest.
 *
 * Traceability: FR-028, FR-029, FR-031, FR-MRG-1, FR-MRG-5, FR-RES-2, FR-RES-3, FR-ADP-2, SC-013, R5, R7.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodNutritionDao } from '../../src/foods/dao/foodNutrition.dao.js';
import { NutrientDao } from '../../src/foods/dao/nutrient.dao.js';
import { CandidateStore } from '../../src/foods/dao/foodCandidates.dao.js';
import { FoodFieldProvenanceDao } from '../../src/foods/dao/foodFieldProvenance.dao.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { makeMergeCandidate } from '../../src/foods/merge/__fixtures__/merge.fixtures.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { type CanonicalCandidate } from '../../src/sources/foodSourceAdapter.js';
import { makeDb, makePool, type TestDb } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

describe('MergeAndPersistService (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let candidates: CandidateStore;
    let provenance: FoodFieldProvenanceDao;
    let service: MergeAndPersistService;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        candidates = new CandidateStore(db);
        provenance = new FoodFieldProvenanceDao(db);
        service = new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry()));
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    /** A fully-populated single-source candidate (name + scalars + 2 nutrients + 1 portion). */
    const richCandidate = (overrides: Partial<CanonicalCandidate> = {}): CanonicalCandidate =>
        makeMergeCandidate('usda', {
            externalKey: '171688',
            name: 'Broccoli, raw',
            description: 'Raw broccoli, chopped',
            brandOwner: 'Garden Fresh',
            nutrients: [
                { code: 'PROCNT', name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' },
                { code: 'ENERC_KCAL', name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' },
            ],
            portions: [{ label: '1 cup chopped', gramWeight: '91' }],
            ...overrides,
        });

    it('RESOLVED: every scalar/nutrient/portion carries a resolvable source_id (FR-028/SC-013)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });

        const result = await service.resolveAndPersist({ holders: [], foodId, candidates: [richCandidate()] });
        expect(result.outcome).toBe('RESOLVED');
        expect(result.status).toBe('RESOLVED');

        const record = await foods.readGoldenRecord(foodId);
        expect(record?.status).toBe('RESOLVED');
        expect(record?.name).toBe('Broccoli, raw');

        const sourceIds = new Set(record?.sources.map((source) => source.id));
        expect(sourceIds.size).toBeGreaterThanOrEqual(1);

        expect(record?.nutrients).toHaveLength(2);

        for (const nutrient of record?.nutrients ?? []) {
            // PIPELINE values always cite their item — an uncited value is the AUTHORED path's alone (0013, 0018).
            expect(nutrient.source).toBe('usda');
            expect(nutrient.basis).toBe('per_100g');
        }

        for (const portion of record?.portions ?? []) {
            expect(portion.sourceId !== null && sourceIds.has(portion.sourceId)).toBe(true);
        }

        const provenanceFields = (record?.fieldProvenance ?? []).map((entry) => entry.field).sort();
        expect(provenanceFields).toEqual(['brand_owner', 'description', 'kind', 'name']);

        for (const entry of record?.fieldProvenance ?? []) {
            expect(sourceIds.has(entry.sourceId)).toBe(true);
        }
    });

    it('RESOLVED: "which fields came from source X" returns every grain in one query (FR-029/R7)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });
        await service.resolveAndPersist({ holders: [], foodId, candidates: [richCandidate()] });

        const fields = (await provenance.fieldsFromSource(foodId, 'usda')).map((field) => field.field);

        expect(fields).toContain('field:name');
        expect(fields).toContain('field:description');
        expect(fields).toContain('field:brand_owner');
        expect(fields.filter((field) => field.startsWith('nutrient:'))).toHaveLength(2);
        expect(fields.filter((field) => field.startsWith('portion:'))).toHaveLength(1);
    });

    it('persists NO raw-payload column (SC-013): food_sources has no raw/payload column', async () => {
        const columns = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'food_sources'`,
        );
        const names = columns.rows.map((row) => row.column_name);

        expect(names.some((name) => /raw|payload/i.test(name))).toBe(false);
    });

    it("cross-food provenance FK holds: another food's citation is rejected (D-PROVENANCE-FK, KTD-19)", async () => {
        const { id: foodA } = await foods.createByName({ normalizedName: 'food a' });
        await service.resolveAndPersist({
            holders: [],
            foodId: foodA,
            candidates: [richCandidate({ externalKey: 'A' })],
        });
        const nutrition = new FoodNutritionDao(db);
        const headerA = await nutrition.headerForFood(foodA);
        const foreignCitation = await nutrition.citeSourceItem(headerA, {
            dataset: 'usdaSrFoundation',
            externalKey: 'A',
        });

        const { id: foodB } = await foods.createByName({ normalizedName: 'food b' });
        const headerB = await nutrition.headerForFood(foodB);
        const protein = await new NutrientDao(db).resolveOrCreate({ name: 'Protein', unit: 'g' });

        await expect(
            nutrition.upsertValue({
                nutritionId: headerB,
                nutrientId: protein.id,
                amount: '1',
                citationId: foreignCitation,
            }),
        ).rejects.toThrow();
    });

    it('cites each contributing item once, with the dataset its source stated (plan U4)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });

        await service.resolveAndPersist({
            holders: [],
            foodId,
            candidates: [richCandidate({ externalKey: 'A', dataset: 'usdaFndds' })],
        });

        const citations = await pool.query<{ dataset: string; external_key: string; match: string }>(
            `SELECT c.dataset, c.external_key, c.match FROM food_nutrition_citation c
               JOIN food_nutrition h ON h.id = c.nutrition_id WHERE h.food_id = $1`,
            [foodId],
        );

        expect(citations.rows).toStrictEqual([{ dataset: 'usdaFndds', external_key: 'A', match: 'exact' }]);
    });

    it('UNRESOLVED: >1 distinct survivor persists the candidate set under UNIQUE(food_id, source, external_key)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli' });

        const result = await service.resolveAndPersist({
            holders: [],
            foodId,
            candidates: [
                richCandidate({ externalKey: '171688', name: 'Broccoli, raw' }),
                richCandidate({ externalKey: '170379', name: 'Broccoli, cooked, boiled' }),
            ],
        });

        expect(result.outcome).toBe('UNRESOLVED');
        expect(result.status).toBe('UNRESOLVED');

        const persisted = await candidates.getCandidates(foodId);
        expect(persisted).toHaveLength(2);
        expect(persisted.map((candidate) => candidate.externalKey).sort()).toEqual(['170379', '171688']);

        const record = await foods.readGoldenRecord(foodId);
        expect(record?.status).toBe('UNRESOLVED');
        expect(record?.nutrients).toHaveLength(0);
    });

    it('NOT_FOUND: zero candidates tombstones the food', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'unobtainium' });

        const result = await service.resolveAndPersist({ holders: [], foodId, candidates: [] });

        expect(result.outcome).toBe('NOT_FOUND');
        const record = await foods.readGoldenRecord(foodId);
        expect(record?.status).toBe('NOT_FOUND');
        expect(record?.tombstonedAt).not.toBeNull();
    });

    it('manual resolution: a user pick merges → RESOLVED, stored as ordinary provenance, candidate set cleared (T-163)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli' });
        await service.resolveAndPersist({
            holders: [],
            foodId,
            candidates: [
                richCandidate({ externalKey: '171688', name: 'Broccoli, raw' }),
                richCandidate({ externalKey: '170379', name: 'Broccoli, cooked, boiled' }),
            ],
        });
        expect((await foods.getById(foodId))?.status).toBe('UNRESOLVED');

        const result = await service.resolveFromPicks({
            foodId,
            picks: [richCandidate({ externalKey: '171688', name: 'Broccoli, raw' })],
        });

        expect(result.outcome).toBe('RESOLVED');
        expect(result.status).toBe('RESOLVED');
        expect(await candidates.getCandidates(foodId)).toHaveLength(0);

        const record = await foods.readGoldenRecord(foodId);
        expect(record?.nutrients).toHaveLength(2);
        // The pick is ordinary provenance — indistinguishable from a normal value, so refresh protects it.
        const sourceIds = new Set(record?.sources.map((source) => source.id));

        expect(sourceIds.size).toBeGreaterThanOrEqual(1);

        for (const nutrient of record?.nutrients ?? []) {
            expect(nutrient.source).toBe('usda');
        }
    });

    it('persists a branded per_serving nutrient with basis=per_serving (D-PERSERVING, FR-MRG-3)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'acme protein crackers' });

        const result = await service.resolveAndPersist({
            holders: [],
            foodId,
            candidates: [
                richCandidate({
                    externalKey: '555001',
                    name: 'Acme Protein Crackers',
                    kind: 'branded',
                    nutrients: [
                        // A non-gram (ml/count) serving panel survives the adapter as per_serving.
                        { code: 'PROCNT', name: 'Protein', unit: 'g', amount: '8', basis: 'per_serving' },
                        { code: 'ENERC_KCAL', name: 'Energy', unit: 'kcal', amount: '150', basis: 'per_100g' },
                    ],
                }),
            ],
        });

        expect(result.outcome).toBe('RESOLVED');

        const record = await foods.readGoldenRecord(foodId);
        expect(record?.nutrients).toHaveLength(2);

        const protein = record?.nutrients.find((nutrient) => nutrient.name === 'Protein');
        const energy = record?.nutrients.find((nutrient) => nutrient.name === 'Energy');
        expect(protein?.basis).toBe('per_serving');
        expect(protein?.amount).toBe('8');
        expect(energy?.basis).toBe('per_100g');
    });

    it('reject-not-store: a malformed nutrient value is dropped, the food still resolves from the rest (T-164)', async () => {
        const { id: foodId } = await foods.createByName({ normalizedName: 'broccoli, raw' });

        const result = await service.resolveAndPersist({
            holders: [],
            foodId,
            candidates: [
                richCandidate({
                    nutrients: [
                        { code: 'PROCNT', name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' },
                        { code: 'FAT', name: 'Total fat', unit: 'g', amount: '-9', basis: 'per_100g' },
                    ],
                }),
            ],
        });

        expect(result.outcome).toBe('RESOLVED');
        const record = await foods.readGoldenRecord(foodId);
        expect(record?.nutrients).toHaveLength(1);
        expect(record?.nutrients[0]?.name).toBe('Protein');
    });
});
