/**
 * @module @commise/features-recipes/actions — the source-statement sheet's pure core (ADR-0095): WHEN the cook is asked where a
 * recipe is from, which answers a surface offers, WHAT each answer writes, and the sheet's own state.
 *
 * One authority for each: the ask is `recipe-core`'s `statementRequiredOf` (the rule the server judges the write by), the
 * wordings are the registry's (`STATEMENT_WORDINGS_BY_CHOICE`), and a link is read by `parseSourceLink` (the reading the
 * Source field and the server's `statement` schema share). Nothing here is shown or sent by itself: the sheet shows, the
 * wire mapper sends.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Policy — {@link askForStatement}, {@link answersFor} and {@link statementWriteOf} each decide one thing from facts
 * @pattern Statechart — {@link sheetReducer} and {@link phaseOf}: the sheet's phase is DERIVED from the answer, the fields and
 *     what was attempted, never stored beside them
 */
import { servedLocaleOf } from '@commise/i18n';
import {
    parseSourceLink,
    SOURCE_LINK_MAX_LENGTH,
    PUBLIC_CONFIRM_WORDINGS,
    RecipeSourceType,
    RecipeVisibility,
    statementRequiredOf,
    LOCK_NOTE_WORDING_BY_CHOICE,
    STATEMENT_WORDINGS_BY_CHOICE,
    type RecipeDetail,
} from '@kitchensink/recipe-core';
import type { PublicConfirmationInput, RecipeStatementInput } from '@kitchensink/schema-recipe';

import { recipeActionMessages } from './messages.js';

/**
 * Why the sheet is asked (ADR-0100): the one purpose decides which answers it offers, what its act confirms, and its words.
 * `editor` is Publish and `recipePage` is Make public; `recipePageOwn` is Make public on a confirmed "I wrote this" recipe,
 * which can take no web page and no person. The other three open from the Source row: the first answer of a recipe that has
 * none, a change of an answer not yet confirmed, and the downgrade of a confirmed "I wrote this".
 */
export type StatementSurface = 'editor' | 'recipePage' | 'recipePageOwn' | 'firstAnswer' | 'change' | 'downgrade';

/** What the cook can answer. `publishPrivately` is the editor's own: the recipe page's own way out is Cancel. */
export type StatementAnswer = 'authored' | 'publicWeb' | 'paidSite' | 'book' | 'fromPerson' | 'publishPrivately';

const FIVE_ANSWERS = [
    'authored',
    'publicWeb',
    'paidSite',
    'book',
    'fromPerson',
] as const satisfies readonly StatementAnswer[];

const ANSWERS_BY_SURFACE = {
    editor: [...FIVE_ANSWERS, 'publishPrivately'],
    recipePage: FIVE_ANSWERS,
    recipePageOwn: ['authored', 'book', 'paidSite'],
    firstAnswer: ['book', 'paidSite', 'fromPerson'],
    change: FIVE_ANSWERS,
    downgrade: ['book', 'paidSite'],
} as const satisfies Record<StatementSurface, readonly StatementAnswer[]>;

/**
 * The answers a purpose offers, in order.
 *
 * @param surface - Why the sheet is asked.
 * @returns Its answers. Pure.
 */
export function answersFor(surface: StatementSurface): readonly StatementAnswer[] {
    return ANSWERS_BY_SURFACE[surface];
}

/**
 * Whether confirming the sheet is itself the act that confirms the recipe's source (ADR-0100): Publish, Make public and the
 * downgrade. An answer on a never-published draft is stored but does not confirm.
 *
 * @param surface - Why the sheet is asked.
 * @returns `true` when the act confirms. Pure.
 */
export function confirmsAt(surface: StatementSurface): boolean {
    return surface === 'editor' || surface === 'recipePage' || surface === 'recipePageOwn' || surface === 'downgrade';
}

