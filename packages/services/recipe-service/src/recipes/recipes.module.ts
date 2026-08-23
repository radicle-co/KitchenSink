import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_AWS_REGION } from '../config/config.types.js';
import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesController } from './recipes.controller.js';
import {
    RecipesService,
    RECIPES_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_PHOTOS_CDN_URL,
    RECIPE_RATINGS_DAL,
} from './recipes.service.js';
import { RecipesDal } from './dal/recipes.dal.js';
import { RatingsDal } from '../ratings/dal/ratings.dal.js';
import { PhotosDal } from '../photos/dal/photos.dal.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { VersionsModule } from '../versions/versions.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { createSqsVerificationQueue, VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';

/**
 * Recipes module (US1). Owns recipe CRUD and ownership (`owner_id` = app-user ULID). Wires the
 * {@link RecipesDal} over the global Drizzle client, the {@link RecipesService} that authorizes and
 * shapes responses, and the {@link RecipesController} REST surface. The global `AuthMiddleware`
 * (applied in `AppModule`) populates `req.principal`; the global `ApiExceptionFilter` maps thrown
 * `RecipeDomainError`s to HTTP.
 *
 * **The verification gate's producer lives here (plan U11 / ADR-0024).** `RecipesService` is the ONE layer
 * holding every field the gate's contract needs — the persisted recipe id, the raw source line, the parsed
 * quantity and unit, and the catalog row's `foodId` — so this module provides the {@link VerificationQueuePort}
 * it enqueues through. It is a Port + Adapter over `@aws-sdk/client-sqs`, deliberately a SIBLING of
 * `AccountModule`'s `ERASURE_QUEUE` rather than a shared "queue client": the two carry different contracts and
 * have opposite failure semantics (an erasure is a compliance obligation with a durable row behind it; a lost
 * verification request degrades to the behaviour that predates the gate).
 */
@Module({
    // forwardRef: RecipesService records versions on every write; VersionsService drives a recipe write
    // on restore. The two modules depend on each other by design (see VersionsModule's matching ref).
    imports: [forwardRef(() => VersionsModule), IngredientsModule],
    controllers: [RecipesController],
    providers: [
        {
            provide: VERIFICATION_QUEUE,
            inject: [ConfigService],
            useFactory: (config: ConfigService): VerificationQueuePort =>
                createSqsVerificationQueue({
                    // `getOrThrow` states the invariant locally too: the boot-time Zod schema already
                    // requires this, so a stage wired with no verification queue fails the DEPLOY rather
                    // than silently asking the gate nothing — which is the state U11 shipped in.
                    queueUrl: config.getOrThrow<string>('INGREDIENT_VERIFICATION_QUEUE_URL'),
                    region: config.get<string>('AWS_REGION') ?? DEFAULT_AWS_REGION,
                    // ⚠️ The SAME `SQS_ENDPOINT` the erasure queue reads. One process, one LocalStack.
                    endpoint: config.get<string>('SQS_ENDPOINT'),
                }),
        },
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
            // Its OWN RatingsDal instance over the shared Drizzle client, to read the viewer's own rating for
            // `RecipeDetail.viewerRating` WITHOUT importing RatingsModule (which imports RecipesService →
            // would be a cycle). Same "own DAL instance" pattern as the embedded PhotosDal above.
            provide: RECIPE_RATINGS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): RatingsDal => new RatingsDal(db),
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
