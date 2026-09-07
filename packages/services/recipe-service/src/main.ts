/**
 * The recipe service's process entry point.
 *
 * ⚠️ `AppModule` IS LOADED WITH A **DYNAMIC** IMPORT, AND THAT IS NOT STYLE — DO NOT "TIDY" IT INTO A STATIC
 * ONE. ES modules evaluate every static import before a single statement of this file's body runs, and
 * `config/config.module.ts` calls `ConfigModule.forRoot({ validate })` in its `@Module` decorator argument —
 * i.e. AT MODULE-EVALUATION TIME. Measured: with a static `import { AppModule } from './app.module.js'`, a
 * broken environment throws `ConfigValidationError` out of the ESM loader before `bootstrap()` is entered, so
 * the contract-skew assertion below could not be the first thing to run no matter where it was written in this
 * body. Deferring the import is what makes the ordering real instead of asserted-in-a-comment.
 * `__tests__/mainBootOrder.test.ts` fails if the static form comes back.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-recipe';

import { buildCorsPolicy } from './config/cors.js';
import { CONTRACT_HASH } from './contract/contractHash.js';
import { assertContractHashesAgree } from './contract/contractSkew.js';
import { DrizzleProvider, type RecipeDrizzle } from './database/database.module.js';
import { verifyRecipeSchemaCurrent } from './database/schemaCurrency.js';

async function bootstrap(): Promise<void> {
    // DRIFT LAYER 3 (Skew) — the FIRST thing this process does, before config is validated, before the DI graph
    // exists, and before any database pool or AWS client is constructed. If the contract every client compiles
    // against does not describe this binary, there is nothing to be gained by getting further. See
    // `contract/contractSkew.ts` for what this does and does not catch, and for why failing closed here costs
    // no availability: both values are baked into the image, so the outcome is fixed at build time and the unit
    // suite asserts it on the committed stamps.
    assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH);

    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create(AppModule);

    // Cross-origin browser calls from the web app need CORS. The origin allowlist is DERIVED from the same
    // Clerk `azp` boundary the token check uses (`config/cors.ts`), per environment, and DENIES when nothing
    // is configured. The resolved mode is logged because "which posture is live" was previously unobservable:
    // an empty `CLERK_AUTHORIZED_PARTIES` list silently became `origin: true` — reflect any origin — on
    // sandbox and on every `pr-{N}`.
    const cors = buildCorsPolicy({
        nodeEnv: process.env['NODE_ENV'],
        authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
        previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
        previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
    });

    app.enableCors(cors.options);

    const logger = new Logger('bootstrap');

    logger.log(`CORS origin mode: ${cors.mode}`);

    // DRIFT LAYER 4 (Schema) — is the database this process is about to serve from actually current for
    // this release? The pipeline migrates ahead of this deploy (ADR-0035), so on the ordinary release path
    // this says nothing. It exists for the paths that are not a release — a restore from a snapshot taken
    // before a migration, a task scaling out long afterwards, a stack deployed by hand — which is exactly
    // the case a pipeline step structurally cannot see.
    //
    // ⛔ It runs BEFORE `listen`, so a refusal (once `SCHEMA_CURRENCY_MODE=enforce`) happens before this
    // task can be registered healthy and given traffic. It ships in `warn`, where it cannot refuse anything.
    await verifyRecipeSchemaCurrent(app.get<RecipeDrizzle>(DrizzleProvider), (message) => {
        logger.warn(message);
    });

    await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
