/**
 * Shared factory for the web app's typed identity/profile client (DA10-c). ONE source of truth — the base
 * origin, `credentials` policy, and the 401-redirect-to-sign-in side effect — for every web call site that
 * talks to `GET`/`PATCH`/`DELETE /v1/users/me` (`useUserProfile`, `AccountEditForm`, `AccountDeleteForm`),
 * mirroring `recipeServiceConfig.ts`'s role for the recipe client.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is read here (never hardcoded — CODING_STANDARDS §12) as the ONE source of
 * truth for the identity origin; `lib/apiClient.ts` (still used by the two server-rendered pages that have
 * not migrated to the typed client) imports {@link IDENTITY_SERVICE_BASE_URL} from here rather than
 * re-declaring its own fallback, so the two never drift apart.
 *
 * The redirect-on-401 + `credentials: 'include'` behavior reproduces `apiClient.ts`'s prior side effects
 * exactly (same observable behavior, DA10 is a shape refactor, not a behavior change) — but as an INJECTED
 * `onUnauthorized` callback + `credentials` option on `ProfileServiceClient`, not logic baked into the
 * shared, platform-agnostic client itself (mobile has no such redirect policy).
 */
import { ProfileServiceClient, type TokenSource } from '@commise/features-account';

import { withBasePath } from '@/lib/basePath';
import { navigateTo } from '@/lib/navigation';

/** The identity API base origin. Matches `lib/apiClient.ts`'s `API_BASE_URL` default. */
export const IDENTITY_SERVICE_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:4000';

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
