/**
 * Unit tests for the recipe-detail model layer — the pure helpers the web and native detail views share.
 *
 * REWRITTEN for U8: `formatQuantity` takes the `exact | range | absent` value object instead of a number,
 * so every case now names the member it is formatting. The properties the previous suite proved are all
 * retained (Intl grouping, fractional precision, an empty-string unit meaning no unit); what is added is
 * the two members a scalar could not express.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';

import { progressiveFoodView } from '../../__fixtures__/foodSearchViews.js';
import {
    COMPLETE_FRAME,
    authoredResult,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
    sourceBusy,
} from '../../__fixtures__/progressiveFrames.js';
import { recipeFormMessages } from '../../form/messages.js';
import { makeIngredientView, makeNutrition } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../versions/__fixtures__/index.js';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';

import {
    formatIngredientLine,
    formatQuantity,
    ingredientCheckLabel,
    lineSummary,
    rangeDerivedNotice,
    servingsAnnouncement,
    staleNutritionNotice,
    reviewShortlistOf,
    reviewShortlistStatus,
} from '../model.js';
import { recipeMessages } from '../../messages.js';
import { makeRootBoundLine, makeVariantBoundLine } from '../__fixtures__/variantLines.js';

/** A quantity the source stated exactly. */
function exact(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

/** A quantity the source stated as two bounds. */
function range(low: number, high: number): IngredientQuantity {
    const quantity = statedQuantity(low, high);

    if (quantity === null) {
        throw new Error(`test fixture: ${low}..${high} is not a statable range`);
    }

    return quantity;
}

describe('formatQuantity — an exact quantity', () => {
    it('joins a quantity and unit', () => {
        expect(formatQuantity(exact(2), 'en-US', 'tbsp')).toBe('2 tbsp');
    });

    it('preserves fractional quantities', () => {
        expect(formatQuantity(exact(1.5), 'en-US', 'lbs')).toBe('1.5 lbs');
    });

    it('omits the unit when absent', () => {
        expect(formatQuantity(exact(3), 'en-US', undefined)).toBe('3');
    });

    it('treats an empty-string unit as no unit', () => {
        expect(formatQuantity(exact(3), 'en-US', '')).toBe('3');
    });

    it('locale-groups a large quantity via Intl (never string concatenation)', () => {
        expect(formatQuantity(exact(1000), 'en-US')).toBe('1,000');
    });

    it('formats a fractional quantity with a unit correctly for en-US', () => {
        expect(formatQuantity(exact(2.5), 'en-US', 'cups')).toBe('2.5 cups');
    });
});

describe('formatQuantity — a stated range (R36/R42)', () => {
    it('renders BOTH bounds with ONE unit', () => {
        expect(formatQuantity(range(2, 3), 'en-US', 'cups')).toBe('2–3 cups');
    });

    it('renders a range with no unit', () => {
        expect(formatQuantity(range(1, 2), 'en-US')).toBe('1–2');
    });

    // Each bound goes through Intl separately, so a grouped thousand stays grouped at both ends. A
    // concatenated `${low}-${high}` would print `1000-2000` and lose the locale's separator.
    it('locale-formats each bound rather than concatenating the pair', () => {
        expect(formatQuantity(range(1000, 2000), 'en-US', 'g')).toBe('1,000–2,000 g');
    });

    it('preserves fractional bounds', () => {
        expect(formatQuantity(range(0.5, 0.75), 'en-US', 'tsp')).toBe('0.5–0.75 tsp');
    });
});

describe('formatQuantity — an absent quantity (R40)', () => {
    // ⛔ NOT "0", and not "1". The source stated no amount; the line still has to render, and what it
    // renders is its unit and name — "butter the size of an egg" carries its meaning in the notes.
    it('renders NOTHING for the quantity, never a fabricated number', () => {
        expect(formatQuantity(ABSENT_QUANTITY, 'en-US')).toBe('');
        expect(formatQuantity(ABSENT_QUANTITY, 'en-US', '')).toBe('');
    });

    it('renders the unit alone when the line states one, with no stray separator', () => {
        expect(formatQuantity(ABSENT_QUANTITY, 'en-US', 'pinch')).toBe('pinch');
    });
});

/**
 * U9 / R38 — the disclosure that a total was computed from ONE bound of a stated range.
 *
 * `computeRecipeNutrition` already records which bound it collapsed to; nothing rendered it, so a figure up
 * to a third under the recipe's upper bound was indistinguishable from an exact one. This selector is the
 * single place that fact becomes copy, on both platforms and on both the detail and the editor surface.
 */
describe('rangeDerivedNotice (R38)', () => {
    const notices = { low: 'from the lower amount', high: 'from the upper amount' };

    it('returns nothing when no range was collapsed — absence IS the "not applicable"', () => {
        expect(rangeDerivedNotice(makeNutrition(), notices)).toBeUndefined();
    });

    it('names the LOWER bound when the figure came from it', () => {
        expect(rangeDerivedNotice(makeNutrition({ rangeDerivedBound: 'low' }), notices)).toBe('from the lower amount');
    });

    it('names the UPPER bound when the figure came from it', () => {
        // Today's policy only ever collapses to `low`; the client renders the bound it is TOLD, so a policy
        // change is a one-line server edit rather than a client release.
        expect(rangeDerivedNotice(makeNutrition({ rangeDerivedBound: 'high' }), notices)).toBe('from the upper amount');
    });
});

describe('staleNutritionNotice (KTD-3b — serve stale, MARKED)', () => {
    const notice = 'may be out of date';

    it('returns the notice when the figure was served from cache', () => {
        expect(staleNutritionNotice(makeNutrition({ freshness: 'stale' }), notice)).toBe(notice);
    });

    it('returns nothing for a figure fetched for this read — a fresh reading carries no reassuring sentence', () => {
        expect(staleNutritionNotice(makeNutrition({ freshness: 'fresh' }), notice)).toBeUndefined();
    });
});

/**
 * What the serving stepper SAYS after + or − (staff-ux-engineer ruling): the count, pluralised for the locale, and
 * — at an end of the range — that it IS the end, so an unavailable + explains itself.
 */
describe('servingsAnnouncement', () => {
    const copy = {
        servingsValueOne: '{count} serving',
        servingsValueOther: '{count} servings',
        servingsValueAtMinimum: '{value}, minimum',
        servingsValueAtMaximum: '{value}, maximum',
    };

    it('names the count, pluralised', () => {
        expect(servingsAnnouncement(4, 4, copy, 'en')).toBe('4 servings');
        expect(servingsAnnouncement(2, 4, copy, 'en')).toBe('2 servings');
    });

    it('says when the count is the fewest the range allows', () => {
        expect(MIN_SCALED_SERVINGS).toBe(1);
        expect(servingsAnnouncement(MIN_SCALED_SERVINGS, 4, copy, 'en')).toBe('1 serving, minimum');
    });

    it('says when the count is the most the range allows', () => {
        expect(servingsAnnouncement(MAX_SCALED_SERVINGS, 4, copy, 'en')).toBe(
            `${MAX_SCALED_SERVINGS} servings, maximum`,
        );
    });

    it('treats a recipe authored above the display cap as at its maximum on its own yield', () => {
        const huge = MAX_SCALED_SERVINGS + 150;

        expect(servingsAnnouncement(huge, huge, copy, 'en')).toBe(`${huge} servings, maximum`);
        expect(servingsAnnouncement(huge - 1, huge, copy, 'en')).toBe(`${huge - 1} servings`);
    });
});

describe('ingredientCheckLabel (curated U15, §S5)', () => {
    const names = recipeMessages.en.ingredientLineName;
    const template = recipeMessages.en.ingredientDetails.checkLabelWithDetails;

    it('is the plain line summary on a root-bound line', () => {
        const line = makeRootBoundLine();

        expect(ingredientCheckLabel(line, 'en', names, template)).toBe(lineSummary(line, 'en', names));
        expect(ingredientCheckLabel(line, 'en', names, template)).toBe('1 lb beef brisket');
    });

    it('adds every part, comma-joined, on a variant-bound line (R27)', () => {
        expect(ingredientCheckLabel(makeVariantBoundLine(), 'en', names, template)).toBe(
            '2 lb beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised',
        );
    });

    it('leaves no leading space when the line states no amount (R40)', () => {
        const line = makeVariantBoundLine({ quantity: { kind: 'absent' }, unit: undefined });

        expect(ingredientCheckLabel(line, 'en', names, template)).toBe(
            'beef brisket, flat half, separable lean and fat, 1/8-inch trim, select, braised',
        );
    });
});

/**
 * REWRITTEN for plan 002 S7.8: the ambiguity review's shortlist for one phrase, from the ONE progressive answer
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P12): our database's foods first, each by its root id, then
 * each remote source's under `From {source}`, added at the end, each by the reference food issued. A correction binds a
 * food and never a variant, so a matched variant is not carried.
 */
describe('reviewShortlistOf (plan 002 S7.8)', () => {
    const NAMING = { sourceName: (source: string) => (source === 'usda' ? 'USDA' : undefined) };
    const COPY = { remote: recipeMessages.en.ingredientRemoteSearch };
    const MINE = authoredResult('food_mine', 'apple sauce, homemade');
    const CANNED = catalogResult('food_canned', 'Apple sauce, canned');
    const FLAT = {
        ...catalogResult('food_brisket', 'beef brisket'),
        variant: { id: 'var_flat', parts: [{ attribute: 'cut' as const, text: 'flat half' }] },
    };
    const shortlistOf = (frames: Parameters<typeof progressiveFoodView>[0], running = false) =>
        reviewShortlistOf(progressiveFoodView(frames, { running }), NAMING, COPY);

    it('lists our database’s foods first, each by id, then each source’s under `From {source}`, by reference', () => {
        expect(
            shortlistOf([
                databaseFrame({ authored: [MINE], catalog: [CANNED] }),
                sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
                COMPLETE_FRAME,
            ]),
        ).toEqual({
            kind: 'listed',
            groups: [
                {
                    key: 'database',
                    label: undefined,
                    candidates: [
                        {
                            key: 'authored:food_mine',
                            name: 'apple sauce, homemade',
                            accessibleName: undefined,
                            pick: { kind: 'catalogFood', foodId: 'food_mine' },
                        },
                        {
                            key: 'catalog:food_canned',
                            name: 'Apple sauce, canned',
                            accessibleName: undefined,
                            pick: { kind: 'catalogFood', foodId: 'food_canned' },
                        },
                    ],
                },
                {
                    key: 'remote:usda',
                    label: 'From USDA',
                    candidates: [
                        {
                            key: 'remote:usda:sealed.s',
                            name: 'Apples, stewed',
                            accessibleName: 'Apples, stewed, from USDA',
                            pick: { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' },
                        },
                    ],
                },
            ],
            database: {
                authored: { kind: 'answered', foods: [expect.anything()] },
                catalog: { kind: 'answered', foods: [expect.anything()] },
            },
            remote: [{ kind: 'answered', source: 'usda', foods: [expect.anything()] }],
            progress: 'complete',
        });
    });

    it('offers a root that matched a variant as the root alone', () => {
        expect(shortlistOf([databaseFrame({ catalog: [FLAT] }), COMPLETE_FRAME])).toMatchObject({
            groups: [{ candidates: [{ name: 'beef brisket', pick: { kind: 'catalogFood', foodId: 'food_brisket' } }] }],
        });
    });

    it('names the database group that failed, and lists the other', () => {
        expect(
            shortlistOf([databaseFrame({ authored: [MINE], catalog: 'unavailable' }), COMPLETE_FRAME]),
        ).toMatchObject({
            kind: 'listed',
            database: { catalog: { kind: 'unavailable' } },
            groups: [{ candidates: [{ key: 'authored:food_mine' }] }],
        });
    });

    it.each<[string, Parameters<typeof progressiveFoodView>[0], unknown]>([
        ['nothing arrived', [], { kind: 'failed' }],
        [
            'every part failed',
            [databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }), COMPLETE_FRAME],
            { kind: 'failed' },
        ],
        [
            'everything answered with no food',
            [databaseFrame(), sourceAnswered('usda'), COMPLETE_FRAME],
            { kind: 'empty' },
        ],
    ])('%s', (_case, frames, expected) => {
        expect(shortlistOf(frames)).toEqual(expected);
    });

    it('is loading until the database part arrives, and offline while it is parked', () => {
        expect(shortlistOf([], true)).toEqual({ kind: 'loading' });
        expect(reviewShortlistOf({ kind: 'offline' }, NAMING, COPY)).toEqual({ kind: 'offline' });
    });

    it('a phrase too short to search offers nothing to choose from', () => {
        expect(reviewShortlistOf({ kind: 'tooShort', minimum: 3 }, NAMING, COPY)).toEqual({ kind: 'empty' });
    });

    it('keeps the database foods in place while the answer still runs', () => {
        expect(shortlistOf([databaseFrame({ catalog: [CANNED] })], true)).toMatchObject({
            kind: 'listed',
            progress: 'running',
            groups: [{ key: 'database' }],
        });
    });
});

