/**
 * `FoodsService` (ARCH-001, MOD-001) — transport-agnostic business logic for `/api/v1/foods/*`, rewired onto
 * the source-agnostic per-aggregate DAOs, the source-adapter registry, the merge service, the rolling-
 * window limiter, the {@link EnqueueEmitter}, and the {@link AdmissionService} (T-130). Every food is
 * keyed by its internal `id`; no source-native key (`fdcId`) ever appears (FR-IDN-1/SC-013).
 *
 * Lifecycle status codes (mapped by `FoodsController`): a read returns the golden record only when
 * `RESOLVED` (else `FoodPendingError` → 202 for `PENDING`/`UNRESOLVED`, `FoodNotFoundError` → 404 for
 * `NOT_FOUND`/`FAILED`/no row). Add-by-name dedups + enqueues (202 + `id`); `PATCH`-resolve is
 * `UNRESOLVED`-only, idempotent, candidate-in-set validated, re-fetches the pick through the limiter, and
 * merges to `RESOLVED`.
 *
 * @implements FR-002 FR-003 FR-004 FR-005 FR-007 FR-008 FR-012 FR-013 FR-028a FR-045 FR-RES-1 FR-RES-2
 */
import { Injectable } from '@nestjs/common';

import { AdmissionService } from './admission.service.js';
import { CandidateStore, FoodDao, FoodSourcesDao, type FoodStatus, type GoldenFoodRecord } from './dao/index.js';
import { FoodSearchDao } from './dao/foodSearch.dao.js';
import { EnqueueEmitter } from './enqueue.emitter.js';
import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from './foods.errors.js';
import { normalizeName, sanitizeFoodName } from './foodName.js';
import { MergeAndPersistService } from './merge/mergeAndPersist.service.js';
import { normalizePortions } from './nutrition/portionNormalization.js';
import { projectNutrition } from './nutrition/nutrientSelection.js';
import type {
    AddResponse,
    BatchItemView,
    BatchResponse,
    CandidatesResponse,
    FoodNutrition,
    FoodNutritionBatchResponse,
    FoodResponse,
    ResolveResponse,
    SearchResponse,
    StatusResponse,
} from './foods.schema.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';
import { isSourceApiError } from '../sources/foodSource.errors.js';
import { type CanonicalCandidate, type FoodSourceId } from '../sources/foodSourceAdapter.js';
import { FoodMetrics } from '../observability/emfMetrics.js';
import { RollingWindowLimiter } from '../sources/RollingWindowLimiter.js';

/** Estimated wait reported on a fresh enqueue (plan §3). */
const ESTIMATED_WAIT_SECONDS = 30;

/** Retry-After (seconds) when a `PATCH`-resolve cannot draw from the rolling-window budget (DSN-6). */
const RESOLVE_RETRY_AFTER_SECONDS = 30;

@Injectable()
export class FoodsService {
    public constructor(
        private readonly foodDao: FoodDao,
        private readonly candidates: CandidateStore,
        private readonly sources: FoodSourcesDao,
        private readonly searchDao: FoodSearchDao,
        private readonly merge: MergeAndPersistService,
        private readonly enqueue: EnqueueEmitter,
        private readonly registry: SourceAdapterRegistry,
        private readonly limiter: RollingWindowLimiter,
        private readonly admission: AdmissionService,
        private readonly metrics: FoodMetrics,
    ) {}

