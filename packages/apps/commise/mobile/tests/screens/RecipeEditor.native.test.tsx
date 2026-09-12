/**
 * Component tests for the mobile RecipeEditor's async-ingredient wiring (T067 / data-model R5), rendered via
 * react-native-web under jsdom. The editor is the shared create/edit state layer: it appends resolved
 * ingredient lines picked in the trailing add row CARRYING their real resolution status, and drives poll-after-add — a
 * line added `PENDING` is polled (via the per-line status poller) and its badge flips to `RESOLVED`.
 *
 * These two behaviours are pinned adversarially:
 *   - the appended line keeps the admission's ACTUAL status (a regression that hardcoded `RESOLVED` would badge a
 *     still-resolving line wrong and never poll it);
 *   - the poll's `RESOLVED` result is applied to the line's badge (poll-after-add).
 * The recipe-service hooks are mocked; the trailing add row's search reads a real food client over a fetch double.
 *
 * Three further suites live below, one per unit that reshaped this screen, deliberately kept in this ONE
 * file because they all assert against the SAME composing screen and share its harness:
 *   - U28 — the add-ingredient LOOP, on the trailing add row (plan 002 V1 B8): typing appends nothing, and a picked
 *     line arrives WHOLE (its food ref survived the append — the cross-platform divergence U28 repaired) and
 *     INHERITS the section being built.
 *   - U32 — the action bar is pinned OUTSIDE the step `ScrollView` (a DOM-ancestry assertion, because
 *     nothing inside `Wizard.Controls` can enforce its own placement).
 *   - U33 — the step model: step 4 is Review, and the caller's photo surface renders on step 1.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { createElement, useState, type ReactElement, type ReactNode } from 'react';
import { Text } from 'react-native';

/**
 * The one `ResizeObserver` react-native-web creates for `onLayout`, recorded so a test can report the editor's layout
 * through it (jsdom lays nothing out). Installed before any render, so react-native-web's lazily created observer is
 * this one.
 */
const observer = vi.hoisted(() => {
    const recorded = { callback: undefined as ResizeObserverCallback | undefined, observed: new Set<Element>() };

    globalThis.ResizeObserver = class {
        public constructor(callback: ResizeObserverCallback) {
            recorded.callback = callback;
        }

        public observe(target: Element): void {
            recorded.observed.add(target);
        }

        public unobserve(target: Element): void {
            recorded.observed.delete(target);
        }

        public disconnect(): void {
            recorded.observed.clear();
        }
    } as unknown as typeof ResizeObserver;

    return recorded;
});

// The `KeyboardAvoidingView` wrapper is replaced with a labelled sentinel so a test can assert it is there, carrying its
// `behavior`. Same device `login.native.test.tsx` uses — jsdom renders neither, so the wrapper is otherwise invisible.
// The platform is react-native-web's unless a test sets it.
const platform = vi.hoisted(() => ({ os: undefined as 'android' | undefined }));
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os ?? actual.Platform.OS;
            },
        },
        KeyboardAvoidingView: ({ children, behavior }: { readonly children?: unknown; readonly behavior?: string }) =>
            createElement('div', { 'aria-label': 'keyboard-avoiding', 'data-behavior': behavior }, children as never),
    };
});

