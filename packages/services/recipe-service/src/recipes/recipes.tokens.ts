/**
 * @module recipe-service/recipes — the vertical's DI TOKENS, and nothing else.
 *
 * ⛔ THEY LIVE HERE BECAUSE TWO CLASSES NEED THEM. They were declared in `recipes.service.ts`, which was fine
 * while that class was their only consumer. `RecipeDetailAssembler` now injects four of them — and it is
 * itself injected INTO `RecipesService`, so importing them from the service would close an import cycle
 * (`service → assembler → service`) for the sake of six string constants.
 *
 * ⚠️ Import them from HERE, never through either class — a re-export from the service would state the surface
 * twice and advertise dependencies the service no longer has. Each token keeps the docstring that explains why
 * its collaborator is injected by token rather than by class — those arguments are about module cycles and
 * own-instance DALs, and they are the reason the tokens exist at all.
 */

/** DI token for the recipe DAL — provided by `RecipesModule` via `useFactory` over the Drizzle client. */
export const RECIPES_DAL = 'RECIPES_DAL';

/** DI token for the shadow coin's RNG — injected so the band shadow sampling is testable. */
export const RECIPES_SHADOW_RNG = 'RECIPES_SHADOW_RNG';

/** DI token for the recipes vertical's own `PhotosDal` instance (embeds a recipe's photos in the detail). */
export const RECIPE_PHOTOS_DAL = 'RECIPE_PHOTOS_DAL';

/** DI token for the CloudFront base URL used to resolve embedded photo URLs. */
export const RECIPE_PHOTOS_CDN_URL = 'RECIPE_PHOTOS_CDN_URL';

/**
 * DI token for the recipes vertical's OWN `RatingsDal` instance (over the shared Drizzle client),
 * used only to read the VIEWER's own rating for the `RecipeDetail.viewerRating` field. Its own instance
 * (not the ratings vertical's `RATINGS_DAL`) keeps `RecipesModule` self-contained and, crucially, avoids
 * a module cycle: `RatingsModule` imports `RecipesModule` (to reuse `RecipesService`), so `RecipesModule`
 * must NOT import `RatingsModule`. The same "own DAL instance" pattern the vertical uses for its embedded
 * PhotosDal. `RatingsDal` remains the single owner of all `recipe_ratings` SQL (including this read).
 */
export const RECIPE_RATINGS_DAL = 'RECIPE_RATINGS_DAL';

/**
 * DI token for the recipes vertical's `LineVerificationsDal` — the read side of the U11 verification
 * gate (plan U14). Same "own DAL instance over the shared Drizzle client" pattern as the two above.
 */
export const RECIPE_LINE_VERIFICATIONS_DAL = 'RECIPE_LINE_VERIFICATIONS_DAL';
