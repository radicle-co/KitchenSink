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
import {
    classifyUnit,
    CUISINES,
    RECIPE_MEAL_TYPES,
    RecipeDifficulty,
    UNIT_VOCABULARY,
    type FoodResolutionStatus,
    type RecipeMealType,
} from '@kitchensink/recipe-core';

import { fillTemplate } from '../list/model.js';
import { computeTotalTime, isResolvedIngredientId } from './model.js';
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
    /**
     * Called when the cook asks to add an ingredient — forwarded straight to the ingredients field group
     * (U28). The composing app OPENS/FOCUSES the ingredient picker; this form owns no picker of its own.
     *
     * ⛔ REQUIRED, exactly like {@link RecipeFormProps.onSubmit} and {@link RecipeFormProps.onCancel}, and
     * for the same reason: a controlled, presentational form cannot answer it, so whoever composes the form
     * must. Optional would let a composition silently ship a "+ Add ingredient" button that does nothing —
     * a quieter version of the dead end U28 exists to remove.
     */
    readonly onRequestAddIngredient: () => void;
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
 * Props for the ingredients field group — {@link RecipeFormSectionProps} plus the one concern no other
 * section has: the "+ Add ingredient" control (U28).
 *
 * ⛔ The callback is REQUIRED, not optional, and that is the point. Optional would let a composition forget
 * to answer the request and silently ship a button that does nothing; required makes every call site a
 * COMPILE error until it decides where the request goes. The leaf itself cannot answer it — the ingredient
 * picker is app-owned and composed alongside this leaf (see the module doc), so the request has to travel
 * up to whoever owns both.
 */
export interface RecipeIngredientsFieldsProps extends RecipeFormSectionProps {
    /**
     * Called when the cook asks to add an ingredient — the composing container OPENS/FOCUSES the ingredient
     * picker. It deliberately does NOT change `values`: a line is appended only once the picker has resolved
     * a food (see {@link appendResolvedIngredient}).
     */
    readonly onRequestAddIngredient: () => void;
}

/** A blank instruction step: empty instruction, no timer. */
export const blankStep = (): RecipeFormStep => ({ instruction: '' });

/**
 * An ingredient line that has RESOLVED to a catalog row — {@link RecipeFormIngredient} with its
 * `ingredientId` narrowed from `string | null` to `string`.
 *
 * DESIGN PATTERN: a domain-narrowed type used as a precondition (make illegal states unrepresentable). It
 * is the type-level half of U28's "no path can create an unresolved row": {@link appendResolvedIngredient}
 * is the ONLY append transition the form has, and it cannot EXPRESS an unresolved line. The producer chain
 * is narrowed all the way back — `toIngredientLine` returns this, `useIngredientResolver` hands this
 * upward, and both platforms' `IngredientPicker` emits this — so a container appending a line the cook
 * never picked is a COMPILE error rather than a row that silently vanishes on save.
 *
 * ⚠️ `RecipeFormIngredient.ingredientId` deliberately STAYS nullable. A draft restored from an older
 * source can genuinely hold an unresolved line, and the leaves must be able to render it and say why —
 * hiding it or dropping it is the failure the ingredient-entry brief names ("Do not design a row that
 * looks complete but is silently discarded"). What U28 removes is the ability to CREATE one, not the
 * ability to REPRESENT one.
 */
export type ResolvedRecipeFormIngredient = RecipeFormIngredient & { readonly ingredientId: string };

