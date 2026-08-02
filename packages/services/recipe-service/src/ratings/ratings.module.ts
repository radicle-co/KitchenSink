import { Module } from '@nestjs/common';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RatingsController } from './ratings.controller.js';
import { RatingsService, RATINGS_DAL, RATING_RECIPES_DAL } from './ratings.service.js';
import { RatingsDal } from './dal/ratings.dal.js';
import { RecipesDal } from '../recipes/dal/recipes.dal.js';
import { RecipesModule } from '../recipes/recipes.module.js';

/**
 * Ratings module (CR-001 / FR-013). Owns the rating WRITE surface (`PUT`/`DELETE
 * /api/v1/recipes/{id}/rating`). Wires the {@link RatingsDal} (writes `recipe_ratings` only — the aggregate
 * self-maintains via trigger) and its own {@link RecipesDal} instance (the recipe existence/visibility
 * read that authorizes a rating) over the global Drizzle client, plus {@link RatingsService} and the
 * REST controller. It imports {@link RecipesModule} to reuse `RecipesService` for the `RecipeDetail`
 * response the contract returns on a rating write — one authoritative detail-shaping path. The global
 * `AuthMiddleware` (applied in `AppModule` to `*`) protects the routes; the global `ApiExceptionFilter`
 * maps thrown `RecipeDomainError`s to HTTP.
 */
@Module({
    imports: [RecipesModule],
    controllers: [RatingsController],
    providers: [
        {
            provide: RATINGS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): RatingsDal => new RatingsDal(db),
        },
        {
            provide: RATING_RECIPES_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): RecipesDal => new RecipesDal(db),
        },
        RatingsService,
    ],
})
export class RatingsModule {}
