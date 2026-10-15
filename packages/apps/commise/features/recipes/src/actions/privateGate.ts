/**
 * @module @commise/features-recipes/actions — THE client rule for "Private", read by every surface that offers it: the
 * editor's visibility field, the recipe page's ⋯ menu, a collection's ⋯ menu and its Undo.
 *
 * Owner ruling 2026-10-13: every upsell and paid feature sits behind the paid-features gate and user roles. A private
 * recipe or collection is a paid feature, so this reads the viewer's {@link PaidFeatureState} — identity's
 * `account.paidFeatures` through `paidFeatureStateOf` — and nothing else:
 *
 * - `granted` — Private works.
 * - `upsell` — Private carries the Premium badge, and choosing it opens the Premium sheet.
 * - `hidden` — no Private and no upsell at all.
 * - `loading` — fails closed: nothing is offered that might have to be taken back.
 *
 * A thing that is ALREADY private (the server holds it so) stays private and shows so in every state, and going back
 * to it needs no entitlement — the server refuses only a change TO private (`visibilityPolicy`,
 * `collectionVisibilityPolicy`), from roles alone.
 *
 * @pattern Specification — pure predicates over the viewer's paid-feature state and the saved visibility
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';

/** What choosing a visibility does: apply it, open the Premium sheet, or nothing. */
export type PrivateChoiceOutcome = 'apply' | 'upsell' | 'none';

/** The facts a visibility choice is decided from. */
export interface PrivateChoiceInput {
    /** The visibility being chosen. */
    readonly target: RecipeVisibility;
    /** The visibility the server holds (a new, unsaved recipe is public). */
    readonly saved: RecipeVisibility;
    /** The viewer's paid-feature state. */
    readonly state: PaidFeatureState;
}

/**
 * Whether Private is offered at all. Pure.
 *
 * @param state - The viewer's paid-feature state.
 * @param saved - The visibility the server holds.
 * @returns `true` for a thing already private, and otherwise only under `granted` or `upsell`.
 */
export function offersPrivate(state: PaidFeatureState, saved: RecipeVisibility): boolean {
    return saved === RecipeVisibility.PRIVATE || state === 'granted' || state === 'upsell';
}

/**
 * What choosing `target` does. Pure.
 *
 * @param input - The choice, the saved visibility and the viewer's state.
 * @returns `apply` for Public, for Private back to a saved Private, and for Private under `granted`; `upsell` for
 *   Private under `upsell`; otherwise `none`.
 */
export function privateChoice({ target, saved, state }: PrivateChoiceInput): PrivateChoiceOutcome {
    if (target !== RecipeVisibility.PRIVATE || saved === RecipeVisibility.PRIVATE || state === 'granted') {
        return 'apply';
    }

    return state === 'upsell' ? 'upsell' : 'none';
}

/**
 * Whether choosing `target` opens the Premium sheet. Pure. The ONE path to an upsell sheet.
 *
 * @param input - The choice, the saved visibility and the viewer's state.
 */
export function privateNeedsPremium(input: PrivateChoiceInput): boolean {
    return privateChoice(input) === 'upsell';
}

/**
 * Whether the Private option carries the Premium badge. Pure.
 *
 * @param state - The viewer's paid-feature state.
 * @param saved - The visibility the server holds.
 */
export function showsPremiumBadge(state: PaidFeatureState, saved: RecipeVisibility): boolean {
    return state === 'upsell' && saved !== RecipeVisibility.PRIVATE;
}

/**
 * Whether making a private thing public cannot be undone — the cook may not choose Private again and is not offered
 * Premium. Pure.
 *
 * @param state - The viewer's paid-feature state.
 * @param saved - The visibility the server holds.
 */
export function privateIsFinal(state: PaidFeatureState, saved: RecipeVisibility): boolean {
    return state === 'hidden' && saved === RecipeVisibility.PRIVATE;
}

/**
 * Whether an Undo back to private would be accepted. Pure.
 *
 * @param state - The viewer's paid-feature state.
 */
export function mayRestorePrivate(state: PaidFeatureState): boolean {
    return state === 'granted';
}
