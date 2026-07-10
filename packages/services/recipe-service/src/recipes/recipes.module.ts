import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService, RECIPES_DAL, RECIPE_PHOTOS_DAL, RECIPE_PHOTOS_CDN_URL } from './recipes.service.js';
import { RecipesDal } from './dal/recipes.dal.js';
import { PhotosDal } from '../photos/dal/photos.dal.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { VersionsModule } from '../versions/versions.module.js';

/**
 * Recipes module (US1). Owns recipe CRUD and ownership (`owner_id` = app-user ULID). Wires the
 * {@link RecipesDal} over the global Drizzle client, the {@link RecipesService} that authorizes and
 * shapes responses, and the {@link RecipesController} REST surface. The global `AuthMiddleware`
 * (applied in `AppModule`) populates `req.principal`; the global `ApiExceptionFilter` maps thrown
 * `RecipeDomainError`s to HTTP.
 */
@Module({
    // forwardRef: RecipesService records versions on every write; VersionsService drives a recipe write
    // on restore. The two modules depend on each other by design (see VersionsModule's matching ref).
    imports: [forwardRef(() => VersionsModule)],
    controllers: [RecipesController],
    providers: [
        {
            provide: RECIPES_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): RecipesDal => new RecipesDal(db),
        },
        {
            // The recipes vertical resolves each ingredient line to a catalog row (T043b) via its own
            // IngredientsDal instance over the shared Drizzle client — same factory pattern as the DAL above.
            provide: IngredientsDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): IngredientsDal => new IngredientsDal(db),
        },
        {
            // Its OWN PhotosDal instance over the shared Drizzle client, to embed a recipe's photos in the
            // detail read WITHOUT importing PhotosModule (which imports RecipesService → would be a cycle).
            provide: RECIPE_PHOTOS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): PhotosDal => new PhotosDal(db),
        },
        {
            provide: RECIPE_PHOTOS_CDN_URL,
            inject: [ConfigService],
            useFactory: (config: ConfigService): string => config.getOrThrow<string>('CLOUDFRONT_URL'),
        },
        RecipesService,
    ],
    exports: [RecipesService],
})
export class RecipesModule {}
