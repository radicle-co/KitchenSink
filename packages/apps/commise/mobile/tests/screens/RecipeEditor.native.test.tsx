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
 *
 * Three further suites live below, one per unit that reshaped this screen, deliberately kept in this ONE
 * file because they all assert against the SAME composing screen and share its harness:
 *   - U28 — the add-ingredient LOOP: "+ Add ingredient" focuses the picker and appends nothing by itself,
 *     and a picked line arrives WHOLE (its catalog nutrition survived the append — the cross-platform
 *     divergence U28 repaired) and INHERITS the section being built.
 *   - U32 — the action bar is pinned OUTSIDE the step `ScrollView` (a DOM-ancestry assertion, because
 *     nothing inside `Wizard.Controls` can enforce its own placement).
 *   - U33 — the step model: step 4 is Review, and the caller's photo surface renders on step 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';

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
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
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
    // Defaulted here as well as inside `addByNameFlow` (which overrides it with a scripted mutation): the
    // U32/U33 layout suites below walk THROUGH step 2 without exercising the typeahead, and an unmocked
    // `useAddIngredientByName` leaves the picker reading `.isPending` off `undefined`.
    useAddIngredientByNameMock.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddIngredientByName>);
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
function ControlledEditor({
    photosSlot = null,
    initialValues,
}: {
    readonly photosSlot?: ReactNode;
    readonly initialValues?: RecipeFormValues;
} = {}): ReturnType<typeof RecipeEditor> {
    const [values, setValues] = useState<RecipeFormValues>(
        initialValues ?? { ...defaultRecipeFormValues(), title: 'Quinoa Bowl' },
    );
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
            photosSlot={photosSlot}
        />
    );
}

/**
 * The same editor seeded with 30 resolved ingredient lines — the concrete shape U32's pinned bar exists for.
 * The list is long enough that, before the fix, the primary control sat below every one of those rows.
 */
function LongIngredientEditor(): ReturnType<typeof RecipeEditor> {
    return (
        <ControlledEditor
            initialValues={{
                ...defaultRecipeFormValues(),
                title: 'Thirty-ingredient stew',
                ingredients: Array.from({ length: 30 }, (_unused, index) => ({
                    ingredientId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
                    name: `Ingredient ${index + 1}`,
                    quantity: 1,
                    unit: 'g',
                })),
                steps: [{ instruction: 'Simmer.' }],
            }}
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

/**
 * U32 — THE PINNED ACTION BAR, and the shipped defect it fixes.
 *
 * ⛔ `Wizard.Controls` used to be rendered INSIDE this screen's single `ScrollView`, together with the rail
 * and all four step bodies. On a recipe with a long ingredient list that put the primary control BELOW the
 * whole list: a cook had to scroll past every ingredient to reach `Next`. `useScrollResetOnChange` exists
 * because four Maestro flows caught the downstream consequence — advancing then left the cook at the BOTTOM
 * of the next step, with its heading off-screen.
 *
 * ⚠️ **Nothing inside `Wizard.Controls` can enforce its own placement**, which is exactly why the assertion
 * lives here, against the composing screen. It is a DOM-ancestry check rather than a style check, because
 * "outside the scroll container" is a structural fact and jsdom has no layout to measure.
 *
 * This is one of the two mandatory mutants for this unit: moving `<Wizard.Controls />` back inside the
 * `<ScrollView>` must fail here.
 */
describe('RecipeEditor — the action bar is pinned OUTSIDE the scroller (U32)', () => {
    /** The one `ScrollView` this screen owns, found by the rail it wraps. */
    const scroller = (): HTMLElement => {
        const rail = screen.getByLabelText('Recipe wizard steps');
        const found = rail.closest('[class]')?.parentElement ?? null;

        if (found === null) {
            throw new Error('could not locate the step scroller');
        }

        return found;
    };

    it('does not render the action bar inside the element that scrolls the step body', () => {
        render(<ControlledEditor />);

        const bar = screen.getByLabelText('Wizard step navigation');

        expect(scroller().contains(bar)).toBe(false);
    });

    it('keeps the rail INSIDE the scroller, so only the bar was lifted out', () => {
        // A mutation that simply hoisted everything out of the ScrollView would satisfy the case above while
        // destroying the step body's scrolling. The rail must still scroll away; the bar must not.
        render(<ControlledEditor />);

        expect(scroller().contains(screen.getByLabelText('Recipe wizard steps'))).toBe(true);
    });

    it('keeps the bar reachable on EVERY step, including one with a long ingredient list', () => {
        // The concrete regression: 30 ingredients on step 2. In jsdom nothing is off-screen, so what is
        // asserted is the structural property that makes it reachable — the bar is not a descendant of the
        // scroller those 30 rows live in.
        render(<LongIngredientEditor />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        const bar = screen.getByLabelText('Wizard step navigation');

        expect(screen.getByLabelText('Next: Instructions')).toBeTruthy();
        expect(scroller().contains(bar)).toBe(false);
    });
});

describe('RecipeEditor — the U33 step model', () => {
    it('renders the Review body on step 4, and no Photos step remains', () => {
        // A COMPLETE draft, because `goNext` is gated by `canAdvanceFromStep` and voices its refusal — an
        // empty draft cannot leave step 2 at all, which is shipped behaviour this test must not fight.
        render(<LongIngredientEditor />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
        fireEvent.click(screen.getByLabelText(/Next: Instructions/));
        fireEvent.click(screen.getByLabelText(/Next: Review/));

        expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
        expect(screen.queryByLabelText(/Next: Photos/)).toBeFalsy();
    });

    it('places the caller-supplied photo surface on step 1, beside the other Details fields', () => {
        // ⛔ U33's ruling: photos behave like every other field. Rendering the uploader on step 1 is what
        // stops the create path showing "save this recipe first" where a control should be.
        render(<ControlledEditor photosSlot={<Text>Photo manager</Text>} />);

        expect(screen.getByText('Photo manager')).toBeTruthy();
    });

    it('does not render the photo surface on any later step', () => {
        render(<ControlledEditor photosSlot={<Text>Photo manager</Text>} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.queryByText('Photo manager')).toBeFalsy();
    });
});
