/**
 * Component tests for the mobile RecipeEditor's async-ingredient wiring (T067 / data-model R5), rendered via
 * react-native-web under jsdom. The editor is the shared create/edit state layer: it appends resolved
 * ingredient lines from the picker CARRYING their real resolution status, and drives poll-after-add — a line
 * added `PENDING` is polled (via the per-line status poller) and its badge flips to `RESOLVED`.
 *
 * These two behaviours are pinned adversarially:
 *   - the appended line keeps the picker's ACTUAL status (a regression that hardcoded `RESOLVED` would badge a
 *     still-resolving line wrong and never poll it);
 *   - the poll's `RESOLVED` result is applied to the line's badge (poll-after-add).
 * The recipe-service hooks are mocked, so no backend / QueryClient is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { defaultRecipeFormValues, type RecipeFormValues } from '@commise/features-recipes';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import {
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useIngredientStatus,
    useResolveIngredient,
    useSearchIngredients,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeEditor } from '../../src/screens/RecipeEditor.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSearchIngredients: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientStatus: vi.fn(),
    useIngredientCandidates: vi.fn(),
    useResolveIngredient: vi.fn(),
}));

const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientStatusMock = vi.mocked(useIngredientStatus);
const useIngredientCandidatesMock = vi.mocked(useIngredientCandidates);
const useResolveIngredientMock = vi.mocked(useResolveIngredient);

/** An add-by-name mutation whose `mutate` invokes `onSuccess` with `added`. */
function addByNameMutation(added: ReturnType<typeof makeIngredient>): ReturnType<typeof useAddIngredientByName> {
    return {
        mutate: vi.fn((_name: string, options?: { onSuccess?: (v: typeof added) => void }) => {
            options?.onSuccess?.(added);
        }),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddIngredientByName>;
}

afterEach(cleanup);

beforeEach(() => {
    useSearchIngredientsMock.mockReset();
    useAddIngredientByNameMock.mockReset();
    useCreateIngredientMock.mockReset();
    useIngredientStatusMock.mockReset();
    useIngredientCandidatesMock.mockReset();
    useResolveIngredientMock.mockReset();

    useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, data: [] } as unknown as ReturnType<
        typeof useSearchIngredients
    >);
    useCreateIngredientMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useCreateIngredient>);
    useIngredientStatusMock.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useIngredientStatus>);
    useIngredientCandidatesMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: false,
        data: undefined,
    } as unknown as ReturnType<typeof useIngredientCandidates>);
    useResolveIngredientMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useResolveIngredient>);
});

/**
 * A stateful wrapper mirroring how a real caller (`useRecipeEditor`, or the create screen's own local
 * state) owns `values` for the now-fully-controlled `RecipeEditor` — the editor itself holds no state.
 */
function ControlledEditor(): ReturnType<typeof RecipeEditor> {
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues());

    return (
        <RecipeEditor
            mode="create"
            values={values}
            onChange={setValues}
            submitting={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
        />
    );
}

/** Render the editor and add "Quinoa" through the addByName (find-nutrition) path. */
function addByNameFlow(added: ReturnType<typeof makeIngredient>): void {
    useAddIngredientByNameMock.mockReturnValue(addByNameMutation(added));

    render(<ControlledEditor />);

    fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Quinoa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find nutrition for “Quinoa”' }));
}

describe('RecipeEditor — async ingredient add + poll-after-add', () => {
    it('appends the line with its ACTUAL PENDING status (not a hardcoded RESOLVED)', () => {
        // The poll stays PENDING → the badge must reflect the line's real status, "Resolving…".
        addByNameFlow(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );

        expect(screen.getByLabelText('Ingredient 1 status')).toBeTruthy();
        expect(screen.getByText('Resolving…')).toBeTruthy();
    });

    it('poll-after-add: a PENDING line whose poll returns RESOLVED shows the RESOLVED badge', () => {
        // The per-line poller sees the food has RESOLVED — this is what must flip the line's badge.
        useIngredientStatusMock.mockReturnValue({
            data: makeIngredient({
                id: 'ing_food',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        } as unknown as ReturnType<typeof useIngredientStatus>);

        addByNameFlow(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );

        // Mutation lens: had the poller not applied the RESOLVED status to the line, the badge would still
        // read the PENDING label "Resolving…".
        expect(screen.getByText('Resolved')).toBeTruthy();
        expect(screen.queryByText('Resolving…')).toBeNull();
    });
});
