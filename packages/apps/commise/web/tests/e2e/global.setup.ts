import { clerkSetup } from '@clerk/testing/playwright';

import { ensureSignInTestUser } from './utils/test-user';

export default async function globalSetup() {
    // Issues a Clerk testing token so the e2e browser bypasses bot detection on the auth widgets.
    await clerkSetup();
    // Provision the fixed sign-in account so the sign-in/auth specs have a user to authenticate as.
    await ensureSignInTestUser();
}
