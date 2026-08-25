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

import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '@commise/features-recipes';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import {
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useIngredientStatus,
    useRecordIngredientCorrection,
    useResolveIngredient,
    useAddIngredientByFood,
    useSuggestIngredients,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeEditor } from '../../src/screens/RecipeEditor.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSuggestIngredients: vi.fn(),
    useAddIngredientByFood: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientStatus: vi.fn(),
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
    // U14 — see the sibling screen suites: the picker in this tree now mounts the correction command too.
    useRecordIngredientCorrection: vi.fn(),
}));

const useSuggestIngredientsMock = vi.mocked(useSuggestIngredients);
const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientStatusMock = vi.mocked(useIngredientStatus);
const useIngredientCandidatesMock = vi.mocked(useIngredientCandidates);
const useResolveIngredientMock = vi.mocked(useResolveIngredient);
const useRecordIngredientCorrectionMock = vi.mocked(useRecordIngredientCorrection);

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
    useSuggestIngredientsMock.mockReset();
    useAddIngredientByFoodMock.mockReset();
    useAddIngredientByNameMock.mockReset();
    useCreateIngredientMock.mockReset();
    useIngredientStatusMock.mockReset();
    useIngredientCandidatesMock.mockReset();
    useResolveIngredientMock.mockReset();
    useRecordIngredientCorrectionMock.mockReset();
    useRecordIngredientCorrectionMock.mockReturnValue({
        mutate: () => undefined,
        isPending: false,
        isError: false,
        reset: () => undefined,
        data: undefined,
    } as unknown as ReturnType<typeof useRecordIngredientCorrection>);

    // Search Stage 2: the picker reads the BLENDED envelope, not a bare array. These screen suites do not
    // exercise the typeahead, so an empty, healthy-catalog envelope plus an inert admit mutation is enough.
    useSuggestIngredientsMock.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { suggestions: [], catalogAvailability: 'ok' },
    } as unknown as ReturnType<typeof useSuggestIngredients>);
    useAddIngredientByFoodMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddIngredientByFood>);
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
 * state) owns `values` AND the wizard's step for the now-fully-controlled `RecipeEditor` — the editor itself
 * holds no state. Seeded with a title so step 1 is valid and `Next` can reach step 2 (Ingredients), where
 * the picker under test lives.
 */
function ControlledEditor(): ReturnType<typeof RecipeEditor> {
    const [values, setValues] = useState<RecipeFormValues>({ ...defaultRecipeFormValues(), title: 'Quinoa Bowl' });
    const [step, setStep] = useState<RecipeWizardStep>(1);

    return (
        <RecipeEditor
            mode="create"
            values={values}
            onChange={setValues}
            submitting={false}
            step={step}
            canAdvanceFrom={(s) => canAdvanceFromStep(values, s)}
            stepErrors={(s) => stepErrorsFor(values, s)}
            goNext={() => {
                if (step < 4 && canAdvanceFromStep(values, step)) {
                    setStep((step + 1) as RecipeWizardStep);
                }
            }}
            goPrev={() => {
                if (step > 1) {
                    setStep((step - 1) as RecipeWizardStep);
                }
            }}
            goToStep={setStep}
            saveDraft={vi.fn()}
            publish={vi.fn()}
            isDirty={false}
            onCancel={vi.fn()}
            photosSlot={null}
        />
    );
}