import {
    applyDraftAction,
    canAdvanceFromStep,
    gateOutcomeOf,
    defaultRecipeFormValues,
    stepErrorsFor,
    toRecipeFormValues,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '@commise/features-recipes';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import {
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientFoodNutrition,
    useIngredientStatus,
    useAddIngredientByFood,
} from '@kitchensink/recipe-service-client/hooks';

import { dialogTitled, withFoodClient } from '@commise/test-utils';
import { BackInterceptProvider } from '@commise/ui/back-intercept';

import { RecipeEditor } from '../../src/screens/RecipeEditor.js';
import { makeIngredient, makeIngredientView, makeRecipeDetail } from '../__fixtures__/recipes.js';

/**
 * Render `ui` inside the back-intercept provider.
 *
 * The editor installs a hardware-back interceptor, and `useBackIntercept` THROWS without a provider above it
 * — deliberately, so a back guard can never be silently absent. In the app that provider is `RecipesScreen`'s,
 * which wraps every pushed surface; here it is supplied directly. `onUnhandled` answers `false`, standing in
 * for a host with nothing left to pop.
 */
function render(ui: ReactElement) {
    // Plan 002 V1: a FAILED row's Try again (`useLookupRetry`) reads through the query cache, as the app's root does.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return rtlRender(
        <QueryClientProvider client={queryClient}>
            <BackInterceptProvider onUnhandled={() => false}>{withFoodClient(ui)}</BackInterceptProvider>
        </QueryClientProvider>,
    );
}

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // Plan 002 V1 B7 — the row editor's commit port reads these two as well. Inert: these suites commit no row pick.
    useAddIngredientByFoodVariant: () => ({ mutateAsync: () => new Promise(() => undefined), isPaused: false }),
    useRebindIngredientLine: () => ({ mutateAsync: () => new Promise(() => undefined), isPaused: false }),
    // Plan 002 V1 B5 — the editor's one background nutrition read. Answered empty: these suites do not read figures.
    useIngredientFoodNutrition: vi.fn(() => ({
        data: { entries: [] },
        isPlaceholderData: false,
        isError: false,
        refetch: async () => undefined,
    })),
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useAddIngredientByFood: vi.fn(),
    useAddIngredientByName: vi.fn(),
    useCreateIngredient: vi.fn(),
    useIngredientStatus: vi.fn(),
}));

/** The text of every matched ingredient's name on the screen, in row order. */
const matchedNames = (): readonly (string | null)[] =>
    screen.queryAllByRole('group', { name: /^Ingredient \d+ name$/ }).map((name) => name.textContent);

const useAddIngredientByFoodMock = vi.mocked(useAddIngredientByFood);
const useAddIngredientByNameMock = vi.mocked(useAddIngredientByName);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);
const useIngredientStatusMock = vi.mocked(useIngredientStatus);

/** An admission mutation whose `mutateAsync` answers `answer`, as `useLineCommit` sends it. */
function admission<T>(answer: () => Promise<ReturnType<typeof makeIngredient>>): T {
    return {
        mutateAsync: vi.fn(answer),
        isPending: false,
        isPaused: false,
        isError: false,
        reset: vi.fn(),
    } as unknown as T;
}

/** An add-by-name mutation that admits `added`. */
const addByNameMutation = (added: ReturnType<typeof makeIngredient>): ReturnType<typeof useAddIngredientByName> =>
    admission(async () => added);

/** An admission that never answers: the row editor reads its flags even when nothing is picked. */
const idleAdmission = <T,>(): T => admission<T>(() => new Promise(() => undefined));

afterEach(() => {
    cleanup();
    platform.os = undefined;
});

beforeEach(() => {
    useAddIngredientByFoodMock.mockReset();
    useAddIngredientByNameMock.mockReset();
    useCreateIngredientMock.mockReset();
    useIngredientStatusMock.mockReset();

    // The row editor's commit port reads every admission's flags on each render, so each is stubbed, idle, even for
    // the suites below that pick nothing.
    useAddIngredientByFoodMock.mockReturnValue(idleAdmission());
    useCreateIngredientMock.mockReturnValue(idleAdmission());
    useAddIngredientByNameMock.mockReturnValue(idleAdmission());
    useIngredientStatusMock.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useIngredientStatus>);
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
            dispatch={(action) => {
                setValues((current) => applyDraftAction(current, action));
            }}
            lineCommand={undefined}
            submitting={false}
            step={step}
            canAdvanceFrom={(s, pendingEntryText) => canAdvanceFromStep(values, s, pendingEntryText)}
            stepErrors={(s, pendingEntryText) => stepErrorsFor(values, s, pendingEntryText)}
            goNext={(pendingEntryText) => {
                const outcome = gateOutcomeOf(stepErrorsFor(values, step, pendingEntryText));

                if (outcome.kind === 'send' && step < 4) {
                    setStep((step + 1) as RecipeWizardStep);
                }

                return outcome;
            }}
            goPrev={() => {
                if (step > 1) {
                    setStep((step - 1) as RecipeWizardStep);
                }
            }}
            goToStep={setStep}
            saveDraft={vi.fn(() => ({ kind: 'send' }) as const)}
            publish={vi.fn(() => ({ kind: 'send' }) as const)}
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
                // Seeded through the ONE seed adapter, so each line carries the identity a loaded recipe gives it.
                ingredients: toRecipeFormValues(
                    makeRecipeDetail({
                        ingredients: Array.from({ length: 30 }, (_unused, index) =>
                            makeIngredientView({
                                ingredientId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
                                name: `Ingredient ${index + 1}`,
                                quantity: { kind: 'exact', value: 1 },
                                unit: 'g',
                            }),
                        ),
                    }),
                ).ingredients,
                steps: [{ instruction: 'Simmer.' }],
            }}
        />
    );
}

