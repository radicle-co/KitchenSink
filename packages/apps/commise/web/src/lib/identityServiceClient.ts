/**
 * Shared factory for the web app's typed identity/profile client (DA10-c). ONE source of truth — the base
 * origin, `credentials` policy, and the 401-redirect-to-sign-in side effect — for every web call site that
 * talks to `GET`/`PATCH`/`DELETE /api/v1/users/me` (`useUserProfile`, `AccountEditForm`, `AccountDeleteForm`),
 * mirroring `recipeServiceConfig.ts`'s role for the recipe client.
 *
 * The origin comes from the validated configuration in `@/config/env` (never hardcoded —
 * CODING_STANDARDS §12) and has deliberately NO default; `lib/apiClient.ts` (still used by the two
 * server-rendered pages that have not migrated to the typed client) imports
 * {@link IDENTITY_SERVICE_BASE_URL} from here rather than re-declaring its own, so the two never drift.
 *
 * This used to read `process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:4000'`. `NEXT_PUBLIC_*`
 * is inlined at BUILD time, so that fallback shipped in the deployed preview bundle and every signed-in
 * visitor's profile fetch hit their own machine. An unconfigured build now fails loudly instead.
 *
 * The redirect-on-401 + `credentials: 'include'` behavior reproduces `apiClient.ts`'s prior side effects
 * exactly (same observable behavior, DA10 is a shape refactor, not a behavior change) — but as an INJECTED
 * `onUnauthorized` callback + `credentials` option on `ProfileServiceClient`, not logic baked into the
 * shared, platform-agnostic client itself (mobile has no such redirect policy).
 */
import { ProfileServiceClient, type TokenSource } from '@commise/features-account';

import { env } from '@/config/env';
import { withBasePath } from '@/lib/basePath';
import { navigateTo } from '@/lib/navigation';

/** The identity API base origin, from the validated environment. */
export const IDENTITY_SERVICE_BASE_URL = env.NEXT_PUBLIC_IDENTITY_API_URL;

/**
 * Build a {@link ProfileServiceClient} for the web app.
 *
 * @param token - A literal (server-resolved) access token, or a per-request callback (client hooks).
 * @returns A configured client targeting the identity service, with the web 401-redirect wired.
 */
export function createProfileServiceClient(token: TokenSource): ProfileServiceClient {
    return new ProfileServiceClient({
        baseUrl: IDENTITY_SERVICE_BASE_URL,
        token,
        credentials: 'include',
        onUnauthorized: () => {
            if (typeof window !== 'undefined') {
                // Prefix the sign-in target with the base path; `window.location.pathname` already carries
                // the prefix (the browser is at /pr-{N}/…), so do NOT prefix the redirect_url value.
                navigateTo(`${withBasePath('/sign-in')}?redirect_url=${encodeURIComponent(window.location.pathname)}`);
            }
        },
    });
}
