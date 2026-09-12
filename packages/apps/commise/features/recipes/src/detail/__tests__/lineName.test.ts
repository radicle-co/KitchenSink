/**
 * The one function that names a recipe line (plan 002 R9, R10; `docs/design/namelessLineCopy.md` §1).
 *
 * A line reaches the client with no name when the viewer may not see its food, when the food is gone, or when food
 * could not be asked. Every surface asks these functions for the text to show, so a missing name renders the same
 * stand-in everywhere and never the word "undefined".
 *
 * ⛔ The stand-in states the STATUS, never a guess at the food: nothing here reads the line's notes or preparation.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus, NAMELESS_LINE_STATUSES } from '@kitchensink/recipe-core';

import { makeIngredientView } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../versions/__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { BRISKET_FLAT_HALF_PARTS } from '../__fixtures__/variantLines.js';
import { isStandInName, lineDisplayName, snapshotLineName, variantPartTexts } from '../lineName.js';
import { lineSummary } from '../model.js';

const labels = recipeMessages.en.ingredientLineName;

describe('lineDisplayName', () => {
    it('returns the line’s own name whatever its status, including a withdrawn food that kept its name', () => {
        for (const status of Object.values(FoodResolutionStatus)) {
            expect(lineDisplayName({ name: 'Olive oil', resolutionStatus: status }, labels)).toBe('Olive oil');
        }
    });

    it('gives each nameless status its own stand-in', () => {
        expect(lineDisplayName({ resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE }, labels)).toBe(
            labels.privateFood,
        );
        expect(lineDisplayName({ resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }, labels)).toBe(
            labels.removedFood,
        );
        expect(lineDisplayName({ resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE }, labels)).toBe(
            labels.notLoaded,
        );
    });

    it('covers every nameless status with distinct, non-empty copy', () => {
        const standIns = NAMELESS_LINE_STATUSES.map((status) => lineDisplayName({ resolutionStatus: status }, labels));

        expect(new Set(standIns).size).toBe(NAMELESS_LINE_STATUSES.length);
        expect(standIns.every((standIn) => /\S/.test(standIn))).toBe(true);
    });

    it('⛔ never makes a name up from the line’s notes or preparation (R9: there is no fallback)', () => {
        const line = makeIngredientView({
            name: undefined,
            notes: 'the good one from the market',
            preparation: 'finely chopped',
            resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
        });

        expect(lineDisplayName(line, labels)).toBe(labels.notLoaded);
    });

    it('⛔ never says "removed" or "private" for an outage (R2)', () => {
        const standIn = lineDisplayName({ resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE }, labels);

        expect(standIn).not.toBe(labels.removedFood);
        expect(standIn).not.toBe(labels.privateFood);
    });

    it('returns the empty string for a draft line that has no name yet and is not nameless by status', () => {
        expect(lineDisplayName({ resolutionStatus: FoodResolutionStatus.PENDING }, labels)).toBe('');
        expect(lineDisplayName({}, labels)).toBe('');
    });
});

describe('isStandInName', () => {
    it('is true exactly when the line has no name and a nameless status', () => {
        for (const status of Object.values(FoodResolutionStatus)) {
            const nameless = (NAMELESS_LINE_STATUSES as readonly string[]).includes(status);

            expect(isStandInName({ resolutionStatus: status })).toBe(nameless);
            expect(isStandInName({ name: 'Olive oil', resolutionStatus: status })).toBe(false);
        }
    });

    it('agrees with lineDisplayName: a stand-in is one of the stand-in labels', () => {
        for (const status of NAMELESS_LINE_STATUSES) {
            expect(Object.values(labels)).toContain(lineDisplayName({ resolutionStatus: status }, labels));
        }
    });
});

describe('snapshotLineName', () => {
    it('returns the name the version froze', () => {
        expect(snapshotLineName(makeIngredient({ ingredientName: 'Pasta' }), labels)).toBe('Pasta');
    });

    it('says the version saved no name when it froze none', () => {
        expect(snapshotLineName(makeIngredient({ ingredientName: undefined }), labels)).toBe(labels.notSavedInVersion);
    });
});

describe('lineSummary', () => {
    it('joins the quantity and the name — the row’s accessible name (D1)', () => {
        const line = makeIngredientView({ name: 'Olive oil', quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' });

        expect(lineSummary(line, 'en', labels)).toBe('2 tbsp Olive oil');
    });

    it('⛔ uses the stand-in on a nameless line, never the word "undefined"', () => {
        const line = makeIngredientView({
            name: undefined,
            quantity: { kind: 'exact', value: 2 },
            unit: 'tbsp',
            resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        });

        expect(lineSummary(line, 'en', labels)).toBe(`2 tbsp ${labels.privateFood}`);
    });

    it('does not start with a space when the line states no amount and no unit (R40)', () => {
        const line = makeIngredientView({ name: 'Salt', quantity: { kind: 'absent' }, unit: undefined });

        expect(lineSummary(line, 'en', labels)).toBe('Salt');
    });
});

describe('variantPartTexts (curated U15)', () => {
    it('gives the parts’ text in wire order', () => {
        expect(variantPartTexts(BRISKET_FLAT_HALF_PARTS)).toEqual([
            'flat half',
            'separable lean and fat',
            '1/8-inch trim',
            'select',
            'braised',
        ]);
    });

    it('gives nothing for a root-bound line, absent or empty (R28)', () => {
        expect(variantPartTexts(undefined)).toBeUndefined();
        expect(variantPartTexts([])).toBeUndefined();
    });
});
