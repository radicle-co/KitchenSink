'use client';

/**
 * @module @commise/features-recipes/editor — the editor's Source (ADR-0089): the web page a recipe was copied from, as one
 * session's state. It owns the three things the pure reading (`../form/sourceLink.ts`) cannot: whether the link in the field
 * came from a paste, the link the cook removed (so a later paste does not bring it back), and the announcement a paste makes.
 * Nothing here is persisted: the removed link and the caption die with the editor, and the link itself is the draft's.
 *
 * What a paste does is `pastedSourcePlanOf`'s decision; this hook applies it and says it, through one polite occurrence the
 * editor's live region speaks.
 *
 * @pattern Headless hook — the Source's state and its three commands, with no markup
 */
import { useMessages } from '@commise/i18n/react';
import type { PrivateRule, RecipeDetail, SourceLinkExtraction } from '@kitchensink/recipe-core';
import { useState } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import type { DraftAction } from '../form/draftAction.js';
import {
    draftPrivateRule,
    draftSourceOf,
    pastedSourcePlanOf,
    sourceRowOf,
    type PastedSourceNote,
    type SourceRowModel,
} from '../form/sourceLink.js';
import type { RecipeFormValues } from '../form/values.js';
import { editorMessages, type EditorMessages } from './messages.js';

/** What the editor session hands the Source row and the visibility field. */
export interface EditorSource {
    /** What the row draws. */
    readonly row: SourceRowModel;
    /** The words a paste just said, with a number that is new for each, so the live region speaks a repeat. */
    readonly notice: { readonly kind: PastedSourceNote['kind']; readonly text: string; readonly n: number } | undefined;
    /** The draft's Private rule: it follows the DRAFT's source, not the stored one. */
    readonly privateRule: PrivateRule;
    /** The draft is a copy of a web page: Private only, and the reason Public gives. */
    readonly webSource: boolean;
    /** The cook typed in the field. */
    readonly onChange: (text: string) => void;
    /** The cook pressed Remove source. */
    readonly remove: () => void;
    /** The field is asked for focus (after Remove: the cook lands in the empty field). A level, until {@link onFocusHandled}. */
    readonly focusRequested: boolean;
    /** The field took a requested focus. */
    readonly onFocusHandled: () => void;
    /** Pasted text carried a link line (or a Commise one): apply what the plan says and say it. */
    readonly applyPasted: (extraction: SourceLinkExtraction) => void;
}

/** What {@link useEditorSource} reads. */
export interface UseEditorSourceOptions {
    readonly values: RecipeFormValues;
    /** Apply one draft transition to the draft as it is when it lands (`useRecipeEditor`'s `dispatch`). */
    readonly dispatch: (action: DraftAction) => void;
    /** The recipe the editor opened with, `undefined` for a new one. */
    readonly recipe: RecipeDetail | undefined;
}

/**
 * The words of a note. Pure.
 *
 * @param note - What the paste did.
 * @param messages - The Source's copy.
 */
function noticeTextOf(note: PastedSourceNote, messages: EditorMessages['source']): string {
    switch (note.kind) {
        case 'set':
            return fillTemplate(messages.announceSet, { site: note.site });
        case 'keptExisting':
            return fillTemplate(messages.keptExisting, { site: note.site });
        case 'ownSiteLeftOut':
            return messages.ownSiteLeftOut;
        case 'locked':
            return messages.locked;
    }
}

/**
 * One editor's Source.
 *
 * @param options - The draft, how to change it, and the recipe the editor opened with.
 * @returns The row's model, the paste's notice, the draft's rule and the three commands.
 */
export function useEditorSource(options: UseEditorSourceOptions): EditorSource {
    const { values, dispatch, recipe } = options;
    const { source: messages } = useMessages(editorMessages);
    const [fromPaste, setFromPaste] = useState(false);
    const [removed, setRemoved] = useState<string | undefined>(undefined);
    const [notice, setNotice] = useState<EditorSource['notice']>(undefined);
    const [focusRequested, setFocusRequested] = useState(false);

    const say = (note: PastedSourceNote): void =>
        setNotice((previous) => ({ kind: note.kind, text: noticeTextOf(note, messages), n: (previous?.n ?? 0) + 1 }));

    return {
        row: sourceRowOf({ values, recipe, fromPaste }),
        notice,
        privateRule: draftPrivateRule(values, recipe),
        webSource: draftSourceOf(values).kind === 'link',
        onChange: (text) => {
            setFromPaste(false);
            dispatch({ kind: 'setSourceLink', link: text });
        },
        remove: () => {
            const link = draftSourceOf(values);

            // Session memory only: a paste of the link the cook just took off must not put it back.
            setRemoved(link.kind === 'link' ? link.link.url : removed);
            setFromPaste(false);
            setFocusRequested(true);
            dispatch({ kind: 'setSourceLink', link: '' });
        },
        focusRequested,
        onFocusHandled: () => setFocusRequested(false),
        applyPasted: (extraction) => {
            const plan = pastedSourcePlanOf({ extraction, current: values, recipe, removed });

            if (plan.set !== undefined) {
                setFromPaste(true);
                dispatch({ kind: 'setSourceLink', link: plan.set });
            }

            if (plan.note !== undefined) {
                say(plan.note);
            }
        },
    };
}
