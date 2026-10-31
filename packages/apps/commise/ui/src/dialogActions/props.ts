/**
 * @module @commise/ui/dialog-actions — the platform-neutral prop contract for the design-system `DialogActions`. The web
 * (`DialogActions.tsx`) and native (`DialogActions.native.tsx`) leaves both implement this exact surface.
 *
 * `DialogActions` owns ONE rule: how the action row of a dialog or sheet lays out. Below `sideBySideFrom` the buttons
 * stack full width, the main action on top and the dismiss action nearest the thumb; from it they sit in one row,
 * end-aligned, dismiss first (`docs/design/uiOverhaul/buildSpec.md` §6.5). It owns nothing else: no copy, no buttons, no
 * state.
 */
import type { ReactNode } from 'react';

/**
 * The widths, in px (web) or dp (native) of the row's own box, from which two actions sit side by side. A CLOSED union:
 * Tailwind reads a container-query class as a literal, so the web leaf cannot take a free number, and native takes the
 * same type so the two cannot drift. Each value is a measured need, never a default:
 *
 * - `400` — short verb labels ("Keep recipe", "Delete"): `ConfirmDialog`.
 * - `600` — the longest label pair in the product, "Keep current version" + "Restore this version", at +35% for a
 *   longer translation. Measured with Inter SemiBold 16 (the button label role): 162.6 + 154.1 px of text, two icons of
 *   20 and gaps of 8, `md:px-5` padding, two 1 px borders and the 12 px gap give about 578 px at +35% and about 625 px at
 *   +50%. The web dialog's content box at `md` is 624 px, native tablet sheets are wider, and every phone is far below.
 *   Native's 12 pt padding needs less, so one number serves both.
 *
 * Add a value only with the measurement that earns it, and the literal classes in `dialogActionsClass.ts`.
 */
export type DialogActionsSideBySideFrom = 400 | 600;

/** Props for `DialogActions`. */
export interface DialogActionsProps {
    /** The row's own width from which the actions sit side by side. Required: a default puts a number on labels nobody measured. */
    readonly sideBySideFrom: DialogActionsSideBySideFrom;
    /** The buttons, in source order: the dismiss action first, the main action last. Give each `width="fill"`. */
    readonly children: ReactNode;
}
