import { slotForShard, type PoolSlot } from '@kitchensink/e2e-fixtures/testPool';

/**
 * The fixed Clerk test-pool slot this Playwright process signs in as.
 *
 * ⛔ A SLOT, NOT A USER THIS RUN CREATES (owner ruling 2026-09-13: "We should have a pool of test users for clerk
 * so that we don't need to create ones"). The suite used to mint a run-scoped sign-in user per shard in
 * `globalSetup` and delete it in `globalTeardown`, which Playwright skips on a cancelled shard. The slot is
 * provisioned once by `poolAdmin`; the workflow's `test-pool-sandbox-web-{shard}` concurrency group is what keeps
 * two runs of one shard off it at once, and `resetPool` empties what it owns before and after.
 *
 * The shard is the lane — `COMMISE_E2E_SHARD`, which `playwright.config.ts` already forwards and every worker
 * inherits — and the STUBBED tier (`PLAYWRIGHT_MOCKED_ONLY=1`) has lanes of its own, because both matrices run on
 * the same pull request at the same time. A run with no shard (a developer machine) is shard 1. Pure.
 *
 * @param env - The slice of `process.env` that decides it.
 * @returns The slot.
 */
export function webPoolSlot(env: {
    readonly COMMISE_E2E_SHARD?: string | undefined;
    readonly PLAYWRIGHT_MOCKED_ONLY?: string | undefined;
}): PoolSlot {
    const raw = (env.COMMISE_E2E_SHARD ?? '').trim();
    const shard = raw === '' ? 1 : Number(raw);

    return slotForShard(env.PLAYWRIGHT_MOCKED_ONLY === '1' ? 'webStub' : 'web', shard);
}
