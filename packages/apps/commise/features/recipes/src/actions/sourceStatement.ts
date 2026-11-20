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
    PUBLIC_CONFIRM_WORDINGS,
    RecipeSourceType,
    RecipeVisibility,
    statementRequiredOf,
    STATEMENT_WORDINGS_BY_CHOICE,
    type RecipeDetail,
} from '@kitchensink/recipe-core';
import type { PublicConfirmationInput, RecipeStatementInput } from '@kitchensink/schema-recipe';

import { recipeActionMessages } from './messages.js';

/** The surface that asks: the editor's Publish, or the recipe page's Make public. */
export type StatementSurface = 'editor' | 'recipePage';

/** What the cook can answer. `publishPrivately` is the editor's own: the recipe page's own way out is Cancel. */
export type StatementAnswer = 'authored' | 'publicWeb' | 'paidSite' | 'book' | 'fromPerson' | 'publishPrivately';

const RECIPE_PAGE_ANSWERS = [
    'authored',
    'publicWeb',
    'paidSite',
    'book',
    'fromPerson',
] as const satisfies readonly StatementAnswer[];
const EDITOR_ANSWERS = [...RECIPE_PAGE_ANSWERS, 'publishPrivately'] as const satisfies readonly StatementAnswer[];

/**
 * The answers a surface offers, in order.
 *
 * @param surface - Where the sheet is.
 * @returns The editor's five, or the recipe page's first four. Pure.
 */
export function answersFor(surface: StatementSurface): readonly StatementAnswer[] {
    return surface === 'editor' ? EDITOR_ANSWERS : RECIPE_PAGE_ANSWERS;
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
 * @returns The statement and visibility. Pure.
 */
export function statementWriteOf(answer: StatementAnswer, fields: StatementFields, asked: string): StatementWrite {
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
                    wording: { version: STATEMENT_WORDINGS_BY_CHOICE.publicWeb[0], locale },
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
                    wording: { version: STATEMENT_WORDINGS_BY_CHOICE.book[0], locale },
                },
                visibility: RecipeVisibility.PRIVATE,
            };
        case 'fromPerson':
            return {
                statement: {
                    kind: 'fromPerson',
                    wording: { version: STATEMENT_WORDINGS_BY_CHOICE.fromPerson[0], locale },
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
        return fields.bookTitle.trim() === '' ? { field: 'bookTitle', reason: 'required' } : undefined;
    }

    if (answer === 'paidSite') {
        return fields.paidSite.trim() === '' ? { field: 'paidSite', reason: 'required' } : undefined;
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
