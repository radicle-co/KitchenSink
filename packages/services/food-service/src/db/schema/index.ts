/**
 * Named barrel for the `kitchensink_food` schema, the target of the package's `./db/schema` export. Re-exports the
 * controlled enums, the tables, the one read-only view, and their row types across the domain modules: `food.ts`
 * (roots, dictionaries, authored history), `catalogItems.ts` (items, variants, per-item tables, forwards),
 * `foodNutrition.ts` (the nutrition aggregate), `seedLedger.ts`, `operational.ts` (queue and limiter),
 * `foodCandidates.ts` and `foodNutrientView.ts`. Named-only (no `export *`) per the project's barrel convention.
 */

// Controlled enums (DB-7).
export {
    foodStatusEnum,
    foodKindEnum,
    foodSourceEnum,
    foodFieldEnum,
    foodItemOwnerKindEnum,
    nutrientBasisEnum,
} from './food.js';
export { foodVariantAttributeEnum } from './catalogItems.js';
export { citationDatasetEnum, citationMatchEnum } from './foodNutrition.js';

// Roots, dictionaries and authored-food history.
export { food, nutrient, foodCategory, foodVersions, foodPromotions } from './food.js';

// The item-keyed catalog (0018, KTD-6).
export {
    foodItem,
    foodVariant,
    foodVariantPart,
    foodSources,
    foodFieldProvenance,
    foodCategoryAssignment,
    foodPortions,
    foodForward,
} from './catalogItems.js';

// The nutrition aggregate (0018, KTD-19).
export { foodNutrition, foodNutritionCitation, foodNutritionValue } from './foodNutrition.js';

// The seed ledger (0018, KTD-4).
export { catalogSeedLedger } from './seedLedger.js';

// Operational tables (queue + per-source limiter + sync metadata).
export {
    fetchQueue,
    fetchRequesters,
    requesterSourceBudget,
    sourceBackoff,
    sourceCallLog,
    sourceSyncMetadata,
} from './operational.js';

// Disambiguation candidate set (D-CANDIDATES).
export { foodCandidates } from './foodCandidates.js';

// The search-gap record (0022, ADR-0055 point 4).
export { searchGap } from './searchGap.js';

// Read-only access path over the nutrition aggregate (0018). A VIEW, not a table: it carries `basis`, `trace` and
// `dataset` through and makes no selection decision — see the module for why that matters.
export { foodNutrientView } from './foodNutrientView.js';

// Row types — roots and dictionaries.
export type {
    FoodRow,
    NewFoodRow,
    NutrientRow,
    NewNutrientRow,
    FoodCategoryRow,
    NewFoodCategoryRow,
    FoodVersionRow,
    NewFoodVersionRow,
} from './food.js';

// Row types — the item-keyed catalog.
export type {
    FoodItemRow,
    FoodVariantRow,
    FoodSourceRow,
    NewFoodSourceRow,
    FoodPortionRow,
    NewFoodPortionRow,
} from './catalogItems.js';

// Row types — nutrition.
export type { FoodNutritionValueRow, NewFoodNutritionCitationRow } from './foodNutrition.js';

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
export type { FoodCandidateRow, NewFoodCandidateRow } from './foodCandidates.js';

// Row types — the search-gap record.
export type { SearchGapRow } from './searchGap.js';
