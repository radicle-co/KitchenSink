/**
 * The admission a remote search miss passes (ADR-0055 point 6, review finding 5): the cook's hourly source budget,
 * then the shared window, with the cook's charge given back when the window refuses or fails. A refusal is a source
 * frame, never the whole answer, so this returns refusals and only our own store's failure throws.
 */
import { describe, expect, it } from 'vitest';

import type {
    BudgetCharge,
    BudgetChargeInput,
    BudgetReceipt,
    BudgetWindow,
} from '../../../foods/dao/requesterSourceBudget.dao.js';
import type { Admission, AdmissionPolicy } from '../../../sources/transport/transportPorts.js';
import { RequesterWindowAdmission } from '../RequesterWindowAdmission.js';
import { REQUESTER_SOURCE_BUDGET_PER_HOUR, REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS } from '../throttle.config.js';

/** 2026-10-02 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 2, 5, 0, 0);
const REQUESTER = '01JREQUESTER0000000000000A';
const RECEIPT: BudgetReceipt = {
    requesterId: REQUESTER,
    cost: 1,
    window: '2026-10-02T05:30:00.000000Z' as BudgetWindow,
};

/** What one case's fakes saw, in order. */
interface Harness {
    readonly admission: RequesterWindowAdmission;
    readonly events: string[];
    readonly charges: BudgetChargeInput[];
    readonly refunds: { receipt: BudgetReceipt; calls: number }[];
    readonly errors: string[];
}

/**
 * The admission over recording fakes.
 *
 * @param options - What the budget and the window answer.
 * @returns The harness.
 */
function makeHarness(options: {
    readonly charge?: BudgetCharge | Error;
    readonly window?: Admission | Error;
    readonly refundFails?: Error;
}): Harness {
    const events: string[] = [];
    const charges: BudgetChargeInput[] = [];
    const refunds: Harness['refunds'] = [];
    const errors: string[] = [];
    const window: AdmissionPolicy = {
        admit: async (source, lane) => {
            events.push(`window:${source}:${lane}`);

            if (options.window instanceof Error) {
                throw options.window;
            }

            return options.window ?? { admitted: true };
        },
    };

    return {
        events,
        charges,
        refunds,
        errors,
        admission: new RequesterWindowAdmission({
            budget: {
                charge: async (input) => {
                    events.push('charge');
                    charges.push(input);

                    if (options.charge instanceof Error) {
                        throw options.charge;
                    }

                    return options.charge ?? { admitted: true, receipt: RECEIPT };
                },
                refund: async (receipt, calls) => {
                    events.push('refund');

                    if (options.refundFails !== undefined) {
                        throw options.refundFails;
                    }

                    refunds.push({ receipt, calls });

                    return 'refunded';
                },
            },
            requesterId: REQUESTER,
            window,
            now: () => NOW,
            logger: { error: (message) => errors.push(message) },
        }),
    };
}

describe('RequesterWindowAdmission', () => {
    it('charges the cook one call, against the hourly budget, before the shared window is asked', async () => {
        const harness = makeHarness({});

        await expect(harness.admission.admit('usda', 'interactive')).resolves.toEqual({ admitted: true });
        expect(harness.events).toEqual(['charge', 'window:usda:interactive']);
        expect(harness.charges).toEqual([
            {
                requesterId: REQUESTER,
                cost: 1,
                limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
                windowSeconds: REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
            },
        ]);
        expect(harness.refunds).toEqual([]);
    });

    it('refuses as the cook’s own limit, until the budget’s window ends, and never spends the shared window', async () => {
        const harness = makeHarness({ charge: { admitted: false, retryAfterSeconds: 1_200 } });

        await expect(harness.admission.admit('usda', 'interactive')).resolves.toEqual({
            admitted: false,
            reason: 'requesterLimit',
            retryAt: new Date(NOW + 1_200_000).toISOString(),
        });
        expect(harness.events).toEqual(['charge']);
    });

    it.each<Admission>([
        { admitted: false, reason: 'ceiling', retryAt: '2026-10-02T05:20:00.000Z' },
        { admitted: false, reason: 'blocked', retryAt: '2026-10-02T06:00:00.000Z' },
        { admitted: false, reason: 'contended', retryAt: '2026-10-02T05:00:01.000Z' },
    ])(
        'gives the cook’s call back when the window refuses ($reason), and answers the window’s refusal',
        async (refusal) => {
            const harness = makeHarness({ window: refusal });

            await expect(harness.admission.admit('usda', 'interactive')).resolves.toEqual(refusal);
            expect(harness.refunds).toEqual([{ receipt: RECEIPT, calls: 1 }]);
        },
    );

    it('gives the cook’s call back when the window itself fails, and throws that failure unchanged', async () => {
        const failure = new Error('ledger down');
        const harness = makeHarness({ window: failure });

        await expect(harness.admission.admit('usda', 'interactive')).rejects.toBe(failure);
        expect(harness.refunds).toEqual([{ receipt: RECEIPT, calls: 1 }]);
    });

    it('throws when the budget cannot be read, and asks the window nothing', async () => {
        const failure = new Error('budget down');
        const harness = makeHarness({ charge: failure });

        await expect(harness.admission.admit('usda', 'interactive')).rejects.toBe(failure);
        expect(harness.events).toEqual(['charge']);
    });

    it('keeps the refusal when the refund fails, and logs it: an over-counted budget is the safe direction', async () => {
        const refusal: Admission = { admitted: false, reason: 'ceiling', retryAt: '2026-10-02T05:20:00.000Z' };
        const harness = makeHarness({ window: refusal, refundFails: new Error('budget down') });

        await expect(harness.admission.admit('usda', 'interactive')).resolves.toEqual(refusal);
        expect(harness.errors).toEqual(['source-budget-refund-failed']);
    });
});
