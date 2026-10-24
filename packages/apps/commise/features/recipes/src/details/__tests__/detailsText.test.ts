/**
 * The details dialog's text (curated U14; `docs/design/ingredientSpecialization.md` §S8.4, §S8.5, §S8.8, §S11).
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { recipeNutritionMessages } from '../../nutrition/messages.js';
import { BEEF_BRISKET, BONELESS_SKINLESS_CHICKEN_THIGHS } from '../__fixtures__/seedVariants.js';
import { deriveDetailsDialogState } from '../detailsDialogMachine.js';
import { planVariantList } from '../groupVariants.js';
import {
    type DetailsTextMessages,
    caloriesLabel,
    dialogViewOf,
    outcomeAnnouncement,
    searchCountText,
    splitAtToken,
    variantOptionName,
} from '../detailsText.js';
import type { VariantRow } from '../groupVariants.js';

const MESSAGES: DetailsTextMessages = {
    details: recipeMessages.en.ingredientDetails,
    calories: recipeNutritionMessages.en.calories,
};

/** A row with these shown parts and an optional group. */
function row(shownParts: readonly [string, ...string[]], calories: number | undefined, group?: string): VariantRow {
    const allParts: readonly [string, ...string[]] = group === undefined ? shownParts : [group, ...shownParts];

    return {
        variant: { id: 'V1', parts: allParts.map((text) => ({ attribute: 'grade', text })) },
        allParts,
        shownParts,
        group,
        calories,
    };
}

describe('caloriesLabel', () => {
    it('uses the one "N cal" template, with the number rounded for the locale', () => {
        expect(caloriesLabel(1234.4, 'en', MESSAGES)).toEqual({ visible: '1,234 cal', spoken: '1,234 cal' });
    });

    it('says "no figure" for a variant with no energy value, and never 0', () => {
        expect(caloriesLabel(undefined, 'en', MESSAGES)).toEqual({ visible: 'no figure', spoken: 'no calorie figure' });
    });

    it('shows a real zero as a figure', () => {
        expect(caloriesLabel(0, 'en', MESSAGES).visible).toBe('0 cal');
    });
});

describe('variantOptionName (R27, SC 2.5.3)', () => {
    it('starts with the visible parts, comma-joined, then the calories', () => {
        expect(variantOptionName(row(['lean only', '0-inch trim'], 124), false, 'en', MESSAGES)).toBe(
            'lean only, 0-inch trim, 124 cal',
        );
    });

    it('ends a grouped row with its group part', () => {
        expect(variantOptionName(row(['lean only'], 124, 'flat half'), false, 'en', MESSAGES)).toBe(
            'lean only, 124 cal, flat half',
        );
    });

    it('puts Current in the name of the current row, grouped or not', () => {
        expect(variantOptionName(row(['select'], undefined), true, 'en', MESSAGES)).toBe(
            'select, Current, no calorie figure',
        );
        expect(variantOptionName(row(['select'], 90, 'whole'), true, 'en', MESSAGES)).toBe(
            'select, Current, 90 cal, whole',
        );
    });
});

describe('searchCountText', () => {
    it('uses the singular form at one match and the plural otherwise', () => {
        expect(searchCountText(1, 40, MESSAGES)).toBe('1 of 40 options');
        expect(searchCountText(4, 40, MESSAGES)).toBe('4 of 40 options');
        expect(searchCountText(0, 40, MESSAGES)).toBe('0 of 40 options');
    });
});

describe('outcomeAnnouncement (§S8.8)', () => {
    const variant = {
        id: 'V1',
        parts: [
            { attribute: 'cut', text: 'flat half' },
            { attribute: 'fat', text: 'lean only' },
        ],
    };

    it('announces an added detail with every part', () => {
        expect(outcomeAnnouncement({ kind: 'committed', mode: 'add', variant }, MESSAGES)).toBe(
            'Details added: flat half, lean only.',
        );
    });

    it('announces a change in edit mode', () => {
        expect(outcomeAnnouncement({ kind: 'committed', mode: 'edit', variant }, MESSAGES)).toBe(
            'Details changed: flat half, lean only.',
        );
    });

    it('announces a removal, and nothing for a dismissal', () => {
        expect(outcomeAnnouncement({ kind: 'removed' }, MESSAGES)).toBe('Details removed.');
        expect(outcomeAnnouncement({ kind: 'dismissed' }, MESSAGES)).toBeUndefined();
    });
});

