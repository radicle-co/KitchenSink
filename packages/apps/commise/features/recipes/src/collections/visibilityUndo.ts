/**
 * @module @commise/features-recipes/collections — whether a collection's visibility change opens the Premium sheet, and
 * whether it can be undone (blueprint Part C, slice 5; `docs/design/uiOverhaul/buildSpec.md` §5.2; plan 2026-10-14-009
 * D14).
 *
 * Undo is a COMPENSATING `setVisibility`, safe because visibility carries no provenance (unlike a removed member). It
 * is offered only when the reverse change would be accepted: going private is a paid feature, so a cook without it who
 * made a private collection public could not get it back, and an Undo the server then refuses is a control that lies.
 * Both questions are the shared Private rule (`../actions/privateGate.ts`) applied to a collection. Pure.
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { mayRestorePrivate, privateNeedsPremium } from '../actions/privateGate.js';

/**
 * Whether making a collection `target` opens the Premium sheet.
 *
 * @param target - The visibility being chosen.
 * @param saved - The visibility the collection has.
 * @param state - The viewer's paid-feature state.
 * @returns `true` only under `upsell`, making a public collection private.
 */
export function visibilityChangeNeedsPremium(
    target: RecipeVisibility,
    saved: RecipeVisibility,
    state: PaidFeatureState,
): boolean {
    return privateNeedsPremium({ target, saved, state });
}

/**
 * Whether undoing a change away from `from` would be accepted.
 *
 * @param change - The visibility the collection had before the change, and the viewer's paid-feature state.
 * @returns `true` when restoring `from` needs nothing the viewer lacks.
 */
export function canUndoVisibilityChange({
    from,
    state,
}: {
    readonly from: RecipeVisibility;
    readonly state: PaidFeatureState;
}): boolean {
    return from !== RecipeVisibility.PRIVATE || mayRestorePrivate(state);
}
