/**
 * @module @commise/features-recipes/editor — the editor's chrome, decided once for both platforms (build spec §7.1,
 * §7.3, §7.8): the title, the save status line, the primary and its state, the ⋯ discard item, the parked-write
 * alert, the "Fix {n} things" line and the resume notice's words.
 *
 * The web and native editor leaves draw what this returns and decide nothing, so the two cannot disagree about which
 * primary a published recipe gets or when Discard is offered.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — a pure projection of the editor's lifecycle into what its chrome shows
 */
import type { UseRecipeEditorResult } from '../hooks/useRecipeEditor.js';
import { defaultRecipeFormValues, recipeFormValuesEqual } from '../form/values.js';
import { pluralOf, type EditorMessages } from './messages.js';
import type { DraftKeep } from './saveStatus.js';
import { saveStatusText, type SaveStatusLine } from './saveStatusText.js';
import { EDITOR_SECTIONS } from './sections.js';
import type { SectionStatuses } from './sectionStatus.js';

/** What the chrome is derived from. */
export interface EditorChromeInput {
    readonly editor: UseRecipeEditorResult;
    readonly mode: 'create' | 'edit';
    readonly keep: DraftKeep;
    readonly statuses: SectionStatuses;
    readonly messages: EditorMessages;
    readonly locale: string;
    /** The time zone the resume notice's time is told in; the device's when absent. */
    readonly timeZone?: string;
}

/** What a parked-write alert offers, in order: the first is the primary. */
export type FailureActionKind = 'retry' | 'saveAgain' | 'openMyRecipes';

/** The editor's chrome. */
export interface EditorChrome {
    readonly title: string;
    readonly status: SaveStatusLine;
    readonly primary: {
        readonly label: string;
        readonly action: 'publish' | 'saveChanges';
        readonly disabled: boolean;
        readonly busy: boolean;
    };
    /** The ⋯ menu's one destructive item and its confirm title, when there is something to discard. */
    readonly discard: { readonly menuLabel: string; readonly title: string } | undefined;
    /** The alert for a write the cook must decide on, when there is one. */
    readonly failure: { readonly body: string; readonly actions: readonly FailureActionKind[] } | undefined;
    /** "Fix {n} things to publish", after a refused Publish while anything still needs fixing. */
    readonly fixLine: string | undefined;
    /** The resume notice's words, while a published recipe's device changes stand. */
    readonly resumeBody: string | undefined;
}

/**
 * The editor's chrome.
 *
 * @param input - The editor, the statuses, the copy and where drafts are kept.
 * @returns What the header, the action bar and the notices show. Pure.
 */
export function editorChromeOf(input: EditorChromeInput): EditorChrome {
    const { editor, messages: m, keep } = input;
    const published = editor.lifecycle === 'published';
    const fixes = EDITOR_SECTIONS.reduce((sum, section) => {
        const status = input.statuses[section];

        return sum + (status.kind === 'fix' ? status.count : 0);
    }, 0);

    return {
        title: input.mode === 'create' ? m.titleCreate : m.titleEdit,
        status: saveStatusText(editor.saveStatus, keep, m),
        primary: {
            label: published ? m.saveChanges : m.publish,
            action: published ? 'saveChanges' : 'publish',
            disabled: published && !editor.hasUnsavedChanges,
            busy: editor.state.status === 'finishing',
        },
        discard: discardOf(editor, m),
        failure: failureOf(editor, keep, m),
        fixLine: editor.publishAttempted && fixes > 0 ? pluralOf(m.fixCount, fixes, input.locale) : undefined,
        resumeBody:
            editor.resume === undefined
                ? undefined
                : m.resume.body.replace(
                      '{time}',
                      new Intl.DateTimeFormat(input.locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
                      }).format(new Date(editor.resume.savedAt)),
                  ),
    };
}

/** The discard item: a draft once anything exists, a published recipe's changes once there are any. Pure. */
function discardOf(editor: UseRecipeEditorResult, m: EditorMessages): EditorChrome['discard'] {
    if (editor.lifecycle === 'published') {
        return editor.hasUnsavedChanges
            ? { menuLabel: m.discard.menuChanges, title: m.discard.changesTitle }
            : undefined;
    }

    const exists = editor.recipeId !== undefined || !recipeFormValuesEqual(editor.values, defaultRecipeFormValues());

    return exists ? { menuLabel: m.discard.menuDraft, title: m.discard.draftTitle } : undefined;
}

/**
 * The alert for a parked write: a retrying one and a conflict show none (the status says the first, the conflict view
 * is the second). An unknown create can exist on the server, so the cook is sent to look before saving again; an
 * unknown update is safe to resend, because it names its version (ADR-0057). Pure.
 */
function failureOf(editor: UseRecipeEditorResult, keep: DraftKeep, m: EditorMessages): EditorChrome['failure'] {
    const { parked } = editor;

    if (parked === undefined) {
        return undefined;
    }

    switch (parked.failure) {
        case 'transient':
        case 'conflict':
            return undefined;

        case 'terminal':
            return {
                body: keep === 'disk' ? m.failure.terminalBody : m.failure.terminalBodyTab,
                actions: ['retry'],
            };

        case 'unknown':
            return parked.kind === 'create'
                ? { body: m.failure.createUnknownBody, actions: ['openMyRecipes', 'saveAgain'] }
                : { body: m.failure.unknownBody, actions: ['saveAgain'] };

        default: {
            const unreachable: never = parked.failure;

            return unreachable;
        }
    }
}
