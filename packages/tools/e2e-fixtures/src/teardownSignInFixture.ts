/**
 * Delete THIS RUN's Clerk sign-in fixture, plus an age-gated sweep of fixtures leaked by crashed runs.
 *
 * ⛔ It deletes only what this run owns and what is old enough that no live run could still own it. The
 * alternative — "delete every `commise-e2e*` user" — is precisely the bug `runFixtureIdentity.ts` records:
 * on a SHARED Clerk instance that tears down a concurrent run's LIVE fixture, and the victim fails with a
 * missing-user error that names nothing about the real cause.
 *
 * The plan is computed by {@link planE2EUserCleanup}, which both platforms share, so "which users may this
 * run delete" has one answer rather than one per suite.
 *
 * @sideEffect Deletes Clerk users.
 */
import { createClerkClient } from '@clerk/backend';

import { E2E_USER_QUERY, LEAKED_FIXTURE_MAX_AGE_MS, planE2EUserCleanup, resolveRunKey } from './runFixtureIdentity.js';

const secretKey = process.env['CLERK_SECRET_KEY'];

if (secretKey === undefined || secretKey.trim() === '') {
    console.error('teardown-signin-fixture: CLERK_SECRET_KEY is required.');
    process.exit(1);
}

const runKey = resolveRunKey();
const clerk = createClerkClient({ secretKey });
const candidates = await clerk.users.getUserList({ query: E2E_USER_QUERY, limit: 200 });

const plan = planE2EUserCleanup(
    candidates.data.map((user) => ({
        id: user.id,
        emails: user.emailAddresses.map((address) => address.emailAddress),
        createdAtMs: user.createdAt,
    })),
    { runKey, nowMs: Date.now(), maxAgeMs: LEAKED_FIXTURE_MAX_AGE_MS },
);

// This run's own fixture, plus fixtures old enough that no live run could still own them. A FRESH user
// belonging to a CONCURRENT run is in neither list — that separation is the whole point of the plan.
for (const id of [...plan.ownFixtureIds, ...plan.leakedIds]) {
    // ⚠️ One failure must not abandon the rest: a leaked fixture left behind is a slow leak on a shared
    // instance, and the next run's sweep is what collects it.
    try {
        await clerk.users.deleteUser(id);
    } catch (error) {
        console.error(`teardown-signin-fixture: could not delete ${id}: ${String(error)}`);
    }
}

console.error(
    `teardown-signin-fixture: deleted ${plan.ownFixtureIds.length} own + ${plan.leakedIds.length} leaked ` +
        `fixture user(s) for run ${runKey}.`,
);
