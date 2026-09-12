/**
 * The filter bar's view (`filterBarViewOf`), which both `RecipeFilterBar` leaves draw: the facets in display order, the
 * chips a group offers and what pressing each asks for, the active time bucket and its toggle, the typeahead results
 * not already filtered on, and the trigger and clear-all copy.
 */
import type { RecipeFacetCount } from '@kitchensink/recipe-core';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import { describe, expect, it } from 'vitest';

import { filterBarViewOf, type FacetGroupView, type FilterBarViewInput } from '../filterBarView.js';
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

/** The group a slot holds, by the slot's id. */
const groupOf = (view: ReturnType<typeof filterBarViewOf>, id: string): FacetGroupView | undefined =>
    view.slots.find((slot) => slot.id === id)?.group;

describe('filterBarViewOf — the facets', () => {
    it('lists every facet, in display order', () => {
        expect(filterBarViewOf(input(), copy, 'en').slots.map((slot) => slot.id)).toEqual([
            'dietaryFlags',
            'cuisine',
            'tags',
            'maxPrepTime',
            'maxCookTime',
            'maxTotalTime',
            'ingredients',
        ]);
    });

    it.each(['dietaryFlags', 'cuisine', 'tags'])('a chip group with nothing to offer is absent: %s', (id) => {
        expect(groupOf(filterBarViewOf(input(), copy, 'en'), id)).toBeUndefined();
    });

    it('a multi-select group offers its chips, each named with its count, each toggling its value', () => {
        const view = filterBarViewOf(
            input({
                facets: { dietaryFlags: [bucket('vegan', 4), bucket('paleo', 1)] },
                filters: { dietaryFlags: ['paleo'] },
            }),
            copy,
            'en',
        );

        expect(groupOf(view, 'dietaryFlags')).toEqual({
            kind: 'chips',
            label: 'Dietary',
            chips: [
                {
                    chip: { value: 'vegan', count: 4, selected: false },
                    name: 'vegan, 4 recipes',
                    action: { kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'vegan' },
                },
                {
                    chip: { value: 'paleo', count: 1, selected: true },
                    name: 'paleo, 1 recipe',
                    action: { kind: 'toggleFacet', dimension: 'dietaryFlags', value: 'paleo' },
                },
            ],
        });
    });

    it('the tags group toggles the tags dimension, not the dietary one', () => {
        const view = filterBarViewOf(input({ facets: { tags: [bucket('quick', 2)] } }), copy, 'en');

        expect(groupOf(view, 'tags')).toMatchObject({
            label: 'Tags',
            chips: [{ action: { kind: 'toggleFacet', dimension: 'tags', value: 'quick' } }],
        });
    });

    it('the single-select cuisine group marks the chosen cuisine and sets the one pressed', () => {
        const view = filterBarViewOf(
            input({ facets: { cuisine: [bucket('Thai', 3), bucket('Greek', 2)] }, filters: { cuisine: 'Greek' } }),
            copy,
            'en',
        );

        expect(groupOf(view, 'cuisine')).toEqual({
            kind: 'chips',
            label: 'Cuisine',
            chips: [
                {
                    chip: { value: 'Thai', count: 3, selected: false },
                    name: 'Thai, 3 recipes',
                    action: { kind: 'setCuisine', cuisine: 'Thai' },
                },
                {
                    chip: { value: 'Greek', count: 2, selected: true },
                    name: 'Greek, 2 recipes',
                    action: { kind: 'setCuisine', cuisine: 'Greek' },
                },
            ],
        });
    });

    it('a selected value the search returned no bucket for still offers its chip, named by its value alone', () => {
        const view = filterBarViewOf(input({ filters: { tags: ['spicy'] } }), copy, 'en');

        expect(groupOf(view, 'tags')).toMatchObject({ chips: [{ name: 'spicy', chip: { selected: true } }] });
    });
});

describe('filterBarViewOf — the time buckets', () => {
    it.each<[string, 'maxPrepTime' | 'maxCookTime' | 'maxTotalTime', string]>([
        ['prep', 'maxPrepTime', 'Prep time'],
        ['cook', 'maxCookTime', 'Cook time'],
        ['total', 'maxTotalTime', 'Total time'],
    ])('the %s ladder: the active bucket toggles off, every other sets its bound', (_case, field, label) => {
        const view = filterBarViewOf(input({ filters: { [field]: 30 } }), copy, 'en');

        expect(groupOf(view, field)).toEqual({
            kind: 'timeBuckets',
            label,
            buckets: [
                {
                    minutes: 15,
                    label: 'Under 15 min',
                    active: false,
                    action: { kind: 'setTimeBound', field, minutes: 15 },
                },
                {
                    minutes: 30,
                    label: 'Under 30 min',
                    active: true,
                    action: { kind: 'setTimeBound', field, minutes: undefined },
                },
                {
                    minutes: 60,
                    label: 'Under 60 min',
                    active: false,
                    action: { kind: 'setTimeBound', field, minutes: 60 },
                },
            ],
        });
    });
});

describe('filterBarViewOf — the ingredient typeahead', () => {
    it('is present with nothing typed and nothing selected', () => {
        expect(groupOf(filterBarViewOf(input(), copy, 'en'), 'ingredients')).toEqual({
            kind: 'ingredients',
            label: 'Ingredients',
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
            'en',
        );

        expect(groupOf(view, 'ingredients')).toEqual({
            kind: 'ingredients',
            label: 'Ingredients',
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
        expect(groupOf(filterBarViewOf(input({ viewState }), copy, 'en'), 'ingredients')).toMatchObject({
            results: [],
        });
    });
});

describe('filterBarViewOf — the trigger and clear-all', () => {
    it('with nothing filtered: the bare trigger, no clear-all, a count of 0', () => {
        const view = filterBarViewOf(input(), copy, 'en');

        expect(view.activeCount).toBe(0);
        expect(view.triggerLabel).toBe('Filters');
        expect(view.clearAllLabel).toBeUndefined();
    });

    it.each<[string, FilterBarViewInput['filters'], number, string, string]>([
        ['one filter', { cuisine: 'Thai' }, 1, 'Filters, 1 active', 'Clear 1 filter'],
        ['three filters', { cuisine: 'Thai', tags: ['quick', 'easy'] }, 3, 'Filters, 3 active', 'Clear 3 filters'],
    ])('with %s: the counted trigger and the counted clear-all', (_case, filters, count, trigger, clearAll) => {
        const view = filterBarViewOf(input({ filters }), copy, 'en');

        expect(view.activeCount).toBe(count);
        expect(view.triggerLabel).toBe(trigger);
        expect(view.clearAllLabel).toBe(clearAll);
    });
});
