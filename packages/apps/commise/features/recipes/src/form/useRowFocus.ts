/**
 * @module @commise/features-recipes/form — where focus goes next in the ingredients field group (§2d;
 * `docs/design/rowEditorOpenDecisions.md` items 1, 4, 8 and 11, R7), shared by the web and native leaves.
 *
 * Every request is a LEVEL: it stands until the control reports that it has taken focus, so a control that mounts
 * after the request (the next row's open control after a Remove) still takes it. Where a request comes from is
 * `rowFocus.ts`'s pure rules; this hook holds the levels, reacts to each settled commit once, and holds the two requests
 * that must wait for a surface to be gone: a success from the authored-food Sheet, whose own focus return on web comes
 * after its close (item 1).
 *
 * A refused save or Next (R7) is its OWN level per field (`refusal`), never merged into a field's request here: web
 * reads it as focus and the list (`refusalFocus.ts`), native takes it up without focusing
 * (`docs/design/uiOverhaul/buildSpec.md` §7.8).
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

/**
 * A refused save or Next (R7) pointing at one entry field: its OWN level, apart from the field's settled-commit
 * request. Web reads it as focus and the list (`withRefusalFocus`); native acknowledges it without taking focus
 * (`buildSpec.md` §7.8), so it is never merged here.
 */
export interface RefusalFocus {
    /** The refusal points at this field and nothing has acknowledged it yet. */
    readonly pointed: boolean;
    /** The refusal has been taken up for this field: lowers the row editor's level. */
    readonly onHandled: () => void;
}

/** The field group's focus levels. */
export interface RowFocus {
    readonly name: (key: IngredientLineKey) => ControlFocus;
    /** The row's open control ("Edit {amount} {food}"), which every row has. */
    readonly open: (key: IngredientLineKey) => ControlFocus;
    readonly actions: (key: IngredientLineKey) => ControlFocus;
    readonly trailing: ControlFocus;
    /** Where a refused save points, by field (R7). */
    readonly refusal: {
        readonly name: (key: IngredientLineKey) => RefusalFocus;
        readonly trailing: RefusalFocus;
    };
    readonly request: (key: IngredientLineKey, control: RowFocusControl) => void;
    readonly requestTrailing: () => void;
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
 * @sideEffect Calls `rowEditor.pendingFocusHandled` when a refusal's own acknowledgement is called for the field it
 *   points at.
 */
export function useRowFocus(
    rowEditor: Pick<IngredientRowEditor, 'settled' | 'pendingFocusRequested' | 'pendingFocusHandled' | 'entry'>,
): RowFocus {
    const [request, setRequest] = useState<RowFocusRequest | undefined>(undefined);
    const [trailingRequested, setTrailingRequested] = useState(false);
    const [afterAuthoredSheet, setAfterAuthoredSheet] = useState<SettledFocus | undefined>(undefined);
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

    const pendingHandled = (pointed: boolean) => (): void => {
        if (pointed) {
            rowEditor.pendingFocusHandled();
        }
    };

    return {
        name: (key) => ({
            requested: isFocusRequested(request, key, 'name'),
            onHandled: () => {
                if (isFocusRequested(request, key, 'name')) {
                    clear();
                }
            },
        }),
        open: (key) => ({ requested: isFocusRequested(request, key, 'open'), onHandled: clear }),
        actions: (key) => ({ requested: isFocusRequested(request, key, 'actions'), onHandled: clear }),
        trailing: {
            requested: trailingRequested,
            onHandled: () => setTrailingRequested(false),
        },
        refusal: {
            name: (key) => ({ pointed: pendingKey === key, onHandled: pendingHandled(pendingKey === key) }),
            trailing: { pointed: pendingTrailing, onHandled: pendingHandled(pendingTrailing) },
        },
        request: (key, control) => setRequest({ key, control }),
        requestTrailing: () => setTrailingRequested(true),
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
