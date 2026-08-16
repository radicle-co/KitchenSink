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
    NutritionRecord,
    StoredNutrientAmount,
    StoredPortionWeight,
    CreateByNameInput,
    CreateByNameResult,
    SetStatusInput,
    GoldenScalars,
} from './food.dao.js';

// Crosswalk.
export { FoodSourcesDao } from './foodSources.dao.js';
export type { BackingItem, FoodSource, UpsertSourceInput } from './foodSources.dao.js';

// Nutrient dictionary + values.
export { NutrientDao } from './nutrient.dao.js';
export type { ResolveNutrientInput } from './nutrient.dao.js';
export { FoodNutrientsDao } from './foodNutrients.dao.js';
export type { NutrientBasis, UpsertNutrientValueInput } from './foodNutrients.dao.js';

// Portions, scalar provenance, categories.
export { FoodPortionsDao } from './foodPortions.dao.js';
export type { InsertPortionInput } from './foodPortions.dao.js';
export { FoodFieldProvenanceDao } from './foodFieldProvenance.dao.js';
export type { FoodField, RecordFieldProvenanceInput, SourceField } from './foodFieldProvenance.dao.js';
export { FoodCategoryDao } from './foodCategory.dao.js';
export type { AssignCategoryInput } from './foodCategory.dao.js';

// Demand-weighted queue + distinct-requester demand.
export { FetchQueueDao } from './fetchQueue.dao.js';
export { FetchRequestersDao } from './fetchRequesters.dao.js';
export type { AddRequesterInput } from './fetchRequesters.dao.js';

// Per-source rolling-window limiter.
export { SourceCallLogDao } from './sourceCallLog.dao.js';
export type { CheckAndRecordInput, WindowCheckResult } from './sourceCallLog.dao.js';

// Disambiguation candidate set.
export { CandidateStore } from './foodCandidates.dao.js';
export type { CandidateInput, PersistCandidatesInput, IsMemberInput } from './foodCandidates.dao.js';

// Typed errors + guards.
export {
    FoodDaoError,
    isFoodDaoError,
    IllegalStatusTransitionError,
    isIllegalStatusTransitionError,
    isUniqueViolation,
} from './dao.errors.js';
