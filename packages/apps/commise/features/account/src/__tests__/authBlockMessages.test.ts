/**
 * The copy for a blocked session is authored ONCE, localized, and keyed by the block's code.
 *
 * It used to be three wordings of one fact: hard-coded English inside `deriveAuthState`'s result (shown by web's
 * `AccountStateGate` and mobile's `AuthGate`), and a second, longer suspended wording in mobile's own dictionary (shown
 * by the profile screen's banner). A string inside a pure state derivation also cannot be localized, which breaks the
 * localization mandate for the notice a viewer sees at the worst possible moment.
 */
import { describe, expect, it } from 'vitest';

import { authBlockMessages } from '../authBlockMessages.js';
import { IMPERSONATION_BLOCK, SUSPENDED_BLOCK } from '../authState.js';

describe('authBlockMessages', () => {
    it('has a localized title and body for exactly the two block codes', () => {
        const { en } = authBlockMessages;

        expect(Object.keys(en).sort()).toEqual(['account_suspended', 'impersonation_blocked']);
        expect(en[SUSPENDED_BLOCK.code].title).toBe('Account suspended');
        expect(en[IMPERSONATION_BLOCK.code].title).toBe('Impersonation blocked');
    });

    it('tells a suspended viewer what is paused and who can lift it', () => {
        const { body } = authBlockMessages.en[SUSPENDED_BLOCK.code];

        expect(body).toMatch(/suspended/i);
        expect(body).toMatch(/support/i);
    });

    it('says impersonated sessions cannot use the app', () => {
        expect(authBlockMessages.en[IMPERSONATION_BLOCK.code].body).toBe(
            'Impersonated sessions cannot access Commise.',
        );
    });
});
