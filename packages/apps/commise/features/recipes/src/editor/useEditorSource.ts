'use client';

/**
 * @module @commise/features-recipes/editor — the editor's Source (ADR-0089): the web page a recipe was copied from, as one
 * session's state. It owns the things the pure reading (`../form/sourceLink.ts`) cannot: whether the link in the field
 * came from a paste, the link the cook removed (so a later paste does not bring it back), whether the cook has left the
 * field (an unusable address is an error only then, or at a refused Publish, never while they type), what the last paste
 * said and under which paste control, and where focus goes when the notice's Remove takes the source off.
 * Nothing here is persisted: the removed link and the caption die with the editor, and the link itself is the draft's.
 *
 * What a paste does is `pastedSourcePlanOf`'s decision; this hook applies it and says it, as one polite announcement the
 * editor's live region speaks and as a caption under the paste control the cook used.
 *
 * @pattern Headless hook — the Source's state and its commands, with no markup
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

/** The paste control a link came in through: the notice is drawn under it, and focus goes back to it. */
export type PasteOrigin = 'ingredients' | 'steps';

/** What the last paste said. */
interface SourceNotice {
    readonly kind: PastedSourceNote['kind'];
    readonly text: string;
    /** New for each notice, so the live region speaks a repeat. */
    readonly n: number;
    /** The paste control it came in through. */
    readonly origin: PasteOrigin;
}

/** What the editor session hands the Source row and the visibility field. */
export interface EditorSource {
    /** What the row draws. */
    readonly row: SourceRowModel;
    /** The words a paste just said, until the cook removes the source, edits it or pastes again. */
    readonly notice: SourceNotice | undefined;
    /** The draft's Private rule: it follows the DRAFT's source, not the stored one. */
    readonly privateRule: PrivateRule;
    /** The draft is a copy of a web page: Private only, and the reason Public gives. */
    readonly webSource: boolean;
    /** The cook typed in the field. */
    readonly onChange: (text: string) => void;
    /** The cook left the field (or pressed its Done key): an unusable address is now an error. */
    readonly onTouched: () => void;
    /**
     * Take the source off. The row's own Remove lands the cook in the empty field (`focus` absent or true). The paste
     * notice's Remove passes `focus: false`: the cook is at the paste control, so focus goes back THERE, never to a field
     * they were not using.
     */
    readonly remove: (options?: { readonly focus?: boolean }) => void;
    /** The Source field is asked for focus (after the row's Remove). A level, until {@link onFocusHandled}. */
    readonly focusRequested: boolean;
    /** The Source field took a requested focus. */
    readonly onFocusHandled: () => void;
    /** The paste control that is asked for focus (after the notice's Remove). A level, until {@link onPasteFocusHandled}. */
    readonly pasteFocus: PasteOrigin | undefined;
    /** The paste control took a requested focus. */
    readonly onPasteFocusHandled: () => void;
    /** Pasted text carried a link line (or a Commise one): apply what the plan says and say it. */
    readonly applyPasted: (extraction: SourceLinkExtraction, origin: PasteOrigin) => void;
}

/** What {@link useEditorSource} reads. */
export interface UseEditorSourceOptions {
    readonly values: RecipeFormValues;
    /** Apply one draft transition to the draft as it is when it lands (`useRecipeEditor`'s `dispatch`). */
    readonly dispatch: (action: DraftAction) => void;
    /** The recipe the editor opened with, `undefined` for a new one. */
    readonly recipe: RecipeDetail | undefined;
    /** A Publish was refused for the Source: its error shows at once. */
    readonly refused: boolean;
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
            return messages.lockedLeftOut;
    }
}

/**
 * One editor's Source.
 *
 * @param options - The draft, how to change it, the recipe the editor opened with and whether a Publish was refused for it.
 * @returns The row's model, the paste's notice, the draft's rule and the commands.
 */
export function useEditorSource(options: UseEditorSourceOptions): EditorSource {
    const { values, dispatch, recipe, refused } = options;
    const { source: messages } = useMessages(editorMessages);
    const [fromPaste, setFromPaste] = useState(false);
    const [removed, setRemoved] = useState<string | undefined>(undefined);
    const [notice, setNotice] = useState<EditorSource['notice']>(undefined);
    const [focusRequested, setFocusRequested] = useState(false);
    const [pasteFocus, setPasteFocus] = useState<PasteOrigin | undefined>(undefined);
    const [touched, setTouched] = useState(false);

    const say = (note: PastedSourceNote, origin: PasteOrigin): void =>
        setNotice((previous) => ({
            kind: note.kind,
            text: noticeTextOf(note, messages),
            n: (previous?.n ?? 0) + 1,
            origin,
        }));

    return {
        row: sourceRowOf({ values, recipe, fromPaste, showError: touched || refused }),
        notice,
        privateRule: draftPrivateRule(values, recipe),
        webSource: draftSourceOf(values).kind === 'link',
        onChange: (text) => {
            setFromPaste(false);
            setTouched(false);
            setNotice(undefined);
            dispatch({ kind: 'setSourceLink', link: text });
        },
        onTouched: () => setTouched(true),
        remove: (removal) => {
            const link = draftSourceOf(values);

            // Session memory only: a paste of the link the cook just took off must not put it back.
            setRemoved(link.kind === 'link' ? link.link.url : removed);
            setFromPaste(false);
            setTouched(false);

            if (removal?.focus === false) {
                setPasteFocus(notice?.origin);
            } else {
                setFocusRequested(true);
            }

            setNotice(undefined);
            dispatch({ kind: 'setSourceLink', link: '' });
        },
        focusRequested,
        onFocusHandled: () => setFocusRequested(false),
        pasteFocus,
        onPasteFocusHandled: () => setPasteFocus(undefined),
        applyPasted: (extraction, origin) => {
            const plan = pastedSourcePlanOf({ extraction, current: values, recipe, removed });

            if (plan.set !== undefined) {
                setFromPaste(true);
                dispatch({ kind: 'setSourceLink', link: plan.set });
            }

            if (plan.note !== undefined) {
                say(plan.note, origin);
            }
        },
    };
}
