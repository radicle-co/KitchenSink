/**
 * @module @commise/features-recipes/import — where focus goes when a flagged row's Use saves and the row leaves the list
 * (WCAG 2.4.3 Focus Order; on native the screen-reader cursor). The control that held focus unmounts with its row, so
 * without a destination focus would fall to the page.
 *
 * The destination is the next row's landing control (the same rule a retry uses, `flaggedLandingOf`), or the page
 * heading when no row is left. "Next" follows the matched list's `nextOpenLineKey`: the row after the saved one, else the
 * first row before it, because a row above is still one the cook must settle.
 *
 * Pure and platform-agnostic. The host applies it only when the cook is still on the saved line (`ownsFocus`).
 *
 * @pattern Specification — the one rule for the flagged list's post-save focus
 */
import { flaggedLandingOf, type FlaggedLanding } from './flaggedRowView.js';
import type { ImportFlaggedLineItem } from './props.js';

/** Where focus goes after a save: a row's control, or the heading when no row is left. */
export type FlaggedFocus =
    { readonly kind: 'row'; readonly key: string; readonly landing: FlaggedLanding } | { readonly kind: 'heading' };

/**
 * Where focus goes once a flagged row saves. Pure.
 *
 * @param rows - The flagged rows as listed BEFORE the saved one leaves.
 * @param savedKey - The row that saved.
 * @returns The next row and its landing control, or the heading when none is left.
 */
export function flaggedFocusAfterSave(rows: readonly ImportFlaggedLineItem[], savedKey: string): FlaggedFocus {
    const at = rows.findIndex((row) => row.key === savedKey);
    const next = rows.slice(at + 1).at(0) ?? rows.slice(0, Math.max(at, 0)).at(0);

    return next === undefined ? { kind: 'heading' } : { kind: 'row', key: next.key, landing: flaggedLandingOf(next) };
}