/** The inputs of {@link answerLocks}. */
export interface AnswerLockInput {
    readonly answer: StatementAnswer;
    /** Why the sheet is asked: whether the act confirms is `confirmsAt` of it. */
    readonly surface: StatementSurface;
    /** The recipe's source is confirmed already. */
    readonly recipeConfirmed: boolean;
}

/**
 * Whether confirming an answer locks it: the ONE rule. The lock note ("Once you confirm, this answer is locked.") is drawn
 * under an answer exactly when this is true, the wording version recorded is the one that includes the note, and the Source row
 * draws the answer locked from the confirm. A paid website and another person lock when stated; a web page and a book lock
 * only when the act confirms or the recipe is confirmed already; "I wrote this" never locks (it can still become a cookbook or
 * a paid website).
 *
 * @param input - The answer, why the sheet is asked, and whether the recipe's source is confirmed.
 * @returns `true` when confirming the answer locks it. Pure.
 */
export function answerLocks(input: AnswerLockInput): boolean {
    switch (input.answer) {
        case 'authored':
        case 'publishPrivately':
            return false;
        case 'paidSite':
        case 'fromPerson':
            return true;
        case 'publicWeb':
        case 'book':
            return input.recipeConfirmed || confirmsAt(input.surface);
    }
}

/**
 * The sheet answer a statement kind on the wire came from. Pure.
 *
 * @param kind - The statement's kind.
 */
export function statementAnswerOf(kind: RecipeStatementInput['kind']): StatementAnswer {
    switch (kind) {
        case 'authored':
            return 'authored';
        case 'public_web':
            return 'publicWeb';
        case 'paid_site':
            return 'paidSite';
        case 'book':
            return 'book';
        case 'fromPerson':
            return 'fromPerson';
    }
}

/** What the ask reads of the stored recipe: only what the server's own rule reads. */
type AskedRecipe = Partial<Pick<RecipeDetail, 'publicNeedsStatement' | 'sourceType' | 'statementKind'>>;

/**
 * Whether Publish or Make public must ask where the recipe is from.
 *
 * It is `statementRequiredOf` over the facts the client has, so the question is asked exactly when the server would otherwise
 * refuse with `STATEMENT_REQUIRED`: a paste was seen (this draft's, or the server's `publicNeedsStatement`), the recipe is the
 * cook's words, and nothing is stated. A draft that states a source ends private and is never asked; an answered session is
 * not asked twice.
 *
 * @param input.draftPasted - A paste sheet was used on this draft.
 * @param input.recipe - The recipe the server holds, or `undefined` before the first save.
 * @param input.draftHasSource - The draft states a source link.
 * @param input.answered - The cook already answered in this session.
 * @param input.resultPublic - The write ends published and public.
 * @returns `true` when the sheet opens. Pure.
 */
export function askForStatement(input: {
    readonly draftPasted: boolean;
    readonly recipe: AskedRecipe | undefined;
    readonly draftHasSource: boolean;
    readonly answered: boolean;
    readonly resultPublic: boolean;
}): boolean {
    const { draftPasted, recipe, draftHasSource, answered, resultPublic } = input;

    return (
        resultPublic &&
        !draftHasSource &&
        !answered &&
        statementRequiredOf({
            sourceType: recipe?.sourceType ?? RecipeSourceType.USER_CREATED,
            statementKind: recipe?.statementKind ?? null,
            contentPasted: draftPasted || recipe?.publicNeedsStatement === true,
            evidence: [],
        })
    );
}

/** What the revealed fields hold. */
export interface StatementFields {
    /** The web page address, for `publicWeb`. */
    readonly link: string;
    /** The cookbook or magazine title, for `book`. */
    readonly bookTitle: string;
    /** The website's name or address, as attribution text, for `paidSite`. */
    readonly paidSite: string;
}

/** What an answer writes: the statement (none for publishing privately) and the visibility it leaves. */
export interface StatementWrite {
    readonly statement?: RecipeStatementInput;
    readonly visibility: RecipeVisibility;
}

