/**
 * `toIngredient` — the picker's `Ingredient` wire shape, projected from a line identity (plan 002 U7).
 *
 * The shape is unchanged for the apps: `id` is now the binding (lookup) id, `foodId` appears on a root binding
 * only, and the status and user-entered flag are derived from the binding, never stored.
 */
import { describe, expect, it } from 'vitest';

import type { FoodLookupArm, UnresolvedArm } from '../../database/schema/foodLookupArm.js';
import type { IngredientLineIdentity } from '../domain/ingredientLineIdentity.js';
import { toIngredient } from '../ingredientProjection.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l1', foodId: 'food-1', foodOwnerId: null, createdAt: AT };

function unresolved(reasonCode: UnresolvedArm['failure']['reasonCode']): UnresolvedArm {
    return {
        kind: 'unresolved',
        lookupId: 'l2',
        createdAt: AT,
        failure: {
            unresolvedFoodId: 'f1',
            name: 'nutritional yeast',
            normalizedKey: 'nutritional yeast',
            reasonCode,
            status: reasonCode === 'awaiting_source' ? 'PENDING' : 'UNRESOLVED',
            foodHandleId: reasonCode === 'awaiting_source' ? 'food-9' : null,
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
        },
    };
}

describe('toIngredient', () => {
    it('projects a root binding as a resolved, food-backed ingredient', () => {
        const identity: IngredientLineIdentity = { arm: ROOT, name: 'beef brisket', presence: 'present' };

        expect(toIngredient(identity)).toStrictEqual({
            id: 'l1',
            name: 'beef brisket',
            foodId: 'food-1',
            foodResolutionStatus: 'RESOLVED',
            isUserEntered: false,
            createdAt: AT.toISOString(),
        });
    });

    it('projects a pending failure with its status and no food id', () => {
        const identity: IngredientLineIdentity = {
            arm: unresolved('awaiting_source'),
            name: 'nutritional yeast',
            presence: 'unbound',
        };

        expect(toIngredient(identity)).toStrictEqual({
            id: 'l2',
            name: 'nutritional yeast',
            foodResolutionStatus: 'PENDING',
            isUserEntered: false,
            createdAt: AT.toISOString(),
        });
    });

    it('projects a declared name as user-entered with no status — nothing is resolving', () => {
        const identity: IngredientLineIdentity = {
            arm: unresolved('author_declared'),
            name: 'nutritional yeast',
            presence: 'unbound',
        };

        expect(toIngredient(identity)).toStrictEqual({
            id: 'l2',
            name: 'nutritional yeast',
            isUserEntered: true,
            createdAt: AT.toISOString(),
        });
    });

    it('⛔ refuses a binding with no name to show — the picker has no nameless state', () => {
        expect(() => toIngredient({ arm: ROOT, name: undefined, presence: 'unreachable' })).toThrow();
    });
});
