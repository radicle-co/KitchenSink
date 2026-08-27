import { clerkSetup } from '@clerk/testing/playwright';

import {
    backfillExternalIdLocally,
    ensureSignInTestUser,
    RUN_KEY,
    TEST_USER_EMAIL,
    waitForTestUserExternalId,
} from './utils/testUser';

export default async function globalSetup() {
    // Issues a Clerk testing token so the e2e browser bypasses bot detection on the auth widgets.
    await clerkSetup();
    // Importing testUser resolved (and PINNED into process.env) this run's key; log it so a CI failure can
    // be traced to the exact Clerk user, and so a stale/duplicated fixture is identifiable by name.
    // Playwright's worker processes inherit this env, which is what makes them derive the same identity.
    console.log(`[e2e setup] run key=${RUN_KEY} sign-in fixture=${TEST_USER_EMAIL}`);
    // Provision THIS RUN's sign-in account so the sign-in/auth specs have a user to authenticate as. It is
    // run-scoped on purpose: a fixed, shared fixture let two concurrent CI runs delete each other's user
    // (see runFixtureIdentity.ts).
    const userId = await ensureSignInTestUser();
    // Block until the async user.created webhook has backfilled `external_id` onto this fresh user, so every
    // owner-gated spec sees a token that carries the app-user ULID (fixes the first-token sync race that made
    // the suite flaky as more owner-scoped specs landed). Fails loud here if the backfill never arrives.
    // ⛔ TWO PATHS, and the DEFAULT is the real one. Unset — which is every CI run — this waits for the
    // sandbox `user.created` webhook to backfill `external_id`, exercising the deployed identity-sync chain.
    //
    // ⚠️ `E2E_LOCAL_IDENTITY=1` writes the claim directly instead, so a developer can run browser tests with
    // no cloud infrastructure at all. The sandbox RDS and NAT are ON-DEMAND by design, so `stopped` is their
    // correct resting state — and waking them to supply one string to a focus-and-routing test is not a
    // trade worth making. It is opt-in precisely so a CI run can never take it by accident and report a
    // green identity-sync path that was never touched.
    if (process.env['E2E_LOCAL_IDENTITY'] === '1') {
        const externalId = await backfillExternalIdLocally(userId);

        console.log(`[e2e setup] LOCAL identity: external_id=${externalId} written directly (webhook BYPASSED)`);

        return;
    }

    await waitForTestUserExternalId(userId);
}