/**
 * REWRITTEN for plan 002 S7.8: what a review row's status line says (P12). It sits after the chips, is polite, and says
 * once, at the end of the answer, what the list could not show; P12's defect (b) is fixed, so a failed search and an
 * empty one each say so.
 */
describe('reviewShortlistStatus (plan 002 S7.8)', () => {
    const form = recipeFormMessages.en;
    const remote = recipeMessages.en.ingredientRemoteSearch;
    const COPY = { loading: 'Finding matches…', offline: 'Waiting for a connection.', form, remote };
    const NAMING = {
        sourceName: (source: string) => (source === 'usda' ? 'USDA' : undefined),
        formatTime: () => '3:05 PM',
        formatList: (items: readonly string[]) => items.join(', '),
    };
    const statusOf = (frames: Parameters<typeof progressiveFoodView>[0], running = false) =>
        reviewShortlistStatus(reviewShortlistOf(progressiveFoodView(frames, { running }), NAMING, COPY), NAMING, COPY);

    it.each<[string, Parameters<typeof progressiveFoodView>[0], boolean, string]>([
        ['before the database part', [], true, COPY.loading],
        [
            'while the answer runs, the same line, so it speaks once at the end',
            [databaseFrame({ catalog: [catalogResult('c')] })],
            true,
            COPY.loading,
        ],
        ['nothing arrived', [], false, form.candidatesLoadFailed],
        ['everything answered with no food', [databaseFrame(), COMPLETE_FRAME], false, form.candidatesEmpty],
        [
            'everything answered with foods',
            [databaseFrame({ catalog: [catalogResult('c')] }), COMPLETE_FRAME],
            false,
            '',
        ],
        [
            'a database group failed, a source was busy, and the answer did not finish',
            [databaseFrame({ catalog: [catalogResult('c')], authored: 'unavailable' }), sourceBusy('usda', 1)],
            false,
            `${form.ingredientAuthoredUnavailable} We couldn’t search USDA just now. Try again later. ${remote.incomplete}`,
        ],
    ])('%s', (_case, frames, running, expected) => {
        expect(statusOf(frames, running)).toBe(expected);
    });

    it('offline: the parked-read sentence', () => {
        expect(reviewShortlistStatus({ kind: 'offline' }, NAMING, COPY)).toBe(COPY.offline);
    });
});

