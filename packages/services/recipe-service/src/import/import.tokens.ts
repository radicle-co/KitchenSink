/**
 * DI tokens of the bulk import module.
 *
 * The repositories are provided under STRING tokens, not their classes, so a unit test can hand a service a narrow fake and
 * the module can own how each is built over the shared Drizzle client (the embedded-DAL pattern `RecipesModule` uses).
 */

/** The import header repository (`RecipeImportsDal`). */
export const RECIPE_IMPORTS_DAL = 'RECIPE_IMPORTS_DAL';

/** The import item repository (`RecipeImportItemsDal`). */
export const RECIPE_IMPORT_ITEMS_DAL = 'RECIPE_IMPORT_ITEMS_DAL';

/** The snapshot line repository (`RecipeImportLinesDal`). */
export const RECIPE_IMPORT_LINES_DAL = 'RECIPE_IMPORT_LINES_DAL';

/** The advance step's bounds (`ImportAdvanceLimits`). */
export const IMPORT_ADVANCE_LIMITS = 'IMPORT_ADVANCE_LIMITS';
