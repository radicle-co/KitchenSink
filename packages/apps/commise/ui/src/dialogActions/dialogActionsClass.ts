/**
 * @module @commise/ui/dialog-actions — the web class recipe for the action row, one pure `threshold → className`
 * function per part (the "style recipe" pattern, `button/surfaceClass.ts`).
 *
 * Tailwind finds a container-query class only as a LITERAL string in the source, so every threshold is spelled out
 * here, once, in a closed map. A computed `@[${n}px]/dialog:` would never reach the stylesheet.
 */
import type { DialogActionsSideBySideFrom } from './props.js';

/** The row: stacked, main action on top (`flex-col-reverse`), then one end-aligned row from the threshold. */
const ROW: Readonly<Record<DialogActionsSideBySideFrom, string>> = {
    400: 'flex flex-col-reverse gap-3 @[25rem]/dialog:flex-row @[25rem]/dialog:justify-end',
    600: 'flex flex-col-reverse gap-3 @[37.5rem]/dialog:flex-row @[37.5rem]/dialog:justify-end',
};

/** A Radix slot's width: full while stacked, its own once the row is a row. */
const SLOT: Readonly<Record<DialogActionsSideBySideFrom, string>> = {
    400: 'w-full @[25rem]/dialog:w-auto',
    600: 'w-full @[37.5rem]/dialog:w-auto',
};

/** The classes of the row the buttons sit in. Pure. */
export const dialogActionsRowClass = (sideBySideFrom: DialogActionsSideBySideFrom): string => ROW[sideBySideFrom];

/**
 * The classes a control that is NOT a design-system `Button` (a Radix `Dialog.Close` or `AlertDialog.Cancel` slot,
 * which has no `width` prop) wears inside the row, so it fills the stacked row as a `Button` with `width="fill"` does.
 * Pass the same `sideBySideFrom` the row got. Pure.
 */
export const dialogActionSlotClass = (sideBySideFrom: DialogActionsSideBySideFrom): string => SLOT[sideBySideFrom];
