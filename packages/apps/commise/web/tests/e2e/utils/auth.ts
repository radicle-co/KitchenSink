import { createClerkClient } from '@clerk/backend';
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, type Page } from '@playwright/test';

import { isHome, pathnameOf, route } from './basePath';
import { TEST_USER_EMAIL } from './testUser';

function client() {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required for e2e auth');
    }

    return createClerkClient({ secretKey });
}

/**
 * Establish a real authenticated session WITHOUT driving the password + new-device-email-code UI:
 * mint a backend sign-in token for the fixed test user and let the <SignIn> component consume the
 * `__clerk_ticket`. This is the reliable way to get "an authenticated user" for the protected-route,
 * signed-in-redirect, and sign-out specs (the full password+code UI is exercised separately by the
 * sign-in form spec). Resolves once the session is live and the app has landed on the home page.
 */
export async function signInWithTicket(page: Page): Promise<void> {
    const clerk = client();
    const { data } = await clerk.users.getUserList({ emailAddress: [TEST_USER_EMAIL] });
    const userId = data[0]?.id;

    if (!userId) {
        throw new Error('test sign-in user is missing — globalSetup should have created it');
    }

    const { token } = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 });

    await setupClerkTestingToken({ page });
    await page.goto(`${route('/sign-in')}?__clerk_ticket=${token}`);

    // The ticket sign-in completes and the SignIn component redirects to forceRedirectUrl ('/').
    // Generous timeout: this is usually the first route a worker hits, so it absorbs Next dev's
    // on-demand route compilation under parallel load.
    await expect.poll(() => isHome(pathnameOf(page)), { timeout: 30_000 }).toBe(true);
}
