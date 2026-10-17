/**
 * @module @commise/features-recipes/form — what a refused publish says at the top of the Steps list, and which step
 * fields it marks (`docs/design/uiOverhaul/buildSpec.md` §7.6, §7.8). `validateRecipeForm` gives the steps one code,
 * `stepsRequired`, for an empty list AND for an empty step; the two need different words, and only the second has a
 * field to mark. Shared by the web and native Steps leaves.
 *
 * Pure and platform-agnostic.
 */
import type { EditorMessages } from '../editor/messages.js';
import type { RecipeFormErrors } from './validate.js';
import type { RecipeFormValues } from './values.js';

/** The Steps section's refused-publish message. */
export interface StepsMessage {
    /** The words under the H2, at the top of the list. */
    readonly text: string;
    /** The indexes of the empty steps: each field is invalid and described by the message. */
    readonly blank: readonly number[];
}

/**
 * The message a refused publish shows for the steps, or `undefined` when it was not refused for them. Pure.
 *
 * @param values - The draft.
 * @param errors - The refused publish's errors, if any.
 * @param messages - The editor's copy.
 * @returns The message and the steps it marks.
 */
export function stepsMessage(
    values: RecipeFormValues,
    errors: RecipeFormErrors | undefined,
    messages: Pick<EditorMessages, 'steps' | 'index'>,
): StepsMessage | undefined {
    if (errors?.steps === undefined) {
        return undefined;
    }

    const blank = values.steps.flatMap((step, index) => (step.instruction.trim() === '' ? [index] : []));

    return { text: blank.length === 0 ? messages.steps.required : messages.index.reason.stepBlank, blank };
}
