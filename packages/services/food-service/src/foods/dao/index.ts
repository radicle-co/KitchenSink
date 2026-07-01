/**
 * Named barrel for the source-agnostic food DAO layer (feature 003, Phase 1 — MOD-016/MOD-019).
 * Re-exports the per-aggregate DAOs, the queue/limiter/candidate DAOs, and their input/result types.
 * Named-only (no `export *`) per the project's barrel convention. The DAOs are deliberately NOT yet
 * wired into a NestJS module (that is Phase 3 / T-130).
 */

// Golden record + lifecycle.
export { FoodDao } from './food.dao.js';
export type {
    FoodStatus,
    GoldenFoodRecord,
    GoldenNutrient,
    GoldenPortion,
    GoldenSource,
    GoldenFieldProvenance,
    CreateByNameInput,
    CreateByNameResult,
    SetStatusInput,
    GoldenScalars,
} from './food.dao.js';

// Crosswalk.
export { FoodSourcesDao } from './food-sources.dao.js';
export type { BackingItem, FoodSource, UpsertSourceInput } from './food-sources.dao.js';

// Nutrient dictionary + values.
export { NutrientDao } from './nutrient.dao.js';
export type { ResolveNutrientInput } from './nutrient.dao.js';
export { FoodNutrientsDao } from './food-nutrients.dao.js';
export type { NutrientBasis, UpsertNutrientValueInput } from './food-nutrients.dao.js';

// Portions, scalar provenance, categories.
export { FoodPortionsDao } from './food-portions.dao.js';
export type { InsertPortionInput } from './food-portions.dao.js';
export { FoodFieldProvenanceDao } from './food-field-provenance.dao.js';
export type { FoodField, RecordFieldProvenanceInput, SourceField } from './food-field-provenance.dao.js';
export { FoodCategoryDao } from './food-category.dao.js';
export type { AssignCategoryInput } from './food-category.dao.js';

// Demand-weighted queue + distinct-requester demand.
export { FetchQueueDao } from './fetch-queue.dao.js';
export { FetchRequestersDao } from './fetch-requesters.dao.js';
export type { AddRequesterInput } from './fetch-requesters.dao.js';

// Per-source rolling-window limiter.
export { SourceCallLogDao } from './source-call-log.dao.js';
export type { CheckAndRecordInput, WindowCheckResult } from './source-call-log.dao.js';

// Disambiguation candidate set.
export { CandidateStore } from './food-candidates.dao.js';
export type { CandidateInput, PersistCandidatesInput, IsMemberInput } from './food-candidates.dao.js';

// Typed errors + guards.
export {
    FoodDaoError,
    isFoodDaoError,
    IllegalStatusTransitionError,
    isIllegalStatusTransitionError,
    isUniqueViolation,
} from './dao.errors.js';
