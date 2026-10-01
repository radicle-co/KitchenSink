// @vitest-environment jsdom
/**
 * Component tests for the NATIVE ingredients field group (plan U28), rendered via react-native-web under
 * jsdom. The one-for-one mirror of `RecipeIngredientsFields.test.tsx` — read that file's doc for what the
 * three proof legs are and why the sweep is stateful. The two leaves are separate files with no compiler
 * edge between them, which is exactly why §14 requires the same assertions on both: a fix applied to one is
 * not applied to the other.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { AccessibilityInfo } from 'react-native';
import { palette, tint } from '@commise/ui';

// Feather needs the Expo font runtime, absent under jsdom (see `RecipeForm.native.test.tsx` for the full
// rationale). A decorative no-op is enough: the Button primitive hides the glyph from the a11y tree.
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
// react-native-web does not implement `sendAccessibilityEvent`, which the row's status sheet calls to move the
// screen-reader cursor to its title on open and back to the glyph on close (`@commise/ui/popover`).
// The platform is react-native-web's unless a test sets it: iOS is the platform whose live region is an imperative
// announcement, which is the one a test can count (finding #6).
const platform = vi.hoisted(() => ({ os: undefined as 'ios' | undefined }));
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
        AccessibilityInfo: {
            ...actual.AccessibilityInfo,
            sendAccessibilityEvent: vi.fn(),
            announceForAccessibilityWithOptions: vi.fn(),
        },
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import type { RecipeFormErrors } from '../validate.js';
import { type RecipeFormValues, defaultRecipeFormValues } from '../values.js';
import { ingredientNoFoodNoteId, ingredientsErrorId } from '../fieldErrorIds.js';
import { recipeFormMessages } from '../messages.js';
import { recipeMessages } from '../../messages.js';
import { makeIngredientNutrition, makeLookupRetry, withLineKeys } from '../../__fixtures__/index.js';
import type { LookupRetry } from '../ingredientStatus.js';
import { seedLineKey } from '../lineKey.js';
import type { IngredientNutrition } from '../nutritionLookup.js';

afterEach(() => {
    cleanup();
    platform.os = undefined;
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
});

const en = recipeFormMessages.en;
const standIns = recipeMessages.en.ingredientLineName;
const noop = (): void => undefined;
const NUTRITION = makeIngredientNutrition();
const LOOKUP_RETRY = makeLookupRetry();

const valuesWith = (ingredients: RecipeFormValues['ingredients']): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    ingredients,
});

const RESOLVED = {
    ingredientId: 'ing_1',
    name: 'Arborio rice',
    quantity: 300,
    unit: 'g',
    isUserEntered: false,
} as const;
const UNRESOLVED = { ingredientId: null, name: 'Kale', quantity: 1, isUserEntered: false } as const;

interface LeafOverrides {
    readonly values?: RecipeFormValues;
    readonly errors?: RecipeFormErrors;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onRequestAddIngredient?: () => void;
    readonly nutrition?: IngredientNutrition;
    readonly lookupRetry?: LookupRetry;
}

const leafElement = (over: LeafOverrides = {}) => (
    <RecipeIngredientsFields
        values={over.values ?? valuesWith(withLineKeys([RESOLVED]))}
        {...(over.errors === undefined ? {} : { errors: over.errors })}
        onChange={over.onChange ?? noop}
        onRequestAddIngredient={over.onRequestAddIngredient ?? noop}
        nutrition={over.nutrition ?? NUTRITION}
        lookupRetry={over.lookupRetry ?? LOOKUP_RETRY}
    />
);

const renderLeaf = (over: LeafOverrides = {}) => {
    const onChange = over.onChange ?? noop;
    const onRequestAddIngredient = over.onRequestAddIngredient ?? noop;
    const { rerender } = render(leafElement({ ...over, onChange, onRequestAddIngredient }));

    return { onChange, onRequestAddIngredient, rerender };
};

describe('RecipeIngredientsFields (native) — the states', () => {
    it('EMPTY: invites the first ingredient', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.getByRole('button', { name: en.addIngredient })).toBeTruthy();
    });

    it('POPULATED: renders one row per line, bound to its values', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([RESOLVED, { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 1 }]),
            ),
        });

        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('Arborio rice');
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 2 name').value).toBe('Stock');
    });

    it('GATED: a resolved row wears NO "no food" note', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])) });

        expect(screen.queryByText(en.ingredientNoFoodNote)).toBeNull();
    });

    it.each([
        ['ingredientsEmpty' as const, en.errors.ingredientsEmpty],
        ['ingredientsUnresolved' as const, en.errors.ingredientsUnresolved],
        ['ingredientsQuantityInvalid' as const, en.errors.ingredientsQuantityInvalid],
    ])('ERROR: surfaces the %s code as an alert', (code, copy) => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])), errors: { ingredients: code } });

        expect(screen.getByRole('alert').textContent).toContain(copy);
    });

    /**
     * REWRITTEN for plan 002 V1: the status word is the `@commise/ui/status-badge` chip, plain text announced with the
     * row, found the way a reader finds it — by its words — rather than by an `accessibilityLabel` that replaced them.
     */
    it('STATUS: renders the resolution badge for a line that carries one', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }])),
        });

        expect(screen.getByText(en.statusNeedsReview)).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (native) — an unresolved row surfaces its reason (U28)', () => {
    it('wears the design system\u2019s CAUTION chip (`StatusBadge`), not a hand-rolled one (namelessLineCopy §2c)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        const caution = document.createElement('div');
        caution.style.backgroundColor = tint(palette.warning, 0.25);
        // The chip is a `View` holding the words' `Text`, so the fill is on the words' parent.
        expect(chipBackground(en.ingredientNoFoodNote)).toBe(caution.style.backgroundColor);
    });

    it('names what is missing AND the remedy, with no submit attempt anywhere in sight', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        expect(screen.getByText(en.ingredientNoFoodNote)).toBeTruthy();
    });

    it('points the row’s NAME field at that note, and marks it invalid', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED, UNRESOLVED])) });

        const name = screen.getByLabelText('Ingredient 2 name');

        expect(name.getAttribute('aria-describedby')).toBe(ingredientNoFoodNoteId(1));
        expect(name.getAttribute('aria-invalid')).toBe('true');
        // REWRITTEN for plan 002 V1: the note's words sit in the `StatusBadge` chip, which takes no id, so a wrapper
        // `View` carries it (namelessLineCopy §2c). What matters is that the id resolves to the note's words.
        expect(document.getElementById(ingredientNoFoodNoteId(1))?.textContent).toBe(en.ingredientNoFoodNote);
    });

    it('adds the form-level alert id ALONGSIDE the row note when the wizard has refused (both, not either)', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([UNRESOLVED])),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-describedby')).toBe(
            `${ingredientNoFoodNoteId(0)} ${ingredientsErrorId}`,
        );
    });

    it('marks ONLY the unresolved row — a resolved sibling is untouched (WCAG 3.3.1)', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([RESOLVED, UNRESOLVED])),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 2 name').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getAllByText(en.ingredientNoFoodNote)).toHaveLength(1);
    });

    it('keeps the row REMOVABLE — the remedy the note names has to exist', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (native) — the add request (U28)', () => {
    it('asks for the picker and emits no values', () => {
        const onChange = vi.fn();
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith([]), onChange, onRequestAddIngredient });

        fireEvent.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('asks again on a second press (it is a request, not a one-shot latch)', () => {
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])), onRequestAddIngredient });

        fireEvent.click(screen.getByRole('button', { name: en.addIngredient }));
        fireEvent.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(2);
    });
});

