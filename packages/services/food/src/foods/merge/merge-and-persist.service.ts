/**
 * `MergeAndPersistService` (T-161/T-162/T-163, MOD-016/MOD-019) — the cohesive merge→persist seam the
 * Phase-5 fan-out worker and the Phase-4 `PATCH`-resolve both call. It sanitizes candidates at the merge
 * boundary (T-164), drives the pure {@link GoldenRecordMergeEngine}, and persists the outcome across the
 * DAO layer in ONE transaction:
 *
 * - **RESOLVED**: upsert a `food_sources` crosswalk row per contributing source (so every value's
 *   `source_id` exists), resolve the nutrient dictionary, write `food_nutrients` (with `source_id` +
 *   per-100g basis) and `food_portions` (with `source_id`), record scalar-field provenance in
 *   `food_field_provenance`, write the golden scalars, and set `RESOLVED`. No raw payload is stored
 *   (SC-013).
 * - **UNRESOLVED**: persist the surviving candidate set to `food_candidates` and set `UNRESOLVED`.
 * - **NOT_FOUND**: tombstone the food.
 *
 * The manual-resolution path ({@link MergeAndPersistService.resolveFromPicks}, T-163) blends the user's
 * re-fetched picks directly to `RESOLVED`, stores the pick as **ordinary provenance** (indistinguishable
 * from a normal value to a later refresh), and clears the candidate set.
 *
 * @implements FR-028 FR-029 FR-031 FR-MRG-1 FR-MRG-5 FR-RES-2 SC-013 R5 R7
 */
import type { FoodDrizzle } from '../../database/database.module.js';
import type { CanonicalCandidate } from '../../sources/food-source-adapter.js';
import { CandidateStore } from '../dao/food-candidates.dao.js';
import { FoodDao, type FoodStatus } from '../dao/food.dao.js';
import { FoodFieldProvenanceDao, type FoodField } from '../dao/food-field-provenance.dao.js';
import { FoodNutrientsDao } from '../dao/food-nutrients.dao.js';
import { FoodPortionsDao } from '../dao/food-portions.dao.js';
import { FoodSourcesDao } from '../dao/food-sources.dao.js';
import { NutrientDao } from '../dao/nutrient.dao.js';
import {
    GoldenRecordMergeEngine,
    type GoldenRecordDraft,
    type MergeCandidate,
    type MergeOutcome,
} from './merge-engine.js';
import { sanitizeCandidates } from './merge-sanitize.js';

/** An open Drizzle transaction handle (the argument the `transaction` callback receives). */
type FoodTransaction = Parameters<Parameters<FoodDrizzle['transaction']>[0]>[0];

/** Input for {@link MergeAndPersistService.resolveAndPersist} (the worker fan-out path). */
export interface ResolveAndPersistInput {
    /** The internal food id (already `PENDING`). */
    foodId: string;
    /** The fan-out candidates (pre-merge; sanitized here). */
    candidates: readonly CanonicalCandidate[];
}

/** Input for {@link MergeAndPersistService.resolveFromPicks} (the manual `PATCH`-resolve path). */
export interface ResolveFromPicksInput {
    /** The internal food id (currently `UNRESOLVED`). */
    foodId: string;
    /** The user's re-fetched picked candidates. */
    picks: readonly CanonicalCandidate[];
}

/** Input for {@link MergeAndPersistService.mergeChangedSources} (the change-refresh in-place re-pull). */
export interface MergeChangedSourcesInput {
    /** The internal food id (currently `RESOLVED`). */
    foodId: string;
    /** The re-fetched candidates whose backing item changed upstream (only changed items, T-171). */
    changed: readonly CanonicalCandidate[];
}

/** Result of a persist operation: the merge outcome and the resulting persisted lifecycle status. */
export interface PersistResult {
    /** The merge outcome (FR-MRG-5). */
    outcome: MergeOutcome;
    /** The persisted `food.status`. */
    status: FoodStatus;
}

/** Maps a {@link GoldenRecordDraft} scalar slot to its `food_field` provenance enum value. */
const SCALAR_FIELDS: readonly { field: FoodField; key: keyof GoldenRecordDraft }[] = [
    { field: 'name', key: 'name' },
    { field: 'description', key: 'description' },
    { field: 'kind', key: 'kind' },
    { field: 'brand_owner', key: 'brandOwner' },
    { field: 'brand_name', key: 'brandName' },
    { field: 'barcode', key: 'barcode' },
];

