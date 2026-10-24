/**
 * `VersionLineRestorer` — turns a snapshot's lines into the lines a restore writes (plan 002 R52).
 *
 * The per-line decision is the pure `decideRestoreLine` (its own table test). What this file pins is the I/O
 * around it: the bindings are read once, a name is resolved once however many lines carry it, and an
 * unrestorable line refuses the whole restore BEFORE anything is written.
 */
import { describe, expect, it, vi } from 'vitest';
import { RecipeErrorCode, type RecipeIngredient } from '@kitchensink/recipe-core';

import type { FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { IngredientLineIdentity } from '../../ingredients/domain/ingredientLineIdentity.js';
import type { IngredientsService } from '../../ingredients/ingredients.service.js';
import type { LineIdentityReader } from '../../ingredients/lineIdentity.reader.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import { VersionLineRestorer } from '../versionLine.restorer.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const USER = '01JRESTORER00000000000000A';
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l-root', foodId: 'food-1', foodOwnerId: null, createdAt: AT };

function snapshotLine(over: Partial<RecipeIngredient>): RecipeIngredient {
    return {
        id: 'line-1',
        recipeId: 'recipe-1',
        ingredientId: 'l-root',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        sortOrder: 0,
        isUserEntered: false,
        ...over,
    };
}

function build(identities: ReadonlyMap<string, IngredientLineIdentity>) {
    const identify = vi.fn().mockResolvedValue(identities);
    const addByName = vi.fn((_caller: unknown, name: string) => Promise.resolve({ id: `by-name:${name}` }));
    const createFreeform = vi.fn((name: string) => Promise.resolve({ id: `declared:${name}` }));

    return {
        restorer: new VersionLineRestorer(
            { identify } as unknown as LineIdentityReader,
            { addByName, createFreeform } as unknown as IngredientsService,
        ),
        identify,
        addByName,
        createFreeform,
    };
}

describe('VersionLineRestorer.restoreLines', () => {
    it('reuses a live binding and carries every fact about the line, never a name', async () => {
        const { restorer, identify, addByName } = build(
            new Map<string, IngredientLineIdentity>([
                ['l-root', { arm: ROOT, name: 'Beef brisket', presence: 'present', food: { rootId: ROOT.foodId } }],
            ]),
        );

        const lines = await restorer.restoreLines(undefined, USER, [
            snapshotLine({
                ingredientName: 'Beef brisket',
                displayText: 'trimmed',
                preparation: 'sliced',
                groupLabel: 'Meat',
                userCalories: 40,
            }),
        ]);

        expect(identify).toHaveBeenCalledWith(undefined, ['l-root'], 'postCommit');
        expect(addByName).not.toHaveBeenCalled();
        expect(lines).toStrictEqual([
            {
                ingredientId: 'l-root',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                notes: 'trimmed',
                preparation: 'sliced',
                groupLabel: 'Meat',
                userCalories: 40,
            },
        ]);
    });

    it('⛔ OMITS a preparation, section and notes the snapshot did not carry, rather than restoring `""`', async () => {
        // A restore that cannot carry a field silently strips it; one that invents `""` restores a value the cook
        // never wrote. Both fields sit on the BASE request schema (U26/U27) precisely so a restore can carry them.
        const { restorer } = build(
            new Map<string, IngredientLineIdentity>([
                ['l-root', { arm: ROOT, name: 'Beef brisket', presence: 'present', food: { rootId: ROOT.foodId } }],
            ]),
        );

        const [line] = await restorer.restoreLines(undefined, USER, [snapshotLine({})]);

        expect(line).not.toHaveProperty('preparation');
        expect(line).not.toHaveProperty('groupLabel');
        expect(line).not.toHaveProperty('notes');
    });

    it('resolves a name ONCE however many lines carry it, and declares a declared line again', async () => {
        const { restorer, addByName, createFreeform } = build(new Map());

        const lines = await restorer.restoreLines(undefined, USER, [
            snapshotLine({ ingredientId: 'l-gone-1', ingredientName: 'Beef brisket' }),
            snapshotLine({ ingredientId: 'l-gone-2', ingredientName: 'Beef brisket', sortOrder: 1 }),
            snapshotLine({ ingredientId: 'l-gone-3', ingredientName: 'Yuzu kosho', isUserEntered: true, sortOrder: 2 }),
        ]);

        expect(addByName).toHaveBeenCalledTimes(1);
        expect(addByName).toHaveBeenCalledWith(undefined, 'Beef brisket', USER);
        expect(createFreeform).toHaveBeenCalledWith('Yuzu kosho');
        expect(lines.map((line) => line.ingredientId)).toStrictEqual([
            'by-name:Beef brisket',
            'by-name:Beef brisket',
            'declared:Yuzu kosho',
        ]);
    });

    it('⛔ refuses the whole restore with 409 VERSION_LINE_UNRESTORABLE, naming the positions, before any write', async () => {
        const { restorer, addByName, createFreeform } = build(new Map());

        const outcome = await restorer
            .restoreLines(undefined, USER, [
                snapshotLine({ ingredientId: 'l-gone-1', ingredientName: 'Beef brisket' }),
                snapshotLine({ ingredientId: 'l-gone-2', sortOrder: 1 }),
            ])
            .then(
                () => 'restored',
                (error: unknown) => error,
            );

        expect(isRecipeDomainError(outcome) && outcome.code).toBe(RecipeErrorCode.VERSION_LINE_UNRESTORABLE);
        expect(isRecipeDomainError(outcome) && outcome.details).toStrictEqual({ positions: [1] });
        expect(addByName).not.toHaveBeenCalled();
        expect(createFreeform).not.toHaveBeenCalled();
    });
});
