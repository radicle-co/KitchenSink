/**
 * @module @commise/features-recipes/form — the read row's `⋯` (build spec §7.5.1): Edit · Food details · the state's
 * remedies · Move to group… · Move up · Move down · divider · Remove. Remove is never a row button.
 *
 * The remedies a state offers are the ONE row policy's (`rowPresentationOf`); this composes them with the items every
 * row has and the items its position allows. A position item is listed only when it does something, never greyed
 * (`docs/design/rowEditorOpenDecisions.md` item 9's rule).
 *
 * Pure and platform-agnostic.
 *
 * @pattern Composite — the state policy's remedies composed with the row's own and its position's items
 */
import type { IngredientRowAction } from './ingredientRowPolicy.js';

/** Every item a read row's `⋯` can hold. */
export type RowMenuAction = 'edit' | 'foodDetails' | 'moveToGroup' | 'moveUp' | 'moveDown' | IngredientRowAction;

/** What the row's position and state allow beyond the policy. Every field is required, so a caller states each. */
export interface RowMenuFacts {
    /** The row is quiet and has a panel worth opening: its food's figures or its explanation. */
    readonly foodDetails: boolean;
    readonly canMoveUp: boolean;
    readonly canMoveDown: boolean;
    /** There is another group to move to (a named group exists, or the line is in one). */
    readonly canMoveToGroup: boolean;
}

/**
 * The row's `⋯` items, in order, Remove last. Pure.
 *
 * @param stateActions - The row policy's actions for the line's state.
 * @param facts - What the row's position and state allow.
 * @returns The items.
 */
export const rowMenuOf = (
    stateActions: readonly IngredientRowAction[],
    facts: RowMenuFacts,
): readonly RowMenuAction[] => [
    'edit',
    ...(facts.foodDetails ? (['foodDetails'] as const) : []),
    ...stateActions.filter((action) => action !== 'remove'),
    ...(facts.canMoveToGroup ? (['moveToGroup'] as const) : []),
    ...(facts.canMoveUp ? (['moveUp'] as const) : []),
    ...(facts.canMoveDown ? (['moveDown'] as const) : []),
    ...(stateActions.includes('remove') ? (['remove'] as const) : []),
];
