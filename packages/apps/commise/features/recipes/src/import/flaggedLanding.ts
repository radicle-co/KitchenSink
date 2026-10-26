/**
 * @module @commise/features-recipes/import — where focus lands on a flagged row when Try again is pressed and its retry
 * starts (WCAG 2.4.3), for both platforms' leaves: the row's Use, which the retry made busy, or Choose another when the
 * check had no food to offer and the row has no Use. Both only refuse a press while a send is in flight, never natively
 * disabled, so focus never falls to the page.
 *
 * Pure and platform-agnostic.
 */
import type { ImportFlaggedLineItem } from './props.js';

/** The control of a flagged row a retry lands on. */
export type FlaggedLanding = 'use' | 'chooseAnother';

/**
 * The control a flagged row's retry lands focus on. Pure.
 *
 * @param line - The row.
 * @returns Use when the row has one, else Choose another.
 */
export function flaggedLandingOf(line: Pick<ImportFlaggedLineItem, 'suggestion'>): FlaggedLanding {
    return line.suggestion === undefined ? 'chooseAnother' : 'use';
}
