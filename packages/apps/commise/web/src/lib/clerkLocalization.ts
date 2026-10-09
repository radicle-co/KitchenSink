/**
 * The words Clerk's forms show that the app owns, as the object `<ClerkProvider localization>` takes
 * (`docs/design/uiOverhaul/buildSpec.md` §8). Clerk accepts localization on its provider and not on `<SignIn>`, so this
 * serves the document (`appDocument`).
 *
 * Only what the design names is overridden: the brand line under the sign-in title and the sign-in footer's link, which
 * is the ONLY way to register (FR-045a), and the same brand line under the sign-up title (the native screen shows it). Everything else is Clerk's own copy, in Clerk's own language.
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
    };
}
