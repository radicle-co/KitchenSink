/**
 * The words Clerk's sign-in form shows that the app owns (`docs/design/uiOverhaul/buildSpec.md` §8): the brand line
 * under the title and the sign-up link, which is the ONLY way to register (FR-045a). Clerk takes localization on its
 * provider, not on `<SignIn>`, so one object serves the document.
 */
import { describe, expect, it } from 'vitest';

import { clerkLocalizationFor } from '../clerkLocalization';

describe('clerkLocalizationFor', () => {
    it('sets the brand line as the sign-in subtitle', () => {
        expect(clerkLocalizationFor('en').signIn?.start?.subtitle).toBe('Your recipes, in one place.');
    });

    it('words the sign-up link “New to Commise? Create an account”', () => {
        const start = clerkLocalizationFor('en').signIn?.start;

        expect(start?.actionText).toBe('New to Commise?');
        expect(start?.actionLink).toBe('Create an account');
    });

    it('falls back to the English words for a locale with no catalogue', () => {
        expect(clerkLocalizationFor('de').signIn?.start?.subtitle).toBe('Your recipes, in one place.');
    });

    // The native sign-up screen shows the brand line too, so the two platforms agree on what the sign-up form says.
    it('sets the same brand line under the sign-up title, and leaves its other words to Clerk', () => {
        expect(clerkLocalizationFor('en').signUp?.start?.subtitle).toBe('Your recipes, in one place.');
        expect(clerkLocalizationFor('en').signUp?.start?.actionText).toBeUndefined();
    });
});
