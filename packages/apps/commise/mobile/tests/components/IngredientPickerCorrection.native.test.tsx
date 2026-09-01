/**
 * U14 — THE CORRECTION AFFORDANCE on the MOBILE ingredient picker (plan U14 / R19, R20), every state.
 *
 * The native half of `web/tests/components/recipes/IngredientPickerCorrection.test.tsx`, and it exists for a
 * reason beyond the enforced cross-platform rule: the two leaves are separate files with separate markup, so
 * "web renders the reach correctly" is no evidence at all about what a cook on a phone is told. The three
 * properties are the same, and each one is a way this feature can be silently useless or actively misleading:
 *
 *  1. ⛔ **The phrase sent is the one the user TYPED.** A curated mapping is only ever consulted under the key
 *     the resolution cascade looks up, which derives from the phrase `addByName` received — so a control that
 *     sent the suggestion's own name would write rows nothing queries, and the learning loop would appear to
 *     work while teaching nothing.
 *  2. ⛔ **The REACH is reported, and the two reaches read differently.** Author-scoped and global bindings are
 *     decided server-side from signed grants; one sentence for both would tell a curator they had made a
 *     private note when they had rewritten the phrase for every cook.
 *  3. ⚠️ **"Nothing was written" is a SUCCESS.** Re-asserting a binding already in force is idempotent by
 *     design, so it must never render with the `alert` role.
 *
 * Rendered via react-native-web under jsdom (`vitest.native.config.ts`), with the client hooks mocked — the
 * same seam the sibling native picker suites use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Ingredient } from '@kitchensink/recipe-core';
import {
    useAddIngredientByFood,
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useRecordIngredientCorrection,
    useResolveIngredient,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import type { IngredientSuggestion } from '@kitchensink/recipe-service-client';
import type { RecordCorrectionResponse } from '@kitchensink/schema-recipe';

import { recipeCorrectionMessages } from '@commise/features-recipes';
import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useSuggestIngredients: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useAddIngredientByFood: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientCandidates: vi.fn(),
    useResolveIngredient: vi.fn(),
    // U29 — idle by default: the on-demand source search must never run unless a test presses it.
    useSearchIngredientsLive: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
        data: undefined,
        error: undefined,
    })),
    useRecordIngredientCorrection: vi.fn(),
    // U16: the create-your-own-food mutation the picker now reads — inert idle default; these suites
    // never drive the create flow (IngredientPickerCreateFood.native.test.tsx owns those states).
    useCreateAuthoredFoodViaPicker: () => ({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
    }),
}));

const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useRecordIngredientCorrectionMock = vi.mocked(useRecordIngredientCorrection);

const m = recipeCorrectionMessages.en;

/** The phrase the cook types — deliberately NOT the name of any suggestion below. */
const PHRASE = 'plain flour';

/** The food the cook says the phrase should mean. */
const RIGHT_FOOD = '01JU14RIGHTFOOD0000000001';

/** The correction control's accessible name for {@link PHRASE}. */
const TEACH_LABEL = m.teachAction.replace('{phrase}', PHRASE);

/** A catalog suggestion: always food-backed, so always correctable. */
const catalogRow: IngredientSuggestion = {
    provenance: 'catalog',
    foodId: RIGHT_FOOD,
    name: 'Wheat flour, white, all-purpose',
    score: 0.9,
};

/** One of the caller's own rows, food-backed. */
const ownFoodBacked: Ingredient = makeIngredient({ id: 'ing_fb', name: 'Bread flour', foodId: 'food_wrong' });

/**
 * One of the caller's own rows with NO food behind it.
 *
 * ⛔ `foodId` is cleared EXPLICITLY: `makeIngredient` defaults to a resolved, FOOD-BACKED item, so a fixture
 * that only flips `isUserEntered` would still carry one — and would be offered the very control this case
 * asserts is absent, passing for the wrong reason.
 */
const ownFreeform: Ingredient = makeIngredient({
    id: 'ing_ff',
    name: 'Grandma’s flour blend',
    isUserEntered: true,
    foodId: undefined,
    foodResolutionStatus: undefined,
});

/** A `useSuggestIngredients` double carrying the given blended suggestions. */
const searchResult = (suggestions: readonly IngredientSuggestion[]): ReturnType<typeof useSuggestIngredients> =>
    ({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { suggestions, catalogAvailability: 'ok' },
    }) as unknown as ReturnType<typeof useSuggestIngredients>;

/** An inert mutation double for every hook this suite does not drive. */
const inertMutation = (): unknown => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() });

/** A `useRecordIngredientCorrection` double in the state under test. */
const correctionMutation = (
    overrides: { isPending?: boolean; isError?: boolean; data?: RecordCorrectionResponse } = {},
): ReturnType<typeof useRecordIngredientCorrection> =>
    ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: overrides.isPending ?? false,
        isError: overrides.isError ?? false,
        data: overrides.data,
    }) as unknown as ReturnType<typeof useRecordIngredientCorrection>;

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

beforeEach(() => {
    // The real `useIngredientResolver` debounces the query (REQ-057) through the unmocked `useDebouncedValue`,
    // so fake timers are what let each test cross that window deterministically.
    vi.useFakeTimers();
    vi.mocked(useAddIngredientByName).mockReturnValue(inertMutation() as never);
    vi.mocked(useAddIngredientByFood).mockReturnValue(inertMutation() as never);
    vi.mocked(useCreateIngredient).mockReturnValue(inertMutation() as never);
    vi.mocked(useResolveIngredient).mockReturnValue(inertMutation() as never);
    vi.mocked(useIngredientCandidates).mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: false,
        data: undefined,
    } as never);
    useRecordIngredientCorrectionMock.mockReturnValue(correctionMutation());
});

