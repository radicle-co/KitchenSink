/**
 * @module @commise/features-recipes/form — the focus requests an editor row's controls take (§2d), and where focus goes
 * when a commit settles. Both row leaves read it, so the platforms cannot send focus to different places; each carries
 * a request out by its own means.
 *
 * Pure and platform-agnostic.
 */
import type { SettledRowCommit } from '../hooks/useIngredientRowEditor.js';
import type { IngredientLineKey } from './lineKey.js';

/**
 * A row control that can take a requested focus: the food search while the row is in entry, the row's open control
 * ("Edit {amount} {food}", build spec §7.5.1), which every row has, and its `⋯`.
 */
export type RowFocusControl = 'name' | 'open' | 'actions';

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
 * committed hands it to the row's open control now; one on the trailing row keeps it in the emptied trailing field,
 * which is the F1 loop. An authored food goes the same way, but only once its sheet is gone, because on web the sheet's
 * own focus return comes after the close. A shortlist pick also goes to the open control now: the attention line that
 * opened its panel names the state the pick ended, so it is gone and the panel's own return has nowhere to land. A
 * details pick moves nothing: its dialog returns focus to `⋯`. Pure.
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
            : { kind: 'row', request: { key: settled.target.key, control: 'open' } };

    switch (settled.origin.kind) {
        case 'entry':
        case 'shortlist':
            return { when: 'now', focus };
        case 'authoredFood':
            return { when: 'afterAuthoredSheet', focus };
        case 'details':
            return undefined;
    }
};
