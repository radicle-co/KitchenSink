'use client';

/**
 * @module @commise/features-recipes/actions — what choosing "Private" does in the recipe editor, for both hosts (E1;
 * build spec §6.4, §7.7 item 2; owner ruling 2026-10-13; plan 2026-10-14-009 D14). The decision itself is
 * {@link useGatedPrivate}, shared with the recipe page's ⋯ menu; this only supplies what applying Private means in the
 * editor — setting the draft's visibility — and what the visibility leaves render from.
 *
 * Every decision is asked with {@link heldVisibility}, never the visibility the editor opened on: once the draft leaves
 * Private, choosing it again is a change to private like any other. Leaving it is confirmed first for a downgraded
 * owner, who cannot simply come back (`useMakePublicConfirm`, UX SPECIFY 2026-10-15).
 *
 * The host picks the leaf: `offersPrivate` → `RecipeVisibilityField` (Public and Private); otherwise
 * `RecipeVisibilityStatement` (a plain "Who can see it: Public"). Never a mode prop on one leaf.
 *
 * @pattern Adapter — {@link useGatedPrivate} to the visibility leaves' props
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import type { RecipeFormValues } from '../form/values.js';
import type { RecipeMakePublicDialogProps, RecipeUpsellSheetProps } from './model.js';
import { heldVisibility, refusedDraftPrivate } from './privateGate.js';
import { useGatedPrivate } from './useGatedPrivate.js';
import { useMakePublicConfirm } from './useMakePublicConfirm.js';

/** Options for {@link usePrivateChoice}. */
export interface UsePrivateChoiceOptions {
    /** The viewer's paid-feature state (`paidFeatureStateOf`). */
    readonly state: PaidFeatureState;
    /** The visibility the server held when the editor opened (`public` for a recipe never saved). */
    readonly saved: RecipeVisibility;
    readonly values: RecipeFormValues;
    readonly onChange: (next: RecipeFormValues) => void;
}

/** What the host wires into the visibility leaves and the sheet. */
export interface PrivateChoice {
    /** Render `RecipeVisibilityField` when true, `RecipeVisibilityStatement` when false. */
    readonly offersPrivate: boolean;
    /** The facts `RecipeVisibilityField` decides its badge, hint and choices from (`savedVisibility` is the held one). */
    readonly field: { readonly paidFeatures: PaidFeatureState; readonly savedVisibility: RecipeVisibility };
    /** For `RecipeVisibilityField.onPremiumRequired`. */
    readonly onPremiumRequired: () => void;
    /** For `RecipeVisibilityField.onConfirmPublic`: Public at once, or the confirm first (`useMakePublicConfirm`). */
    readonly onConfirmPublic: () => void;
    /** For `RecipeMakePublicDialog`. Confirming changes the draft only, so it is never busy and never fails. */
    readonly confirm: Pick<RecipeMakePublicDialogProps, 'open' | 'consequence' | 'onConfirm' | 'onKeep'>;
    /** For `RecipeVisibilityStatement`. */
    readonly statement: {
        /** A kept draft's Private the server will refuse (`refusedDraftPrivate`): the statement says so. */
        readonly privateUnavailable: boolean;
        /** The cook confirmed Public here, so the statement replaces the field they used and takes its focus. */
        readonly focusOnMount: boolean;
    };
    /** For `RecipeUpsellSheet`. */
    readonly sheet: RecipeUpsellSheetProps;
}

/**
 * The Private choice for one editor.
 *
 * @param options - The viewer's state, the saved visibility, the draft and how to change it.
 * @returns What the visibility leaves and the Premium sheet are wired with.
 * @sideEffect Applying Private changes the draft through `onChange`.
 */
export function usePrivateChoice(options: UsePrivateChoiceOptions): PrivateChoice {
    const { state, values, onChange } = options;
    // ⛔ Not `options.saved`: a cook who has moved the draft off Private has given up the free return to it.
    const saved = heldVisibility(options.saved, values.visibility);
    const gate = useGatedPrivate({
        state,
        saved,
        apply: () => onChange({ ...values, visibility: RecipeVisibility.PRIVATE }),
    });
    const makePublic = useMakePublicConfirm({
        state,
        saved,
        apply: (done) => {
            onChange({ ...values, visibility: RecipeVisibility.PUBLIC });
            done();
        },
    });

    return {
        offersPrivate: gate.offersPrivate,
        field: { paidFeatures: state, savedVisibility: saved },
        onPremiumRequired: gate.request,
        onConfirmPublic: makePublic.request,
        confirm: makePublic.dialog,
        statement: {
            privateUnavailable:
                !gate.offersPrivate && refusedDraftPrivate(state, saved, values.visibility) !== undefined,
            focusOnMount: makePublic.confirmed,
        },
        sheet: gate.sheet,
    };
}
