/**
 * Unit tests for the recipe-list model layer — the pure, platform-agnostic helpers the web and native
 * list views both render through. Each helper is tested for its real contract (projection subset, locale
 * plural selection, token substitution), not merely that it returns *a* string.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
import {
    QUICK_TIME_FACET,
    QUICK_TIME_THRESHOLD_MINUTES,
    fillTemplate,
    filterChipLabel,
    formatDurationMinutes,
    formatRecipeCount,
    isListNarrowed,
    isQuickRecipe,
    matchesListFacet,
    toRecipeListItem,
} from '../model.js';

describe('fillTemplate', () => {
    it('substitutes a single named token', () => {
        expect(fillTemplate('{count} recipes', { count: 6 })).toBe('6 recipes');
    });

    it('substitutes multiple named tokens', () => {
        expect(fillTemplate('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2');
    });

    it('leaves an unknown token untouched (never throws)', () => {
        expect(fillTemplate('{count} of {missing}', { count: 3 })).toBe('3 of {missing}');
    });
});

describe('toRecipeListItem', () => {
    it('is the shared card projection (the list and widget draw the identical card)', () => {
        const recipe = makeRecipe({ id: 'rec_42', title: 'Herb Risotto', totalTimeMinutes: 35 });

        // The list card and the Home-widget card are one piece of knowledge — this MUST be the same
        // projection as toRecipeCardModel, or the two surfaces could drift on which fields a card shows.
        expect(toRecipeListItem(recipe)).toEqual(toRecipeCardModel(recipe));
    });

    it('projects the card fields the list card renders', () => {
        const item = toRecipeListItem(
            makeRecipe({ id: 'rec_42', title: 'Herb Risotto', totalTimeMinutes: 35, servings: 6, difficulty: 'hard' }),
        );

        expect(item).toMatchObject({
            id: 'rec_42',
            title: 'Herb Risotto',
            totalTimeMinutes: 35,
            servings: 6,
            difficulty: 'hard',
        });
    });

    it('does not leak Recipe fields outside the card view-model', () => {
        const item = toRecipeListItem(makeRecipe({ ownerId: 'usr_secret', description: 'private notes' }));

        expect(item).not.toHaveProperty('ownerId');
        expect(item).not.toHaveProperty('description');
        // visibility/status ARE card fields now (they drive the merged-card badges); ingredients are not.
        expect(item).not.toHaveProperty('ingredients');
    });
});

describe('formatRecipeCount', () => {
    const labels = { one: '{count} recipe', other: '{count} recipes' } as const;

    it('uses the singular template for the "one" plural category (en)', () => {
        expect(formatRecipeCount(1, labels, 'en')).toBe('1 recipe');
    });

    it('uses the plural template for zero (en treats 0 as "other")', () => {
        expect(formatRecipeCount(0, labels, 'en')).toBe('0 recipes');
    });

    it('uses the plural template for many', () => {
        expect(formatRecipeCount(6, labels, 'en')).toBe('6 recipes');
    });
});

describe('formatDurationMinutes', () => {
    it('fills the localized minutes template', () => {
        expect(formatDurationMinutes(45, '{minutes} min')).toBe('45 min');
    });
});

describe('isQuickRecipe (L4 "Quick (<30m)" chip)', () => {
    it('is true strictly under the threshold', () => {
        expect(isQuickRecipe(29)).toBe(true);
        expect(isQuickRecipe(1)).toBe(true);
    });

    it('is false at and above the threshold (the wireframe reads "<30m", not "<=30m")', () => {
        expect(isQuickRecipe(QUICK_TIME_THRESHOLD_MINUTES)).toBe(false);
        expect(isQuickRecipe(45)).toBe(false);
    });
});

describe('matchesListFacet', () => {
    const recipe = (over: { dietaryFlags?: readonly string[]; cuisine?: string; totalTimeMinutes?: number } = {}) => ({
        dietaryFlags: [] as readonly string[],
        totalTimeMinutes: 45,
        ...over,
    });

    it('matches the QUICK_TIME_FACET sentinel against total time, not against dietary/cuisine data', () => {
        expect(matchesListFacet(recipe({ totalTimeMinutes: 20 }), QUICK_TIME_FACET)).toBe(true);
        expect(matchesListFacet(recipe({ totalTimeMinutes: 45 }), QUICK_TIME_FACET)).toBe(false);
    });

    it('matches a dietary flag facet', () => {
        expect(matchesListFacet(recipe({ dietaryFlags: ['Vegetarian'] }), 'Vegetarian')).toBe(true);
        expect(matchesListFacet(recipe({ dietaryFlags: ['Vegan'] }), 'Vegetarian')).toBe(false);
    });

    it('matches a cuisine facet', () => {
        expect(matchesListFacet(recipe({ cuisine: 'Italian' }), 'Italian')).toBe(true);
        expect(matchesListFacet(recipe({ cuisine: 'Thai' }), 'Italian')).toBe(false);
    });

    it('never confuses a data value literally named "quick" with the time-bucket sentinel', () => {
        // A recipe whose cuisine happens to be "quick" must NOT satisfy the QUICK_TIME_FACET sentinel via
        // string equality on cuisine — the sentinel means "total time < threshold", not "cuisine is quick".
        expect(matchesListFacet(recipe({ cuisine: 'quick', totalTimeMinutes: 45 }), QUICK_TIME_FACET)).toBe(false);
    });
});

describe('filterChipLabel', () => {
    it('renders the localized quick label for the QUICK_TIME_FACET sentinel', () => {
        expect(filterChipLabel(QUICK_TIME_FACET, 'Quick (<30m)')).toBe('Quick (<30m)');
    });

    it('passes every other facet value through unchanged (dietary flags/cuisine are free-text data, not copy)', () => {
        expect(filterChipLabel('Vegetarian', 'Quick (<30m)')).toBe('Vegetarian');
        expect(filterChipLabel('Italian', 'Quick (<30m)')).toBe('Italian');
    });
});

describe('isListNarrowed (the empty-vs-no-match discriminator)', () => {
    it('is false for a blank surface — the genuine first-run empty library', () => {
        expect(isListNarrowed('', [])).toBe(false);
        expect(isListNarrowed('')).toBe(false);
    });

    it('treats a whitespace-only search term as no narrowing at all', () => {
        expect(isListNarrowed('   ', [])).toBe(false);
    });

    it('is true for a real search term', () => {
        expect(isListNarrowed('lamb', [])).toBe(true);
        expect(isListNarrowed('  lamb  ', [])).toBe(true);
    });

    it('is true for an ACTIVE facet chip even with a blank search box', () => {
        // The defect this predicate exists to prevent: a chip-narrowed zero rendering first-run empty copy.
        expect(isListNarrowed('', ['Vegetarian'])).toBe(true);
        expect(isListNarrowed('', [QUICK_TIME_FACET])).toBe(true);
    });

    it('is true when both a term and a facet are active', () => {
        expect(isListNarrowed('lamb', ['Vegetarian'])).toBe(true);
    });
});
