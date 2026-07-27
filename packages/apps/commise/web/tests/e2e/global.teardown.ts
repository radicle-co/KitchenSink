import { deleteRunScopedE2EUsers, RUN_KEY } from './utils/testUser';

export default async function globalTeardown() {
    // Remove THIS RUN's e2e users from Clerk (plus an age-gated sweep of leaks from crashed runs) — each
    // delete cascades to a DB purge via the user.deleted webhook (the identity DB itself is not reachable
    // from the test environment). Deliberately NOT "delete every commise-e2e user": that nuked concurrent
    // runs' live fixtures, which is the bug runFixtureIdentity.ts exists to fix.
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