/**
 * Append an ingredient line the picker already RESOLVED, joining the section the cook is currently
 * building (U27). Pure — returns the next values, never mutates.
 *
 * ⛔ REPLACED `addIngredient` in U28, which appended a BLANK, UNRESOLVED line from the leaf's "+ Add
 * ingredient" button. That was a dead end in the literal sense: `validateRecipeForm` refused to advance
 * past it and `toCreateRecipeInput` dropped it on save, so the row a cook had just typed into disappeared.
 * The button is now a REQUEST to the picker (`RecipeIngredientsFieldsProps.onRequestAddIngredient`) and
 * this is what the picker's resolution commits.
 *
 * ⚠️ The inherited `groupLabel` is what keeps grouping from being eight identical typings, and moving it
 * here is a fix in its own right — U27 put it on the button, which means it sat ONLY on the path that
 * could not save, while the picker path (the one a cook actually completes) silently lost sectioning. The
 * Figma Make brief is explicit that "per-row typing is the wrong primary interaction"; since this appends
 * at the END, inheriting the LAST line's label is exactly what "name a section once, then keep adding to
 * it" means. Starting a new section stays one edit (type a different label), and an ungrouped list stays
 * ungrouped because there is nothing to inherit.
 *
 * ⛔ ONLY the section is inherited. Carrying the preparation forward would assert "finely chopped" about a
 * food the picker resolved without any such claim.
 *
 * @param values - The current form values.
 * @param line - The resolved line to append (its `ingredientId` is non-null by type).
 * @returns The next values with that line appended.
 */
export const appendResolvedIngredient = (
    values: RecipeFormValues,
    line: ResolvedRecipeFormIngredient,
): RecipeFormValues => {
    // ⛔ Through `sectionLabelOf`, so a cleared or padded label is never propagated onto the next line — the
    // draft's spelling of "ungrouped" is the same one the fold and the wire use.
    const last = values.ingredients[values.ingredients.length - 1];
    const groupLabel = last === undefined ? undefined : sectionLabelOf(last);

    return {
        ...values,
        ingredients: [
            ...values.ingredients,
            // Spread-when-present, never `groupLabel: undefined` — `exactOptionalPropertyTypes`, and the
            // draft must not acquire a key the line does not have. The picker's own label wins when it has
            // one, which is why the inherited value is spread FIRST.
            { ...(groupLabel === undefined ? {} : { groupLabel }), ...line },
        ],
    };
};

/**
 * The section a DRAFT line belongs to — trimmed, with blank read as ungrouped. Pure.
 *
 * ⛔ THE DRAFT NEEDS THIS AND THE WIRE'S `.trim()` CANNOT SUPPLY IT. A cook who clears the section field
 * leaves `''` in the draft, not `undefined`, so a raw comparison splits that line into a section of its own
 * and both leaves render an EMPTY HEADING above it. And `'Dry '` beside `'Dry'` renders two headings a
 * reader cannot tell apart — the very state `0030_ingredient_preparation_and_group.sql` makes the wire trim
 * to prevent, arriving one layer EARLIER, where the wire has not run yet.
 *
 * `toCreateRecipeInput` applies the same rule on the way out, so what the editor SHOWS and what the recipe
 * SAVES are the same grouping.
 *
 * @param line - The draft ingredient line.
 * @returns The trimmed label, or `undefined` when the line is ungrouped.
 */
const sectionLabelOf = (line: RecipeFormIngredient): string | undefined => {
    const label = line.groupLabel?.trim();

    return label === undefined || label === '' ? undefined : label;
};

/** One ingredient line as a section renders it: the line itself, plus its index in `values.ingredients`. */
export interface RecipeIngredientSectionLine {
    /** The line. */
    readonly line: RecipeFormIngredient;
    /**
     * Its index in `values.ingredients` — NOT its position within the section.
     *
     * ⛔ This is what every edit helper takes (`updateIngredientAt`, `removeIngredientAt`) and what the
     * `Ingredient {number}` accessible labels are numbered from, so it must keep addressing the same line.
     * A section-relative index would edit the wrong row while the screen looked perfectly correct.
     */
    readonly index: number;
}

/** A run of consecutive ingredient lines sharing one section label (U27). */
export interface RecipeIngredientSection {
    /** The section heading, or ABSENT for a run of ungrouped lines — which renders with NO chrome at all. */
    readonly label?: string;
    /** The lines in this run, in stored order. */
    readonly lines: readonly RecipeIngredientSectionLine[];
}

