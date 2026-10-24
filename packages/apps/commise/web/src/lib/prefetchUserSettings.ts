/**
 * @module lib/prefetchUserSettings — the server half of the settings read (ADR-0059), for the pages whose first paint
 * depends on a setting.
 *
 * The recipe library's grid/list choice is an account setting (owner ruling 2026-10-17). A cookie used to carry it so the
 * server could render the cook's view with no flip. The server already holds the session, so it reads the setting
 * itself, with THAT viewer's token, and dehydrates it under the key the client hook reads (`profileQueries(...)
 * .settings()`): the first render is the cook's choice, and the shell's own settings read (the `/` shortcut) finds the
 * answer already cached, which saves a request on every such page.
 *
 * ⛔ IT MUST NOT COST THE PAGE ITS FIRST BYTE. A FAILURE is free: `prefetchQuery` swallows its query's error and
 * `dehydrate()` leaves out a query that did not succeed, so an identity outage degrades to the width's default view (and
 * the client's own read), not a 500. A HANG is not free: `ProfileServiceClient` bounds no request, so an identity service
 * that accepts a connection and never answers would hold the server render until the platform's limit. The read is
 * therefore raced against {@link SETTINGS_PREFETCH_DEADLINE_MS}; past it the page renders without the setting and the
 * client reads it. The late answer is discarded: it settles after `dehydrate()` has run.
 *
 * The client is the web factory's (`createProfileServiceClient`, the one web path to identity). Its 401 recovery
 * navigates the browser and is a no-op where there is no `window`, which is the server.
 *
 * @sideEffect Sends `GET /api/v1/users/me/settings` with the viewer's session token.
 */
import { profileQueries } from '@commise/features-account';
import type { QueryClient } from '@tanstack/react-query';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/**
 * How long a page waits for the settings before it renders without them. The read is one primary-key lookup, so this is
 * generous for a healthy service, and it runs beside the library read (which takes longer), so a healthy page never waits
 * on it.
 */
export const SETTINGS_PREFETCH_DEADLINE_MS = 1500;

/**
 * Prefetch the signed-in viewer's settings into a server `QueryClient`.
 *
 * @param queryClient - The request's server query client, which the page dehydrates.
 * @param token - The viewer's session token, or `null` when the session yields none (nothing is requested).
 * @returns Resolves when the read settles or the deadline passes, whichever is first.
 */
export async function prefetchUserSettings(queryClient: QueryClient, token: string | null): Promise<void> {
    if (token === null) {
        return;
    }

    const read = queryClient.prefetchQuery(profileQueries(createProfileServiceClient(token)).settings());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SETTINGS_PREFETCH_DEADLINE_MS);
    });

    try {
        await Promise.race([read, deadline]);
    } finally {
        clearTimeout(timer);
    }
}
