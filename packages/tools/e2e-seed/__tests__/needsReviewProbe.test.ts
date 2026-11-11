/**
 * `reset --mode needsReview`: the owner's recipe whose line reads NEEDS_REVIEW.
 *
 * That status is DERIVED at read time from a stored `contradicted` verdict (`resolveLineStatus`), and the only writer of the
 * verdict is a Bedrock worker the local stack does not run. So the seed creates the recipe through the API and stores the
 * verdict itself. What these tests hold, each written to fail if the logic were wrong:
 *
 *  - the row's KEY is the one the read looks up (an independent construction of the preimage, not a call to the code under test);
 *  - the row says what makes a line NEEDS_REVIEW rather than AMBIGUOUS: a high-certainty disagreement about the QUANTITY, with
 *    identity never asked (a high-certainty identity disagreement is what makes AMBIGUOUS, the pick surface);
 *  - the seed READS THE RECIPE BACK and fails loudly unless the line reads NEEDS_REVIEW, because a key that is one byte off
 *    stores a row nothing ever finds and the flow behind it would fail on a step that reads like an app defect.
 */
import { createHash } from 'node:crypto';

import type { CreateAuthoredFoodResult } from '@kitchensink/food-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { describe, expect, it, vi } from 'vitest';

import { deriveFixtureManifest, deriveNeedsReviewProbe } from '../src/fixtureManifest.js';
import {
    ensureNeedsReviewProbe,
    NEEDS_REVIEW_SEED_MODEL_ID,
    needsReviewVerdictFor,
    type SeedVerdictRow,
    type SeedVerdictStore,
} from '../src/needsReviewProbe.js';

const manifest = deriveFixtureManifest('gh42-1-maestro', 'android', 1);
const probe = deriveNeedsReviewProbe(manifest);
const line = probe.ingredients[0]!;
const FOOD_NAME = line.name;
const FOOD_ID = 'food_paprika';
const BINDING = '00000000-0000-4000-8000-0000000000b1';

describe('needsReviewVerdictFor', () => {
    const row = needsReviewVerdictFor({
        sourceLine: '2 cups chicken stock',
        foodRefId: FOOD_ID,
        quantity: 2,
        unit: 'cup',
    });

    /**
     * ⛔ Built by hand from the documented preimage, not by calling `verificationKey`: a seed that hashed the wrong tuple with
     * the right function would agree with itself and be found by nothing.
     */
    it('keys the row on v2 + the normalized line + the food + the measure, as the read derives it', () => {
        const preimage = JSON.stringify(['v2', '2 cups chicken stock', FOOD_ID, 2, null, 'cup', null]);

        expect(row.verificationKey).toBe(`v2:${createHash('sha256').update(preimage, 'utf8').digest('hex')}`);
    });

    it('normalises whitespace in the line the way the read does, so a double space still finds its row', () => {
        const spaced = needsReviewVerdictFor({
            sourceLine: ' 2  cups   chicken stock ',
            foodRefId: FOOD_ID,
            quantity: 2,
            unit: 'cup',
        });

        expect(spaced.verificationKey).toBe(row.verificationKey);
    });

    it('moves the key with the food, the quantity and the unit', () => {
        const other = (over: Partial<Parameters<typeof needsReviewVerdictFor>[0]>): string =>
            needsReviewVerdictFor({
                sourceLine: '2 cups chicken stock',
                foodRefId: FOOD_ID,
                quantity: 2,
                unit: 'cup',
                ...over,
            }).verificationKey;

        expect(other({ foodRefId: 'food_other' })).not.toBe(row.verificationKey);
        expect(other({ quantity: 3 })).not.toBe(row.verificationKey);
        expect(other({ unit: 'tbsp' })).not.toBe(row.verificationKey);
    });

    /**
     * NEEDS_REVIEW vs AMBIGUOUS: `resolveLineStatus` answers AMBIGUOUS for a contradicted band when identity reads
     * `contradict` (aspects include identity, itemised identity verdict `disagree`, certainty high). A quantity-only dispute
     * keeps NEEDS_REVIEW, which is the status this flow exists to open.
     */
    it('is a contradicted, high-certainty QUANTITY disagreement that never asked about identity', () => {
        expect(row).toMatchObject({
            verdict: 'disagree',
            certainty: 'high',
            band: 'contradicted',
            aspects: ['quantity'],
            identityVerdict: null,
            quantityVerdict: 'disagree',
            foodId: FOOD_ID,
            foodVariantId: null,
            modelId: NEEDS_REVIEW_SEED_MODEL_ID,
        });
    });

    it('names exactly one food, as the table requires', () => {
        expect([row.foodId, row.foodVariantId].filter((id) => id !== null)).toHaveLength(1);
    });
});

