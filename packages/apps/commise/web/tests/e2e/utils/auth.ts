import { createClerkClient } from '@clerk/backend';
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, type Page } from '@playwright/test';

import { hasClerkSessionCookie } from './authState';
import { isHome, pathnameOf, route } from './basePath';
import { RUN_KEY, TEST_USER_EMAIL } from './testUser';

function client() {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required for e2e auth');
    }

    return createClerkClient({ secretKey });
}

/** Options for {@link signInWithTicket}. */
export interface SignInOptions {
    /**
     * Mint a NEW session even if this context already holds one.
     *
     * Only `auth.setup.ts` sets it — the step whose entire job is to create the session the fast path later
     * reuses would otherwise short-circuit on the very state it is supposed to produce.
     */
    readonly force?: boolean;
}

/**
 * Ensure `page` holds an authenticated session and has landed on Home.
 *
 * ## Two routes to the same post-condition
 *
 * **Restored (the common case).** When the browser context was created from a saved `storageState` it already
 * holds the run's session, so this only navigates to Home. No Clerk Backend API call, no `/sign-in` visit, no
 * handshake. ~100 of the suite's tests take this path; see `utils/authState.ts` for why that is worth doing and
 * which specs deliberately opt out of the shared session.
 *
 * **Fresh.** Otherwise it mints a backend sign-in token for this run's test user and lets `<SignIn>` consume
 * the `__clerk_ticket`, WITHOUT driving the password + new-device-email-code UI (that UI is exercised on its
 * own by `signIn.spec.ts`). This is the path the `setup` project and every session-owning spec take.
 *
 * The branch is decided from the CONTEXT's cookies rather than an environment flag, so the helper cannot
 * disagree with the config about which project it is running in.
 *
 * ⚠️ The NAME is now narrower than the behaviour — this is "ensure signed in", and only sometimes by ticket.
 * It is kept because ~30 spec files call it and renaming them all is churn with no test value; rename it the
 * next time those specs are edited for another reason.
 *
 * @param page - The page to authenticate.
 * @param options - See {@link SignInOptions}.
 * @sideEffect Calls Clerk's Backend API (fresh path only), installs the Clerk testing token, and navigates.
 */
export async function signInWithTicket(page: Page, options: SignInOptions = {}): Promise<void> {
    // Installed on BOTH paths. It is a route interception, not a network call, and a restored session still
    // makes Clerk Frontend-API requests (token refresh) that bot protection would otherwise challenge.
    await setupClerkTestingToken({ page });

    if (options.force !== true && hasClerkSessionCookie(await page.context().cookies())) {
        await page.goto(route('/'));
        await expect
            .poll(() => isHome(pathnameOf(page)), {
                timeout: 30_000,
                // Names the real suspect. Restored state that cannot reach Home means the shared session is
                // dead — the setup project's own assertions should have caught that, so the likely causes are
                // a stale state file or a Clerk-side revocation mid-run, NOT this spec.
                message:
                    'a RESTORED session did not land on Home. The shared storageState is probably no longer ' +
                    'valid (see tests/e2e/auth.setup.ts and utils/authState.ts); a spec that revokes its ' +
                    'session must be listed in SESSION_OWNING_SPECS so it never shares this one.',
            })
            .toBe(true);

        return;
    }

    const clerk = client();
    const { data } = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });
    const userId = data[0]?.id;

    if (!userId) {
        // The fixture is RUN-SCOPED (@kitchensink/e2e-fixtures), so this can no longer mean "a concurrent run
        // deleted it". It means this process derived a DIFFERENT run key than globalSetup did — i.e. the
        // pinned COMMISE_E2E_RUN_KEY did not reach this worker — or globalSetup never ran.
        throw new Error(
            `test sign-in user ${TEST_USER_EMAIL} is missing — globalSetup should have created it ` +
                `(run key=${RUN_KEY}; COMMISE_E2E_RUN_KEY=${process.env['COMMISE_E2E_RUN_KEY'] ?? '<unset>'})`,
        );
    }

    const { token } = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 });

    // The testing token was installed at the top of this function, on both paths.
    await page.goto(`${route('/sign-in')}?__clerk_ticket=${token}`);

    // The ticket sign-in completes and the SignIn component redirects to forceRedirectUrl ('/').
    // Generous timeout: this is usually the first route a worker hits, so it absorbs Next dev's
    // on-demand route compilation under parallel load.
    await expect.poll(() => isHome(pathnameOf(page)), { timeout: 30_000 }).toBe(true);
}
