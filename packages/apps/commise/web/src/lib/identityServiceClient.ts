/**
 * Shared factory for the web app's typed identity/profile client (DA10-c). ONE source of truth — the base
 * origin, `credentials` policy, and the 401-redirect-to-sign-in side effect — for every web call site that
 * talks to `GET`/`PATCH`/`DELETE /api/v1/users/me` (`useUserProfile`, `AccountEditForm`, `AccountDeleteForm`),
 * mirroring `recipeServiceConfig.ts`'s role for the recipe client.
 *
 * The origin comes from the validated configuration in `@/config/env` (never hardcoded —
 * CODING_STANDARDS §12) and has deliberately NO default.
 *
 * ⚠️ THIS IS NOW THE ONLY WEB PATH TO THE IDENTITY SERVICE. `lib/apiClient.ts` — a second hand-rolled
 * transport that duplicated this file's origin, `credentials` policy and 401 redirect while validating no
 * response (`JSON.parse(text) as T`) — has been DELETED, and the two server-rendered pages its own header
 * described as "not migrated to the typed client" (`ProfileContent`, `AccountContent`) now call
 * {@link createProfileServiceClient}. So there is one place a web identity call is configured, and its
 * responses are parsed against `@kitchensink/schema-identity` (§15 / ADR-0014).
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
import { redirectToSignInOnce } from '@/lib/unauthorizedRedirect';

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
        // ONE authoritative recovery policy — it used to be duplicated in `apiClient`, which is gone — and
        // CIRCUIT-BROKEN: a 401 that
        // survives the sign-in round trip (wrong Clerk instance, rotated verification key, `azp` mismatch)
        // is not fixable by bouncing, so the second attempt is suppressed and the error surfaces to the
        // consumer's boundary rather than looping the browser. See lib/unauthorizedRedirect.ts.
        onUnauthorized: redirectToSignInOnce,
    });
}
