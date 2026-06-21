/**
 * `FoodsService` — read-path business logic for `/v1/foods/*` (ARCH-001, MOD-001).
 *
 * Implements the cache-hit / stale-SWR / tombstone-TTL / miss-enqueue / pending branching from
 * plan §3 + module-design MOD-001. The service is transport-agnostic: it returns a
 * {@link FoodResponse} on a hit/stale, and throws a typed {@link FoodPendingError} (→ 202) or
 * {@link FoodNotFoundError} (→ 404) which {@link FoodsController} maps to HTTP responses.
 *
 * @implements FR-001 FR-002 FR-003 FR-004 FR-005 FR-006 FR-007 FR-008 FR-009 FR-010 FR-025 FR-031 FR-033
 */
import { Injectable } from '@nestjs/common';

import type { FoodRow } from '../db/schema/usda.js';
import { FetchQueueService } from './fetch-queue.service.js';
import { FoodNotFoundError, FoodPendingError } from './foods.errors.js';
import { FoodsRepository } from './foods.repository.js';
import type {
    FetchStatus,
    FoodNutrients,
    FoodResponse,
    FoodSearchResponse,
    FoodStatusResponse,
} from './foods.types.js';

/** Staleness threshold in days (FR-031, `USDA_STALE_THRESHOLD_DAYS`, default 30). */
const DEFAULT_STALE_THRESHOLD_DAYS = 30;

/** Tombstone TTL in days (FR-025, `USDA_TOMBSTONE_TTL_DAYS`, default 30). */
const DEFAULT_TOMBSTONE_TTL_DAYS = 30;

/** Estimated wait reported on a fresh enqueue / lookup (plan §3). */
const ESTIMATED_WAIT_SECONDS_LOOKUP = 30;

/** Estimated wait reported by the status endpoint for an already-pending food. */
const ESTIMATED_WAIT_SECONDS_STATUS = 20;

const MILLIS_PER_DAY = 86_400_000;

@Injectable()
export class FoodsService {
    public constructor(
        private readonly repository: FoodsRepository,
        private readonly fetchQueue: FetchQueueService,
    ) {}

    /** Stale threshold in days, from env with a safe default. */
    private get staleThresholdDays(): number {
        return Number(process.env['USDA_STALE_THRESHOLD_DAYS'] ?? DEFAULT_STALE_THRESHOLD_DAYS);
    }

    /** Tombstone TTL in days, from env with a safe default. */
    private get tombstoneTtlDays(): number {
        return Number(process.env['USDA_TOMBSTONE_TTL_DAYS'] ?? DEFAULT_TOMBSTONE_TTL_DAYS);
    }

    /**
     * Resolve `GET /v1/foods/{fdcId}` (FR-001–FR-005, FR-025, FR-031).
     *
     * Decision table:
     * - `fetched` & fresh → return {@link FoodResponse} (200).
     * - `fetched` & stale, or `stale` → enqueue background re-fetch, return stale 200 (SWR).
     * - `not_found` within TTL → throw {@link FoodNotFoundError} (404).
     * - `not_found` past TTL → enqueue re-attempt, throw {@link FoodPendingError} (202).
     * - `pending`/`failed`/missing → enqueue, throw {@link FoodPendingError} (202).
     *
     * @param fdcId - Validated positive-integer FDC id.
     * @param requestedBy - Authenticated `sub` or service principal (FR-048).
     * @returns A {@link FoodResponse} when the food is served (fresh or stale).
     * @throws {FoodPendingError} when the food is being fetched (→ 202).
     * @throws {FoodNotFoundError} when the food is tombstoned within its TTL (→ 404).
     */
    public async getFood(fdcId: number, requestedBy: string): Promise<FoodResponse> {
        const row = await this.repository.findByFdcId(fdcId);

        if (row !== null && row.fetchStatus === 'fetched') {
            if (this.isStale(row.fetchedAt)) {
                await this.enqueue(fdcId, requestedBy);

                return this.toFoodResponse(row, true);
            }

            return this.toFoodResponse(row, false);
        }

        if (row !== null && row.fetchStatus === 'stale') {
            await this.enqueue(fdcId, requestedBy);

            return this.toFoodResponse(row, true);
        }

        if (row !== null && row.fetchStatus === 'not_found') {
            if (this.isTombstoneExpired(row.fetchedAt ?? row.updatedAt)) {
                await this.enqueue(fdcId, requestedBy);

                throw new FoodPendingError(fdcId, ESTIMATED_WAIT_SECONDS_LOOKUP);
            }

            throw new FoodNotFoundError(fdcId);
        }

        // Miss, pending, or failed → enqueue (deduped) and report pending.
        await this.enqueue(fdcId, requestedBy);

        throw new FoodPendingError(fdcId, ESTIMATED_WAIT_SECONDS_LOOKUP);
    }

