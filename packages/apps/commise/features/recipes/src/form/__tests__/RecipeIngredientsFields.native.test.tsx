// @vitest-environment jsdom
/**
 * Component tests for the NATIVE ingredients field group (plan U28), rendered via react-native-web under
 * jsdom. The one-for-one mirror of `RecipeIngredientsFields.test.tsx` — read that file's doc for what the
 * three proof legs are and why the sweep is stateful. The two leaves are separate files with no compiler
 * edge between them, which is exactly why §14 requires the same assertions on both: a fix applied to one is
 * not applied to the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogTitled, queryDialogTitled } from '@commise/test-utils';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { createElement, useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { AccessibilityInfo, type ViewProps } from 'react-native';
import { palette, tint } from '@commise/ui';

// Feather needs the Expo font runtime, absent under jsdom (see `recipeFieldGroups.native.test.tsx` for the full
// rationale). A decorative no-op is enough: the Button primitive hides the glyph from the a11y tree.
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
// Rows 6 and 7's panel searches the line's words through the progressive food search. This suite pins the panel's frame,
// not that search, which `RecipeIngredientsFields.rowEditor` and `rowEditor.integration` own.
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));
// react-native-web does not implement `sendAccessibilityEvent`, which the row's status sheet calls to move the
// screen-reader cursor to its title on open and back to the glyph on close (`@commise/ui/popover`).
// The platform is react-native-web's unless a test sets it: iOS is the platform whose live region is an imperative
// announcement, which is the one a test can count (finding #6).
const platform = vi.hoisted(() => ({ os: undefined as 'ios' | undefined }));
// Every `View`'s props, recorded: React Native 0.86 flattens a View that only lays out its children out of Android's
// native tree, label and all (`ViewShadowNode.cpp`), and react-native-web, which renders every View, cannot show that.
const views = vi.hoisted(() => ({ rendered: [] as ViewProps[] }));
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        View: (props: ViewProps) => {
            views.rendered.push(props);

            return createElement(actual.View, props);
        },
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
import {
    makeIngredientNutrition,
    makeLookupRetry,
    withLineKeys,
    makeIngredientEntry,
    makeIngredientRowEditor,
} from '../../__fixtures__/index.js';
import type { LookupRetry } from '../ingredientStatus.js';
import { seedLineKey } from '../lineKey.js';
import type { IngredientNutrition } from '../nutritionLookup.js';
import type { DraftAction } from '../draftAction.js';
import { applyDraftAction } from '../props.js';
import type { IngredientRowEditor } from '../../hooks/useIngredientRowEditor.js';

const ROW_EDITOR = makeIngredientRowEditor();
afterEach(() => {
    cleanup();
    platform.os = undefined;
    views.rendered.length = 0;
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
    readonly nutrition?: IngredientNutrition;
    readonly lookupRetry?: LookupRetry;
    readonly rowEditor?: IngredientRowEditor;
}

const leafElement = (over: LeafOverrides = {}) => (
    <RecipeIngredientsFields
        values={over.values ?? valuesWith(withLineKeys([RESOLVED]))}
        {...(over.errors === undefined ? {} : { errors: over.errors })}
        onChange={over.onChange ?? noop}
        nutrition={over.nutrition ?? NUTRITION}
        lookupRetry={over.lookupRetry ?? LOOKUP_RETRY}
        rowEditor={over.rowEditor ?? ROW_EDITOR}
    />
);

const renderLeaf = (over: LeafOverrides = {}) => {
    const onChange = over.onChange ?? noop;
    const { rerender } = render(leafElement({ ...over, onChange }));

    return { onChange, rerender };
};

describe('RecipeIngredientsFields (native) — the states', () => {
    it('EMPTY: invites the first ingredient', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.getByLabelText(en.addIngredientRowLabel).getAttribute('role')).toBe('combobox');
    });

    it('POPULATED: renders one row per line, bound to its values', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([RESOLVED, { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 1 }]),
            ),
        });

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
        expect(screen.getByRole('group', { name: 'Ingredient 2 name' }).textContent).toBe('Stock');
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

    /**
     * REWRITTEN for plan 002 V1 B7: a row that names no food is an entry field (§2a), the native combobox, which takes
     * no `aria-describedby`: React Native has none on a device, so the old assertion held only under react-native-web.
     * The field is marked invalid, and the note follows it in reading order.
     */
    it('marks the row’s NAME field invalid, and the note that follows it names the remedy', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED, UNRESOLVED])) });

        const name = screen.getByLabelText('Ingredient 2 name');

        expect(name.getAttribute('aria-invalid')).toBe('true');
        expect(name.compareDocumentPosition(screen.getByText(en.ingredientNoFoodNote))).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
        // REWRITTEN for plan 002 V1: the note's words sit in the `StatusBadge` chip, which takes no id, so a wrapper
        // `View` carries it (namelessLineCopy §2c). What matters is that the id resolves to the note's words.
        expect(document.getElementById(ingredientNoFoodNoteId(1))?.textContent).toBe(en.ingredientNoFoodNote);
    });

    /** REWRITTEN for B7, for the reason above: the refusal and the row's note both show, and the field reads invalid. */
    it('shows the form-level alert ALONGSIDE the row note when the wizard has refused (both, not either)', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([UNRESOLVED])),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById(ingredientsErrorId)?.textContent).toBe(en.errors.ingredientsUnresolved);
        expect(document.getElementById(ingredientNoFoodNoteId(0))?.textContent).toBe(en.ingredientNoFoodNote);
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

    /** REWRITTEN for B7: the row's two actions sit behind its `⋮` (§3a row 2), Remove among them. */
    it('keeps the row REMOVABLE — the remedy the note names has to exist', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        fireEvent.click(screen.getByRole('button', { name: en.ingredientActionsMenuLabel.replace('{food}', 'Kale') }));

        expect(screen.getByRole('menuitem', { name: en.statusActionRemove })).toBeTruthy();
    });
});

