'use client';

/**
 * @module @commise/features-recipes/actions — asking for Public on a private recipe or collection, for any surface that
 * offers it (the editor's "Who can see it", the recipe page's ⋯ Make public, the collection page). Where going public costs
 * the cook something worth saying, they confirm first (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5), in the words of the
 * consequence the HOST's rule chose (ADR-0073: a recipe's frees a slot; a collection's is still Premium). The host says what applying Public means there, and when it is done: the
 * editor at once, the recipe page when its write succeeds (the dialog stays up, busy, until then).
 *
 * @pattern Guard — a confirmation guard in front of the host's `apply` Command, the shape `useGatedPrivate` has for
 *     Private
 */
import { useState } from 'react';

/** Options for {@link useMakePublicConfirm}. */
export interface UseMakePublicConfirmOptions<TConsequence extends string> {
    /**
     * What going public costs, as the HOST's rule decided it (`recipeMakePublicConsequence` for a recipe,
     * `makePublicConsequence` for a collection), or `none` when there is nothing worth confirming. Taken, not derived: the
     * recipe rule (slots) and the collection rule (Premium) share this one confirmation guard without sharing a rule.
     */
    readonly consequence: TConsequence | 'none';
    /** The words the dialog keeps while it closes after the consequence settled to `none`. */
    readonly fallback: TConsequence;
    /** Make the thing public, and call `done` once it is (the dialog closes then). */
    readonly apply: (done: () => void) => void;
}

/** What the host wires in. */
export interface MakePublicConfirm<TConsequence extends string> {
    /** The cook asked for Public. */
    readonly request: () => void;
    /** For the host's dialog (`RecipeMakePublicDialog`, `CollectionMakePublicDialog`); the host adds `busy` and `error` where its change is a network write. */
    readonly dialog: {
        readonly open: boolean;
        readonly consequence: TConsequence;
        readonly onConfirm: () => void;
        readonly onKeep: () => void;
    };
    /** Whether the cook confirmed in this mount (the editor's statement then takes focus). */
    readonly confirmed: boolean;
}

/**
 * The make-public request for one surface.
 *
 * @param options - The consequence, the words to keep while closing, and what applying Public does.
 * @returns The request, the dialog's props and whether the cook confirmed.
 * @sideEffect Calls `apply` for a request that needs no confirm, and for a confirmed one.
 */
export function useMakePublicConfirm<TConsequence extends string>(
    options: UseMakePublicConfirmOptions<TConsequence>,
): MakePublicConfirm<TConsequence> {
    const { consequence, fallback, apply } = options;
    const [open, setOpen] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    return {
        request: () => {
            if (consequence === 'none') {
                apply(() => undefined);
            } else {
                setOpen(true);
            }
        },
        dialog: {
            // Derived, never stored: a consequence that settles to `none` while the dialog is up has nothing to confirm.
            open: open && consequence !== 'none',
            consequence: consequence === 'none' ? fallback : consequence,
            onConfirm: () => {
                setConfirmed(true);
                apply(() => setOpen(false));
            },
            onKeep: () => setOpen(false),
        },
        confirmed,
    };
}