    /**
     * `GET /api/v1/foods/{id}` — golden-record read with lifecycle status codes (FR-002/FR-003/FR-004).
     *
     * @param id - The internal food id.
     * @returns The golden record (200) when `RESOLVED`.
     * @throws {FoodPendingError} (→ 202) for `PENDING`/`UNRESOLVED`.
     * @throws {FoodNotFoundError} (→ 404) for `NOT_FOUND`/`FAILED`/no row.
     * @sideEffect Emits one local-store serve-rate observation (SC-004/SC-005).
     */
    public async getFood(id: string): Promise<FoodResponse> {
        const record = await this.foodDao.readGoldenRecord(id);

        // SC-004/SC-005: this is the ONE path that knows whether the local store could answer a read
        // without a source fetch, so it is where the serve rate is observed — before the branch, so every
        // outcome (200 / 202 / 404) contributes exactly one observation and the ratio cannot be skewed by a
        // thrown error. `getStatus`/`search` are deliberately NOT counted: neither can ever reach a source,
        // so including them would push the rate toward 100% by construction and hide a cold store.
        this.metrics.recordLocalStoreServe(record?.status === 'RESOLVED');

        if (record === null) {
            throw new FoodNotFoundError(id);
        }

        if (record.status === 'RESOLVED') {
            return this.toFoodResponse(record);
        }

        if (record.status === 'PENDING' || record.status === 'UNRESOLVED' || record.status === 'AWAITING_RETRY') {
            // `AWAITING_RETRY` answers 202 like `PENDING`, because the food IS still going to be attempted.
            // Answering 404 would tell a client to give up on a food the worker retries minutes later.
            throw new FoodPendingError(
                id,
                record.status,
                record.status === 'PENDING' || record.status === 'AWAITING_RETRY' ? ESTIMATED_WAIT_SECONDS : undefined,
            );
        }

        // NOT_FOUND / FAILED — status still retrievable (FR-004).
        throw new FoodNotFoundError(id, record.status);
    }

    /**
     * `GET /api/v1/foods/nutrition?ids=…` — the batch projection (KTD-3, plan U8).
     *
     * ⛔ **Caller-independent, and that is a standing invariant.** ADR-0020 keys food's CloudFront
     * distribution on the URL ALONE, which is only sound while this response depends on nothing about the
     * caller. Nothing derived from the requester may enter it.
     *
     * Reads only. It never enqueues and never fetches from a source: this is the path a recipe list hits
     * once per render, and making it capable of triggering resolution would turn a read into an unbounded
     * fan-out of source calls.
     *
     * An id that names no row at all is reported in `unknownIds` rather than omitted, because a silently
     * shorter array is indistinguishable from a food with no nutrition — and the caller cannot tell whether
     * to show "unknown" or "none".
     *
     * @param ids - The canonical (sorted, de-duplicated, capped) id list.
     * @returns One entry per known id, in the given order, plus the ids that matched nothing.
     */
    public async getNutritionBatch(ids: readonly string[]): Promise<FoodNutritionBatchResponse> {
        // ONE batched read (3 statements), not `ids.map(readGoldenRecord)` — which was 1+4 statements PER
        // ID, i.e. ~500 round trips for the 100-id request a recipe list issues on every render.
        const records = await this.foodDao.readNutritionBatch(ids);
        const byId = new Map(records.map((record) => [record.id, record]));

        const foods: FoodNutrition[] = [];
        const unknownIds: string[] = [];

        // Driven by `ids`, not by the rows: a batched `WHERE food_id = ANY(...)` promises no row order, and
        // the response order is part of what the edge caches under the canonical URL (ADR-0020).
        for (const id of ids) {
            const record = byId.get(id);

            if (record === undefined) {
                unknownIds.push(id);
                continue;
            }

            // The projection runs regardless of status: a food that is PENDING or FAILED still reports its
            // status here, with whatever nutrients it has (usually none). The caller decides what to render
            // — this endpoint does not decide on their behalf by withholding the row.
            foods.push({
                id,
                status: record.status,
                // Mapped at the seam rather than widening the projection's input type. Stored amounts are
                // STRINGS on purpose (arbitrary precision, no float drift — SC-008); the projection works in
                // numbers because the wire contract does, and this is the one place that conversion happens.
                ...projectNutrition(
                    record.nutrients.map((nutrient) => ({
                        nutrient: nutrient.nutrient,
                        amount: Number(nutrient.amount),
                        unit: nutrient.unit,
                        basis: nutrient.basis,
                    })),
                ),
                portions: normalizePortions(
                    record.portions.map((portion) => ({
                        label: portion.label,
                        gramWeight: Number(portion.gramWeight),
                    })),
                ),
            });
        }

        return { foods, unknownIds };
    }

