'use client';

/**
 * @module @commise/features-recipes/actions — what choosing "Private" does in the recipe editor, for both hosts (E1; build
 * spec §6.4 F8, §7.7 item 2): a free-tier cook is told why with the Premium sheet, a Premium cook gets Private, and a
 * choice made while the profile loads waits for it. The decision itself is {@link useGatedPrivate}, shared with the recipe
 * page's ⋯ menu; this only supplies what applying Private means in the editor — setting the draft's visibility.
 *
 * @pattern Adapter — {@link useGatedPrivate} to the visibility field's `canGoPrivate` / `onPremiumRequired` props
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';

import type { RecipeFormValues } from '../form/values.js';
import type { RecipeUpsellSheetProps } from './model.js';
import { useGatedPrivate, type PrivateChoiceProfile } from './useGatedPrivate.js';

export type { PrivateChoiceProfile } from './useGatedPrivate.js';

/** Options for {@link usePrivateChoice}. */
export interface UsePrivateChoiceOptions {
    readonly profile: PrivateChoiceProfile;
    readonly values: RecipeFormValues;
    readonly onChange: (next: RecipeFormValues) => void;
}

/** What the host wires into the visibility field and the sheet. */
export interface PrivateChoice {
    /** For `RecipeVisibilityField.canGoPrivate`: false until the profile says so. */
    readonly canGoPrivate: boolean;
    /** For `RecipeVisibilityField.onPremiumRequired`. */
    readonly onPremiumRequired: () => void;
    /** For `RecipeUpsellSheet`. */
    readonly sheet: RecipeUpsellSheetProps;
}

/**
 * The Private choice for one editor.
 *
 * @param options - The viewer's plan, the draft and how to change it.
 * @returns What the visibility field and the Premium sheet are wired with.
 * @sideEffect Once a profile that loaded settles, applies Private or opens the sheet for a choice made while it loaded.
 */
export function usePrivateChoice(options: UsePrivateChoiceOptions): PrivateChoice {
    const { profile, values, onChange } = options;
    const gate = useGatedPrivate({
        profile,
        apply: () => onChange({ ...values, visibility: RecipeVisibility.PRIVATE }),
    });

    return { canGoPrivate: gate.mayGoPrivate, onPremiumRequired: gate.request, sheet: gate.sheet };
}
