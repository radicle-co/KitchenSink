/**
 * The words both sign-in surfaces say, authored ONCE. Web's Clerk localization and mobile's custom forms each carried
 * their own copy of the brand line, the sign-up prompt and link, and the two email messages.
 *
 * The wording is also what the apps' end-to-end flows match ("Create an account", "New to Commise?"), so a reword here is
 * a deliberate change to those flows, not a drive-by.
 */
import { describe, expect, it } from 'vitest';

import { authSurfaceMessages } from '../authSurfaceMessages.js';

describe('authSurfaceMessages', () => {
    const { en } = authSurfaceMessages;

    it('says the brand line under the sign-in and sign-up titles', () => {
        expect(en.brandLine).toBe('Your recipes, in one place.');
    });

    it('offers sign-up from the sign-in surface, the only way to register (FR-045a)', () => {
        expect(en.noAccountPrompt).toBe('New to Commise?');
        expect(en.signUpLink).toBe('Create an account');
    });

    it('asks for an email address, and a valid one, never naming a username the product does not offer', () => {
        expect(en.emailRequired).toBe('Enter your email address.');
        expect(en.emailInvalid).toBe('Enter a valid email address.');
        expect(`${en.emailRequired} ${en.emailInvalid}`).not.toMatch(/username/i);
    });
});
