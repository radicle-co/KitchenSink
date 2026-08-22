/**
 * THE RESERVE-THEN-SETTLE LEDGER — the impure half of ADR-0024's spend ceiling.
 *
 * DESIGN PATTERN: **Reservation ledger** (a two-phase charge/settle with a compensating refund) behind a
 * narrow **Port**, and the impure half of the decide/evaluate split whose pure half is
 * `@kitchensink/recipe-core/spend/spend-arithmetic`. Every judgement — the rate table, the worst case, the
 * headroom, the period key, the settle delta — was made before this module is called. What is left here is
 * two SQL statements and the reading of their results, which is exactly as much as should be untestable
 * without a database.
 *
 * ⚠️ It is NOT the Command pattern and should not be labelled one. A Command is a reified, re-executable
 * request; the whole point of {@link SpendLedger.settle} is that it must **never** be re-executed.
 *
 * ## ⛔ THE TWO STATEMENTS, and why each is shaped the way it is
 *
 * **RESERVE** is one conditional write with NO PRIOR READ. `INSERT … ON CONFLICT DO UPDATE … WHERE` takes a
 * row lock, so concurrent callers serialize on the one row and each sees the latest value — which is why the
 * ceiling holds under ARBITRARY concurrency and does not depend on `reservedConcurrency = 1`. **Zero rows
 * returned IS the budget denial**: the row exists and the `WHERE` failed. There is no separate check to race
 * against, and no read whose answer could be stale by the time the write lands.
 *
 * `$headroom` already has the worst case subtracted from the ceiling, so a row sitting exactly at the headroom
 * may take one more charge and land exactly ON the ceiling — never above it. ⛔ Do not "simplify" the
 * comparison to the ceiling itself to make the SQL read more naturally; that edit is what would create real
 * overshoot.
 *
 * ## ⛔ THE `WHERE $headroom >= 0` ON THE INSERT IS A CORRECTION TO ADR-0024's PUBLISHED SQL — DO NOT REMOVE IT
 *
 * The ADR writes the reserve as `INSERT … VALUES … ON CONFLICT DO UPDATE … WHERE reserved_micros <=
 * $headroom`. That conditional applies to the **UPDATE branch only**. On the FIRST reservation of a period
 * there is no conflicting row, so the INSERT proceeds unguarded — and a worst case that exceeds the ENTIRE
 * ceiling is admitted, breaching the ADR's own "reserved spend never exceeds the ceiling" by up to one call,
 * once per period. It is reachable in exactly the situation the ceiling exists for: a ceiling lowered
 * mid-incident below one call's cost, or a `maxTokens` raised above what the budget can carry.
 *
 * `INSERT … SELECT … WHERE $headroom >= 0` closes it, and closes it symmetrically rather than by adding a
 * second rule: because `headroom = ceiling - worst`, `$headroom >= 0` is exactly `0 <= $headroom` — i.e. the
 * same predicate the UPDATE branch applies, evaluated against the absent row's implicit zero. One invariant,
 * both branches. ⚠️ Found by the integration tier; the unit tier cannot see it, because a mocked `execute`
 * returns whatever it was told to. Flagged back to ADR-0024 §2.
 *
 * **SETTLE** refunds the difference. It is fire-once, and the `verification_spend_reserved_nonnegative` CHECK
 * in migration 0022 is what converts a duplicate settle from a silent under-count into a loud error:
 * `reserved_micros + $delta` is not idempotent with a negative delta, so a settle that runs twice refunds most
 * of the reservation twice. Neither statement retries — in-process or otherwise. The QUEUE retries, and each
 * queue attempt takes its own reservation.
 *
 * ## ⛔ FAILING CLOSED IS NOT THE SAME AS RESOLVING THE LINE
 *
 * Both methods throw on a database failure, and the handler must treat that as TRANSIENT: the message returns
 * to the queue under layer 0's `maxReceiveCount` + DLQ. It must NOT terminate the line as `unresolved`.
 * `unresolved` means *verified and disagreed* — withheld and surfaced for correction — and U11 ranks a wrong
 * DISAGREE as the unacceptable error direction. Resolving billing denials that way would manufacture that
 * outcome in bulk, for reasons that have nothing to do with the line's quality, and invite the user to correct
 * something we simply declined to check.
 */
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PricedReservation } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { settleDeltaMicros } from '@kitchensink/recipe-core/spend/spend-arithmetic';

/**
 * The one stage whose ceiling is ENFORCED (ADR-0024 §3, owner ruling 2026-08-21).
 *
 * Exported so the guard test and the stack read the same constant the worker does.
 */
export const SPEND_GATED_STAGE = 'prod';

/**
 * Raised when the spend counter could not be read or written. Matching guard: {@link isSpendLedgerError}.
 *
 * ⛔ Its own type, distinct from every other failure, because it means something specific to the handler:
 * fail CLOSED and RETRY. A line is not resolved on this; a message is returned to the queue.
 */
export class SpendLedgerError extends Error {
    /** Which statement failed — `reserve` or `settle`. They have different consequences. */
    public readonly phase: 'reserve' | 'settle';

    public constructor(phase: 'reserve' | 'settle', cause: unknown) {
        super(
            phase === 'reserve'
                ? 'verification spend counter is unreadable; the call was not made'
                : 'verification spend settle failed; the reservation stands unrefunded',
        );
        this.name = 'SpendLedgerError';
        this.phase = phase;
        this.cause = cause;
        Object.setPrototypeOf(this, SpendLedgerError.prototype);
    }
}

/** Type guard for {@link SpendLedgerError}. */
export function isSpendLedgerError(error: unknown): error is SpendLedgerError {
    return error instanceof SpendLedgerError;
}

