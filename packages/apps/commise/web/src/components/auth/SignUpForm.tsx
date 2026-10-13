'use client';

/**
 * @module components/auth/SignUpForm — Clerk's `<SignUp>` for the sign-up page, themed for the browser's scheme
 * (`docs/design/uiOverhaul/buildSpec.md` §8; D15). The spec is email and password, plus Google, with the username and
 * the first and last name OFF. That is Clerk dashboard configuration, not code: this widget has no say in which fields
 * the form asks for, and the sandbox instance has been seen collecting all three — so what a visitor is asked for is
 * whatever the instance is set to, not what this file implies.
 *
 * The routing is the sign-in form's (see `SignInForm`): hash routing under the preview basePath, `signInUrl` WITH the
 * basePath, `forceRedirectUrl` BARE — a pre-prefixed redirect double-prefixes to `/pr-{N}/pr-{N}/` and strands the
 * now-signed-in user on a blank sign-up ("<SignUp/> cannot render when a user is already signed in"). Like sign-in's,
 * the redirect is a PARSED destination (`safeReturnPath`), never a raw query value.
 *
 * @pattern Adapter over Clerk's `<SignUp>` — the app's routing and appearance as its props
 */
import { SignUp } from '@clerk/nextjs';
import { clerkAppearanceFor } from '@commise/ui';
import type { FC } from 'react';

import { useColorScheme } from '@/hooks/useColorScheme';

/** Props for {@link SignUpForm}. */
export interface SignUpFormProps {
    /** The sign-in page's URL, WITH the basePath. */
    readonly signInUrl: string;
    /** Where a completed sign-up lands, WITHOUT the basePath. */
    readonly forceRedirectUrl: string;
}

/** The sign-up widget. */
export const SignUpForm: FC<SignUpFormProps> = ({ signInUrl, forceRedirectUrl }) => (
    <SignUp
        routing="hash"
        appearance={clerkAppearanceFor(useColorScheme())}
        signInUrl={signInUrl}
        forceRedirectUrl={forceRedirectUrl}
    />
);
