/**
 * The band drain's ENTRY POINT: it runs its job whenever it is invoked.
 *
 * ⛔ REWRITTEN (owner ruling 2026-10-12). The handler used to return early between 00:00 and 09:00 ET on a
 * non-prod stage (ADR-0007's window, R35), because each tick of the nightly stop failed against a stopped
 * database — 86 of 86 invocations on pr-91 on 2026-10-08. The CLOCK is deleted: a scheduled rule exists only
 * while the sandbox is up for its PR, so the handler never has to guess from the hour whether it is. Whether it
 * runs is decided by the rule's state, not by the handler. `drainRevokedBands` itself is covered by
 * `bandDrain.test.ts`; these cases cover only that the handler reaches it at any hour on any stage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRecipePool } = vi.hoisted(() => ({ getRecipePool: vi.fn() }));

vi.mock('../../common/db.js', () => ({ getRecipePool }));

import { handler } from '../bandDrain.js';

/** 01:00 in New York — an hour the handler used to refuse to run in on a non-prod stage. */
const SMALL_HOURS = new Date('2026-10-09T05:00:00Z');

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    // Deliberately NO region or queue URL: a run that gets past the entry fails on them at once, so whether the
    // handler went on to do its job is observable without wiring a database, SSM or SQS.
    delete process.env['AWS_REGION'];
    delete process.env['INGREDIENT_VERIFICATION_QUEUE_URL'];
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env['STAGE'];
});

describe('the band drain handler — it runs whenever invoked', () => {
    it.each(['pr-91', 'sandbox', 'prod'])('⛔ goes on to do its job at 01:00 New York on %s', async (stage) => {
        vi.setSystemTime(SMALL_HOURS);
        process.env['STAGE'] = stage;

        // Rejecting on the missing region proves it got past the entry; resolving would mean it stood down.
        await expect(handler()).rejects.toThrow(/AWS_REGION/);
    });
});
