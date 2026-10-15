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
 * The visibility the editor may keep without an entitlement: what the server held when the editor opened, for only as
 * long as the draft keeps it. Pure.
 *
 * A downgraded owner who moves the draft of a private recipe off Private has given that up (the editor confirms it
 * first): the Public write may land before the next one, and Private would then be a change TO private, which the
 * server refuses without an entitled role. Asking the gate with this instead of the opening visibility makes that
 * Private an ordinary change to private — the Premium sheet under `upsell`, not offered under `hidden` — so a refused
 * write cannot be queued from the editor.
 *
 * @param saved - The visibility the server held when the editor opened (`public` for a recipe never saved).
 * @param draft - The draft's visibility.
 * @returns `private` only when both are private.
 */
export function heldVisibility(saved: RecipeVisibility, draft: RecipeVisibility): RecipeVisibility {
    return saved === RecipeVisibility.PRIVATE && draft === RecipeVisibility.PRIVATE
        ? RecipeVisibility.PRIVATE
        : RecipeVisibility.PUBLIC;
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

/** Why the server will refuse a change to private for this viewer: never again (`hidden`), or only with Premium. */
export const PRIVATE_REFUSALS = ['final', 'premium'] as const;

/** One of {@link PRIVATE_REFUSALS}. */
export type PrivateRefusal = (typeof PRIVATE_REFUSALS)[number];

/**
 * Whether the server is KNOWN to refuse a change to private for this viewer, and why. Pure.
 *
 * Only a settled state knows. Under `loading` a write to private goes out and the server decides: withholding it would
 * leave the recipe public, which fails open on privacy. A write this answers for is not sent (the editor's create body
 * and its visibility follow-up); the cook is told why instead.
 *
 * @param state - The viewer's paid-feature state.
 * @returns `final` under `hidden`, `premium` under `upsell`, otherwise `undefined`.
 */
export function privateRefusalOf(state: PaidFeatureState): PrivateRefusal | undefined {
    if (state === 'hidden') {
        return 'final';
    }

    return state === 'upsell' ? 'premium' : undefined;
}

/**
 * Whether an Undo back to private would be accepted. Pure.
 *
 * @param state - The viewer's paid-feature state.
 */
export function mayRestorePrivate(state: PaidFeatureState): boolean {
    return state === 'granted';
}
