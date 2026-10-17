/**
 * An in-memory requester source budget for the mocked integration tier, keeping the store's contract: a charge is
 * admitted whole or refused whole and returns its receipt, and a refund gives calls back to the requester it charged.
 * The store's real behaviour is `tests/e2e/requesterSourceBudget.e2e.test.ts`.
 *
 * @pattern Fake — a working, in-memory implementation of the store's port
 */
import type {
    BudgetCharge,
    BudgetChargeInput,
    BudgetReceipt,
    BudgetRefund,
    BudgetWindow,
    RequesterSourceBudgetDao,
} from '../../src/foods/dao/requesterSourceBudget.dao.js';

/** The one window every fake receipt names: the fake keeps no clock, so every charge lands in it. */
const FAKE_WINDOW = '2026-10-02T11:00:00.123457Z' as BudgetWindow;

/** One refund the fake received. */
export interface FakeRefund {
    readonly requesterId: string;
    readonly calls: number;
}

/** The store and what it received. */
export interface FakeSourceBudget {
    readonly store: Pick<RequesterSourceBudgetDao, 'charge' | 'refund'>;
    readonly charges: BudgetChargeInput[];
    readonly refunds: FakeRefund[];
    /** The calls a requester has spent, net of refunds. */
    readonly spentBy: (requesterId: string) => number;
}

/**
 * A budget that counts per requester and refuses a charge its limit cannot hold.
 *
 * @param retryAfterSeconds - The wait a refusal names, so a suite can trace the header to the store's answer.
 * @returns The fake.
 */
export function fakeSourceBudget(retryAfterSeconds = 2_917): FakeSourceBudget {
    const spent = new Map<string, number>();
    const charges: BudgetChargeInput[] = [];
    const refunds: FakeRefund[] = [];

    return {
        charges,
        refunds,
        spentBy: (requesterId) => spent.get(requesterId) ?? 0,
        store: {
            charge: async (input: BudgetChargeInput): Promise<BudgetCharge> => {
                charges.push(input);

                const used = spent.get(input.requesterId) ?? 0;

                if (used + input.cost > input.limit) {
                    return { admitted: false, retryAfterSeconds };
                }

                spent.set(input.requesterId, used + input.cost);

                return {
                    admitted: true,
                    receipt: { requesterId: input.requesterId, cost: input.cost, window: FAKE_WINDOW },
                };
            },
            refund: async (receipt: BudgetReceipt, calls: number): Promise<BudgetRefund> => {
                refunds.push({ requesterId: receipt.requesterId, calls });
                spent.set(receipt.requesterId, (spent.get(receipt.requesterId) ?? 0) - calls);

                return 'refunded';
            },
        },
    };
}

/**
 * A budget that admits every charge, whatever its limit, so a suite about another limit observes that limit alone.
 *
 * @returns The store.
 */
export function admittingSourceBudget(): Pick<RequesterSourceBudgetDao, 'charge' | 'refund'> {
    return {
        charge: async (input: BudgetChargeInput): Promise<BudgetCharge> => ({
            admitted: true,
            receipt: { requesterId: input.requesterId, cost: input.cost, window: FAKE_WINDOW },
        }),
        refund: async (): Promise<BudgetRefund> => 'refunded',
    };
}
