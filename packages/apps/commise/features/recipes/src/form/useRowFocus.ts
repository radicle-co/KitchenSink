/**
 * @module @commise/features-recipes/form — where focus goes next in the ingredients field group (§2d;
 * `docs/design/rowEditorOpenDecisions.md` items 1, 4, 8 and 11, R7), shared by the web and native leaves.
 *
 * Every request is a LEVEL: it stands until the control reports that it has taken focus, so a control that mounts
 * after the request (a field on another wizard step, a row's glyph after a Remove) still takes it. Where a request
 * comes from is `rowFocus.ts`'s pure rules; this hook holds the levels, reacts to each settled commit once, and holds
 * the two requests that must wait for a surface to be gone: a success from the authored-food Sheet, whose own focus
 * return on web comes after its close (item 1), and row 6's None of these, which waits for the glyph's panel.
 *
 * @pattern Mediator — between the row controls that ask for focus and the controls that take it
 */
import { useState } from 'react';

import type { IngredientRowEditor } from '../hooks/useIngredientRowEditor.js';
import type { IngredientLineKey } from './lineKey.js';
import {
    isFocusRequested,
    settledFocusOf,
    type RowFocusControl,
    type RowFocusRequest,
    type SettledFocus,
} from './rowFocus.js';

/** One control's focus request: a level it lowers once it has taken focus. */
export interface ControlFocus {
    readonly requested: boolean;
    readonly onHandled: () => void;
}

/** An entry field's focus request, which may open its list too. */
export interface EntryFieldFocus extends ControlFocus {
    /** With the focus, open the list: a refused save or Next points at this field (R7). */
    readonly listRequested: boolean;
}

/** A row glyph's focus request, and its panel's close. */
export interface GlyphFocus extends ControlFocus {
    /** The glyph's panel has gone: a request that waited for it moves now. */
    readonly onPanelDismissed: () => void;
}

/** The field group's focus levels. */
export interface RowFocus {
    readonly name: (key: IngredientLineKey) => EntryFieldFocus;
    readonly glyph: (key: IngredientLineKey) => GlyphFocus;
    readonly actions: (key: IngredientLineKey) => ControlFocus;
    readonly trailing: EntryFieldFocus;
    readonly request: (key: IngredientLineKey, control: RowFocusControl) => void;
    readonly requestTrailing: () => void;
    /** A request that waits for its row's glyph panel to be gone, or the panel's own focus return would win. */
    readonly requestAfterGlyphPanel: (request: RowFocusRequest) => void;
    /**
     * The authored-food Sheet has gone: a success's focus moves now (item 1).
     *
     * @returns `true` when it moved focus, so a host whose Sheet returns no focus itself can send it elsewhere.
     */
    readonly authoredSheetDismissed: () => boolean;
}

/**
 * The field group's focus levels.
 *
 * @param rowEditor - The row editor: what settled, and the R7 refusal's level.
 * @returns The levels and the requests.
 * @sideEffect Calls `rowEditor.pendingFocusHandled` when the field a refusal points at takes focus.
 */
export function useRowFocus(
    rowEditor: Pick<IngredientRowEditor, 'settled' | 'pendingFocusRequested' | 'pendingFocusHandled' | 'entry'>,
): RowFocus {
    const [request, setRequest] = useState<RowFocusRequest | undefined>(undefined);
    const [trailingRequested, setTrailingRequested] = useState(false);
    const [afterAuthoredSheet, setAfterAuthoredSheet] = useState<SettledFocus | undefined>(undefined);
    const [afterGlyphPanel, setAfterGlyphPanel] = useState<RowFocusRequest | undefined>(undefined);
    const [seenSettled, setSeenSettled] = useState(rowEditor.settled);
    const pendingTarget = rowEditor.pendingFocusRequested ? rowEditor.entry.pending?.target : undefined;
    const pendingKey = pendingTarget?.kind === 'line' ? pendingTarget.key : undefined;
    const pendingTrailing = pendingTarget?.kind === 'newLine';

    const focusOn = (focus: SettledFocus): void => {
        if (focus.kind === 'row') {
            setRequest(focus.request);
        } else {
            setTrailingRequested(true);
        }
    };

    // Each settled commit is reacted to once. Adjusted during render, React's previous-value form.
    if (rowEditor.settled !== seenSettled) {
        setSeenSettled(rowEditor.settled);

        const next = settledFocusOf(rowEditor.settled);

        if (next?.when === 'now') {
            focusOn(next.focus);
        } else if (next?.when === 'afterAuthoredSheet') {
            setAfterAuthoredSheet(next.focus);
        }
    }

    const clear = (): void => setRequest(undefined);

    return {
        name: (key) => ({
            requested: isFocusRequested(request, key, 'name') || pendingKey === key,
            listRequested: pendingKey === key,
            onHandled: () => {
                if (isFocusRequested(request, key, 'name')) {
                    clear();
                }

                if (pendingKey === key) {
                    rowEditor.pendingFocusHandled();
                }
            },
        }),
        glyph: (key) => ({
            requested: isFocusRequested(request, key, 'glyph'),
            onHandled: clear,
            onPanelDismissed: () => {
                if (afterGlyphPanel?.key === key) {
                    setRequest(afterGlyphPanel);
                    setAfterGlyphPanel(undefined);
                }
            },
        }),
        actions: (key) => ({ requested: isFocusRequested(request, key, 'actions'), onHandled: clear }),
        trailing: {
            requested: trailingRequested || pendingTrailing,
            listRequested: pendingTrailing,
            onHandled: () => {
                setTrailingRequested(false);

                if (pendingTrailing) {
                    rowEditor.pendingFocusHandled();
                }
            },
        },
        request: (key, control) => setRequest({ key, control }),
        requestTrailing: () => setTrailingRequested(true),
        requestAfterGlyphPanel: setAfterGlyphPanel,
        authoredSheetDismissed: () => {
            if (afterAuthoredSheet === undefined) {
                return false;
            }

            focusOn(afterAuthoredSheet);
            setAfterAuthoredSheet(undefined);

            return true;
        },
    };
}
