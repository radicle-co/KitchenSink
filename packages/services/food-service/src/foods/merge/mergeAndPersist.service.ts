/**
 * `MergeAndPersistService` (T-161/T-162/T-163, MOD-016/MOD-019) — the cohesive merge→persist seam the
 * Phase-5 fan-out worker and the Phase-4 `PATCH`-resolve both call. It sanitizes candidates at the merge
 * boundary (T-164), drives the pure {@link GoldenRecordMergeEngine}, and persists the outcome across the
 * DAO layer in ONE transaction:
 *
 * - **RESOLVED**: record a `food_sources` crosswalk row per contributing item and cite each item on the food's
 *   nutrition header, resolve the nutrient dictionary, write each `food_nutrition_value` citing its item and
 *   each `food_portions` row naming its crosswalk row, record scalar-field provenance in
 *   `food_field_provenance`, write the golden scalars, and set `RESOLVED`. No raw payload is stored
 *   (SC-013).
 * - **UNRESOLVED**: persist the surviving candidate set to `food_candidates` and set `UNRESOLVED`.
 * - **NOT_FOUND**: tombstone the food.
 * - **Forwarded** (FOOD-SERVICE-6): the food IS a catalog entry, so it is retired and forwarded to that entry, its
 *   candidate set cleared, and it reports `RESOLVED`; every reader of a ref follows the forward. Reached when the
 *   fan-out's only survivor is a catalog holder (`heldCandidatePolicy.ts`), and through
 *   {@link MergeAndPersistService.resolveToHolder} when the worker's catalog-first check or a cook's pick names one.
 *
 * ⛔ A contributor is recorded by CLAIMING its key, or updating the food's OWN row for it, and never by writing over
 * another food's row (`FoodSourcesDao.recordSource`). A contributor another food holds aborts the merge with
 * {@link SourceHeldError} before any value is written, so every value's citation names this food's own row.
 *
 * The manual-resolution path ({@link MergeAndPersistService.resolveFromPicks}, T-163) blends the user's
 * re-fetched picks directly to `RESOLVED`, stores the pick as **ordinary provenance** (indistinguishable
 * from a normal value to a later refresh), and clears the candidate set.
 *
 * @implements FR-028 FR-029 FR-031 FR-MRG-1 FR-MRG-5 FR-RES-2 SC-013 R5 R7
 */
import type { FoodWriter } from '../../database/unitOfWork.js';
import type { NutrientRow } from '../../db/schema/index.js';
import type { CanonicalCandidate } from '../../sources/foodSourceAdapter.js';
import { CandidateStore } from '../dao/foodCandidates.dao.js';
import { FoodDao, type FoodStatus } from '../dao/food.dao.js';
import { FoodFieldProvenanceDao, type FoodField } from '../dao/foodFieldProvenance.dao.js';
import { FoodForwardDao } from '../dao/foodForward.dao.js';
import { FoodNutritionDao } from '../dao/foodNutrition.dao.js';
import { FoodPortionsDao } from '../dao/foodPortions.dao.js';
import { FoodSourcesDao } from '../dao/foodSources.dao.js';
import { NutrientDao } from '../dao/nutrient.dao.js';
import {
    GoldenRecordMergeEngine,
    type GoldenRecordDraft,
    type MergeCandidate,
    type MergeOutcome,
} from './mergeEngine.js';
import { fanOutDecisionOf, type SourceItemRef } from '../domain/heldCandidatePolicy.js';
import { joinAliases } from '../foodAliases.js';
import type { FoodRef } from '../foods.schema.js';
import { SourceHeldError } from './merge.errors.js';
import { sanitizeCandidates } from './mergeSanitize.js';

/** Input for {@link MergeAndPersistService.resolveAndPersist} (the worker fan-out path). */
export interface ResolveAndPersistInput {
    /** The internal food id (already `PENDING`). */
    foodId: string;
    /** The fan-out candidates the catalog does not hold (pre-merge; sanitized here). */
    candidates: readonly CanonicalCandidate[];
    /** The live catalog entries holding the hits the fan-out hid (`partitionHeldHits`); each is a survivor. */
    holders: readonly FoodRef[];
}

