/**
 * Analytics plan U3 — the server-door event writer (origin R2, R7; KTD4).
 *
 * ## The pattern: fire-and-forget behind a two-tier per-instance shed
 *
 * `capture` is the ONE way an event enters the store from inside the service, and it is synchronous
 * `void` by construction — the `notifyCorroborated` precedent (`void … .catch(warn)`): analytics is a
 * byproduct of a user-facing action, so a failed, slow, or saturated analytics write must cost that
 * action NOTHING (origin R7, proven by SC4's fault-injection integration suite). Every failure shape is
 * contained here: an insert rejection is warned and dropped, a synchronous throw is caught, and
 * saturation is SHED rather than queued — a queue would just move the memory pressure the cap exists
 * to bound.
 *
 * ## Why the bound is PER-INSTANCE, and two-tier
 *
 * The protected resource is each Fargate task's own DB pool — a shared/distributed limiter would
 * protect the wrong thing and add a dependency to a path whose whole point is having none (KTD4).
 * Over the cap, CLIENT-DOOR families (`query_outcome`) shed first at {@link ANALYTICS_CLIENT_SHED_AT}:
 * a lost query-outcome is at-most-once noise (origin R11). SERVER-DOOR families (`recipe_saved` /
 * `recipe_viewed`) — the ones feeding 015's user-visible credit — shed only at
 * {@link ANALYTICS_HARD_CAP}, and saves remain reconcilable against `recipe_collections` (R11's seam).
 *
 * Drops are COUNTED per family and flushed as ONE aggregated warn line at most once per
 * {@link ANALYTICS_DROP_FLUSH_INTERVAL_MS} — never one line per drop, which would storm the log during
 * the exact saturation the cap exists for (the first drop after a quiet period flushes immediately, so
 * the signal is not delayed a whole interval).
 *
 * ⛔ The landing spells `ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING` when (and only
 * when) the event carries a client-minted id: 0043's idempotency index is PARTIAL, so a bare
 * `ON CONFLICT (event_id)` has no arbiter to infer and errors at runtime. Server-door events carry no
 * id and skip the clause entirely.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { QueryOutcomeEvent } from '@kitchensink/recipe-core/analytics/event-payload';

import { DrizzleProvider, type RecipeDrizzle } from '../database/database.module.js';
import type { AnalyticsEventType } from '../database/schema/analyticsEvents.js';

/** Hard cap on in-flight analytics inserts per instance — past it, EVERY family sheds (KTD4). */
export const ANALYTICS_HARD_CAP = 32;

/** The lower threshold where client-door families shed while server-door families still land. */
export const ANALYTICS_CLIENT_SHED_AT = 16;

/** Minimum spacing between aggregated drop-count warn lines. */
export const ANALYTICS_DROP_FLUSH_INTERVAL_MS = 60_000;

/** The families the client ingestion door may deliver — first to shed, rejected nowhere else. */
const CLIENT_DOOR_FAMILIES: ReadonlySet<AnalyticsEventType> = new Set(['query_outcome']);