/**
 * Adapt an open transaction handle to the {@link FoodDrizzle} the Phase-1 DAO constructors accept. A
 * transaction handle exposes the identical query-builder surface the DAOs use but is not nominally
 * assignable to `FoodDrizzle` (it has no `$client`); the DAOs are committed and out of scope to change,
 * so this is the single, documented narrowing point. All DAO calls below run on the same transaction.
 *
 * @param tx - The open Drizzle transaction.
 * @returns The transaction typed as the DAO database handle.
 */
function asDaoDb(tx: FoodTransaction): FoodDrizzle {
    return tx as unknown as FoodDrizzle;
}

export class MergeAndPersistService {
    public constructor(
        private readonly db: FoodDrizzle,
        private readonly engine: GoldenRecordMergeEngine,
    ) {}

    /**
     * Merge fan-out candidates and persist the outcome atomically under the survivor-count boundary.
     *
     * @param input - The food id + fan-out candidates.
     * @returns The merge outcome and the persisted status.
     * @sideEffect Writes the golden record / candidate set / tombstone in one transaction.
     */
    public async resolveAndPersist(input: ResolveAndPersistInput): Promise<PersistResult> {
        const result = this.engine.merge(sanitizeCandidates(input.candidates));

        return this.db.transaction(async (tx) => {
            const db = asDaoDb(tx);

            if (result.outcome === 'RESOLVED' && result.goldenRecord) {
                return this.persistResolved(db, input.foodId, result.goldenRecord);
            }

            if (result.outcome === 'UNRESOLVED') {
                return this.persistUnresolved(db, input.foodId, result.candidateSet);
            }

            await new FoodDao(db).setStatus({ id: input.foodId, status: 'NOT_FOUND' });

            return { outcome: 'NOT_FOUND', status: 'NOT_FOUND' };
        });
    }

    /**
     * Blend the user's re-fetched picks to `RESOLVED` (the human has already disambiguated, so the
     * survivor-count gate is bypassed), store the pick as ordinary provenance, and clear the candidate
     * set — all atomically (T-163).
     *
     * @param input - The food id + re-fetched picks.
     * @returns The merge outcome and the persisted status.
     * @sideEffect Writes the golden record + clears the candidate set in one transaction.
     */
    public async resolveFromPicks(input: ResolveFromPicksInput): Promise<PersistResult> {
        const golden = this.engine.blendPicks(sanitizeCandidates(input.picks));

        return this.db.transaction(async (tx) => {
            const db = asDaoDb(tx);
            const result = await this.persistResolved(db, input.foodId, golden);
            await new CandidateStore(db).clear(input.foodId);

            return result;
        });
    }

