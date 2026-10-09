/**
 * @module @commise/features-recipes/editor — each editor section's status, as the section index shows it.
 *
 * ⛔ DERIVED FROM THE ONE PUBLISH VALIDATOR, never a second rule set (build spec §7.2, Settled 18): a section is
 * complete exactly when `validateRecipeForm` has nothing to say about its fields, so the index and Publish cannot
 * disagree. The precedence, first true wins:
 *
 * 1. **Fix before publishing** — Publish was refused and the section holds a blocking error;
 * 2. **Needs attention** — a blocker the cook can already see, such as an ingredient with no food (U28);
 * 3. **In progress** — something entered, but a field Publish needs is empty;
 * 4. **Not started** — the section is empty;
 * 5. Photos & publish has no field of its own: **Optional** until the other three are complete, then **Complete**.
 *
 * The counts read the same predicates the validator does (`isResolvedIngredientId`, `draftQuantityVerdict`): the
 * validator reports one code per field, and the index says how many lines it is about.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Policy — a pure projection of the validator's output into one status per section
 */
import { draftQuantityVerdict } from '../form/quantity.js';
import {
    draftFloorErrors,
    hasEntryText,
    isResolvedIngredientId,
    validateRecipeForm,
    type RecipeFormErrors,
} from '../form/validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../form/values.js';
import { EDITOR_SECTIONS, errorsInSection, type EditorSectionId } from './sections.js';

/** A blocker the cook can already see, before pressing Publish. */
export type AttentionReason =
    | 'titleTooLong'
    | 'titleTooLongToSave'
    | 'servingsPositive'
    | 'timesNonNegative'
    | 'ingredientsUnresolved'
    | 'ingredientsQuantityInvalid';

/** Something entered, but a field Publish needs is missing. */
export type InProgressReason = 'titleRequired' | 'ingredientsPendingText' | 'stepBlank';

/** One section's status. */
export type SectionStatus =
    | { readonly kind: 'fix'; readonly count: number }
    | { readonly kind: 'attention'; readonly reason: AttentionReason; readonly count: number }
    | { readonly kind: 'inProgress'; readonly reason: InProgressReason }
    | { readonly kind: 'notStarted' }
    | { readonly kind: 'optional' }
    | { readonly kind: 'complete' };

/** Every section's status. */
export type SectionStatuses = Readonly<Record<EditorSectionId, SectionStatus>>;

/** What the statuses are derived from. */
export interface SectionStatusInput {
    readonly values: RecipeFormValues;
    /** The text an ingredient entry holds and has not committed (`validateRecipeForm`). */
    readonly pendingEntryText: string;
    /** Whether Publish (or Save changes) has been refused in this editor. */
    readonly publishAttempted: boolean;
}

const COMPLETE: SectionStatus = { kind: 'complete' };
const NOT_STARTED: SectionStatus = { kind: 'notStarted' };

/**
 * Every section's status.
 *
 * @param input - The draft, the entry text and whether Publish was refused.
 * @returns One status per section. Pure.
 */
export function sectionStatusesOf(input: SectionStatusInput): SectionStatuses {
    const errors = validateRecipeForm(input.values, input.pendingEntryText);
    const details = detailsStatus(input, errors);
    const ingredients = ingredientsStatus(input, errors);
    const steps = stepsStatus(input, errors);
    const ready = [details, ingredients, steps].every((status) => status.kind === 'complete');

    return { details, ingredients, steps, photos: ready ? COMPLETE : { kind: 'optional' } };
}

/**
 * How many sections are complete: the guided progress's "{done} of 4 done".
 *
 * @param statuses - Every section's status.
 * @returns The count. Pure.
 */
export function doneCount(statuses: SectionStatuses): number {
    return EDITOR_SECTIONS.filter((section) => statuses[section].kind === 'complete').length;
}

/**
 * The sections that became complete between two derivations, in page order: the polite "Ingredients complete" the
 * cook's own edit earns (build spec §7.2).
 *
 * @param previous - The statuses before.
 * @param next - The statuses after.
 * @returns The newly complete sections. Pure.
 */