/** One event entering the store. The actor is always a verified principal, never client-asserted. */
export interface CapturedEvent {
    readonly type: AnalyticsEventType;
    readonly userId: string;
    readonly recipeId?: string;
    readonly queryText?: string;
    /** Client-minted idempotency key (KTD5) — present iff the event came through the ingest door. */
    readonly eventId?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
    /** When the action occurred where it occurred; defaults to now for server-observed actions. */
    readonly occurredAt?: Date;
}

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    private inFlight = 0;

    private droppedSinceFlush = 0;

    private lastDropFlushAt = 0;

    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /**
     * Record one event, fire-and-forget. Never throws, never blocks, sheds under pressure.
     *
     * @param event - The event to record; the caller supplies the VERIFIED actor.
     * @sideEffect One bounded analytics INSERT; warn-logs on failure or shed. Never throws.
     */
    public capture(event: CapturedEvent): void {
        const shedAt = CLIENT_DOOR_FAMILIES.has(event.type) ? ANALYTICS_CLIENT_SHED_AT : ANALYTICS_HARD_CAP;

        if (this.inFlight >= shedAt) {
            this.countDrop();

            return;
        }

        this.inFlight += 1;
        // The ONE detachment point: `recordSafely` contains every failure (it is `async`, so even a
        // synchronous throw from the db layer becomes a rejection its try/catch holds — proven by the
        // unit suite's sync-throwing db), and `void` states the fire-and-forget contract in one word.
        void this.recordSafely(event);
    }

    /**
     * Insert one event, containing EVERY failure — the isolation half of the R7 guarantee.
     *
     * @param event - The event to insert.
     * @sideEffect One analytics INSERT; warn-logs on any failure. Never rejects.
     */
    private async recordSafely(event: CapturedEvent): Promise<void> {
        try {
            await this.insert(event);
        } catch (error) {
            this.logger.warn(
                `Analytics ${event.type} write failed; the user-facing action is unaffected.`,
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.inFlight -= 1;
        }
    }

    private async insert(event: CapturedEvent): Promise<void> {
        const payload = JSON.stringify(event.payload ?? {});
        const occurredAt = event.occurredAt ?? new Date();

        if (event.eventId === undefined) {
            await this.db.execute(sql`
                INSERT INTO analytics_events (event_type, user_id, recipe_id, query_text, payload, occurred_at)
                VALUES (${event.type}, ${event.userId}, ${event.recipeId ?? null}, ${event.queryText ?? null},
                        ${payload}::jsonb, ${occurredAt})
            `);

            return;
        }

        await this.db.execute(sql`
            INSERT INTO analytics_events (event_id, event_type, user_id, recipe_id, query_text, payload, occurred_at)
            VALUES (${event.eventId}, ${event.type}, ${event.userId}, ${event.recipeId ?? null},
                    ${event.queryText ?? null}, ${payload}::jsonb, ${occurredAt})
            ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
        `);
    }

    /**
     * Land one validated ingest-door batch (plan U4), AWAITED — the ingest route needs the landed count
     * for KTD5's dedup-rate signal, so this is the one deliberate exception to fire-and-forget. The
     * batch counts as ONE in-flight slot and sheds at the CLIENT threshold: the ingest door is
     * client-door load by definition, so under pressure it drops before any server-door capture does.
     *
     * ⛔ The landing spells `ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING` — 0043's
     * idempotency index is PARTIAL and a bare `ON CONFLICT (event_id)` errors at runtime. `RETURNING`
     * counts the rows that actually landed; duplicates (client retries) are simply absent from it.
     *
     * @param userId - The VERIFIED principal every event in the batch is attributed to.
     * @param events - Schema-validated client events (the controller already dropped invalid ones).
     * @returns How many rows landed, and whether the batch was shed instead of attempted.
     * @sideEffect One multi-row analytics INSERT. Throws on database failure (the route answers 5xx
     *   honestly; the client emitter swallows it — this is the analytics action itself, not a byproduct
     *   of a user-facing one).
     */
    public async ingestBatch(
        userId: string,
        events: readonly QueryOutcomeEvent[],
    ): Promise<{ landed: number; shed: boolean }> {
        if (events.length === 0) {
            return { landed: 0, shed: false };
        }

        if (this.inFlight >= ANALYTICS_CLIENT_SHED_AT) {
            this.droppedSinceFlush += events.length - 1;
            this.countDrop();

            return { landed: 0, shed: true };
        }

        this.inFlight += 1;

        try {
            const rows: SQL[] = events.map(
                (event) =>
                    sql`(${event.eventId}, ${event.type}, ${userId}, ${event.query},
                        ${JSON.stringify({ served: event.served, outcome: event.outcome })}::jsonb,
                        ${new Date(event.occurredAt)})`,
            );
            const result = await this.db.execute(sql`
                INSERT INTO analytics_events (event_id, event_type, user_id, query_text, payload, occurred_at)
                VALUES ${sql.join(rows, sql`, `)}
                ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
                RETURNING id
            `);

            return { landed: result.rows.length, shed: false };
        } finally {
            this.inFlight -= 1;
        }
    }

    /** Count one shed event; flush the aggregate as a single warn line at most once per interval. */
    private countDrop(): void {
        this.droppedSinceFlush += 1;
        const now = Date.now();

        if (now - this.lastDropFlushAt >= ANALYTICS_DROP_FLUSH_INTERVAL_MS) {
            this.logger.warn(
                `Analytics shed ${this.droppedSinceFlush} event(s) since the last flush — per-instance in-flight cap reached (client door sheds first).`,
            );
            this.droppedSinceFlush = 0;
            this.lastDropFlushAt = now;
        }
    }
}