/** In the trailing add row, type `text` and choose `option` from its list; the commit lands. */
async function pickInTrailingRow(text: string, option: string): Promise<void> {
    fireEvent.change(screen.getByLabelText('Add an ingredient'), { target: { value: text } });
    const choice = await screen.findByRole('button', { name: option });

    await act(async () => {
        fireEvent.click(choice);
    });
}

/** Render the editor, navigate to step 2 (Ingredients), and add "Quinoa" through Find nutrition (the addByName path). */
async function addByNameFlow(added: ReturnType<typeof makeIngredient>): Promise<void> {
    useAddIngredientByNameMock.mockReturnValue(addByNameMutation(added));

    render(<ControlledEditor />);

    fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
    await pickInTrailingRow('Quinoa', 'Find nutrition for “Quinoa”');
}

describe('RecipeEditor — async ingredient add + poll-after-add', () => {
    /**
     * The premise of the device flow `.maestro/recipes/ingredientUnmatched.yaml` (plan 002 US1): the freeform
     * "Use “…” as written" path adds a DECLARED line, which the row policy shows as SPECIFY.1 row 1 — the status word
     * "Your own wording" and an info glyph that explains there is no nutrition. If this fails, that flow is wrong.
     */
    it('Use as written adds a declared row: "Your own wording", and its glyph explains there is no nutrition', async () => {
        // A declared line names no food: the fixture's default `foodId` is dropped.
        const { foodId: _noFood, ...declared } = makeIngredient({
            id: 'ing_free',
            name: 'Maestro Glorp',
            isUserEntered: true,
        });
        useCreateIngredientMock.mockReturnValue(admission(async () => declared));
        render(<ControlledEditor />);
        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        await pickInTrailingRow('Maestro Glorp', 'Use “Maestro Glorp” as written, without nutrition');

        expect(await screen.findByText('Your own wording')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'About Maestro Glorp' }));
        expect(dialogTitled('Maestro Glorp').textContent).toContain('No nutritional data available');
    });

    it('appends the line with its ACTUAL PENDING status (not a hardcoded RESOLVED)', async () => {
        // The poll stays PENDING → the badge must reflect the line's real status, "Resolving…".
        await addByNameFlow(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );

        // EDITED for plan 002 V1: the status word is now plain text in the `StatusBadge` chip, with no
        // "Ingredient 1 status" label in front of it, so it is found by its words alone.
        expect(await screen.findByText('Resolving…')).toBeTruthy();
    });

    it('⛔ a pick that lands after the cook edited another line keeps that edit (no write from a stale draft)', async () => {
        // The add answers LATER, as a real network call does: the admission's promise is released by the test.
        let landPick: (() => void) | undefined;

        useAddIngredientByNameMock.mockReturnValue(
            admission(
                () =>
                    new Promise((resolve) => {
                        landPick = () => resolve(makeIngredient({ id: 'ing_quinoa', name: 'Quinoa' }));
                    }),
            ),
        );

        render(
            <ControlledEditor
                initialValues={{
                    ...defaultRecipeFormValues(),
                    title: 'Quinoa Bowl',
                    ingredients: toRecipeFormValues(
                        makeRecipeDetail({
                            ingredients: [
                                makeIngredientView({
                                    ingredientId: '00000000-0000-4000-8000-000000000001',
                                    name: 'Salt',
                                    quantity: { kind: 'exact', value: 1 },
                                    unit: 'tsp',
                                }),
                            ],
                        }),
                    ).ingredients,
                }}
            />,
        );

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
        await pickInTrailingRow('Quinoa', 'Find nutrition for “Quinoa”');
        // While the pick is in flight, the cook changes the salt to 2.
        fireEvent.change(screen.getByLabelText('Ingredient 1 quantity'), { target: { value: '2' } });
        await act(async () => {
            landPick?.();
        });

        // A matched name is text in a group named for its row (§3b), no longer a field's value.
        await waitFor(() => expect(matchedNames()).toContain('Quinoa'));
        expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('2');
    });

    it('poll-after-add: a PENDING line whose poll returns RESOLVED loses its PENDING word', async () => {
        // The per-line poller sees the food has RESOLVED — this is what must flip the line's badge.
        useIngredientStatusMock.mockReturnValue({
            data: makeIngredient({
                id: 'ing_food',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        } as unknown as ReturnType<typeof useIngredientStatus>);

        await addByNameFlow(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );

        // Mutation lens: had the poller not applied the RESOLVED status to the line, the badge would still
        // read the PENDING label "Resolving…".
        //
        // REWRITTEN for plan 002 V1: a RESOLVED row shows NO status word (SPECIFY.1 rows 3-4), so the RESOLVED state is
        // the PENDING word gone. The line's own name field is the positive control: the absence is not an empty list.
        // A matched name is text in a group named for its row (§3b), no longer a field's value.
        await waitFor(() => expect(matchedNames()).toContain('Quinoa'));
        expect(screen.queryByText('Resolving…')).toBeNull();
        expect(screen.queryByText('Resolved')).toBeNull();
    });
});