/**
 * Fold a recipe's ingredient lines into the sections both form leaves render (U27). Pure.
 *
 * DESIGN PATTERN: pure projection. It is the ONE fold, shared by the web and native leaves, so the two
 * platforms cannot section a recipe differently.
 *
 * ⛔ BY CONSECUTIVE RUN, never by label identity. `[Dry][Wet][Dry]` is THREE sections in that order;
 * grouping by identity would pull the third line up beside the first and REORDER the recipe, which is the
 * one thing a stored order must never do. The accepted consequence is that a label used in two
 * non-adjacent runs renders twice — which is what the array says, and a cook fixes by moving the line.
 *
 * ⚠️ An UNGROUPED recipe folds to ONE section with NO label, and the leaves render no heading for an
 * unlabelled section — so a recipe that never groups looks exactly as it did before U27. Most recipes will
 * never group, and those must not look unfinished.
 *
 * @param values - The current form values.
 * @returns The sections, in stored order; empty when the recipe has no ingredient lines.
 */
export const ingredientSections = (values: RecipeFormValues): readonly RecipeIngredientSection[] =>
    values.ingredients.reduce<RecipeIngredientSection[]>((sections, line, index) => {
        const label = sectionLabelOf(line);
        const previous = sections[sections.length - 1];
        const entry: RecipeIngredientSectionLine = { line, index };

        if (previous !== undefined && previous.label === label) {
            return [...sections.slice(0, -1), { ...previous, lines: [...previous.lines, entry] }];
        }

        return [...sections, { ...(label === undefined ? {} : { label }), lines: [entry] }];
    }, []);

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

/**
 * Set or CLEAR the draft's meal type (plan U34) — the single transition both platform leaves share.
 *
 * Clearing REMOVES the key rather than storing an explicit `undefined`, exactly as {@link setDifficulty}
 * does, and for two compounding reasons: `exactOptionalPropertyTypes` forbids the explicit `undefined`, and
 * `recipeFormValuesEqual` (the discard guard) compares by `JSON.stringify`, which DROPS an
 * `undefined`-valued key — so the two spellings would compare equal while being different objects. Pure.
 *
 * @param values - The current form values.
 * @param mealType - The meal type to state, or `undefined` to clear it back to "not stated".
 * @returns The next values with the meal type set or removed.
 */
export const setMealType = (values: RecipeFormValues, mealType?: RecipeMealType): RecipeFormValues => {
    const { mealType: _current, ...rest } = values;

    return mealType === undefined ? rest : { ...rest, mealType };
};

/** One selectable meal type in the picker. `value` absent = the "not stated" option (clears the field). */
export interface MealTypeOption {
    /** The meal type this option states, or absent for the "not stated" (clear) option. */
    readonly value?: RecipeMealType;
    /** The localized, accessible label shown for the option. */
    readonly label: string;
}

/**
 * The ordered meal-type picker options — the vocabulary in DAY order, then an explicit "not stated" (clear)
 * option — with their localized labels. Derived from `RECIPE_MEAL_TYPES` rather than listed a second time, so
 * a vocabulary addition cannot ship with no way to choose it. Shared by both platform leaves so the option
 * set and order cannot drift. Pure.
 *
 * @param messages - The resolved form messages for the active locale.
 * @returns The picker options in display order, with the clear option last.
 */
