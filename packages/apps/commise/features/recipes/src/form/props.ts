/**
 * @module @commise/features-recipes — shared props + pure state helpers for the recipe create/edit form
 * (T067). The web (`RecipeForm.tsx`) and native (`RecipeForm.native.tsx`) leaves share this one contract
 * and this one set of immutable transitions, so the two platform renders can never drift on the shape of
 * the props or on HOW a field/row edit is applied. No React, no platform APIs — just types + pure helpers.
 *
 * The form is CONTROLLED and presentational: it holds no state, fetches nothing, and resolves no
 * ingredient (the container owns the food-service typeahead). Every edit produces the next
 * {@link RecipeFormValues} and is handed back up via `onChange`.
 */
import { CUISINES, RecipeDifficulty, type FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { RecipeFormErrors, RecipeFormIngredient, RecipeFormStep, RecipeFormValues } from './model.js';
import type { RecipeFormMessages } from './messages.js';

/** Whether the editor is creating a new recipe or editing an existing one (drives headings + submit copy). */
export type RecipeFormMode = 'create' | 'edit';

/**
 * Props for the recipe create/edit form — a controlled, presentational editor covering every
 * {@link RecipeFormValues} field. It performs NO data fetching and resolves NO ingredient; the composing
 * app wires the model helpers (validation, typeahead resolution, submit) to these props.
 */
export interface RecipeFormProps {
    /** The full editable form state (the single source of truth — the form mirrors it, never copies it). */
    readonly values: RecipeFormValues;
    /** Field-level validation messages to surface; absent/empty when the form is valid. */
    readonly errors?: RecipeFormErrors;
    /** Create vs edit — selects the heading and the submit-button copy. */
    readonly mode: RecipeFormMode;
    /** When true, submission is in flight: the submit control is disabled and marked busy. */
    readonly submitting?: boolean;
    /** Called with the next values on every field/row edit (add, remove, or change). */
    readonly onChange: (next: RecipeFormValues) => void;
    /** Called when the user submits the form (the container validates + persists). */
    readonly onSubmit: () => void;
    /** Called when the user cancels/dismisses the editor. */
    readonly onCancel: () => void;
}

/**
 * Props shared by every extracted field-group leaf (`RecipeBasicsFields`, `RecipeIngredientsFields`,
 * `RecipeInstructionsFields`, `RecipeVisibilityField`, in both their `.tsx` and `.native.tsx` forms).
 * Deliberately narrower than {@link RecipeFormProps}: a section is a
 * pure `values -> JSX` slice with no `mode`/`submitting`/`onSubmit`/`onCancel` concerns, so it composes
 * equally under `RecipeForm`'s single `<form>` (T067) AND under a `Wizard.Step` (w3), which needs the SAME
 * fields with none of the form-level chrome.
 */
export interface RecipeFormSectionProps {
    /** The full editable form state — sections read only the slice they render. */
    readonly values: RecipeFormValues;
    /** Field-level validation messages to surface; absent/empty when the form is valid. */
    readonly errors?: RecipeFormErrors;
    /** Called with the next values on every field/row edit (add, remove, or change). */
    readonly onChange: (next: RecipeFormValues) => void;
}

/**
 * A blank ingredient line: unresolved (no catalog id yet), empty name, quantity 1.
 *
 * ⚠️ STILL `1`, not the absent sentinel, and the asymmetry with {@link parseQuantityBound} is deliberate. A
 * cook ADDING a line is overwhelmingly stating an amount, and U9 made "no amount" submittable — so seeding
 * an empty low bound would let a distracted author publish an ingredient with no quantity by doing nothing
 * at all. Absence has to be something the author states (by clearing the field), exactly as it is something
 * a SOURCE states; it is not a default anyone falls into.
 */
export const blankIngredient = (): RecipeFormIngredient => ({ ingredientId: null, name: '', quantity: 1 });

/** A blank instruction step: empty instruction, no timer. */
export const blankStep = (): RecipeFormStep => ({ instruction: '' });

/**
 * Append a blank ingredient line. Pure — returns the next values, never mutates.
 *
 * @param values - The current form values.
 * @returns The next values with one blank ingredient appended.
 */
export const addIngredient = (values: RecipeFormValues): RecipeFormValues => ({
    ...values,
    ingredients: [...values.ingredients, blankIngredient()],
});

/**
 * Remove the ingredient line at `index`. Out-of-range indices are a no-op copy. Pure.
 *
 * @param values - The current form values.
 * @param index - The zero-based line index to remove.
 * @returns The next values with that line removed.
 */
export const removeIngredientAt = (values: RecipeFormValues, index: number): RecipeFormValues => ({
    ...values,
    ingredients: values.ingredients.filter((_, i) => i !== index),
});

/**
 * Patch the ingredient line at `index` with the given partial. Out-of-range indices are a no-op copy. Pure.
 *
 * @param values - The current form values.
 * @param index - The zero-based line index to patch.
 * @param patch - The fields to overwrite on that line.
 * @returns The next values with that line updated.
 */
export const updateIngredientAt = (
    values: RecipeFormValues,
    index: number,
    patch: Partial<RecipeFormIngredient>,
): RecipeFormValues => ({
    ...values,
    ingredients: values.ingredients.map((line, i) => (i === index ? { ...line, ...patch } : line)),
});

/**
 * Parse one QUANTITY bound's raw input text (U9). Pure.
 *
 * ⛔ NOT {@link parseNumericInput}, and reusing that one here is the single most tempting mistake in this
 * unit. `Number('')` is `0`, so the shared parser turns an emptied quantity field into a stated amount of
 * zero — which R40 spent a whole migration removing as a second spelling of "the source stated no amount".
 * The two parsers answer different questions: servings and times must always hold a number, a quantity
 * bound may legitimately hold nothing.
 *
 * A typed `0` or a negative is returned AS the number the user typed, not folded into `undefined`.
 * "That is not an amount" and "you stated no amount" are different things to tell someone, and
 * `draftQuantityVerdict` (`./model.ts`) can only distinguish them if this parser preserves the difference.
 *
 * @param text - The raw input text.
 * @returns The stated number, or `undefined` when the field is blank or holds nothing numeric.
 */
export const parseQuantityBound = (text: string): number | undefined => {
    const trimmed = text.trim();

    if (trimmed === '') {
        return undefined;
    }

    const value = Number(trimmed);

    return Number.isFinite(value) ? value : undefined;
};

/**
 * The text a quantity input DISPLAYS for one bound (U9). Pure — the single formatter both platform leaves
 * use, so an absent amount cannot render as an empty field on one platform and as something else on the other.
 *
 * ⛔ An absent bound renders as the EMPTY STRING. The draft spells an absent lower bound `NaN`
 * (`RecipeFormIngredient.quantity` is a required `number`), and `String(Number.NaN)` is the literal text
 * `"NaN"` — which is what a naive `String(line.quantity)` would have put inside the input.
 *
 * @param bound - The stated bound, or `undefined`/`NaN` when the line states none.
 * @returns The input's value text (`''` when no amount is stated).
 */
export const quantityInputValue = (bound?: number): string =>
    bound === undefined || !Number.isFinite(bound) ? '' : String(bound);

/**
 * Set (or clear) the LOWER bound of the ingredient line at `index` (U9). Pure.
 *
 * Clearing stores the draft's absent sentinel (`NaN`) rather than `0`: `quantity` is a required `number` on
 * the draft, and `0` is the value R40 exists to stop meaning "unstated".
 *
 * @param values - The current form values.
 * @param index - The zero-based line index.
 * @param low - The stated lower bound, or `undefined` to state no amount.
 * @returns The next values with that line's lower bound set or cleared.
 */
export const setIngredientQuantityLow = (values: RecipeFormValues, index: number, low?: number): RecipeFormValues =>
    updateIngredientAt(values, index, { quantity: low ?? Number.NaN });

/**
 * Set (or clear) the UPPER bound of the ingredient line at `index` (U9). Pure.
 *
 * Clearing REMOVES the key, exactly as {@link setDifficulty} does: `exactOptionalPropertyTypes` forbids
 * storing an explicit `undefined`, and — more importantly — `statedQuantity` reads an absent `quantityHigh`
 * as "one value, not a range". A stored `undefined` would type-check and mean the same thing today, and
 * would be the kind of near-miss that survives until something iterates the line's own keys.
 *
 * ⛔ Deliberately NOT expressible through {@link updateIngredientAt}: a `Partial` patch can only ADD or
 * overwrite a key, never delete one, so "clear the upper bound" needs its own transition.
 *
 * @param values - The current form values.
 * @param index - The zero-based line index.
 * @param high - The stated upper bound, or `undefined` to state a single value.
 * @returns The next values with that line's upper bound set or removed.
 */
export const setIngredientQuantityHigh = (
    values: RecipeFormValues,
    index: number,
    high?: number,
): RecipeFormValues => ({
    ...values,
    ingredients: values.ingredients.map((line, i) => {
        if (i !== index) {
            return line;
        }

        const { quantityHigh: _cleared, ...rest } = line;

        return high === undefined ? rest : { ...rest, quantityHigh: high };
    }),
});

/**
 * Append a blank instruction step. Pure.
 *
 * @param values - The current form values.
 * @returns The next values with one blank step appended.
 */
export const addStep = (values: RecipeFormValues): RecipeFormValues => ({
    ...values,
    steps: [...values.steps, blankStep()],
});

/**
 * Remove the step at `index`. Out-of-range indices are a no-op copy. Pure.
 *
 * @param values - The current form values.
 * @param index - The zero-based step index to remove.
 * @returns The next values with that step removed.
 */
export const removeStepAt = (values: RecipeFormValues, index: number): RecipeFormValues => ({
    ...values,
    steps: values.steps.filter((_, i) => i !== index),
});

/**
 * Patch the step at `index` with the given partial. Out-of-range indices are a no-op copy. Pure.
 *
 * @param values - The current form values.
 * @param index - The zero-based step index to patch.
 * @param patch - The fields to overwrite on that step.
 * @returns The next values with that step updated.
 */
export const updateStepAt = (
    values: RecipeFormValues,
    index: number,
    patch: Partial<RecipeFormStep>,
): RecipeFormValues => ({
    ...values,
    steps: values.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
});

/**
 * Set (or clear) the form's author-stated difficulty. Passing a value states it; passing `undefined` clears
 * it back to "not stated" by REMOVING the key (never storing an explicit `undefined`, which
 * `exactOptionalPropertyTypes` forbids and which would misrepresent "not stated"). Pure — the single
 * transition both platform pickers use, so web and native cannot diverge on how a difficulty edit applies.
 *
 * @param values - The current form values.
 * @param difficulty - The chosen difficulty, or `undefined` to clear it to "not stated".
 * @returns The next values with difficulty set or removed.
 */
export const setDifficulty = (values: RecipeFormValues, difficulty?: RecipeDifficulty): RecipeFormValues => {
    const { difficulty: _current, ...rest } = values;

    return difficulty === undefined ? rest : { ...rest, difficulty };
};

/** One selectable difficulty in the picker. `value` absent = the "not stated" option (clears the field). */
export interface DifficultyOption {
    /** The difficulty this option states, or absent for the "not stated" (clear) option. */
    readonly value?: RecipeDifficulty;
    /** The localized, accessible label shown for the option. */
    readonly label: string;
}

/**
 * The ordered difficulty picker options — Easy, Medium, Hard, then an explicit "not stated" (clear) option —
 * with their localized labels. Shared by both platform leaves so the option set and order cannot drift. Pure.
 *
 * @param messages - The resolved form messages for the active locale.
 * @returns The picker options in display order.
 */
export const difficultyOptions = (messages: RecipeFormMessages): DifficultyOption[] => [
    { value: RecipeDifficulty.EASY, label: messages.difficultyEasy },
    { value: RecipeDifficulty.MEDIUM, label: messages.difficultyMedium },
    { value: RecipeDifficulty.HARD, label: messages.difficultyHard },
    { label: messages.difficultyNotStated },
];

/** One selectable cuisine choice in the dropdown/picker. `''` is the explicit "no cuisine stated" choice. */
export interface CuisineOption {
    /** The wire value this option sets (`''` clears the field). */
    readonly value: string;
    /** The visible/accessible label for this option. */
    readonly label: string;
}

/**
 * The ordered cuisine dropdown/picker options (w3/e5): an explicit "no cuisine" clear option, THEN — only
 * when `currentCuisine` is a non-blank value not already in the curated {@link CUISINES} list — that exact
 * custom value (so an existing recipe's non-curated cuisine stays selected/visible instead of silently
 * disappearing), THEN the curated list itself. Shared by both platform leaves so the option set, order, and
 * custom-value handling cannot drift between web's `<select>` and native's picker. Pure.
 *
 * @param currentCuisine - The form's current `cuisine` value (may be blank, curated, or custom).
 * @param messages - The resolved form messages for the active locale.
 * @returns The picker options in display order.
 */
export const cuisineOptions = (currentCuisine: string, messages: RecipeFormMessages): CuisineOption[] => {
    const isCustom = currentCuisine !== '' && !(CUISINES as readonly string[]).includes(currentCuisine);

    return [
        { value: '', label: messages.cuisineUnsetOption },
        ...(isCustom ? [{ value: currentCuisine, label: currentCuisine }] : []),
        ...CUISINES.map((cuisine) => ({ value: cuisine, label: cuisine })),
    ];
};

/**
 * Parse a numeric text input to a finite number, coercing blank/invalid entries to 0 (validation, not this
 * presentational parse, decides whether 0 is acceptable for a given field). Pure.
 *
 * @param text - The raw input text.
 * @returns The parsed number, or 0 when the text is empty or not a finite number.
 */
export const parseNumericInput = (text: string): number => {
    const value = Number(text);

    return Number.isFinite(value) ? value : 0;
};

/**
 * Parse a comma-separated text input into a trimmed, non-empty list of tokens. Pure — order-preserving;
 * empties are dropped. Retained as a general list-parsing util; the tags/dietary fields no longer use it (they
 * moved to the `ChipInput` token control — U6), which appends one chip at a time
 * via {@link addChip} instead of re-parsing a whole comma string on every keystroke.
 *
 * @param text - The raw comma-separated text.
 * @returns The list of trimmed, non-empty tokens.
 */
export const parseCommaList = (text: string): string[] =>
    text
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0);

