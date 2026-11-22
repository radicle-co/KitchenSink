/**
 * @module @commise/ui/dialog-actions — the web class recipe for the action row, one pure `threshold → className`
 * function per part (the "style recipe" pattern, `button/surfaceClass.ts`).
 *
 * Tailwind finds a container-query class only as a LITERAL string in the source, so every threshold is spelled out
 * here, once, in a closed map. A computed `@[${n}px]/dialog:` would never reach the stylesheet.
 */
import type { DialogActionsShares, DialogActionsSideBySideFrom } from './props.js';

/** The row: stacked, main action on top (`flex-col-reverse`), then one end-aligned row from the threshold. */
const ROW: Readonly<Record<DialogActionsSideBySideFrom, string>> = {
    400: 'flex flex-col-reverse gap-3 @[25rem]/dialog:flex-row @[25rem]/dialog:justify-end',
    440: 'flex flex-col-reverse gap-3 @[27.5rem]/dialog:flex-row @[27.5rem]/dialog:justify-end',
    600: 'flex flex-col-reverse gap-3 @[37.5rem]/dialog:flex-row @[37.5rem]/dialog:justify-end',
};

/**
 * `shares="equal"`: each child takes an equal share once the row is a row. Child variants (`*:`) under the same container
 * query as the row, so the share and the layout flip at one threshold and no wrapper element is needed.
 */
const EQUAL: Readonly<Record<DialogActionsSideBySideFrom, string>> = {
    400: '@[25rem]/dialog:*:flex-1 @[25rem]/dialog:*:basis-0 @[25rem]/dialog:*:min-w-0',
    440: '@[27.5rem]/dialog:*:flex-1 @[27.5rem]/dialog:*:basis-0 @[27.5rem]/dialog:*:min-w-0',
    600: '@[37.5rem]/dialog:*:flex-1 @[37.5rem]/dialog:*:basis-0 @[37.5rem]/dialog:*:min-w-0',
};

/** A Radix slot's width: full while stacked, its own once the row is a row. */
const SLOT: Readonly<Record<DialogActionsSideBySideFrom, string>> = {
    400: 'w-full @[25rem]/dialog:w-auto',
    440: 'w-full @[27.5rem]/dialog:w-auto',
    600: 'w-full @[37.5rem]/dialog:w-auto',
};

/** The classes of the row the buttons sit in; `'equal'` adds each child's share. Pure. */
export const dialogActionsRowClass = (
    sideBySideFrom: DialogActionsSideBySideFrom,
    shares: DialogActionsShares = 'content',
): string => (shares === 'equal' ? `${ROW[sideBySideFrom]} ${EQUAL[sideBySideFrom]}` : ROW[sideBySideFrom]);

/**
 * The classes a control that is NOT a design-system `Button` (a Radix `Dialog.Close` or `AlertDialog.Cancel` slot,
 * which has no `width` prop) wears inside the row, so it fills the stacked row as a `Button` with `width="fill"` does.
 * Pass the same `sideBySideFrom` the row got. Pure.
 */
export const dialogActionSlotClass = (sideBySideFrom: DialogActionsSideBySideFrom): string => SLOT[sideBySideFrom];
