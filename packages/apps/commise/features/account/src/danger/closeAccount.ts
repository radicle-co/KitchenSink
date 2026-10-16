/**
 * @module @commise/features-account/danger/closeAccount — what the close control shows, decided once for both apps.
 *
 * Web's `AccountCloseForm` and mobile's `AccountDangerZone` derived the same row label, busy/inert state and failure
 * kind from the closure mutation, and spelled the same `ConfirmDialog` arguments. The two failures are different facts
 * (`buildSpec.md` §9.1): a failed CLOSE leaves the account open, so the row goes back to idle and invites a retry; a
 * failed EXIT means the account IS closed, so the row becomes an inert "Account closed" and never invites a second close.
 *
 * Pure: both take data and return data, so the apps keep only the render (a `ProfileRow`, an alert, `ConfirmDialog`).
 */
import { isClosureStepError } from '../closureSequence.js';
import type { AccountCloseMessages } from './messages.js';

/** The part of the closure mutation the row reads. */
export interface CloseSequenceState {
    /** The mutation's error, if the last attempt failed. */
    readonly error: unknown;
    /** Whether the closure (close, then exit) is in flight. */
    readonly isPending: boolean;
}

/** Which closure step failed, or `null` when none did. */
export type CloseFailure = 'close' | 'exit' | null;

/** What the close row draws. */
export interface CloseRow {
    readonly label: string;
    readonly busy: boolean;
    /** The account is closed and only leaving failed: the row is a fact, not an action. */
    readonly inert: boolean;
    readonly chevron: boolean;
    /** Which alert sits under the row: `close.error`, `close.signOutFailed`, or none. */
    readonly failure: CloseFailure;
}

/** The arguments of the design-system `ConfirmDialog` for the close confirmation (minus `open` and its handlers). */
export interface CloseConfirm {
    readonly title: string;
    readonly body: string;
    readonly confirm: { readonly label: string; readonly icon: 'userX' };
    readonly keep: { readonly label: string };
}

/**
 * The close row for the closure mutation's current state.
 *
 * @param sequence - The closure mutation's `error` and `isPending`.
 * @param close - The close copy.
 * @returns The row's label and state, and which failure alert to show.
 */
export function closeRowOf(sequence: CloseSequenceState, close: AccountCloseMessages): CloseRow {
    const closed = isClosureStepError(sequence.error, 'exit');
    const closeFailed = isClosureStepError(sequence.error, 'close');

    return {
        label: closed ? close.closedLabel : sequence.isPending ? close.busyLabel : close.trigger,
        busy: sequence.isPending,
        inert: closed,
        chevron: !closed,
        failure: closed ? 'exit' : closeFailed ? 'close' : null,
    };
}

/**
 * The close confirmation's content.
 *
 * @param close - The close copy.
 * @returns The title, body and the two actions, for `ConfirmDialog`.
 */
export function closeConfirmOf(close: AccountCloseMessages): CloseConfirm {
    return {
        title: close.title,
        body: close.description,
        confirm: { label: close.confirm, icon: 'userX' },
        keep: { label: close.cancel },
    };
}
