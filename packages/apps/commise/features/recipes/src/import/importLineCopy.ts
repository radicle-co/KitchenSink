/**
 * @module @commise/features-recipes/import — the words one import line says, read by both platforms' line leaves so
 * they cannot drift: an open line's neutral prompt, a closed open line's need with its option count, and what a pick
 * says. Prompts are muted text on every platform (amber is only for failures, `ingredientMatching.md`).
 *
 * @pattern Visitor — exhaustive switches over the `ImportLine` state union, one per question asked of a line
 */
import { pluralOf } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { ImportCandidate, ImportLinePick, PickableImportLine } from './importLine.js';
import type { ImportLineMessages } from './messages.js';

/**
 * The prompt an expanded line shows under its text, or `undefined` for a matched line opened by Change. Pure.
 *
 * @param line - The expanded line.
 * @param messages - The line copy.
 * @returns The prompt.
 */
export function openPromptOf(line: PickableImportLine, messages: ImportLineMessages): string | undefined {
    switch (line.state) {
        case 'default':
            return fillTemplate(messages.defaultPrompt, { noun: line.noun });

        case 'needsChoice':
            return messages.needsChoicePrompt;

        case 'noMatch':
            return messages.noMatchPrompt;

        case 'confident':
            return undefined;
    }
}

/**
 * What a closed open line names as its need ("Choose a food · 5 options"), or `undefined` for a line that needs nothing.
 * The count is the candidates; "Keep … as written" is not counted. Pure.
 *
 * @param line - The line.
 * @param messages - The line copy.
 * @param locale - The reader's locale, for the plural.
 * @returns The need.
 */
export function closedNeedOf(
    line: PickableImportLine | { readonly state: 'checking' },
    messages: ImportLineMessages,
    locale: string,
): string | undefined {
    switch (line.state) {
        case 'default':
            return fillTemplate(pluralOf(messages.closedDefault, line.candidates.length, locale), { noun: line.noun });

        case 'needsChoice':
            return pluralOf(messages.closedNeed, line.candidates.length, locale);

        case 'noMatch':
            return messages.closedNoMatch;

        case 'confident':
        case 'checking':
            return undefined;
    }
}

/**
 * What a cook's pick says in place of the line's food. Pure.
 *
 * @param pick - The pick.
 * @param messages - The line copy.
 * @returns The food's name, or the kept-as-written words.
 */
export function pickTextOf(pick: ImportLinePick, messages: ImportLineMessages): string {
    return pick.kind === 'food' ? pick.name : messages.keptAsWritten;
}

/**
 * The foods a pickable line offers. Pure.
 *
 * @param line - The line.
 * @returns Its candidates; none for a no-match line.
 */
export function candidatesOf(line: PickableImportLine): readonly ImportCandidate[] {
    return line.state === 'noMatch' ? [] : line.candidates;
}
