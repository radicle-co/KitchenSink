/**
 * `FoodsService` (ARCH-001, MOD-001) — transport-agnostic business logic for `/api/v1/foods/*`, rewired onto
 * the source-agnostic per-aggregate DAOs, the source-adapter registry, the merge service, the rolling-
 * window limiter, and the {@link EnqueueEmitter}. Every food is keyed by its internal `id`; no
 * source-native key (`fdcId`) ever appears (FR-IDN-1/SC-013).
 *
 * ⛔ There is no admission control here, and there is not going to be (owner ruling 2026-09-15: "we can't
 * add a cap — restricting our users and bulk imports would be a bad business decision"). `AdmissionService`
 * used to refuse an add once the queue was deep, which turned a slow queue into a refused user. The queue's
 * guarantee is that it stays fast, never that it stays short: external limits PACE the drain (FR-019), they
 * do not refuse the person asking.
 *
 * Lifecycle status codes (mapped by `FoodsController`): a read returns the golden record only when
 * `RESOLVED` (else `FoodPendingError` → 202 for `PENDING`/`UNRESOLVED`, `FoodNotFoundError` → 404 for
 * `NOT_FOUND`/`FAILED`/no row). Add-by-name dedups + enqueues (202 + `id`); `PATCH`-resolve is
 * `UNRESOLVED`-only, idempotent, candidate-in-set validated, re-fetches the pick through the limiter, and
 * merges to `RESOLVED`.
 *
 * @implements FR-002 FR-003 FR-004 FR-005 FR-007 FR-008 FR-012 FR-013 FR-028a FR-045 FR-RES-1 FR-RES-2
 */
import { Injectable, Optional } from '@nestjs/common';
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import { isIllegalStatusTransitionError } from './dao/dao.errors.js';
import { FetchQueueDao } from './dao/fetchQueue.dao.js';
import { FoodDao, type FoodStatus, type GoldenFoodRecord, type StoredNutrientAmount } from './dao/food.dao.js';
import { CandidateStore } from './dao/foodCandidates.dao.js';
import { FoodSourcesDao } from './dao/foodSources.dao.js';
import { apiError } from '../common/apiError.js';
import { nutritionEntryFor } from './nutrition/nutritionEntry.js';
import { FoodSearchDao, type CatalogSearchHit } from './dao/foodSearch.dao.js';
import { EnqueueEmitter } from './enqueue.emitter.js';
import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from './foods.errors.js';
import { normalizeName } from './foodName.js';
import { MergeAndPersistService } from './merge/mergeAndPersist.service.js';
import { evaluateAuthorship, type AuthorshipFoodFacts } from './domain/authorshipPolicy.js';
import { resolveFoodRefs } from './domain/foodRefResolution.js';
import { nutritionTargetOf } from './domain/nutritionTargets.js';
import { refetchRefusalOf, refetchRefusalReason } from './domain/refetchPolicy.js';
import { DuplicateAuthoredNameError, NotEditableError, NotFoodAuthorError } from './foods.errors.js';
import { AuthoredFoodsDao } from './dao/authoredFoods.dao.js';
import { projectStoredNutrition } from './nutrition/nutrientSelection.js';
import { FoodVariantDao, type LiveVariant } from './dao/foodVariant.dao.js';
import { leftoverTokens, matchVariant, namesOf } from './domain/variantQueryMatch.js';
import { ownerVariantView, variantViewOf } from './domain/variantView.js';
import { CatalogOwnerReader } from './catalogOwnerReader.service.js';
import type {
    VariantView,
    AddResponse,
    AuthoredFoodSearchResponse,
    BatchItemView,
    BatchResponse,
    CandidatesResponse,
    CatalogSearchResponse,
    FoodNutrition,
    FoodNutritionBatchResponse,
    FoodRef,
    FoodResponse,
    ResolveFoodRefsResponse,
    ResolveResponse,
    SearchResponse,
    StatusResponse,
    CreateAuthoredFoodRequest,
    UpdateAuthoredFoodRequest,
    CatalogFoodStatus,
} from './foods.schema.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';
import { isSourceAdmissionError, isSourceApiError } from '../sources/foodSource.errors.js';
import { retryOnceWhenSoon } from '../sources/transport/busyRetry.js';
import { type CanonicalCandidate, type FoodSourceId } from '../sources/foodSourceAdapter.js';
import { FoodMetrics } from '../observability/emfMetrics.js';

/**
 * Estimated wait reported on a fresh enqueue (plan §3).
 *
 * ⚠️ It shares a number with FR-018's ORIGINAL lease window and shares nothing else with it — checked when
 * U5 derived that window to 250s and deliberately left this alone. This is a hint about the NORMAL path,
 * where a resolve is two USDA calls and lands in a second or two; the lease bounds the WORST case, and a
 * claim only reaches it after a hard kill with no graceful release. Raising this to match the lease would
 * tell every caller to expect four minutes for work that takes two seconds.
 */
const ESTIMATED_WAIT_SECONDS = 30;

/** Retry-After (seconds) when a `PATCH`-resolve cannot draw from the rolling-window budget (DSN-6). */
const RESOLVE_RETRY_AFTER_SECONDS = 30;

/** The longest a `PATCH`-resolve waits on a busy source before answering 503 (U27 blueprint). */
const RESOLVE_WAIT_MAX_MS = 2_000;

/**
 * Narrow a stored lifecycle status to the PUBLISHED wire enum (plan U18).
 *
 * `DELETING` is a store-internal tombstone that never reaches the wire: an already-shipped client's
 * `foodStatusSchema` would REFUSE the unknown member, so the read paths that can observe it answer 404
 * instead (`getFood`/`getStatus`). The three sites that call THIS helper — add-by-name, batch add, and
 * the nutrition batch — cannot observe it by construction (all three read CATALOG rows only, and only
 * AUTHORED foods are ever tombstoned), so here it is a thrown defect, not a mapping. Pure.
 */
function publishableStatusOf(status: FoodStatus): Exclude<FoodStatus, 'DELETING'> {
    if (status === 'DELETING') {
        throw new Error('DELETING is store-internal and must not reach the wire (U18)');
    }

    return status;
}

