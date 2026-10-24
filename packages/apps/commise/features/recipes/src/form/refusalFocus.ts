/**
 * @module @commise/features-recipes/form — WEB's reading of a refusal that points at an entry field
 * (`docs/design/rowEditorOpenDecisions.md` R7 items 2 to 4): the field takes focus and opens its list.
 *
 * Native does not apply it. `docs/design/uiOverhaul/buildSpec.md` §7.8 ("Refused Publish") keeps the keyboard and the
 * list down there, so its leaves acknowledge the refusal without focusing (`RecipeIngredientsFields.native.tsx`).
 *
 * @pattern Decorator — over an entry field's focus input, adding the refusal's request to its focus and list
 */
import type { RefusalFocus } from './useRowFocus.js';

/** The part of an entry field's input that carries focus: `RowEntryFieldInput`, `TrailingEntryFieldInput`. */
export interface RefusalFocusInput {
    readonly focusRequested: boolean;
    /** With the focus request: open the list too. */
    readonly listRequested: boolean;
    readonly onFocusRequestHandled: () => void;
    /** Whether a refusal points at this field, and how it is acknowledged. */
    readonly refusalFocus: RefusalFocus;
}

/**
 * Merge the refusal into the field's focus request, as web has always read it.
 *
 * @param input - The field's input, with the refusal as its own level.
 * @returns The input, asking for focus and the list while the refusal points at the field. Pure.
 */
export function withRefusalFocus<T extends RefusalFocusInput>(input: T): T {
    const { pointed, onHandled } = input.refusalFocus;

    return {
        ...input,
        focusRequested: input.focusRequested || pointed,
        listRequested: input.listRequested || pointed,
        onFocusRequestHandled: () => {
            input.onFocusRequestHandled();
            onHandled();
        },
    };
}
