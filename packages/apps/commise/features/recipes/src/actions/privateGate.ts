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
 * What making a private thing public costs the cook, which decides whether that step is confirmed first, the confirm's
 * words, and the note on the Public choice (UX SPECIFY 2026-10-15):
 *
 * - `none` — nothing: the cook may make it private again (`granted`), or it is not private.
 * - `final` — under `hidden`: it can never be made private again.
 * - `premium` — under `upsell`: only with Premium.
 * - `unknown` — under `loading`: it may not be possible. True in every state the load can settle to.
 *
 * Pure.
 *
 * @param state - The viewer's paid-feature state.
 * @param saved - The visibility the cook may keep without an entitlement (the editor's {@link heldVisibility}).
 */
export function makePublicConsequence(state: PaidFeatureState, saved: RecipeVisibility): MakePublicConsequence {
    if (saved !== RecipeVisibility.PRIVATE || state === 'granted') {
        return 'none';
    }

    switch (state) {
        case 'hidden':
            return 'final';
        case 'upsell':
            return 'premium';
        case 'loading':
            return 'unknown';
    }
}

/** What making a private thing public costs: {@link makePublicConsequence}. */
export type MakePublicConsequence = 'none' | 'final' | 'premium' | 'unknown';

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
 * Why a Private the server DID refuse (`INVALID_VISIBILITY`) was refused, in the words' key. Pure.
 *
 * The server has already said no, so this always answers: `premium` when the client knows Premium would help, and
 * `final` otherwise — including when it does not know (a failed profile read), because trying again cannot cure it.
 *
 * @param known - The profile's own answer (`knownPaidFeaturesOf`): `undefined` while unknown or after a failed read.
 * @returns The refusal's reason.
 */
export function serverRefusalOf(known: PaidFeatureState | undefined): PrivateRefusal {
    return privateRefusalOf(known ?? 'loading') ?? 'final';
}

/**
 * Whether the draft holds a Private the server is KNOWN to refuse: a draft kept from before the cook lost the paid
 * features, for a recipe that is not held private. Pure.
 *
 * ⛔ `refusal` is a known one — {@link privateRefusalOf} over the profile's own answer — never the display state, in
 * which a failed profile read is `hidden`: "the client does not know" is not "the server said no".
 *
 * @param refusal - Why the server refuses a change to private for this cook, if it is known to.
 * @param held - The visibility the cook may keep without an entitlement ({@link heldVisibility}).
 * @param draft - The draft's visibility.
 * @returns The refusal's reason, or `undefined`.
 */
export function refusedDraftPrivate(
    refusal: PrivateRefusal | undefined,
    held: RecipeVisibility,
    draft: RecipeVisibility,
): PrivateRefusal | undefined {
    return draft === RecipeVisibility.PRIVATE && held !== RecipeVisibility.PRIVATE ? refusal : undefined;
}

/**
 * The visibility the editor's draft actually stands for: Public in place of a draft Private the server is known to
 * refuse ({@link refusedDraftPrivate}), else the draft's own. Pure. The ONE answer the field, the preview and the
 * create body share; the draft keeps its value, so a Private returns if the state settles to `granted`.
 *
 * @param refusal - Why the server refuses a change to private for this cook, if it is known to.
 * @param held - The visibility the cook may keep without an entitlement.
 * @param draft - The draft's visibility.
 */
export function effectiveVisibility(
    refusal: PrivateRefusal | undefined,
    held: RecipeVisibility,
    draft: RecipeVisibility,
): RecipeVisibility {
    return refusedDraftPrivate(refusal, held, draft) === undefined ? draft : RecipeVisibility.PUBLIC;
}

/**
 * Whether an Undo back to private would be accepted. Pure.
 *
 * @param state - The viewer's paid-feature state.
 */
export function mayRestorePrivate(state: PaidFeatureState): boolean {
    return state === 'granted';
}
