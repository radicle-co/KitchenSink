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
 *  3. **The policy decides, the SQL fetches.** This module reads ALL of the user's events inside their channel's window
 *     and hands them, channel and all, to {@link evaluateImportAllowance}; it never re-states a limit or the 24 h, and the
 *     rule "a channel counts only its own rows" lives in the policy alone (ADR-0072 §8).
 *  4. **Expired units are deleted under the same lock.** An event past ITS CHANNEL'S window can never count again, so
 *     keeping it is only storage and personal data held for no purpose. The delete uses the policy's own edge per channel.
 *     It runs on the user's next admission, so a user who never imports again keeps their last day of rows until account
 *     erasure (a bounded, small tail).
 *  5. **Admit what fits.** The policy may admit fewer units than asked (a bulk file larger than the room left). Only the
 *     units admitted are written, as ONE row, so the ledger never holds a unit the caller was not given.
 */
import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';
import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm';

import type { Writer } from '../../database/unitOfWork.js';
import {
    IMPORT_ALLOWANCE_CHANNELS,
    importAllowanceEvents,
    type ImportAllowanceChannel,
} from '../../database/schema/importAllowanceEvents.js';
import {
    describeImportAllowance,
    evaluateImportAllowance,
    importAllowanceWindowStart,
    type ImportAllowanceState,
} from '../importAllowancePolicy.js';

/** What a caller asks the allowance for. */
export interface AdmitRequest {
    /** What is spending the unit. */
    readonly channel: ImportAllowanceChannel;
    /** How many units: a positive integer (the policy throws otherwise). More than the room left is admitted in part. */
    readonly units: number;
}

/**
 * The outcome of an admission. A refusal wrote no ledger row (the user's expired rows may still have been pruned).
 *
 *  - `admitted`: all the requested units were spent.
 *  - `partial`: only `units` (fewer than asked, at least one) were spent; the rest waits until `resetsAt`.
 *  - `refused`: nothing was spent; more room opens at `resetsAt`.
 */
export type AdmitOutcome =
    | { readonly kind: 'admitted'; readonly units: number }
    | { readonly kind: 'partial'; readonly units: number; readonly resetsAt: Date }
    | { readonly kind: 'refused'; readonly resetsAt: Date };

/**
 * Narrow a stored channel to the vocabulary. The CHECK keeps any other value out of the table, so a stranger here is a
 * schema/vocabulary drift, and it is thrown rather than counted against no channel.
 *
 * @param stored - The `channel` column.
 * @returns The same value, typed. Pure.
 */
function channelOf(stored: string): ImportAllowanceChannel {
    const known = IMPORT_ALLOWANCE_CHANNELS.find((channel) => channel === stored);

    if (known === undefined) {
        throw new Error(`the allowance ledger holds an unknown channel: ${stored}`);
    }

    return known;
}

export class ImportAllowanceDal {
    /**
     * Spend `request.units` of `userId`'s allowance, or learn when they could.
     *
     * Call it as the FIRST write of the transaction the unit pays for, with that transaction's handle.
     *
     * @param tx - The open transaction (the lock lives and dies with it).
     * @param userId - The verified app-user ULID, never a request field.
     * @param request - The channel and the units.
     * @returns `admitted` (the units are on the ledger inside `tx`), `partial` (only the units that fit are), or `refused`
     *   with the instant the allowance reopens.
     * @throws {RangeError} when the units are not a positive integer (a caller defect).
     * @sideEffect Takes a transaction-scoped advisory lock; deletes the user's expired events; inserts one event.
     */
    public async admit(tx: Writer, userId: string, request: AdmitRequest): Promise<AdmitOutcome> {
        await tx.execute(
            sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.recipeImportAllowance}, hashtext(${userId}))`,
        );

        const now = await this.readClock(tx);
        // Each channel's rows are cut at THAT channel's edge.
        const outsideWindow = or(
            ...IMPORT_ALLOWANCE_CHANNELS.map((channel) =>
                and(
                    eq(importAllowanceEvents.channel, channel),
                    lte(importAllowanceEvents.createdAt, importAllowanceWindowStart(channel, now)),
                ),
            ),
        );
        const insideWindow = or(
            ...IMPORT_ALLOWANCE_CHANNELS.map((channel) =>
                and(
                    eq(importAllowanceEvents.channel, channel),
                    gt(importAllowanceEvents.createdAt, importAllowanceWindowStart(channel, now)),
                ),
            ),
        );

        await tx.delete(importAllowanceEvents).where(and(eq(importAllowanceEvents.userId, userId), outsideWindow));

        const rows = await tx
            .select({
                channel: importAllowanceEvents.channel,
                units: importAllowanceEvents.units,
                createdAt: importAllowanceEvents.createdAt,
            })
            .from(importAllowanceEvents)
            .where(and(eq(importAllowanceEvents.userId, userId), insideWindow))
            .orderBy(asc(importAllowanceEvents.createdAt));
        const windowEvents = rows.map((row) => ({ ...row, channel: channelOf(row.channel) }));

        const decision = evaluateImportAllowance({
            channel: request.channel,
            windowEvents,
            requestedUnits: request.units,
            now,
        });

        if (decision.kind === 'refuse') {
            return { kind: 'refused', resetsAt: decision.resetsAt };
        }

        await tx
            .insert(importAllowanceEvents)
            .values({ userId, channel: request.channel, units: decision.units, createdAt: now });

        return decision.kind === 'admit'
            ? { kind: 'admitted', units: decision.units }
            : { kind: 'partial', units: decision.units, resetsAt: decision.resetsAt };
    }

    /**
     * What a channel's allowance stands at: the limit, the units spent in the window, and when more opens. A READ: it takes no
     * lock and writes nothing, so the import view can poll it. It reads the same clock, the same window edge and the same rows
     * the admission does, so the view and the next `advance` cannot disagree.
     *
     * @param reader - The client (or a transaction).
     * @param userId - The verified app-user ULID.
     * @param channel - The channel.
     * @returns The state. @sideEffect Reads the database clock and the ledger.
     */
    public async stateOf(
        reader: Pick<Writer, 'select'>,
        userId: string,
        channel: ImportAllowanceChannel,
    ): Promise<ImportAllowanceState> {
        const now = await this.readClock(reader);
        const rows = await reader
            .select({
                channel: importAllowanceEvents.channel,
                units: importAllowanceEvents.units,
                createdAt: importAllowanceEvents.createdAt,
            })
            .from(importAllowanceEvents)
            .where(
                and(
                    eq(importAllowanceEvents.userId, userId),
                    eq(importAllowanceEvents.channel, channel),
                    gt(importAllowanceEvents.createdAt, importAllowanceWindowStart(channel, now)),
                ),
            )
            .orderBy(asc(importAllowanceEvents.createdAt));

        return describeImportAllowance({
            channel,
            windowEvents: rows.map((row) => ({ ...row, channel: channelOf(row.channel) })),
            now,
        });
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
    private async readClock(tx: Pick<Writer, 'select'>): Promise<Date> {
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