    /**
     * Resolve `GET /v1/foods/{fdcId}/status` (FR-007, FR-033). Never enqueues, never fetches.
     *
     * @param fdcId - Validated FDC id.
     * @returns The lifecycle status; `food` is populated only when `fetched`.
     * @throws {FoodNotFoundError} when no record exists at all (→ 404).
     */
    public async getStatus(fdcId: number): Promise<FoodStatusResponse> {
        const row = await this.repository.findByFdcId(fdcId);

        if (row === null) {
            throw new FoodNotFoundError(fdcId);
        }

        const status = row.fetchStatus as FetchStatus;

        if (status === 'fetched') {
            return { fdcId, status, food: this.toFoodResponse(row, this.isStale(row.fetchedAt)) };
        }

        if (status === 'pending') {
            return { fdcId, status, estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS_STATUS };
        }

        return { fdcId, status };
    }

    /**
     * Resolve `GET /v1/foods/{fdcId}/nutrients` (FR-002). Returns the full nutrient breakdown
     * including nulls; the food must already be fetched.
     *
     * @param fdcId - Validated FDC id.
     * @returns The full {@link FoodResponse} (nutrients included).
     * @throws {FoodNotFoundError} when the food is not yet fetched (→ 404 with a pending hint).
     */
    public async getNutrients(fdcId: number): Promise<FoodResponse> {
        const row = await this.repository.findByFdcId(fdcId);

        if (row === null || (row.fetchStatus !== 'fetched' && row.fetchStatus !== 'stale')) {
            throw new FoodNotFoundError(fdcId);
        }

        return this.toFoodResponse(row, row.fetchStatus === 'stale' || this.isStale(row.fetchedAt));
    }

    /**
     * Resolve `GET /v1/foods/search?query=` (FR-008–FR-010). Local-only; never calls USDA.
     *
     * @param query - The raw query (may be empty/whitespace).
     * @returns Ranked results, or an empty list for an empty/whitespace/no-match query.
     */
    public async search(query: string): Promise<FoodSearchResponse> {
        const trimmed = query.trim();

        if (trimmed.length === 0) {
            return { foods: [] };
        }

        const foods = await this.repository.search(trimmed);

        return { foods };
    }

    /**
     * Resolve `GET /v1/foods/autocomplete?query=` (FR-008). Local-only; never calls USDA.
     *
     * @param query - The raw query.
     * @returns Up to 10 ranked suggestions, or an empty list.
     */
    public async autocomplete(query: string): Promise<{ suggestions: FoodSearchResponse['foods'] }> {
        const trimmed = query.trim();

        if (trimmed.length === 0) {
            return { suggestions: [] };
        }

        const suggestions = await this.repository.autocomplete(trimmed);

        return { suggestions };
    }

    /** Enqueue a single food for backfill (deduped). */
    private async enqueue(fdcId: number, requestedBy: string): Promise<void> {
        await this.fetchQueue.publishFoodRequested({
            fdcId,
            requestedAt: new Date().toISOString(),
            requestedBy,
        });
    }

    /** A `fetched` record is stale when `fetched_at` is older than the threshold (FR-031). */
    private isStale(fetchedAt: Date | null): boolean {
        if (fetchedAt === null) {
            return false;
        }

        const ageMs = Date.now() - new Date(fetchedAt).getTime();

        return ageMs > this.staleThresholdDays * MILLIS_PER_DAY;
    }

    /** A tombstone is eligible for re-attempt once older than the tombstone TTL (FR-025). */
    private isTombstoneExpired(reference: Date | null): boolean {
        if (reference === null) {
            return false;
        }

        const ageMs = Date.now() - new Date(reference).getTime();

        return ageMs > this.tombstoneTtlDays * MILLIS_PER_DAY;
    }

    /** Coerce a `pg` numeric (string|number|null) to a `number | null`. */
    private toNumber(value: unknown): number | null {
        if (value === null || value === undefined) {
            return null;
        }

        const n = Number(value);

        return Number.isNaN(n) ? null : n;
    }

    /** Map a DB row to the public {@link FoodResponse}; nulls are kept, not omitted. */
    private toFoodResponse(row: FoodRow, stale: boolean): FoodResponse {
        const nutrients: FoodNutrients = {
            calories: this.toNumber(row.calories),
            proteinG: this.toNumber(row.proteinG),
            carbsG: this.toNumber(row.carbsG),
            fatG: this.toNumber(row.fatG),
            fiberG: this.toNumber(row.fiberG),
            sodiumMg: this.toNumber(row.sodiumMg),
            sugarG: this.toNumber(row.sugarG),
            saturatedFatG: this.toNumber(row.saturatedFatG),
            cholesterolMg: this.toNumber(row.cholesterolMg),
            vitaminAIu: this.toNumber(row.vitaminAIu),
            vitaminCMg: this.toNumber(row.vitaminCMg),
            calciumMg: this.toNumber(row.calciumMg),
            ironMg: this.toNumber(row.ironMg),
        };

        const response: FoodResponse = {
            fdcId: row.fdcId,
            description: row.description,
            dataType: row.dataType,
            nutrients,
            fetchStatus: stale ? 'stale' : (row.fetchStatus as FetchStatus),
        };

        if (stale) {
            response.stale = true;
        }

        return response;
    }
}