/**
 * The trailing add row (plan 002 V1 B8, `docs/design/rowEditorOpenDecisions.md` item 3), which replaced U28's "+ Add
 * ingredient" request to an app-owned picker. U28's rule still holds: nothing enters the draft until a pick.
 */
describe('RecipeIngredientsFields (native) — the trailing add row (B8)', () => {
    it('is a combo box named “Add an ingredient”, with that as its placeholder', () => {
        renderLeaf({ values: valuesWith([]) });
        const field = screen.getByLabelText<HTMLInputElement>(en.addIngredientRowLabel);

        expect(field.getAttribute('role')).toBe('combobox');
        expect(field.placeholder).toBe(en.addIngredientRowLabel);
    });

    it('⛔ typing in it goes to the entry for the trailing row and adds no line (U28)', () => {
        const onChange = vi.fn();
        const setText = vi.fn();
        renderLeaf({
            values: valuesWith([]),
            onChange,
            rowEditor: makeIngredientRowEditor({ entry: makeIngredientEntry({ setText }) }),
        });

        fireEvent.change(screen.getByLabelText(en.addIngredientRowLabel), { target: { value: 'kale' } });

        expect(setText).toHaveBeenCalledWith({ kind: 'newLine' }, 'kale');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('has a clear button while it holds text (item 4)', () => {
        renderLeaf({
            values: valuesWith([]),
            rowEditor: makeIngredientRowEditor({ entry: makeIngredientEntry({ textOf: () => 'kale' }) }),
        });

        expect(screen.getByRole('button', { name: en.ingredientEntryClear })).toBeTruthy();
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
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
                rowEditor={ROW_EDITOR}
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

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
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
            expect(dialogTitled(food).textContent).toContain(explanation);

            fireEvent.click(screen.getByRole('button', { name: fill(en.ingredientStatusPanelCloseLabel, food) }));

            expect(queryDialogTitled(food)).toBeNull();
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        },
    );

    /**
     * REWRITTEN for plan 002 V1 B5 — the native twin of the web suite: a matched row's glyph opens the nutrition
     * panel in the bottom sheet, fed by the editor's one background read.
     */
    describe('matched (RESOLVED): no status word, and the glyph opens the nutrition panel', () => {
        const RICE_REF = { kind: 'root', id: 'rice' } as const;
        const matched = { ...RESOLVED, resolutionStatus: FoodResolutionStatus.RESOLVED, foodId: RICE_REF.id };

        const openPanel = (
            nutrition: IngredientNutrition,
            line: Parameters<typeof withLineKeys>[0][number] = matched,
        ) => {
            renderLeaf({ values: valuesWith(withLineKeys([line])), nutrition });
            fireEvent.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );

            return dialogTitled(RESOLVED.name);
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
                within(dialogTitled(RESOLVED.name)).getByRole('button', {
                    name: fill(en.statusActionRetryLookupLabel, RESOLVED.name),
                }),
            );

            expect(retry).toHaveBeenCalledWith(RESOLVED.ingredientId, seedLineKey(1, 0));
            expect(queryDialogTitled(RESOLVED.name)).toBeNull();
        });

        it('while its ask runs, the sheet says so and offers no second Try again', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([failed])),
                lookupRetry: makeLookupRetry({ retrying: new Set([RESOLVED.ingredientId]) }),
            });
            fireEvent.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );
            const dialog = dialogTitled(RESOLVED.name);

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

    /**
     * Slot 2 (§3a). REWRITTEN for B7: the ⋮ menu has shipped, so a row with two or more actions has one (the matched
     * Flour here), and a row with one action, FAILED Saffron, still shows Remove itself.
     */
    describe('slot 2: Remove, shown directly on a row with one action', () => {
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
            const dispatch = vi.fn<(action: DraftAction) => void>();
            renderLeaf({ values: valuesWith(lines), onChange, rowEditor: makeIngredientRowEditor({ dispatch }) });

            expect(screen.getByRole('button', { name: 'Actions for Flour' })).toBeTruthy();
            expect(screen.queryByRole('button', { name: 'Actions for Saffron' })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: en.removeIngredient.replace('{number}', '2') }));

            // By key, through the host's draft transition (`DraftAction` `removeIngredient`), never a value from here.
            expect(dispatch).toHaveBeenCalledExactlyOnceWith({ kind: 'removeIngredient', key: lines[1]?.key });
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('the running total, from the same read', () => {
        const riceLine = { ...RESOLVED, quantity: 300, unit: 'g', foodId: 'rice' };

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

    /** REWRITTEN for B7: the two-path panel ships, naming Create my own food in the row's `⋮` (§5a). */
    it('no food chosen: the note, and the glyph opens the two paths, fixing named first', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        expect(screen.getByText(en.ingredientNoFoodNote)).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, UNRESOLVED.name) }),
        );

        expect(
            screen.getByText(en.errorPromptEntryMode.replace('{createLabel}', en.createCustomFoodIconLabel)),
        ).toBeTruthy();
    });

    /** REWRITTEN for B7: its copy names Change food, which the row's `⋮` now holds, so its glyph ships. */
    it('a nameless removed food shows the stand-in, and its glyph says to use Change food', () => {
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
        // The stand-in names nothing, so the glyph's name carries the amount (namelessLineCopy §7).
        fireEvent.click(
            screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, `2 ${standIns.removedFood}`),
            }),
        );

        expect(
            screen.getByText(
                en.statusExplainFoodRemovedUnnamed.replace('{changeFoodLabel}', en.statusActionChangeFood),
            ),
        ).toBeTruthy();
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
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
                rowEditor={ROW_EDITOR}
            />,
        );
        const waterPreparation = screen.getByLabelText('Ingredient 2 preparation');

        rerender(
            <RecipeIngredientsFields
                values={valuesWith(lines.slice(1))}
                onChange={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
                rowEditor={ROW_EDITOR}
            />,
        );

        // The same host node, now first: with index keys React would have re-used the FIRST row's node instead.
        expect(screen.getByLabelText('Ingredient 1 preparation')).toBe(waterPreparation);
    });
});

