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

    // A-004 / W-20: Clerk showed the API's own words for a bad identifier — "You have to use email address or username."
    // and "Identifier is invalid." — which name a username the product does not offer. Only the identifier field's
    // errors are replaced; every other code keeps Clerk's message, on purpose (`buildSpec.md` §8 States keeps its copy
    // for a wrong password and too many attempts).
    // ⚠️ The error codes are PROBABLE, not observed: the strings above are server `long_message`s that appear nowhere
    // in node_modules. Confirm them against a live instance (`errors[0].code` on an empty and a malformed submit).
    describe('the identifier errors', () => {
        const errors = () => clerkLocalizationFor('en').unstable__errors;

        it('asks for the email address when the field is empty', () => {
            expect(errors()?.form_param_nil__identifier).toBe('Enter your email address.');
        });

        it('asks for a valid email address when the identifier is malformed', () => {
            expect(errors()?.form_param_format_invalid__identifier).toBe('Enter a valid email address.');
        });

        it('says no account was found, and does not blame the address’s format', () => {
            expect(errors()?.form_identifier_not_found).toBe('We couldn’t find an account with that email address.');
        });

        it('replaces nothing else, so every other error keeps Clerk’s own message', () => {
            expect(Object.keys(errors() ?? {}).sort()).toEqual(
                [
                    'form_identifier_not_found',
                    'form_param_format_invalid__identifier',
                    'form_param_nil__identifier',
                ].sort(),
            );
        });

        it('falls back to the English words for a locale with no catalogue', () => {
            expect(clerkLocalizationFor('de').unstable__errors?.form_param_nil__identifier).toBe(
                'Enter your email address.',
            );
        });
    });
});
