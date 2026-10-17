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
 * It never throws and never blocks on a failure: `prefetchQuery` swallows its query's error and `dehydrate()` leaves out
 * a query that did not succeed, so an identity outage degrades to the width's default view (and the client's own read),
 * not a 500. The client built here has NO `onUnauthorized`: web's sign-in bounce navigates the browser, and there is none
 * on the server.
 *
 * @sideEffect Sends `GET /api/v1/users/me/settings` with the viewer's session token.
 */
import { ProfileServiceClient, profileQueries } from '@commise/features-account';
import type { QueryClient } from '@tanstack/react-query';

import { IDENTITY_SERVICE_BASE_URL } from '@/lib/identityServiceClient';

/**
 * Prefetch the signed-in viewer's settings into a server `QueryClient`.
 *
 * @param queryClient - The request's server query client, which the page dehydrates.
 * @param token - The viewer's session token, or `null` when the session yields none (nothing is requested).
 * @returns Resolves when the read settles, success or failure.
 */
export async function prefetchUserSettings(queryClient: QueryClient, token: string | null): Promise<void> {
    if (token === null) {
        return;
    }

    const client = new ProfileServiceClient({ baseUrl: IDENTITY_SERVICE_BASE_URL, token });

    await queryClient.prefetchQuery(profileQueries(client).settings());
}
