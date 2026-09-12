/**
 * @module @commise/features-recipes/form — the focus requests an editor row's controls take (§2d), and where focus goes
 * when the cook leaves a row's entry without a pick (`docs/design/rowEditorOpenDecisions.md` item 4). Both row leaves
 * read it, so the platforms cannot send focus to different places; each carries a request out by its own means.
 *
 * Pure and platform-agnostic.
 */
import type { SettledRowCommit } from '../hooks/useIngredientRowEditor.js';
import type { IngredientRowPresentation } from './ingredientRowPolicy.js';
import type { IngredientLineKey } from './lineKey.js';

/** A row control that can take a requested focus. */
export type RowFocusControl = 'name' | 'glyph' | 'actions';

/**
 * A host's request that one row control take focus: a level, cleared when the control acknowledges it.
 *
 * @notWireShape A focus request between the row editor's leaves, never sent to a service.
 */
export interface RowFocusRequest {
    readonly key: IngredientLineKey;
    readonly control: RowFocusControl;
}

/**
 * The control focus returns to when the cook leaves a row's entry without a pick: the one they came from. Change food
 * is only ever in a `⋮` menu (item 4); None of these is in the candidates panel, which the glyph opens. Pure.
 *
 * @param record - Slot 2 of the row as it reads out of entry mode.
 * @returns `actions` for a row whose actions sit behind `⋮`, else `glyph`.
 */
export const leaveEntryFocus = (record: IngredientRowPresentation['slot2']): RowFocusControl =>
    record.kind === 'menu' ? 'actions' : 'glyph';

/**
 * Whether `request` names this row's `control`. Pure.
 *
 * @param request - The standing request, if any.
 * @param key - The row.
 * @param control - The control.
 * @returns `true` when the request is for it.
 */
export const isFocusRequested = (
    request: RowFocusRequest | undefined,
    key: IngredientLineKey,
    control: RowFocusControl,
): boolean => request?.key === key && request.control === control;

/** Where focus goes once a commit settles: one control of a row, or the trailing row's field. */
export type SettledFocus = { readonly kind: 'row'; readonly request: RowFocusRequest } | { readonly kind: 'trailing' };

/**
 * Where focus goes when a commit settles (§2d, `docs/design/rowEditorOpenDecisions.md` item 1). An entry pick that
 * committed hands it to the row's glyph now; one on the trailing row keeps it in the emptied trailing field, which is
 * the F1 loop. An authored food goes the same way, but only once its sheet is gone, because on web the sheet's own focus
 * return comes after the close. A details pick moves nothing: its dialog returns focus to `⋮`; nor does a row 7 shortlist
 * pick, whose panel returns focus to the glyph. Pure.
 *
 * @param settled - The commit that settled, if any.
 * @returns Where focus goes and when, or `undefined` when focus stays.
 */
export const settledFocusOf = (
    settled: SettledRowCommit | undefined,
): { readonly when: 'now' | 'afterAuthoredSheet'; readonly focus: SettledFocus } | undefined => {
    if (settled?.outcome.kind !== 'committed') {
        return undefined;
    }

    const focus: SettledFocus =
        settled.target.kind === 'newLine'
            ? { kind: 'trailing' }
            : { kind: 'row', request: { key: settled.target.key, control: 'glyph' } };

    switch (settled.origin.kind) {
        case 'entry':
            return { when: 'now', focus };
        case 'authoredFood':
            return { when: 'afterAuthoredSheet', focus };
        case 'details':
        case 'shortlist':
            return undefined;
    }
};
