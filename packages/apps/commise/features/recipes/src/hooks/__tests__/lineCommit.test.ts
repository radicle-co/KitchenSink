/**
 * Unit tests for `commitRouteFor` (`../lineCommit.ts`) — the ONE decision of whether a pick on an ingredient row
 * goes through the rebind COMMAND or stays a DRAFT transition — and for `lineBindingOf`, the binding a draft re-point
 * carries.
 *
 * ⛔ WHY BOTH DIRECTIONS MATTER. ADR-0045 (lines 265-269): an ordinary save records no correction, so re-pointing a
 * line the server already stores teaches only through the rebind command (plan 002 R17). Route a persisted line to
 * the draft and the correction is silently never recorded; route a line the server does not store to the command and
 * the command re-points whatever line happens to sit at that position. The table is pick kind × target, with the
 * stored position checked on every command answer — the position is the half that re-points the wrong line.
 *
 * And for `toIngredientLine`, the projection of an admitted ingredient onto the resolved line the draft route appends.
 */
import { ABSENT_QUANTITY, FoodResolutionStatus, type Ingredient } from '@kitchensink/recipe-core';
import { makeIngredient, makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { mintedLineKey, persistedLineKeysOf, seedLineKey } from '../../form/lineKey.js';
import { foodRefOf } from '../../form/nutritionLookup.js';
import { draftQuantity } from '../../form/quantity.js';
import type { RecipeFormIngredient } from '../../form/values.js';
import {
    commitRouteFor,
    lineBindingOf,
    onceLineCommand,
    toIngredientLine,
    type IngredientPick,
    type LineCommitTarget,
} from '../lineCommit.js';

const stored = [
    { key: seedLineKey(5, 0), ingredientId: null },
    { key: seedLineKey(5, 1), ingredientId: 'ing_a' },
    { key: seedLineKey(5, 2), ingredientId: 'ing_b' },
];
const persistedKeys = persistedLineKeysOf(stored);

const PERSISTED: LineCommitTarget = { kind: 'line', key: seedLineKey(5, 2) };
const UNSAVED_NO_FOOD: LineCommitTarget = { kind: 'line', key: seedLineKey(5, 0) };
const APPENDED_THIS_SESSION: LineCommitTarget = { kind: 'line', key: mintedLineKey('appended') };
const NEW_LINE: LineCommitTarget = { kind: 'newLine' };

const VARIANT = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat' }] };

const catalogFood: IngredientPick = { kind: 'catalogFood', foodId: 'food_9', name: 'Lacinato kale' };
const catalogVariant: IngredientPick = { kind: 'catalogVariant', foodVariantId: 'var_flat' };
const name: IngredientPick = { kind: 'name', text: 'cavolo nero' };
const declared: IngredientPick = { kind: 'declared', text: 'my aunt’s spice mix' };

describe('commitRouteFor', () => {
    it.each([
        // A persisted line re-pointed to a food or a name: the command, at the STORED position (2 → 1, because the
        // no-food line above it is never sent and so never stored).
        {
            pick: catalogFood,
            target: PERSISTED,
            expected: { route: 'command', position: 1, target: { kind: 'catalogFood', foodId: 'food_9' } },
        },
        // A details-dialog variant (blueprint decision 7): the command's own `catalogVariant` arm.
        {
            pick: catalogVariant,
            target: PERSISTED,
            expected: { route: 'command', position: 1, target: { kind: 'catalogVariant', foodVariantId: 'var_flat' } },
        },
        {
            pick: name,
            target: PERSISTED,
            expected: { route: 'command', position: 1, target: { kind: 'name', name: 'cavolo nero' } },
        },
        // A declaration has no rebind target: always the draft.
        { pick: declared, target: PERSISTED, expected: { route: 'draft' } },
        // Lines the server does not store: always the draft, whatever the pick.
        ...[catalogFood, catalogVariant, name, declared].flatMap((pick) => [
            { pick, target: UNSAVED_NO_FOOD, expected: { route: 'draft' } },
            { pick, target: APPENDED_THIS_SESSION, expected: { route: 'draft' } },
            { pick, target: NEW_LINE, expected: { route: 'draft' } },
        ]),
    ] as const)('$pick.kind on $target.kind $target.key → $expected.route', ({ pick, target, expected }) => {
        expect(commitRouteFor(pick, target, persistedKeys)).toEqual(expected);
    });

    it('reads the PERSISTED keys, not the draft: a create form (nothing persisted) never reaches the command', () => {
        expect(commitRouteFor(catalogFood, PERSISTED, [])).toEqual({ route: 'draft' });
    });
});

describe('lineBindingOf', () => {
    it('takes exactly the binding half of a line: nothing the cook wrote, no key', () => {
        const line: RecipeFormIngredient & { readonly ingredientId: string } = {
            key: seedLineKey(5, 1),
            ingredientId: 'ing_a',
            name: 'Brisket',
            isUserEntered: false,
            resolutionStatus: 'UNRESOLVED',
            unresolvedReason: 'several_candidates',
            foodId: 'food_brisket',
            variant: VARIANT,
            quantity: 2,
            quantityHigh: 3,
            unit: 'lb',
            notes: 'trimmed',
            preparation: 'cubed',
            groupLabel: 'For the braise',
            userCalories: 400,
        };

        expect(lineBindingOf(line)).toStrictEqual({
            ingredientId: 'ing_a',
            name: 'Brisket',
            isUserEntered: false,
            resolutionStatus: 'UNRESOLVED',
            unresolvedReason: 'several_candidates',
            foodId: 'food_brisket',
            variant: VARIANT,
        });
    });

    it('omits what the line does not state, rather than carrying `undefined` keys', () => {
        const binding = lineBindingOf({ ingredientId: 'ing_free', isUserEntered: true, quantity: 1 });

        expect(binding).toStrictEqual({ ingredientId: 'ing_free', isUserEntered: true });
        expect(Object.keys(binding)).toEqual(['ingredientId', 'isUserEntered']);
    });
});

/**
 * A queued rebind command goes on the wire ONCE and is adopted ONCE, however often the effect that sends it runs
 * (staff-architect REVIEW M1: a second POST at the same version meets a 409 against the editor's own write).
 */
describe('onceLineCommand', () => {
    const address = { recipeId: 'rec_1', position: 1, expectedVersion: 3 };

    it('sends once: a second send answers with the first send’s answer', async () => {
        const send = vi.fn(async () => makeRecipeDetail());
        const command = onceLineCommand(seedLineKey(3, 1), send, () => undefined);

        const first = command.send(address);
        const second = command.send({ ...address, expectedVersion: 4 });

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(address);
        expect(second).toBe(first);
    });

    it('is claimed once, so its answer is adopted once', () => {
        const command = onceLineCommand(seedLineKey(3, 1), vi.fn(), () => undefined);

        expect(command.claim()).toBe(true);
        expect(command.claim()).toBe(false);
    });
});

describe('toIngredientLine', () => {
    /**
     * REWRITTEN for slice 7 (build spec F5): a picked row used to arrive with an invented quantity of 1, which the cook
     * never stated and the recipe then published. It now states no amount — the draft's spelling of absent is `NaN`,
     * the same one `toRecipeFormValues` seeds a stored amount-less line with — and the wire reads it as `absent`.
     */
    it('projects a catalog ingredient onto a form line stating NO amount (F5: never an invented 1)', () => {
        const ingredient = makeIngredient({
            id: 'ing_9',
            name: 'Olive oil',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });

        // EDITED for curated U15: the fixture's food (`food_1`) travels as the line's root food, from which the
        // nutrition ref is derived (`foodRefOf`).
        expect(toIngredientLine(ingredient)).toEqual({
            isUserEntered: false,
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: Number.NaN,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
            foodId: 'food_1',
        });
        expect(draftQuantity({ ...toIngredientLine(ingredient), key: seedLineKey(1, 0) })).toEqual(ABSENT_QUANTITY);
    });

    it('omits resolutionStatus entirely when the catalog row carries none', () => {
        const ingredient: Ingredient = {
            id: 'ing_free',
            name: 'Grandma’s spice mix',
            isUserEntered: true,
            createdAt: '2026-04-01T09:00:00.000Z',
        };

        // ⛔ `true` — the fixture IS a freeform ingredient, and this is the member that carries that fact
        // onto the form line. Before it existed the editor could not tell this line from a food-backed one.
        expect(toIngredientLine(ingredient)).toEqual({
            isUserEntered: true,
            ingredientId: 'ing_free',
            name: 'Grandma’s spice mix',
            quantity: Number.NaN,
        });
        expect('resolutionStatus' in toIngredientLine(ingredient)).toBe(false);
    });

    /**
     * REWRITTEN for plan 002 V1 B5: the line used to carry the pick's per-100 g figures and portions, which no OPENED
     * recipe ever had, so the total disagreed between a fresh pick and a reload. Nutrition no longer enters the draft:
     * the line carries the food REF, and the editor's one background read supplies the figures.
     */
    it('carries the food REF, and never the figures, onto the form line (B5)', () => {
        const ingredient = makeIngredient({
            id: 'ing_9',
            name: 'Olive oil',
            foodId: 'food_oil',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            caloriesPer100g: 884,
            fatGPer100g: 100,
            portions: [{ unit: 'tablespoon', gramsPerUnit: 13.5 }],
        });

        expect(toIngredientLine(ingredient)).toEqual({
            isUserEntered: false,
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: Number.NaN,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
            foodId: 'food_oil',
        });
    });

    /**
     * Curated U15: a picked VARIANT keeps its variant on the line, so the row shows its dotted line and the nutrition
     * read asks for the variant's figures. Before this the line carried only the root, and a variant pick read the
     * root's numbers.
     */
    it('keeps a picked VARIANT and its root, so the line reads the variant’s numbers', () => {
        const variant = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };
        const line = toIngredientLine(
            makeIngredient({ id: 'ing_b', name: 'Beef brisket', foodId: 'food_brisket', variant }),
        );

        expect(line).toMatchObject({ foodId: 'food_brisket', variant });
        expect(foodRefOf(line)).toEqual({ kind: 'variant', id: 'var_flat' });
    });

    it('omits every nutrition field when the catalog row carries none (still resolving, or genuinely absent)', () => {
        const ingredient: Ingredient = {
            id: 'ing_10',
            name: 'Sourdough starter',
            isUserEntered: true,
            createdAt: '2026-04-01T09:00:00.000Z',
        };

        const line = toIngredientLine(ingredient);

        expect(line).toEqual({
            isUserEntered: true,
            ingredientId: 'ing_10',
            name: 'Sourdough starter',
            quantity: Number.NaN,
        });
        expect('caloriesPer100g' in line).toBe(false);
        expect('proteinGPer100g' in line).toBe(false);
        expect('carbsGPer100g' in line).toBe(false);
        expect('fatGPer100g' in line).toBe(false);
        expect('portions' in line).toBe(false);
    });
});
