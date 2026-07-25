import { clerkSetup } from '@clerk/testing/playwright';

import { ensureSignInTestUser, waitForTestUserExternalId } from './utils/testUser';

export default async function globalSetup() {
    // Issues a Clerk testing token so the e2e browser bypasses bot detection on the auth widgets.
    await clerkSetup();
    // Provision the fixed sign-in account so the sign-in/auth specs have a user to authenticate as.
    const userId = await ensureSignInTestUser();
    // Block until the async user.created webhook has backfilled `external_id` onto this fresh user, so every
    // owner-gated spec sees a token that carries the app-user ULID (fixes the first-token sync race that made
    // the suite flaky as more owner-scoped specs landed). Fails loud here if the backfill never arrives.
    await waitForTestUserExternalId(userId);
}
