/**
 * The cooking ingredients hook as the NATIVE lane resolves it (react-native-web over jsdom, the memory marks backend), over the REAL cook marks and serving scale the recipe page also reads, so a tick or a
 * servings change made here shows on the page and the reverse. Nothing is mocked: the provider keeps its marks in
 * memory on native, as the app root mounts it. Each case uses its own recipe id, because the serving scale is a module
 * singleton keyed by recipe.
 */
import { resolveMessages } from '@commise/i18n';
import { CookMarksProvider, useCookMarks, useServingScale } from '@commise/features-recipes/cook';
import { ABSENT_QUANTITY, statedQuantity, type RecipeIngredientView } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { cookingMessages } from '../../messages.js';
import { useCookingIngredients } from '../useCookingIngredients.js';

const copy = resolveMessages(cookingMessages, 'en');

const line = (id: string, name: string, quantity = 1): RecipeIngredientView => ({
    ingredientId: id,
    name,
    quantity: statedQuantity(quantity) ?? ABSENT_QUANTITY,
    isUserEntered: false,
});

const BUTTER = line('ing_butter', 'butter');
const LEMON = line('ing_lemon', 'lemon');
const SALT = line('ing_salt', 'salt');
const LINES = [BUTTER, LEMON, SALT];

const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test">{children}</CookMarksProvider>
);

let counter = 0;
const nextId = (): string => `rec_hook_${String((counter += 1))}`;

afterEach(() => {
    window.sessionStorage.clear();
});

/** The hook under test beside the two bindings the recipe page reads, for one recipe. */
function mount(recipeId: string, ingredients: readonly RecipeIngredientView[] = LINES, servings = 2) {
    return renderHook(
        (props: { readonly ingredients: readonly RecipeIngredientView[] }) => ({
            cooking: useCookingIngredients({
                recipe: { id: recipeId, ingredients: props.ingredients, servings },
                copy,
                locale: 'en',
            }),
            marks: useCookMarks(recipeId),
            scale: useServingScale(recipeId, servings),
        }),
        { wrapper: Wrapper, initialProps: { ingredients } },
    );
}

const checkedOf = (result: ReturnType<typeof mount>['result']): readonly string[] =>
    result.current.cooking.view.kind === 'list'
        ? result.current.cooking.view.rows.filter((row) => row.checked).map((row) => row.ingredient.ingredientId)
        : [];

describe('useCookingIngredients', () => {
    it('shares its ticks with the recipe page in both directions', () => {
        const { result } = mount(nextId());

        act(() => {
            result.current.cooking.toggle('ing_butter');
        });
        expect([...result.current.marks.checkedLines]).toEqual(['ing_butter']);

        act(() => {
            result.current.marks.toggleLine('ing_lemon');
        });
        expect(checkedOf(result)).toEqual(['ing_butter', 'ing_lemon']);

        act(() => {
            result.current.cooking.toggle('ing_butter');
        });
        expect([...result.current.marks.checkedLines]).toEqual(['ing_lemon']);
    });

    it('opens at the servings the page already chose, and the page sees the servings chosen here', () => {
        const id = nextId();
        const page = renderHook(() => useServingScale(id, 2), { wrapper: Wrapper });

        act(() => {
            page.result.current.setServings(6);
        });

        const { result } = mount(id);

        expect(result.current.cooking.view.kind === 'list' ? result.current.cooking.view.servings : undefined).toBe(6);

        act(() => {
            result.current.cooking.setServings(8);
        });

        expect(result.current.scale.servings).toBe(8);
        expect(result.current.cooking.view.kind === 'list' ? result.current.cooking.view.servings : undefined).toBe(8);
    });

    it('clears the ticks and keeps the step the cook is on', () => {
        const { result } = mount(nextId());

        act(() => {
            result.current.marks.toggleStep(3);
            result.current.cooking.toggle('ing_butter');
        });
        act(() => {
            result.current.cooking.clearTicks();
        });

        expect(result.current.marks.currentStep).toBe(3);
        expect(result.current.marks.checkedLines.size).toBe(0);
    });

    it('undoes a clear by adding the cleared ticks back and removing none', () => {
        const { result } = mount(nextId());
        let undo: () => void = () => undefined;

        act(() => {
            result.current.cooking.toggle('ing_butter');
            result.current.cooking.toggle('ing_lemon');
        });
        act(() => {
            undo = result.current.cooking.clearTicks();
        });
        act(() => {
            result.current.cooking.toggle('ing_salt');
        });
        act(() => {
            undo();
        });

        expect(new Set(checkedOf(result))).toEqual(new Set(['ing_butter', 'ing_lemon', 'ing_salt']));
    });

    it('keeps its rows when the recipe changes underneath it', () => {
        const { result, rerender } = mount(nextId());
        const idsOf = (): readonly string[] =>
            result.current.cooking.view.kind === 'list'
                ? result.current.cooking.view.rows.map((row) => row.ingredient.ingredientId)
                : [];
        const before = idsOf();

        rerender({ ingredients: [SALT, line('ing_new', 'new line'), BUTTER] });
        // A servings change recomputes the view, so a hook that read the live lines would show them now.
        act(() => {
            result.current.cooking.setServings(3);
        });

        expect(idsOf()).toEqual(before);
    });
});