describe('ensureNeedsReviewProbe', () => {
    const created = (id: string, name: string): CreateAuthoredFoodResult => ({
        kind: 'created',
        food: {
            id,
            name,
            description: null,
            kind: 'authored',
            status: 'RESOLVED',
            nutrients: [],
            portions: [],
            provenance: {},
            visibility: 'private',
            variants: [],
        },
    });
    const binding = (over: Record<string, unknown> = {}) => ({
        id: BINDING,
        name: FOOD_NAME,
        foodId: FOOD_ID,
        foodResolutionStatus: 'RESOLVED',
        isUserEntered: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...over,
    });

    function world(
        reads: readonly (readonly { resolutionStatus?: string }[])[],
        bound: Record<string, unknown> = binding(),
    ) {
        const order: string[] = [];
        const food = {
            createAuthoredFood: vi.fn(async (): Promise<CreateAuthoredFoodResult> => {
                order.push('food');

                return created('food_authored', FOOD_NAME);
            }),
        };
        const client = createFakeRecipeServiceClient();
        let read = 0;
        const spies = {
            byFood: vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(bound as never),
            create: vi.spyOn(client, 'createRecipe').mockImplementation(async () => {
                order.push('create');

                return { id: 'probe_1' } as never;
            }),
            get: vi.spyOn(client, 'getRecipeById').mockImplementation(async () => {
                order.push('read');
                const lines = reads[Math.min(read, reads.length - 1)] ?? [];
                read += 1;

                return { id: 'probe_1', ingredients: lines } as never;
            }),
        };
        const rows: SeedVerdictRow[] = [];
        const store: SeedVerdictStore = {
            replaceSeedVerdict: vi.fn(async (row: SeedVerdictRow) => {
                order.push('store');
                rows.push(row);
            }),
        };

        return { clients: { food, recipe: client }, store, spies, rows, order, food };
    }

    const NEEDS_REVIEW = [{ resolutionStatus: 'NEEDS_REVIEW' }];

    it('creates the recipe bound to the authored food with its source line, THEN stores the verdict, THEN reads it back', async () => {
        const { clients, store, spies, order } = world([NEEDS_REVIEW]);

        await expect(ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME)).resolves.toBe('probe_1');

        const request = spies.create.mock.calls[0]?.[0];

        expect(request?.title).toBe(probe.title);
        expect(request?.visibility).toBe('private');
        expect(request?.ingredients).toHaveLength(1);
        expect(request?.ingredients[0]).toMatchObject({ ingredientId: BINDING, sourceLine: line.sourceLine });
        expect(order).toEqual(['food', 'create', 'store', 'read']);
    });

    it('⛔ keys the verdict to the FOOD SERVICE id the binding carries, not the binding id', async () => {
        const { clients, store, rows } = world([NEEDS_REVIEW]);

        await ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.foodId).toBe(FOOD_ID);
        expect(rows[0]).toEqual(
            needsReviewVerdictFor({
                sourceLine: line.sourceLine ?? '',
                foodRefId: FOOD_ID,
                quantity: line.quantity,
                unit: line.unit ?? '',
            }),
        );
        expect(rows[0]?.foodId).not.toBe(BINDING);
    });

    it('⛔ fails, naming what the line read, when the verdict does not take effect (a key the read does not find)', async () => {
        const { clients, store } = world([[{ resolutionStatus: 'RESOLVED' }]]);

        await expect(ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME)).rejects.toThrow(
            /NEEDS_REVIEW.*RESOLVED/su,
        );
    });

    it('⛔ fails when the line reads AMBIGUOUS, which would open the pick surface instead of the row editor', async () => {
        const { clients, store } = world([[{ resolutionStatus: 'AMBIGUOUS' }]]);

        await expect(ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME)).rejects.toThrow(/AMBIGUOUS/u);
    });

    it('fails when the recipe came back with no lines', async () => {
        const { clients, store } = world([[]]);

        await expect(ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME)).rejects.toThrow(/no lines/u);
    });

    it('⛔ stores no verdict for a food that is not a food, and creates no recipe', async () => {
        const { clients, store, spies } = world([NEEDS_REVIEW], binding({ foodId: undefined }));

        await expect(ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME)).rejects.toThrow(/food id/u);

        expect(spies.create).not.toHaveBeenCalled();
        expect(store.replaceSeedVerdict).not.toHaveBeenCalled();
    });

    it('does not store a verdict when the recipe could not be created', async () => {
        const { clients, store, spies } = world([NEEDS_REVIEW]);
        spies.create.mockRejectedValueOnce(new Error('create refused'));

        await expect(ensureNeedsReviewProbe(clients, store, probe, FOOD_NAME)).rejects.toThrow('create refused');

        expect(store.replaceSeedVerdict).not.toHaveBeenCalled();
    });
});