/**
 * Narrow further, to the statuses a CATALOG (`user_id IS NULL`) food can report — {@link CatalogFoodStatus}.
 *
 * Composed over {@link publishableStatusOf} rather than restating its list: the two differ by exactly one
 * member, and a second total list over the same union is a copy that cannot detect its own staleness.
 *
 * ⛔ `WITHDRAWN` is a thrown DEFECT here, not a mapping, and the assertion is safe in BOTH directions.
 * Only an AUTHORED food can be withdrawn — `deleteAuthored` runs `evaluateAuthorship`, which answers
 * `not-editable` for any pipeline row — and the three callers all read CATALOG rows by construction:
 * add-by-name and batch-add dedup through `FoodDao.createByName`, whose CTE is
 * `WHERE normalized_name = … AND user_id IS NULL`. Neither direction can be crossed without a code change
 * that would fail this assertion loudly rather than emitting a status the response schema forbids.
 *
 * ⚠️ `refetch` is deliberately NOT a caller: it reads ANY row by id, so a withdrawn food is genuinely
 * reachable there and gets a real refusal instead of this defect throw. Pure.
 */
function catalogStatusOf(status: FoodStatus): CatalogFoodStatus {
    const published = publishableStatusOf(status);

    if (published === 'WITHDRAWN') {
        throw new Error('WITHDRAWN is authored-only and cannot describe a catalog row (0016)');
    }

    return published;
}

/**
 * THE read gate every by-id read shares (plan U10): `GET /{id}`, `GET /{id}/status` and `GET /{id}/candidates`.
 *
 * A reader the authorship policy does not admit gets the SAME {@link FoodNotFoundError} a missing id gets — no
 * status detail, identical message — so no by-id route can confirm another user's private food exists. One
 * definition, because the defect it closes was exactly two routes that did not run the check `getFood` ran.
 *
 * @param id - The food id the caller named.
 * @param food - The food's two authorship facts.
 * @param callerId - The verified caller's requester key; a `svc_*` principal is a stranger to every authored food.
 * @throws {FoodNotFoundError} when the policy does not allow the read. Otherwise pure.
 */
