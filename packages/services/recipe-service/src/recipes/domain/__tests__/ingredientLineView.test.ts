/**
 * `ingredientLineView` — what one recipe line shows on the detail wire (plan 002 R9, R46, R47, R6).
 *
 * The composer takes the line's identity and its FINAL status (after the viewer overlay) and decides what the
 * wire may carry: a stranger never learns a private food's name or id, a nameless line always carries a status
 * that says why, and only an unresolved line carries a reason code.
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { FoodLookupArm, UnresolvedArm } from '../../../database/schema/foodLookupArm.js';
import type { IngredientLineIdentity } from '../../../ingredients/domain/ingredientLineIdentity.js';
import { composeIngredientLineView } from '../ingredientLineView.js';
import { ingredientNamesText } from '../ingredientNamesText.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l1', foodId: 'food-1', foodOwnerId: 'author-1', createdAt: AT };

function unresolvedArm(reasonCode: UnresolvedArm['failure']['reasonCode']): UnresolvedArm {
    return {
        kind: 'unresolved',
        lookupId: 'l2',
        createdAt: AT,
        failure: {
            unresolvedFoodId: 'f1',
            name: 'nutritional yeast',
            normalizedKey: 'nutritional yeast',
            reasonCode,
            status: reasonCode === 'author_declared' ? 'UNRESOLVED' : 'NOT_FOUND',
            foodHandleId: null,
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
        },
    };
}

const named: IngredientLineIdentity = { arm: ROOT, name: 'beef brisket', presence: 'present' };

describe('composeIngredientLineView', () => {
    it('carries the name and the root food id for a line the viewer may see', () => {
        expect(composeIngredientLineView(named, undefined)).toStrictEqual({
            name: 'beef brisket',
            foodId: 'food-1',
            isUserEntered: false,
        });
    });

    it('⛔ strips the name AND the food id when the viewer may not see the food', () => {
        expect(composeIngredientLineView(named, FoodResolutionStatus.RESOLVED_UNAVAILABLE)).toStrictEqual({
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        });
    });

    it('emits a nameless line only under a status that says why', () => {
        const gone: IngredientLineIdentity = { arm: ROOT, name: undefined, presence: 'gone' };

        expect(composeIngredientLineView(gone, FoodResolutionStatus.FOOD_REMOVED)).toStrictEqual({
            foodId: 'food-1',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.FOOD_REMOVED,
        });
    });

    it('⛔ refuses to emit a nameless line under any other status — that would be a lie on the wire', () => {
        const down: IngredientLineIdentity = { arm: ROOT, name: undefined, presence: 'unreachable' };

        expect(() => composeIngredientLineView(down, FoodResolutionStatus.RESOLVED)).toThrow();
        expect(() => composeIngredientLineView(down, undefined)).toThrow();
    });

    it('carries an unresolved line’s reason code and name, and no food id', () => {
        const identity: IngredientLineIdentity = {
            arm: unresolvedArm('no_source_has_it'),
            name: 'nutritional yeast',
            presence: 'unbound',
        };

        expect(composeIngredientLineView(identity, FoodResolutionStatus.NOT_FOUND)).toStrictEqual({
            name: 'nutritional yeast',
            unresolvedReason: 'no_source_has_it',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.NOT_FOUND,
        });
    });

    it('marks a declared line as the cook’s own', () => {
        const identity: IngredientLineIdentity = {
            arm: unresolvedArm('author_declared'),
            name: 'nutritional yeast',
            presence: 'unbound',
        };

        expect(composeIngredientLineView(identity, undefined)).toMatchObject({
            isUserEntered: true,
            unresolvedReason: 'author_declared',
        });
    });
});

describe('ingredientNamesText — the search column, from the names the lines have', () => {
    const SHARED: FoodLookupArm = { kind: 'root', lookupId: 'l3', foodId: 'food-3', foodOwnerId: null, createdAt: AT };
    const brisket: IngredientLineIdentity = { arm: SHARED, name: 'beef brisket', presence: 'present' };
    const nameless: IngredientLineIdentity = { arm: SHARED, name: undefined, presence: 'unreachable' };
    const yeast: IngredientLineIdentity = {
        arm: unresolvedArm('no_source_has_it'),
        name: ' nutritional yeast ',
        presence: 'unbound',
    };
    const identities = new Map([
        ['brisket', brisket],
        ['nameless', nameless],
        ['yeast', yeast],
        ['private', named],
    ]);

    it('joins the named lines in order and skips a nameless one — with the positive control on the same call', () => {
        expect(ingredientNamesText(['brisket', 'nameless', 'yeast'], identities)).toBe(
            'beef brisket nutritional yeast',
        );
    });

    it('follows the lines’ order, not the identities’', () => {
        expect(ingredientNamesText(['yeast', 'brisket'], identities)).toBe('nutritional yeast beef brisket');
    });

    it('skips a line whose binding has no identity', () => {
        expect(ingredientNamesText(['brisket', 'unknown-binding'], identities)).toBe('beef brisket');
    });

    it('⛔ leaves out a PRIVATE food’s name, which only its author may see — even when the author is saving', () => {
        // `named` is bound to a food private to `author-1`, and the saving author's own read names it.
        expect(ingredientNamesText(['private', 'brisket'], identities)).toBe('beef brisket');
    });

    it('is empty for no lines', () => {
        expect(ingredientNamesText([], identities)).toBe('');
    });
});
