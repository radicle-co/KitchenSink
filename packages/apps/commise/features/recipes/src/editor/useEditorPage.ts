/**
 * @module @commise/features-recipes/editor — what the editor page does, for both platform leaves (build spec §7): its
 * statuses from the one validator, its chrome (`editorChrome.ts`), the section index's entries, the scroll spy's
 * current section and the section-change checkpoint it raises, the announcement of a section the cook's own edit
 * completed, a deep link's jump, and the commands its controls issue (×, Publish / Save changes, the alert's actions,
 * the discard confirm).
 *
 * The leaves draw this and add only what their platform alone has: the web's unload prompt, native's screen-reader
 * focus. The app going to the background (web: the tab hidden) is heard as an event from TanStack's `focusManager`,
 * which each platform already drives. It reads the page's `ScrollHost`, so it is called beneath one.
 *
 * @pattern Headless hook — the page's Presentation Model and its commands, rendered by a web and a native leaf
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useScrollHost } from '@commise/ui/scroll-host';
import { focusManager } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';

import { editorChromeOf, type EditorChrome, type FailureActionKind } from './editorChrome.js';
import type { FailureAction, RecipeEditorViewProps } from './frameProps.js';
import { editorMessages, type EditorMessages } from './messages.js';
import { publishNoteOf } from './publishNote.js';
import { sectionIndexEntries, type SectionIndexEntries } from './sectionIndexEntries.js';
import { EDITOR_SECTIONS, isEditorSectionId, type EditorSectionId } from './sections.js';
import { newlyComplete, sectionStatusesOf, type SectionStatuses } from './sectionStatus.js';

/** A section the cook's own edit completed, to announce; `n` advances once per announcement. */
interface Announcement {
    /** The status kinds it was derived at (`statusKey`). */
    readonly key: string;
    readonly statuses: SectionStatuses;
    readonly text: string;
    readonly n: number;
}

/** What the page leaves draw, and the commands their controls issue. */
export interface EditorPage {
    readonly m: EditorMessages;
    readonly chrome: EditorChrome;
    /** "Ready to publish. {n} ingredients have no match…" (owner D20), for the action bar and Photos & publish. */
    readonly publishNote: string | undefined;
    readonly entries: SectionIndexEntries;
    /** The section the reader is in (the scroll spy's), `details` before it reports. */
    readonly current: EditorSectionId;
    readonly announcement: { readonly text: string; readonly n: number };
    /** Whether the discard confirm is open: asked for, or held open while a confirmed Discard waits to finish. */
    readonly confirming: boolean;
    /** A confirmed Discard waits for the recipe's create to answer: the confirm is busy (`editor.discarding`). */
    readonly discarding: boolean;
    readonly askToDiscard: () => void;
    /** Keep editing: closes the confirm, and takes back a Discard that waits (`editor.cancelDiscard`). */
    readonly keepEditing: () => void;
    readonly confirmDiscard: () => void;
    /** × : checkpoint the exit, then leave. Never asks. */
    readonly close: () => void;
    /** The primary: Publish, or a published recipe's Save changes. A refusal jumps to the first section holding one. */
    readonly finish: () => void;
    /** The control for one of a parked write's actions. */
    readonly actionOf: (kind: FailureActionKind) => FailureAction;
}

/** A stable key for a set of statuses, so an effect reruns only when one of them changes. */
function statusKey(statuses: SectionStatuses): string {
    return EDITOR_SECTIONS.map((section) => statuses[section].kind).join(',');
}

/**
 * The editor page's model and commands.
 *
 * @param props - The view's props.
 * @returns What the leaves draw and the commands they issue. @sideEffect Raises checkpoints and jumps the page.
 */
