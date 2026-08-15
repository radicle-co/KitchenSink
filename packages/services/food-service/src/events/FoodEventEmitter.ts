/**
 * `FoodEventEmitter` (T-165, MOD-002 completion fan-out) — the worker's completion/failure event
 * abstraction. The fan-out worker calls {@link FoodEventEmitter.publishFoodFetchCompleted} on every
 * terminal disposition (RESOLVED/UNRESOLVED/NOT_FOUND/FAILED) and
 * {@link FoodEventEmitter.publishFetchFailed} ONLY on a `FAILED` tombstone (DSN-9 — a `NOT_FOUND`
 * tombstone is a normal outcome and emits no `FetchFailed`/raises no alarm).
 *
 * The actual AWS put (EventBridge `PutEvents`, canonical `detailType: 'FoodFetchCompleted'` matching
 * the deployed CDK `FoodFetchCompletedRule`) sits behind the injectable {@link EventBus} seam, so the
 * worker tests inject a capturing fake bus and never touch real AWS. Both publishes are
 * **fire-and-forget**: a bus failure is logged via the optional error sink and swallowed — a
 * completion/alarm signal must never fail the drain or strand the leased row.
 *
 * @implements FR-034
 */
import { ulid } from 'ulidx';

import type { FoodStatus } from '../foods/dao/index.js';
import type { EventBus } from './eventBus.js';

/** Canonical EventBridge `detailType` for the completion event (matches the CDK `FoodFetchCompletedRule`). */
export const FOOD_FETCH_COMPLETED_DETAIL_TYPE = 'FoodFetchCompleted';

/** Canonical EventBridge `detailType` for the terminal-failure alarm event (FAILED only, DSN-9). */
export const FETCH_FAILED_DETAIL_TYPE = 'FetchFailed';

/** The `FoodFetchCompleted` detail payload (plan §4) — carries the internal food `id`, never `fdcId`. */
export interface FoodFetchCompletedDetail {
    /** A unique event id (ULID). */
    readonly eventId: string;
    /** ISO-8601 emission timestamp. */
    readonly timestamp: string;
    /** The internal food id. */
    readonly id: string;
    /** The terminal lifecycle status reached. */
    readonly status: FoodStatus;
}

/** The `FetchFailed` detail payload (plan §4) — emitted on a `FAILED` tombstone only (DSN-9). */
export interface FetchFailedDetail {
    /** A unique event id (ULID). */
    readonly eventId: string;
    /** ISO-8601 emission timestamp. */
    readonly timestamp: string;
    /** The internal food id. */
    readonly id: string;
    /** The number of real source failures that exhausted the retry budget. */
    readonly attempts: number;
    /** A sanitized, source-agnostic terminal error detail. */
    readonly lastError: string;
}

/** Injectable clock + id generator for deterministic payload tests; both default to live sources. */
export interface EventClock {
    /** Current instant (defaults to `() => new Date()`). */
    readonly now?: () => Date;
    /** Fresh event id (defaults to a `ulid`). */
    readonly newEventId?: () => string;
}

/** Input for {@link FoodEventEmitter.publishFoodFetchCompleted}. */
export interface PublishCompletedInput {
    /** The internal food id. */
    readonly id: string;
    /** The terminal lifecycle status reached. */
    readonly status: FoodStatus;
}

/** Input for {@link FoodEventEmitter.publishFetchFailed}. */
export interface PublishFailedInput {
    /** The internal food id. */
    readonly id: string;
    /** The number of real source failures that exhausted the retry budget. */
    readonly attempts: number;
    /** A sanitized terminal error detail. */
    readonly lastError: string;
}

/** The completion/failure publisher the fan-out worker depends on (FoodEventEmitter is the only impl). */
export interface FoodEventPublisher {
    /**
     * Emit `FoodFetchCompleted` for a terminal disposition (fire-and-forget).
     *
     * @param input - The food id + terminal status.
     */
    publishFoodFetchCompleted(input: PublishCompletedInput): Promise<void>;
    /**
     * Emit `FetchFailed` for a `FAILED` tombstone only (fire-and-forget, DSN-9).
     *
     * @param input - The food id + attempts + last error.
     */
    publishFetchFailed(input: PublishFailedInput): Promise<void>;
}

/**
 * Build a {@link FoodFetchCompletedDetail} payload. Pure given its clock/id generator.
 *
 * @param input - The food id + terminal status.
 * @param clock - Optional clock/id overrides (deterministic tests).
 * @returns The completion detail payload.
 */
export function buildFoodFetchCompleted(input: PublishCompletedInput, clock?: EventClock): FoodFetchCompletedDetail {
    return {
        eventId: (clock?.newEventId ?? newEventId)(),
        timestamp: (clock?.now ?? (() => new Date()))().toISOString(),
        id: input.id,
        status: input.status,
    };
}

/**
 * Build a {@link FetchFailedDetail} payload. Pure given its clock/id generator.
 *
 * @param input - The food id + attempts + last error.
 * @param clock - Optional clock/id overrides (deterministic tests).
 * @returns The failure detail payload.
 */
export function buildFetchFailed(input: PublishFailedInput, clock?: EventClock): FetchFailedDetail {
    return {
        eventId: (clock?.newEventId ?? newEventId)(),
        timestamp: (clock?.now ?? (() => new Date()))().toISOString(),
        id: input.id,
        attempts: input.attempts,
        lastError: input.lastError,
    };
}

export class FoodEventEmitter implements FoodEventPublisher {
    /**
     * @param bus - The injectable AWS-put seam.
     * @param clock - Optional clock/id overrides.
     * @param onError - Optional sink for a swallowed fire-and-forget put failure.
     */
    public constructor(
        private readonly bus: EventBus,
        private readonly clock?: EventClock,
        private readonly onError?: (error: unknown, detailType: string) => void,
    ) {}

    /**
     * Emit `FoodFetchCompleted` (fire-and-forget). A bus failure is reported to `onError` and
     * swallowed — a completion signal must never fail the drain.
     *
     * @param input - The food id + terminal status.
     * @sideEffect Puts an event on the bus (best-effort).
     */
    public async publishFoodFetchCompleted(input: PublishCompletedInput): Promise<void> {
        const detail = buildFoodFetchCompleted(input, this.clock);

        try {
            await this.bus.putEvent({ detailType: FOOD_FETCH_COMPLETED_DETAIL_TYPE, detail: { ...detail } });
        } catch (error) {
            this.onError?.(error, FOOD_FETCH_COMPLETED_DETAIL_TYPE);
        }
    }

    /**
     * Emit `FetchFailed` (fire-and-forget, DSN-9 — FAILED only). A bus failure is reported to
     * `onError` and swallowed.
     *
     * @param input - The food id + attempts + last error.
     * @sideEffect Puts an event on the bus (best-effort).
     */
    public async publishFetchFailed(input: PublishFailedInput): Promise<void> {
        const detail = buildFetchFailed(input, this.clock);

        try {
            await this.bus.putEvent({ detailType: FETCH_FAILED_DETAIL_TYPE, detail: { ...detail } });
        } catch (error) {
            this.onError?.(error, FETCH_FAILED_DETAIL_TYPE);
        }
    }
}

/** A fresh ULID event id (the default {@link EventClock.newEventId}). */
export function newEventId(): string {
    return ulid();
}
