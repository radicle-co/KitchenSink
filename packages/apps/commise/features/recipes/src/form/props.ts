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
import { RecipeDifficulty, type FoodResolutionStatus } from '@kitchensink/recipe-core';

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

/** A blank ingredient line: unresolved (no catalog id yet), empty name, quantity 1. */
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
 * Parse a comma-separated text input into a trimmed, non-empty list of tokens (used for tags and dietary
 * flags). Pure — order-preserving; empties are dropped.
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
    }
};
