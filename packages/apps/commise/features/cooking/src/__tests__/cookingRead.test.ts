import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeStatus } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';

import { cookingReadOf, cookingReadSourceOf, useCookingRead, type CookingReadSource } from '../cookingRead.js';
import type { CookingRecipe } from '../cookingViewProps.js';
import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';

afterEach(cleanup);

const recipe: CookingRecipe = makeCookingRecipe({
    title: 'Weeknight roast',
    steps: [{ stepNumber: 1, instruction: 'Heat the oil.' }],
});

const retry = vi.fn();

const source = (over: Partial<CookingReadSource> = {}): CookingReadSource => ({
    recipeId: 'r1',
    subject: 'user-1',
    recipe: undefined,
    failure: undefined,
    viewer: { known: true, isOwner: false },
    retry,
    ...over,
});

describe('cookingReadOf: what the read is, in order', () => {
    it('is ready for a recipe once the viewer is known, and carries whether the viewer owns it', () => {
        expect(cookingReadOf(source({ recipe, viewer: { known: true, isOwner: true } }))).toEqual({
            kind: 'ready',
            recipe,
            viewerIsOwner: true,
        });
        expect(cookingReadOf(source({ recipe }))).toEqual({ kind: 'ready', recipe, viewerIsOwner: false });
    });

    it('is pending for a recipe whose viewer is not known yet, so no decision is taken on a guess', () => {
        expect(cookingReadOf(source({ recipe, viewer: { known: false, isOwner: false } }))).toEqual({
            kind: 'pending',
            retry,
        });
    });

    it('is gone for a missing recipe, and failed (offline or not) for any other failure', () => {
        expect(cookingReadOf(source({ failure: { gone: true, offline: false } }))).toEqual({ kind: 'gone' });
        expect(cookingReadOf(source({ failure: { gone: false, offline: true } }))).toEqual({
            kind: 'failed',
            offline: true,
            retry,
        });
        expect(cookingReadOf(source({ failure: { gone: false, offline: false } }))).toEqual({
            kind: 'failed',
            offline: false,
            retry,
        });
    });

    it('is pending with neither a recipe nor a failure', () => {
        expect(cookingReadOf(source())).toEqual({ kind: 'pending', retry });
    });

    it('lets a recipe win over a failure that came with it', () => {
        expect(cookingReadOf(source({ recipe, failure: { gone: false, offline: true } })).kind).toBe('ready');
    });
});

/** S20 and R-15: a cook who is on a step stays on it, whatever the next read says, until the cook changes. */
describe('useCookingRead: the hold', () => {
    const mount = (initial: CookingReadSource) =>
        renderHook(({ input }) => useCookingRead(input), { initialProps: { input: initial } });

    const ready = source({ recipe });
    const later: readonly (readonly [string, Partial<CookingReadSource>])[] = [
        ['pending', {}],
        ['failed', { failure: { gone: false, offline: true } }],
        ['gone', { failure: { gone: true, offline: false } }],
        ['a draft', { recipe: { ...recipe, status: RecipeStatus.DRAFT } }],
        ['blank steps', { recipe: { ...recipe, steps: [] } }],
    ];

    it.each(later)('keeps the first ready read when the next read is %s', (_name, over) => {
        const { result, rerender } = mount(ready);
        const first = result.current;
        expect(first.kind).toBe('ready');

        rerender({ input: source(over) });

        expect(result.current).toBe(first);
    });

    it('does not hold anything before the first ready', () => {
        const { result, rerender } = mount(source());
        expect(result.current.kind).toBe('pending');

        rerender({ input: source({ failure: { gone: true, offline: false } }) });

        expect(result.current).toEqual({ kind: 'gone' });
    });

    it('lets another recipe through', () => {
        const { result, rerender } = mount(ready);

        rerender({ input: source({ recipeId: 'r2', recipe: undefined }) });

        expect(result.current.kind).toBe('pending');
    });

    it('lets another cook through as pending, and holds the new cook’s first ready from then on', () => {
        const { result, rerender } = mount(ready);

        rerender({ input: source({ subject: 'user-2', viewer: { known: false, isOwner: false } }) });
        expect(result.current.kind).toBe('pending');

        rerender({ input: source({ subject: 'user-2', recipe }) });
        expect(result.current.kind).toBe('ready');

        rerender({ input: source({ subject: 'user-2', failure: { gone: true, offline: false } }) });
        expect(result.current.kind).toBe('ready');
    });

    it('does not hold a ready across a signed-out gap: no subject is a different cook', () => {
        const { result, rerender } = mount(ready);

        act(() => rerender({ input: source({ subject: undefined, viewer: { known: false, isOwner: false } }) }));

        expect(result.current.kind).toBe('pending');
    });
});

describe('cookingReadSourceOf: a settled recipe and who is looking, as the read facts', () => {
    const detail = makeRecipeDetail({ id: 'r1', ownerId: 'user-1', status: RecipeStatus.PUBLISHED });

    it('carries the recipe, the cook as the subject and the retry', () => {
        const made = cookingReadSourceOf(detail, { id: 'user-1', known: true }, retry);

        expect(made).toMatchObject({ recipeId: 'r1', subject: 'user-1', failure: undefined, retry });
        expect(made.recipe).toEqual({
            id: 'r1',
            title: detail.title,
            status: detail.status,
            steps: detail.steps,
            ingredients: detail.ingredients,
            servings: detail.servings,
        });
    });

    it('offers no recipe to cook when the last read was a 404, so a fresh mount shows it gone', () => {
        const made = cookingReadSourceOf(detail, { id: 'user-1', known: true }, retry, true);

        expect(made.recipe).toBeUndefined();
        expect(made.failure).toEqual({ gone: true, offline: false });
        expect(cookingReadOf(made)).toEqual({ kind: 'gone' });
    });

    it('keeps the recipe when the last read failed for any other reason (S43)', () => {
        const made = cookingReadSourceOf(detail, { id: 'user-1', known: true }, retry, false);

        expect(made.recipe).toBeDefined();
        expect(made.failure).toBeUndefined();
    });

    it.each([
        ['the owner', 'user-1', true, true],
        ['another cook', 'user-2', true, false],
        ['an unknown viewer who happens to hold the id', 'user-1', false, false],
        ['no id', undefined, true, false],
    ])('says %s is owner: %s', (_name, id, known, isOwner) => {
        expect(cookingReadSourceOf(detail, { id, known }, retry).viewer).toEqual({ known, isOwner });
    });
});
