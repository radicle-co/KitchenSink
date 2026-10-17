/**
 * The "erased, but we could not sign you out" sentence is authored ONCE, here, for both apps. It used to live in web's
 * `authMessages.session` and in mobile's `mobileMessages.account`, word for word, with two owners.
 *
 * Its words are load-bearing: it must say the erasure is happening (so no one retries it) and that the outstanding
 * action is leaving. The exact wording is also what the apps' end-to-end flows match.
 */
import { describe, expect, it } from 'vitest';

import { accountDangerMessages } from '../messages.js';

describe('accountDangerMessages — erase.signOutFailed', () => {
    const { signOutFailed, error } = accountDangerMessages.en.erase;

    it('says the erasure is under way and that the viewer must sign out to finish', () => {
        expect(signOutFailed).toBe(
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
    });

    it('is not the erase submit error, which invites a retry', () => {
        expect(signOutFailed).not.toBe(error);
        expect(signOutFailed).not.toMatch(/try again/i);
    });
});
