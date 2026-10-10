/**
 * The band drain's ENTRY POINT and ADR-0007's nightly window (R35).
 *
 * ⛔ The drain ticks every fifteen minutes and every tick reads the recipe database. Before the window was
 * honoured here, each tick of the nightly stop failed against a stopped database — 86 of 86 invocations on
 * pr-91 between 04:05 and 11:10 UTC on 2026-10-08 — and nobody saw it, because the NAT instance that carries
 * Sentry traffic is stopped in the same window. `drainRevokedBands` itself is covered by `bandDrain.test.ts`;
 * these cases cover only whether the handler is allowed to reach it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRecipePool } = vi.hoisted(() => ({ getRecipePool: vi.fn() }));

vi.mock('../../common/db.js', () => ({ getRecipePool }));

import { handler } from '../bandDrain.js';

/** 01:00 in New York — inside ADR-0007's nightly stop. */
const ASLEEP = new Date('2026-10-09T05:00:00Z');

/** 11:00 in New York — the stage is awake. */
const AWAKE = new Date('2026-10-09T15:00:00Z');

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    // Deliberately NO region or queue URL: a run that gets past the window fails on them at once, so whether
    // the handler stopped at the window is observable without wiring a database, SSM or SQS.
    delete process.env['AWS_REGION'];
    delete process.env['INGREDIENT_VERIFICATION_QUEUE_URL'];
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env['STAGE'];
});

describe('the band drain handler — the nightly window (R35)', () => {
    it('does nothing while a non-prod stage is asleep', async () => {
        vi.setSystemTime(ASLEEP);
        process.env['STAGE'] = 'pr-91';

        await expect(handler()).resolves.toBeUndefined();

        expect(getRecipePool).not.toHaveBeenCalled();
    });

    it('runs while the stage is awake', async () => {
        vi.setSystemTime(AWAKE);
        process.env['STAGE'] = 'pr-91';

        await expect(handler()).rejects.toThrow(/AWS_REGION/);
    });

    it('runs at night on prod, which never sleeps', async () => {
        vi.setSystemTime(ASLEEP);
        process.env['STAGE'] = 'prod';

        await expect(handler()).rejects.toThrow(/AWS_REGION/);
    });
});