/**
 * The wording the passive Public line records: its version, and the locale of the catalog that served its words (a request the
 * catalog does not hold is shown, and so recorded, in English). Pure.
 *
 * @param locale - The locale the screen asked for.
 */
export function publicWordingOf(locale: string): PublicConfirmationInput {
    return { version: PUBLIC_CONFIRM_WORDINGS[0], locale: servedLocaleOf(recipeActionMessages, locale) };
}

/**
 * What an answer writes, with the wording the registry lists for it. The wording is the client's word that it showed that
 * version, so only the answer the cook gave sends one.
 *
 * "I wrote this" stays public and carries no separate confirmation: an explicit statement in the write answers for it. Every
 * third-party answer forces Private, as the server does.
 *
 * @param answer - What the cook chose.
 * @param fields - The revealed fields, valid for the answer ({@link statementFieldErrorOf} is `undefined`).
 * @param asked - The locale the screen asked for; the wording records the locale of the catalog that served it.
 * @param lockNoteWasShown - The lock note was drawn under the answer: the wording recorded is the one that includes it.
 * @returns The statement and visibility. Pure.
 */
export function statementWriteOf(
    answer: StatementAnswer,
    fields: StatementFields,
    asked: string,
    lockNoteWasShown: boolean,
): StatementWrite {
    const locale = servedLocaleOf(recipeActionMessages, asked);

    switch (answer) {
        case 'authored':
            return {
                statement: { kind: 'authored', wording: { version: STATEMENT_WORDINGS_BY_CHOICE.authored[0], locale } },
                visibility: RecipeVisibility.PUBLIC,
            };
        case 'publicWeb':
            return {
                statement: {
                    kind: 'public_web',
                    citation: fields.link.trim(),
                    wording: {
                        version: lockNoteWasShown
                            ? LOCK_NOTE_WORDING_BY_CHOICE.publicWeb
                            : STATEMENT_WORDINGS_BY_CHOICE.publicWeb[0],
                        locale,
                    },
                },
                visibility: RecipeVisibility.PRIVATE,
            };
        case 'paidSite':
            return {
                statement: {
                    kind: 'paid_site',
                    citation: fields.paidSite.trim(),
                    wording: { version: STATEMENT_WORDINGS_BY_CHOICE.paidSite[0], locale },
                },
                visibility: RecipeVisibility.PRIVATE,
            };
        case 'book':
            return {
                statement: {
                    kind: 'book',
                    citation: fields.bookTitle.trim(),
                    wording: {
                        version: lockNoteWasShown
                            ? LOCK_NOTE_WORDING_BY_CHOICE.book
                            : STATEMENT_WORDINGS_BY_CHOICE.book[0],
                        locale,
                    },
                },
                visibility: RecipeVisibility.PRIVATE,
            };
        case 'fromPerson':
            return {
                statement: {
                    kind: 'fromPerson',
                    wording: {
                        version: lockNoteWasShown
                            ? LOCK_NOTE_WORDING_BY_CHOICE.fromPerson
                            : STATEMENT_WORDINGS_BY_CHOICE.fromPerson[0],
                        locale,
                    },
                },
                visibility: RecipeVisibility.PRIVATE,
            };
        case 'publishPrivately':
            return { visibility: RecipeVisibility.PRIVATE };
    }
}

/** A revealed field that cannot be confirmed yet, and why. */
export interface StatementFieldError {
    readonly field: 'link' | 'bookTitle' | 'paidSite';
    readonly reason: 'required' | 'invalid' | 'ownSite';
}

/** A citation field's problem: empty, or past the length the server takes (a longer one would fail every write). Pure. */
function citationErrorOf(field: 'bookTitle' | 'paidSite', text: string): StatementFieldError | undefined {
    const length = text.trim().length;

    if (length === 0) {
        return { field, reason: 'required' };
    }

    return length > SOURCE_LINK_MAX_LENGTH ? { field, reason: 'invalid' } : undefined;
}

