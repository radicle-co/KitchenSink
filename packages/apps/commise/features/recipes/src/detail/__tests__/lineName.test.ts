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
import {
    ABSENT_QUANTITY,
    FoodResolutionStatus,
    NAMELESS_LINE_STATUSES,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';

import { makeIngredientView } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../versions/__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { BRISKET_FLAT_HALF_PARTS } from '../__fixtures__/variantLines.js';
import {
    isStandInName,
    lineAmountName,
    lineDisplayName,
    nameForQuantity,
    snapshotLineAmountName,
    snapshotLineName,
    variantPartTexts,
} from '../lineName.js';
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

const exact = (value: number): IngredientQuantity => ({ kind: 'exact', value });
const range = (low: number, high: number): IngredientQuantity => ({ kind: 'range', low, high });

/**
 * D21 (owner, 2026-10-10): a count of one reads in the singular. The rule is DISPLAY only and fails safe: whenever it is
 * not sure the name is shown as stored.
 */
describe('nameForQuantity (D21)', () => {
    it.each([
        { name: 'onions', quantity: exact(1), unit: '', shown: 'onion', why: 'exactly one, no unit' },
        { name: 'onions', quantity: exact(1), unit: 'large', shown: 'onion', why: 'a size word is no measure' },
        { name: 'onions', quantity: exact(1), unit: 'handful', shown: 'onion', why: 'a subjective unit is no measure' },
        { name: 'onions', quantity: exact(0.5), unit: '', shown: 'onion', why: 'half is below one' },
        { name: 'onions', quantity: exact(0.25), unit: undefined, shown: 'onion', why: 'an absent unit is empty' },
        { name: 'onions', quantity: exact(2), unit: '', shown: 'onions', why: 'two is plural' },
        { name: 'onions', quantity: exact(1.5), unit: '', shown: 'onions', why: 'above one is plural' },
        { name: 'onions', quantity: exact(1), unit: 'cup', shown: 'onions', why: 'a canonical unit measures the name' },
        {
            name: 'onions',
            quantity: exact(1),
            unit: 'tbsp',
            shown: 'onions',
            why: 'a canonical unit, as the cook typed it',
        },
        {
            name: 'onions',
            quantity: exact(1),
            unit: 'can',
            shown: 'onions',
            why: 'an unknown unit keeps the name as stored',
        },
        { name: 'onions', quantity: range(0.5, 1), unit: '', shown: 'onions', why: 'a range keeps the name' },
        { name: 'onions', quantity: ABSENT_QUANTITY, unit: '', shown: 'onions', why: 'no amount keeps the name' },
        { name: 'onions', quantity: exact(0), unit: '', shown: 'onions', why: 'zero is not an amount' },
        { name: 'flour', quantity: exact(1), unit: '', shown: 'flour', why: 'already singular' },
        {
            name: 'Brussels sprouts',
            quantity: exact(1),
            unit: '',
            shown: 'Brussels sprout',
            why: 'the last word only, case kept',
        },
        { name: 'canned tomatoes', quantity: exact(1), unit: 'large', shown: 'canned tomato', why: 'a compound name' },
        { name: 'sweet potatoes', quantity: exact(1), unit: '', shown: 'sweet potato', why: '-oes' },
        { name: 'blackberries', quantity: exact(1), unit: '', shown: 'blackberry', why: '-ies' },
        { name: 'anchovies', quantity: exact(1), unit: '', shown: 'anchovy', why: '-ies' },
        {
            name: 'chocolate chip cookies',
            quantity: exact(1),
            unit: '',
            shown: 'chocolate chip cookie',
            why: 'not "cooky"',
        },
        { name: 'brownies', quantity: exact(1), unit: '', shown: 'brownie', why: 'not "browny"' },
        { name: 'juice smoothies', quantity: exact(1), unit: '', shown: 'juice smoothie', why: 'not "smoothy"' },
        { name: 'little smokies', quantity: exact(1), unit: '', shown: 'little smokie', why: 'not "smoky"' },
        { name: 'frozen pierogies', quantity: exact(1), unit: '', shown: 'frozen pierogi', why: 'not "pierogy"' },
    ])('$name, $quantity.kind $unit → $shown — $why', ({ name, quantity, unit, shown }) => {
        expect(nameForQuantity(name, quantity, unit)).toBe(shown);
    });

    // Names the singularizer mangles, or that no cook counts one of. Each stays as stored.
    it.each([
        ['pomegranate molasses', 'ends in -ss-like -ses that is not a plural'],
        ['beef pancreas', '-as is not a plural'],
        ['lamb pancreas', '-as is not a plural'],
        ['Bordeaux', 'a French name'],
        ['Calvados', 'a French name'],
        ['pastis', 'a French name'],
        ['nopales', 'the Spanish plural, kept as sold'],
        ['haricots verts', 'a French plural, kept as sold'],
        ['rolled oats', 'a cereal named in the plural'],
        ['grits', 'a mass noun in the plural'],
        ['Angostura bitters', 'a mass noun in the plural'],
        ['bread crumbs', 'a mass noun in the plural'],
        ['chocolate cookie crumbs', 'a mass noun in the plural'],
        ['chitterlings', 'a mass noun in the plural'],
        ['beef trimmings', 'a mass noun in the plural'],
        ['sprinkles', 'a mass noun in the plural'],
        ['canned peas and carrots', 'two foods, no one head noun'],
        ['canned tomatoes and green chilies', 'two foods, no one head noun'],
        ['frosted oat cereal with marshmallows', 'the head noun is not the last word'],
    ])('keeps %s as stored — %s', (name) => {
        expect(nameForQuantity(name, exact(1), '')).toBe(name);
    });
});

describe('lineAmountName and snapshotLineAmountName (D21)', () => {
    it('singularizes a real name and never a stand-in', () => {
        expect(lineAmountName({ name: 'onions' }, exact(1), '', labels)).toBe('onion');
        expect(lineAmountName({ name: 'onions' }, exact(2), '', labels)).toBe('onions');
        expect(
            lineAmountName({ resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE }, exact(1), '', labels),
        ).toBe(labels.privateFood);
        expect(lineAmountName({}, exact(1), '', labels)).toBe('');
    });

    it('singularizes the name a version froze, never the "not saved" stand-in', () => {
        expect(
            snapshotLineAmountName(makeIngredient({ ingredientName: 'onions', quantity: exact(1), unit: '' }), labels),
        ).toBe('onion');
        expect(
            snapshotLineAmountName(makeIngredient({ quantity: exact(1), unit: '', ingredientName: '' }), labels),
        ).toBe(labels.notSavedInVersion);
    });
});
