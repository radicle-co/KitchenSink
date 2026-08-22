/**
 * Unit tests for the PRE-U8 version-snapshot upgrade (U8, ADR-0022 expand-first).
 *
 * ## The failure this prevents, stated concretely
 *
 * `recipe_versions.snapshot` is JSONB frozen when its version was cut, and a version is IMMUTABLE by
 * design — no migration will ever rewrite one. Every row written before U8 spells a line's quantity as a
 * bare number (`"quantity": 2`); every row written after spells it as the value object. The published wire
 * schema admits exactly ONE of those, so without this upgrade `recipeVersionSchema.parse` would reject
 * every historical version client-side and the whole version-history screen would fall to its error state
 * with no server-side error to show for it. That is not hypothetical — this repo shipped the identical
 * failure once already, from a `min(1)` on `unit`.
 *
 * ## Why it NORMALIZES rather than PARSES
 *
 * The call site it replaces was `row.snapshot as RecipeSnapshot` — an unchecked cast, i.e. "trust the
 * blob". Escalating that to a full `recipeSnapshotSchema.parse` would turn any stored shape that does not
 * match TODAY's schema into a 500 on a read, for snapshots nobody can fix. This function changes exactly
 * the one field whose stored representation U8 knowingly changed, and carries everything else through.
 */
import { describe, expect, it } from 'vitest';

import { upgradeStoredSnapshot } from '../snapshotUpgrade.js';

/** A stored snapshot blob with one ingredient line whose quantity is whatever the caller passes. */
const storedSnapshot = (quantity: unknown): unknown => ({
    version: 3,
    title: 'Mediterranean Grilled Lamb',
    description: 'Herb-marinated grilled lamb.',
    servings: 4,
    prepTimeMinutes: 15,
    cookTimeMinutes: 30,
    steps: [{ id: 's1', recipeId: 'r1', stepNumber: 1, instruction: 'Marinate.' }],
    ingredients: [
        {
            id: 'i1',
            recipeId: 'r1',
            ingredientId: 'ing1',
            quantity,
            unit: 'cup',
            sortOrder: 0,
            ingredientName: 'Flour',
            isUserEntered: false,
            userCalories: 12,
        },
    ],
});

/** The upgraded snapshot's one ingredient line. */
const lineOf = (stored: unknown): Record<string, unknown> =>
    upgradeStoredSnapshot(stored).ingredients[0] as unknown as Record<string, unknown>;

describe('upgradeStoredSnapshot', () => {
    it('upgrades a PRE-U8 bare number to the canonical `exact` member', () => {
        expect(lineOf(storedSnapshot(2))['quantity']).toEqual({ kind: 'exact', value: 2 });
    });

    it('upgrades a fractional bare number without disturbing its precision', () => {
        expect(lineOf(storedSnapshot(0.125))['quantity']).toEqual({ kind: 'exact', value: 0.125 });
    });

    it('leaves a POST-U8 quantity exactly as stored, in every member', () => {
        expect(lineOf(storedSnapshot({ kind: 'exact', value: 2 }))['quantity']).toEqual({ kind: 'exact', value: 2 });
        expect(lineOf(storedSnapshot({ kind: 'range', low: 2, high: 3 }))['quantity']).toEqual({
            kind: 'range',
            low: 2,
            high: 3,
        });
        expect(lineOf(storedSnapshot({ kind: 'absent' }))['quantity']).toEqual({ kind: 'absent' });
    });

    it('carries every other field of the line through untouched', () => {
        const line = lineOf(storedSnapshot(2));

        expect(line).toEqual({
            id: 'i1',
            recipeId: 'r1',
            ingredientId: 'ing1',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            sortOrder: 0,
            ingredientName: 'Flour',
            isUserEntered: false,
            userCalories: 12,
        });
    });

    it('carries the snapshot’s own fields through untouched', () => {
        const upgraded = upgradeStoredSnapshot(storedSnapshot(2));

        expect(upgraded.title).toBe('Mediterranean Grilled Lamb');
        expect(upgraded.servings).toBe(4);
        expect(upgraded.steps).toHaveLength(1);
    });

    it('does not mutate the stored blob it was handed', () => {
        const stored = storedSnapshot(2) as { ingredients: { quantity: unknown }[] };

        upgradeStoredSnapshot(stored);

        expect(stored.ingredients[0]?.quantity).toBe(2);
    });

    // ⛔ NOT a validator. A blob whose shape this function does not recognise is carried through, exactly as
    // the unchecked cast it replaces did — escalating to a throw here would turn an unreadable historical
    // snapshot into a 500 on a GET, for data nobody can repair.
    it('carries an unrecognised snapshot through rather than throwing', () => {
        expect(() => upgradeStoredSnapshot({})).not.toThrow();
        expect(() => upgradeStoredSnapshot(null)).not.toThrow();
        expect(() => upgradeStoredSnapshot({ ingredients: 'not an array' })).not.toThrow();
    });

    // A `0` was never a legal stored quantity (the column's CHECK refused it), so nothing here has to
    // decide whether it means "zero" or "absent". Carrying it through unchanged keeps that ambiguity out of
    // this function: the wire schema is what refuses it, in one place.
    it('does not invent a member for a value that was never a legal stored quantity', () => {
        expect(lineOf(storedSnapshot(0))['quantity']).toBe(0);
        expect(lineOf(storedSnapshot(null))['quantity']).toBeNull();
    });
});