export function useEditorPage(props: RecipeEditorViewProps): EditorPage {
    const { editor, mode, keep, guided, pendingEntryText, initialSection, onClose, onRefused, onOpenMyRecipes } = props;
    const m = useMessages(editorMessages);
    const locale = useLocale();
    const host = useScrollHost();
    const statuses = sectionStatusesOf({
        values: editor.values,
        pendingEntryText,
        publishAttempted: editor.publishAttempted,
    });
    const chrome = editorChromeOf({ editor, mode, keep, statuses, messages: m, locale });
    const current = host.current !== undefined && isEditorSectionId(host.current) ? host.current : 'details';
    const entries = sectionIndexEntries({ statuses, guided, current, messages: m, locale });
    const [confirming, setConfirming] = useState(false);
    const { checkpoint } = editor;
    const { scrollToSection } = host;

    // A deep link's section, once, on mount (blueprint A16: read on mount; it never reaches the server). A later prop
    // is not a deep link.
    const [deepLink] = useState(initialSection);
    const jumpToDeepLink = useEffectEvent((): void => {
        if (deepLink !== undefined) {
            scrollToSection(deepLink);
        }
    });
    useEffect(() => {
        jumpToDeepLink();
    }, []);

    // A section change is a checkpoint (blueprint A3). The host raises the change from its scroll handler; the first
    // section the spy reports is where the page opened, so only a change from one reported section to another counts.
    const onSectionChange = useEffectEvent((current: string | undefined, previous: string | undefined): void => {
        if (previous !== undefined && current !== undefined) {
            checkpoint('sectionChange');
        }
    });
    const { onCurrentChange } = host;
    // @sideEffect Subscribes to the host's section changes for the page's life.
    useEffect(() => onCurrentChange((current, previous) => onSectionChange(current, previous)), [onCurrentChange]);

    // The app going to the background, or the tab hiding, is a checkpoint: the cook may not come back. It is an EVENT —
    // each move from focused to not — so an editor that opens in the background raises nothing until it is left.
    const onHidden = useEffectEvent((): void => checkpoint('appHidden'));
    // @sideEffect Subscribes to TanStack's focus changes for the page's life.
    useEffect(() => {
        let wasFocused = focusManager.isFocused();

        return focusManager.subscribe((focused) => {
            if (wasFocused && !focused) {
                onHidden();
            }

            wasFocused = focused;
        });
    }, []);

    // A section the cook's own edit completed is announced, politely (§7.2), and never one the page opened complete.
    // Derived during render from the statuses last seen, keyed on their kinds (the object is new every render).
    const key = statusKey(statuses);
    const [announced, setAnnounced] = useState<Announcement>(() => ({ key, statuses, text: '', n: 0 }));

    if (key !== announced.key) {
        const [first] = newlyComplete(announced.statuses, statuses);

        setAnnounced(
            first === undefined
                ? { ...announced, key, statuses }
                : { key, statuses, text: m.index.announce[first], n: announced.n + 1 },
        );
    }

    const finish = (): void => {
        const outcome =
            chrome.primary.action === 'saveChanges'
                ? editor.saveChanges(pendingEntryText)
                : editor.publish(pendingEntryText);

        if (outcome.kind === 'refused') {
            if (outcome.section !== undefined) {
                scrollToSection(outcome.section);
            }

            onRefused?.(outcome);
        }
    };

    const actionOf = (kind: FailureActionKind): FailureAction => {
        switch (kind) {
            case 'retry':
                return { label: m.failure.retry, icon: 'refreshCw', onPress: editor.retry };

            case 'saveAgain':
                return { label: m.failure.saveAgain, icon: 'refreshCw', onPress: editor.retry };

            case 'openMyRecipes':
                return { label: m.failure.openMyRecipes, icon: 'bookOpen', onPress: onOpenMyRecipes };

            default: {
                const unreachable: never = kind;

                return unreachable;
            }
        }
    };

    return {
        m,
        chrome,
        publishNote: publishNoteOf(
            { values: editor.values, pendingEntryText, published: editor.lifecycle === 'published' },
            m,
            locale,
        ),
        entries,
        current,
        announcement: { text: announced.text, n: announced.n },
        confirming: confirming || editor.discarding,
        discarding: editor.discarding,
        askToDiscard: () => setConfirming(true),
        keepEditing: () => {
            setConfirming(false);
            editor.cancelDiscard();
        },
        confirmDiscard: () => {
            setConfirming(false);
            editor.discard();
        },
        close: () => {
            checkpoint('editorExit');
            onClose();
        },
        finish,
        actionOf,
    };
}