/** Render the picker with `suggestions` on offer and type {@link PHRASE} into the search box. */
function typeQuery(suggestions: readonly IngredientSuggestion[]): void {
    useSuggestIngredientsMock.mockReturnValue(searchResult(suggestions));
    render(<IngredientPicker onResolve={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: PHRASE } });
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
}

describe('mobile correction control — who can be taught, and with which phrase', () => {
    it('offers the control on a food-backed CATALOG suggestion', () => {
        typeQuery([catalogRow]);

        expect(screen.getAllByRole('button', { name: TEACH_LABEL }).length).toBeGreaterThan(0);
    });

    it('offers it on one of the caller’s OWN rows when that row is food-backed', () => {
        typeQuery([{ provenance: 'local', ingredient: ownFoodBacked }]);

        expect(screen.getAllByRole('button', { name: TEACH_LABEL }).length).toBeGreaterThan(0);
    });

    it('⛔ does NOT offer it on a freeform row, which has no food to bind the phrase to', () => {
        typeQuery([{ provenance: 'local', ingredient: ownFreeform }]);

        expect(screen.queryByRole('button', { name: TEACH_LABEL })).toBeNull();
    });

    // ⛔ THE CENTRAL ASSERTION. See property 1 in the module docstring.
    it('⛔ sends the TYPED phrase, the picked food and this surfacing — never the suggestion’s name', () => {
        const mutate = vi.fn();

        useRecordIngredientCorrectionMock.mockReturnValue({
            ...correctionMutation(),
            mutate,
        } as unknown as ReturnType<typeof useRecordIngredientCorrection>);
        typeQuery([catalogRow]);
        fireEvent.click(screen.getAllByRole('button', { name: TEACH_LABEL })[0] as HTMLElement);

        expect(mutate).toHaveBeenCalledWith({
            phrase: PHRASE,
            foodId: RIGHT_FOOD,
            surfacing: 'ingredient_picker',
        });
        expect(mutate.mock.calls[0]?.[0].phrase).not.toBe(catalogRow.name);
    });

    // ⚠️ Teaching is not picking: correcting must not silently add an ingredient the cook did not ask for.
    it('does not resolve a line when the control is pressed', () => {
        const onResolve = vi.fn();

        useSuggestIngredientsMock.mockReturnValue(searchResult([catalogRow]));
        render(<IngredientPicker onResolve={onResolve} />);
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: PHRASE } });
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        fireEvent.click(screen.getAllByRole('button', { name: TEACH_LABEL })[0] as HTMLElement);

        expect(onResolve).not.toHaveBeenCalled();
    });
});

describe('mobile correction control — every state it can be in', () => {
    it('renders NO notice before the cook has corrected anything', () => {
        typeQuery([catalogRow]);

        for (const text of [m.saving, m.savedForYou, m.savedForEveryone, m.alreadySaved, m.failed]) {
            expect(screen.queryByText(text)).toBeNull();
        }
    });

    it('announces the in-flight write and disables the control against a double submit', () => {
        useRecordIngredientCorrectionMock.mockReturnValue(correctionMutation({ isPending: true }));
        typeQuery([catalogRow]);

        expect(screen.getByText(m.saving)).toBeTruthy();
        expect(screen.getAllByRole('button', { name: TEACH_LABEL })[0]?.getAttribute('aria-disabled')).toBe('true');
    });

    it('reports a PERSONAL binding when the server scoped it to the author', () => {
        useRecordIngredientCorrectionMock.mockReturnValue(
            correctionMutation({ data: { recorded: true, mappingId: 'm-1', scope: 'author' } }),
        );
        typeQuery([catalogRow]);

        expect(screen.getByText(m.savedForYou)).toBeTruthy();
    });

    // ⛔ Property 2 — the sentence a curator sees must not claim the correction was private.
    it('⛔ reports a GLOBAL binding differently', () => {
        useRecordIngredientCorrectionMock.mockReturnValue(
            correctionMutation({ data: { recorded: true, mappingId: 'm-1', scope: 'global' } }),
        );
        typeQuery([catalogRow]);

        expect(screen.getByText(m.savedForEveryone)).toBeTruthy();
        expect(screen.queryByText(m.savedForYou)).toBeNull();
    });

    // ⚠️ Property 3.
    it.each([['already_in_force'] as const, ['superseded'] as const])(
        '⚠️ renders the no-op outcome %s without the alert role',
        (outcome) => {
            useRecordIngredientCorrectionMock.mockReturnValue(
                correctionMutation({ data: { recorded: false, outcome } }),
            );
            typeQuery([catalogRow]);

            expect(screen.getByText(m.alreadySaved)).toBeTruthy();
            expect(screen.queryByRole('alert')).toBeNull();
        },
    );

    it('renders a genuine failure as an ALERT, saying the ingredient was still added', () => {
        useRecordIngredientCorrectionMock.mockReturnValue(correctionMutation({ isError: true }));
        typeQuery([catalogRow]);

        expect(screen.getByRole('alert').textContent).toBe(m.failed);
    });
});
