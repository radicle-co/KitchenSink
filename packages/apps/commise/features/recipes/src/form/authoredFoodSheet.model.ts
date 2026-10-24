/**
 * @module @commise/features-recipes/form — the create-my-own-food form on the design-system Sheet: the props both leaves
 * implement (`AuthoredFoodSheet.tsx`, `.native.tsx`) and the rules they share (`docs/design/rowEditorOpenDecisions.md`
 * item 1; `docs/design/rowEditorBlueprint.md` decision 2).
 *
 * The form's states are `useAuthoredFoodCreate`'s (`hooks/authoredFoodCreate.model.ts`), reused as they are
 * (`docs/design/ingredientStatusExplanation.md` §4, "Authoring").
 *
 * Pure: no React, no platform APIs.
 */
import type {
    AuthoredFoodCreateState,
    AuthoredFoodDraft,
    AuthoredFoodFieldError,
} from '../hooks/authoredFoodCreate.model.js';
import type { IngredientCreateFoodMessages } from '../messages.js';

/** Props of the authored-food Sheet leaves. */
export interface AuthoredFoodSheetProps {
    /** The form's state; the Sheet is open for every state but `closed`. */
    readonly state: AuthoredFoodCreateState;
    readonly onFieldChange: (field: keyof AuthoredFoodDraft, value: string) => void;
    readonly onSubmit: () => void;
    /** From the duplicate state: use the cook's existing food. */
    readonly onReuse: () => void;
    /** Every close route: Cancel, Close, Escape, the overlay or scrim, a swipe, Android back. */
    readonly onCancel: () => void;
    /** The Sheet is off screen after a close by any route (`@commise/ui/sheet`). */
    readonly onDismissed: () => void;
}

/** The form's states that show a sheet. */
export type OpenAuthoredFoodState = Exclude<AuthoredFoodCreateState, { readonly kind: 'closed' }>;

/**
 * One field error, worded. Pure.
 *
 * @param copy - The create-food copy.
 * @param error - The field's error key.
 * @returns Its sentence.
 */
export const authoredFieldErrorText = (copy: IngredientCreateFoodMessages, error: AuthoredFoodFieldError): string => {
    switch (error) {
        case 'required':
            return copy.errorRequired;
        case 'not_a_number':
            return copy.errorNotANumber;
        case 'out_of_range':
            return copy.errorOutOfRange;
    }
};

/** A macro field, and its label. */
export interface AuthoredMacroField {
    readonly field: Exclude<keyof AuthoredFoodDraft, 'name'>;
    readonly label: string;
}

/**
 * The four macro fields, in the shared order. Pure.
 *
 * @param copy - The create-food copy.
 * @returns The fields with their labels.
 */
export const authoredMacroFields = (copy: IngredientCreateFoodMessages): readonly AuthoredMacroField[] => [
    { field: 'calories', label: copy.caloriesLabel },
    { field: 'proteinG', label: copy.proteinLabel },
    { field: 'carbsG', label: copy.carbsLabel },
    { field: 'fatG', label: copy.fatLabel },
];
