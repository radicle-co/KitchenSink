'use client';

/**
 * @module @commise/features-recipes/actions — what choosing "Private" does in the recipe editor, for both hosts (E1; build
 * spec §6.4 F8, §7.7 item 2). Choosing Private without the plan used to do nothing at all: neither host passed
 * `onPremiumRequired`. Now it opens the Premium sheet ({@link RecipeUpsellSheetProps}), the way a private collection
 * does.
 *
 * ⛔ A LOADING PROFILE IS NOT THE FREE TIER. `canGoPrivate` is false until the profile arrives, so a Premium cook who taps
 * Private early would be sent to an upsell for a plan they have. While the profile loads the choice is only remembered,
 * and decided once it settles: a Premium cook gets Private, a free-tier cook gets the sheet. The hosts own the profile
 * read; this takes its three facts so it reads no query.
 *
 * @pattern Policy — `visibilityChoice` (the field's) decides what a choice does; this decides WHEN, given the profile
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { useEffect, useEffectEvent, useState } from 'react';

import type { RecipeFormValues } from '../form/values.js';
import type { RecipeUpsellSheetProps } from './model.js';

/** What the host knows of the viewer's plan. */
export type PrivateChoiceProfile =
    | { readonly status: 'loading' }
    /** The profile read has an answer (or failed, which is the free tier: the server enforces the plan either way). */
    | { readonly status: 'settled'; readonly mayGoPrivate: boolean };

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
    const [open, setOpen] = useState(false);
    const [waiting, setWaiting] = useState(false);
    // Counts the times a choice made while loading turned out to be allowed. A counter, never cleared, so the effect
    // below runs once per decision and a later change of the draft cannot run it again.
    const [allowed, setAllowed] = useState(0);
    const settled = profile.status === 'settled';
    const mayGoPrivate = profile.status === 'settled' && profile.mayGoPrivate;

    // React's own derived-state pattern: the profile settling decides the choice that waited for it, in this render.
    if (waiting && settled) {
        setWaiting(false);

        if (mayGoPrivate) {
            setAllowed((count) => count + 1);
        } else {
            setOpen(true);
        }
    }

    const applyPrivate = useEffectEvent((): void => {
        onChange({ ...values, visibility: RecipeVisibility.PRIVATE });
    });

    // @sideEffect Changes the draft, which belongs to the editor: an external store, not this hook's state.
    useEffect(() => {
        if (allowed > 0) {
            applyPrivate();
        }
    }, [allowed]);

    return {
        canGoPrivate: mayGoPrivate,
        onPremiumRequired: () => {
            if (settled) {
                setOpen(true);
            } else {
                setWaiting(true);
            }
        },
        sheet: { open, onOpenChange: setOpen, onSeePremium: () => setOpen(false) },
    };
}
