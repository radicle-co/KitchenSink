export {
    ALLOWED_RECIPE_PHOTO_MIME_TYPES,
    CUISINES,
    FoodResolutionStatus,
    IDENTITY_SYNC_PENDING_CODE,
    MAX_RECIPE_PHOTOS,
    MAX_RECIPE_PHOTO_UPLOAD_BYTES,
    RecipeCollectionAddedVia,
    RECIPE_MEAL_TYPES,
    RecipeDifficulty,
    RecipeMealType,
    RecipeErrorCode,
    RecipeSearchSortBy,
    RecipeSourceType,
    RecipeStatus,
    RecipeVersionArchiveStatus,
    RecipeVisibility,
    collectionSchema,
    foodResolutionStatusSchema,
    ingredientPortionSchema,
    ingredientSchema,
    isRecipeError,
    isoDateTimeSchema,
    lineResolutionStatusSchema,
    paginatedResponseSchema,
    recipeCollectionAddedViaSchema,
    recipeCollectionSchema,
    recipeDetailSchema,
    recipeDifficultySchema,
    recipeMealTypeSchema,
    recipeErrorCodeSchema,
    recipeErrorSchema,
    recipeFacetCountSchema,
    recipeIngredientSchema,
    recipeIngredientViewSchema,
    recipeNutritionSchema,
    recipePhotoSchema,
    recipeRatingSchema,
    recipeSchema,
    recipeSearchResultSchema,
    recipeSearchSortBySchema,
    recipeSnapshotSchema,
    recipeSourceTypeSchema,
    recipeStatusSchema,
    recipeStepSchema,
    recipeStepViewSchema,
    recipeVersionArchiveStatusSchema,
    recipeVersionPendingArchiveSchema,
    recipeVersionSchema,
    recipeVisibilitySchema,
    usesPremiumCapability,
    versionConflictDetailsSchema,
    versionConflictSideSchema,
} from './recipe.types.js';
export type {
    AllowedRecipePhotoMimeType,
    Collection,
    CatalogFoodResolutionStatus,
    Cuisine,
    Ingredient,
    IngredientPortion,
    IsoDateTimeString,
    LineResolutionStatus,
    PaginatedResponse,
    Recipe,
    RecipeCollection,
    RecipeDetail,
    RecipeError,
    RecipeFacetCount,
    RecipeIngredient,
    RecipeIngredientView,
    RecipeNutrition,
    RecipePhoto,
    RecipeRating,
    RecipeSearchResult,
    RecipeSnapshot,
    RecipeStep,
    RecipeStepView,
    RecipeVersion,
    RecipeVersionPendingArchive,
    VersionConflictDetails,
    VersionConflictSide,
} from './recipe.types.js';
export {
    INT4_CEILING,
    MAX_RECIPE_CUISINE_LENGTH,
    MAX_RECIPE_DESCRIPTION_LENGTH,
    MAX_RECIPE_INGREDIENTS,
    MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH,
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH,
    MAX_RECIPE_INGREDIENT_QUANTITY,
    MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH,
    MAX_RECIPE_LIST_PAGE_SIZE,
    MAX_RECIPE_SOURCE_ATTRIBUTION_LENGTH,
    MAX_RECIPE_SOURCE_URL_LENGTH,
    MAX_RECIPE_TAGS,
    MAX_RECIPE_TITLE_LENGTH,
    MAX_SEARCH_PAGE_SIZE,
    MIN_RECIPE_INGREDIENT_QUANTITY,
    NUMERIC_8_2_CEILING,
    recipeCuisineSchema,
    recipeDescriptionSchema,
    recipeExpectedVersionSchema,
    recipeIngredientGroupLabelSchema,
    recipeIngredientIdSchema,
    recipeIngredientNameSchema,
    recipeIngredientNotesSchema,
    recipeIngredientPreparationSchema,
    recipeIngredientQuantitySchema,
    recipeIngredientSourceLineSchema,
    recipeIngredientUnitSchema,
    recipeLineNutritionSchema,
    recipeListMemberSchema,
    recipeMinutesSchema,
    recipeRatingStarsSchema,
    recipeServingsSchema,
    recipeSourceAttributionSchema,
    recipeSourceUrlSchema,
    recipeStepInstructionSchema,
    recipeTimerSecondsSchema,
    recipeTitleSchema,
} from './recipeRequestBounds.js';
export {
    RECIPE_PHOTO_THUMBNAIL_SUFFIX,
    ownerMediaPrefix,
    recipeMediaPrefix,
    recipePhotoKeyPrefix,
    recipePhotoOriginalKey,
    recipePhotoThumbnailKey,
    recipeVersionArchiveKey,
} from './recipeObjectKeys.js';
export type { RecipeVersionArchiveKeyParts } from './recipeObjectKeys.js';
// NOTE: `recipeDatabaseName.ts` is deliberately NOT re-exported here. It is reachable ONLY as
// `@kitchensink/recipe-core/database-name` — see that module's doc comment for the reason (CDK infra apps
// that run as COMPILED JavaScript cannot load this barrel).
export { ACCOUNT_ALREADY_ERASED_CODE, pseudonymizedAuthorHandle } from './accountErasure.js';
export type { AccountErasureMessage } from './accountErasure.js';
export {
    ERASURE_TRIGGER_SOURCES,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE,
    SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
    buildServiceErasureJwtClaims,
    isErasureTriggerSource,
    parseServiceErasureClaims,
} from './serviceErasureToken.js';
export type {
    ErasureTriggerSource,
    ServiceErasureJwtClaims,
    ServiceErasureTokenClaims,
} from './serviceErasureToken.js';
export { cdnOwnerPrefixInvalidationPath, cdnPathForKey } from './cdnInvalidation.js';
export type { CdnInvalidationPort } from './cdnInvalidation.js';
export {
    foodId,
    ingredientId,
    isFoodId,
    isIngredientId,
    isRecipeId,
    isS3Key,
    isUserId,
    recipeId,
    s3Key,
    userId,
} from './ids.js';
export type { FoodId, IngredientId, RecipeId, S3Key, UserId } from './ids.js';
export { makeViewer, rankTier, tierSchema } from './viewer.js';
export type { Tier, Viewer } from './viewer.js';
export { canClone, canGoPrivate, canRate, isOwner } from './recipeAccessPolicy.js';
export {
    ABSENT_QUANTITY,
    ingredientQuantitySchema,
    quantitiesEqual,
    quantityLowerBound,
    quantityUpperBound,
    statedQuantity,
} from './ingredientQuantity.js';
export { statedAmountSchema } from './ingredientQuantity.js';
export type { IngredientQuantity, StatedAmount } from './ingredientQuantity.js';
export { statedMeasureSchema } from './statedMeasure.js';
export type { StatedMeasure } from './statedMeasure.js';
// ⛔ `CASE_SENSITIVE_UNIT_ALIASES` is deliberately NOT re-exported here. It is module-scope-exported so
// `units.test.ts` can hold a TOTAL invariant over the live table rather than a hand-picked list of
// spellings; a consumer wants `normalizeUnit` or `unitSpellingDependsOnCase`, never the table itself.
export {
    classifyUnit,
    normalizeUnit,
    unitSpellingDependsOnCase,
    unitToGrams,
    MASS_UNIT_TO_GRAMS,
    SUBJECTIVE_UNIT_VOCABULARY,
    UNIT_VOCABULARY,
} from './units.js';
export type { UnitClass } from './units.js';
export {
    computeRecipeNutrition,
    hasUserEnteredIngredients,
    lineNutritionSource,
    toNutritionLine,
} from './nutrition.js';
export type { LineCatalogNutrition, LineMeasure, LineNutritionSource, NutritionLine } from './nutrition.js';