/** Input for {@link MergeAndPersistService.resolveToHolder}. */
export interface ResolveToHolderInput {
    /** The live by-name root. */
    readonly foodId: string;
    /** The live catalog root or variant it is. */
    readonly to: FoodRef;
    /** The statuses the caller observed it in: the move to `RESOLVED` is a compare-and-set on them. */
    readonly from: readonly FoodStatus[];
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
    /** The catalog entry the food was forwarded to; present only when it was. */
    forwardedTo?: FoodRef;
}

/** Maps a {@link GoldenRecordDraft} scalar slot to its `food_field` provenance enum value. */
const SCALAR_FIELDS: readonly { field: FoodField; key: keyof GoldenRecordDraft }[] = [
    { field: 'name', key: 'name' },
    { field: 'description', key: 'description' },
    { field: 'kind', key: 'kind' },
    { field: 'brand_owner', key: 'brandOwner' },
    { field: 'brand_name', key: 'brandName' },
    { field: 'barcode', key: 'barcode' },
    // Aliases are a merge winner like any other scalar (0007 adds the `food_field` value), so "which
    // fields came from source X" still answers from one query.
    { field: 'aliases', key: 'aliases' },
];

/** A contributing item's crosswalk row and nutrition citation, looked up by the item a golden value names. */
interface ContributorIndex {
    /** The crosswalk row id of the item. */
    readonly sourceIdFor: (source: string, externalKey: string) => string;
    /** The header's citation id of the item. */
    readonly citationIdFor: (source: string, externalKey: string) => string;
    /** Every contributing crosswalk row id. */
    readonly sourceIds: ReadonlySet<string>;
}

/** The one key a contributing item is indexed by. Pure. */
const handleOf = (source: string, externalKey: string): string => `${source}::${externalKey}`;

/**
 * Record each contributing item: claim its crosswalk row on the food's item, or bring the food's own row up to date,
 * then cite it on the food's nutrition header with the dataset its source stated (plan U4: every stored live value
 * cites its item and dataset).
 *
 * Every contributor is recorded before any is cited, so a held one is found before anything is cited to it.
 *
 * @param db - The transaction-scoped handle.
 * @param foodId - The food.
 * @param nutritionId - The food's nutrition header.
 * @param golden - The draft whose contributors are recorded.
 * @returns The index the golden write resolves each value's item through.
 * @throws {SourceHeldError} when another food holds a contributor; the caller's transaction then rolls back.
 * @sideEffect Inserts or updates the food's own `food_sources` rows and inserts `food_nutrition_citation` rows.
 */
async function indexContributors(
    db: FoodWriter,
    foodId: string,
    nutritionId: string,
    golden: GoldenRecordDraft,
): Promise<ContributorIndex> {
    const sources = new FoodSourcesDao(db);
    const nutrition = new FoodNutritionDao(db);
    const sourceIdByHandle = new Map<string, string>();
    const citationIdByHandle = new Map<string, string>();
    const held: SourceItemRef[] = [];

    for (const contributor of golden.contributingSources) {
        const record = await sources.recordSource({
            foodId,
            source: contributor.source,
            externalKey: contributor.externalKey,
            itemVersion: contributor.itemVersion,
        });

        if (record.kind === 'held') {
            held.push({ source: contributor.source, externalKey: contributor.externalKey });
        } else {
            sourceIdByHandle.set(handleOf(contributor.source, contributor.externalKey), record.row.id);
        }
    }

    if (held.length > 0) {
        throw new SourceHeldError(held);
    }

    for (const contributor of golden.contributingSources) {
        const handle = handleOf(contributor.source, contributor.externalKey);

        citationIdByHandle.set(
            handle,
            await nutrition.citeSourceItem(nutritionId, {
                dataset: contributor.dataset,
                externalKey: contributor.externalKey,
            }),
        );
    }

    /** The id a map holds for an item, or a loud failure: the engine named an item that contributed nothing. */
    const lookup =
        (ids: ReadonlyMap<string, string>, what: string) =>
        (source: string, externalKey: string): string => {
            const id = ids.get(handleOf(source, externalKey));

            if (id === undefined) {
                throw new Error(`merge produced a value with no contributing ${what}`);
            }

            return id;
        };

    return {
        sourceIdFor: lookup(sourceIdByHandle, 'crosswalk'),
        citationIdFor: lookup(citationIdByHandle, 'citation'),
        sourceIds: new Set(sourceIdByHandle.values()),
    };
}