/**
 * Whether the chosen answer's revealed field is usable. The link is read by the Source field's own reading, so the sheet's
 * "not a link" and the server's `400` are one rule.
 *
 * @param answer - What the cook chose.
 * @param fields - What the revealed fields hold.
 * @returns The first problem, or `undefined`. Pure.
 */
export function statementFieldErrorOf(
    answer: StatementAnswer,
    fields: StatementFields,
): StatementFieldError | undefined {
    if (answer === 'book') {
        return citationErrorOf('bookTitle', fields.bookTitle);
    }

    if (answer === 'paidSite') {
        return citationErrorOf('paidSite', fields.paidSite);
    }

    if (answer !== 'publicWeb') {
        return undefined;
    }

    if (fields.link.trim() === '') {
        return { field: 'link', reason: 'required' };
    }

    const parsed = parseSourceLink(fields.link);

    return parsed.ok ? undefined : { field: 'link', reason: parsed.reason };
}

/** The sheet's state: what the cook has done. Its phase is derived ({@link phaseOf}). */
export interface StatementSheetState {
    readonly answer: StatementAnswer | undefined;
    readonly link: string;
    readonly bookTitle: string;
    readonly paidSite: string;
    /** Confirm was pressed with the fields as they were: an invalid field then shows its error. */
    readonly attempted: boolean;
    /** Each Confirm over an unusable field raises it, so a second failed Confirm moves focus again; the field lowers it. */
    readonly focusPending: boolean;
    readonly status: 'idle' | 'busy' | 'failed';
}

/** What the sheet is showing. */
export type StatementSheetPhase = 'choosing' | 'answered' | 'fieldError' | 'busy' | 'error';

/** The sheet as it opens. */
export function initialSheet(): StatementSheetState {
    return {
        answer: undefined,
        link: '',
        bookTitle: '',
        paidSite: '',
        attempted: false,
        focusPending: false,
        status: 'idle',
    };
}

/** What can happen to the sheet. */
export type StatementSheetAction =
    | { readonly type: 'choose'; readonly answer: StatementAnswer }
    | { readonly type: 'link'; readonly text: string }
    | { readonly type: 'bookTitle'; readonly text: string }
    | { readonly type: 'paidSite'; readonly text: string }
    | { readonly type: 'attempt' }
    | { readonly type: 'focusHandled' }
    | { readonly type: 'busy' }
    | { readonly type: 'failed' }
    | { readonly type: 'reset' };

/**
 * One transition of the sheet. Pure.
 *
 * @param state - The sheet now.
 * @param action - What happened.
 * @returns The sheet after.
 */
export function sheetReducer(state: StatementSheetState, action: StatementSheetAction): StatementSheetState {
    switch (action.type) {
        case 'choose':
            return { ...state, answer: action.answer, attempted: false };
        case 'link':
            return { ...state, link: action.text };
        case 'bookTitle':
            return { ...state, bookTitle: action.text };
        case 'paidSite':
            return { ...state, paidSite: action.text };
        case 'attempt':
            return { ...state, attempted: true, focusPending: true };
        case 'focusHandled':
            return { ...state, focusPending: false };
        case 'busy':
            return { ...state, status: 'busy' };
        case 'failed':
            return { ...state, status: 'failed' };
        case 'reset':
            return initialSheet();
    }
}

/** The field error the sheet shows now: only after a Confirm that met it. */
export function visibleFieldErrorOf(state: StatementSheetState): StatementFieldError | undefined {
    return state.answer === undefined || !state.attempted ? undefined : statementFieldErrorOf(state.answer, state);
}

/**
 * The phase the sheet is in, from its state.
 *
 * @param state - The sheet now.
 * @returns The phase. Pure.
 */
export function phaseOf(state: StatementSheetState): StatementSheetPhase {
    if (state.status === 'busy') {
        return 'busy';
    }

    if (state.status === 'failed') {
        return 'error';
    }

    if (state.answer === undefined) {
        return 'choosing';
    }

    return visibleFieldErrorOf(state) === undefined ? 'answered' : 'fieldError';
}