export const mealTypeOptions = (messages: RecipeFormMessages): MealTypeOption[] => [
    ...RECIPE_MEAL_TYPES.map((value) => ({ value, label: messages.mealTypeOptions[value] })),
    { label: messages.mealTypeNotStated },
];

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
 * The localized note a NON-CANONICAL unit carries, or `undefined` for an ordinary one (plan U25). Pure.
 *
 * DESIGN PATTERN: the same Specification-to-copy adapter {@link resolutionStatusLabel} is — ONE mapping from
 * a domain verdict to a localized string, shared by both platform leaves so they cannot mark a unit
 * differently.
 *
 * ⛔ The verdict is DERIVED here, at render, from `recipe-core`'s `classifyUnit`. It is never a persisted
 * flag and never a wire field: the unit string already carries the fact, and a stored class beside it would
 * be a second representation that can disagree with the first.
 *
 * ⛔ THREE outcomes, not two, and the third is why this is text rather than styling. A deliberate `handful`
 * must not read like a mistyped `blorp` — a colour-only mark (the Figma Make mockup's) cannot express that,
 * and it fails WCAG 1.4.1 besides. Neither note is an error: an unknown unit is ACCEPTED, never rejected.
 *
 * @param messages - The localized form copy.
 * @param unit - The unit as the cook wrote it; an absent or empty unit is a UNITLESS line, not an
 *   unrecognised one, and carries no note.
 * @returns The note, or `undefined` when the unit is canonical or absent.
 */
export const unitClassNote = (messages: RecipeFormMessages, unit?: string): string | undefined => {
    const written = unit?.trim() ?? '';

    if (written === '') {
        return undefined;
    }

    switch (classifyUnit(written)) {
        case 'canonical':
            return undefined;
        case 'subjective':
            return messages.ingredientUnitSubjectiveNote;
        case 'unknown':
            // ⛔ NOT while the cook is still mid-word. Classifying every keystroke flashes "Unrecognised
            // unit" after `c` and after `cu` on the way to `cup` — telling someone they are wrong while they
            // are still typing the right answer. A value that is a PREFIX of a real unit is withheld
            // judgement, not judged; the note appears once what they typed can no longer become one.
            //
            // ⚠️ Only the UNKNOWN note is deferred. A subjective unit is typed whole (`handful`, `to taste`)
            // and its note is reassurance rather than a correction, so there is nothing to soften.
            //
            // ⛔ THE PREFIX TEST FOLDS CASE AND THE CLASSIFICATION ABOVE DOES NOT, and that asymmetry is the
            // point rather than an inconsistency (U35, owner ruling 2026-08-25). `classifyUnit` is asked
            // about the spelling the cook TYPED, because `T` (tablespoon) and `t` (teaspoon) are different
            // units; `UNIT_VOCABULARY` holds only lower-case canonical forms, so asking it whether `Cup`
            // begins one has to fold, or a cook typing a capital `C` would be told "Unrecognised unit"
            // while still on their way to `Cup`. Two questions, two folds, each right for its own.
            return UNIT_VOCABULARY.some((candidate) => candidate.startsWith(written.toLowerCase()))
                ? undefined
                : messages.ingredientUnitUnknownNote;
    }
};

/**
 * The localized note an UNRESOLVED ingredient line carries, or `undefined` for a line with a food (U28).
 * Pure.
 *
 * DESIGN PATTERN: the same Specification-to-copy adapter that {@link unitClassNote} and
 * {@link resolutionStatusLabel} are — ONE mapping from a domain verdict to a localized string, shared by
 * both platform leaves so they cannot say different things about the same row.
 *
 * ⛔ THE VERDICT COMES FROM THE LINE, NOT FROM `errors`. Until U28 an unresolved row was marked only once a
 * submit attempt had populated `errors.ingredients`, so a draft restored holding one rendered as an
 * ordinary, complete-looking row — and `toCreateRecipeInput` then dropped it in silence on save. The
 * ingredient-entry brief forbids exactly that: "Do not design a row that looks complete but is silently
 * discarded." U28 removes every way to CREATE such a row; this is what keeps one that already exists
 * honest, instead of hiding it or dropping it.
 *
 * ⛔ It reads `isResolvedIngredientId` — the SAME predicate `validateRecipeForm` blocks on — rather than a
 * second `!== null` check. A leaf marking a different set of rows from the set that blocks the wizard is
 * the drift one shared predicate exists to prevent, and an empty-string id is the case that separates them.
 *
 * @param messages - The resolved form messages for the active locale.
 * @param line - The ingredient line to judge.
 * @returns The note, or `undefined` when the line has resolved to a food.
 */
export const unresolvedLineNote = (messages: RecipeFormMessages, line: RecipeFormIngredient): string | undefined =>
    isResolvedIngredientId(line.ingredientId) ? undefined : messages.ingredientNoFoodNote;

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
        case 'PENDING_VERIFICATION':
            // U4c — KTD-A's quiet state: the bind is made, the check is in flight, the figure re-flows when
            // the verdict lands. Deliberately calm copy — there is nothing for the cook to act on yet.
            return messages.statusPendingVerification;
        case 'AMBIGUOUS':
            // U13 (D7/R9) — the gate abstained over materially-different candidates. Author-actionable:
            // the batched review surface and the inline pick affordance both key off this member.
            return messages.statusAmbiguous;
        case 'RESOLVED_UNAVAILABLE':
            // U13 (R20) — bound, but the food is another author's private one. Name-only for this viewer:
            // directionally "details unavailable", never an error, and no pick affordance.
            return messages.statusResolvedUnavailable;
    }
};

