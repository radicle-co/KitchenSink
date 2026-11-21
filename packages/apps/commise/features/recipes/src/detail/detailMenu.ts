/**
 * @module @commise/features-recipes — what the recipe page's ⋯ menu offers (build spec §6.4), decided once for both
 * platforms; each container maps the entries to its own routes and mutations.
 *
 * The owner: Version history · Make private or Make public · Clear checks · then Delete recipe, the one destructive
 * action. Another cook: Clear checks. Clear checks only while a mark is set. Make private is offered whenever the host
 * says Private is offered (`offersPrivate` — granted or upsell; owner rulings 2026-10-13: under `hidden` no paid feature
 * and no upsell is visible). What choosing it does is the host's (`useGatedPrivate`): it applies, or opens the Premium
 * sheet. Make public is offered on a private recipe, unless it can never be public (a book or paid-site recipe).
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
    /** Whether Private is offered to this viewer (`offersPrivate` over their paid-feature state). */
    readonly offersPrivate: boolean;
    /**
     * Whether Make public is offered: `true` only when no refusal reason applies (`publicRefusalOf` is `none`), so the menu
     * never offers what the server refuses. REQUIRED, so no host can forget to decide.
     */
    readonly mayBePublic: boolean;
}

/**
 * The ⋯ menu for a viewer and a recipe. Pure.
 *
 * @param input - The viewer's and the recipe's facts.
 * @returns The entries, in order, and the destructive action.
 */
export function detailMenuOf({ owner, isPublic, hasMarks, offersPrivate, mayBePublic }: DetailMenuInput): DetailMenu {
    const items: DetailMenuItem[] = [];

    if (owner) {
        items.push('versions');

        if (!isPublic) {
            if (mayBePublic) {
                items.push('makePublic');
            }
        } else if (offersPrivate) {
            items.push('makePrivate');
        }
    }

    if (hasMarks) {
        items.push('clearChecks');
    }

    return { items, destructive: owner ? 'delete' : undefined };
}
