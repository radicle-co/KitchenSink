/**
 * @module lib/requireSignedIn — the ONE auth gate of every protected page.
 *
 * Replaces the `auth()` + `redirect(signInPathFor(…))` pair each page used to spell for itself. Two answers, in an order
 * that matters:
 *
 * 1. **404 for an address that is not a page, BEFORE `auth()`.** The middleware matcher skips a path that names a static
 *    file ({@link isStaticAssetPath}), so `clerkMiddleware` never ran for it and `auth()` throws without it. A dynamic
 *    segment still matches such a path (`/en/collections/cover.png` is `collections/[id]`), and so does a locale
 *    segment (`/cover.png/profile`), so every page gets the refusal from here rather than each remembering it. A locale
 *    this build does not route is refused for the same reason.
 * 2. **Sign-in for a signed-out visitor**, carrying where they were going (`signInPathFor`, W-01).
 *
 * @sideEffect Reads the request's Clerk session; throws Next's `notFound()` / `redirect()` control-flow errors.
 */
import { auth } from '@clerk/nextjs/server';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';

import { isRoutableLocale } from '@/lib/i18n';
import { signInPathFor } from '@/lib/signInReturn';
import { isStaticAssetPath } from '@/lib/staticAssetPath';

/** What a protected page reads from a signed-in request. */
export interface SignedInSession {
    /** The Clerk user id. */
    readonly userId: string;
    /** This request's session-token reader, for a server client built from the viewer's own token. */
    readonly getToken: Awaited<ReturnType<typeof auth>>['getToken'];
}

/**
 * @param locale - The route's locale segment.
 * @param returnPath - The page's own path (with its query, when it has one): where sign-in sends the visitor back to.
 * @returns The signed-in session. Never returns for a visitor who is not signed in, or an address that is not a page.
 */
export async function requireSignedIn(locale: string, returnPath: string): Promise<SignedInSession> {
    if (!isRoutableLocale(locale) || isStaticAssetPath(returnPath)) {
        notFound();
    }

    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(signInPathFor(locale, returnPath) as Route);
    }

    return { userId, getToken };
}