/**
 * V1 sign-off item 11 on native: after a Remove, the screen-reader cursor moves to the next row's glyph rather than
 * being left on nothing (`@commise/ui/screen-reader-focus`). The rule is the shared `removalFocusTarget`.
 */
describe('RecipeIngredientsFields (native) — focus after Remove (V1 sign-off item 11)', () => {
    const Harness: FC<{ initial: RecipeFormValues }> = ({ initial }) => {
        const [values, setValues] = useState(initial);

        return (
            <RecipeIngredientsFields
                values={values}
                onChange={setValues}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
                rowEditor={makeIngredientRowEditor({
                    dispatch: (action) => setValues((current) => applyDraftAction(current, action)),
                })}
            />
        );
    };

    const notFound = (ingredientId: string, name: string) => ({
        ...RESOLVED,
        ingredientId,
        name,
        resolutionStatus: FoodResolutionStatus.NOT_FOUND,
    });
    const glyph = (food: string): HTMLElement =>
        screen.getByRole('button', { name: en.ingredientStatusPanelTriggerLabel.replace('{food}', food) });

    beforeEach(() => {
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    });

    /**
     * REWRITTEN for B7: a NOT_FOUND row's Remove sits behind its `⋮` (§3a row 9). The menu's sheet takes the cursor
     * to its title as it shows, so the count is of the moves to a glyph.
     */
    it('moves the screen-reader cursor to the NEXT row’s glyph, once', () => {
        render(<Harness initial={valuesWith(withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]))} />);

        fireEvent.click(screen.getByRole('button', { name: en.ingredientActionsMenuLabel.replace('{food}', 'Kale') }));
        fireEvent.click(screen.getByRole('menuitem', { name: en.statusActionRemove }));

        const glyphMoves = vi
            .mocked(AccessibilityInfo.sendAccessibilityEvent)
            .mock.calls.filter(([node]) => (node as unknown) === glyph('Leek'));

        expect(glyphMoves).toEqual([[glyph('Leek'), 'focus']]);
        expect(
            screen.queryByRole('button', { name: en.ingredientActionsMenuLabel.replace('{food}', 'Kale') }),
        ).toBeNull();
    });

    it('moves the cursor to the trailing add row when the removed row was the last (item 11, B8)', () => {
        render(<Harness initial={valuesWith(withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]))} />);

        fireEvent.click(screen.getByRole('button', { name: en.ingredientActionsMenuLabel.replace('{food}', 'Leek') }));
        fireEvent.click(screen.getByRole('menuitem', { name: en.statusActionRemove }));

        const addMoves = vi
            .mocked(AccessibilityInfo.sendAccessibilityEvent)
            .mock.calls.filter(([node]) => (node as unknown) === screen.getByLabelText(en.addIngredientRowLabel));

        expect(addMoves).toHaveLength(1);
    });

    it('moves nothing while no row is removed (the request is not standing)', () => {
        render(<Harness initial={valuesWith(withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]))} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });
});

