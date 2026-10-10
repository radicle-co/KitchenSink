'use client';

/**
 * @module components/auth/SignInForm — Clerk's `<SignIn>` for the sign-in page, themed for the browser's scheme
 * (`docs/design/uiOverhaul/buildSpec.md` §8; D15).
 *
 * The sign-in surface IS the front door (FR-045a): nothing stands in front of it, and the "Create an account" link it
 * renders from `signUpUrl` is the ONLY route to registration, so the appearance keeps it on one line. Its wording and the
 * brand line are Clerk localization, which Clerk takes on its provider (`lib/clerkLocalization`), not on this widget.
 *
 * Why a client component: Clerk's `variables` cannot read a CSS custom property, so the appearance is built for the
 * scheme `useColorScheme` reports (the page's server render reads light and the client corrects it). Every other colour
 * is a role class and needs no scheme.
 *
 * The routing notes below are the page's, moved with the widget they describe:
 * - `routing="hash"`: Clerk derives its path from `usePathname()` (basePath-STRIPPED), so under a preview basePath
 *   (`/pr-{N}`) path routing cannot reconcile and renders an empty widget. Hash routing drives the multi-step flow
 *   through the URL fragment, independent of basePath.
 * - `signUpUrl` is a page LOCATOR consumed as-is, so the caller passes it WITH the basePath. `forceRedirectUrl` runs
 *   through Next's router, which already prepends the basePath, so it is passed BARE; a pre-prefixed value
 *   double-prefixes to `/pr-{N}/pr-{N}/` and strands the signed-in user. The OAuth/SSO-callback flow navigates it raw
 *   (its Next router is not wired during the callback page load), which drops the prefix to the bare root; that landing
 *   is re-homed onto the basePath by the bare-root redirect in `next.config.ts`. Do NOT prefix `forceRedirectUrl`.
 * - `forceRedirectUrl` is ALSO the sole guard against an open redirect: `clerkMiddleware`'s protected-route bounce
 *   appends `?redirect_url=<original path>`, and forcing the locale root ignores it. If return-to-original-route is
 *   ever added, validate that `redirect_url` is same-origin first.
 *
 * @pattern Adapter over Clerk's `<SignIn>` — the app's routing, copy and appearance as its props
 */
import { SignIn } from '@clerk/nextjs';
import { clerkAppearanceFor } from '@commise/ui';
import type { FC } from 'react';

import { useColorScheme } from '@/hooks/useColorScheme';

/** Props for {@link SignInForm}. */
export interface SignInFormProps {
    /** The sign-up page's URL, WITH the basePath. */
    readonly signUpUrl: string;
    /** Where a completed sign-in lands, WITHOUT the basePath. */
    readonly forceRedirectUrl: string;
}

/** The sign-in widget. */
export const SignInForm: FC<SignInFormProps> = ({ signUpUrl, forceRedirectUrl }) => {
    const scheme = useColorScheme();

    return (
        <SignIn
            routing="hash"
            appearance={clerkAppearanceFor(scheme)}
            signUpUrl={signUpUrl}
            forceRedirectUrl={forceRedirectUrl}
        />
    );
};
