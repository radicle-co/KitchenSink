/**
 * Unit tests for {@link RollingWindowLimiter}, the admission Policy (ADR-0053 §1, §2, §6).
 *
 * The limiter reads each source's limit from the register, applies a lowering override, and asks the ledger to admit
 * against two ceilings: ⌊0.9 × requests⌋ for every lane's calls together, and the caller's lane's own ceiling, which
 * for the worker is its share of that (`sourceCeiling.ts`). The ledger's atomicity is proven on a real Postgres in
 * `tests/e2e/sourceAdmission.e2e.test.ts`; here the ledger is a double, so these pin only what the limiter itself
 * decides.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdmitInput, WindowStatus } from '../../foods/dao/sourceCallLog.dao.js';
import { callsOn, countingLedger } from '../../../tests/support/countingLedger.js';
import { PRUNE_HORIZON_SECONDS, RollingWindowLimiter, type WindowLedger } from '../RollingWindowLimiter.js';

/** A ledger double that admits, records what it was asked, and reports a fixed status. */
function recordingLedger(status: WindowStatus = { byLane: { interactive: 0, worker: 0 }, paused: false }) {
    const admitted: AdmitInput[] = [];
    const pruned: number[] = [];
    const statusAsked: AdmitInput[] = [];
    const ledger: WindowLedger = {
        admit: async (input) => {
            admitted.push(input);

            return { admitted: true };
        },
        windowStatus: async (input) => {
            statusAsked.push(input);

            return status;
        },
        pruneAged: async (horizonSeconds) => {
            pruned.push(horizonSeconds);

            return 0;
        },
    };

    return { ledger, admitted, pruned, statusAsked };
}

/** USDA's declared window, in seconds. */
const HOUR_SECONDS = 3600;

