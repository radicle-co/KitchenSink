import { clerkSetup } from '@clerk/testing/playwright';

import { resolveSignInTestUser, RUN_KEY, TEST_SLOT } from './utils/testUser';

export default async function globalSetup() {
    // Issues a Clerk testing token so the e2e browser bypasses bot detection on the auth widgets.
    await clerkSetup();
    // Importing testUser resolved (and PINNED into process.env) this run's key; the key now scopes only the
    // sign-up spec's users and this process's auth-state file. The sign-in identity is a FIXED test-pool slot.
    console.log(`[e2e setup] run key=${RUN_KEY} pool slot=${TEST_SLOT.tier}/${TEST_SLOT.id} (${TEST_SLOT.email})`);
    // ⛔ Resolve the slot and REFUSE it unless `poolAdmin` provisioned it — marked, with the `external_id` every
    // owner-gated spec's token must carry. Nothing is created here (owner ruling 2026-09-13); a refusal names
    // `poolAdmin --apply` as the fix. The DATA the slot owns on a deployed stage is emptied by the workflow's
    // `resetPool` steps, which — unlike this process's teardown — also run when the shard is cancelled.
    const userId = await resolveSignInTestUser();

    console.log(`[e2e setup] pool slot resolves to Clerk user ${userId}`);
}
