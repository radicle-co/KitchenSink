/**
 * @module @commise/features-recipes/collections — what the cook is typing into the collection sheet, shared by both
 * leaves (`docs/design/uiOverhaul/buildSpec.md` §5.1).
 *
 * The draft, its refusal of an empty name, the reset each time the sheet opens, and the discard question are the same on
 * every platform; only how the refused field is focused and how the controls are drawn differ, and those stay in the
 * leaves. The sheet holds only the draft: the host owns the request and what follows it.
 *
 * @pattern Memento — the draft restarts from the collection as it is now each time the sheet opens
 */
import { useState } from 'react';

import { COLLECTION_DESCRIPTION_MAX_LENGTH, COLLECTION_NAME_MAX_LENGTH } from './limits.js';
import type { CollectionSheetProps } from './sheetModel.js';

/** What a sheet opened to create starts from. */
const NOTHING: { readonly name: string; readonly description?: string } = { name: '' };

/** The draft and what the leaves do with it. */
export interface CollectionSheetDraft {
    /** The sheet is renaming, not creating. */
    readonly renaming: boolean;
    readonly name: string;
    readonly description: string;
    /** Type into the name; capped, and clears the empty-name error. */
    readonly typeName: (text: string) => void;
    /** Type into the description; capped. */
    readonly typeDescription: (text: string) => void;
    /** The last submit was refused for an empty name. */
    readonly nameError: boolean;
    /** The discard question is showing. */
    readonly confirming: boolean;
    readonly keepEditing: () => void;
    /** Close without asking (the discard question's answer). */
    readonly close: () => void;
    /** Close, asking first when there is something to lose. */
    readonly requestClose: () => void;
    /**
     * Send the draft to the host, or refuse an empty name.
     *
     * @param onRefused - Called when the name is empty, so a leaf can move focus to it.
     */
    readonly submit: (onRefused?: () => void) => void;
}

/**
 * The collection sheet's draft.
 *
 * @param props - The sheet's props: whether it is open, what it starts from, and who it reports to.
 * @returns The draft and its actions.
 * @sideEffect Calls the host's `onOpenChange`, `onCreate` and `onRename`.
 */
export function useCollectionSheetDraft(props: CollectionSheetProps): CollectionSheetDraft {
    const { open, onOpenChange, submitting } = props;
    const renaming = props.intent === 'rename';
    const seed = props.intent === 'rename' ? props.initial : NOTHING;
    const [name, setName] = useState(seed.name);
    const [description, setDescription] = useState(seed.description ?? '');
    const [nameError, setNameError] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);

    const reset = (): void => {
        setName(seed.name);
        setDescription(seed.description ?? '');
        setNameError(false);
        setConfirming(false);
    };

    // Each time it opens it starts from the collection as it is NOW: a rename seeds from `initial`, which may have
    // changed since the sheet last closed. React's "adjust state while rendering", so no effect and no stale frame.
    if (open !== wasOpen) {
        setWasOpen(open);

        if (open) {
            reset();
        }
    }

    // What closing would lose: a typed name when creating, an edit when renaming.
    const dirty = renaming
        ? name.trim() !== seed.name || description.trim() !== (seed.description ?? '')
        : name.trim().length > 0;

    const close = (): void => {
        reset();
        onOpenChange(false);
    };

    return {
        renaming,
        name,
        description,
        typeName: (text) => {
            setName(text.slice(0, COLLECTION_NAME_MAX_LENGTH));
            setNameError(false);
        },
        typeDescription: (text) => setDescription(text.slice(0, COLLECTION_DESCRIPTION_MAX_LENGTH)),
        nameError,
        confirming,
        keepEditing: () => setConfirming(false),
        close,
        requestClose: () => {
            if (dirty && !submitting) {
                setConfirming(true);

                return;
            }

            close();
        },
        submit: (onRefused) => {
            const trimmed = name.trim();

            if (trimmed.length === 0) {
                setNameError(true);
                onRefused?.();

                return;
            }

            const about = description.trim();
            const request = { name: trimmed, ...(about.length === 0 ? {} : { description: about }) };

            if (props.intent === 'rename') {
                props.onRename(request);
            } else {
                props.onCreate(request);
            }
        },
    };
}