    /**
     * `GET /api/v1/foods/{id}/status` — lifecycle poll, never enqueues, never fetches (FR-007).
     *
     * @param id - The internal food id.
     * @returns The status (plus the golden record when `RESOLVED`).
     * @throws {FoodNotFoundError} (→ 404) when no row exists.
     */
    public async getStatus(id: string): Promise<StatusResponse> {
        const record = await this.foodDao.readGoldenRecord(id);

        if (record === null) {
            throw new FoodNotFoundError(id);
        }

        if (record.status === 'RESOLVED') {
            return { id, status: record.status, food: this.toFoodResponse(record) };
        }

        if (record.status === 'PENDING') {
            return { id, status: record.status, estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        return { id, status: record.status };
    }

    /**
     * `GET /api/v1/foods/{id}/candidates` — the persisted cross-source candidate set for an `UNRESOLVED`
     * food (FR-RES-1). A non-`UNRESOLVED` food returns an empty set.
     *
     * @param id - The internal food id.
     * @returns The (non-expired) candidate set.
     * @throws {FoodNotFoundError} (→ 404) when no row exists.
     */
    public async getCandidates(id: string): Promise<CandidatesResponse> {
        const food = await this.foodDao.getById(id);

        if (!food) {
            throw new FoodNotFoundError(id);
        }

        if (food.status !== 'UNRESOLVED') {
            return { id, candidates: [] };
        }

        const rows = await this.candidates.getCandidates(id);

        return {
            id,
            candidates: rows.map((row) => ({
                candidateId: row.id,
                source: row.source,
                externalKey: row.externalKey,
                name: row.name,
                summary: row.summary,
            })),
        };
    }

    /**
     * `GET /api/v1/foods/search?query=` — local fuzzy/substring search + barcode/external-key crosswalk
     * lookup → internal `id`s (FR-008). NEVER calls a source (FR-009).
     *
     * @param rawQuery - The raw query (may be empty/whitespace).
     * @returns Ranked results, or an empty set on no local match.
     */
    public async search(rawQuery: string): Promise<SearchResponse> {
        const query = rawQuery.trim();

        if (query.length === 0) {
            return { results: [] };
        }

        const hits = await this.searchDao.search(query);
        const results = hits.map((hit) => ({ id: hit.id, name: hit.name, score: hit.score }));

        // Crosswalk: a query that is a known barcode or source external_key resolves directly to an id.
        const crosswalkId =
            (await this.sources.findFoodIdByBarcode(query)) ??
            (await this.sources.findFoodIdByExternalKey('usda', query));

        if (crosswalkId !== undefined && !results.some((result) => result.id === crosswalkId)) {
            const food = await this.foodDao.getById(crosswalkId);
            results.unshift({ id: crosswalkId, name: food?.name ?? null, score: 1 });
        }

        return { results };
    }

    /**
     * `POST /api/v1/foods` — add-by-name: dedup on normalized name, enqueue a fresh add/reactivation, and
     * return `202` + `id` (FR-005/FR-013/FR-028a). An add for an existing non-terminal food returns its
     * current status WITHOUT enqueuing (no scarce source budget burned).
     *
     * @param name - The display name (already validated non-empty by the controller).
     * @param requesterId - The requester key (CR-002/U1: app-user ULID or `svc_*`).
     * @returns The id + resulting status.
     * @throws {FetchUnavailableError} (→ 503) when a fresh enqueue is shed by backpressure.
     */
    public async addByName(name: string, requesterId: string): Promise<AddResponse> {
        // The catalog's display name and its identity key are derived from ONE sanitized string, so they can
        // never disagree about which characters count. Idempotent — the controller has already canonicalized a
        // request-borne name, but a future in-process caller has not, and the write point is what must hold.
        const displayName = sanitizeFoodName(name);
        const result = await this.foodDao.createByName({ normalizedName: normalizeName(displayName), displayName });

        if (result.created || result.reactivated) {
            await this.admission.admit(requesterId);
            await this.enqueue.publishFoodRequested({
                id: result.id,
                requestedBy: requesterId,
                reactivate: result.reactivated,
            });

            return { id: result.id, status: 'PENDING', estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        const food = await this.foodDao.getById(result.id);
        const status: FoodStatus = food?.status ?? 'PENDING';

        // FR-025a: an UNRESOLVED food whose candidate set has expired (the 30-day TTL) re-fans-out on the
        // next add-by-name against the normal budget. `getCandidates` is TTL-filtered, so an empty set
        // means the disambiguation choices have aged out; re-enqueue to re-run the fan-out. The food stays
        // UNRESOLVED until the worker re-resolves it — it is never swept to NOT_FOUND.
        if (status === 'UNRESOLVED' && (await this.candidates.getCandidates(result.id)).length === 0) {
            await this.admission.admit(requesterId);
            await this.enqueue.publishFoodRequested({ id: result.id, requestedBy: requesterId, reactivate: true });

            return { id: result.id, status, estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        return { id: result.id, status };
    }

    /**
     * `POST /api/v1/foods/batch` — per-item partial add-by-name (FR-012/FR-045). Intra-batch dedup collapses
     * a repeated name to one row; a locally-`RESOLVED` hit is returned inline; a miss is created +
     * enqueued and returned `PENDING`. The caller-side ≤100 cap is enforced in the controller.
     *
     * @param names - The names to add (post-cap).
     * @param requesterId - The requester key (CR-002/U1: app-user ULID or `svc_*`).
     * @returns Per-item results (inline hits + pending misses).
     * @throws {FetchUnavailableError} (→ 503) when the batch is shed by backpressure.
     */
    public async batchAdd(names: string[], requesterId: string): Promise<BatchResponse> {
        // Intra-batch dedup: collapse repeated names (by normalized key) to one item, first-wins.
        const unique = new Map<string, string>();

        for (const name of names) {
            const displayName = sanitizeFoodName(name);
            const key = normalizeName(displayName);

            if (key.length > 0 && !unique.has(key)) {
                unique.set(key, displayName);
            }
        }

        const willEnqueue: string[] = [];
        const items: BatchItemView[] = [];

        for (const [key, displayName] of unique) {
            const result = await this.foodDao.createByName({ normalizedName: key, displayName });

            if (result.created || result.reactivated) {
                willEnqueue.push(result.id);
                items.push({ id: result.id, status: 'PENDING', estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS });

                continue;
            }

            const food = await this.foodDao.getById(result.id);

            if (food?.status === 'RESOLVED') {
                items.push({ id: result.id, status: 'RESOLVED', name: food.name });
            } else {
                items.push({
                    id: result.id,
                    status: food?.status ?? 'PENDING',
                    estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS,
                });
            }
        }

        if (willEnqueue.length > 0) {
            await this.admission.admit(requesterId);
            await this.enqueue.publishFoodBatchRequested({
                foods: items
                    .filter((item) => willEnqueue.includes(item.id))
                    .map((item) => ({ id: item.id, reactivate: true })),
                requestedBy: requesterId,
            });
        }

        return { items };
    }

    /**
     * `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2): `UNRESOLVED`-only +
     * idempotent; validate each pick is in this food's candidate set; re-fetch each pick through the
     * rolling-window limiter; merge → `RESOLVED` and clear the candidate set. A re-fetch failure leaves
     * the food `UNRESOLVED` with its candidate set intact (TST-2).
     *
     * TAKES NO REQUESTER KEY, unlike every enqueue path. A resolve draws from the limiter's reserved headroom
     * (DSN-6) rather than a requester's budget and writes no `fetch_requesters` row, so there is nothing a
     * requester key would key. It formerly accepted one as `_requesterId` — never read, not even logged — so a
     * value was derived in the controller and discarded here; see `FoodsController.patchResolve`.
     *
     * @param id - The internal food id.
     * @param candidateIds - The picked candidate row ids.
     * @returns The id + `RESOLVED` status.
     * @throws {FoodNotFoundError} (→ 404) when no row exists.
     * @throws {NotResolvableError} (→ 409) when the food is not `UNRESOLVED` (and not an idempotent `RESOLVED`).
     * @throws {CandidateMismatchError} (→ 409) when a pick is not in the food's candidate set.
     * @throws {FetchUnavailableError} (→ 503) when the re-fetch cannot draw from the rolling-window budget.
     */
    public async patchResolve(id: string, candidateIds: string[]): Promise<ResolveResponse> {
        const food = await this.foodDao.getById(id);

        if (!food) {
            throw new FoodNotFoundError(id);
        }

        if (food.status === 'RESOLVED') {
            return { id, status: 'RESOLVED' }; // idempotent no-op (FR-RES-2)
        }

        if (food.status !== 'UNRESOLVED') {
            throw new NotResolvableError(id, food.status);
        }

        // Validate every pick is a member of THIS food's candidate set (else 409, status unchanged).
        const set = await this.candidates.getCandidates(id);
        const byId = new Map(set.map((row) => [row.id, row]));
        const picks = candidateIds.map((candidateId) => {
            const row = byId.get(candidateId);

            if (!row) {
                throw new CandidateMismatchError(id);
            }

            return row;
        });

        // Re-fetch each picked candidate through the SAME rolling-window limiter the worker uses (DSN-6):
        // resolve never makes an unrecorded source call. At the hard cap → 503 Retry-After (a retryable
        // signal, never a 429). A re-fetch failure aborts WITHOUT clearing the candidate set (TST-2).
        const refetched: CanonicalCandidate[] = [];

        for (const pick of picks) {
            const source = pick.source as FoodSourceId;
            const window = await this.limiter.tryRecord(source);

            if (!window.allowed) {
                throw new FetchUnavailableError(RESOLVE_RETRY_AFTER_SECONDS);
            }

            try {
                refetched.push(await this.registry.adapterFor(source).fetchByKey(pick.externalKey));
            } catch (error) {
                if (isSourceApiError(error)) {
                    throw new FetchUnavailableError(
                        RESOLVE_RETRY_AFTER_SECONDS,
                        'Source re-fetch failed; food unchanged',
                    );
                }

                throw error;
            }
        }

        await this.merge.resolveFromPicks({ foodId: id, picks: refetched });

        return { id, status: 'RESOLVED' };
    }

    /**
     * `POST /api/v1/foods/{id}/refetch` — operational manual re-enqueue (admin-scoped; the scope gate is in
     * the controller, FR-039). Re-enqueues the food (reactivating its queue row).
     *
     * @param id - The internal food id.
     * @param requesterId - The verified admin requester key (FR-048 provenance; app-user ULID or `svc_*`).
     * @returns The id + `PENDING`-ish accepted status.
     * @throws {FoodNotFoundError} (→ 404) when no row exists.
     */
    public async refetch(id: string, requesterId: string): Promise<AddResponse> {
        const food = await this.foodDao.getById(id);

        if (!food) {
            throw new FoodNotFoundError(id);
        }

        await this.enqueue.publishFoodRequested({ id, requestedBy: requesterId, reactivate: true });

        return { id, status: food.status, estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
    }

    /** Map a {@link GoldenFoodRecord} to the public {@link FoodResponse} (source-tagged, no `fdcId`). */
    private toFoodResponse(record: GoldenFoodRecord): FoodResponse {
        const sourceById = new Map(record.sources.map((source) => [source.id, source.source]));
        const sourceOf = (sourceId: string): string => sourceById.get(sourceId) ?? 'unknown';

        const provenance: Record<string, string> = {};

        for (const entry of record.fieldProvenance) {
            provenance[entry.field] = sourceOf(entry.sourceId);
        }

        return {
            id: record.id,
            name: record.name,
            description: record.description,
            kind: record.kind,
            status: record.status,
            nutrients: record.nutrients.map((nutrient) => ({
                nutrient: nutrient.name,
                amount: Number(nutrient.amount),
                unit: nutrient.unit,
                basis: nutrient.basis,
                source: sourceOf(nutrient.sourceId),
            })),
            portions: record.portions.map((portion) => ({
                label: portion.label,
                gramWeight: Number(portion.gramWeight),
                source: sourceOf(portion.sourceId),
            })),
            provenance,
        };
    }
}