/** Render the editor, navigate to step 2 (Ingredients), and add "Quinoa" through the addByName path. */
function addByNameFlow(added: ReturnType<typeof makeIngredient>): void {
    useAddIngredientByNameMock.mockReturnValue(addByNameMutation(added));

    render(<ControlledEditor />);

    fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
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

/**
 * U28 — the add-ingredient LOOP on mobile, and the cross-platform nutrition defect it repaired.
 *
 * ⛔ WHAT THIS COVERS THAT THE LEAF TESTS CANNOT. The leaf proves it raises a request and mutates nothing;
 * these prove the request LANDS — the editor answers it by focusing the picker's search field — and that a
 * resolved line arrives WHOLE.
 */
describe('RecipeEditor — the add-ingredient loop (U28)', () => {
    /** Render and land on step 2, where the picker and the ingredients leaf both live. */
    function goToIngredients(): void {
        // The picker reads this mutation's flags on every render, so it must be stubbed even for the tests
        // below that never resolve anything.
        useAddIngredientByNameMock.mockReturnValue(addByNameMutation(makeIngredient({ id: 'ing_unused' })));

        render(<ControlledEditor />);
        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
    }

    it('“+ Add ingredient” puts the caret in the picker’s search field', () => {
        goToIngredients();

        const search = screen.getByLabelText('Search ingredients');
        expect(document.activeElement).not.toBe(search);

        fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));

        // ⛔ THE WHOLE POINT OF THE UNIT. The button used to append a row that validation refused and the
        // wire mapper dropped; it now hands the cook the one control that can actually resolve a line.
        expect(document.activeElement).toBe(search);
    });

    it('⛔ and adds NO row — the list is untouched until the picker resolves something', () => {
        goToIngredients();

        fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));

        expect(screen.getByText('No ingredients yet. Add your first ingredient.')).toBeTruthy();
        expect(screen.queryByLabelText('Ingredient 1 name')).toBeNull();
        expect(screen.queryByText('Every ingredient needs an item picked from the list.')).toBeNull();
    });

    /**
     * ⛔ THE CROSS-PLATFORM DEFECT U28 REPAIRED, pinned so it cannot come back.
     *
     * The picker used to hand up a three-field `ResolvedIngredient` (`{ id, name, resolutionStatus? }`) and
     * this editor rebuilt the line from it — DROPPING `caloriesPer100g`/`proteinGPer100g`/`carbsGPer100g`/
     * `fatGPer100g`/`portions`, which `toIngredientLine` had just attached and which `lineCalories` and
     * `recipeNutritionTotal` read. A freshly picked ingredient therefore showed its calorie badge and fed
     * the running total on WEB and not here — a §14 cross-platform divergence no test could see, because the
     * two leaves are separate files with no compiler edge between them.
     */
    it('carries the picked line’s CATALOG NUTRITION onto the row (the web/mobile calorie divergence)', () => {
        addByNameFlow(
            makeIngredient({
                id: 'ing_food',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                caloriesPer100g: 368,
            }),
        );

        // State a mass the aggregator can convert (a unitless `1` has no mass factor, so it is honestly
        // uncountable) — the per-row figure then appears iff `caloriesPer100g` survived the append.
        fireEvent.change(screen.getByLabelText('Ingredient 1 quantity'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Ingredient 1 unit'), { target: { value: 'g' } });

        expect(screen.getByText('368 cal')).toBeTruthy();
        // And it reaches the running total too — the same fields, read by the other aggregator.
        expect(screen.getByText('Total nutrition (per serving): 368 cal | 0g P | 0g C | 0g F')).toBeTruthy();
    });

    it('a second pick INHERITS the section the cook is building (U27’s rule, on the working path)', () => {
        addByNameFlow(
            makeIngredient({ id: 'ing_a', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        fireEvent.change(screen.getByLabelText('Ingredient 1 section'), { target: { value: 'For the bowl' } });
        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'Kale' } });
        fireEvent.click(screen.getByRole('button', { name: 'Find nutrition for “Kale”' }));

        // ⛔ U27 put this rule on the DEAD "+ Add ingredient" path, so the picker path — the only one that
        // can finish — silently lost sectioning. This is the assertion that would have caught that.
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 2 section').value).toBe('For the bowl');
    });

    it('a resolved row wears NO “no food chosen” note', () => {
        addByNameFlow(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        expect(
            screen.queryByText(
                'No food chosen — this line won’t be saved. Remove it and add it from the search above.',
            ),
        ).toBeNull();
    });
});