/**
 * U28's add-ingredient loop on mobile, on the trailing add row that replaced the picker (plan 002 V1 B8), and the
 * cross-platform nutrition defect U28 repaired.
 *
 * ⛔ WHAT THIS COVERS THAT THE LEAF TESTS CANNOT. The leaf proves typing changes no values; these prove a pick LANDS
 * through the row editor's commit and the screen's draft, and that the line arrives WHOLE.
 */
describe('RecipeEditor — the add-ingredient loop (U28, B8)', () => {
    it('⛔ typing in “Add an ingredient” adds NO row — the list is untouched until a pick', () => {
        render(<ControlledEditor />);
        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        fireEvent.change(screen.getByLabelText('Add an ingredient'), { target: { value: 'Quinoa' } });

        expect(screen.getByText('No ingredients yet. Add your first ingredient.')).toBeTruthy();
        expect(screen.queryByLabelText('Ingredient 1 name')).toBeNull();
        expect(screen.queryByText('Every ingredient needs an item picked from the list.')).toBeNull();
    });

    /**
     * ⛔ THE CROSS-PLATFORM DEFECT U28 REPAIRED, pinned so it cannot come back (plan 002 V1 B5): the line carries only
     * its food REF, and the figures come from the editor's one background read, which both platforms run through the
     * same `useLineNutrition`. What must survive the append is the ref, and the proof is the total computed from it.
     */
    it('carries the picked line’s FOOD REF onto the row, and the total reads that food’s figures', async () => {
        vi.mocked(useIngredientFoodNutrition).mockReturnValue({
            data: {
                entries: [
                    {
                        outcome: 'found',
                        ref: { kind: 'root', id: 'food_quinoa' },
                        freshness: 'fresh',
                        caloriesPer100g: 368,
                        portions: [],
                    },
                ],
            },
            isPlaceholderData: false,
            isError: false,
            refetch: async () => undefined,
        } as unknown as ReturnType<typeof useIngredientFoodNutrition>);
        await addByNameFlow(
            makeIngredient({
                id: 'ing_food',
                name: 'Quinoa',
                foodId: 'food_quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }),
        );

        // State a mass the aggregator can convert (a unitless `1` has no mass factor, so it is honestly uncountable).
        fireEvent.change(await screen.findByLabelText('Ingredient 1 quantity'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Ingredient 1 unit'), { target: { value: 'g' } });

        expect(screen.getByText('Total nutrition (per serving): 368 cal | 0g P | 0g C | 0g F')).toBeTruthy();
        // R30: no calorie chip on the row.
        expect(screen.queryByText('368 cal')).toBeNull();
    });

    it('a second pick INHERITS the section the cook is building (U27’s rule, on the working path)', async () => {
        await addByNameFlow(
            makeIngredient({ id: 'ing_a', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        fireEvent.change(await screen.findByLabelText('Ingredient 1 section'), { target: { value: 'For the bowl' } });
        await pickInTrailingRow('Kale', 'Find nutrition for “Kale”');

        expect((await screen.findByLabelText<HTMLInputElement>('Ingredient 2 section')).value).toBe('For the bowl');
    });

    it('a resolved row wears NO “no food chosen” note, and the trailing field is empty again (F1)', async () => {
        await addByNameFlow(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        // A matched name is text in a group named for its row (§3b), no longer a field's value.
        await waitFor(() => expect(matchedNames()).toContain('Quinoa'));
        expect(
            screen.queryByText(
                'No food chosen — this line won’t be saved. Remove it and add it from the search above.',
            ),
        ).toBeNull();
        expect(screen.getByLabelText<HTMLInputElement>('Add an ingredient').value).toBe('');
    });
});

/**
 * U32 — THE PINNED ACTION BAR, and the shipped defect it fixes; and, since `docs/design/compactHeightLayout.md` §4, the
 * one place it gives way.
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
 *
 * ⚠️ REWRITTEN for the pinned-footer limit (owner ruling on I7, reused for the wizard): the bar is pinned UNLESS the
 * header and the bar together are taller than half the editor, and only a phone held sideways with its keyboard open
 * gets there (pinned it would leave about 19 dp for the field being typed in). So the structural assertion now holds
 * at a measured height: pinned at an upright editor's 779 dp, the scroller's last child at a sideways keyboard's
 * 149 dp, and the header outside the scroller at both. Before any layout is reported the bar is pinned, which the
 * cases that report none still assert.
 */
describe('RecipeEditor — the action bar is pinned OUTSIDE the scroller, up to the limit (U32, I7)', () => {
    /*
     * The wizard's chrome carries no landmark names on native (`docs/design/nativeContainerNames.md` N1, rule 3), so
     * each part is found through what it shows: the rail by its `Step N of 4` text, the bar by its buttons, the header
     * by its back control.
     */
    /** The rail: the box that holds its progress text. */
    const railBox = (): HTMLElement => screen.getByText(/^Step \d of 4$/u).parentElement as HTMLElement;

    /** The bar's row of controls: the nearest box holding both `Save Draft` and the primary control. */
    const controlsRow = (): HTMLElement => {
        const save = screen.getByRole('button', { name: /^Save Draft/u });
        const primary = screen.getByRole('button', { name: /^(Next: |Publish)/u });
        let row = save.parentElement;

        while (row !== null && !row.contains(primary)) {
            row = row.parentElement;
        }

        return row as HTMLElement;
    };

    /** The header row: the row that holds the back control. */
    const headerRow = (): HTMLElement => screen.getByRole('button', { name: 'Back' }).parentElement as HTMLElement;

    /**
     * The one `ScrollView` this screen owns, found by the rail it wraps: the nearest ancestor react-native-web draws as
     * the element that scrolls on y. (The rail now sits in a body wrapper that carries the content's padding, so "the
     * rail's parent" is no longer the scroller.)
     */
    const scroller = (): HTMLElement => {
        const rail = railBox();
        const found = rail.closest<HTMLElement>('[class*="r-overflowY"]');

        if (found === null) {
            throw new Error('could not locate the step scroller');
        }

        return found;
    };

    /**
     * ⛔ THE BAR BEING OUTSIDE THE SCROLLER IS WHAT MAKES THE KEYBOARD A PROBLEM, so the two belong in one
     * describe. Pinned to the physical screen bottom, the action bar is the FIRST thing an iOS keyboard
     * covers — and iOS overlays the window rather than resizing it, so nothing recovers on its own.
     *
     * `login.tsx`, `signup.tsx` and `profile.tsx` all wrap in `KeyboardAvoidingView`; this screen, the one
     * with the most typing in the app, did not. ⚠️ jsdom has no keyboard and no layout, so this asserts the
     * WRAPPER is present rather than the behaviour — the honest limit, and the same one the login suite
     * accepts. A device check is still owed.
     */
    it('⛔ wraps the screen in a KeyboardAvoidingView, so the pinned bar is not what the keyboard covers', () => {
        render(<ControlledEditor />);

        expect(screen.getByLabelText('keyboard-avoiding')).toBeTruthy();
    });

    it('⛔ pads by the keyboard on Android too: an edge-to-edge window does not resize for it (E2 I6)', () => {
        platform.os = 'android';
        render(<ControlledEditor />);

        expect(screen.getByLabelText('keyboard-avoiding').getAttribute('data-behavior')).toBe('padding');
    });

    it('does not render the action bar inside the element that scrolls the step body', () => {
        render(<ControlledEditor />);

        const bar = controlsRow();

        expect(scroller().contains(bar)).toBe(false);
    });

    it('keeps the rail INSIDE the scroller, so only the bar was lifted out', () => {
        // A mutation that simply hoisted everything out of the ScrollView would satisfy the case above while
        // destroying the step body's scrolling. The rail must still scroll away; the bar must not.
        render(<ControlledEditor />);

        expect(scroller().contains(railBox())).toBe(true);
    });

    it('keeps the bar reachable on EVERY step, including one with a long ingredient list', () => {
        // The concrete regression: 30 ingredients on step 2. In jsdom nothing is off-screen, so what is
        // asserted is the structural property that makes it reachable — the bar is not a descendant of the
        // scroller those 30 rows live in.
        render(<LongIngredientEditor />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        const bar = controlsRow();

        expect(screen.getByLabelText('Next: Instructions')).toBeTruthy();
        expect(scroller().contains(bar)).toBe(false);
    });

    /** The bar's own wrapper, the node that reports the bar's height: the parent of `Wizard.Controls`' root. */
    const barBox = (): HTMLElement => controlsRow().parentElement?.parentElement as HTMLElement;
    /** The header's own wrapper, which reports the pinned top row's height. */
    const headerBox = (): HTMLElement => headerRow().parentElement as HTMLElement;
    /** The frame: the editor's height inside the keyboard avoider. */
    const frame = (): HTMLElement => headerBox().parentElement as HTMLElement;

    /**
     * Report layout: give the frame, the header and the bar their heights, fire the observer for every node it
     * watches, and let react-native-web's deferred measurement run.
     */
    function layOut(heights: { readonly frame: number; readonly header: number; readonly bar: number }): void {
        for (const [node, height] of [
            [frame(), heights.frame],
            [headerBox(), heights.header],
            [barBox(), heights.bar],
        ] as const) {
            Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
        }

        act(() => {
            observer.callback?.(
                [...observer.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
                {} as ResizeObserver,
            );
        });
        act(() => {
            vi.runOnlyPendingTimers();
        });
    }

    describe('measured', () => {
        beforeEach(() => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('stays pinned outside the scroller on an upright phone (frame 779)', () => {
            render(<ControlledEditor />);
            layOut({ frame: 779, header: 61, bar: 69 });

            expect(scroller().contains(controlsRow())).toBe(false);
            expect(scroller().contains(headerRow())).toBe(false);
        });

        it('stays pinned on a phone held sideways with the keyboard closed (frame 369)', () => {
            render(<ControlledEditor />);
            layOut({ frame: 369, header: 61, bar: 69 });

            expect(scroller().contains(controlsRow())).toBe(false);
        });

        it('becomes the scroller’s LAST child sideways with the keyboard open (frame 149); the header stays pinned', () => {
            render(<ControlledEditor />);
            layOut({ frame: 149, header: 61, bar: 69 });

            const bar = controlsRow();

            expect(scroller().contains(bar)).toBe(true);
            expect(railBox().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(scroller().contains(headerRow())).toBe(false);
        });

        it('pins again once the keyboard closes and the frame grows back', () => {
            render(<ControlledEditor />);
            layOut({ frame: 149, header: 61, bar: 69 });
            layOut({ frame: 369, header: 61, bar: 69 });

            expect(scroller().contains(controlsRow())).toBe(false);
        });

        /*
         * E1 (`docs/design/rowEditorOpenDecisions.md`): the list behind the pinned bar. jsdom lays nothing out, so each
         * node's place is stated here, as `layOut` states heights: react-native-web reads `offsetTop` and `offsetHeight`
         * for `onLayout` and `measureLayout`, and the scroll view's `scrollTop` is its offset. The field's `offsetTop` is
         * its place in the CONTENT, which is what Fabric's `measureLayout` answers against a scroll view.
         */
        /** State a node's top in its parent and its height. */
        const place = (node: Element, top: number, height: number): void => {
            Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
            Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
        };

        /** The scroller's content: its one child. */
        const content = (): Element => scroller().firstElementChild as Element;
        /** The field of the trailing add row. */
        const addField = (): HTMLElement => screen.getByLabelText('Add an ingredient');

        /** Fire every observed node's layout, then let the deferred measures and their answers land. */
        async function settle(): Promise<void> {
            act(() => {
                observer.callback?.(
                    [...observer.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
                    {} as ResizeObserver,
                );
            });
            await act(async () => {
                vi.runOnlyPendingTimers();
                await Promise.resolve();
            });
        }

        /**
         * On step 2 with the visible area `viewport` dp tall, scrolled 500 dp, the trailing field 740 dp down the content
         * (240 dp down the visible area): type, so the list opens. Answers the scroll view's `scroll` calls.
         */
        async function openListAt(viewport: number): Promise<ReturnType<typeof vi.fn>> {
            const scroll = vi.fn();

            fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
            place(scroller(), 0, viewport);
            Object.defineProperty(scroller(), 'scrollTop', { value: 500, configurable: true });
            Object.defineProperty(scroller(), 'scroll', { value: scroll, configurable: true });
            place(addField(), 740, 48);
            await settle();

            fireEvent.change(addField(), { target: { value: 'Quinoa' } });
            await settle();

            return scroll;
        }

        it('E1: at a 295 dp visible area, scrolls the field to the top ONCE, and the space goes when the list closes', async () => {
            render(<ControlledEditor />);
            layOut({ frame: 779, header: 61, bar: 69 });
            const scroll = await openListAt(295);
            const space = content().lastElementChild as HTMLElement;

            expect(space.getAttribute('aria-hidden')).toBe('true');

            // The space is first laid out empty, then made as tall as the scroll needs: 732 + 295 − 900 = 127.
            place(space, 900, 0);
            await settle();
            place(space, 900, 127);
            await settle();
            await settle();

            // The target: 500 scrolled + 240 down the visible area − 8 dp gap.
            expect(scroll.mock.calls).toEqual([[{ top: 732, left: 0, behavior: 'auto' }]]);

            fireEvent.blur(addField());

            expect(content().lastElementChild).not.toBe(space);
        });

        it('E1: list closed, an unpinned bar is the scroller’s last child; list open, the space is, the bar just before it', async () => {
            render(<ControlledEditor />);
            layOut({ frame: 149, header: 61, bar: 69 });
            // Unpinning remounts the bar's box in the scroller; state the moved box's height too, or it reports 0.
            layOut({ frame: 149, header: 61, bar: 69 });
            expect(content().lastElementChild).toBe(barBox());

            await openListAt(100);

            expect(content().lastElementChild?.getAttribute('aria-hidden')).toBe('true');
            expect(content().lastElementChild?.previousElementSibling).toBe(barBox());
        });
    });
});

/**
 * Plan 002 V1 B7 (§4b, `docs/design/rowEditorOpenDecisions.md` item 4): this editor hosts the row editor and hands its
 * PENDING text to every gate, so changed text on a row in Change food keeps the cook on the Ingredients step.
 */
describe('RecipeEditor — the row editor’s pending text gates the steps (B7)', () => {
    it('Next stays on Ingredients while a row in Change food holds text the cook typed', () => {
        render(<LongIngredientEditor />);
        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        fireEvent.click(screen.getByRole('button', { name: 'Actions for Ingredient 1' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Change food' }));
        fireEvent.change(screen.getByLabelText('Ingredient 1 name'), { target: { value: 'Ingredient 1 x' } });
        // A press moves focus to the control pressed; `fireEvent` does not, so the test does.
        act(() => screen.getByLabelText(/Next: Instructions/).focus());
        fireEvent.click(screen.getByLabelText(/Next: Instructions/));

        expect(screen.queryByRole('heading', { name: 'Instructions' })).toBeFalsy();
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('Ingredient 1 x');
        // R7 item 2: the refusal points at the field it is about.
        expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 1 name'));
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
