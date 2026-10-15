'use client';

/**
 * @module @commise/features-recipes/actions — asking for Private, for any surface that offers it (editor field, recipe
 * page ⋯ menu). A request applies at once, opens the Premium sheet, or does nothing, as {@link privateChoice} decides
 * from the viewer's paid-feature state (owner ruling 2026-10-13; plan 2026-10-14-009 D14).
 *
 * ⛔ A LOADING STATE FAILS CLOSED. No surface offers Private for a public thing until the state is known, so a request
 * made while loading does nothing — it neither upsells a cook who may hold the plan nor shows a paid feature to one
 * whose state turns out `hidden`. The hosts own the profile read; this takes the state so it reads no query.
 *
 * @pattern Policy — `privateChoice` decides WHAT a request does; this holds the sheet it may open
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { useState } from 'react';

import type { RecipeUpsellSheetProps } from './model.js';
import { offersPrivate, privateChoice } from './privateGate.js';

/** Options for {@link useGatedPrivate}. */
export interface UseGatedPrivateOptions {
    /** The viewer's paid-feature state (`paidFeatureStateOf`). */
    readonly state: PaidFeatureState;
    /** The visibility the server holds. */
    readonly saved: RecipeVisibility;
    /** Make the thing private: set the draft's field, or send the visibility write. Called only when allowed. */
    readonly apply: () => void;
}

/** What the host wires in. */
export interface GatedPrivate {
    /** Whether the surface offers Private at all (`offersPrivate`). */
    readonly offersPrivate: boolean;
    /** The cook asked for Private. */
    readonly request: () => void;
    /** For `RecipeUpsellSheet`. Open only under `upsell`. */
    readonly sheet: RecipeUpsellSheetProps;
}

/**
 * The Private request for one surface.
 *
 * @param options - The viewer's state, the saved visibility and what applying Private does.
 * @returns Whether Private is offered, the request, and the Premium sheet's props.
 * @sideEffect Calls `apply` for a request that is allowed.
 */
export function useGatedPrivate(options: UseGatedPrivateOptions): GatedPrivate {
    const { state, saved, apply } = options;
    const [open, setOpen] = useState(false);

    return {
        offersPrivate: offersPrivate(state, saved),
        request: () => {
            const outcome = privateChoice({ target: RecipeVisibility.PRIVATE, saved, state });

            if (outcome === 'apply') {
                apply();
            } else if (outcome === 'upsell') {
                setOpen(true);
            }
        },
        // Derived, never stored: a refetch that moves the state off `upsell` closes the sheet in the same render.
        sheet: { open: open && state === 'upsell', onOpenChange: setOpen, onSeePremium: () => setOpen(false) },
    };
}
