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
 * The widths, in px (web) or dp (native, at text scale 1) of the row's own box, from which two actions sit side by
 * side. The threshold is in text units: native multiplies it by the system text scale clamped to [1, 2]
 * (`isSideBySide.ts`), and web's rem container queries scale with the root font size. A CLOSED union:
 * Tailwind reads a container-query class as a literal, so the web leaf cannot take a free number, and native takes the
 * same type so the two cannot drift. Each value is a measured need, never a default:
 *
 * - `400` — short verb labels ("Keep recipe", "Delete"): `ConfirmDialog`. With `shares="equal"` (the source statement sheet,
 *   `statementActions.fit.test.ts`): both label pairs fit one line in a 194 px half (a 400 box less the 12 gap) at +35% and
 *   +50% label growth on native chrome, measured with the button label role, but for "Make public" at +50%, 195 px, 1 px over (D14). On web chrome (`md:px-5`) "Make public" holds one line to +31% and the other labels to +35%; past that a label wraps inside its half and is never cut off (D15).
 * - `440` — "Cancel" + "Pull 1000 Recipes" (`PullUpdatesDialog`): about 407 px at +35% and about 436 px at +50%, on the same
 *   button geometry as the 600 row. The web dialog's content box is 464 px.
 * - `600` — the longest label pair in the product, "Keep current version" + "Restore this version", at +35% for a
 *   longer translation. Measured with Inter SemiBold 16 (the button label role): 162.6 + 154.1 px of text, two icons of
 *   20 and gaps of 8, `md:px-5` padding, two 1 px borders and the 12 px gap give about 578 px at +35% and about 625 px at
 *   +50%. The web dialog's content box at `md` is 624 px, native tablet sheets are wider, and every phone is far below.
 *   Native's 12 pt padding needs less, so one number serves both.
 *
 * Add a value only with the measurement that earns it, and the literal classes in `dialogActionsClass.ts`.
 */
export type DialogActionsSideBySideFrom = 400 | 440 | 600;

/**
 * How the actions share the row. A layout variant, never a behaviour switch (staff D2):
 *
 * - `'content'` — each action keeps its own width in the row (default; every caller before `shares` existed).
 * - `'equal'` — each action takes an equal share of the row; stacked, each fills it.
 */
export type DialogActionsShares = 'content' | 'equal';

/** Props for `DialogActions`. */
export interface DialogActionsProps {
    /** The row's own width from which the actions sit side by side. Required: a default puts a number on labels nobody measured. */
    readonly sideBySideFrom: DialogActionsSideBySideFrom;
    /** How the actions share the row; `'content'` unless a caller needs equal shares. */
    readonly shares?: DialogActionsShares;
    /** The buttons, in source order: the dismiss action first, the main action last. Give each `width="fill"`. */
    readonly children: ReactNode;
}