/** One label/value pair on the Review step (U33). */
export interface RecipeReviewRow {
    /** The row's localized label — also the row's accessible name on native. */
    readonly label: string;
    /** The row's rendered value, already localized and already formatted. */
    readonly value: string;
}

/**
 * The Review step's rows, in display order (U33) — the ONE statement of what a cook sees on the last step,
 * shared by both platform leaves so a field cannot appear on one platform and not the other.
 *
 * ⛔ Every optional field STATES its absence rather than dropping its row. A row that vanishes is
 * indistinguishable from a row the cook has not scrolled to, and "did I set a difficulty?" is exactly the
 * question this step exists to answer. The ONE exception is the pending-photo row, which is omitted when it
 * would read zero: it describes an OPERATION that is not going to happen, on a step whose job is to scan.
 *
 * ⛔ Meal type, tags and dietary flags are three SEPARATE rows because they are three separate axes. The
 * mockup folded two of them into one array; rendering them as one row here would be the display half of the
 * same mistake.
 *
 * Pure — it formats, it does not fetch, and it reads only `values`.
 *
 * @param values - The draft being reviewed.
 * @param messages - The resolved form messages for the active locale.
 * @returns The rows to render, in order.
 */
export const reviewRows = (values: RecipeFormValues, messages: RecipeFormMessages): RecipeReviewRow[] => {
    const orNotStated = (value: string): string => (value.trim() === '' ? messages.reviewNotStated : value.trim());
    const minutes = (value: number): string => fillTemplate(messages.durationMinutes, { minutes: value });
    const list = (values_: readonly string[]): string =>
        values_.length === 0 ? messages.reviewNone : values_.join(', ');

    return [
        { label: messages.reviewTitle, value: orNotStated(values.title) },
        { label: messages.reviewDescription, value: orNotStated(values.description) },
        { label: messages.reviewCuisine, value: orNotStated(values.cuisine) },
        {
            label: messages.reviewDifficulty,
            value:
                values.difficulty === undefined
                    ? messages.reviewNotStated
                    : (difficultyOptions(messages).find((option) => option.value === values.difficulty)?.label ??
                      messages.reviewNotStated),
        },
        {
            label: messages.reviewMealType,
            value:
                values.mealType === undefined
                    ? messages.reviewNotStated
                    : (mealTypeOptions(messages).find((option) => option.value === values.mealType)?.label ??
                      messages.reviewNotStated),
        },
        { label: messages.reviewServings, value: String(values.servings) },
        { label: messages.reviewPrepTime, value: minutes(values.prepTimeMinutes) },
        { label: messages.reviewCookTime, value: minutes(values.cookTimeMinutes) },
        {
            label: messages.reviewTotalTime,
            value: minutes(computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes)),
        },
        { label: messages.reviewTags, value: list(values.tags) },
        { label: messages.reviewDietaryFlags, value: list(values.dietaryFlags) },
        { label: messages.reviewIngredientCount, value: String(values.ingredients.length) },
        { label: messages.reviewStepCount, value: String(values.steps.length) },
        {
            label: messages.reviewVisibility,
            value: values.visibility === 'private' ? messages.reviewVisibilityPrivate : messages.reviewVisibilityPublic,
        },
        // The one omitted-when-empty row — see this function's own doc.
        ...(values.photos.length === 0
            ? []
            : [{ label: messages.reviewPendingPhotos, value: String(values.photos.length) }]),
    ];
};

/**
 * One ingredient line as the Review step names it — `2 tbsp Olive oil`, or just `Olive oil` when the line
 * states no amount (R40 makes that legal). Pure.
 *
 * @param line - The draft line.
 * @returns The line's display string.
 */
export const reviewIngredientLabel = (line: RecipeFormIngredient): string =>
    [quantityInputValue(line.quantity), line.unit ?? '', line.name].filter((part) => part !== '').join(' ');
