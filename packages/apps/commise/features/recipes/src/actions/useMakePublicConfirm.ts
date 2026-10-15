'use client';

/**
 * @module @commise/features-recipes/actions — asking for Public on a private recipe, for any surface that offers it
 * (the editor's "Who can see it", the recipe page's ⋯ Make public). A cook who may make it private again goes public
 * at once; a downgraded owner confirms first (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5), in the words
 * {@link makePublicConsequence} chooses. The host says what applying Public means there, and when it is done: the
 * editor at once, the recipe page when its write succeeds (the dialog stays up, busy, until then).
 *
 * @pattern Guard — a confirmation guard in front of the host's `apply` Command, the shape `useGatedPrivate` has for
 *     Private
 */
import type { PaidFeatureState } from '@commise/features-account';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import { useState } from 'react';

import type { RecipeMakePublicDialogProps } from './model.js';
import { makePublicConsequence } from './privateGate.js';

/** Options for {@link useMakePublicConfirm}. */
export interface UseMakePublicConfirmOptions {
    /** The viewer's paid-feature state (`paidFeatureStateOf`). */
    readonly state: PaidFeatureState;
    /** The visibility the cook may keep without an entitlement (the editor's `heldVisibility`; the server's elsewhere). */
    readonly saved: RecipeVisibility;
    /** Make the thing public, and call `done` once it is (the dialog closes then). */
    readonly apply: (done: () => void) => void;
}

/** What the host wires in. */
export interface MakePublicConfirm {
    /** The cook asked for Public. */
    readonly request: () => void;
    /** For `RecipeMakePublicDialog`; the host adds `busy` and `error` where its change is a network write. */
    readonly dialog: Pick<RecipeMakePublicDialogProps, 'open' | 'consequence' | 'onConfirm' | 'onKeep'>;
    /** Whether the cook confirmed in this mount (the editor's statement then takes focus). */
    readonly confirmed: boolean;
}

/**
 * The make-public request for one surface.
 *
 * @param options - The viewer's state, what the cook may keep, and what applying Public does.
 * @returns The request, the dialog's props and whether the cook confirmed.
 * @sideEffect Calls `apply` for a request that needs no confirm, and for a confirmed one.
 */
export function useMakePublicConfirm(options: UseMakePublicConfirmOptions): MakePublicConfirm {
    const { state, saved, apply } = options;
    const [open, setOpen] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const consequence = makePublicConsequence(state, saved);

    return {
        request: () => {
            if (consequence === 'none') {
                apply(() => undefined);
            } else {
                setOpen(true);
            }
        },
        dialog: {
            // Derived, never stored: a state that settles to `granted` while the dialog is up has nothing to confirm.
            open: open && consequence !== 'none',
            consequence: consequence === 'none' ? 'unknown' : consequence,
            onConfirm: () => {
                setConfirmed(true);
                apply(() => setOpen(false));
            },
            onKeep: () => setOpen(false),
        },
        confirmed,
    };
}
