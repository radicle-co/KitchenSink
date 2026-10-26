/**
 * @module @commise/features-recipes/import — what one flagged row shows about a send, for both platforms' leaves: its
 * failure (the matched-line list's words, hidden while a retry is in flight), its send state, and where focus lands when
 * Try again is pressed and its retry starts (WCAG 2.4.3). The row's Use is the control the retry made busy; a row the
 * check offered no food for has no Use, so focus lands on Choose another. Both only refuse a press while a send is in
 * flight, never natively disabled, so focus never falls to the page.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — a flagged row's failure and focus derived once for both platform leaves
 */
import {
    lineFailureOf,
    sendStateOf,
    type MatchCopy,
    type OpenPlace,
    type PickFailureView,
} from '../ingredientMatching/matchLineView.js';
import type { SendState } from '../ingredientMatching/retryFocus.js';
import type { ImportFlaggedLineItem } from './props.js';

/** The control of a flagged row a retry lands on. */
export type FlaggedLanding = 'use' | 'chooseAnother';

/** What a flagged row shows about a send. */
export interface FlaggedRowView {
    /** The row's failed Use, in the matched-line list's words; `undefined` when it did not fail or a retry is in flight. */
    readonly failure: PickFailureView | undefined;
    /** Whether the last send failed and whether one is in flight: what tells a retry from a first attempt. */
    readonly send: SendState;
    /** The control a retry lands focus on: Use when the row has one, else Choose another. */
    readonly landing: FlaggedLanding;
}

/**
 * A flagged row's view of its send. Pure.
 *
 * @param line - The row.
 * @param place - Whether the row's last send failed, and the send in flight.
 * @param copy - The localised copy.
 * @returns The row's failure, send state and landing control.
 */
export function flaggedRowViewOf(
    line: ImportFlaggedLineItem,
    place: Pick<OpenPlace, 'failed' | 'pending'>,
    copy: MatchCopy,
): FlaggedRowView {
    return {
        failure: lineFailureOf(line.text, place, copy),
        send: sendStateOf(line.key, place),
        landing: line.suggestion === undefined ? 'chooseAnother' : 'use',
    };
}
