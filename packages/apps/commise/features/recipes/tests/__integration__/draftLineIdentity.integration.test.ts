/**
 * Integration: a draft line's identity through the whole draft pipeline (plan 002 V1, slices A and B).
 *
 * Composes the REAL seed adapter, the append transition with the real key minter, the stored-position map and the
 * wire projection, and checks the result against the PUBLISHED request schema (`@kitchensink/schema-recipe`) —
 * the one dependency a unit test of any single module mocks away. What it proves: the keys and food refs the editor
 * adds never reach the wire, the request still parses, and the stored-position map agrees with what was sent.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { createRecipeRequestSchema } from '@kitchensink/schema-recipe';

import { persistedLineKeysOf, storedPositionOf } from '../../src/form/lineKey.js';
import { mintLineKey } from '../../src/form/mintLineKey.js';
import { applyDraftAction } from '../../src/form/props.js';
import { toCreateRecipeInput, toRecipeFormValues } from '../../src/form/wire.js';

const ID = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;

describe('draft line identity, seed → append → wire (integration)', () => {
    const seeded = toRecipeFormValues(
        makeRecipeDetail({
            currentVersion: 4,
            ingredients: [
                {
                    ingredientId: ID(1),
                    foodId: ID(7),
                    name: 'Rice',
                    quantity: { kind: 'exact', value: 300 },
                    unit: 'g',
                    isUserEntered: false,
                    resolutionStatus: 'RESOLVED',
                },
                {
                    ingredientId: ID(2),
                    name: 'Kale',
                    quantity: { kind: 'exact', value: 1 },
                    isUserEntered: false,
                    resolutionStatus: 'NOT_FOUND',
                    unresolvedReason: 'no_source_has_it',
                },
            ],
        }),
    );
    const appended = applyDraftAction(seeded, {
        kind: 'appendResolvedIngredient',
        key: mintLineKey(),
        line: { ingredientId: ID(3), name: 'Leek', quantity: 2, isUserEntered: false },
    });

    it('gives every line a distinct key, and keeps the seeded ones', () => {
        const keys = appended.ingredients.map((line) => line.key);

        expect(new Set(keys).size).toBe(3);
        expect(keys.slice(0, 2)).toEqual(seeded.ingredients.map((line) => line.key));
    });

    it('sends a request the PUBLISHED schema accepts, carrying no key, food ref or reason', () => {
        const body = createRecipeRequestSchema.parse({ ...toCreateRecipeInput(appended), title: 'Bowl' });

        expect(body.ingredients).toHaveLength(3);

        for (const line of toCreateRecipeInput(appended).ingredients) {
            expect(line).not.toHaveProperty('key');
            expect(line).not.toHaveProperty('foodRef');
            expect(line).not.toHaveProperty('unresolvedReason');
        }
    });

    it('maps each stored line’s key to the position it is sent at, and an appended line to none', () => {
        const persisted = persistedLineKeysOf(seeded.ingredients);
        const sent = toCreateRecipeInput(seeded).ingredients.map((line) => line.ingredientId);

        seeded.ingredients.forEach((line) => {
            expect(sent[storedPositionOf(persisted, line.key) ?? -1]).toBe(line.ingredientId);
        });
        expect(storedPositionOf(persisted, appended.ingredients[2]?.key ?? seeded.ingredients[0]!.key)).toBeUndefined();
    });
});
