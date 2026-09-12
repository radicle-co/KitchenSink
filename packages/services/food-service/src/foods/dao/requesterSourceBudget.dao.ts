/**
 * `RequesterSourceBudgetDao` — each requester's hourly share of the source window (plan 002, the cap owed before S6;
 * migration `0020`). PATCH resolve and the remote pick charge it before their handlers call the source, so every API
 * task counts one requester's calls in one place, and refund the calls the request did not make once it ends. A remote
 * search the cache could not answer charges it at admission (`RequesterWindowAdmission.ts`).
 *
 * A charge is one conditional upsert. The conflict takes the requester's row lock, so a requester's concurrent charges
 * run one at a time, and `ON CONFLICT … WHERE` re-reads the row under that lock: of N simultaneous charges, only those
 * the limit can hold are written. Zero rows returned is the refusal. The window opens at the first charge and a charge
 * after its end opens the next, and every instant comes from the database clock, so no task's clock decides a window.
 *
 * A refund is one `UPDATE` keyed on the requester AND the window the charge landed in, so it takes the same row lock
 * and loses no concurrent charge, gives nothing back to a later window, and never recreates a row the erasure sweep
 * removed. Settling each charge once is the caller's; a second refund of the same calls that would take the window
 * below nothing breaks the table's `CHECK` and fails rather than matching nothing.
 *
 * The charge runs in front of a waiting cook, so it bounds itself: every statement of its transaction, a wait for the
 * row lock included, ends by {@link BUDGET_STATEMENT_TIMEOUT_MS}. A held lock and a slow server fail the same way, and
 * the interceptor answers both as busy.
 *
 * @pattern Repository — the one writer of `requester_source_budget`
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { localTimeout } from '../../database/localTimeout.js';

/** The longest any one statement of a charge may run, its row-lock wait included, in milliseconds. */
export const BUDGET_STATEMENT_TIMEOUT_MS = 500;

const STATEMENT_TIMEOUT = localTimeout('statement_timeout', BUDGET_STATEMENT_TIMEOUT_MS);

/** One charge against a requester's budget. */
export interface BudgetChargeInput {
    /** The requester key `resolveRequesterId` gives: an app-user ULID, or a `svc_*` id. */
    readonly requesterId: string;
    /** The source calls the request can make: a whole number from 1 to {@link BudgetChargeInput.limit}. */
    readonly cost: number;
    /** The most calls one window may hold. */
    readonly limit: number;
    /** How long a window lasts from the charge that opens it, in whole seconds. */
    readonly windowSeconds: number;
}

/**
 * A window's end exactly as the database holds it, to the microsecond, as ISO 8601 in UTC, which `::timestamptz` reads
 * back whatever the session's DateStyle. A JS `Date` would round it to the millisecond and match no row. Only a charge
 * makes one.
 */
export type BudgetWindow = string & { readonly __brand: 'BudgetWindow' };

/** What an admitted charge recorded: who, how many calls, and the window they landed in. */
export interface BudgetReceipt {
    readonly requesterId: string;
    readonly cost: number;
    readonly window: BudgetWindow;
}

/** Admitted (and recorded, with its receipt), or refused with the whole seconds until the requester's window ends. */
export type BudgetCharge =
    | { readonly admitted: true; readonly receipt: BudgetReceipt }
    | { readonly admitted: false; readonly retryAfterSeconds: number };

/** A refund gave the calls back, or found no row for the window it was charged in (rolled over, or erased). */
export type BudgetRefund = 'refunded' | 'windowGone';

/**
 * Check a charge can be recorded as asked. Pure.
 *
 * The upsert's `WHERE` guards only the update path, so a first charge larger than the limit would be inserted whole
 * and admitted. That and the other bad inputs are a caller's bug, not a refusal.
 *
 * @param input - The charge.
 * @returns The same charge.
 * @throws {RangeError} naming the field that cannot be recorded.
 */
export function checkedBudgetCharge(input: BudgetChargeInput): BudgetChargeInput {
    if (input.requesterId.length === 0) {
        throw new RangeError('A source budget charge needs a requester.');
    }

    if (!Number.isInteger(input.limit) || input.limit < 1) {
        throw new RangeError(`A source budget limit must be a whole number of at least 1, got ${input.limit}.`);
    }

    if (!Number.isInteger(input.cost) || input.cost < 1 || input.cost > input.limit) {
        throw new RangeError(
            `A source budget charge must be a whole number from 1 to ${input.limit}, got ${input.cost}.`,
        );
    }

    if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1) {
        throw new RangeError(
            `A source budget window must be a whole number of seconds of at least 1, got ${input.windowSeconds}.`,
        );
    }

    return input;
}