/**
 * Append `token` (trimmed) to a chip `list`, unless it is blank or a case-insensitive duplicate of a chip
 * already present — the pure transition the `ChipInput` token control commits on
 * each entry (U6, replacing the comma-text field's whole-string re-parse). Returns a NEW array on an actual
 * add and a copy otherwise, so a caller can compare lengths to detect whether anything was added. Pure.
 *
 * @param list - The current chip list.
 * @param token - The raw text the user entered for the next chip.
 * @returns The next chip list (a copy when the token was blank or a duplicate).
 */
export const addChip = (list: readonly string[], token: string): string[] => {
    const trimmed = token.trim();

    if (trimmed === '' || list.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
        return [...list];
    }

    return [...list, trimmed];
};

/**
 * Remove the chip at `index` from a chip `list`. Out-of-range indices are a no-op copy. Pure — the
 * `ChipInput` control's remove-chip transition (U6).
 *
 * @param list - The current chip list.
 * @param index - The zero-based chip index to remove.
 * @returns The next chip list with that chip removed.
 */
export const removeChipAt = (list: readonly string[], index: number): string[] => list.filter((_, i) => i !== index);

/**
 * The localized label for an ingredient line's resolution status. Pure — the single mapping from a
 * {@link FoodResolutionStatus} to its badge copy, shared by both platform leaves.
 *
 * @param messages - The resolved form messages for the active locale.
 * @param status - The line's resolution status.
 * @returns The localized status label.
 */
export const resolutionStatusLabel = (messages: RecipeFormMessages, status: FoodResolutionStatus): string => {
    switch (status) {
        case 'PENDING':
            return messages.statusPending;
        case 'UNRESOLVED':
            return messages.statusUnresolved;
        case 'RESOLVED':
            return messages.statusResolved;
        case 'NOT_FOUND':
            return messages.statusNotFound;
        case 'FAILED':
            return messages.statusFailed;
        case 'NEEDS_REVIEW':
            // U14 — OUR OWN verdict, not food-service's. The gate read the line's raw source text against the
            // food we resolved it to and disagreed, so this line's nutrition is withheld until a human picks.
            return messages.statusNeedsReview;
    }
};
