/**
 * `FoodEventEmitter` (T-165, MOD-002 completion fan-out) — the worker's completion/failure event
 * abstraction. The fan-out worker calls {@link FoodEventEmitter.publishFoodFetchCompleted} on every
 * terminal disposition (RESOLVED/UNRESOLVED/NOT_FOUND/FAILED) and
 * {@link FoodEventEmitter.publishFetchFailed} ONLY on a `FAILED` tombstone (DSN-9 — a `NOT_FOUND`
 * tombstone is a normal outcome and emits no `FetchFailed`/raises no alarm).
 *
 * Both publishes go through the shared `publish` PORT (`@kitchensink/messaging`, plan U4), which owns the
 * fire-and-forget guarantee and the boundary parse: a store failure is reported to the error sink and
 * swallowed, because a completion/alarm signal must never fail the drain or strand the leased row.
 *
 * ⛔ **DSN-9 lives HERE, not in the port.** `publishFetchFailed` is called only on a `FAILED` tombstone; a
 * `NOT_FOUND` tombstone is a normal outcome and must raise no alarm. That is FOOD's policy — it is the
 * reason food's alarms are not permanently lit — and moving it behind a shared "should this publish?" hook
 * would put it where no producer's tests cover it.
 *
 * The messages are keyed to the substrate's group (`groupType: 'food'`, `groupId` = the internal food id),
 * so a consumer subscribes to one food's progress rather than filtering a firehose. The former
 * EventBridge `detailType` becomes the message `kind`, unchanged in value so the deployed
 * `FoodFetchCompletedRule` and every existing assertion still name the same string.
 *
 * @implements FR-034
 */
import { ulid } from 'ulidx';

import type { FoodStatus } from '../foods/dao/index.js';
import { publish, type MessagePublisher } from '@kitchensink/messaging';

/** The completion message's `kind` (kept byte-identical to the former EventBridge `detailType`). */
export const FOOD_FETCH_COMPLETED_DETAIL_TYPE = 'FoodFetchCompleted';

/** The terminal-failure message's `kind` — emitted on a `FAILED` tombstone only (DSN-9). */
export const FETCH_FAILED_DETAIL_TYPE = 'FetchFailed';

/** The substrate group every message from this producer belongs to (KTD-2). */
const FOOD_GROUP_TYPE = 'food';

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
     * @param publisher - The substrate adapter (`ConsolePublisher` locally, DynamoDB in deployed stages).
     * @param clock - Optional clock/id overrides.
     * @param onError - Optional sink for a swallowed fire-and-forget publish failure.
     */
    public constructor(
        private readonly publisher: MessagePublisher,
        private readonly clock?: EventClock,
        private readonly onError?: (error: unknown, detailType: string) => void,
    ) {}

    /**
     * Emit `FoodFetchCompleted` (fire-and-forget). A publish failure is reported to `onError` and
     * swallowed — a completion signal must never fail the drain.
     *
     * @param input - The food id + terminal status.
     * @sideEffect Publishes to the substrate (best-effort).
     */
    public async publishFoodFetchCompleted(input: PublishCompletedInput): Promise<void> {
        const detail = buildFoodFetchCompleted(input, this.clock);

        await publish(
            this.publisher,
            {
                groupType: FOOD_GROUP_TYPE,
                groupId: detail.id,
                timestamp: detail.timestamp,
                kind: FOOD_FETCH_COMPLETED_DETAIL_TYPE,
                payload: { ...detail },
            },
            { onError: (error) => this.onError?.(error, FOOD_FETCH_COMPLETED_DETAIL_TYPE) },
        );
    }

    /**
     * Emit `FetchFailed` (fire-and-forget, DSN-9 — FAILED only). A publish failure is reported to
     * `onError` and swallowed.
     *
     * @param input - The food id + attempts + last error.
     * @sideEffect Publishes to the substrate (best-effort).
     */
    public async publishFetchFailed(input: PublishFailedInput): Promise<void> {
        const detail = buildFetchFailed(input, this.clock);

        await publish(
            this.publisher,
            {
                groupType: FOOD_GROUP_TYPE,
                groupId: detail.id,
                timestamp: detail.timestamp,
                kind: FETCH_FAILED_DETAIL_TYPE,
                payload: { ...detail },
            },
            { onError: (error) => this.onError?.(error, FETCH_FAILED_DETAIL_TYPE) },
        );
    }
}

/** A fresh ULID event id (the default {@link EventClock.newEventId}). */
export function newEventId(): string {
    return ulid();
}
