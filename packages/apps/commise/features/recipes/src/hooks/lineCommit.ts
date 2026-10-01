/**
 * @module @commise/features-recipes/hooks — what a cook can commit on an ingredient row, and the ONE decision of which
 * path carries it.
 *
 * Two paths exist, and ADR-0045 (lines 265-269) is why: an ordinary recipe save records no correction even when a
 * line's binding changes, so re-pointing a line the server already STORES teaches (plan 002 R17) only through the
 * rebind command. Everything else — every line on the create form, a line added this session, a declaration — is a
 * draft transition that the next save persists.
 *
 * ⛔ A candidate pick for an `UNRESOLVED` or `AMBIGUOUS` row is NOT a member of this union. It is a server write on
 * the binding, the same on both forms, owned by that row's own panel mutation (blueprint §F); routing it here as
 * `draft` would make the draft adapter decide the route a second time (staff-architect REVIEW F2).
 *
 * ⛔ {@link commitRouteFor} is the only place the choice is made. A second `if (persisted)` elsewhere is how a
 * persisted line ends up re-pointed by a plain save and teaches nothing.
 *
 * Pure: no React, no client. The command and draft adapters that act on the route are built in plan 002 V1 step B7.
 *
 * @pattern Strategy — {@link commitRouteFor} selects the command or the draft strategy for one pick
 */
import type { RebindIngredientLineRequest } from '@kitchensink/schema-recipe';

import { storedPositionOf, type IngredientLineKey } from '../form/lineKey.js';

/** What the cook chose for a row. */
export type IngredientPick =
    /** A food from the suggestions. */
    | { readonly kind: 'catalogFood'; readonly foodId: string; readonly name: string }
    /** A name to resolve as typed. */
    | { readonly kind: 'name'; readonly text: string }
    /** "Use as written": a declaration. It has no rebind target. */
    | { readonly kind: 'declared'; readonly text: string }
    /** The cook's own food, just created and admitted. */
    | { readonly kind: 'admitted'; readonly ingredientId: string; readonly foodId: string; readonly name: string };

/** Which line a pick lands on: an existing row, by key, or the trailing add row. */
export type LineCommitTarget =
    { readonly kind: 'line'; readonly key: IngredientLineKey } | { readonly kind: 'newLine' };

/** The rebind command's target, derived from the published request so it cannot drift (ADR-0014). */
type RebindTarget = RebindIngredientLineRequest['target'];

/** The decision: the command at a stored position, or the draft. */
export type CommitRoute =
    | { readonly route: 'command'; readonly position: number; readonly target: RebindTarget }
    | { readonly route: 'draft' };

/** The rebind target a pick names, or `undefined` when it names none. */
const rebindTargetOf = (pick: IngredientPick): RebindTarget | undefined => {
    switch (pick.kind) {
        case 'catalogFood':
        case 'admitted':
            // The cook's new food goes in as a catalog food: the request schema records that a `catalogFood` rebind
            // with the new id reaches the end state a create arm would.
            return { kind: 'catalogFood', foodId: pick.foodId };
        case 'name':
            return { kind: 'name', name: pick.text };
        case 'declared':
            return undefined;
    }
};

/**
 * Which path commits `pick` on `target`. Pure.
 *
 * @param pick - What the cook chose.
 * @param target - The row it lands on.
 * @param persistedKeys - The stored lines' keys, in stored order (`persistedLineKeysOf`). Empty on the create form.
 * @returns The command at the line's stored position, or the draft.
 */
export const commitRouteFor = (
    pick: IngredientPick,
    target: LineCommitTarget,
    persistedKeys: readonly IngredientLineKey[],
): CommitRoute => {
    if (target.kind === 'newLine') {
        return { route: 'draft' };
    }

    const rebindTarget = rebindTargetOf(pick);
    const position = storedPositionOf(persistedKeys, target.key);

    if (rebindTarget === undefined || position === undefined) {
        return { route: 'draft' };
    }

    return { route: 'command', position, target: rebindTarget };
};
