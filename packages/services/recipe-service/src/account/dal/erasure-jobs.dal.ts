/**
 * T134 — the account-erasure-jobs data-access layer.
 *
 * Owns every SQL touch for `account_erasure_jobs` over the global Drizzle client. Ownership scoping is
 * applied by the service (which supplies the verified owner key), so the DAL is identity-blind: it takes
 * an owner id and returns rows.
 *
 * **The one invariant that lives here: the insert never reads first.** "Is there already an in-flight
 * job for this owner?" is NOT answered with a SELECT followed by an INSERT — that is a TOCTOU window,
 * and two concurrent `POST /api/v1/account/erasure` calls would both see "no job" and both insert. Instead
 * the INSERT is issued unconditionally and `ON CONFLICT DO NOTHING` defers the decision to the
 * `idx_erasure_jobs_active_owner` partial unique index, which Postgres evaluates atomically. The loser
 * of the race gets zero rows back — a fact, not an error — and the service turns that into the idempotent
 * `202` (C-007). This is why {@link insertQueuedJob} returns `string | undefined` instead of throwing a
 * unique violation for a caller to sniff at.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ErasureTriggerSource } from '@kitchensink/recipe-core';

import { DrizzleProvider, type RecipeDrizzle } from '../../database/database.module.js';
import {
    accountErasureJobs,
    ACTIVE_ERASURE_JOB_STATUSES,
    type ActiveErasureJobStatus,
} from '../../database/schema/account.js';
import { isActiveErasureJobStatus } from '../domain/erasure-status.js';

/** An in-flight erasure job, narrowed to exactly what the `202` response needs. */
export interface ActiveErasureJob {
    /** The job's id (`account_erasure_jobs.id`). */
    readonly id: string;
    /** The job's in-flight status. */
    readonly status: ActiveErasureJobStatus;
}

/**
 * The audit-bearing input to {@link ErasureJobsDal.insertQueuedJob} (R8). Carries the DONATE election plus
 * the trigger source + actor recorded on the durable row, so who/what triggered every erasure is
 * attributable independently of the mutable status column.
 */
export interface InsertErasureJobInput {
    /** The app-user ULID whose data is to be erased. */
    readonly ownerId: string;
    /** The recipe ids the owner elected to publish (donate); empty ⇒ donate none (default). */
    readonly publishRecipeIds?: readonly string[];
    /** Who/what triggered the erasure — `'user'` (phrase-gated) or `'service'` (verified service principal). */
    readonly triggerSource: ErasureTriggerSource;
    /** The triggering principal: the owner's ULID (user path) or the token's machine actor label (service path). */
    readonly actor: string;
}

/**
 * The `idx_erasure_jobs_active_owner` index predicate, restated as an `ON CONFLICT` conflict-target
 * qualifier. Postgres only matches a PARTIAL index when the statement repeats its predicate, so without
 * this the `ON CONFLICT (owner_id)` would fail to find any matching index at all and error out. Kept
 * verbatim from `schema/account.ts` / migration `0005_account_erasure.sql`.
 */
const ACTIVE_OWNER_INDEX_PREDICATE = sql`${accountErasureJobs.status} IN ('queued', 'running')`;

@Injectable()
export class ErasureJobsDal {
    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /**
     * Insert a fresh `queued` job for the owner, deferring the "already in flight?" decision to the
     * partial unique index.
     *
     * A `completed`/`failed` row does not satisfy the index predicate, so a retry after a failure inserts
     * cleanly — which is exactly the C-007 "after a `failed` job, a fresh job is enqueued" behaviour,
     * expressed by the schema rather than by a status check in application code.
     *
     * The DONATE election (CR-002 / U3b) is persisted on THIS row as the durable source of truth: the
     * worker reads it from the row it claims, not from the SQS message, so a lost/replayed message cannot
     * change which recipes were donated. An empty election ⇒ every owner-only recipe is removed.
     *
     * The R8 audit fields (`trigger_source`, `actor`, `confirmed_at`) are written HERE, at insert time,
     * because the row's creation IS the erasure confirmation — the phrase was validated (user path) or the
     * single-target token verified (service path) immediately before this call. `confirmed_at` is the DB
     * clock at insert; the two never meaningfully diverge in the current single-step flow.
     *
     * @param input - The owner, the DONATE election, and the R8 trigger source + actor.
     * @returns The new job's id, or `undefined` when an in-flight job already exists (conflict).
     * @sideEffect Inserts into `account_erasure_jobs`; reads the clock for `confirmed_at`.
     */
    public async insertQueuedJob(input: InsertErasureJobInput): Promise<string | undefined> {
        const inserted = await this.db
            .insert(accountErasureJobs)
            .values({
                ownerId: input.ownerId,
                publishRecipeIds: [...(input.publishRecipeIds ?? [])],
                triggerSource: input.triggerSource,
                actor: input.actor,
                confirmedAt: new Date(),
            })
            .onConflictDoNothing({ target: accountErasureJobs.ownerId, where: ACTIVE_OWNER_INDEX_PREDICATE })
            .returning({ id: accountErasureJobs.id });

        return inserted[0]?.id;
    }

    /**
     * Read the owner's in-flight job, if any.
     *
     * At most one can exist — that is precisely what the partial unique index guarantees — so this reads
     * a single row rather than defending against duplicates.
     *
     * @param ownerId - The app-user ULID.
     * @returns The in-flight job, or `undefined` when none is.
     * @throws {Error} When a row escapes the status filter (a broken query contract, not a client error).
     * @sideEffect Reads `account_erasure_jobs`.
     */
    public async findActiveJob(ownerId: string): Promise<ActiveErasureJob | undefined> {
        const rows = await this.db
            .select({ id: accountErasureJobs.id, status: accountErasureJobs.status })
            .from(accountErasureJobs)
            .where(
                and(
                    eq(accountErasureJobs.ownerId, ownerId),
                    inArray(accountErasureJobs.status, [...ACTIVE_ERASURE_JOB_STATUSES]),
                ),
            )
            .limit(1);

        const row = rows[0];

        if (row === undefined) {
            return undefined;
        }

        // Parse, don't validate: the DB→domain boundary is where `status: string` becomes the typed
        // contract enum. The WHERE clause already restricts to in-flight statuses, so a value that fails
        // this guard means the query and this narrowing disagree — surface it rather than coerce it into
        // a plausible-looking lie about the account's erasure state.
        if (!isActiveErasureJobStatus(row.status)) {
            throw new Error(
                `account_erasure_jobs row ${row.id} escaped the in-flight filter with status ${row.status}`,
            );
        }

        return { id: row.id, status: row.status };
    }

    /**
     * Whether the owner has a `completed` erasure job — i.e. their data is already gone.
     *
     * `completed` is terminal and there is no un-erasing, so existence is all the caller needs (the `410`
     * body carries no job id).
     *
     * @param ownerId - The app-user ULID.
     * @returns `true` when a prior erasure completed.
     * @sideEffect Reads `account_erasure_jobs`.
     */
    public async hasCompletedJob(ownerId: string): Promise<boolean> {
        const rows = await this.db
            .select({ id: accountErasureJobs.id })
            .from(accountErasureJobs)
            .where(and(eq(accountErasureJobs.ownerId, ownerId), eq(accountErasureJobs.status, 'completed')))
            .limit(1);

        return rows.length > 0;
    }
}