describe('splitAtToken', () => {
    it('splits a template around one token, so a component can sit in its place', () => {
        expect(splitAtToken('Current: {parts}', 'parts')).toEqual(['Current: ', '']);
        expect(splitAtToken('Current: {parts}. It is gone.', 'parts')).toEqual(['Current: ', '. It is gone.']);
    });

    it('throws for a template without the token, because a translation that drops it would hide the parts', () => {
        expect(() => splitAtToken('Current', 'parts')).toThrow(/\{parts\}/u);
    });
});

describe('dialogViewOf — what both leaves show for a state', () => {
    const thigh = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
    const derive = (variants: Parameters<typeof planVariantList>[0], current?: typeof thigh, query = '') =>
        deriveDetailsDialogState({
            read: { kind: 'loaded', plan: planVariantList(variants, 'en') },
            entry: current === undefined ? { mode: 'add' } : { mode: 'edit', current },
            query,
            locale: 'en',
        });

    it('marks the long-list states and carries their total', () => {
        expect(dialogViewOf(derive(BEEF_BRISKET), undefined, MESSAGES)).toMatchObject({ isLong: true, total: 40 });
        expect(dialogViewOf(derive(BEEF_BRISKET, undefined, 'zzz'), undefined, MESSAGES)).toMatchObject({
            isLong: true,
            total: 40,
        });
        expect(dialogViewOf(derive(BONELESS_SKINLESS_CHICKEN_THIGHS), undefined, MESSAGES)).toMatchObject({
            isLong: false,
            total: 0,
        });
    });

    it('builds the current line from the listed template, or the retired one when it is not listed', () => {
        const listed = dialogViewOf(derive(BONELESS_SKINLESS_CHICKEN_THIGHS, thigh), undefined, MESSAGES);
        const retired = dialogViewOf(
            derive(BONELESS_SKINLESS_CHICKEN_THIGHS, { id: 'gone', parts: [{ attribute: 'cut', text: 'gone cut' }] }),
            undefined,
            MESSAGES,
        );

        expect(listed.currentLine).toMatchObject({ before: 'Current: ', after: '' });
        expect(listed.current?.listed).toBe(true);
        expect(retired.currentLine).toMatchObject({ before: 'Current: ', parts: ['gone cut'] });
        expect(retired.currentLine?.spoken).toBe(
            'Current: gone cut. It’s no longer listed, so if you change it, you can’t pick it again.',
        );
    });

    it('has no current line when opened to add', () => {
        expect(dialogViewOf(derive(BONELESS_SKINLESS_CHICKEN_THIGHS), undefined, MESSAGES).currentLine).toBeUndefined();
    });

    it('announces loading, or the settled search: "no matches" or the count', () => {
        expect(dialogViewOf({ name: 'loading' }, undefined, MESSAGES).announcement).toBe('Loading details…');
        expect(
            dialogViewOf(
                derive(BEEF_BRISKET, undefined, 'zzz'),
                { kind: 'noMatches', query: 'zzz', total: 40 },
                MESSAGES,
            ).announcement,
        ).toBe('Nothing matches “zzz”. Clear the search to see all 40.');
        expect(
            dialogViewOf(derive(BEEF_BRISKET, undefined, 'navel'), { kind: 'matches', shown: 4, total: 40 }, MESSAGES)
                .announcement,
        ).toBe('4 of 40 options');
        expect(dialogViewOf(derive(BEEF_BRISKET), undefined, MESSAGES).announcement).toBe('');
    });

    // The live "no matches" state is shown at once, but said only once the search settles: its text holds the query,
    // so a live announcement restarts on every key press (§S8.5, `docs/design/readSurfacesEvaluation.md` D4).
    it('says nothing for "no matches" until the search has settled', () => {
        expect(dialogViewOf(derive(BEEF_BRISKET, undefined, 'zzz'), undefined, MESSAGES).announcement).toBe('');
    });
});