/** D21 (owner, 2026-10-10): every surface that composes an amount with a name shows the singular for a count of one. */
describe('the singular name for a count of one (D21)', () => {
    const names = recipeMessages.en.ingredientLineName;
    const template = recipeMessages.en.ingredientDetails.checkLabelWithDetails;
    const onions = (overrides: Parameters<typeof makeIngredientView>[0]) =>
        makeIngredientView({ name: 'onions', ...overrides });

    it('lineSummary reads "1 large onion" for one, and "2 onions" for two', () => {
        expect(lineSummary(onions({ quantity: exact(1), unit: 'large' }), 'en', names)).toBe('1 large onion');
        expect(lineSummary(onions({ quantity: exact(2), unit: '' }), 'en', names)).toBe('2 onions');
        expect(lineSummary(onions({ quantity: exact(1), unit: 'cup' }), 'en', names)).toBe('1 cup onions');
    });

    it('ingredientCheckLabel names a variant-bound line the same way', () => {
        const line = makeVariantBoundLine({ name: 'onions', quantity: exact(1), unit: '' });

        expect(ingredientCheckLabel(line, 'en', names, template).startsWith('1 onion, ')).toBe(true);
    });

    it('formatIngredientLine reads a version\u2019s line the same way, preparation after the name', () => {
        const line = makeIngredient({
            ingredientName: 'onions',
            quantity: exact(1),
            unit: 'large',
            preparation: 'finely chopped',
        });

        expect(formatIngredientLine(line, 'en', names)).toBe('1 large onion, finely chopped');
        expect(formatIngredientLine({ ...line, quantity: exact(2), unit: '' }, 'en', names)).toBe(
            '2 onions, finely chopped',
        );
    });
});
