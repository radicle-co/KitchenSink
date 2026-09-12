/**
 * The food (ingredient) service's process entry point.
 *
 * ⚠️ `AppModule` IS LOADED WITH A **DYNAMIC** IMPORT, AND THAT IS NOT STYLE — DO NOT "TIDY" IT INTO A STATIC
 * ONE. ES modules evaluate every static import before a single statement of this file's body runs, and the
 * config module validates `process.env` at MODULE-EVALUATION TIME — so with a static
 * `import { AppModule } from './app.module.js'` a broken environment throws out of the ESM loader before
 * `bootstrap()` is entered, and the contract-skew assertion below could not be the first thing to run no matter
 * where it was written in this body. Deferring the import is what makes the ordering real instead of
 * asserted-in-a-comment. `__tests__/mainBootOrder.test.ts` fails if the static form comes back.
 */
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestRoutedLogger } from '@kitchensink/service-logging';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-food';

import { CONTRACT_HASH } from './contract/contractHash.js';
import { assertContractHashesAgree } from './contract/contractSkew.js';
import { settingFromEnv } from './config/env.schema.js';
import { DrizzleProvider, type FoodDrizzle } from './database/database.module.js';
import { verifyFoodSchemaCurrent } from './db/schemaCurrency.js';

/**
 * Bootstrap the food-service HTTP API.
 *
 * @sideEffect Starts the NestJS HTTP server on `PORT` (default 3002).
 */
async function bootstrap(): Promise<void> {
    // DRIFT LAYER 3 (Skew) — the FIRST thing this process does, before config is validated, before the DI graph
    // exists, and before any database pool or AWS client is constructed. If the contract every client compiles
    // against does not describe this binary, there is nothing to be gained by getting further. See
    // `contract/contractSkew.ts` for what this does and does not catch, and for why failing closed here costs
    // no availability: both values are baked into the image, so the outcome is fixed at build time and the unit
    // suite asserts it on the committed stamps.
    assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH);

    const { AppModule } = await import('./app.module.js');
    // ⛔ THE LOGGER IS PASSED HERE, AND THAT — NOT ANY CALL-SITE EDIT — IS WHAT ROUTES THIS SERVICE.
    // `NestFactory.create` calls `Logger.overrideLogger(logger)`, and Nest's `Logger` resolves that static
    // at CALL time, so every existing `new Logger(X.name)` in this service routes through the adapter
    // without being touched — including instances constructed at module load, before this line runs
    // (`photos/cdnInvalidation.ts` is one). Measured, and pinned by
    // `@kitchensink/service-logging`'s `tests/nestRouting.integration.test.ts`.
    //
    // ⛔ WHAT IT BUYS: an `error` becomes an entry in THIS service's own Sentry project instead of a line
    // in the shared `kitchensink-log-drain` (ADR-0042), and `info`/`warn` keep reaching CloudWatch — which
    // is the half its predecessor in identity got wrong, writing nothing to stdout and therefore DELETING
    // every line on any run with no DSN.
    const app = await NestFactory.create(AppModule, { logger: new NestRoutedLogger() });

    // DRIFT LAYER 4 (Schema) — is the database this process is about to serve from actually current for this
    // release? The pipeline migrates ahead of this deploy (ADR-0035), so on the ordinary release path this
    // says nothing. It exists for the paths that are NOT a release — a restore from a snapshot taken before a
    // migration, a task scaling out long afterwards, a stack deployed by hand — which is exactly the case a
    // pipeline step structurally cannot see.
    //
    // ⛔ It runs BEFORE `listen`, so a refusal (once `SCHEMA_CURRENCY_MODE=enforce`) happens before this task
    // can be registered healthy and given traffic. It ships in `warn`, where it cannot refuse anything.
    await verifyFoodSchemaCurrent(app.get<FoodDrizzle>(DrizzleProvider), (message) => {
        new Logger('bootstrap').warn(message);
    });

    // Through the ONE validated reader: the 3002 default lives only in `config/env.schema.ts`, and a
    // malformed PORT fails loudly here instead of becoming NaN — which Node treats as port 0, so the API
    // would bind a RANDOM port and every ALB health check would fail against an otherwise healthy task.
    await app.listen(settingFromEnv('PORT'));
}

await bootstrap();
