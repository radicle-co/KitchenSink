/**
 * Unit tests for {@link RollingWindowLimiter}, the admission Policy (ADR-0053 §1, §2, §6).
 *
 * The limiter reads each source's limit from the register, applies a lowering override, and asks the ledger to admit
 * against ⌊0.9 × requests⌋ over that source's own window. The ledger's atomicity is proven on a real Postgres in
 * `tests/e2e/sourceAdmission.e2e.test.ts`; here the ledger is a recording double, so these pin only what the limiter
 * itself decides.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdmitInput, WindowStatus } from '../../foods/dao/sourceCallLog.dao.js';
import { PRUNE_HORIZON_SECONDS, RollingWindowLimiter, type WindowLedger } from '../RollingWindowLimiter.js';
import { apiAccessOf } from '../sourceRegister.js';

/** A ledger double that admits, records what it was asked, and reports a fixed status. */
function recordingLedger(status: WindowStatus = { count: 0, blockedUntil: null }) {
    const admitted: AdmitInput[] = [];
    const pruned: number[] = [];
    const statusAsked: [string, number][] = [];
    const ledger: WindowLedger = {
        admit: async (input) => {
            admitted.push(input);

            return { admitted: true };
        },
        windowStatus: async (source, windowSeconds) => {
            statusAsked.push([source, windowSeconds]);

            return status;
        },
        pruneAged: async (horizonSeconds) => {
            pruned.push(horizonSeconds);

            return 0;
        },
    };

    return { ledger, admitted, pruned, statusAsked };
}

describe('RollingWindowLimiter', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('admits USDA against 90% of its declared hour, on the caller’s lane', async () => {
        const { ledger, admitted } = recordingLedger();

        await new RollingWindowLimiter(ledger, {}).admit('usda', 'interactive');

        expect(admitted).toEqual([{ source: 'usda', lane: 'interactive', ceiling: 900, windowSeconds: 3600 }]);
    });

    it('admits Matvaretabellen against 90% of its declared day', async () => {
        const { ledger, admitted } = recordingLedger();
        const declared = apiAccessOf('matvaretabellen').rateLimit;

        await new RollingWindowLimiter(ledger, {}).admit('matvaretabellen', 'worker');

        expect(admitted).toEqual([
            {
                source: 'matvaretabellen',
                lane: 'worker',
                ceiling: Math.floor((declared.requests * 9) / 10),
                windowSeconds: 86_400,
            },
        ]);
    });

    it('applies a lowering override to its source only', async () => {
        const { ledger, admitted } = recordingLedger();
        const limiter = new RollingWindowLimiter(ledger, { usda: { requests: 15, windowSeconds: 60 } });

        await limiter.admit('usda', 'worker');
        await limiter.admit('matvaretabellen', 'worker');

        expect(admitted.map((input) => [input.source, input.ceiling, input.windowSeconds])).toEqual([
            ['usda', 13, 60],
            ['matvaretabellen', 21, 86_400],
        ]);
    });

    it('refuses an override that raises a limit, whoever constructs it', () => {
        const { ledger } = recordingLedger();

        expect(() => new RollingWindowLimiter(ledger, { usda: { requests: 2000, windowSeconds: 3600 } })).toThrow(
            /usda/u,
        );
    });

    it('reads its overrides from FOOD_SOURCE_LIMIT_OVERRIDES when given none', async () => {
        vi.stubEnv('FOOD_SOURCE_LIMIT_OVERRIDES', '{"usda":{"requests":16,"windowSeconds":60}}');
        const { ledger, admitted } = recordingLedger();

        await new RollingWindowLimiter(ledger).admit('usda', 'worker');

        expect(admitted[0]).toMatchObject({ ceiling: 14, windowSeconds: 60 });
    });

    it('refuses a raising FOOD_SOURCE_LIMIT_OVERRIDES at construction, naming the setting', () => {
        vi.stubEnv('FOOD_SOURCE_LIMIT_OVERRIDES', '{"usda":{"requests":5000,"windowSeconds":3600}}');

        expect(() => new RollingWindowLimiter(recordingLedger().ledger)).toThrow(/FOOD_SOURCE_LIMIT_OVERRIDES/u);
    });

    it('prunes to the longest declared window, which an override can never lengthen', async () => {
        const { ledger, pruned } = recordingLedger();

        await new RollingWindowLimiter(ledger, { usda: { requests: 15, windowSeconds: 60 } }).pruneAged();

        expect(PRUNE_HORIZON_SECONDS).toBe(86_400);
        expect(pruned).toEqual([86_400]);
    });

    describe('status (the admin metrics read)', () => {
        it.each([
            ['under the ceiling, no block', { count: 899, blockedUntil: null }, false],
            ['at the ceiling', { count: 900, blockedUntil: null }, true],
            ['under the ceiling with a live block', { count: 1, blockedUntil: '2026-10-01T07:00:00.000Z' }, true],
        ] as const)('reports %s', async (_, status, paused) => {
            const { ledger, statusAsked } = recordingLedger(status);

            await expect(new RollingWindowLimiter(ledger, {}).status('usda')).resolves.toEqual({
                windowCount: status.count,
                hardCap: 1000,
                pauseThreshold: 900,
                paused,
            });
            expect(statusAsked).toEqual([['usda', 3600]]);
        });

        it('reports the overridden limit', async () => {
            const { ledger } = recordingLedger();

            await expect(
                new RollingWindowLimiter(ledger, { usda: { requests: 15, windowSeconds: 60 } }).status('usda'),
            ).resolves.toMatchObject({ hardCap: 15, pauseThreshold: 13 });
        });
    });

    it('reports the wired sources only', () => {
        expect(new RollingWindowLimiter(recordingLedger().ledger, {}).knownSources()).toEqual(['usda']);
    });
});