/**
 * Write a draft's golden values: its scalars and their provenance, its nutrient values citing their items, and its
 * portions. Only the fields the draft carries are written; absent ones are left untouched.
 *
 * @param db - The transaction-scoped handle.
 * @param foodId - The food.
 * @param nutritionId - The food's nutrition header.
 * @param golden - The draft.
 * @param contributors - The draft's indexed contributors.
 * @sideEffect Writes `food` scalars, `food_field_provenance`, `nutrient`, `food_nutrition_value` and `food_portions`.
 */
async function writeGolden(
    db: FoodWriter,
    foodId: string,
    nutritionId: string,
    golden: GoldenRecordDraft,
    contributors: ContributorIndex,
): Promise<void> {
    const nutrientDao = new NutrientDao(db);
    const nutrition = new FoodNutritionDao(db);
    const portions = new FoodPortionsDao(db);
    const fieldProvenance = new FoodFieldProvenanceDao(db);

    await new FoodDao(db).upsertGoldenScalars({
        id: foodId,
        name: golden.name?.value ?? undefined,
        description: golden.description?.value ?? undefined,
        kind: golden.kind ? kindOf(golden.kind.value) : undefined,
        brandOwner: golden.brandOwner?.value ?? undefined,
        brandName: golden.brandName?.value ?? undefined,
        barcode: golden.barcode?.value ?? undefined,
        // `undefined` (no winner) leaves the column untouched, exactly as an absent name or description
        // does — a source that stops publishing aliases must not silently erase the ones we hold.
        aliases: golden.aliases ? joinAliases(golden.aliases.values) : undefined,
    });

    for (const { field, key } of SCALAR_FIELDS) {
        const scalar = golden[key];

        if (scalar !== null && typeof scalar === 'object' && 'source' in scalar) {
            await fieldProvenance.record({
                foodId,
                field,
                sourceId: contributors.sourceIdFor(scalar.source, scalar.externalKey),
            });
        }
    }

    // One golden value per nutrient: the dictionary ids, then the values citing their winning items — each batched,
    // so the statement count does not grow with the nutrient count (KITCHENSINK-FOOD-SERVICE-2/-8).
    const dictionary = await nutrientDao.resolveOrCreateMany(
        golden.nutrients.map((nutrient) => ({ name: nutrient.name, unit: nutrient.unit, infoodsTag: nutrient.code })),
    );

    await nutrition.upsertValues(
        golden.nutrients.map((nutrient, index) => ({
            nutritionId,
            nutrientId: dictionaryIdAt(dictionary, index),
            amount: nutrient.amount,
            basis: nutrient.basis,
            citationId: contributors.citationIdFor(nutrient.source, nutrient.externalKey),
        })),
    );

    for (const portion of golden.portions) {
        await portions.insertPortion({
            foodId,
            label: portion.label,
            gramWeight: portion.gramWeight,
            sourceId: contributors.sourceIdFor(portion.source, portion.externalKey),
        });
    }
}

/**
 * The dictionary id resolved for the nutrient at `index`. `resolveOrCreateMany` answers one row per input, in order,
 * so a missing row is a broken contract, not an absent nutrient. Pure.
 *
 * @param rows - The batch's rows.
 * @param index - The nutrient's position in the draft.
 * @returns The row's id.
 * @throws {Error} when the batch answered fewer rows than it was asked for.
 */
function dictionaryIdAt(rows: readonly NutrientRow[], index: number): string {
    const row = rows[index];

    if (row === undefined) {
        throw new Error(`the nutrient dictionary answered no row for draft nutrient ${String(index)}`);
    }

    return row.id;
}

/** The stored kind of a golden kind value: `branded` stays, anything else is generic. Pure. */
const kindOf = (value: string): 'generic' | 'branded' => (value === 'branded' ? 'branded' : 'generic');

