/**
 * Public surface of `@kitchensink/food-service`. The Drizzle schema is the stable foundation
 * export consumed by migrations and downstream tooling; service internals are added per phase.
 */
export { AppConfigModule } from './config/config.module.js';
export { EnvironmentSchema, FOOD_SETTING_SCHEMAS, resolveEnvironment, settingFromEnv } from './config/env.schema.js';
export type { Environment, FoodSetting, FoodSettingName } from './config/env.schema.js';
export {
    fetchQueue,
    fetchRequesters,
    food,
    foodCandidates,
    foodCategory,
    foodCategoryAssignment,
    foodFieldEnum,
    foodFieldProvenance,
    foodForward,
    foodItem,
    foodItemOwnerKindEnum,
    foodKindEnum,
    foodNutrition,
    foodNutritionCitation,
    foodNutritionValue,
    foodPortions,
    foodSourceEnum,
    foodSources,
    foodStatusEnum,
    foodVariant,
    foodVariantPart,
    nutrient,
    nutrientBasisEnum,
    sourceCallLog,
    sourceSyncMetadata,
} from './db/schema/index.js';
export type {
    FetchQueueRow,
    FetchRequesterRow,
    FoodCandidateRow,
    FoodCategoryRow,
    FoodItemRow,
    FoodNutritionValueRow,
    FoodPortionRow,
    FoodRow,
    FoodSourceRow,
    FoodVariantRow,
    NewFetchQueueRow,
    NewFetchRequesterRow,
    NewFoodCandidateRow,
    NewFoodCategoryRow,
    NewFoodPortionRow,
    NewFoodRow,
    NewFoodSourceRow,
    NewNutrientRow,
    NewSourceCallLogRow,
    NewSourceSyncMetadataRow,
    NutrientRow,
    SourceCallLogRow,
    SourceSyncMetadataRow,
} from './db/schema/index.js';
