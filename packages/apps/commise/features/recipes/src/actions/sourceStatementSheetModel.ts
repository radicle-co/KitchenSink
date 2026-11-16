/**
 * @module @commise/features-recipes/actions — what the source-statement sheet draws, decided once for both platform leaves
 * (ADR-0095): its answers with their words, the field the chosen answer reveals and its error, the confirm and dismiss labels,
 * and whether the confirm can be pressed.
 *
 * Pure and platform-agnostic: the web and native leaves render this and hold no decision of their own, so they cannot differ
 * about a phase.
 *
 * @pattern Presentation model — one pure projection of the state and the copy, rendered by two leaves
 */
import type { RadioListOption } from '@commise/ui/radio-list';

import type { EditorMessages } from '../editor/messages.js';
import type { SourceStatementMessages } from './messages.js';
import {
    answersFor,
    phaseOf,
    visibleFieldErrorOf,
    type StatementAnswer,
    type StatementSheetState,
    type StatementSurface,
} from './sourceStatement.js';

/** The field an answer reveals. */
interface StatementFieldView {
    readonly kind: 'link' | 'bookTitle';
    readonly label: string;
    readonly value: string;
    /** The error to say, when the cook has pressed Confirm over a field that cannot be used. */
    readonly error: string | undefined;
    /** Take focus: a Confirm over this field just failed. */
    readonly focusRequested: boolean;
    readonly inputMode: 'url' | 'text';
    readonly autoCapitalize: 'none' | 'sentences';
}

/**
 * Words the sheet takes from where they already live, so each is said by one key: the Source field's label and errors (the
 * link field is the editor's own) and the recipe page's "couldn't change who can see this recipe".
 */
export interface StatementSharedCopy {
    readonly source: Pick<EditorMessages['source'], 'label' | 'invalid' | 'ownSite'>;
    /** Said above the footer when the change fails (`visibility.error`). */
    readonly failure: string;
}

/** What the sheet draws. */
export interface StatementSheetView {
    readonly options: readonly RadioListOption<StatementAnswer>[];
    readonly value: StatementAnswer | undefined;
    readonly field: StatementFieldView | undefined;
    readonly confirmLabel: string;
    readonly dismissLabel: string;
    /** No answer yet: the confirm is drawn and read as unavailable, and still focusable. */
    readonly confirmRefused: boolean;
    /** The change is in flight (the recipe page): the confirm is busy; the list and the dismiss cannot be used. */
    readonly busy: boolean;
    /** The last change failed: the words, above the footer. */
    readonly errorText: string | undefined;
}

/** The label of each answer. */
const LABEL_KEY = {
    authored: 'answerAuthored',
    publicWeb: 'answerWeb',
    book: 'answerBook',
    fromPerson: 'answerPerson',
    publishPrivately: 'answerPublishPrivately',
} as const satisfies Record<StatementAnswer, keyof SourceStatementMessages>;

/** The hint under each answer; "publish privately" says what it is in its label alone. */
const HINT_KEY = {
    authored: 'hintAuthored',
    publicWeb: 'hintPrivate',
    book: 'hintPrivate',
    fromPerson: 'hintPerson',
    publishPrivately: undefined,
} as const satisfies Record<StatementAnswer, keyof SourceStatementMessages | undefined>;

/**
 * The words of a field error.
 *
 * @param error - What is wrong with the revealed field.
 * @param m - The sheet's copy.
 * @param shared - The words the sheet reuses.
 * @returns The sentence. An empty link is "not a web link": the Source field has no separate word for it. Pure.
 */
function fieldErrorTextOf(
    error: NonNullable<ReturnType<typeof visibleFieldErrorOf>>,
    m: SourceStatementMessages,
    shared: StatementSharedCopy,
): string {
    if (error.field === 'bookTitle') {
        return m.bookTitleError;
    }

    return { required: shared.source.invalid, invalid: shared.source.invalid, ownSite: shared.source.ownSite }[
        error.reason
    ];
}

/**
 * The field the chosen answer reveals.
 *
 * @param state - What the cook has done.
 * @param m - The sheet's copy.
 * @param shared - The words the sheet reuses.
 * @returns The field, or `undefined` for an answer that asks nothing more. Pure.
 */
function fieldViewOf(
    state: StatementSheetState,
    m: SourceStatementMessages,
    shared: StatementSharedCopy,
): StatementFieldView | undefined {
    const error = visibleFieldErrorOf(state);
    const shown = {
        error: error === undefined ? undefined : fieldErrorTextOf(error, m, shared),
        focusRequested: state.focusPending && error !== undefined,
    };

    if (state.answer === 'publicWeb') {
        return {
            kind: 'link',
            label: shared.source.label,
            value: state.link,
            inputMode: 'url',
            autoCapitalize: 'none',
            ...shown,
        };
    }

    if (state.answer === 'book') {
        return {
            kind: 'bookTitle',
            label: m.bookTitleLabel,
            value: state.bookTitle,
            inputMode: 'text',
            autoCapitalize: 'sentences',
            ...shown,
        };
    }

    return undefined;
}

/**
 * What the sheet draws for a state on a surface.
 *
 * @param input.surface - Where it is asked.
 * @param input.state - What the cook has done.
 * @param input.messages - The sheet's copy.
 * @param input.shared - The words the sheet reuses.
 * @returns The view. Pure.
 */
export function sheetViewOf(input: {
    readonly surface: StatementSurface;
    readonly state: StatementSheetState;
    readonly messages: SourceStatementMessages;
    readonly shared: StatementSharedCopy;
}): StatementSheetView {
    const { surface, state, messages: m, shared } = input;
    const phase = phaseOf(state);
    const editor = surface === 'editor';

    return {
        options: answersFor(surface).map((answer) => ({
            id: answer,
            label: m[LABEL_KEY[answer]],
            ...(HINT_KEY[answer] === undefined ? {} : { hint: m[HINT_KEY[answer]] }),
        })),
        value: state.answer,
        field: fieldViewOf(state, m, shared),
        confirmLabel: editor ? m.confirmEditor : m.confirmRecipePage,
        dismissLabel: editor ? m.dismissEditor : m.dismissRecipePage,
        confirmRefused: phase === 'choosing',
        busy: phase === 'busy',
        errorText: phase === 'error' ? shared.failure : undefined,
    };
}
