// @vitest-environment jsdom
/**
 * Component tests for the WEB ingredients field group (plan U28) — the leaf whose "+ Add ingredient" button
 * used to be a dead end.
 *
 * ⛔ WHAT THIS FILE IS FOR. U28's verification clause is not "the button opens the picker", it is "**no path
 * exists that can create an unresolved row**". Three legs prove that, and this file owns two of them:
 *
 *  1. **Compile time** (`props.test.ts`) — `appendResolvedIngredient` is the form's ONE append transition and
 *     its parameter is `ResolvedRecipeFormIngredient`, so an unresolved line is not a value that can be
 *     passed. `blankIngredient`/`addIngredient`, the only constructors that ever made one, are deleted.
 *  2. **The control sweep, below** — a property test over this leaf's WHOLE control surface: drive every
 *     button and every input on a populated list and assert after each that no line lost its food and the
 *     list never grew. That is the runtime half: whatever a cook can press here, they cannot make one.
 *  3. **Container tests** (both platforms) — the picker path appends a resolved line, with its section
 *     inherited.
 *
 * ⚠️ And its DELIBERATE COUNTERWEIGHT: an unresolved row is still REPRESENTABLE (a restored draft can carry
 * one) and must SURFACE ITS REASON rather than be hidden or silently dropped — the ingredient-entry brief's
 * "Do not design a row that looks complete but is silently discarded". That is the note tests below.
 *
 * ⚠️ STATEFUL where a value feeds back. U25–U27's focus defect was invisible to every existing test because
 * they all passed `vi.fn()` as `onChange`, so nothing a test typed ever came back as a new `values`. The
 * sweep holds real state for exactly that reason.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import type { RecipeFormErrors } from '../validate.js';
import { type RecipeFormValues, defaultRecipeFormValues } from '../values.js';
import { ingredientNoFoodNoteId, ingredientsErrorId } from '../fieldErrorIds.js';
import { recipeFormMessages } from '../messages.js';
import { recipeMessages } from '../../messages.js';
import { makeIngredientNutrition, makeLookupRetry, withLineKeys } from '../../__fixtures__/index.js';
import type { LookupRetry } from '../ingredientStatus.js';
import { seedLineKey } from '../lineKey.js';
import type { IngredientNutrition } from '../nutritionLookup.js';

afterEach(cleanup);

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

describe('RecipeIngredientsFields (web) — the states', () => {
    it('EMPTY: invites the first ingredient instead of rendering an empty table', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.queryByRole('listitem')).toBeNull();
        // The add affordance is present even with nothing to add to — that IS the empty state's action.
        expect(screen.getByRole('button', { name: en.addIngredient })).toBeTruthy();
    });

    it('POPULATED: renders one row per line, bound to its values', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([RESOLVED, { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 1 }]),
            ),
        });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Arborio rice');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 2 name' }).value).toBe('Stock');
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
     * row. It used to carry `aria-label="Ingredient 1 status"` on a role-less span, which ARIA 1.2 prohibits and
     * assistive tech ignores, so the test now finds it the way a reader does: by its words.
     */
    it('STATUS: renders the resolution badge for a line that carries one', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }])),
        });

        expect(screen.getByText(en.statusNeedsReview)).toBeTruthy();
    });

    /**
     * ⛔ THE TONE MUST LAND WHERE THE ACTION IS, and this pair is here because it did not.
     *
     * The recipe DETAIL leaf gives a withdrawn-food line a warning tint, justified in its own comment on
     * the grounds that "a cook can act on it — re-match the line in the editor". The editor then painted
     * the same status the neutral pearl it uses for "Resolved", i.e. the colour of "nothing to do here". A
     * UX audit caught it: the alarm fired on the surface where nothing could be done and went quiet on the
     * surface where the picker actually lives.
     *
     * The two actionable statuses are asserted together, because the property under test is "actionable ⇒
     * warning", not "NEEDS_REVIEW ⇒ warning" — and the third case is what stops that being vacuous.
     */
    it.each([
        ['a contradicted line', FoodResolutionStatus.NEEDS_REVIEW],
        ['a withdrawn-food line', FoodResolutionStatus.FOOD_REMOVED],
    ])('STATUS: gives %s the ACTIONABLE warning tint, not the neutral one', (_label, status) => {
        renderLeaf({ values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: status }])) });

        const badge = screen.getByText(
            status === FoodResolutionStatus.NEEDS_REVIEW ? en.statusNeedsReview : en.statusFoodRemoved,
        );

        expect(badge.className).toContain('bg-warning/25');
        expect(badge.className).not.toContain('bg-pearl');
        // ⛔ CHARCOAL on the tint, never `warning` as a foreground — `colors.ts` records that #F5B041 is a
        // light FILL taking a charcoal label and is far under 4.5:1 as text on near-white.
        expect(badge.className).toContain('text-charcoal');
    });

    it('STATUS: leaves a NON-actionable status neutral, so the warning tint keeps meaning something', () => {
        // A calm in-flight check (plan U4c). Rewritten from a NAMED private-food line, which plan 002 R9 makes
        // impossible: such a line is nameless and shows its stand-in instead of a status word.
        renderLeaf({
            values: valuesWith(
                withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.PENDING_VERIFICATION }]),
            ),
        });

        const badge = screen.getByText(en.statusPendingVerification);

        expect(badge.className).toContain('bg-pearl');
        expect(badge.className).not.toContain('bg-warning/25');
    });
});

