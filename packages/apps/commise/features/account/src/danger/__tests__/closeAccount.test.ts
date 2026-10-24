/**
 * The close control's presentation decisions, once for both apps (they were derived twice, expression for expression, in
 * web's `AccountCloseForm` and mobile's `AccountDangerZone`).
 *
 * The decision that matters: a failed CLOSE leaves the account open (retry is right), but a failed EXIT means the account
 * IS closed, so the row becomes an inert "Account closed" fact and never invites a second close of a closed account.
 */
import { describe, expect, it } from 'vitest';

import { ClosureStepError } from '../../closureSequence.js';
import { accountDangerMessages } from '../messages.js';
import { closeConfirmOf, closeRowOf } from '../closeAccount.js';

const { close } = accountDangerMessages.en;

describe('closeRowOf', () => {
    it('is an idle, pressable close row when nothing has happened', () => {
        expect(closeRowOf({ error: null, isPending: false }, close)).toEqual({
            label: close.trigger,
            busy: false,
            inert: false,
            chevron: true,
            failure: null,
        });
    });

    it('is busy, with the busy label, while the closure runs', () => {
        expect(closeRowOf({ error: null, isPending: true }, close)).toMatchObject({
            label: close.busyLabel,
            busy: true,
            inert: false,
        });
    });

    it('stays pressable and reports the close failure when the account is still open', () => {
        const row = closeRowOf({ error: new ClosureStepError('close', new Error('down')), isPending: false }, close);

        expect(row).toMatchObject({ label: close.trigger, inert: false, chevron: true, failure: 'close' });
    });

    it('becomes an inert "Account closed" fact, with no chevron, when only the exit failed', () => {
        const row = closeRowOf({ error: new ClosureStepError('exit', new Error('stuck')), isPending: false }, close);

        expect(row).toEqual({ label: close.closedLabel, busy: false, inert: true, chevron: false, failure: 'exit' });
    });

    it('ignores an error that is not a closure step error', () => {
        expect(closeRowOf({ error: new Error('other'), isPending: false }, close).failure).toBeNull();
    });
});

describe('closeConfirmOf', () => {
    it('states the recoverable-closure confirmation with the destructive icon, from the close copy alone', () => {
        expect(closeConfirmOf(close)).toEqual({
            title: close.title,
            body: close.description,
            confirm: { label: close.confirm, icon: 'userX' },
            keep: { label: close.cancel },
        });
    });
});