/**
 * ⛔ THE CONTROL SWEEP — see the web file's doc. STATEFUL, because the invariant is about the values that
 * come BACK; a `vi.fn()` onChange makes every assertion a tautology about the initial props.
 */
describe('RecipeIngredientsFields (native) — ⛔ no control can create an unresolved row (U28)', () => {
    const Harness: FC<{ initial: RecipeFormValues; seen: RecipeFormValues[] }> = ({ initial, seen }) => {
        const [values, setValues] = useState(initial);

        return (
            <RecipeIngredientsFields
                values={values}
                onChange={(next) => {
                    seen.push(next);
                    setValues(next);
                }}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />
        );
    };

    it('survives pressing every button and typing into every field', () => {
        const seen: RecipeFormValues[] = [];
        const initial = valuesWith(
            withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: 'ing_1',
                    name: 'Flour',
                    quantity: 200,
                    unit: 'g',
                    groupLabel: 'Dry',
                },
                { isUserEntered: false, ingredientId: 'ing_2', name: 'Water', quantity: 1, unit: 'cup' },
            ]),
        );
        render(<Harness initial={initial} seen={seen} />);

        /** Asserts the invariant, naming the interaction that broke it (a bare boolean says nothing useful). */
        const invariant = (values: RecipeFormValues, step: string): void => {
            const unresolved = values.ingredients
                .map((line, index) => ({ number: index + 1, id: line.ingredientId }))
                .filter((entry) => entry.id === null || entry.id === '');

            expect(`${step}: ${JSON.stringify(unresolved)}`).toBe(`${step}: []`);
        };

        for (const input of screen.getAllByRole('textbox')) {
            const label = input.getAttribute('aria-label') ?? '(unlabelled)';
            const before = seen.length;
            fireEvent.change(input, { target: { value: 'typed' } });

            if ((input as HTMLInputElement).readOnly) {
                // A read-only field must ALSO emit nothing — typing into it is a control a cook can reach.
                expect(`${label}: ${seen.length - before} emissions`).toBe(`${label}: 0 emissions`);
                continue;
            }

            invariant(seen[seen.length - 1] ?? initial, `typing into ${label}`);
        }

        for (const button of screen.getAllByRole('button')) {
            const label = button.textContent ?? '(unlabelled)';
            fireEvent.click(button);
            invariant(seen[seen.length - 1] ?? initial, `pressing ${label}`);
        }

        // ⛔ And the list NEVER GREW — the assertion that fails the instant anyone restores the
        // append-an-empty-row button, even if the row they append somehow carried an id.
        for (const values of seen) {
            expect(values.ingredients.length).toBeLessThanOrEqual(initial.ingredients.length);
        }

        expect(seen.length).toBeGreaterThan(0);
    });
});