function requireReadable(id: string, food: AuthorshipFoodFacts, callerId: string): void {
    if (evaluateAuthorship({ callerId, food, action: 'read' }).kind !== 'allowed') {
        throw new FoodNotFoundError(id);
    }
}

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
        private readonly metrics: FoodMetrics,
        /** The authored-foods write path (plan U10). */
        private readonly authored: AuthoredFoodsDao,
        /** Curated U8: a root's variants, for the read that lists them (R17). */
        private readonly variants: FoodVariantDao,
        /** Curated U8 S4: the one reader from a source item to the live catalog entry standing for it (R19). */
        private readonly owners: CatalogOwnerReader,
        /**
         * U19: the sync queue, for corroborated completion. `@Optional` for unit fixtures only — the
         * module always provides it, and {@link FoodsService.corroborateFood} REFUSES rather than
         * half-completes without it (a completed food still in the scan would re-sync and clobber).
         */
        @Optional() private readonly fetchQueue?: FetchQueueDao,
    ) {}

    /**
     * `POST /api/v1/foods/{id}/corroborated` (plan U19, R10's second clause) — a PENDING catalog food
     * whose identity was CORROBORATED by independent corrections is marked complete and LEAVES the sync
     * queue: the community's agreement IS the identity source for a novel name USDA will never carry, and
     * keeping it in the scan burns the shared source budget on a fetch that cannot land.
     *
     * ⛔ PENDING only, and a NO-OP everywhere else: the trigger is an ASYNC quality signal fired by the
     * recipe side's corroboration promotion, not a command — an already-synced food, a food awaiting
     * disambiguation, or a terminal one is answered with its CURRENT status and left exactly as it was.
     * (`UNRESOLVED` in particular must not complete: it means "several candidates, a human must pick",
     * and corroboration of the PHRASE says nothing about which candidate.)
     *
     * ⚠️ Residual, stated rather than hidden: the route trusts the CALLER's assertion that a promotion
     * happened — the promotion lives in the recipe database this service cannot read (ADR-0006). The
     * blast radius is one PENDING food completing dataless (its nutrition stays honestly absent), and
     * the operator `requeue` route is the repair. A signed cross-service attestation is the upgrade if
     * abuse appears.
     *
     * @param id - The food id.
     * @returns The food's (possibly unchanged) status.
     * @throws {FoodNotFoundError} when no such food exists.
     * @sideEffect May transition `food.status` and clear the food's `fetch_queue`/`fetch_requesters` rows.
     */
    public async corroborateFood(id: string): Promise<{ id: string; status: Exclude<FoodStatus, 'DELETING'> }> {
        const record = await this.foodDao.readGoldenRecord(id);

        if (record === null || record.status === 'DELETING') {
            // DELETING never reaches the wire (U18's 404 branch, mirrored): a mid-erasure food IS gone.
            throw new FoodNotFoundError(id);
        }

        if (record.status !== 'PENDING') {
            return { id, status: record.status };
        }

        if (this.fetchQueue === undefined) {
            throw new Error('corroborateFood requires the fetch queue; refusing a half-completion.');
        }

        // Status FIRST (the recovery service's ordering rule, mirrored): if the queue clear ran first and
        // this threw, the food would have left the scan while still reading PENDING to every caller.
        //
        // ⛔ `from: ['PENDING']` makes this a compare-and-set rather than a check-then-act. The guard above
        // read `record.status` in an EARLIER statement, and `LEGAL_PRIORS.RESOLVED` admits `UNRESOLVED` —
        // so a food that moved `PENDING → UNRESOLVED` in between (a legal move, made by the disambiguation
        // path) was completed anyway: published as resolved having never been disambiguated, with nothing
        // downstream able to tell. Naming the observed prior makes the row's own state the arbiter, and a
        // row that moved refuses with `IllegalStatusTransitionError` instead of silently completing.
        await this.foodDao.setStatus({ id, status: 'RESOLVED', from: ['PENDING'] });
        // ⛔ 'out-of-band' is the DELIBERATE lease-fence bypass (R16), spelled as a literal so it is
        // greppable and cannot be reached by omitting an argument. This caller holds no claim — it is the
        // API completing a food beside the drainer — so it has no fence to present and must be able to
        // clear the row regardless of who is draining it. A drainer whose claim this clears finds its own
        // settle refused, which is the correct order: the corroboration already decided the outcome.
        await this.fetchQueue.resolve(id, 'out-of-band');

        return { id, status: 'RESOLVED' };
    }

    /**
     * `GET /api/v1/foods/{id}` — golden-record read with lifecycle status codes (FR-002/FR-003/FR-004).
     *
     * @param id - The internal food id.
     * @returns The golden record (200) when `RESOLVED`.
     * @throws {FoodPendingError} (→ 202) for `PENDING`/`UNRESOLVED`.
     * @throws {FoodNotFoundError} (→ 404) for `NOT_FOUND`/`FAILED`/no row.
     * @sideEffect Emits one local-store serve-rate observation (SC-004/SC-005).
     */
    public async getFood(id: string, callerId: string): Promise<FoodResponse> {
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

        // ⛔ AUTHORIZATION FIRST (plan U10): a stranger reading a PRIVATE authored food gets the SAME
        // FoodNotFoundError a missing id gets — existence concealed; nothing below this line runs for them.
        requireReadable(id, record, callerId);

        if (record.status === 'RESOLVED') {
            return this.toFoodResponse(record, await this.liveVariantViewsOf(record));
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

        if (record.status === 'DELETING') {
            // U18's tombstone window: mid-delete is not a state the wire publishes — an old client's enum
            // would refuse it, and the honest external fact is "this food is going away". A plain 404,
            // with NO status detail (unlike the terminal pair below, whose statuses ARE retrievable facts).
            throw new FoodNotFoundError(id);
        }

        if (record.status === 'WITHDRAWN') {
            // The author withdrew it (0016). A plain 404 WITHOUT the status detail, for a typed reason and
            // not merely by analogy with `DELETING` above: `FoodNotFoundError`'s second argument is the
            // TERMINAL pair, and `foodErrorSchema`'s `FOOD_NOT_FOUND` arm publishes `details.status` as
            // `terminalFoodStatusSchema` — so putting `WITHDRAWN` there would emit a body an up-to-date
            // client REFUSES to parse.
            //
            // ⚠️ This route is not how a reader learns a food was withdrawn; `GET /{id}/status` is (a `200`
            // carrying the status and no `food` body). Ruling 5 wants a COOK told which of their recipe
            // lines lost its food, which recipe-service derives from that status — it does not want the
            // withdrawn food's own details served back.
            throw new FoodNotFoundError(id);
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
        // Curated U8 S6: an id names a root or a variant, and a retired one answers as its forward's live end — under
        // the REQUESTED id. `nutritionTargetOf` keeps the batch catalog-only, so nothing about a caller enters it.
        const facts = await this.owners.refFacts(
            ids.flatMap((id): FoodRef[] => [
                { kind: 'root', id },
                { kind: 'variant', id },
            ]),
        );
        const targets = new Map(ids.map((id) => [id, nutritionTargetOf(id, facts)]));
        const rootIds = [...new Set([...targets.values()].flatMap((t) => (t?.kind === 'root' ? [t.rootId] : [])))];
        const variantIds = [
            ...new Set([...targets.values()].flatMap((t) => (t?.kind === 'variant' ? [t.variantId] : []))),
        ];

        // ONE batched read per arm, not `ids.map(readGoldenRecord)` — which was 1+4 statements PER ID, i.e. ~500
        // round trips for the 100-id request a recipe list issues on every render.
        const [records, variantNutrition, withVariants] = await Promise.all([
            rootIds.length === 0 ? [] : this.foodDao.readNutritionBatch(rootIds),
            this.variants.readNutrition(variantIds),
            this.variants.liveVariantRoots(rootIds),
        ]);
        const byId = new Map(records.map((record) => [record.id, record]));
        const byVariant = new Map(variantNutrition.map((row) => [row.id, row]));

        const foods: FoodNutrition[] = [];
        const unknownIds: string[] = [];

        // Driven by `ids`, not by the rows: a batched `WHERE food_id = ANY(...)` promises no row order, and
        // the response order is part of what the edge caches under the canonical URL (ADR-0020).
        for (const id of ids) {
            const target = targets.get(id);

            if (target?.kind === 'variant') {
                const own = byVariant.get(target.variantId);

                // A variant has no state of its own (ADR-0050 §1): it reports its root's.
                foods.push(
                    nutritionEntryFor(id, {
                        id,
                        status: target.status,
                        nutrients: own?.nutrients ?? [],
                        portions: own?.portions ?? [],
                    }),
                );
                continue;
            }

            const record = target === undefined ? undefined : byId.get(target.rootId);

            if (target === undefined || record === undefined) {
                unknownIds.push(id);
                continue;
            }

            // The projection runs regardless of status: a food that is PENDING or FAILED still reports its
            // status here, with whatever nutrients it has (usually none). The caller decides what to render
            // — this endpoint does not decide on their behalf by withholding the row.
            //
            // ⚠️ `DELETING` cannot reach here: `readNutritionBatch` is `WHERE user_id IS NULL`, and only an
            // AUTHORED row is ever tombstoned. `nutritionEntryFor` throws on it anyway, as the assertion it
            // has always been — the authored batch below is where the case is genuinely reachable.
            foods.push({ ...nutritionEntryFor(id, record), hasLiveVariants: withVariants.has(target.rootId) });
        }

        return { foods, unknownIds };
    }

    /**
     * `GET /api/v1/foods/{id}/status` — lifecycle poll, never enqueues, never fetches (FR-007).
     *
     * ⛔ Behind the SAME read gate as {@link getFood}: this route answers a `200` carrying the golden record, so
     * without it a stranger could read a private food here that `GET /{id}` conceals.
     *
     * @param id - The internal food id.
     * @param callerId - The verified caller's requester key; a `svc_*` principal is a stranger to every
     *   authored food.
     * @returns The status (plus the golden record when `RESOLVED`).
     * @throws {FoodNotFoundError} (→ 404) when no row exists, or the caller may not read it.
     */
    public async getStatus(id: string, callerId: string): Promise<StatusResponse> {
        const record = await this.foodDao.readGoldenRecord(id);

        if (record === null) {
            throw new FoodNotFoundError(id);
        }

        requireReadable(id, record, callerId);

        if (record.status === 'RESOLVED') {
            return {
                id,
                status: record.status,
                food: this.toFoodResponse(record, await this.liveVariantViewsOf(record)),
            };
        }

        if (record.status === 'PENDING') {
            return { id, status: record.status, estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        if (record.status === 'DELETING') {
            // U18: the tombstone window never reaches the wire enum — see `getFood`'s branch.
            throw new FoodNotFoundError(id);
        }

        return { id, status: record.status };
    }

    /**
     * `POST /api/v1/foods/refs/resolve` (curated plan U8; KTD-15) — what THIS caller may know about each food a
     * recipe line names: a root, a variant under its root, or the live entry a retired ref forwards to, or the one
     * concealed `absent` answer.
     *
     * The I/O shell over the pure `resolveFoodRefs`: the owner reader reads the facts (variants and forwards
     * included), then the policy decides. Reads only — it never enqueues and never fetches from a source.
     *
     * @param refs - The validated refs (duplicates allowed; the answer carries each distinct ref once).
     * @param callerId - The verified caller's requester key.
     * @returns One entry per distinct ref, in order of first appearance.
     * @sideEffect Reads `food`, `food_variant`, `food_variant_part` and `food_forward` through the owner reader.
     */
    public async resolveRefs(refs: readonly FoodRef[], callerId: string): Promise<ResolveFoodRefsResponse> {
        return { entries: resolveFoodRefs(refs, await this.owners.refFacts(refs), callerId) };
    }

    /**
     * `GET /api/v1/foods/{id}/candidates` — the persisted cross-source candidate set for an `UNRESOLVED`
     * food (FR-RES-1). A non-`UNRESOLVED` food returns an empty set.
     *
     * ⛔ Behind the SAME read gate as {@link getFood}, evaluated before the candidate store is touched: the set
     * names the food's candidate matches, which is information about a private food a stranger must not get.
     * A food mid-erasure (`DELETING`) answers not-found, as it does on `GET /{id}` and `/status`.
     *
     * @param id - The internal food id.
     * @param callerId - The verified caller's requester key.
     * @returns The (non-expired) candidate set.
     * @throws {FoodNotFoundError} (→ 404) when no row exists, the food is mid-erasure, or the caller may not
     *   read it.
     */
    public async getCandidates(id: string, callerId: string): Promise<CandidatesResponse> {
        const food = (await this.foodDao.readRefFacts([id])).find((row) => row.id === id);

        if (food === undefined || food.status === 'DELETING') {
            throw new FoodNotFoundError(id);
        }

        requireReadable(id, food, callerId);

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
     * ⛔ **The FR-010a minimum is enforced HERE, not only in the DAO** (plan U37). This method issues THREE
     * reads — the ranked statement plus two crosswalk lookups — and the crosswalks do not go through
     * `FoodSearchDao`, so a gate that lived only there would still put two round trips on every keystroke of
     * a query the product has ruled unanswerable. Below the minimum the answer is an empty result set
     * reached with no query at all. Nothing is lost: a GTIN is 8–14 digits and a USDA `fdcId` 4–7, so no
     * identifier the crosswalk can resolve is shorter than `MIN_SEARCH_QUERY_LENGTH`.
     *
     * ⚠️ It answers `200` with an empty set rather than `400`: FR-010a says the system "returns no results
     * and says so", and the "says so" is the localized empty state both clients render. A `400` would make a
     * debouncing typeahead model a normal keystroke as an error.
     *
     * @param rawQuery - The raw query (may be empty/whitespace/below the minimum).
     * @returns Ranked results; an empty set on no local match, and an empty set with NO read at all when the
     *   query is below `MIN_SEARCH_QUERY_LENGTH` (FR-010a).
     */
    public async search(rawQuery: string, callerId: string, withNutrition = false): Promise<SearchResponse> {
        const query = rawQuery.trim();

        if (!meetsSearchMinimum(query)) {
            return { results: [] };
        }

        const hits = await this.searchDao.search(query, callerId);
        const namedVariants = await this.namedVariantsOf(
            query,
            hits.filter((hit) => hit.userId === null),
        );
        const results: SearchResponse['results'] = hits.map((hit) => {
            const variant = namedVariants.get(hit.id);

            return {
                id: hit.id,
                name: hit.name,
                score: hit.score,
                // R20 (U11): flagged ONLY on the caller's own authored hits — the lexical tier's
                // author-augmentation signal. A catalog row publishes nothing; a stranger's authored row never
                // left the DAO's predicate, because an authored food is author-only (ADR-0036).
                ...(hit.userId !== null && hit.userId === callerId ? { visibility: 'private' as const } : {}),
                ...(variant === undefined ? {} : { variant: variantViewOf(variant) }),
            };
        });

        // Crosswalk: a query that is a known barcode or source item key resolves directly to a root.
        const crosswalk = await this.crosswalkHitOf(query);

        if (crosswalk !== undefined && !results.some((result) => result.id === crosswalk.id)) {
            results.unshift(crosswalk);
        }

        if (!withNutrition || results.length === 0) {
            // ⛔ Enrichment is strictly OPT-IN (plan U4b): the default caller is the per-keystroke typeahead,
            // whose 600ms budget must not carry a nutrient-view scan it never reads. The one caller that
            // asks is recipe-service's lexical tier, whose verification gate needs inter-candidate nutrient
            // agreement (D4a's second conjunct) before any identity skip can ever be earned.
            return { results };
        }

        const rows = await this.foodDao.nutrientRowsFor(results.map((result) => result.id));
        const rowsByFood = new Map<string, StoredNutrientAmount[]>();

        for (const row of rows) {
            const bucket = rowsByFood.get(row.foodId) ?? [];
            bucket.push(row);
            rowsByFood.set(row.foodId, bucket);
        }

        return {
            results: results.map((result) => {
                const projection = projectStoredNutrition(rowsByFood.get(result.id) ?? []);

                // Absent stays ABSENT — a macro with no qualifying row must never read as zero.
                return {
                    ...result,
                    ...(projection.caloriesPer100g === undefined
                        ? {}
                        : { caloriesPer100g: projection.caloriesPer100g }),
                    ...(projection.proteinGPer100g === undefined
                        ? {}
                        : { proteinGPer100g: projection.proteinGPer100g }),
                    ...(projection.carbsGPer100g === undefined ? {} : { carbsGPer100g: projection.carbsGPer100g }),
                    ...(projection.fatGPer100g === undefined ? {} : { fatGPer100g: projection.fatGPer100g }),
                };
            }),
        };
    }

    /**
     * `GET /api/v1/foods/catalog/search?query=` — the SHARED catalog search (plan 002 R40, S3): catalog roots ranked
     * by text match, each with the one variant the query names, and a barcode or USDA-key crosswalk hit unshifted at
     * score 1. NEVER calls a source (FR-009).
     *
     * ⛔ It takes no caller, so no caller can change its answer: the edge shares that answer across every caller
     * (ADR-0020). It therefore never says `private` — a cook's own foods are {@link searchAuthored}'s.
     *
     * @param query - The canonical search term (`searchTermQuerySchema`).
     * @returns The catalog hits; an empty set, with NO read at all, below `MIN_SEARCH_QUERY_LENGTH` (FR-010a).
     * @sideEffect Reads `food`, then the variants and the two crosswalks — only at or above the minimum.
     */
    public async searchCatalog(query: string): Promise<CatalogSearchResponse> {
        if (!meetsSearchMinimum(query)) {
            return { results: [] };
        }

        const hits = await this.searchDao.searchCatalog(query);
        const namedVariants = await this.namedVariantsOf(query, hits);
        const results: CatalogSearchResponse['results'] = hits.map((hit) => {
            const variant = namedVariants.get(hit.id);

            return {
                id: hit.id,
                name: hit.name,
                score: hit.score,
                ...(variant === undefined ? {} : { variant: variantViewOf(variant) }),
            };
        });
        const crosswalk = await this.crosswalkHitOf(query);

        if (crosswalk !== undefined && !results.some((result) => result.id === crosswalk.id)) {
            results.unshift(crosswalk);
        }

        return { results };
    }

    /**
     * `GET /api/v1/foods/authored/search?query=` — the caller's OWN authored foods matching the term (plan 002 R40,
     * S3), scored by the catalog search's sort key. No crosswalk and no variant: an authored food has neither.
     *
     * @param query - The canonical search term (`searchTermQuerySchema`).
     * @param userId - The verified caller's app-user ULID.
     * @returns The caller's own hits; an empty set, with NO read at all, below `MIN_SEARCH_QUERY_LENGTH` (FR-010a).
     * @sideEffect Reads `food` — only at or above the minimum.
     */
    public async searchAuthored(query: string, userId: string): Promise<AuthoredFoodSearchResponse> {
        if (!meetsSearchMinimum(query)) {
            return { results: [] };
        }

        const hits = await this.searchDao.searchAuthored(query, userId);

        return { results: hits.map((hit) => ({ id: hit.id, name: hit.name, score: hit.score })) };
    }

    /**
     * `POST /api/v1/foods` — add-by-name: dedup on normalized name, enqueue a fresh add/reactivation, and
     * return `202` + `id` (FR-005/FR-013/FR-028a). An add for an existing non-terminal food returns its
     * current status WITHOUT enqueuing (no scarce source budget burned).
     *
     * @param name - The display name (already validated non-empty by the controller).
     * @param requesterId - The requester key (CR-002/U1: app-user ULID or `svc_*`).
     * @returns The id + resulting status. Never shed: FR-043b puts no intake cap on add-by-name.
     */
    public async addByName(name: string, requesterId: string): Promise<AddResponse> {
        // The catalog's display name and its identity key are derived from ONE sanitized string, so they can
        // never disagree about which characters count. Idempotent — the controller has already canonicalized a
        // request-borne name, but a future in-process caller has not, and the write point is what must hold.
        const displayName = sanitizeFoodName(name);
        const result = await this.foodDao.createByName({ normalizedName: normalizeName(displayName), displayName });

        if (result.created || result.reactivated) {
            await this.enqueue.publishFoodRequested({
                id: result.id,
                requestedBy: requesterId,
                reactivate: result.reactivated,
            });

            return { id: result.id, status: 'PENDING', estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        const food = await this.foodDao.getById(result.id);
        const status: FoodStatus = food?.status ?? 'PENDING';

        // ⛔ REPAIR A STRANDED FOOD. A food row is committed before its queue row, so a failure between the
        // two used to leave the food PENDING with nothing to fetch it — and this branch, the one every
        // repeat request lands on, simply reported that status back forever. Nobody was ever going to fetch
        // it. Re-enqueueing here costs one idempotent upsert (`ON CONFLICT (food_id)`) when a queue row
        // already exists, and rescues the food when it does not.
        if (
            status === 'PENDING' &&
            this.fetchQueue !== undefined &&
            (await this.fetchQueue.getByFoodId(result.id)) === undefined
        ) {
            await this.enqueue.publishFoodRequested({ id: result.id, requestedBy: requesterId, reactivate: true });

            return { id: result.id, status: 'PENDING', estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        // FR-025a: an UNRESOLVED food whose candidate set has expired (the 30-day TTL) re-fans-out on the
        // next add-by-name against the normal budget. `getCandidates` is TTL-filtered, so an empty set
        // means the disambiguation choices have aged out; re-enqueue to re-run the fan-out. The food stays
        // UNRESOLVED until the worker re-resolves it — it is never swept to NOT_FOUND.
        if (status === 'UNRESOLVED' && (await this.candidates.getCandidates(result.id)).length === 0) {
            await this.enqueue.publishFoodRequested({ id: result.id, requestedBy: requesterId, reactivate: true });

            return { id: result.id, status: catalogStatusOf(status), estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
        }

        return { id: result.id, status: catalogStatusOf(status) };
    }

    /**
     * `POST /api/v1/foods/batch` — per-item partial add-by-name (FR-012/FR-045). Intra-batch dedup collapses
     * a repeated name to one row; a locally-`RESOLVED` hit is returned inline; a miss is created +
     * enqueued and returned `PENDING`. The caller-side ≤100 cap is enforced in the controller.
     *
     * @param names - The names to add (post-cap).
     * @param requesterId - The requester key (CR-002/U1: app-user ULID or `svc_*`).
     * @returns Per-item results (inline hits + pending misses). Never shed: FR-043b puts no intake cap on a batch.
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
                    status: catalogStatusOf(food?.status ?? 'PENDING'),
                    estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS,
                });
            }
        }

        if (willEnqueue.length > 0) {
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
     * TAKES NO REQUESTER KEY, unlike every enqueue path. A resolve draws from the source's shared window
     * rather than a requester's budget and writes no `fetch_requesters` row, so there is nothing a
     * requester key would key. It formerly accepted one as `_requesterId` — never read, not even logged — so a
     * value was derived in the controller and discarded here; see `FoodsController.patchResolve`.
     *
     * @param id - The internal food id.
     * @param candidateIds - The picked candidate row ids.
     * @returns The id + `RESOLVED` status.
     * @throws {FoodNotFoundError} (→ 404) when no row exists.
     * @throws {NotResolvableError} (→ 409) when the food is not `UNRESOLVED` (and not an idempotent `RESOLVED`).
     * @throws {CandidateMismatchError} (→ 409) when a pick is not in the food's candidate set.
     * @throws {FetchUnavailableError} (→ 503) when the source stays busy past one short wait, our own admission
     *   accounting fails, or the source re-fetch fails.
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

        // Re-fetch each picked candidate. The registry's client admits every request on the INTERACTIVE lane
        // (ADR-0053 §3), so resolve never makes an unrecorded source call. A refusal that clears within two
        // seconds earns one wait; any later refusal, our own accounting failure, or a source failure → 503
        // Retry-After (a retryable signal, never a 429), WITHOUT clearing the candidate set (TST-2).
        const refetched: CanonicalCandidate[] = [];

        for (const pick of picks) {
            const source = pick.source as FoodSourceId;

            try {
                refetched.push(
                    await retryOnceWhenSoon(async () => this.registry.adapterFor(source).fetchByKey(pick.externalKey), {
                        maxWaitMs: RESOLVE_WAIT_MAX_MS,
                    }),
                );
            } catch (error) {
                if (isSourceAdmissionError(error)) {
                    throw new FetchUnavailableError(RESOLVE_RETRY_AFTER_SECONDS);
                }

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
     * @throws {FoodNotFoundError} (→ 404) when no row exists, or the food is being deleted.
     * @throws {HttpException} `NOT_REQUEUEABLE` (→ 409) when the food is withdrawn or seed-owned.
     * @sideEffect Reads the food and its item; records the requester and queues the fetch.
     */
    public async refetch(id: string, requesterId: string): Promise<AddResponse> {
        const food = await this.foodDao.getById(id);

        if (!food) {
            throw new FoodNotFoundError(id);
        }

        // ⛔ REFUSE BEFORE ENQUEUEING: this route reads ANY row by id, so every refused state is reachable here.
        const refusal = refetchRefusalOf({ status: food.status, seedOwned: await this.foodDao.isSeedOwned(id) });

        if (refusal === 'deleting') {
            // Mid-delete is not a state the wire publishes; the same plain 404 `getFood` answers.
            throw new FoodNotFoundError(id);
        }

        if (refusal !== undefined) {
            // The row exists and the operator may know it, so a `409` naming the observed status: `NOT_REQUEUEABLE`'s
            // `details.status` is the full lifecycle, `WITHDRAWN` included.
            throw apiError('NOT_REQUEUEABLE', `Food '${id}' cannot be refetched: ${refetchRefusalReason(refusal)}`, {
                id,
                status: food.status,
            });
        }

        await this.enqueue.publishFoodRequested({ id, requestedBy: requesterId, reactivate: true });

        return { id, status: catalogStatusOf(food.status), estimatedWaitSeconds: ESTIMATED_WAIT_SECONDS };
    }

    /**
     * `POST /api/v1/foods/authored` → `201` + the COMPLETE entity, born `RESOLVED` (plan U10, D9a).
     *
     * Walking through this door IS the provenance: `user_id` is set from the verified principal, there is
     * no `source` field on the wire and no crosswalk row in the store — never-synced is structural (KTD-H).
     * Dedup is the database's per-author partial unique, surfaced as `DUPLICATE_AUTHORED_NAME` (409) with
     * the colliding id so a client can offer "edit that one instead".
     *
     * @param authorId - The verified caller's app-user ULID.
     * @param input - The validated create body.
     * @returns The created food's full response (visibility `private`).
     * @sideEffect Writes food + macro + portion rows; reads the golden record back.
     */
    public async createAuthored(authorId: string, input: CreateAuthoredFoodRequest): Promise<FoodResponse> {
        const created = await this.authored.createAuthored({
            userId: authorId,
            name: input.name,
            normalizedName: normalizeName(input.name),
            description: input.description ?? null,
            macros: input.macros,
            portions: input.portions ?? [],
        });

        if (created.kind === 'duplicate') {
            throw new DuplicateAuthoredNameError(created.existingId);
        }

        return this.getFood(created.id, authorId);
    }

    /**
     * `PUT /api/v1/foods/{id}` — full replacement of an authored food (plan U10; "the author may edit
     * EVERYTHING in a food they own").
     *
     * ⛔ AUTHORIZATION FIRST: `evaluateAuthorship` runs before anything else touches the row, and its
     * verdicts map exactly — a stranger on a private food gets the not-found a missing id gets, a
     * stranger on a promoted food gets 403, ANY caller on a pipeline food gets 409 `NOT_EDITABLE`.
     *
     * @param callerId - The verified caller's app-user ULID.
     * @param id - The food id.
     * @param input - The validated replacement body.
     * @returns The updated food's full response.
     * @sideEffect Rewrites the food's scalars, macros and portions.
     */
    public async updateAuthored(callerId: string, id: string, input: UpdateAuthoredFoodRequest): Promise<FoodResponse> {
        const facts = await this.authored.readAuthorshipFacts(id);

        if (facts === undefined) {
            throw new FoodNotFoundError(id);
        }

        const verdict = evaluateAuthorship({ callerId, food: facts, action: 'edit' });

        if (verdict.kind === 'not-found') {
            throw new FoodNotFoundError(id);
        }

        if (verdict.kind === 'not-editable') {
            throw new NotEditableError(id);
        }

        if (verdict.kind === 'forbidden') {
            throw new NotFoodAuthorError(id);
        }

        const replaced = await this.authored.replaceAuthored({
            id,
            userId: callerId,
            name: input.name,
            normalizedName: normalizeName(input.name),
            description: input.description ?? null,
            macros: input.macros,
            portions: input.portions ?? [],
        });

        if (replaced.kind === 'missing') {
            // The row raced away (a concurrent erasure) between the policy read and the write — the
            // truthful answer is the one it would have gotten a moment later.
            throw new FoodNotFoundError(id);
        }

        if (replaced.kind === 'duplicate') {
            throw new DuplicateAuthoredNameError(replaced.existingId);
        }

        return this.getFood(id, callerId);
    }

    /**
     * `GET /api/v1/foods/authored-nutrition?ids=…` — the AUTHENTICATED half of ADR-0020's cache split
     * (plan U18): the caller's own authored foods' nutrition, per-caller and NEVER edge-cached.
     *
     * ⛔ The path deliberately does NOT begin `/api/v1/foods/nutrition` — the edge's shared-cache pattern
     * is `/api/v1/foods/nutrition*`, and a caller-scoped response matching it would be cached URL-only
     * and served across callers. Same projection, same response shape; an id the caller does not own
     * lands in `unknownIds`, indistinguishable from a food that does not exist.
     *
     * @param ids - The canonical id list.
     * @param requesterId - The caller's app-user ULID.
     * @sideEffect Three reads.
     */
    public async getAuthoredNutritionBatch(
        ids: readonly string[],
        requesterId: string,
    ): Promise<FoodNutritionBatchResponse> {
        const records = await this.foodDao.readAuthoredNutritionBatch(ids, requesterId);
        const byId = new Map(records.map((record) => [record.id, record]));
        const foods: FoodNutrition[] = [];
        const unknownIds: string[] = [];

        for (const id of ids) {
            const record = byId.get(id);

            if (record === undefined) {
                unknownIds.push(id);
                continue;
            }

            // ⛔ A LIVE 500 CLOSED HERE. This projection called `publishableStatusOf`, which THROWS on
            // `DELETING` — and unlike the shared batch above, this one reads AUTHORED rows, which are
            // exactly the rows that get tombstoned. So an author holding a food mid-erasure took down the
            // whole batch: every OTHER food in the request lost its nutrition too, on every recipe render,
            // for the duration of the erasure worker's cross-service check.
            //
            // ⛔ It lands in `unknownIds`, and that is honest rather than convenient: `DELETING` is
            // store-internal precisely because it is a window that may still un-happen (an erasure keeping
            // a referenced food reverts it to `RESOLVED`), so the truthful answer is "nothing to tell you
            // about this id yet", which is what `unknownIds` already means. ⛔ NOT `WITHDRAWN`, which is a
            // settled fact the caller must be able to act on — collapsing the two is the discrimination
            // failure this whole change exists to avoid.
            if (record.status === 'DELETING') {
                unknownIds.push(id);
                continue;
            }

            foods.push(nutritionEntryFor(id, record));
        }

        return { foods, unknownIds };
    }

    /**
     * `DELETE /api/v1/foods/{id}` — the author WITHDRAWS their own food (owner rulings 1, 2, 5).
     *
     *  1. authorship policy (the same verdict map as PUT — authz before anything observes the row);
     *  2. flip `RESOLVED → WITHDRAWN`, stamping `withdrawn_at`.
     *
     * That is the whole flow. There is no reference check, no cross-service call, and no physical delete.
     *
     * ## ⛔ What was removed, and why it is not a weakening
     *
     * This route used to be tombstone-first: flip to `DELETING`, ask RECIPE-SERVICE whether any recipe
     * referenced the food, then refuse `409 FOOD_REFERENCED` or physically delete. It failed CLOSED with a
     * `503` when recipe was unreachable.
     *
     * Two owner rulings retire it. **"The recipe service needs to handle when it detects that a food item
     * has been deleted — the food service should not be updating recipes"**: a food-side write must not
     * depend on another service being up, and the food↔recipe edge is one-directional in the DATA, which
     * this made false of the SERVICES. And **users can delete their own food**, unconditionally.
     *
     * The protection the check bought is bought differently now, and more cheaply: the row is RETAINED, so
     * a referencing recipe line is never left pointing at nothing — it reads the live `WITHDRAWN` status and
     * tells the cook which line lost its food. Nothing is stranded, so there is nothing to refuse for.
     *
     * ⚠️ It also removes a real STUCK STATE. A crash between `setStatus DELETING` and the reference check
     * left a food permanently `DELETING`, un-addable and un-editable, with no repair path short of editing
     * the database. A single guarded transition has no such window.
     *
     * ⚠️ A second DELETE answers `404`, unchanged: the guarded transition matches no row, and the honest
     * answer is that the food is already gone.
     *
     * @param callerId - The verified caller's app-user ULID.
     * @param id - The food id.
     * @sideEffect One status flip. NO network call.
     */
    public async deleteAuthored(callerId: string, id: string): Promise<void> {
        const facts = await this.authored.readAuthorshipFacts(id);

        if (facts === undefined) {
            throw new FoodNotFoundError(id);
        }

        const verdict = evaluateAuthorship({ callerId, food: facts, action: 'delete' });

        if (verdict.kind === 'not-found') {
            throw new FoodNotFoundError(id);
        }

        if (verdict.kind === 'not-editable') {
            throw new NotEditableError(id);
        }

        if (verdict.kind === 'forbidden') {
            throw new NotFoodAuthorError(id);
        }

        // A raced state (already withdrawn, or mid-erasure) surfaces as the guarded transition matching no
        // row — and the truthful answer for all of them is the same 404 a missing id gets.
        //
        // ⛔ Narrowed to that ONE error, because it is the only one those cases produce: `setStatus` filters
        // `WHERE id = … AND status IN (priors)` and raises `IllegalStatusTransitionError` whenever
        // `rowCount !== 1`, so a row that vanished mid-erasure is indistinguishable from one in the wrong
        // state — both arrive here as this type. An unconditional catch bought nothing for them and turned
        // every OTHER failure (connection reset, timeout, a revoked grant) into `404 food not found`: the
        // author reads "already deleted" and stops while the food is still live, and a 5xx that should have
        // paged somebody is laundered into a benign client error. Anything else belongs to the exception
        // filter, which maps an unrecognised throwable to a 500 logged at `error` with its stack.
        try {
            await this.foodDao.setStatus({ id, status: 'WITHDRAWN' });
        } catch (error) {
            if (!isIllegalStatusTransitionError(error)) {
                throw error;
            }

            throw new FoodNotFoundError(id);
        }
    }

    /**
     * The hit a query that IS an identifier resolves to, at score exactly 1: a barcode's root, else the live catalog
     * entry standing for a USDA item key, through the owner reader (curated U8 S4, R19) — so a variant-owned item
     * answers as its root carrying the variant, and a retired root's item answers as its forward's target.
     *
     * Each hit is read by a statement that admits a live, `RESOLVED` catalog row only (plan 002 S3, property 2): the
     * barcode's own, and for a key, a second read of the root the owner reader named.
     *
     * @param query - The trimmed query.
     * @returns The hit, or `undefined` when the query names no live catalog entry.
     * @sideEffect Reads the barcode crosswalk, then the owner reader and the root it names.
     */
    private async crosswalkHitOf(query: string): Promise<CatalogSearchResponse['results'][number] | undefined> {
        const barcodeFood = await this.sources.findCatalogFoodByBarcode(query);

        if (barcodeFood !== undefined) {
            return { id: barcodeFood.id, name: barcodeFood.name, score: 1 };
        }

        // A typed FDC id names one version of a food and carries no lineage, so a re-keyed id falls through to search.
        const owner = (await this.owners.ownersOfKeys('usda', [{ externalKey: query, lineageKey: null }])).get(query);
        const root = owner === undefined ? undefined : await this.sources.findCatalogFoodById(owner.rootId);

        if (owner === undefined || root === undefined) {
            return undefined;
        }

        const variant = ownerVariantView(owner);

        return { id: root.id, name: root.name, score: 1, ...(variant === undefined ? {} : { variant }) };
    }

    /**
     * The one live variant each catalog hit's query names (curated U8, R15, R16): one variant read for every hit whose
     * query leaves words beyond its best name or synonym, then `matchVariant` per hit. Catalog hits only: an authored
     * food has no variants, so a caller holding mixed hits passes the catalog ones.
     *
     * @param query - The search query.
     * @param hits - The ranked catalog hits.
     * @returns The named variant by root id; a hit absent from the map carries none.
     * @sideEffect Reads `food_variant` and `food_variant_part`, and only when some hit leaves words.
     */
    private async namedVariantsOf(query: string, hits: readonly CatalogSearchHit[]): Promise<Map<string, LiveVariant>> {
        const candidates = hits.filter((hit) => leftoverTokens(query, namesOf(hit.name, hit.aliases)).length > 0);
        const named = new Map<string, LiveVariant>();

        if (candidates.length === 0) {
            return named;
        }

        const live = await this.variants.listLive(
            candidates.map((hit) => hit.id),
            { withNutrition: false },
        );

        for (const hit of candidates) {
            const variant = matchVariant(
                query,
                namesOf(hit.name, hit.aliases),
                live.filter((candidate) => candidate.rootId === hit.id),
            );

            if (variant !== undefined) {
                named.set(hit.id, variant);
            }
        }

        return named;
    }

    /**
     * A root's live variants as the wire lists them (curated U8, R17). An authored food never has a variant, so it
     * is answered `[]` without a read.
     *
     * @param record - The root.
     * @returns Its live variants, in the DAO's order.
     * @sideEffect Reads `food_variant`, `food_variant_part` and the variants' nutrition.
     */
    private async liveVariantViewsOf(record: GoldenFoodRecord): Promise<VariantView[]> {
        if (record.userId !== null) {
            return [];
        }

        return (await this.variants.listLive([record.id], { withNutrition: true })).map(variantViewOf);
    }

    /**
     * Map a {@link GoldenFoodRecord} to the public {@link FoodResponse} (source-tagged, no `fdcId`).
     *
     * @param record - The root.
     * @param variants - Its live variants, already projected.
     * @returns The response.
     */
    private toFoodResponse(record: GoldenFoodRecord, variants: VariantView[]): FoodResponse {
        const sourceById = new Map(record.sources.map((source) => [source.id, source.source]));
        // A field's winner always names its crosswalk row. NULL provenance on a value or portion is its AUTHOR,
        // reported as 'author' below, never 'unknown': a reader must tell "we lost track" from "a person stands behind it".
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
            status: publishableStatusOf(record.status),
            nutrients: record.nutrients.map((nutrient) => ({
                nutrient: nutrient.name,
                amount: Number(nutrient.amount),
                unit: nutrient.unit,
                basis: nutrient.basis,
                // The citation's register source (KTD-15), or `author` for an authored food's own uncited value.
                source: nutrient.source ?? 'author',
            })),
            portions: record.portions.map((portion) => ({
                label: portion.label,
                gramWeight: Number(portion.gramWeight),
                // The DAO decided who stands behind the portion; NULL is its author (ADR-0029).
                source: portion.source ?? 'author',
            })),
            provenance,
            // U10 (Q3c): present ONLY for an authored food; a catalog row publishes no visibility at all.
            // An authored food is author-only, so `private` is the only value the wire can carry (ADR-0036).
            ...(record.userId === null || record.visibility === 'public' ? {} : { visibility: 'private' as const }),
            variants,
        };
    }
}
