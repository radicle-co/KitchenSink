/**
 * @module @commise/features-recipes/collections — whether a collection's visibility change is allowed and undoable
 * (blueprint Part C, slice 5; `docs/design/uiOverhaul/buildSpec.md` §5.2).
 *
 * Undo is a COMPENSATING `setVisibility`, safe because visibility carries no provenance (unlike a removed member). It
 * is offered only when the reverse change would be accepted: going private is part of the premium plan, so a free-tier
 * cook who made a private collection public could not get it back, and an Undo the server then refuses is a control
 * that lies. Pure.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';

/**
 * Whether making a collection `target` needs the premium plan the viewer lacks.
 *
 * @param target - The visibility being chosen.
 * @param canGoPrivate - Whether the viewer may make things private (`canGoPrivate`).
 * @returns `true` for a free-tier viewer choosing private.
 */
export function visibilityChangeNeedsPremium(target: RecipeVisibility, canGoPrivate: boolean): boolean {
    return target === RecipeVisibility.PRIVATE && !canGoPrivate;
}

/**
 * Whether undoing a change away from `from` would be accepted.
 *
 * @param change - The visibility the collection had before the change, and whether the viewer may go private.
 * @returns `true` when restoring `from` needs no plan the viewer lacks.
 */
export function canUndoVisibilityChange({
    from,
    canGoPrivate,
}: {
    readonly from: RecipeVisibility;
    readonly canGoPrivate: boolean;
}): boolean {
    return !visibilityChangeNeedsPremium(from, canGoPrivate);
}
