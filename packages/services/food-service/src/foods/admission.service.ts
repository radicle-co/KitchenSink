/**
 * `AdmissionService` (T-144/T-052) — enqueue backpressure + near-ceiling flood-shed. Gates NEW enqueues
 * (`POST /v1/foods`, `/batch`) ONLY; reads and `PATCH`-resolves are never admitted through here and are
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

import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { FetchUnavailableError } from './foods.errors.js';

/** Default hard `fetch_queue` depth ceiling (FR-046). */
const DEFAULT_MAX_QUEUE_DEPTH = 10_000;

/** Default per-`sub` pending threshold above which a flooding requester is shed near the ceiling (FR-043b). */
const DEFAULT_DEMOTE_THRESHOLD = 50;

/** Fraction of the ceiling at/above which near-ceiling flood-shedding engages. */
const NEAR_CEILING_FRACTION = 0.9;

/** Retry-After seconds returned on a shed/backpressure `503` (jittered to avoid a thundering herd). */
const BASE_RETRY_AFTER_SECONDS = 30;

@Injectable()
export class AdmissionService {
    private readonly maxQueueDepth: number;
    private readonly demoteThreshold: number;

    public constructor(@Inject(DrizzleProvider) private readonly db: FoodDrizzle) {
        this.maxQueueDepth = Number(process.env['FOOD_MAX_QUEUE_DEPTH'] ?? DEFAULT_MAX_QUEUE_DEPTH);
        this.demoteThreshold = Number(process.env['FOOD_DEMOTE_THRESHOLD'] ?? DEFAULT_DEMOTE_THRESHOLD);
    }

    /**
     * Admit a NEW enqueue for `sub`, or fail closed with `503` (FR-046/FR-043b).
     *
     * @param sub - The verified requester (for the near-ceiling flood-shed decision).
     * @throws {FetchUnavailableError} (→ 503 + Retry-After) at the depth ceiling, or near the ceiling
     *   when `sub` is a flooding requester.
     * @sideEffect Reads `fetch_queue` / `fetch_requesters`.
     */
    public async admit(sub: string): Promise<void> {
        const depth = await this.activeDepth();

        if (depth >= this.maxQueueDepth) {
            throw new FetchUnavailableError(this.retryAfter(), 'Fetch queue at capacity');
        }

        if (depth >= this.maxQueueDepth * NEAR_CEILING_FRACTION) {
            const pending = await this.pendingCountForSub(sub);

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

    /** A `sub`'s live pending demand (the flood-shed input). */
    private async pendingCountForSub(sub: string): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n
              FROM fetch_queue q JOIN fetch_requesters r USING (food_id)
             WHERE r.sub = ${sub} AND q.status = 'pending'
        `);

        return result.rows[0]?.n ?? 0;
    }

    /** A jittered Retry-After (±20%) so recovering clients do not retry in lockstep. */
    private retryAfter(): number {
        const jitter = Math.floor(BASE_RETRY_AFTER_SECONDS * 0.2 * (Math.random() * 2 - 1));

        return BASE_RETRY_AFTER_SECONDS + jitter;
    }
}