export function newlyComplete(previous: SectionStatuses, next: SectionStatuses): readonly EditorSectionId[] {
    return EDITOR_SECTIONS.filter(
        (section) => next[section].kind === 'complete' && previous[section].kind !== 'complete',
    );
}

/** How many codes a section's errors hold. */
function codeCount(errors: RecipeFormErrors): number {
    return Object.values(errors).filter((code) => code !== undefined).length;
}

function detailsStatus(input: SectionStatusInput, errors: RecipeFormErrors): SectionStatus {
    const own = errorsInSection(errors, 'details');

    if (codeCount(own) === 0) {
        return COMPLETE;
    }

    if (input.publishAttempted) {
        return { kind: 'fix', count: codeCount(own) };
    }

    const attention: AttentionReason[] = [];

    if (own.title === 'titleTooLong') {
        // The floor reads the wire's bound, so it alone can say the draft cannot even be saved.
        attention.push(
            draftFloorErrors(input.values).title === 'titleTooLongToSave' ? 'titleTooLongToSave' : 'titleTooLong',
        );
    }

    if (own.servings !== undefined) {
        attention.push('servingsPositive');
    }

    if (own.times !== undefined) {
        attention.push('timesNonNegative');
    }

    const [first] = attention;

    if (first !== undefined) {
        return { kind: 'attention', reason: first, count: attention.length };
    }

    return detailsEntered(input.values) ? { kind: 'inProgress', reason: 'titleRequired' } : NOT_STARTED;
}

/** Whether the cook has typed anything in Details: a field that differs from a new recipe's. */
function detailsEntered(values: RecipeFormValues): boolean {
    const blank = defaultRecipeFormValues();

    return (
        hasEntryText(values.title) ||
        hasEntryText(values.description) ||
        hasEntryText(values.cuisine) ||
        values.tags.length > 0 ||
        values.dietaryFlags.length > 0 ||
        values.difficulty !== undefined ||
        values.mealType !== undefined ||
        values.servings !== blank.servings ||
        values.prepTimeMinutes !== blank.prepTimeMinutes ||
        values.cookTimeMinutes !== blank.cookTimeMinutes
    );
}

function ingredientsStatus(input: SectionStatusInput, errors: RecipeFormErrors): SectionStatus {
    const { ingredients: lines } = input.values;

    if (errors.ingredients === undefined) {
        return COMPLETE;
    }

    const unresolved = lines.filter((line) => !isResolvedIngredientId(line.ingredientId)).length;
    const invalid = lines.filter(
        (line) => isResolvedIngredientId(line.ingredientId) && draftQuantityVerdict(line) === 'invalid',
    ).length;
    const pending = hasEntryText(input.pendingEntryText);

    if (input.publishAttempted) {
        return { kind: 'fix', count: Math.max(1, unresolved + invalid + (pending ? 1 : 0)) };
    }

    if (unresolved > 0) {
        return { kind: 'attention', reason: 'ingredientsUnresolved', count: unresolved };
    }

    if (invalid > 0) {
        return { kind: 'attention', reason: 'ingredientsQuantityInvalid', count: invalid };
    }

    // ⚠️ In progress, not attention: the cook is typing the line right now, and a warning glyph over the field they are
    // typing in would alarm them for doing the next step. A refused Publish turns it into "Fix" above.
    return pending ? { kind: 'inProgress', reason: 'ingredientsPendingText' } : NOT_STARTED;
}

function stepsStatus(input: SectionStatusInput, errors: RecipeFormErrors): SectionStatus {
    const { steps } = input.values;

    if (errors.steps === undefined) {
        return COMPLETE;
    }

    const blank = steps.filter((step) => !hasEntryText(step.instruction)).length;

    if (input.publishAttempted) {
        return { kind: 'fix', count: Math.max(1, blank) };
    }

    return blank < steps.length ? { kind: 'inProgress', reason: 'stepBlank' } : NOT_STARTED;
}