/** Curated U15 on native: the web leaf's dotted line, from the same row rule (`rowVariantParts`). */
describe('RecipeIngredientsFields (native) — a variant-bound line’s dotted line (curated U15)', () => {
    const FLAT = {
        id: 'var_flat',
        parts: [
            { attribute: 'cut', text: 'flat half' },
            { attribute: 'grade', text: 'choice' },
        ],
    };
    const brisket = {
        ingredientId: 'ing_b',
        name: 'Beef brisket',
        quantity: 2,
        unit: 'lb',
        isUserEntered: false,
        resolutionStatus: FoodResolutionStatus.RESOLVED,
        foodId: 'food_brisket',
    } as const;

    const renderRows = (lines: Parameters<typeof withLineKeys>[0]): void => {
        render(
            <RecipeIngredientsFields
                values={valuesWith(withLineKeys(lines))}
                onChange={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
                rowEditor={ROW_EDITOR}
            />,
        );
    };

    it('shows the parts under the root’s name, and never one comma-joined label', () => {
        renderRows([{ ...brisket, variant: FLAT }]);

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Beef brisket');
        // The parts are one line, spoken comma-joined (`spokenVariantParts`, R27); the root name stays in its field.
        expect(screen.getByLabelText('flat half, choice')).toBeTruthy();
        expect(screen.queryByText('Beef brisket, flat half, choice')).toBeNull();
    });

    it('a root-bound line shows the name only (R28)', () => {
        renderRows([brisket]);

        expect(screen.queryByLabelText('flat half, choice')).toBeNull();
    });

    it('the nutrition sheet shows the dotted line under its title', () => {
        renderRows([{ ...brisket, variant: FLAT }]);

        // Item 6 (B7): a variant-bound row's glyph names its parts after the food.
        fireEvent.click(screen.getByRole('button', { name: 'About Beef brisket, flat half, choice' }));

        expect(within(dialogTitled('Beef brisket')).getByLabelText('flat half, choice')).toBeTruthy();
    });
});

// `docs/design/ingredientStatusExplanation.md` §3b: the native name was already its row's first line (`rowGrow`). What
// changes is that a matched name is text, which can wrap and clamp reliably, where a read-only `TextInput` cannot.
describe('RecipeIngredientsFields (native) — a matched name is text (§3b)', () => {
    it('⛔ a matched name is text in a group named for its row, never a read-only field (§3b, 4.1.2)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])) });

        const name = screen.getByRole('group', { name: 'Ingredient 1 name' });

        expect(name.textContent).toBe('Arborio rice');
        expect(screen.queryByRole('textbox', { name: 'Ingredient 1 name' })).toBeNull();
        expect(screen.queryByDisplayValue('Arborio rice')).toBeNull();
    });

    it('⛔ the group that names the row keeps its own native node, so Android publishes the name (§3b)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])) });

        const group = views.rendered.filter((props) => props['aria-label'] === 'Ingredient 1 name').pop();

        expect(group?.role).toBe('group');
        // Not flattened away, and not one merged node either: the food's text stays its own node inside it.
        expect(group?.collapsable).toBe(false);
        expect(group?.accessible).toBeUndefined();
    });

    it('the matched name wraps, to two lines at most (§3d)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])) });

        const text = within(screen.getByRole('group', { name: 'Ingredient 1 name' })).getByText('Arborio rice');

        expect(getComputedStyle(text).getPropertyValue('-webkit-line-clamp')).toBe('2');
    });
});
