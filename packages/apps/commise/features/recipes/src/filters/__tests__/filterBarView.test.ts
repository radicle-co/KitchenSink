/**
 * The filter groups' view (`filterBarViewOf`), which the Discover panel and the filter sheet both draw
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): the groups in the spec's order, the time ladders as choices with an
 * "Any", the prep and cook ladders behind one disclosure, the chips a group offers and what pressing each asks for, the
 * chip cap that never hides a chosen chip, the applied-filter chips, and the Filters button and Clear all copy.
 *
 * ⚠️ REWRITTEN for slice 5. The bar used to offer the groups in the order dietary, cuisine, tags, three time ladders,
 * ingredients, as toggle buttons with no "Any". This file now proves the new order and the new shapes; the assertions
 * about what a chip asks for, the typeahead's results and the counted trigger are kept.
 */
import type { RecipeFacetCount } from '@kitchensink/recipe-core';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { describe, expect, it } from 'vitest';

import {
    FACET_CHIP_LIMIT,
    filterBarViewOf,
    visibleChipsOf,
    type FacetChipView,
    type FacetGroupView,
    type FilterBarViewInput,
} from '../filterBarView.js';
import { filterMessages } from '../messages.js';
import type { FoodIngredient } from '../model.js';

const copy = filterMessages.en;
const bucket = (value: string, count: number): RecipeFacetCount => ({ value, count });
const food = (id: string, name: string): FoodIngredient => ({ ...makeIngredient({ id, name }), foodId: `food_${id}` });

const input = (overrides: Partial<FilterBarViewInput> = {}): FilterBarViewInput => ({
    facets: {},
    filters: {},
    viewState: { kind: 'idle' },
    ...overrides,
});

type View = ReturnType<typeof filterBarViewOf>;

/** The group in a top-level slot, by the slot's id. */
const groupOf = (view: View, id: string): FacetGroupView | undefined => {
    const slot = view.slots.find((entry) => entry.id === id);

    return slot?.kind === 'group' ? slot.group : undefined;
};

/** The group inside the "More time filters" disclosure, by id. */
const moreTimeGroup = (view: View, id: string): FacetGroupView | undefined => {
    const slot = view.slots.find((entry) => entry.id === 'moreTime');

    return slot?.kind === 'disclosure' ? slot.groups.find((entry) => entry.id === id)?.group : undefined;
};