/**
 * A line with no name in the EDITOR (plan 002 R9; `namelessLineCopy.md` §6c): the row shows the stand-in chip in
 * the name's place and no status word, the same as the detail row. The stand-in is display only: it is never a
 * field value, so a save can never send a food called "Private ingredient".
 */
describe('RecipeIngredientsFields (native) — a line with no name', () => {
    const nameless = (status: FoodResolutionStatus) =>
        valuesWith(
            withLineKeys([
                { ingredientId: 'ing_9', quantity: 2, unit: 'tbsp', isUserEntered: false, resolutionStatus: status },
            ]),
        );

    it.each([
        ['a private food', FoodResolutionStatus.RESOLVED_UNAVAILABLE, standIns.privateFood],
        ['a removed food', FoodResolutionStatus.FOOD_REMOVED, standIns.removedFood],
        ['a food not loaded', FoodResolutionStatus.FOOD_UNREACHABLE, standIns.notLoaded],
    ])('shows the stand-in for %s in the name’s place, with no status word', (_label, status, standIn) => {
        renderLeaf({ values: nameless(status) });

        expect(screen.getByText(standIn)).toBeTruthy();

        // Every status word a nameless status could have shown, so the absence is not about one string.
        for (const word of [en.statusResolvedUnavailable, en.statusFoodRemoved, en.statusFoodUnreachable]) {
            expect(screen.queryByText(word)).toBeNull();
        }

        expect(screen.queryByLabelText('Ingredient 1 name')).toBeNull();
    });

    it('⛔ names the food to a cook tabbing through the row: the first field is described by the stand-in', () => {
        renderLeaf({ values: nameless(FoodResolutionStatus.RESOLVED_UNAVAILABLE) });

        const quantity = screen.getByLabelText('Ingredient 1 quantity');
        const described = (quantity.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .filter((id) => id !== '')
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ');

        expect(described).toContain(standIns.privateFood);
    });

    it('⛔ never puts the stand-in in a field, so no save can send it as a name', () => {
        renderLeaf({ values: nameless(FoodResolutionStatus.RESOLVED_UNAVAILABLE) });

        expect(screen.queryByDisplayValue(standIns.privateFood)).toBeNull();
    });

    it('keeps the row removable', () => {
        renderLeaf({ values: nameless(FoodResolutionStatus.FOOD_UNREACHABLE) });

        expect(screen.getByRole('button', { name: en.removeIngredient.replace('{number}', '1') })).toBeTruthy();
    });

    it('a withdrawn food that KEPT its name still shows the name field and its status', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }])),
        });

        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('Arborio rice');
        expect(screen.getByText(en.statusFoodRemoved)).toBeTruthy();
    });
});

