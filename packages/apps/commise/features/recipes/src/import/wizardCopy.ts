/**
 * @module @commise/features-recipes/import — the review wizard's words that depend on where the review is, read by both
 * `ImportWizardStep` leaves so they cannot drift.
 */
import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { ImportMessages } from './messages.js';

/** Where the review is. */
export interface WizardPlace {
    /** This recipe's place among the recipes to review, from 1. */
    readonly position: number;
    readonly total: number;
    /** Lines to choose: default, needsChoice and noMatch lines with nothing bound (`matchCountsOf().choose`). */
    readonly openLines: number;
    /** Lines still being checked, counted on their own (`matchCountsOf().checking`). */
    readonly checkingLines: number;
}

/**
 * The progress line: "Recipe 14 of 309 · 2 lines to choose · 1 being checked". Only lines that need a pick count as to
 * choose; a checking line is counted on its own; a count of 0 is left out, so a recipe with neither reads "Recipe 14 of
 * 309". Pure.
 *
 * @param place - Where the review is.
 * @param messages - The wizard copy.
 * @param locale - The reader's locale, for the plurals.
 * @returns The progress line.
 */
export function progressTextOf(place: WizardPlace, messages: ImportMessages['wizard'], locale: string): string {
    const parts = [
        [messages.toChoose, place.openLines],
        [messages.beingChecked, place.checkingLines],
    ] as const;

    return [
        fillTemplate(messages.progress, { n: place.position, total: place.total }),
        ...parts.filter(([, count]) => count > 0).map(([text, count]) => pluralOf(text, count, locale)),
    ].join(messages.partSeparator);
}

/**
 * The recipe Back returns to. Pure.
 *
 * @param position - This recipe's place, from 1.
 * @returns The place before it, or `undefined` on the first recipe (which has no Back).
 */
export function backTargetOf(position: number): number | undefined {
    return position > 1 ? position - 1 : undefined;
}

/** Where the review stands when the cook asks to leave. */
export interface LeavePlace {
    /** Recipes the cook has reviewed. */
    readonly reviewed: number;
    readonly total: number;
    /** The recipe the review resumes at, from 1. */
    readonly resumeAt: number;
}

/** The sentences of Save and leave. */
export interface LeaveCopy {
    readonly reviewed: string;
    readonly rest: string;
    /** What happens to the rest's lines: the one bulk rule the mode choice states. */
    readonly rule: string;
    readonly resume: string;
}

/**
 * The words of Save and leave (board WizardLeave): how many the cook reviewed, how many are saved now (never fewer than
 * none), what happens to their lines (the one bulk rule, `import.saveAsWritten.rule`), and where they wait and the
 * review resumes. Pure.
 *
 * @param place - Where the review stands.
 * @param messages - The leave copy.
 * @param saveAsWritten - The bulk rule's copy, shared with the mode choice.
 * @param locale - The reader's locale, for the plurals.
 * @returns The sentences.
 */
export function leaveCopyOf(
    place: LeavePlace,
    messages: ImportMessages['leave'],
    saveAsWritten: ImportMessages['saveAsWritten'],
    locale: string,
): LeaveCopy {
    return {
        reviewed: fillTemplate(pluralOf(messages.reviewed, place.total, locale), { reviewed: place.reviewed }),
        rest: pluralOf(messages.rest, Math.max(0, place.total - place.reviewed), locale),
        rule: saveAsWritten.rule,
        resume: fillTemplate(messages.resume, { next: place.resumeAt }),
    };
}
