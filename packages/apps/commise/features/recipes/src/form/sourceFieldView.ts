/**
 * @module @commise/features-recipes/form — `sourceFieldViewOf`: what each kind of Source row draws, decided once for both
 * platforms' leaves (ADR-0089). The leaves switch on the result and hold no rule of their own.
 *
 * @pattern Specification — one pure rule from the row model and the words to the view the leaves draw
 */
import { fillTemplate } from '@commise/i18n';

import { lockedAnswerLabel, type SourceRowModel } from './sourceLink.js';

/** The words of the Source row the view reads. */
export interface SourceFieldWords {
    readonly hint: string;
    readonly rightsLabel: string;
    readonly invalid: string;
    readonly ownSite: string;
    readonly lockWarning: string;
    readonly lockWarningSave: string;
}

/** The statement sheet's answer labels. */
export interface SourceAnswerWords {
    readonly answerAuthored: string;
    readonly answerPaidSite: string;
    readonly answerPerson: string;
    readonly answerBook: string;
}

/** What a Source row draws. A citation or an answer that is absent here is not drawn. */
export type SourceFieldView =
    | { readonly kind: 'hidden' }
    | { readonly kind: 'own'; readonly answer: string }
    | { readonly kind: 'openAnswered'; readonly answer: string; readonly citation?: string }
    | { readonly kind: 'locked'; readonly site: string; readonly url: string }
    | { readonly kind: 'lockedAnswer'; readonly answer?: string; readonly citation?: string }
    | {
          readonly kind: 'field';
          readonly text: string;
          /** The line under the label: the hint when nothing is filled, the site when it is. */
          readonly status: string;
          /** The paste filled the field: its note is drawn. */
          readonly pasted: boolean;
          /** When publishing, or the next save, locks the link. */
          readonly warning?: string;
          readonly error?: string;
      };

/** A citation with nothing in it is not drawn. */
const citationOf = (citation: string | undefined): string | undefined =>
    citation === undefined || citation === '' ? undefined : citation;

/**
 * The view of a Source row. Pure.
 *
 * @param row - The row model (`sourceRowOf`).
 * @param m - The Source row's words.
 * @param answers - The statement sheet's answer labels.
 * @returns What the leaves draw.
 */
export function sourceFieldViewOf(
    row: SourceRowModel,
    m: SourceFieldWords,
    answers: SourceAnswerWords,
): SourceFieldView {
    switch (row.kind) {
        case 'hidden':
            return { kind: 'hidden' };
        case 'own':
            return { kind: 'own', answer: answers.answerAuthored };
        case 'openAnswered':
            return {
                kind: 'openAnswered',
                answer: lockedAnswerLabel(row.answer, answers),
                citation: citationOf(row.citation),
            };
        case 'locked':
            return { kind: 'locked', site: row.site, url: row.url };
        case 'lockedAnswer':
            return {
                kind: 'lockedAnswer',
                answer: row.answer === undefined ? undefined : lockedAnswerLabel(row.answer, answers),
                citation: citationOf(row.citation),
            };
        case 'filled':
            return {
                kind: 'field',
                text: row.text,
                status: fillTemplate(m.rightsLabel, { site: row.site }),
                pasted: row.fromPaste,
                // Only a filled link is something the lock will hold: the warning says when (publish, or the next save once confirmed).
                warning: row.confirmed === true ? m.lockWarningSave : m.lockWarning,
            };
        case 'invalid':
            return { kind: 'field', text: row.text, status: m.hint, pasted: false, error: m.invalid };
        case 'ownSite':
            return { kind: 'field', text: row.text, status: m.hint, pasted: false, error: m.ownSite };
        case 'empty':
            return { kind: 'field', text: row.text, status: m.hint, pasted: false };
    }
}