describe('filterBarViewOf — the groups', () => {
    it('lists the groups in the spec’s order, with prep and cook time behind one disclosure', () => {
        expect(filterBarViewOf(input(), copy).slots.map((slot) => slot.id)).toEqual([
            'maxTotalTime',
            'moreTime',
            'dietaryFlags',
            'cuisine',
            'tags',
            'ingredients',
        ]);
    });

    it.each(['dietaryFlags', 'cuisine', 'tags'])('a chip group with nothing to offer is absent: %s', (id) => {
        expect(groupOf(filterBarViewOf(input(), copy), id)).toBeUndefined();
    });

    it('a multi-select group offers its chips with their counts, each toggling its value', () => {
        const view = filterBarViewOf(
            input({
                facets: { dietaryFlags: [bucket('vegan', 4), bucket('paleo', 1)] },
                filters: { dietaryFlags: ['paleo'] },
            }),
            copy,
        );

        expect(groupOf(view, 'dietaryFlags')).toEqual({
            kind: 'chips',
            label: 'Dietary',
            chips: [
                {
                    chip: { value: 'vegan', count: 4, selected: false },
                    action: { kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' },
                },
                {
                    chip: { value: 'paleo', count: 1, selected: true },
                    action: { kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'paleo' },
                },
            ],
        });
    });

    it('the tags group offers the most used first, and toggles the tags dimension', () => {
        const view = filterBarViewOf(
            input({ facets: { tags: [bucket('rare', 1), bucket('common', 9), bucket('middling', 4)] } }),
            copy,
        );

        const group = groupOf(view, 'tags');

        expect(group).toMatchObject({ label: 'Tags' });
        expect(group?.kind === 'chips' ? group.chips.map((entry) => entry.chip.value) : []).toEqual([
            'common',
            'middling',
            'rare',
        ]);
        expect(group?.kind === 'chips' ? group.chips[0]?.action : undefined).toEqual({
            kind: 'toggleFacet',
            dimension: 'tags',
            value: 'common',
        });
    });

    it('the cuisine group keeps the server’s order, marks the chosen cuisine and sets the one pressed', () => {
        const view = filterBarViewOf(
            input({ facets: { cuisine: [bucket('Thai', 3), bucket('Greek', 2)] }, filters: { cuisine: 'Greek' } }),
            copy,
        );

        expect(groupOf(view, 'cuisine')).toEqual({
            kind: 'chips',
            label: 'Cuisine',
            chips: [
                {
                    chip: { value: 'Thai', count: 3, selected: false },
                    action: { kind: 'setCuisine', cuisine: 'Thai' },
                },
                {
                    chip: { value: 'Greek', count: 2, selected: true },
                    action: { kind: 'setCuisine', cuisine: 'Greek' },
                },
            ],
        });
    });

    it('a selected value the search returned no bucket for still offers its chip, with no count', () => {
        const view = filterBarViewOf(input({ filters: { tags: ['spicy'] } }), copy);

        expect(groupOf(view, 'tags')).toMatchObject({ chips: [{ chip: { value: 'spicy', selected: true } }] });
    });
});

describe('filterBarViewOf — the time ladders', () => {
    it('total time is a choice of Any and the three bounds, with Any chosen when no bound is set', () => {
        expect(groupOf(filterBarViewOf(input(), copy), 'maxTotalTime')).toEqual({
            kind: 'timeChoices',
            label: 'Total time',
            value: 'any',
            options: [
                {
                    value: 'any',
                    label: 'Any',
                    action: { kind: 'setTimeBound', field: 'maxTotalTime', minutes: undefined },
                },
                {
                    value: '15',
                    label: 'Under 15 min',
                    action: { kind: 'setTimeBound', field: 'maxTotalTime', minutes: 15 },
                },
                {
                    value: '30',
                    label: 'Under 30 min',
                    action: { kind: 'setTimeBound', field: 'maxTotalTime', minutes: 30 },
                },
                {
                    value: '60',
                    label: 'Under 60 min',
                    action: { kind: 'setTimeBound', field: 'maxTotalTime', minutes: 60 },
                },
            ],
        });
    });

    it('chooses the bound in force, and Any clears it', () => {
        const group = groupOf(filterBarViewOf(input({ filters: { maxTotalTime: 30 } }), copy), 'maxTotalTime');

        expect(group).toMatchObject({ value: '30' });
        expect(group?.kind === 'timeChoices' ? group.options[0]?.action : undefined).toEqual({
            kind: 'setTimeBound',
            field: 'maxTotalTime',
            minutes: undefined,
        });
    });

    it.each<['maxPrepTime' | 'maxCookTime', string]>([
        ['maxPrepTime', 'Prep time'],
        ['maxCookTime', 'Cook time'],
    ])('%s is the same choice, inside the disclosure', (field, label) => {
        expect(moreTimeGroup(filterBarViewOf(input({ filters: { [field]: 15 } }), copy), field)).toMatchObject({
            kind: 'timeChoices',
            label,
            value: '15',
        });
    });

    it('keeps the disclosure shut until a prep or cook bound is in force, then opens it so the filter is not hidden', () => {
        const slotOf = (filters: FilterBarViewInput['filters']) =>
            filterBarViewOf(input({ filters }), copy).slots.find((entry) => entry.id === 'moreTime');

        expect(slotOf({})).toMatchObject({ kind: 'disclosure', label: 'More time filters', open: false });
        expect(slotOf({ maxTotalTime: 30 })).toMatchObject({ open: false });
        expect(slotOf({ maxCookTime: 30 })).toMatchObject({ open: true });
    });
});

describe('visibleChipsOf — the chip cap', () => {
    const chips = (count: number, selected: readonly number[] = []): readonly FacetChipView[] =>
        Array.from({ length: count }, (_, index) => ({
            chip: { value: `v${index}`, count: 1, selected: selected.includes(index) },
            action: { kind: 'toggleFacet', dimension: 'tags', value: `v${index}` },
        }));

    it('shows every chip up to the cap, and hides none', () => {
        expect(visibleChipsOf(chips(FACET_CHIP_LIMIT), false)).toMatchObject({ hiddenCount: 0 });
        expect(visibleChipsOf(chips(FACET_CHIP_LIMIT), false).shown).toHaveLength(FACET_CHIP_LIMIT);
    });

    it('cuts a longer group at the cap and says how many are behind “Show all”', () => {
        const result = visibleChipsOf(chips(FACET_CHIP_LIMIT + 5), false);

        expect(result.shown).toHaveLength(FACET_CHIP_LIMIT);
        expect(result.hiddenCount).toBe(5);
    });

    it('shows them all once expanded', () => {
        const result = visibleChipsOf(chips(FACET_CHIP_LIMIT + 5), true);

        expect(result.shown).toHaveLength(FACET_CHIP_LIMIT + 5);
        expect(result.hiddenCount).toBe(0);
    });

    it('never hides a chosen chip behind “Show all”', () => {
        const result = visibleChipsOf(chips(FACET_CHIP_LIMIT + 5, [FACET_CHIP_LIMIT + 2]), false);

        expect(result.shown.map((entry) => entry.chip.value)).toContain(`v${FACET_CHIP_LIMIT + 2}`);
        expect(result.hiddenCount).toBe(4);
    });
});

describe('filterBarViewOf — the ingredient typeahead', () => {
    it('is present with nothing typed and nothing selected', () => {
        expect(groupOf(filterBarViewOf(input(), copy), 'ingredients')).toEqual({
            kind: 'ingredients',
            label: 'Has ingredient',
            search: { kind: 'idle' },
            results: [],
            selected: [],
        });
    });

    it('offers only the results not already filtered on, each adding itself, and each selection removing itself', () => {
        const flour = food('flour', 'Flour');
        const sugar = food('sugar', 'Sugar');
        const viewState: FilterBarViewInput['viewState'] = { kind: 'results', results: [flour, sugar], isError: false };
        const view = filterBarViewOf(
            input({ filters: { ingredients: [{ foodId: 'food_flour', name: 'Flour' }] }, viewState }),
            copy,
        );

        expect(groupOf(view, 'ingredients')).toEqual({
            kind: 'ingredients',
            label: 'Has ingredient',
            search: viewState,
            results: [
                {
                    ingredient: sugar,
                    action: { kind: 'addIngredient', ingredient: { foodId: 'food_sugar', name: 'Sugar' } },
                },
            ],
            selected: [
                {
                    entry: { foodId: 'food_flour', name: 'Flour' },
                    action: { kind: 'removeIngredient', foodId: 'food_flour' },
                },
            ],
        });
    });

    it.each<[string, FilterBarViewInput['viewState']]>([
        ['searching', { kind: 'searching' }],
        ['too short', { kind: 'tooShort', minimum: 3 }],
        ['full', { kind: 'full', max: 5 }],
    ])('offers no results while %s', (_case, viewState) => {
        expect(groupOf(filterBarViewOf(input({ viewState }), copy), 'ingredients')).toMatchObject({
            results: [],
        });
    });
});

describe('filterBarViewOf — the Filters button, Clear all and the applied chips', () => {
    it('with nothing filtered: the bare button, no clear-all, a count of 0, no applied chips', () => {
        const view = filterBarViewOf(input(), copy);

        expect(view.activeCount).toBe(0);
        expect(view.triggerLabel).toBe('Filters');
        expect(view.triggerBadge).toBeUndefined();
        expect(view.hasActive).toBe(false);
        expect(view.applied).toEqual([]);
    });

    it('with filters: the counted name, and a visible “Filters · 2”', () => {
        const view = filterBarViewOf(input({ filters: { cuisine: 'Thai', tags: ['quick'] } }), copy);

        expect(view.activeCount).toBe(2);
        expect(view.triggerLabel).toBe('Filters, 2 active');
        expect(view.triggerBadge).toBe('Filters · 2');
    });

    it('names an applied chip by what it is, and removes it with the action that undoes it', () => {
        const view = filterBarViewOf(
            input({
                filters: {
                    maxTotalTime: 30,
                    maxPrepTime: 15,
                    dietaryFlags: ['vegan'],
                    cuisine: 'Thai',
                    tags: ['quick'],
                    ingredients: [{ foodId: 'food_flour', name: 'Flour' }],
                },
            }),
            copy,
        );

        expect(view.applied.map((entry) => [entry.label, entry.removeLabel])).toEqual([
            ['Under 30 min', 'Remove Under 30 min filter'],
            ['Prep: under 15 min', 'Remove Prep: under 15 min filter'],
            ['vegan', 'Remove vegan filter'],
            ['Thai', 'Remove Thai filter'],
            ['quick', 'Remove quick filter'],
            ['Flour', 'Remove Flour filter'],
        ]);
        expect(view.applied.map((entry) => entry.action)).toEqual([
            { kind: 'setTimeBound', field: 'maxTotalTime', minutes: undefined },
            { kind: 'setTimeBound', field: 'maxPrepTime', minutes: undefined },
            { kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' },
            { kind: 'setCuisine', cuisine: undefined },
            { kind: 'toggleFacet', dimension: 'tags', value: 'quick' },
            { kind: 'removeIngredient', foodId: 'food_flour' },
        ]);
    });

    it('one applied chip per active filter: the list is as long as the count', () => {
        const filters: FilterBarViewInput['filters'] = { cuisine: 'Thai', tags: ['a', 'b'], maxCookTime: 60 };
        const view = filterBarViewOf(input({ filters }), copy);

        expect(view.applied).toHaveLength(view.activeCount);
    });
});
