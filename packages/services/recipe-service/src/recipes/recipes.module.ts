import { forwardRef, Module } from '@nestjs/common';
import type pg from 'pg';
import { VerificationRedriveDal } from '../ingredients/resolution/verificationRedrive.dal.js';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_AWS_REGION } from '../config/config.types.js';
import { DrizzleProvider, PgPoolProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesController } from './recipes.controller.js';
import {
    RecipesService,
    RECIPES_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_PHOTOS_CDN_URL,
    RECIPE_RATINGS_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
} from './recipes.service.js';
import { RecipesDal } from './dal/recipes.dal.js';
import { RatingsDal } from '../ratings/dal/ratings.dal.js';
import { PhotosDal } from '../photos/dal/photos.dal.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { LineVerificationsDal } from './dal/lineVerifications.dal.js';
import { VersionsModule } from '../versions/versions.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { createSqsVerificationQueue, VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';
import { createSqsParseJobQueue, PARSE_JOB_QUEUE, type ParseJobQueuePort } from './parseJob.queue.js';
import { ParseJobsController } from './parseJobs.controller.js';
import { ParseJobsService, PARSE_JOBS_DAL } from './parseJobs.service.js';
import { ParseJobsDal } from './dal/parseJobs.dal.js';

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
    controllers: [RecipesController, ParseJobsController],
    providers: [
        {
            // U4c — the pending re-drive substrate's write half. Its OWN instance over the shared Drizzle
            // client, the embedded-DAL pattern PhotosDal/RatingsDal established (no module import, no cycle).
            provide: VerificationRedriveDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): VerificationRedriveDal => new VerificationRedriveDal(db),
        },
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
            // Plan U9 — the parse-job producer, the THIRD SQS port and deliberately not a shared "queue
            // client" (see `parseJob.queue.ts`): its failure semantics are its own (a lost message IS the
            // work, so `ParseJobsService` marks lines `failed_retryable` instead of swallowing).
            provide: PARSE_JOB_QUEUE,
            inject: [ConfigService],
            useFactory: (config: ConfigService): ParseJobQueuePort =>
                createSqsParseJobQueue({
                    queueUrl: config.getOrThrow<string>('RECIPE_PARSE_QUEUE_URL'),
                    region: config.get<string>('AWS_REGION') ?? DEFAULT_AWS_REGION,
                    // ⚠️ The SAME `SQS_ENDPOINT` the other two queues read. One process, one LocalStack.
                    endpoint: config.get<string>('SQS_ENDPOINT'),
                }),
        },
        {
            // Plan U9 — its OWN instance over the shared Drizzle client, the embedded-DAL pattern.
            provide: PARSE_JOBS_DAL,
            inject: [DrizzleProvider, PgPoolProvider],
            useFactory: (db: RecipeDrizzle, pool: pg.Pool): ParseJobsDal => new ParseJobsDal(db, pool),
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
            // U14 — its OWN LineVerificationsDal instance over the shared Drizzle client, to read what the
            // U11 verification gate concluded about each line. Same "own DAL instance" pattern as the two
            // above; `recipe_ingredient_verifications` is WRITTEN only by `recipe-workers`.
            provide: RECIPE_LINE_VERIFICATIONS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): LineVerificationsDal => new LineVerificationsDal(db),
        },
        {
            provide: RECIPE_PHOTOS_CDN_URL,
            inject: [ConfigService],
            useFactory: (config: ConfigService): string => config.getOrThrow<string>('CLOUDFRONT_URL'),
        },
        RecipesService,
        ParseJobsService,
    ],
    exports: [RecipesService],
})
export class RecipesModule {}