export class MergeAndPersistService {
    public constructor(
        private readonly db: FoodWriter,
        private readonly engine: GoldenRecordMergeEngine,
    ) {}

    /**
     * Merge fan-out candidates and persist the outcome atomically under the survivor-count boundary, counting each
     * catalog holder of a hidden hit as a survivor (`fanOutDecisionOf`).
     *
     * @param input - The food id, the candidates the catalog does not hold, and the holders of the ones it does.
     * @returns The merge outcome and the persisted status; `forwardedTo` when the food was forwarded to a holder.
     * @throws {SourceHeldError} when a contributor became held after the fan-out read the catalog; nothing is written.
     * @sideEffect Writes the golden record / candidate set / tombstone / forward in one transaction.
     */
    public async resolveAndPersist(input: ResolveAndPersistInput): Promise<PersistResult> {
        const offered = sanitizeCandidates(input.candidates);
        const result = this.engine.merge(offered);
        const decision = fanOutDecisionOf(offered, result, input.holders);

        return this.db.transaction(async (tx) => {
            const db = tx;

            switch (decision.kind) {
                case 'forward':
                    return this.forward(db, { foodId: input.foodId, to: decision.to, from: undefined });
                case 'unresolved':
                    return this.persistUnresolved(db, input.foodId, decision.candidateSet);
                case 'notFound':
                    return this.persistNotFound(db, input.foodId);
                case 'merge':
                    break;
            }

            if (result.outcome === 'RESOLVED' && result.goldenRecord) {
                return this.persistResolved(db, input.foodId, result.goldenRecord);
            }

            if (result.outcome === 'UNRESOLVED') {
                return this.persistUnresolved(db, input.foodId, result.candidateSet);
            }

            return this.persistNotFound(db, input.foodId);
        });
    }

    /**
     * Resolve a by-name food to the catalog entry it is: retire it, forward it there, clear its candidate set, and
     * report it `RESOLVED` — all atomically. The worker calls it when the catalog-first check names the entry; a cook's
     * pick calls it when the pick names an item the entry holds (FOOD-SERVICE-6).
     *
     * @param input - The food, the entry, and the statuses the caller observed the food in.
     * @returns `RESOLVED`, forwarded to the entry.
     * @throws {IllegalStatusTransitionError} when the food left the observed statuses; nothing is written.
     * @sideEffect Updates `food`, inserts `food_forward`, deletes `food_candidates`, in one transaction.
     */
    public async resolveToHolder(input: ResolveToHolderInput): Promise<PersistResult> {
        return this.db.transaction(async (tx) => this.forward(tx, input));
    }

    /**
     * Blend the user's re-fetched picks to `RESOLVED` (the human has already disambiguated, so the
     * survivor-count gate is bypassed), store the pick as ordinary provenance, and clear the candidate
     * set — all atomically (T-163).
     *
     * @param input - The food id + re-fetched picks.
     * @returns The merge outcome and the persisted status.
     * @throws {SourceHeldError} when another food holds a pick; nothing is written.
     * @sideEffect Writes the golden record + clears the candidate set in one transaction.
     */
    public async resolveFromPicks(input: ResolveFromPicksInput): Promise<PersistResult> {
        const golden = this.engine.blendPicks(sanitizeCandidates(input.picks));

        return this.db.transaction(async (tx) => {
            const db = tx;
            const result = await this.persistResolved(db, input.foodId, golden);
            await new CandidateStore(db).clear(input.foodId);

            return result;
        });
    }

