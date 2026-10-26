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
    /** Lines still needing the cook. */
    readonly openLines: number;
}

/**
 * The progress line: "Recipe 14 of 309 · 3 lines to choose", or "Recipe 14 of 309" when nothing is left to choose. Pure.
 *
 * @param place - Where the review is.
 * @param messages - The wizard copy.
 * @param locale - The reader's locale, for the plural.
 * @returns The progress line.
 */
export function progressTextOf(place: WizardPlace, messages: ImportMessages['wizard'], locale: string): string {
    const tokens = { n: place.position, total: place.total };

    return place.openLines > 0
        ? fillTemplate(pluralOf(messages.progress, place.openLines, locale), tokens)
        : fillTemplate(messages.progressNothing, tokens);
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

/** The three sentences of Save and leave. */
export interface LeaveCopy {
    readonly reviewed: string;
    readonly rest: string;
    readonly resume: string;
}

/**
 * The words of Save and leave (board WizardLeave): how many the cook reviewed, how many are saved now (never fewer than
 * none), and where they wait and the review resumes. Pure.
 *
 * @param place - Where the review stands.
 * @param messages - The leave copy.
 * @param locale - The reader's locale, for the plural.
 * @returns The three sentences.
 */
export function leaveCopyOf(place: LeavePlace, messages: ImportMessages['leave'], locale: string): LeaveCopy {
    return {
        reviewed: fillTemplate(messages.reviewed, { reviewed: place.reviewed, total: place.total }),
        rest: pluralOf(messages.rest, Math.max(0, place.total - place.reviewed), locale),
        resume: fillTemplate(messages.resume, { next: place.resumeAt }),
    };
}