/**
 * The RESTORED-DRAFT counterweight. U28 removes every way to CREATE an unresolved row; it deliberately does
 * NOT remove the ability to REPRESENT one, because a draft restored from an older source can hold one and
 * hiding it (or dropping it) is the failure the brief names.
 */
describe('RecipeIngredientsFields (web) — an unresolved row surfaces its reason (U28)', () => {
    it('wears the design system\u2019s CAUTION chip (`StatusBadge`), not a hand-rolled one (namelessLineCopy §2c)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        const chip = screen.getByText(en.ingredientNoFoodNote);
        expect(chip.className).toContain('bg-warning/25');
        expect(chip.className).toContain('text-charcoal');
        // The primitive's radius rule (half the ONE-LINE height), which a hand-rolled `rounded-full` breaks on wrap.
        expect(chip.className).not.toContain('rounded-full');
    });

    it('names what is missing AND the remedy, with no submit attempt anywhere in sight', () => {
        // ⛔ `errors` is deliberately ABSENT. Before U28 the row was marked only once a submit had populated
        // `errors.ingredients`, so on a fresh restore it rendered looking exactly like a complete row.
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        expect(screen.getByText(en.ingredientNoFoodNote)).toBeTruthy();
    });

    it('points the row’s NAME field at that note, and marks it invalid', () => {
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED, UNRESOLVED])) });

        const name = screen.getByRole('textbox', { name: 'Ingredient 2 name' });

        // ⛔ The row's OWN note id (index 1), never the section's single form-level alert id — a shared id
        // would read row 1's note to a cook standing on row 2.
        expect(name.getAttribute('aria-describedby')).toBe(ingredientNoFoodNoteId(1));
        expect(name.getAttribute('aria-invalid')).toBe('true');
        // REWRITTEN for plan 002 V1: the note's words sit in the `StatusBadge` chip, which takes no id, so a wrapper
        // `role="note"` carries it (namelessLineCopy §2c). What matters is that the id the name field points at
        // resolves to the note's words, and that the note is announced as a note.
        const note = document.getElementById(ingredientNoFoodNoteId(1));
        expect(note?.textContent).toBe(en.ingredientNoFoodNote);
        expect(note?.getAttribute('role')).toBe('note');
    });

    it('adds the form-level alert id ALONGSIDE the row note when the wizard has refused (both, not either)', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([UNRESOLVED])),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        // Mutation guard: an implementation that REPLACED one id with the other would still pass a test that
        // asserted "contains the error id". Both are needed — the alert says the recipe cannot advance, the
        // note says which row and what to do.
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-describedby')).toBe(
            `${ingredientNoFoodNoteId(0)} ${ingredientsErrorId}`,
        );
    });

    it('marks ONLY the unresolved row — a resolved sibling is untouched (WCAG 3.3.1)', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([RESOLVED, UNRESOLVED])),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Ingredient 2 name' }).getAttribute('aria-invalid')).toBe('true');
        expect(screen.getAllByText(en.ingredientNoFoodNote)).toHaveLength(1);
    });

    it('keeps the row REMOVABLE — the remedy the note names has to exist', () => {
        renderLeaf({ values: valuesWith(withLineKeys([UNRESOLVED])) });

        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (web) — the add request (U28)', () => {
    it('asks for the picker and emits no values', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith([]), onChange, onRequestAddIngredient });

        await user.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('asks again on a second press (it is a request, not a one-shot latch)', async () => {
        const user = userEvent.setup();
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith(withLineKeys([RESOLVED])), onRequestAddIngredient });

        await user.click(screen.getByRole('button', { name: en.addIngredient }));
        await user.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(2);
    });
});

/**
 * ⛔ THE CONTROL SWEEP — the runtime half of "no path exists that can create an unresolved row".
 *
 * It is a PROPERTY test, not a scenario: it enumerates this leaf's whole interactive surface from the
 * rendered DOM (so a control added later is swept automatically, rather than needing someone to remember)
 * and asserts the invariant after every single interaction. STATEFUL, because the invariant is about the
 * values that come BACK — a `vi.fn()` onChange would make every assertion a tautology about the initial
 * props, which is exactly how U25–U27's focus defect stayed invisible.
 */