/** What a reservation attempt concluded. */
export type ReserveOutcome =
    | {
          readonly kind: 'reserved';
          /** The period's total AFTER this charge — the value the EMF dollar metric reports. */
          readonly reservedMicros: number;
      }
    | {
          /** The ceiling would have been exceeded. TRANSIENT: retry, do not resolve the line. */
          readonly kind: 'denied';
          readonly period: string;
      };

/** Everything a settlement needs, with the period carried from the plan rather than recomputed. */
export interface Settlement {
    /** The plan the reservation was taken under. ⛔ Its `period` is the one the settlement uses. */
    readonly plan: PricedReservation;
    /** What the call actually cost. ZERO for any outcome with no billed response. */
    readonly actualMicros: number;
}

/** The counter, as the handler sees it. */
export interface SpendLedger {
    /**
     * Charge the worst case, refusing if it would breach the ceiling.
     *
     * @param plan - The priced plan, carrying the period, the worst case and the headroom.
     * @returns Whether the charge was taken.
     * @throws {SpendLedgerError} On any database failure. Fail CLOSED — the call must not be made.
     * @sideEffect One conditional `INSERT … ON CONFLICT DO UPDATE` against `verification_spend`.
     */
    reserve(plan: PricedReservation): Promise<ReserveOutcome>;

    /**
     * Refund the unused reservation and record the call.
     *
     * ⛔ FIRE-ONCE. Never call this twice for one reservation, and never retry it — see the file docstring.
     *
     * @param settlement - The plan and what the call actually cost.
     * @throws {SpendLedgerError} On any database failure. The caller METERS this and carries on; the standing
     *   reservation over-counts, which is the safe direction.
     * @sideEffect One `UPDATE` against `verification_spend`.
     */
    settle(settlement: Settlement): Promise<void>;
}

/**
 * Whether this stage enforces the ceiling.
 *
 * ⛔ PROD ONLY (ADR-0024 §3). ADR-0006 gives each PR its own LOGICAL database on the shared sandbox instance,
 * and Postgres cannot read across logical databases — so a shared non-prod counter would need either a second
 * connection to the base database or a store outside both VPCs, and neither is worth the machinery.
 *
 * ⚠️ An unrecognised stage is left UNGATED, and the asymmetry is deliberate. Gating an unknown stage would
 * deny every call in a stage whose counter row may not exist, turning a naming mistake into a total outage of
 * verification; leaving it ungated bounds the damage at layers 0–2's ~$88/month/stage — the exposure every
 * non-prod stage already carries by ruling. Exact equality on the one stage that matters.
 *
 * @param stage - The deploy stage.
 * @returns Whether the ceiling is enforced here. Pure.
 */
export function isSpendGated(stage: string): boolean {
    return stage === SPEND_GATED_STAGE;
}

/**
 * Parse the `bigint` a driver hands back as a string.
 *
 * `node-postgres` returns int8 as a string rather than a number, to avoid silently losing precision above
 * 2^53. Reading it as a number without parsing yields `NaN` in arithmetic and string concatenation in
 * addition — either way the value the alarm watches becomes nonsense while the gate appears to work.
 *
 * @param value - The driver's column value.
 * @returns The number, or `0` when it is unreadable. Pure.
 */
function toMicros(value: unknown): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Build the ledger over a database handle.
 *
 * @param db - The schema-less recipe database handle (`getRecipeDb()`).
 * @returns The ledger.
 * @sideEffect The returned methods write to `verification_spend`.
 */
export function createSpendLedger(db: NodePgDatabase<Record<string, never>>): SpendLedger {
    return {
        async reserve(plan: PricedReservation): Promise<ReserveOutcome> {
            let result: { rows: { reserved_micros: unknown }[] };

            try {
                result = await db.execute<{ reserved_micros: unknown }>(sql`
                    INSERT INTO verification_spend (period, reserved_micros)
                    SELECT ${plan.period}, ${plan.worstMicros}
                     WHERE ${plan.headroomMicros} >= 0
                    ON CONFLICT (period) DO UPDATE
                       SET reserved_micros = verification_spend.reserved_micros + ${plan.worstMicros},
                           updated_at      = now()
                     WHERE verification_spend.reserved_micros <= ${plan.headroomMicros}
                    RETURNING reserved_micros
                `);
            } catch (cause) {
                // ⛔ Fail CLOSED. No retry here — the queue owns retrying, and a retry in-process could take a
                // SECOND worst-case charge if the first statement committed and only the reply was lost.
                throw new SpendLedgerError('reserve', cause);
            }

            const [row] = result.rows;

            // ⛔ Zero rows IS the denial. The row exists and the WHERE failed; there is no error to inspect and
            // no second query to run.
            return row === undefined
                ? { kind: 'denied', period: plan.period }
                : { kind: 'reserved', reservedMicros: toMicros(row.reserved_micros) };
        },

        async settle({ plan, actualMicros }: Settlement): Promise<void> {
            const delta = settleDeltaMicros(actualMicros, plan.worstMicros);

            try {
                await db.execute(sql`
                    UPDATE verification_spend
                       SET reserved_micros = reserved_micros + ${delta},
                           settled_micros  = settled_micros  + ${actualMicros},
                           calls           = calls + 1,
                           updated_at      = now()
                     WHERE period = ${plan.period}
                `);
            } catch (cause) {
                // ⛔ NOT RETRIED, even here. An ambiguous failure may mean the UPDATE committed and the reply
                // was lost; re-running it would double-refund. A standing reservation over-counts, which is
                // ADR-0024's accepted bias — so this is reported and abandoned.
                throw new SpendLedgerError('settle', cause);
            }
        },
    };
}
