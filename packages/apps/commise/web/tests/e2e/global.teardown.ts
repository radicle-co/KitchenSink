import { deleteRunScopedE2EUsers, RUN_KEY } from './utils/testUser';

export default async function globalTeardown() {
    // Remove THIS RUN's sign-up users from Clerk (plus an age-gated sweep of leaks from crashed runs) — the ONE
    // carve-out that still mints a user per run, because registration is what `signUp.spec.ts` tests. The
    // sign-in identity is a fixed test-pool slot: it is never deleted, and its data is reset by the workflow.
    // Deliberately NOT "delete every commise-e2e user": that nuked concurrent runs' live fixtures.
    // Best-effort: a cleanup failure must never turn an otherwise-green run red.
    try {
        const deleted = await deleteRunScopedE2EUsers();

        console.log(
            `[e2e teardown] run key=${RUN_KEY} deleted own=${deleted.own.length} leaked=${deleted.leaked.length}`,
        );
    } catch (err) {
        console.warn('[e2e teardown] user cleanup failed (non-fatal):', err);
    }
}