    /**
     * Selectively re-pull the CHANGED backing source items of a `RESOLVED` food in place (T-171,
     * FR-031/FR-032, DSN-4). The caller (the worker's refresh branch) passes only items whose upstream
     * `item_version` changed; this re-blends them, upserts each changed crosswalk (advancing
     * `item_version`), and rewrites just the golden values those items supply (nutrients by
     * `(food_id, nutrient_id)`, the changed sources' portions, scalar winners + provenance). The food
     * STAYS `RESOLVED` — `food.updated_at` is bumped but the lifecycle is never transitioned and
     * disambiguation is never re-run, so a refresh can never demote a food or clobber a manual pick whose
     * item did not change (it is simply never in `changed`). All atomic.
     *
     * @param input - The food id + the re-fetched changed candidates.
     * @returns The persisted result (always `RESOLVED`).
     * @sideEffect Writes `food_sources`, `nutrient`, `food_nutrients`, `food_portions`,
     *   `food_field_provenance`, and `food.updated_at` in one transaction.
     */
    public async mergeChangedSources(input: MergeChangedSourcesInput): Promise<PersistResult> {
        const golden = this.engine.mergeChanged(sanitizeCandidates(input.changed));

        return this.db.transaction(async (tx) => {
            const db = asDaoDb(tx);
            const sources = new FoodSourcesDao(db);
            const nutrientDao = new NutrientDao(db);
            const foodNutrients = new FoodNutrientsDao(db);
            const portions = new FoodPortionsDao(db);
            const fieldProvenance = new FoodFieldProvenanceDao(db);
            const foodDao = new FoodDao(db);

            // 1. Upsert each changed crosswalk so its item_version advances; collect the source_id.
            const sourceIdByHandle = new Map<string, string>();

            for (const contributor of golden.contributingSources) {
                const row = await sources.upsertSource({
                    foodId: input.foodId,
                    source: contributor.source,
                    externalKey: contributor.externalKey,
                    itemVersion: contributor.itemVersion,
                });
                sourceIdByHandle.set(`${contributor.source}::${contributor.externalKey}`, row.id);
            }

            const sourceIdFor = (source: string, externalKey: string): string => {
                const sourceId = sourceIdByHandle.get(`${source}::${externalKey}`);

                if (sourceId === undefined) {
                    throw new Error('refresh produced a value with no contributing crosswalk');
                }

                return sourceId;
            };

            // 2. Golden scalars supplied by the changed items (presence wins; absent fields untouched).
            await foodDao.upsertGoldenScalars({
                id: input.foodId,
                name: golden.name?.value ?? undefined,
                description: golden.description?.value ?? undefined,
                kind: golden.kind ? (golden.kind.value === 'branded' ? 'branded' : 'generic') : undefined,
                brandOwner: golden.brandOwner?.value ?? undefined,
                brandName: golden.brandName?.value ?? undefined,
                barcode: golden.barcode?.value ?? undefined,
            });

            // 3. Scalar-field provenance for the re-pulled winners.
            for (const { field, key } of SCALAR_FIELDS) {
                const scalar = golden[key];

                if (scalar !== null && typeof scalar === 'object' && 'source' in scalar) {
                    await fieldProvenance.record({
                        foodId: input.foodId,
                        field,
                        sourceId: sourceIdFor(scalar.source, scalar.externalKey),
                    });
                }
            }

            // 4. Re-pulled nutrient values (one golden value per nutrient; updates amount/basis/source_id).
            for (const nutrient of golden.nutrients) {
                const dictionary = await nutrientDao.resolveOrCreate({
                    name: nutrient.name,
                    unit: nutrient.unit,
                    externalCode: nutrient.code,
                });
                await foodNutrients.upsertValue({
                    foodId: input.foodId,
                    nutrientId: dictionary.id,
                    amount: nutrient.amount,
                    basis: nutrient.basis,
                    sourceId: sourceIdFor(nutrient.source, nutrient.externalKey),
                });
            }

            // 5. Portions: replace each changed source's contributed portions (drop-then-insert, no dup).
            for (const sourceId of new Set(sourceIdByHandle.values())) {
                await portions.deleteForSource(input.foodId, sourceId);
            }

            for (const portion of golden.portions) {
                await portions.insertPortion({
                    foodId: input.foodId,
                    label: portion.label,
                    gramWeight: portion.gramWeight,
                    sourceId: sourceIdFor(portion.source, portion.externalKey),
                });
            }

            // 6. Stay RESOLVED — bump updated_at only (never transition the lifecycle on a refresh).
            await foodDao.touch(input.foodId);

            return { outcome: 'RESOLVED', status: 'RESOLVED' };
        });
    }

