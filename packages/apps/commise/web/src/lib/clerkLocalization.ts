/**
 * The words Clerk's forms show that the app owns, as the object `<ClerkProvider localization>` takes
 * (`docs/design/uiOverhaul/buildSpec.md` §8). Clerk accepts localization on its provider and not on `<SignIn>`, so this
 * serves the document (`appDocument`).
 *
 * Only what the design names is overridden: the brand line under the sign-in title and the sign-in footer's link, which
 * is the ONLY way to register (FR-045a), and the same brand line under the sign-up title (the native screen shows it),
 * plus the three errors the sign-in identifier field raises (A-004). Everything else is Clerk's own copy, in Clerk's own
 * language.
 */
import { resolveMessages } from '@commise/i18n';
import type { ClerkProvider } from '@clerk/nextjs';
import type { ComponentProps } from 'react';

import { authMessages } from '@/components/auth/messages';

/** What `<ClerkProvider localization>` takes. */
export type ClerkLocalization = NonNullable<ComponentProps<typeof ClerkProvider>['localization']>;

/**
 * @param locale - The document's locale.
 * @returns Clerk's localization for it. Pure.
 */
export function clerkLocalizationFor(locale: string): ClerkLocalization {
    const { surface } = resolveMessages(authMessages, locale);

    return {
        signIn: {
            start: {
                subtitle: surface.brandLine,
                actionText: surface.signUpPrompt,
                actionLink: surface.signUpAction,
            },
        },
        // Native's sign-up shows the brand line too, so the platforms agree.
        signUp: { start: { subtitle: surface.brandLine } },
        // Clerk shows the API's own words for a bad identifier, and they name a username the product does not offer
        // (A-004 / W-20). Only the identifier field's errors are replaced: a wrong password and too many attempts keep
        // Clerk's copy on purpose (`buildSpec.md` §8 States), and this is not a catalogue of Clerk's errors.
        // ⚠️ The codes are probable, not observed — see the unit test.
        unstable__errors: {
            form_param_nil__identifier: surface.emailRequired,
            form_param_format_invalid__identifier: surface.emailInvalid,
            form_identifier_not_found: surface.accountNotFound,
        },
    };
}