export class RequesterSourceBudgetDao {
    /** @param db - The food-schema Drizzle client. */
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Charge `cost` source calls to a requester, admitting the charge only when its window can hold all of it.
     *
     * @param input - The requester, the cost, the limit and the window.
     * @returns Admitted (and recorded), or refused with the seconds until the window ends (at least 1).
     * @throws {RangeError} from {@link checkedBudgetCharge}, before any SQL.
     * @throws Any database failure unchanged, including a statement cancelled by `statement_timeout` (57014).
     * @sideEffect Upserts `requester_source_budget`.
     */
    public async charge(input: BudgetChargeInput): Promise<BudgetCharge> {
        const { requesterId, cost, limit, windowSeconds } = checkedBudgetCharge(input);

        // ⛔ READ COMMITTED is named, never inherited from the session: under REPEATABLE READ a concurrent charge to the
        // same row fails with a serialization error instead of being re-read under the lock.
        return this.db.transaction(
            async (tx): Promise<BudgetCharge> => {
                await tx.execute(STATEMENT_TIMEOUT);

                const charged = await tx.execute<{ window_end: BudgetWindow }>(sql`
                    INSERT INTO requester_source_budget AS budget (requester_id, spent, window_ends_at)
                    VALUES (
                        ${requesterId},
                        ${cost}::int,
                        statement_timestamp() + make_interval(secs => ${windowSeconds}::int)
                    )
                    ON CONFLICT (requester_id) DO UPDATE
                       SET spent = CASE WHEN budget.window_ends_at <= statement_timestamp()
                                        THEN excluded.spent
                                        ELSE budget.spent + excluded.spent END,
                           window_ends_at = CASE WHEN budget.window_ends_at <= statement_timestamp()
                                                 THEN excluded.window_ends_at
                                                 ELSE budget.window_ends_at END
                     WHERE budget.window_ends_at <= statement_timestamp()
                        OR budget.spent + excluded.spent <= ${limit}::int
                    RETURNING to_char(budget.window_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                              AS window_end
                `);
                const recorded = charged.rows[0];

                if (recorded !== undefined) {
                    return { admitted: true, receipt: { requesterId, cost, window: recorded.window_end } };
                }

                const window = await tx.execute<{ seconds: number }>(sql`
                    SELECT greatest(1, ceil(extract(epoch FROM window_ends_at - statement_timestamp())))::int AS seconds
                      FROM requester_source_budget
                     WHERE requester_id = ${requesterId}
                `);

                // No row means the erasure sweep removed it between the two statements; the next charge opens a window.
                return { admitted: false, retryAfterSeconds: window.rows[0]?.seconds ?? 1 };
            },
            { isolationLevel: 'read committed' },
        );
    }

    /**
     * Give back `calls` of a charge's calls to the window the charge landed in.
     *
     * @param receipt - What the charge recorded.
     * @param calls - The calls the request did not make: a whole number from 1 to the receipt's cost.
     * @returns `refunded`, or `windowGone` when that window has ended and been replaced, or the row was erased.
     * @throws {RangeError} when `calls` is outside 1 to the receipt's cost, before any SQL.
     * @throws Any database failure unchanged: a statement timeout, or the `CHECK` a second refund of the same calls breaks.
     * @sideEffect Updates `requester_source_budget`.
     */
    public async refund(receipt: BudgetReceipt, calls: number): Promise<BudgetRefund> {
        if (!Number.isInteger(calls) || calls < 1 || calls > receipt.cost) {
            throw new RangeError(
                `A source budget refund must be a whole number from 1 to ${receipt.cost}, got ${calls}.`,
            );
        }

        return this.db.transaction(
            async (tx): Promise<BudgetRefund> => {
                await tx.execute(STATEMENT_TIMEOUT);

                const refunded = await tx.execute(sql`
                    UPDATE requester_source_budget
                       SET spent = spent - ${calls}::int
                     WHERE requester_id = ${receipt.requesterId}
                       AND window_ends_at = ${receipt.window}::timestamptz
                `);

                return (refunded.rowCount ?? 0) === 1 ? 'refunded' : 'windowGone';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
