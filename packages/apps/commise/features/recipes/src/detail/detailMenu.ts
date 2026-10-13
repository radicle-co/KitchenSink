/**
 * @module @commise/features-recipes — what the recipe page's ⋯ menu offers (build spec §6.4), decided once for both
 * platforms; each container maps the entries to its own routes and mutations.
 *
 * The owner: Version history · Make private or Make public · Clear checks · then Delete recipe, the one destructive
 * action. Another cook: Clear checks. Clear checks only while a mark is set. Make private is offered to EVERY owner (owner
 * 2026-10-13, B2 E1): a free-tier cook who chooses it gets the Premium sheet from the host (`useGatedPrivate`), so the
 * menu does not decide entitlement — the one place that does is `privateNeedsPremium`.
 *
 * @pattern Policy — one rule over the viewer and the recipe; the containers receive the decided entries
 */

/** A menu entry. */
export type DetailMenuItem = 'versions' | 'makePrivate' | 'makePublic' | 'clearChecks';

/** What the menu offers. */
export interface DetailMenu {
    readonly items: readonly DetailMenuItem[];
    readonly destructive: 'delete' | undefined;
}

/** The facts the menu is decided from. */
export interface DetailMenuInput {
    readonly owner: boolean;
    readonly isPublic: boolean;
    /** Whether the cook has a check or a current step set on this recipe. */
    readonly hasMarks: boolean;
}

/**
 * The ⋯ menu for a viewer and a recipe. Pure.
 *
 * @param input - The viewer's and the recipe's facts.
 * @returns The entries, in order, and the destructive action.
 */
export function detailMenuOf({ owner, isPublic, hasMarks }: DetailMenuInput): DetailMenu {
    const items: DetailMenuItem[] = [];

    if (owner) {
        items.push('versions');

        if (!isPublic) {
            items.push('makePublic');
        } else {
            items.push('makePrivate');
        }
    }

    if (hasMarks) {
        items.push('clearChecks');
    }

    return { items, destructive: owner ? 'delete' : undefined };
}