describe('RecipeIngredientsFields (web) — ⛔ no control can create an unresolved row (U28)', () => {
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

    it('survives pressing every button and typing into every field', async () => {
        const user = userEvent.setup();
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

        // Every text/number input the leaf renders, driven with real text that feeds back through state.
        for (const input of screen.getAllByRole('textbox')) {
            const label = input.getAttribute('aria-label') ?? '(unlabelled)';

            if ((input as HTMLInputElement).readOnly) {
                // A read-only field must ALSO emit nothing — typing into it is a control a cook can reach.
                const before = seen.length;
                await user.click(input);
                await user.paste('typed');
                expect(`${label}: ${seen.length - before} emissions`).toBe(`${label}: 0 emissions`);
                continue;
            }

            await user.click(input);
            await user.paste('x');
            invariant(seen[seen.length - 1] ?? initial, `typing into ${label}`);
        }

        for (const input of screen.getAllByRole('spinbutton')) {
            const label = input.getAttribute('aria-label') ?? '(unlabelled)';
            await user.clear(input);
            await user.type(input, '7');
            invariant(seen[seen.length - 1] ?? initial, `typing into ${label}`);
        }

        // Every button — Add ingredient, and both rows' Remove.
        for (const button of screen.getAllByRole('button')) {
            const label = button.textContent ?? '(unlabelled)';
            await user.click(button);
            invariant(seen[seen.length - 1] ?? initial, `pressing ${label}`);
        }

        // ⛔ And the list NEVER GREW. This is the assertion that fails the instant anyone restores the
        // append-an-empty-row button, even if the row they append somehow carried an id.
        for (const values of seen) {
            expect(values.ingredients.length).toBeLessThanOrEqual(initial.ingredients.length);
        }

        // The sweep actually swept something — a harness that rendered no controls would pass vacuously.
        expect(seen.length).toBeGreaterThan(0);
    });
});

/**
 * A line with no name in the EDITOR (plan 002 R9; `namelessLineCopy.md` §6c): the row shows the stand-in chip in
 * the name's place and no status word, the same as the detail row. The stand-in is display only: it is never a
 * field value, so a save can never send a food called "Private ingredient".
 */
describe('RecipeIngredientsFields (web) — a line with no name', () => {
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

        expect(screen.queryByRole('textbox', { name: 'Ingredient 1 name' })).toBeNull();
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

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Arborio rice');
        expect(screen.getByText(en.statusFoodRemoved)).toBeTruthy();
    });
});

/**
 * Plan 002 V1 — every row state, from the ONE row policy (`ingredientRowPolicy.ts`): the status word and its tone,
 * and slot 1's state glyph, which opens the row's explanation (US1, R24, R25, R32).
 *
 * ⛔ The glyph is a BUTTON opened by activation, never hover (R32, §6d), so every case opens it with a click and
 * closes it with Escape — the keyboard path is the one asserted, and focus must come back to the trigger (APG).
 */
