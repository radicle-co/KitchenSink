import { deleteAllE2EUsers } from './utils/test-user';

export default async function globalTeardown() {
    // Remove the e2e users from Clerk after the run — this cascades to a DB purge via the
    // user.deleted webhook (the identity DB itself is not reachable from the test environment).
    // Best-effort: a cleanup failure must never turn an otherwise-green run red.
    try {
        await deleteAllE2EUsers();
    } catch (err) {
        console.warn('[e2e teardown] user cleanup failed (non-fatal):', err);
    }
}
