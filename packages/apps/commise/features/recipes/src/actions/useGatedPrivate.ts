'use client';

/**
 * @module @commise/features-recipes/actions — asking for Private, for any surface that offers it (editor field, recipe
 * page ⋯ menu). A request either applies at once (the cook may), opens the Premium sheet (the cook may not), or WAITS for a
 * profile that is still loading. The entitlement test is {@link privateNeedsPremium}, the one place a later paid-features
 * gate is added (owner 2026-10-13).
 *
 * ⛔ A LOADING PROFILE IS NOT THE FREE TIER. `mayGoPrivate` is false until the profile arrives, so a Premium cook who asks
 * early would be sent to an upsell for a plan they have. While the profile loads the request is only remembered, and
 * decided once it settles. The hosts own the profile read; this takes its facts so it reads no query.
 *
 * @pattern Policy — `privateNeedsPremium` decides WHAT a request does; this decides WHEN, given the profile
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { useEffect, useEffectEvent, useState } from 'react';

import type { RecipeUpsellSheetProps } from './model.js';
import { privateNeedsPremium } from './privateGate.js';

/** What the host knows of the viewer's plan. */
export type PrivateChoiceProfile =
    | { readonly status: 'loading' }
    /** The profile read has an answer (or failed, which is the free tier: the server enforces the plan either way). */
    | { readonly status: 'settled'; readonly mayGoPrivate: boolean };

/** Options for {@link useGatedPrivate}. */
export interface UseGatedPrivateOptions {
    readonly profile: PrivateChoiceProfile;
    /** Make the thing private: set the draft's field, or send the visibility write. Called only when the cook may. */
    readonly apply: () => void;
}

/** What the host wires in. */
export interface GatedPrivate {
    /** False until the profile says so. */
    readonly mayGoPrivate: boolean;
    /** The cook asked for Private. */
    readonly request: () => void;
    /** For `RecipeUpsellSheet`. */
    readonly sheet: RecipeUpsellSheetProps;
}

/**
 * The Private request for one surface.
 *
 * @param options - The viewer's plan and what applying Private does.
 * @returns The entitlement, the request and the Premium sheet's props.
 * @sideEffect Calls `apply` for a request that was allowed, including one made while the profile loaded.
 */
export function useGatedPrivate(options: UseGatedPrivateOptions): GatedPrivate {
    const { profile, apply } = options;
    const [open, setOpen] = useState(false);
    const [waiting, setWaiting] = useState(false);
    // Counts the times a request made while loading turned out to be allowed. A counter, never cleared, so the effect
    // below runs once per decision and a later render cannot run it again.
    const [allowed, setAllowed] = useState(0);
    const settled = profile.status === 'settled';
    const mayGoPrivate = profile.status === 'settled' && profile.mayGoPrivate;

    // React's own derived-state pattern: the profile settling decides the request that waited for it, in this render.
    if (waiting && settled) {
        setWaiting(false);

        if (privateNeedsPremium(RecipeVisibility.PRIVATE, mayGoPrivate)) {
            setOpen(true);
        } else {
            setAllowed((count) => count + 1);
        }
    }

    const applyPrivate = useEffectEvent((): void => {
        apply();
    });

    // @sideEffect Applies Private, which belongs to the host (an external store or a request), not to this hook's state.
    useEffect(() => {
        if (allowed > 0) {
            applyPrivate();
        }
    }, [allowed]);

    return {
        mayGoPrivate,
        request: () => {
            if (!settled) {
                setWaiting(true);
            } else if (privateNeedsPremium(RecipeVisibility.PRIVATE, mayGoPrivate)) {
                setOpen(true);
            } else {
                apply();
            }
        },
        sheet: { open, onOpenChange: setOpen, onSeePremium: () => setOpen(false) },
    };
}