describe('RecipeIngredientsFields (web) — plan 002 V1 row states', () => {
    const fill = (template: string, food: string): string => template.replace('{food}', food);

    const STATES = [
        {
            state: 'freeform (the cook’s own wording)',
            line: { ...RESOLVED, isUserEntered: true },
            word: en.statusFreeform,
            tone: 'neutral',
            explanation: en.nutritionNoneAvailable,
            food: RESOLVED.name,
        },
        {
            state: 'loading: still looking it up (PENDING, awaiting_source)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.PENDING, unresolvedReason: 'awaiting_source' },
            word: en.statusPending,
            tone: 'neutral',
            explanation: en.nutritionWorking,
            food: RESOLVED.name,
        },
        {
            state: 'loading: checking the match (PENDING_VERIFICATION)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.PENDING_VERIFICATION },
            word: en.statusPendingVerification,
            tone: 'neutral',
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
            tone: 'neutral',
            explanation: en.statusExplainUnresolved,
            food: RESOLVED.name,
        },
        {
            state: 'unmatched: the gate abstained (AMBIGUOUS)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.AMBIGUOUS },
            word: en.statusAmbiguous,
            tone: 'neutral',
            explanation: en.statusExplainAmbiguous,
            food: RESOLVED.name,
        },
        {
            state: 'matched but contradicted (NEEDS_REVIEW)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW },
            word: en.statusNeedsReview,
            tone: 'caution',
            explanation: en.statusExplainNeedsReview,
            food: RESOLVED.name,
        },
        ...(['no_source_has_it', 'cascade_exhausted', 'phrase_unusable'] as const).map((reason) => ({
            state: `unmatched: ${reason} (NOT_FOUND)`,
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.NOT_FOUND, unresolvedReason: reason },
            word: en.statusNotFound,
            tone: 'neutral',
            explanation: en.statusExplainNotFound,
            food: RESOLVED.name,
        })),
        ...(['sources_errored', 'cascade_unavailable'] as const).map((reason) => ({
            state: `error: ${reason} (FAILED)`,
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.FAILED, unresolvedReason: reason },
            word: en.statusFailed,
            tone: 'neutral',
            explanation: en.statusExplainFailed,
            food: RESOLVED.name,
        })),
        {
            state: 'food removed, name kept (FOOD_REMOVED)',
            line: { ...RESOLVED, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED },
            word: en.statusFoodRemoved,
            tone: 'caution',
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
            tone: 'neutral',
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
            tone: 'neutral',
            explanation: en.statusExplainFoodUnreachable,
            food: standIns.notLoaded,
            // A stand-in names nothing, so the trigger carries the amount too (namelessLineCopy §7, 2.5.3).
            trigger: `2 tbsp ${standIns.notLoaded}`,
        },
    ] as const;

    /** The states whose panel has shipped; the rest render no glyph (`panelExplanationOf`). */
    const hasPanel = (entry: (typeof STATES)[number]): entry is (typeof STATES)[number] & { explanation: string } =>
        entry.explanation !== undefined;

    it.each(STATES)('$state: the status word and its tone', ({ line, word, tone }) => {
        renderLeaf({ values: valuesWith(withLineKeys([line])) });

        if (word === undefined) {
            for (const status of [en.statusResolvedUnavailable, en.statusFoodUnreachable, en.statusResolved]) {
                expect(screen.queryByText(status)).toBeNull();
            }

            return;
        }

        const badge = screen.getByText(word);
        expect(badge.className).toContain(tone === 'caution' ? 'bg-warning/25' : 'bg-pearl');
    });

    it.each(STATES.filter(hasPanel))(
        '$state: the glyph opens the explanation, and Escape returns focus to it',
        async ({ line, explanation, food, ...rest }) => {
            const triggerName = 'trigger' in rest ? rest.trigger : food;
            const user = userEvent.setup();
            renderLeaf({ values: valuesWith(withLineKeys([line])) });

            const trigger = screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, triggerName),
            });
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByText(explanation)).toBeNull();

            await user.click(trigger);

            expect(trigger.getAttribute('aria-expanded')).toBe('true');
            expect(screen.getByRole('dialog', { name: food }).textContent).toContain(explanation);

            await user.keyboard('{Escape}');

            expect(screen.queryByRole('dialog')).toBeNull();
            expect(document.activeElement).toBe(trigger);
        },
    );

    it('keeps the glyph and its open panel MOUNTED when the status moves between two explained states (§4)', async () => {
        const user = userEvent.setup();
        const at = (resolutionStatus: FoodResolutionStatus): RecipeFormValues =>
            valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus }]));
        const { rerender } = render(
            <RecipeIngredientsFields
                values={at(FoodResolutionStatus.NOT_FOUND)}
                onChange={noop}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />,
        );
        const trigger = screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) });
        await user.click(trigger);

        rerender(
            <RecipeIngredientsFields
                values={at(FoodResolutionStatus.FAILED)}
                onChange={noop}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />,
        );

        // The same trigger node, still expanded, and the body swapped to the new cause: nothing unmounted under the cook.
        expect(screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) })).toBe(
            trigger,
        );
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('dialog', { name: RESOLVED.name }).textContent).toContain(en.statusExplainFailed);
        expect(document.activeElement).not.toBe(document.body);
    });

    it('two nameless private rows get DISTINCT glyph names: the amount tells them apart (namelessLineCopy §7)', () => {
        const privateLine = (quantity: number, unit: string) => ({
            ingredientId: `ing_${unit}`,
            quantity,
            unit,
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        });
        renderLeaf({ values: valuesWith(withLineKeys([privateLine(2, 'tbsp'), privateLine(1, 'cup')])) });

        expect(
            screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, `2 tbsp ${standIns.privateFood}`),
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, `1 cup ${standIns.privateFood}`),
            }),
        ).toBeTruthy();
    });

    it('opens from the keyboard alone: Tab to the glyph, Enter', async () => {
        const user = userEvent.setup();
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.NOT_FOUND }])),
        });
        const trigger = screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) });

        trigger.focus();
        await user.keyboard('{Enter}');

        expect(screen.getByRole('dialog', { name: RESOLVED.name }).textContent).toContain(en.statusExplainNotFound);
    });

    /**
     * REWRITTEN for plan 002 V1 B5: a matched row now has its info glyph, opening the nutrition panel fed by the
     * editor's ONE background read. Every sub-state of §6b / SPECIFY.4 is driven through the real leaf.
     */
    describe('matched (RESOLVED): no status word, and the glyph opens the nutrition panel', () => {
        const RICE_REF = { kind: 'root', id: 'rice' } as const;
        const matched = { ...RESOLVED, resolutionStatus: FoodResolutionStatus.RESOLVED, foodRef: RICE_REF };

        const openPanel = async (
            nutrition: IngredientNutrition,
            line: Parameters<typeof withLineKeys>[0][number] = matched,
        ) => {
            const user = userEvent.setup();
            renderLeaf({ values: valuesWith(withLineKeys([line])), nutrition });
            await user.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );

            return { user, dialog: screen.getByRole('dialog', { name: RESOLVED.name }) };
        };

        it('shows no status word: a match is not news', () => {
            renderLeaf({ values: valuesWith(withLineKeys([matched])) });

            expect(screen.queryByText(en.statusResolved)).toBeNull();
        });

        it('LOADING while the editor\u2019s read has not answered', async () => {
            const { dialog } = await openPanel(makeIngredientNutrition({ lookup: () => ({ state: 'pending' }) }));

            expect(dialog.textContent).toContain(en.nutritionLoading);
        });

        it('FIGURES per 100 g, with an em dash and ONE footnote for a figure food does not publish (never 0)', async () => {
            const { dialog } = await openPanel(
                makeIngredientNutrition({
                    lookup: () => ({
                        state: 'found',
                        catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7, fatGPer100g: 0.3 },
                    }),
                }),
            );

            expect(dialog.textContent).toContain(en.nutritionBasis);
            expect(within(dialog).getByText(en.nutritionCaloriesLabel).nextElementSibling?.textContent).toBe('130');
            expect(within(dialog).getByText(en.nutritionProteinLabel).nextElementSibling?.textContent).toBe('2.7 g');
            expect(within(dialog).getByText(en.nutritionCarbsLabel).nextElementSibling?.textContent).toBe('\u2014');
            expect(dialog.textContent).toContain(en.nutritionFieldUnpublished);
        });

        it('no footnote when every figure is published', async () => {
            const { dialog } = await openPanel(
                makeIngredientNutrition({
                    lookup: () => ({
                        state: 'found',
                        catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7, carbsGPer100g: 28, fatGPer100g: 0.3 },
                    }),
                }),
            );

            expect(dialog.textContent).not.toContain(en.nutritionFieldUnpublished);
        });

        it('NO FIGURES when food answered and publishes none — an answer, not the failure copy', async () => {
            const { dialog } = await openPanel(
                makeIngredientNutrition({ lookup: () => ({ state: 'found', catalog: {} }) }),
            );

            expect(dialog.textContent).toContain(en.nutritionNoFiguresResolved);
            expect(dialog.textContent).not.toContain(en.nutritionLoadFailed);
        });

        it('NO DATA when food answered with nothing this cook may read', async () => {
            const { dialog } = await openPanel(makeIngredientNutrition({ lookup: () => ({ state: 'absent' }) }));

            expect(dialog.textContent).toContain(en.nutritionNoneAvailable);
        });

        it('FAILED (offline, or food could not be asked) offers Try again, which reads again', async () => {
            const retry = vi.fn();
            const { user, dialog } = await openPanel(
                makeIngredientNutrition({ lookup: () => ({ state: 'failed' }), read: 'failed', retry }),
            );

            expect(dialog.textContent).toContain(en.nutritionLoadFailed);
            await user.click(within(dialog).getByRole('button', { name: en.statusActionRetry }));
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it('USER-STATED figures win, labelled as the cook\u2019s own (they are what the total uses, §6b)', async () => {
            const { dialog } = await openPanel(
                makeIngredientNutrition({ lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130 } }) }),
                { ...matched, userCalories: 0 },
            );

            expect(dialog.textContent).toContain(en.nutritionUserStatedNote);
            expect(within(dialog).getByText(en.nutritionCaloriesLabel).nextElementSibling?.textContent).toBe('0');
            expect(dialog.textContent).not.toContain(en.nutritionBasis);
        });

        it('⛔ STATUS ADVANCES WHILE OPEN: a PENDING row turned RESOLVED by its poll keeps the panel open (§4)', async () => {
            const user = userEvent.setup();
            const nutrition = makeIngredientNutrition({
                lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130 } }),
            });
            const at = (resolutionStatus: FoodResolutionStatus): RecipeFormValues =>
                valuesWith(withLineKeys([{ ...matched, resolutionStatus }]));
            const { rerender } = render(
                <RecipeIngredientsFields
                    values={at(FoodResolutionStatus.PENDING)}
                    onChange={noop}
                    onRequestAddIngredient={noop}
                    nutrition={nutrition}
                    lookupRetry={LOOKUP_RETRY}
                />,
            );
            const trigger = screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name),
            });
            await user.click(trigger);
            expect(screen.getByRole('dialog', { name: RESOLVED.name }).textContent).toContain(en.nutritionWorking);

            rerender(
                <RecipeIngredientsFields
                    values={at(FoodResolutionStatus.RESOLVED)}
                    onChange={noop}
                    onRequestAddIngredient={noop}
                    nutrition={nutrition}
                    lookupRetry={LOOKUP_RETRY}
                />,
            );

            expect(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            ).toBe(trigger);
            expect(screen.getByRole('dialog', { name: RESOLVED.name }).textContent).toContain(en.nutritionBasis);
        });
    });

    describe('FAILED: Try again re-asks food for this binding (a status read, no recipe write)', () => {
        const failed = {
            ...RESOLVED,
            resolutionStatus: FoodResolutionStatus.FAILED,
            unresolvedReason: 'sources_errored',
        } as const;

        it('the panel offers Try again; it closes the panel, returns focus to the glyph, and asks for THIS binding', async () => {
            const user = userEvent.setup();
            const retry = vi.fn();
            renderLeaf({ values: valuesWith(withLineKeys([failed])), lookupRetry: makeLookupRetry({ retry }) });
            const glyph = screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name),
            });
            await user.click(glyph);

            await user.click(
                within(screen.getByRole('dialog', { name: RESOLVED.name })).getByRole('button', {
                    name: fill(en.statusActionRetryLookupLabel, RESOLVED.name),
                }),
            );

            // The row's own key rides along, so the announcement can follow the LINE when a settle re-points it.
            expect(retry).toHaveBeenCalledWith(RESOLVED.ingredientId, seedLineKey(1, 0));
            expect(screen.queryByRole('dialog')).toBeNull();
            // The focus target after Try again is the row's status glyph (recorded for UX sign-off).
            expect(document.activeElement).toBe(glyph);
        });

        it('the glyph reads BUSY while this binding\u2019s ask is in flight, and only this one', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([failed, { ...failed, ingredientId: 'ing_2', name: 'Saffron' }])),
                lookupRetry: makeLookupRetry({ retrying: new Set([RESOLVED.ingredientId]) }),
            });

            expect(
                screen
                    .getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) })
                    .getAttribute('aria-busy'),
            ).toBe('true');
            expect(
                screen
                    .getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, 'Saffron') })
                    .hasAttribute('aria-busy'),
            ).toBe(false);
        });

        it('while its ask runs, the panel says so and offers no second Try again (V1 sign-off, busy rule 2)', async () => {
            const user = userEvent.setup();
            renderLeaf({
                values: valuesWith(withLineKeys([failed])),
                lookupRetry: makeLookupRetry({ retrying: new Set([RESOLVED.ingredientId]) }),
            });
            await user.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );
            const dialog = screen.getByRole('dialog', { name: RESOLVED.name });

            expect(dialog.textContent).toContain(en.statusLookupRetrying);
            expect(
                within(dialog).queryByRole('button', { name: fill(en.statusActionRetryLookupLabel, RESOLVED.name) }),
            ).toBeNull();
        });

        it.each([
            ['a definite answer', FoodResolutionStatus.NOT_FOUND, `${RESOLVED.name}: ${en.statusNotFound}`],
            ['still FAILED', FoodResolutionStatus.FAILED, `${RESOLVED.name}: ${en.statusFailed}`],
            ['a match', FoodResolutionStatus.RESOLVED, fill(en.statusResolvedConfirmation, RESOLVED.name)],
        ])('announces the settled retry politely: %s (V1 sign-off 3c)', (_label, status, message) => {
            renderLeaf({
                values: valuesWith(withLineKeys([{ ...failed, resolutionStatus: status }])),
                lookupRetry: makeLookupRetry({ settled: { lineKey: seedLineKey(1, 0), status } }),
            });

            expect(screen.getByRole('status', { name: '' }).textContent ?? '').toContain(message);
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

            expect(screen.getByRole('status', { name: '' }).textContent).toBe(
                fill(en.statusResolvedConfirmation, RESOLVED.name),
            );
        });

        it('the region empties while a new ask runs, so the same outcome is announced again (finding #6)', () => {
            const settled = { lineKey: seedLineKey(1, 0), status: FoodResolutionStatus.FAILED };
            const sentence = `${RESOLVED.name}: ${en.statusFailed}`;
            const { rerender } = renderLeaf({
                values: valuesWith(withLineKeys([failed])),
                lookupRetry: makeLookupRetry({ settled }),
            });
            const region = screen.getByRole('status', { name: '' });
            expect(region.textContent).toBe(sentence);

            rerender(leafElement({ values: valuesWith(withLineKeys([failed])), lookupRetry: makeLookupRetry() }));
            expect(region.textContent).toBe('');

            rerender(
                leafElement({ values: valuesWith(withLineKeys([failed])), lookupRetry: makeLookupRetry({ settled }) }),
            );
            // The SAME node: a live region must exist before its text changes, or the change is not announced.
            expect(screen.getByRole('status', { name: '' })).toBe(region);
            expect(region.textContent).toBe(sentence);
        });

        it('⛔ only a FAILED row offers Try again: NOT_FOUND is an answer, not an outage', async () => {
            const user = userEvent.setup();
            renderLeaf({
                values: valuesWith(withLineKeys([{ ...failed, resolutionStatus: FoodResolutionStatus.NOT_FOUND }])),
            });
            await user.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );

            expect(
                within(screen.getByRole('dialog', { name: RESOLVED.name })).queryByRole('button', {
                    name: fill(en.statusActionRetryLookupLabel, RESOLVED.name),
                }),
            ).toBeNull();
        });
    });

    /**
     * Slot 2 (§3a). REWRITTEN in this slice: the ⋮ menu first held Try again beside Remove on a FAILED row, and a red
     * test showed that a row settling after Try again unmounts the menu with focus on it (focus fell to the page). So
     * Try again lives only in the panel (focus returns to the glyph, which survives the settle), slot 2 is Remove
     * shown directly on every row, and the menu mounts when V1 B7 adds Change food and Create my own food.
     */
    describe('slot 2 and the Try again focus target', () => {
        const failed = {
            ...RESOLVED,
            resolutionStatus: FoodResolutionStatus.FAILED,
            unresolvedReason: 'sources_errored',
        } as const;

        it('⛔ a row that settles after Try again does not drop focus to the page (§2d: focus lands on the glyph)', async () => {
            const user = userEvent.setup();
            const at = (resolutionStatus: FoodResolutionStatus): RecipeFormValues =>
                valuesWith(withLineKeys([{ ...failed, resolutionStatus }]));
            const { rerender } = render(
                <RecipeIngredientsFields
                    values={at(FoodResolutionStatus.FAILED)}
                    onChange={noop}
                    onRequestAddIngredient={noop}
                    nutrition={NUTRITION}
                    lookupRetry={LOOKUP_RETRY}
                />,
            );
            const glyph = screen.getByRole('button', {
                name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name),
            });
            await user.click(glyph);
            await user.click(
                within(screen.getByRole('dialog', { name: RESOLVED.name })).getByRole('button', {
                    name: fill(en.statusActionRetryLookupLabel, RESOLVED.name),
                }),
            );

            rerender(
                <RecipeIngredientsFields
                    values={at(FoodResolutionStatus.NOT_FOUND)}
                    onChange={noop}
                    onRequestAddIngredient={noop}
                    nutrition={NUTRITION}
                    lookupRetry={LOOKUP_RETRY}
                />,
            );

            expect(document.activeElement).not.toBe(document.body);
            expect(document.activeElement).toBe(glyph);
        });

        it('no row mounts the ⋮ menu yet: Remove is direct, and Try again lives in the panel (V1 B7 fills the menu)', async () => {
            const user = userEvent.setup();
            renderLeaf({ values: valuesWith(withLineKeys([failed])) });

            expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();
            expect(screen.getByRole('button', { name: en.removeIngredient.replace('{number}', '1') })).toBeTruthy();
            // Positive control: the FAILED row still offers Try again — in its panel, where focus comes back to the glyph.
            await user.click(
                screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, RESOLVED.name) }),
            );
            expect(
                within(screen.getByRole('dialog', { name: RESOLVED.name })).getByRole('button', {
                    name: fill(en.statusActionRetryLookupLabel, RESOLVED.name),
                }),
            ).toBeTruthy();
        });

        it('US6: Remove removes ONLY that row', async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            const lines = withLineKeys([
                { ...RESOLVED, ingredientId: 'ing_a', name: 'Flour' },
                { ...failed, ingredientId: 'ing_b', name: 'Saffron' },
                { ...RESOLVED, ingredientId: 'ing_c', name: 'Water' },
            ]);
            renderLeaf({ values: valuesWith(lines), onChange });

            await user.click(screen.getByRole('button', { name: en.removeIngredient.replace('{number}', '2') }));

            const next = onChange.mock.calls[0]?.[0] as RecipeFormValues;
            expect(next.ingredients.map((line) => line.key)).toEqual([lines[0]?.key, lines[2]?.key]);
        });
    });

    describe('the running total, from the same read (R30: calories live in the panel, not the row)', () => {
        const RICE_REF = { kind: 'root', id: 'rice' } as const;
        const riceLine = { ...RESOLVED, quantity: 300, unit: 'g', foodRef: RICE_REF };
        const found = makeIngredientNutrition({
            lookup: () => ({ state: 'found', catalog: { caloriesPer100g: 130 } }),
        });

        it('computes the total from the read\u2019s figures, and no row shows a calorie chip', () => {
            renderLeaf({ values: { ...valuesWith(withLineKeys([riceLine])), servings: 1 }, nutrition: found });

            expect(
                screen.getByText((content) => content.startsWith(en.nutritionTotalTemplate.split('{')[0])).textContent,
            ).toContain('390');
            expect(screen.queryByText(/\d+ cal$/)).toBeNull();
        });

        it('says LOADING instead of a total while the read has not answered', () => {
            renderLeaf({
                values: valuesWith(withLineKeys([riceLine])),
                nutrition: makeIngredientNutrition({ read: 'loading', lookup: () => ({ state: 'pending' }) }),
            });

            expect(screen.getByText(en.nutritionLoading)).toBeTruthy();
        });

        it('says the read FAILED and offers Try again, which reads again', async () => {
            const user = userEvent.setup();
            const retry = vi.fn();
            renderLeaf({
                values: valuesWith(withLineKeys([riceLine])),
                nutrition: makeIngredientNutrition({ read: 'failed', lookup: () => ({ state: 'failed' }), retry }),
            });

            expect(screen.getByText(en.nutritionLoadFailed)).toBeTruthy();
            // REVIEW F3: no figure stands beside the failure — a total built from no catalog lines reads as a fact.
            expect(
                screen.queryByText((content) => content.startsWith(en.nutritionTotalTemplate.split('{')[0])),
            ).toBeNull();
            await user.click(screen.getByRole('button', { name: en.statusActionRetry }));
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

    it('each row’s glyph opens ITS OWN explanation (two rows, two causes)', async () => {
        const user = userEvent.setup();
        renderLeaf({
            values: valuesWith(
                withLineKeys([
                    { ...RESOLVED, name: 'Kale', resolutionStatus: FoodResolutionStatus.NOT_FOUND },
                    { ...RESOLVED, name: 'Saffron', resolutionStatus: FoodResolutionStatus.FAILED },
                ]),
            ),
        });

        await user.click(screen.getByRole('button', { name: fill(en.ingredientStatusPanelTriggerLabel, 'Saffron') }));

        const dialog = screen.getByRole('dialog', { name: 'Saffron' });
        expect(dialog.textContent).toContain(en.statusExplainFailed);
        expect(dialog.textContent).not.toContain(en.statusExplainNotFound);
    });

    /**
     * ⛔ ROWS ARE KEYED BY THE LINE'S KEY, NEVER ITS INDEX. With index keys, removing the line ABOVE makes React reuse
     * the first row's DOM for the second line and unmount the second row — the field the cook was typing in — so the
     * caret vanishes. With stable keys the second row's DOM survives the removal and keeps focus.
     */
    it('keeps focus in a row when the line ABOVE it is removed (stable row keys)', () => {
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
        const waterPreparation = screen.getByRole('textbox', { name: 'Ingredient 2 preparation' });
        waterPreparation.focus();

        rerender(
            <RecipeIngredientsFields
                values={valuesWith(lines.slice(1))}
                onChange={noop}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />,
        );

        expect(document.activeElement).toBe(waterPreparation);
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 preparation' })).toBe(waterPreparation);
    });
});

/**
 * V1 sign-off W-1 (2026-10-01): every sized row field rendered FULL WIDTH, because the shared `field` string carries
 * `w-full` and Tailwind emits `.w-full` after `.w-24`/`.w-28`/`.w-40`/`.w-48`, so it won regardless of class order
 * (rows were 376 px tall at 1280 px). A sized field must never carry `w-full`; the same CSS-order rule applies to the
 * unit field's text colour, which must carry ONE colour, not `text-charcoal` beside `text-slate`.
 */
describe('RecipeIngredientsFields (web) — sized fields carry ONE width (W-1)', () => {
    it.each([
        ['Ingredient 1 quantity', 'w-24'],
        ['Ingredient 1 maximum quantity', 'w-24'],
        ['Ingredient 1 unit', 'w-28'],
        ['Ingredient 1 preparation', 'w-48'],
        ['Ingredient 1 section', 'w-40'],
    ])('%s is %s and never w-full', (label, width) => {
        renderLeaf({ values: valuesWith(withLineKeys([{ ...RESOLVED, unit: 'handful' }])) });
        const classes = screen.getByLabelText(label).className.split(/\s+/);

        expect(classes).toContain(width);
        expect(classes).not.toContain('w-full');
    });

    it('the unit field states ONE text colour (an unknown unit is slate italic, never charcoal as well)', () => {
        renderLeaf({ values: valuesWith(withLineKeys([{ ...RESOLVED, unit: 'blorp' }])) });
        const classes = screen.getByLabelText('Ingredient 1 unit').className.split(/\s+/);

        expect(classes).toContain('text-slate');
        expect(classes).not.toContain('text-charcoal');
    });
});

/** Fill a `{food}` template (module scope, for the suites below). */
const fillFood = (template: string, food: string): string => template.replace('{food}', food);

/**
 * V1 sign-off item 11: where focus goes after Remove — the next row's glyph; if that row has no glyph, its Remove; if
 * the removed row was the last, Add ingredient (the trailing control until B6). Before this, a keyboard Remove dropped
 * focus to the page (SC 2.4.3). Stateful, so the removal really re-renders the list.
 */
describe('RecipeIngredientsFields (web) — focus after Remove (V1 sign-off item 11)', () => {
    const Harness: FC<{ initial: RecipeFormValues }> = ({ initial }) => {
        const [values, setValues] = useState(initial);

        return (
            <RecipeIngredientsFields
                values={values}
                onChange={setValues}
                onRequestAddIngredient={noop}
                nutrition={NUTRITION}
                lookupRetry={LOOKUP_RETRY}
            />
        );
    };

    const notFound = (ingredientId: string, name: string) => ({
        ...RESOLVED,
        ingredientId,
        name,
        resolutionStatus: FoodResolutionStatus.NOT_FOUND,
    });
    const removeButton = (number: number) =>
        screen.getByRole('button', { name: en.removeIngredient.replace('{number}', String(number)) });

    it('lands on the NEXT row’s glyph', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]))} />);

        await user.click(removeButton(1));

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: fillFood(en.ingredientStatusPanelTriggerLabel, 'Leek') }),
        );
    });

    it('lands on the next row’s Remove when that row has no glyph', async () => {
        const user = userEvent.setup();
        render(
            <Harness initial={valuesWith(withLineKeys([notFound('a', 'Kale'), { ...UNRESOLVED, name: 'Leek' }]))} />,
        );

        await user.click(removeButton(1));

        expect(document.activeElement).toBe(removeButton(1));
    });

    it('lands on Add ingredient when the removed row was the last', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([notFound('a', 'Kale'), notFound('b', 'Leek')]))} />);

        await user.click(removeButton(2));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: en.addIngredient }));
    });
});

/** V1 sign-off item 1: a keyboard user who tabs to the glyph hears the row's status word through its description. */
describe('RecipeIngredientsFields (web) — the glyph is described by the status word (V1 sign-off item 1)', () => {
    it('names the status word as the glyph’s description', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.NOT_FOUND }])),
        });
        const glyph = screen.getByRole('button', {
            name: fillFood(en.ingredientStatusPanelTriggerLabel, RESOLVED.name),
        });
        const describedBy = glyph.getAttribute('aria-describedby') ?? '';

        expect(document.getElementById(describedBy)?.textContent).toBe(en.statusNotFound);
    });
});