    /**
     * Selectively re-pull the CHANGED backing source items of a `RESOLVED` food in place (T-171,
     * FR-031/FR-032, DSN-4). The caller (the worker's refresh branch) passes only items whose upstream
     * `item_version` changed; this re-blends them, records each changed crosswalk on the food's own row (advancing
     * `item_version`), and rewrites just the golden values those items supply (nutrients by
     * `(nutrition_id, nutrient_id)`, the changed sources' portions, scalar winners + provenance). The food
     * STAYS `RESOLVED` — `food.updated_at` is bumped but the lifecycle is never transitioned and
     * disambiguation is never re-run, so a refresh can never demote a food or clobber a manual pick whose
     * item did not change (it is simply never in `changed`). All atomic.
     *
     * @param input - The food id + the re-fetched changed candidates.
     * @returns The persisted result (always `RESOLVED`).
     * @sideEffect Writes `food_sources`, `nutrient`, the nutrition aggregate, `food_portions`,
     *   `food_field_provenance`, and `food.updated_at` in one transaction.
     */
    public async mergeChangedSources(input: MergeChangedSourcesInput): Promise<PersistResult> {
        const golden = this.engine.mergeChanged(sanitizeCandidates(input.changed));

        return this.db.transaction(async (tx) => {
            const nutritionId = await new FoodNutritionDao(tx).headerForFood(input.foodId);
            // Each changed crosswalk is the food's own row, so recording it advances its item_version.
            const contributors = await indexContributors(tx, input.foodId, nutritionId, golden);
            const portions = new FoodPortionsDao(tx);

            // A changed source's portions are replaced, not appended: drop them before the golden write re-inserts.
            for (const sourceId of contributors.sourceIds) {
                await portions.deleteForSource(input.foodId, sourceId);
            }

            await writeGolden(tx, input.foodId, nutritionId, golden, contributors);
            // Stay RESOLVED — bump updated_at only (never transition the lifecycle on a refresh).
            await new FoodDao(tx).touch(input.foodId);

            return { outcome: 'RESOLVED', status: 'RESOLVED' };
        });
    }

    /**
     * Forward a by-name food to a catalog entry within the given transaction (see {@link resolveToHolder}).
     *
     * @param db - The transaction-scoped handle.
     * @param input - The food, the entry, and the observed statuses (`undefined`: every legal prior).
     * @returns `RESOLVED`, forwarded to the entry.
     * @sideEffect Updates `food`, inserts `food_forward`, deletes `food_candidates`.
     */
    private async forward(
        db: FoodWriter,
        input: Omit<ResolveToHolderInput, 'from'> & { readonly from: readonly FoodStatus[] | undefined },
    ): Promise<PersistResult> {
        await new FoodDao(db).setStatus({
            id: input.foodId,
            status: 'RESOLVED',
            ...(input.from === undefined ? {} : { from: input.from }),
        });
        await new FoodForwardDao(db).forwardLiveRoot(input.foodId, input.to);
        await new CandidateStore(db).clear(input.foodId);

        return { outcome: 'RESOLVED', status: 'RESOLVED', forwardedTo: input.to };
    }

    /**
     * Tombstone a food no source has an offerable answer for, within the given transaction.
     *
     * @param db - The transaction-scoped handle.
     * @param foodId - The food.
     * @returns `NOT_FOUND`.
     * @sideEffect Updates `food.status`.
     */
    private async persistNotFound(db: FoodWriter, foodId: string): Promise<PersistResult> {
        await new FoodDao(db).setStatus({ id: foodId, status: 'NOT_FOUND' });

        return { outcome: 'NOT_FOUND', status: 'NOT_FOUND' };
    }

    /**
     * Persist a RESOLVED golden record across the DAO layer within the given transaction (T-161). Every
     * scalar/nutrient/portion is tagged with its contributing item, so the same-item provenance key holds and
     * "which fields came from source X" answers from a single query. No raw payload is written (SC-013).
     *
     * @param db - The transaction-scoped DAO database handle.
     * @param foodId - The internal food id.
     * @param golden - The assembled golden record draft.
     * @returns The persisted RESOLVED result.
     * @sideEffect Writes `food_sources`, `nutrient`, the nutrition aggregate, `food_portions`,
     *   `food_field_provenance`, and `food` scalars/status.
     */
    private async persistResolved(db: FoodWriter, foodId: string, golden: GoldenRecordDraft): Promise<PersistResult> {
        const nutritionId = await new FoodNutritionDao(db).headerForFood(foodId);
        const contributors = await indexContributors(db, foodId, nutritionId, golden);

        await writeGolden(db, foodId, nutritionId, golden, contributors);
        await new FoodDao(db).setStatus({ id: foodId, status: 'RESOLVED' });

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
        db: FoodWriter,
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