/** The status chip's fill: the badge is a `View` holding the word's `Text` (`StatusBadge.native.tsx`). */
const chipBackground = (word: string): string =>
    getComputedStyle(screen.getByText(word).parentElement ?? document.body).backgroundColor;

describe('RecipeIngredientsFields (native) — status tone parity with the web leaf', () => {
    it('gives a withdrawn-food line the ACTIONABLE warning tint, as the web leaf does', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }])),
        });
        const removed = chipBackground(en.statusFoodRemoved);

        cleanup();
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }])),
        });
        const needsReview = chipBackground(en.statusNeedsReview);

        expect(removed).toBe(needsReview);
    });
});

/**
 * Plan 002 V1 — every row state on native, from the same row policy as the web leaf: the status word and its tone,
 * and slot 1's state glyph, which a TAP opens (R32) into a bottom sheet holding the row's explanation (§8e "moved").
 */
describe('RecipeIngredientsFields (native) — plan 002 V1 row states', () => {
    const fill = (template: string, food: string): string => template.replace('{food}', food);
    const CAUTION = tint(palette.warning, 0.25);
    const NEUTRAL = palette.pearl;

    const STATES = [
        {
            state: 'freeform (the cook’s own wording)',
            line: { ...RESOLVED, isUserEntered: true },
            word: en.statusFreeform,
            fill: NEUTRAL,
            explanation: en.nutritionNoneAvailable,
            food: RESOLVED.name,
        },
        {
            state: 'loading: still looking it up (PENDING, awaiting_source)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.PENDING, unresolvedReason: 'awaiting_source' },
            word: en.statusPending,
            fill: NEUTRAL,
            explanation: en.nutritionWorking,
            food: RESOLVED.name,
        },
        {
            state: 'loading: checking the match (PENDING_VERIFICATION)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.PENDING_VERIFICATION },
            word: en.statusPendingVerification,
            fill: NEUTRAL,
            explanation: en.nutritionWorking,
            food: RESOLVED.name,
        },
        {
            state: 'unmatched: several_candidates (UNRESOLVED)',
            line: {
                ...RESOLVED,
                resolutionStatus: FoodResolutionStatus.UNRESOLVED,
                unresolvedReason: 'several_candidates',
            },
            word: en.statusUnresolved,
            fill: NEUTRAL,
            explanation: en.statusExplainUnresolved,
            food: RESOLVED.name,
        },
        {
            state: 'unmatched: the gate abstained (AMBIGUOUS)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.AMBIGUOUS },
            word: en.statusAmbiguous,
            fill: NEUTRAL,
            explanation: en.statusExplainAmbiguous,
            food: RESOLVED.name,
        },
        {
            state: 'matched but contradicted (NEEDS_REVIEW)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW },
            word: en.statusNeedsReview,
            fill: CAUTION,
            explanation: en.statusExplainNeedsReview,
            food: RESOLVED.name,
        },
        ...(['no_source_has_it', 'cascade_exhausted', 'phrase_unusable'] as const).map((reason) => ({
            state: `unmatched: ${reason} (NOT_FOUND)`,
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.NOT_FOUND, unresolvedReason: reason },
            word: en.statusNotFound,
            fill: NEUTRAL,
            explanation: en.statusExplainNotFound,
            food: RESOLVED.name,
        })),
        ...(['sources_errored', 'cascade_unavailable'] as const).map((reason) => ({
            state: `error: ${reason} (FAILED)`,
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.FAILED, unresolvedReason: reason },
            word: en.statusFailed,
            fill: NEUTRAL,
            explanation: en.statusExplainFailed,
            food: RESOLVED.name,
        })),
        {
            state: 'food removed, name kept (FOOD_REMOVED)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED },
            word: en.statusFoodRemoved,
            fill: CAUTION,
            explanation: en.statusExplainFoodRemoved,
            food: RESOLVED.name,
        },
        {
            state: 'stand-in: someone else’s private food (RESOLVED_UNAVAILABLE)',
            line: {
                ingredientId: 'ing_9',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
                resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
            },
            word: undefined,
            fill: NEUTRAL,
            explanation: en.nutritionNoneUnavailable,
            food: standIns.privateFood,
            // A stand-in names nothing, so the trigger carries the amount too (namelessLineCopy §7, 2.5.3).
            trigger: `2 tbsp ${standIns.privateFood}`,
        },
        {
            state: 'offline: not loaded just now (FOOD_UNREACHABLE)',
            line: {
                ingredientId: 'ing_9',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
                resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
            },
            word: undefined,
            fill: NEUTRAL,
            explanation: en.statusExplainFoodUnreachable,
            food: standIns.notLoaded,
            // A stand-in names nothing, so the trigger carries the amount too (namelessLineCopy §7, 2.5.3).
            trigger: `2 tbsp ${standIns.notLoaded}`,
        },
    ] as const;

    /** The states whose panel has shipped; the rest render no glyph (`panelExplanationOf`). */
    const hasPanel = (entry: (typeof STATES)[number]): entry is (typeof STATES)[number] & { explanation: string } =>
        entry.explanation !== undefined;

    const colourOf = (value: string): string => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = value;

        return probe.style.backgroundColor;
    };

    it.each(STATES)('$state: the status word and its fill', ({ line, word, fill: expectedFill }) => {
        renderLeaf({ values: valuesWith(withLineKeys([line])) });

        if (word === undefined) {
            for (const status of [en.statusResolvedUnavailable, en.statusFoodUnreachable, en.statusResolved]) {
                expect(screen.queryByText(status)).toBeNull();
            }

            return;
        }

        expect(chipBackground(word)).toBe(colourOf(expectedFill));
    });

    it.each(STATES.filter(hasPanel))(
        '$state: a tap on the glyph opens a sheet with the explanation, and Close dismisses it',
        ({ line, explanation, food, ...rest }) => {
            const triggerName = 'trigger' in rest ? rest.trigger : food;
            renderLeaf({ values: valuesWith(withLineKeys([line])) });

            const trigger = screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, triggerName),
            });
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByText(explanation)).toBeNull();

            fireEvent.click(trigger);

            expect(trigger.getAttribute('aria-expanded')).toBe('true');
            expect(screen.getByRole('dialog', { name: food }).textContent).toContain(explanation);

            fireEvent.click(screen.getByRole('button', { name: fill(en.ingredientStatusPanelCloseLabel, food) }));

            expect(screen.queryByRole('dialog', { name: food })).toBeNull();
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        },
    );

    /**
     * REWRITTEN for plan 002 V1 B5 — the native twin of the web suite: a matched row's glyph opens the nutrition
     * panel in the bottom sheet, fed by the editor's one background read.
     */
    describe('matched (RESOLVED): no status word, and the glyph opens the nutrition panel', () => {
        const RICE_REF = { kind: 'root', id: 'rice' } as const;
        const matched = { ...RESOLVED, resolutionStatus: FoodResolutionStatus.RESOLVED, foodRef: RICE_REF };

        const openPanel = (
            nutrition: IngredientNutrition,
            line: Parameters<typeof withLineKeys>[0][number] = matched,
        ) => {
            renderLeaf({ values: valuesWith(withLineKeys([line])), nutrition });
            fireEvent.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );

            return screen.getByRole('dialog', { name: RESOLVED.name });
        };

        it('shows no status word: a match is not news', () => {
            renderLeaf({ values: valuesWith(withLineKeys([matched])) });

            expect(screen.queryByText(en.statusResolved)).toBeNull();
        });

        it('LOADING while the editor\u2019s read has not answered', () => {
            expect(openPanel(makeIngredientNutrition({ lookup: () => ({ state: 'pending' }) })).textContent).toContain(
                en.nutritionLoading,
            );
        });

        it('FIGURES per 100 g, with an em dash and ONE footnote for a figure food does not publish', () => {
            const dialog = openPanel(
                makeIngredientNutrition({
                    lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7 } }),
                }),
            );

            expect(dialog.textContent).toContain(en.nutritionBasis);
            expect(within(dialog).getByLabelText(`${en.nutritionCaloriesLabel} 130`)).toBeTruthy();
            expect(within(dialog).getByLabelText(`${en.nutritionProteinLabel} 2.7 g`)).toBeTruthy();
            expect(within(dialog).getByLabelText(`${en.nutritionFatLabel} \u2014`)).toBeTruthy();
            expect(dialog.textContent).toContain(en.nutritionFieldUnpublished);
        });

        it('NO FIGURES when food publishes none; NO DATA when it answered with nothing readable', () => {
            expect(
                openPanel(makeIngredientNutrition({ lookup: () => ({ state: 'found', catalog: {} }) })).textContent,
            ).toContain(en.nutritionNoFiguresResolved);
            cleanup();
            expect(openPanel(makeIngredientNutrition({ lookup: () => ({ state: 'absent' }) })).textContent).toContain(
                en.nutritionNoneAvailable,
            );
        });

        it('FAILED offers Try again, which reads again', () => {
            const retry = vi.fn();
            const dialog = openPanel(
                makeIngredientNutrition({ lookup: () => ({ state: 'failed' }), read: 'failed', retry }),
            );

            expect(dialog.textContent).toContain(en.nutritionLoadFailed);
            fireEvent.click(within(dialog).getByRole('button', { name: en.statusActionRetry }));
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it('USER-STATED figures win, labelled as the cook\u2019s own (§6b)', () => {
            const dialog = openPanel(
                makeIngredientNutrition({ lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130 } }) }),
                { ...matched, userCalories: 0 },
            );

            expect(dialog.textContent).toContain(en.nutritionUserStatedNote);
            expect(within(dialog).getByLabelText(`${en.nutritionCaloriesLabel} 0`)).toBeTruthy();
        });
    });

    describe('FAILED: Try again re-asks food for this binding (a status read, no recipe write)', () => {
        const failed = {
            ...RESOLVED,
            resolutionStatus: FoodResolutionStatus.FAILED,
            unresolvedReason: 'sources_errored',
        } as const;

        it('the sheet offers Try again; it closes the sheet and asks for THIS binding', () => {
            const retry = vi.fn();
            renderLeaf({ values: valuesWith(withLineKeys([failed])), lookupRetry: makeLookupRetry({ retry }) });
            fireEvent.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );

            fireEvent.click(
                within(screen.getByRole('dialog', { name: RESOLVED.name })).getByRole('button', {
                    name: fill(en.statusActionRetryLookupLabel, RESOLVED.name),
                }),
            );

            expect(retry).toHaveBeenCalledWith(RESOLVED.ingredientId, seedLineKey(1, 0));
            expect(screen.queryByRole('dialog', { name: RESOLVED.name })).toBeNull();
        });

        it('while its ask runs, the sheet says so and offers no second Try again', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([failed])),
                lookupRetry: makeLookupRetry({ retrying: new Set([RESOLVED.ingredientId]) }),
            });
            fireEvent.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );
            const dialog = screen.getByRole('dialog', { name: RESOLVED.name });

            expect(dialog.textContent).toContain(en.statusLookupRetrying);
            expect(
                within(dialog).queryByRole('button', { name: fill(en.statusActionRetryLookupLabel, RESOLVED.name) }),
            ).toBeNull();
        });

        it('announces the settled retry politely through the live region', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([{ ...failed, resolutionStatus: FoodResolutionStatus.RESOLVED }])),
                lookupRetry: makeLookupRetry({
                    settled: { lineKey: seedLineKey(1, 0), status: FoodResolutionStatus.RESOLVED },
                }),
            });

            expect(screen.getByText(fill(en.statusResolvedConfirmation, RESOLVED.name))).toBeTruthy();
        });

        it('⛔ announces a match the server bound under ANOTHER binding: the message follows the row (finding #6)', () => {
            renderLeaf({
                values: valuesWith(
                    withLineKeys([
                        { ...failed, ingredientId: 'bound_9', resolutionStatus: FoodResolutionStatus.RESOLVED },
                    ]),
                ),
                lookupRetry: makeLookupRetry({
                    settled: { lineKey: seedLineKey(1, 0), status: FoodResolutionStatus.RESOLVED },
                }),
            });

            expect(screen.getByText(fill(en.statusResolvedConfirmation, RESOLVED.name))).toBeTruthy();
        });

        it('iOS: the same outcome twice is spoken twice — the region empties while the second ask runs (finding #6)', () => {
            platform.os = 'ios';
            const settled = { lineKey: seedLineKey(1, 0), status: FoodResolutionStatus.FAILED };
            const sentence = `${RESOLVED.name}: ${en.statusFailed}`;
            const values = valuesWith(withLineKeys([failed]));
            const { rerender } = renderLeaf({ values, lookupRetry: makeLookupRetry({ settled }) });

            rerender(
                leafElement({ values, lookupRetry: makeLookupRetry({ retrying: new Set([failed.ingredientId]) }) }),
            );
            rerender(leafElement({ values, lookupRetry: makeLookupRetry({ settled }) }));

            const spoken = vi
                .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
                .mock.calls.filter(([message]) => message === sentence);
            expect(spoken).toHaveLength(2);
        });

        it('the glyph reads BUSY while this binding\u2019s ask is in flight', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([failed])),
                lookupRetry: makeLookupRetry({ retrying: new Set([RESOLVED.ingredientId]) }),
            });

            expect(
                screen
                    .getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) })
                    .getAttribute('aria-busy'),
            ).toBe('true');
        });
    });

    /** Slot 2 (§3a) — the native twin of the web rewrite: Remove direct on every row; no ⋮ menu until V1 B7. */
    describe('slot 2: Remove, shown directly', () => {
        it('a FAILED row has no ⋮ menu; Remove is the direct control, and it removes ONLY that row (US6)', () => {
            const onChange = vi.fn();
            const failed = {
                ...RESOLVED,
                resolutionStatus: FoodResolutionStatus.FAILED,
                unresolvedReason: 'sources_errored',
            } as const;
            const lines = withLineKeys([
                { ...RESOLVED, ingredientId: 'ing_a', name: 'Flour' },
                { ...failed, ingredientId: 'ing_b', name: 'Saffron' },
            ]);
            renderLeaf({ values: valuesWith(lines), onChange });

            expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: en.removeIngredient.replace('{number}', '2') }));

            const next = onChange.mock.calls[0]?.[0] as RecipeFormValues;
            expect(next.ingredients.map((line) => line.key)).toEqual([lines[0]?.key]);
        });
    });

    describe('the running total, from the same read', () => {
        const riceLine = { ...RESOLVED, quantity: 300, unit: 'g', foodRef: { kind: 'root', id: 'rice' } as const };

        it('computes the total from the read\u2019s figures, and no row shows a calorie chip', () => {
            renderLeaf({
                values: { ...valuesWith(withLineKeys([riceLine])), servings: 1 },
                nutrition: makeIngredientNutrition({
                    lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130 } }),
                }),
            });

            expect(
                screen.getByText((content) => content.startsWith(en.nutritionTotalTemplate.split('{')[0])).textContent,
            ).toContain('390');
            expect(screen.queryByText(/\d+ cal$/)).toBeNull();
        });

        it('says LOADING while the read has not answered, and FAILED with a Try again when it failed', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([riceLine])),
                nutrition: makeIngredientNutrition({ read: 'loading', lookup: () => ({ state: 'pending' }) }),
            });
            expect(screen.getByText(en.nutritionLoading)).toBeTruthy();
            cleanup();

            const retry = vi.fn();
            renderLeaf({
                values: valuesWith(withLineKeys([riceLine])),
                nutrition: makeIngredientNutrition({ read: 'failed', lookup: () => ({ state: 'failed' }), retry }),
            });
            expect(screen.getByText(en.nutritionLoadFailed)).toBeTruthy();
            // REVIEW F3: no figure stands beside the failure.
            expect(
                screen.queryByText((content) => content.startsWith(en.nutritionTotalTemplate.split('{')[0])),
            ).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: en.statusActionRetry }));
            expect(retry).toHaveBeenCalledTimes(1);
        });
    });

    it('no food chosen: the existing note, and no glyph until the two-path panel ships (B7)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        expect(screen.getByText(en.ingredientNoFoodNote)).toBeTruthy();
        expect(
            screen.queryByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, UNRESOLVED.name) }),
        ).toBeNull();
    });

    it('a nameless removed food shows the stand-in and no glyph: its only designed copy names Change food (B7)', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([
                    {
                        ingredientId: 'ing_9',
                        quantity: 2,
                        isUserEntered: false,
                        resolutionStatus: FoodResolutionStatus.FOOD_REMOVED,
                    },
                ]),
            ),
        });

        expect(screen.getByText(standIns.removedFood)).toBeTruthy();
        expect(
            screen.queryByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, standIns.removedFood) }),
        ).toBeNull();
    });

    it('keeps the second row mounted when the line ABOVE it is removed (stable row keys)', () => {
        const lines = withLineKeys([
            { ...RESOLVED, ingredientId: 'ing_a', name: 'Flour' },
            { ...RESOLVED, ingredientId: 'ing_b', name: 'Water' },
        ]);
        const { rerender } = render(
            <RecipeIngredientsFields
                values={valuesWith(lines)}
                onChange={noop}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />,
        );
        const waterPreparation = screen.getByLabelText('Ingredient 2 preparation');

        rerender(
            <RecipeIngredientsFields
                values={valuesWith(lines.slice(1))}
                onChange={noop}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />,
        );

        // The same host node, now first: with index keys React would have re-used the FIRST row's node instead.
        expect(screen.getByLabelText('Ingredient 1 preparation')).toBe(waterPreparation);
    });
});
