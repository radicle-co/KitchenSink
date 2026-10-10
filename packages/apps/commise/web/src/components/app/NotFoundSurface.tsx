'use client';

/**
 * @module components/app/NotFoundSurface — the frame the app's 404 page is shown in (E2; `specShellAndLists.md` §N).
 *
 * A signed-in viewer gets the page inside the app shell, so the navigation is right there and they are never
 * stranded. A signed-out viewer gets it on the plain canvas the sign-in page uses, with no app navigation they could
 * not use. The page body is {@link RouteNotFoundState} either way.
 *
 * It is ORCHESTRATION: it reads the session and chooses the frame. The session is read here, on the client, because
 * `not-found.tsx` must not call `auth()` (see that file). Until Clerk has loaded, the plain canvas is shown; on the web
 * `@clerk/nextjs` hands the server's auth state to the first render, so a signed-in viewer does not see it flash.
 *
 * @pattern Strategy — the session selects which frame (app shell or plain canvas) hosts the one not-found body.
 */
import { useAuth } from '@clerk/nextjs';
import type { FC } from 'react';

import { AppShell } from '@/components/app/AppShell';
import { RouteNotFoundState } from '@/components/app/RouteNotFoundState';

/** The app's 404 page, framed for whoever is looking at it. */
export const NotFoundSurface: FC = () => {
    const { isLoaded, isSignedIn } = useAuth();

    if (isLoaded && isSignedIn === true) {
        return (
            // No destination is active: an unknown URL is none of them.
            <AppShell activeId={null} titleId="notFound">
                <RouteNotFoundState />
            </AppShell>
        );
    }

    return (
        <main className="flex min-h-screen items-center justify-center px-4 py-12">
            <RouteNotFoundState />
        </main>
    );
};
