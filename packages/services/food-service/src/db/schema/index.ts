/**
 * Named barrel for the source-agnostic `kitchensink_food` schema (feature 003). Re-exports the 6
 * controlled enums, the 13 tables, and their `Row`/`NewRow` types across the three domain modules
 * (`food.ts` canonical core, `operational.ts` queue/limiter, `food-candidates.ts`). Named-only
 * (no `export *`) per the project's barrel convention.
 */

// Controlled enums (DB-7).
export {
    foodStatusEnum,
    foodKindEnum,
    foodSourceEnum,
    foodFieldEnum,
    foodOriginEnum,
    nutrientBasisEnum,
} from './food.js';

// Canonical core tables (plan.md §2).
export {
    food,
    foodSources,
    nutrient,
    foodNutrients,
    foodPortions,
    foodFieldProvenance,
    foodCategory,
    foodCategoryAssignment,
} from './food.js';

// Operational tables (queue + per-source limiter + sync metadata).
export { fetchQueue, fetchRequesters, sourceCallLog, sourceSyncMetadata } from './operational.js';

// Disambiguation candidate set (D-CANDIDATES — the 13th table).
export { foodCandidates } from './food-candidates.js';

// Row types — canonical core.
export type {
    FoodRow,
    NewFoodRow,
    FoodSourceRow,
    NewFoodSourceRow,
    NutrientRow,
    NewNutrientRow,
    FoodNutrientRow,
    NewFoodNutrientRow,
    FoodPortionRow,
    NewFoodPortionRow,
    FoodFieldProvenanceRow,
    NewFoodFieldProvenanceRow,
    FoodCategoryRow,
    NewFoodCategoryRow,
    FoodCategoryAssignmentRow,
    NewFoodCategoryAssignmentRow,
} from './food.js';

// Row types — operational.
export type {
    FetchQueueRow,
    NewFetchQueueRow,
    FetchRequesterRow,
    NewFetchRequesterRow,
    SourceCallLogRow,
    NewSourceCallLogRow,
    SourceSyncMetadataRow,
    NewSourceSyncMetadataRow,
} from './operational.js';

// Row types — candidates.
export type { FoodCandidateRow, NewFoodCandidateRow } from './food-candidates.js';
