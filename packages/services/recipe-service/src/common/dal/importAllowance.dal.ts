/**
 * `ImportAllowanceDal` — the SQL behind the daily import allowance (004 FR-022): the ledger of spent units, and the one
 * admission that reads it, decides, and spends under a per-user lock.
 *
 * @pattern Repository — over `import_allowance_events`, taking the CALLER'S transaction so the unit is spent in the same
 *   transaction as the thing it pays for
 *
 * ## The four rules that live here
 *
 *  1. **The lock is the first statement.** `pg_advisory_xact_lock(class, hashtext(user_id))` serialises every admission
 *     for one user and none across users. Without it two concurrent pastes both read 199 units, both decide "fits", and
 *     both spend: the allowance is a read-then-write, so it needs the lock, not a retry. It is a transaction lock, so it is
 *     released by the commit or rollback of the CALLER's transaction — which is why this takes a `tx` rather than opening
 *     its own: the unit and the job it pays for commit or vanish together.
 *  2. **One clock, read AFTER the lock.** `clock_timestamp()`, not `now()` (the transaction's start, stale by however long
 *     the lock wait took) and not the application clock (another machine's). The same reading decides and is written as
 *     `created_at`, so a decision and its record agree.
 *  3. **The policy decides, the SQL fetches.** This module reads the user's events newer than the window edge and hands
 *     them to {@link evaluateImportAllowance}; it never re-states the 200 or the 24 h.
 *  4. **Expired units are deleted under the same lock.** An event past the window can never count again, so keeping it is
 *     only storage and personal data held for no purpose. The delete uses the policy's own edge.
 */
import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';

import type { Writer } from '../../database/unitOfWork.js';
import { importAllowanceEvents, type ImportAllowanceChannel } from '../../database/schema/importAllowanceEvents.js';
import {
    evaluateImportAllowance,
    importAllowanceWindowStart,
    type ImportAllowanceTier,
} from '../importAllowancePolicy.js';

/** What a caller asks the allowance for. */
export interface AdmitRequest {
    /** What is spending the unit. */
    readonly channel: ImportAllowanceChannel;
    /** How many units: a positive integer within the daily limit (the policy throws otherwise). */
    readonly units: number;
    /** The caller's tier. */
    readonly tier: ImportAllowanceTier;
}

/** The outcome of an admission. A refusal wrote nothing. */
export type AdmitOutcome = { readonly kind: 'admitted' } | { readonly kind: 'refused'; readonly resetsAt: Date };

export class ImportAllowanceDal {
    /**
     * Spend `request.units` of `userId`'s allowance, or learn when they could.
     *
     * Call it as the FIRST write of the transaction the unit pays for, with that transaction's handle.
     *
     * @param tx - The open transaction (the lock lives and dies with it).
     * @param userId - The verified app-user ULID, never a request field.
     * @param request - The channel, the units and the tier.
     * @returns `admitted` (the unit is on the ledger inside `tx`), or `refused` with the instant the allowance reopens.
     * @throws {RangeError} when the units are not a positive integer within the limit (a caller defect).
     * @sideEffect Takes a transaction-scoped advisory lock; deletes the user's expired events; inserts one event.
     */
    public async admit(tx: Writer, userId: string, request: AdmitRequest): Promise<AdmitOutcome> {
        await tx.execute(
            sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.recipeImportAllowance}, hashtext(${userId}))`,
        );

        const now = await this.readClock(tx);
        const windowStart = importAllowanceWindowStart(now);

        await tx
            .delete(importAllowanceEvents)
            .where(and(eq(importAllowanceEvents.userId, userId), lte(importAllowanceEvents.createdAt, windowStart)));

        const windowEvents = await tx
            .select({ units: importAllowanceEvents.units, createdAt: importAllowanceEvents.createdAt })
            .from(importAllowanceEvents)
            .where(and(eq(importAllowanceEvents.userId, userId), gt(importAllowanceEvents.createdAt, windowStart)))
            .orderBy(asc(importAllowanceEvents.createdAt));

        const decision = evaluateImportAllowance({
            tier: request.tier,
            windowEvents,
            requestedUnits: request.units,
            now,
        });

        if (decision.kind === 'refuse') {
            return { kind: 'refused', resetsAt: decision.resetsAt };
        }

        await tx
            .insert(importAllowanceEvents)
            .values({ userId, channel: request.channel, units: request.units, createdAt: now });

        return { kind: 'admitted' };
    }

    /**
     * The database's wall clock, to the millisecond a JS `Date` can hold.
     *
     * Read as an integer of epoch milliseconds rather than as a timestamp: the driver's timestamp text is not something
     * `new Date()` is guaranteed to parse, and a bigint of milliseconds is exact.
     *
     * @param tx - The open transaction.
     * @returns The instant. @sideEffect Reads the clock.
     */
    private async readClock(tx: Writer): Promise<Date> {
        const [row] = await tx
            .select({
                epochMs: sql<number>`floor(extract(epoch from clock_timestamp()) * 1000)::bigint`.mapWith(Number),
            })
            .from(sql`(SELECT 1) AS database_clock`);

        if (row === undefined) {
            throw new Error('the database clock read returned no row');
        }

        return new Date(row.epochMs);
    }
}