    /**
     * Persist a RESOLVED golden record across the DAO layer within the given transaction (T-161). Every
     * scalar/nutrient/portion is tagged with a `source_id` resolved from a freshly-upserted crosswalk
     * row, so the provenance invariant (same-food FK, D-PROVENANCE-FK) holds and "which fields came from
     * source X" answers from a single query. No raw payload is written (SC-013).
     *
     * @param db - The transaction-scoped DAO database handle.
     * @param foodId - The internal food id.
     * @param golden - The assembled golden record draft.
     * @returns The persisted RESOLVED result.
     * @sideEffect Writes `food_sources`, `nutrient`, `food_nutrients`, `food_portions`,
     *   `food_field_provenance`, and `food` scalars/status.
     */
    private async persistResolved(db: FoodDrizzle, foodId: string, golden: GoldenRecordDraft): Promise<PersistResult> {
        const sources = new FoodSourcesDao(db);
        const nutrientDao = new NutrientDao(db);
        const foodNutrients = new FoodNutrientsDao(db);
        const portions = new FoodPortionsDao(db);
        const fieldProvenance = new FoodFieldProvenanceDao(db);
        const foodDao = new FoodDao(db);

        // 1. Upsert a crosswalk row per contributing source so every value's source_id exists.
        const sourceIdByHandle = new Map<string, string>();

        for (const contributor of golden.contributingSources) {
            const row = await sources.upsertSource({
                foodId,
                source: contributor.source,
                externalKey: contributor.externalKey,
                itemVersion: contributor.itemVersion,
            });
            sourceIdByHandle.set(`${contributor.source}::${contributor.externalKey}`, row.id);
        }

        const sourceIdFor = (source: string, externalKey: string): string => {
            const sourceId = sourceIdByHandle.get(`${source}::${externalKey}`);

            if (sourceId === undefined) {
                throw new Error('merge produced a value with no contributing crosswalk');
            }

            return sourceId;
        };

        // 2. Golden scalar fields (only the merge winners are written).
        await foodDao.upsertGoldenScalars({
            id: foodId,
            name: golden.name?.value ?? undefined,
            description: golden.description?.value ?? undefined,
            kind: golden.kind ? (golden.kind.value === 'branded' ? 'branded' : 'generic') : undefined,
            brandOwner: golden.brandOwner?.value ?? undefined,
            brandName: golden.brandName?.value ?? undefined,
            barcode: golden.barcode?.value ?? undefined,
        });

        // 3. Scalar-field provenance.
        for (const { field, key } of SCALAR_FIELDS) {
            const scalar = golden[key];

            if (scalar !== null && typeof scalar === 'object' && 'source' in scalar) {
                await fieldProvenance.record({
                    foodId,
                    field,
                    sourceId: sourceIdFor(scalar.source, scalar.externalKey),
                });
            }
        }

        // 4. Normalized nutrients (resolve the dictionary id, write the value with its winning source).
        for (const nutrient of golden.nutrients) {
            const dictionary = await nutrientDao.resolveOrCreate({
                name: nutrient.name,
                unit: nutrient.unit,
                externalCode: nutrient.code,
            });
            await foodNutrients.upsertValue({
                foodId,
                nutrientId: dictionary.id,
                amount: nutrient.amount,
                basis: nutrient.basis,
                sourceId: sourceIdFor(nutrient.source, nutrient.externalKey),
            });
        }

        // 5. Portions (union grain).
        for (const portion of golden.portions) {
            await portions.insertPortion({
                foodId,
                label: portion.label,
                gramWeight: portion.gramWeight,
                sourceId: sourceIdFor(portion.source, portion.externalKey),
            });
        }

        await foodDao.setStatus({ id: foodId, status: 'RESOLVED' });

        return { outcome: 'RESOLVED', status: 'RESOLVED' };
    }

    /**
     * Persist an UNRESOLVED outcome (T-162): the surviving candidate set to `food_candidates` (metadata
     * only, under `UNIQUE(food_id, source, external_key)`) and the food to `UNRESOLVED` for human
     * disambiguation.
     *
     * @param db - The transaction-scoped DAO database handle.
     * @param foodId - The internal food id.
     * @param candidateSet - The surviving candidates.
     * @returns The persisted UNRESOLVED result.
     * @sideEffect Writes `food_candidates` and `food.status`.
     */
    private async persistUnresolved(
        db: FoodDrizzle,
        foodId: string,
        candidateSet: readonly MergeCandidate[],
    ): Promise<PersistResult> {
        const foodDao = new FoodDao(db);
        await new CandidateStore(db).persistCandidates({
            foodId,
            candidates: candidateSet.map((candidate) => ({
                source: candidate.source,
                externalKey: candidate.externalKey,
                name: candidate.name,
                summary: null,
            })),
        });

        // A re-fan-out of an expired-set food (FR-025a) is already UNRESOLVED; UNRESOLVED → UNRESOLVED is
        // not in the legal-transition set, so transition only when arriving from another status (PENDING).
        const current = await foodDao.getById(foodId);

        if (current?.status !== 'UNRESOLVED') {
            await foodDao.setStatus({ id: foodId, status: 'UNRESOLVED' });
        }

        return { outcome: 'UNRESOLVED', status: 'UNRESOLVED' };
    }
}
