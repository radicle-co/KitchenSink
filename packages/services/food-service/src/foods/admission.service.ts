/**
 * `AdmissionService` (T-144/T-052) — enqueue backpressure + near-ceiling flood-shed. Gates NEW enqueues
 * (`POST /api/v1/foods`, `/batch`) ONLY; reads and `PATCH`-resolves are never admitted through here and are
 * never shed (FR-046/FR-043b). Fail-closed with `503` + `Retry-After` — NEVER a per-`sub` `429` quota
 * rejection (auth ≠ rate limiting; D-FAIRNESS).
 *
 * Two durable, cross-process signals (both read from `fetch_queue`, so the API and worker agree):
 * - **Hard depth ceiling** (FR-046): when the active (`pending` + `in_flight`) queue depth reaches
 *   `FOOD_MAX_QUEUE_DEPTH` (default 10,000), all NEW enqueues fail closed.
 * - **Near-ceiling flood-shed** (FR-043b): once depth crosses a near-ceiling fraction, a `sub` whose own
 *   pending count exceeds `FOOD_DEMOTE_THRESHOLD` (default 50) is shed FIRST to preserve headroom, while
 *   other (lighter) users are unaffected.
 *
 * The per-source circuit breaker (FR-046/§6) lives in-process in the Fargate worker (the rolling-window
 * 429 failsafe); it is not visible cross-process to this API instance, so admission here enforces the
 * durable queue-depth + flood-shed signals only. (A durable breaker signal is a follow-up — see report.)
 *
 * @implements FR-046 FR-043b
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { demoteThresholdFromEnv, maxQueueDepthFromEnv } from '../config/env.schema.js';
import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { FetchUnavailableError } from './foods.errors.js';

/** Fraction of the ceiling at/above which near-ceiling flood-shedding engages. */
const NEAR_CEILING_FRACTION = 0.9;

/** Retry-After seconds returned on a shed/backpressure `503` (jittered to avoid a thundering herd). */
const BASE_RETRY_AFTER_SECONDS = 30;

@Injectable()
export class AdmissionService {
    private readonly maxQueueDepth: number;
    private readonly demoteThreshold: number;

    public constructor(@Inject(DrizzleProvider) private readonly db: FoodDrizzle) {
        // BOTH numbers come from validated readers that share their default + validation rule with the
        // boot-time `EnvironmentSchema`. A malformed value fails fast here rather than becoming `NaN`,
        // which would not raise these guards but REMOVE them: every `depth >= NaN` / `pending > NaN`
        // comparison is `false`, so the 503 backstop and the flood-shed would silently stop firing and the
        // service would accept unbounded enqueues behind no error and no log.
        this.maxQueueDepth = maxQueueDepthFromEnv();
        // The threshold is shared with the worker's drain-time demotion (`FetchQueueDao`) through the same
        // reader, so an operator cannot tune the shed and the drain apart.
        this.demoteThreshold = demoteThresholdFromEnv();
    }

    /**
     * Admit a NEW enqueue for a requester, or fail closed with `503` (FR-046/FR-043b).
     *
     * @param requesterId - The requester key (CR-002/U1: app-user ULID or `svc_*`) for the near-ceiling
     *   flood-shed decision.
     * @throws {FetchUnavailableError} (→ 503 + Retry-After) at the depth ceiling, or near the ceiling
     *   when the requester is flooding.
     * @sideEffect Reads `fetch_queue` / `fetch_requesters`.
     */
    public async admit(requesterId: string): Promise<void> {
        const depth = await this.activeDepth();

        if (depth >= this.maxQueueDepth) {
            throw new FetchUnavailableError(this.retryAfter(), 'Fetch queue at capacity');
        }

        if (depth >= this.maxQueueDepth * NEAR_CEILING_FRACTION) {
            const pending = await this.pendingCountForRequester(requesterId);

            if (pending > this.demoteThreshold) {
                throw new FetchUnavailableError(this.retryAfter(), 'Fetch temporarily unavailable (flood-shed)');
            }
        }
    }

    /** Active (`pending` + `in_flight`) queue depth. */
    private async activeDepth(): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM fetch_queue WHERE status IN ('pending', 'in_flight')
        `);

        return result.rows[0]?.n ?? 0;
    }

    /** A requester's live pending demand (the flood-shed input). */
    private async pendingCountForRequester(requesterId: string): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n
              FROM fetch_queue q JOIN fetch_requesters r USING (food_id)
             WHERE r.requester_id = ${requesterId} AND q.status = 'pending'
        `);

        return result.rows[0]?.n ?? 0;
    }

    /** A jittered Retry-After (±20%) so recovering clients do not retry in lockstep. */
    private retryAfter(): number {
        const jitter = Math.floor(BASE_RETRY_AFTER_SECONDS * 0.2 * (Math.random() * 2 - 1));

        return BASE_RETRY_AFTER_SECONDS + jitter;
    }
}