describe('RollingWindowLimiter', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ['a live call, whose own calls stop where the window does', 'interactive', 900],
        ['a worker call, whose own calls stop at two thirds of that ceiling', 'worker', 600],
    ] as const)('admits %s, against 90% of the declared hour for every lane', async (_, lane, laneCeiling) => {
        const { ledger, admitted } = recordingLedger();

        await new RollingWindowLimiter(ledger, {}).admit('usda', lane);

        expect(admitted).toEqual([{ source: 'usda', lane, ceiling: 900, laneCeiling, windowSeconds: 3600 }]);
    });

    it.each([
        ['interactive', 13],
        ['worker', 8],
    ] as const)(
        'applies a lowering override in place of the declared limit, ceilings and window alike (%s)',
        async (lane, laneCeiling) => {
            const { ledger, admitted } = recordingLedger();

            await new RollingWindowLimiter(ledger, { usda: { requests: 15, windowSeconds: 60 } }).admit('usda', lane);

            expect(admitted).toEqual([{ source: 'usda', lane, ceiling: 13, laneCeiling, windowSeconds: 60 }]);
        },
    );

    // Owner, 2026-10-02: the worker's own calls stay under its share, and every lane's calls together stay under the
    // ceiling, so live use pauses bulk work only once the whole window is spent.
    describe('the worker spends at most its share, counted over its own calls (owner, 2026-10-02)', () => {
        it.each([
            { name: 'admits the worker under its share', window: [[599, 'worker']], lane: 'worker', admitted: true },
            { name: 'refuses the worker at its share', window: [[600, 'worker']], lane: 'worker', admitted: false },
            {
                name: 'does not count live calls toward the worker’s share',
                window: [
                    [300, 'worker'],
                    [300, 'interactive'],
                ],
                lane: 'worker',
                admitted: true,
            },
            {
                name: 'admits the worker while live calls alone pass its share, the window under the ceiling',
                window: [
                    [599, 'worker'],
                    [300, 'interactive'],
                ],
                lane: 'worker',
                admitted: true,
            },
            {
                name: 'refuses the worker under its share once every lane’s calls reach the ceiling',
                window: [
                    [300, 'worker'],
                    [600, 'interactive'],
                ],
                lane: 'worker',
                admitted: false,
            },
            {
                name: 'admits a live call while the worker is at its share',
                window: [[600, 'worker']],
                lane: 'interactive',
                admitted: true,
            },
            {
                name: 'admits a live call up to the full window',
                window: [
                    [600, 'worker'],
                    [299, 'interactive'],
                ],
                lane: 'interactive',
                admitted: true,
            },
            {
                name: 'refuses a live call at the ceiling',
                window: [
                    [600, 'worker'],
                    [300, 'interactive'],
                ],
                lane: 'interactive',
                admitted: false,
            },
        ] as const)('$name', async ({ window, lane, admitted }) => {
            const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
            const calls = window.flatMap(([count, spentBy]) => callsOn(count, spentBy, clock));

            const admission = await new RollingWindowLimiter(countingLedger(calls, clock), {}).admit('usda', lane);

            expect(admission.admitted).toBe(admitted);
        });

        it('admits the worker again once the window rolls past the calls that filled its share', async () => {
            const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
            const calls = callsOn(600, 'worker', clock);
            const limiter = new RollingWindowLimiter(countingLedger(calls, clock), {});

            await expect(limiter.admit('usda', 'worker')).resolves.toMatchObject({
                admitted: false,
                reason: 'ceiling',
            });

            clock.now += HOUR_SECONDS * 1000;
            await expect(limiter.admit('usda', 'worker')).resolves.toEqual({ admitted: true });
            expect(calls.filter((call) => call.lane === 'worker')).toHaveLength(601);
        });
    });

    it('refuses an override that raises a limit, whoever constructs it', () => {
        const { ledger } = recordingLedger();

        expect(() => new RollingWindowLimiter(ledger, { usda: { requests: 2000, windowSeconds: 3600 } })).toThrow(
            /usda/u,
        );
    });

    // On the live lane, whose ceiling is the plain 90% rule: this case is about where the override comes from.
    it('reads its overrides from FOOD_SOURCE_LIMIT_OVERRIDES when given none', async () => {
        vi.stubEnv('FOOD_SOURCE_LIMIT_OVERRIDES', '{"usda":{"requests":16,"windowSeconds":60}}');
        const { ledger, admitted } = recordingLedger();

        await new RollingWindowLimiter(ledger).admit('usda', 'interactive');

        expect(admitted[0]).toMatchObject({ ceiling: 14, windowSeconds: 60 });
    });

    it('refuses a raising FOOD_SOURCE_LIMIT_OVERRIDES at construction, naming the setting', () => {
        vi.stubEnv('FOOD_SOURCE_LIMIT_OVERRIDES', '{"usda":{"requests":5000,"windowSeconds":3600}}');

        expect(() => new RollingWindowLimiter(recordingLedger().ledger)).toThrow(/FOOD_SOURCE_LIMIT_OVERRIDES/u);
    });

    // USDA is the one callable source (owner, 2026-10-01), so the longest declared window is its hour.
    it('prunes to the longest declared window, which an override can never lengthen', async () => {
        const { ledger, pruned } = recordingLedger();

        await new RollingWindowLimiter(ledger, { usda: { requests: 15, windowSeconds: 60 } }).pruneAged();

        expect(PRUNE_HORIZON_SECONDS).toBe(3600);
        expect(pruned).toEqual([3600]);
    });

    // The wire contract names `pauseThreshold` and `paused` as the WORKER's pause (`adminMetrics.schema.ts`). Whether
    // the worker is paused is the ledger's answer, read by the SQL admission inserts under, so its truth table is the
    // LOCAL e2e tier's (`tests/e2e/sourceAdmission.e2e.test.ts`, "reads a window paused exactly when…"). Here: the
    // limiter asks about the worker's own admission, and reports what the ledger answers.
    describe('status (the admin metrics read)', () => {
        it.each([false, true])(
            'reports the counts, the limit, the worker’s share and the ledger’s paused (%s)',
            async (paused) => {
                const { ledger, statusAsked } = recordingLedger({ byLane: { interactive: 400, worker: 300 }, paused });

                await expect(new RollingWindowLimiter(ledger, {}).status('usda')).resolves.toEqual({
                    windowCount: 700,
                    workerWindowCount: 300,
                    hardCap: 1000,
                    pauseThreshold: 600,
                    paused,
                });
                expect(statusAsked).toEqual([
                    { source: 'usda', lane: 'worker', ceiling: 900, laneCeiling: 600, windowSeconds: 3600 },
                ]);
            },
        );

        it('reports the overridden limit, and asks about the worker’s admission under it', async () => {
            const { ledger, statusAsked } = recordingLedger();

            await expect(
                new RollingWindowLimiter(ledger, { usda: { requests: 15, windowSeconds: 60 } }).status('usda'),
            ).resolves.toMatchObject({ hardCap: 15, pauseThreshold: 8 });
            expect(statusAsked).toEqual([
                { source: 'usda', lane: 'worker', ceiling: 13, laneCeiling: 8, windowSeconds: 60 },
            ]);
        });
    });

    it('reports the wired sources only', () => {
        expect(new RollingWindowLimiter(recordingLedger().ledger, {}).knownSources()).toEqual(['usda']);
    });
});
