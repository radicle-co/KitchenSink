import { describe, expect, it } from 'vitest';

import { isChecked, reconcile, toggleIngredient } from '../controllers/IngredientCheckoffState.js';
import { isUnknownIngredientError } from '../errors.js';

/**
 * T-017 / MOD-019 — UTP-019-A..D.
 *
 * Covers FR-032a (REQ-012, REQ-013). Assertions are written to fail if the logic is subtly wrong,
 * not merely to execute it: purity, isolation of untouched ids, and the JSON round-trip that guards
 * the `Set`-serialization defect are each asserted explicitly.
 */

const RECIPE_IDS = ['i1', 'i2', 'i3'] as const;

describe('IngredientCheckoffState — UTP-019-A: toggle adds, removes, and isolates', () => {
    it('UTS-019-A1: adds an unchecked ingredient', () => {
        expect(toggleIngredient([], 'i1', RECIPE_IDS)).toEqual(['i1']);
    });

    it('UTS-019-A2: removes an already-checked ingredient', () => {
        expect(toggleIngredient(['i1'], 'i1', RECIPE_IDS)).toEqual([]);
    });

    it('UTS-019-A3: leaves every other ingredient untouched', () => {
        expect(toggleIngredient(['i1', 'i2'], 'i3', RECIPE_IDS)).toEqual(['i1', 'i2', 'i3']);
    });

    it('UTS-019-A4: does not mutate the input array (purity)', () => {
        const original = ['i1'];
        toggleIngredient(original, 'i2', RECIPE_IDS);
        expect(original).toEqual(['i1']);
    });
});

describe('IngredientCheckoffState — UTP-019-B: rejects unknown ingredients', () => {
    it('UTS-019-B1: throws UnknownIngredientError for an id absent from the recipe', () => {
        let thrown: unknown;
        try {
            toggleIngredient([], 'ghost', RECIPE_IDS);
        } catch (error) {
            thrown = error;
        }
        expect(isUnknownIngredientError(thrown)).toBe(true);
    });

    it('UTS-019-B2: throws UnknownIngredientError for an empty id rather than silently no-opping', () => {
        let thrown: unknown;
        try {
            toggleIngredient([], '', RECIPE_IDS);
        } catch (error) {
            thrown = error;
        }
        // Deliberately asserts the *specific* error: a bare `.toThrow()` would also pass against an
        // unimplemented stub or an unrelated crash, which is not evidence of correct behaviour.
        expect(isUnknownIngredientError(thrown)).toBe(true);
    });

    it('UTS-019-B2b: leaves state unchanged when the toggle is rejected', () => {
        const original = ['i1'];
        let thrown: unknown;
        try {
            toggleIngredient(original, 'ghost', RECIPE_IDS);
        } catch (error) {
            thrown = error;
        }
        expect(isUnknownIngredientError(thrown)).toBe(true);
        expect(original).toEqual(['i1']);
    });
});

describe('IngredientCheckoffState — UTP-019-C: reconcile drops ghost ids on restore', () => {
    it('UTS-019-C1: removes ids the recipe no longer contains', () => {
        expect(reconcile(['i1', 'i2'], ['i1'])).toEqual(['i1']);
    });

    it('UTS-019-C2: returns empty for empty state', () => {
        expect(reconcile([], ['i1'])).toEqual([]);
    });

    it('UTS-019-C3: preserves state when the recipe is unchanged', () => {
        expect(reconcile(['i1'], ['i1'])).toEqual(['i1']);
    });
});

describe('IngredientCheckoffState — UTP-019-D: query + serialization', () => {
    it('reports checked state via isChecked', () => {
        expect(isChecked(['i1'], 'i1')).toBe(true);
        expect(isChecked(['i1'], 'i2')).toBe(false);
    });

    it('UTS-019-D1: checked state survives a JSON round-trip (fails if it is ever a Set)', () => {
        const state = toggleIngredient(toggleIngredient([], 'i1', RECIPE_IDS), 'i2', RECIPE_IDS);
        expect(JSON.parse(JSON.stringify(state))).toEqual(['i1', 'i2']);
    });
});
