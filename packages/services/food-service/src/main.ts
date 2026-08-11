/**
 * The food (ingredient) service's process entry point.
 *
 * ⚠️ `AppModule` IS LOADED WITH A **DYNAMIC** IMPORT, AND THAT IS NOT STYLE — DO NOT "TIDY" IT INTO A STATIC
 * ONE. ES modules evaluate every static import before a single statement of this file's body runs, and the
 * config module validates `process.env` at MODULE-EVALUATION TIME — so with a static
 * `import { AppModule } from './app.module.js'` a broken environment throws out of the ESM loader before
 * `bootstrap()` is entered, and the contract-skew assertion below could not be the first thing to run no matter
 * where it was written in this body. Deferring the import is what makes the ordering real instead of
 * asserted-in-a-comment. `__tests__/main-boot-order.test.ts` fails if the static form comes back.
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-food';

import { CONTRACT_HASH } from './contract/contract-hash.js';
import { assertContractHashesAgree } from './contract/contract-skew.js';
import { settingFromEnv } from './config/env.schema.js';

/**
 * Bootstrap the food-service HTTP API.
 *
 * @sideEffect Starts the NestJS HTTP server on `PORT` (default 3002).
 */
async function bootstrap(): Promise<void> {
    // DRIFT LAYER 3 (Skew) — the FIRST thing this process does, before config is validated, before the DI graph
    // exists, and before any database pool or AWS client is constructed. If the contract every client compiles
    // against does not describe this binary, there is nothing to be gained by getting further. See
    // `contract/contract-skew.ts` for what this does and does not catch, and for why failing closed here costs
    // no availability: both values are baked into the image, so the outcome is fixed at build time and the unit
    // suite asserts it on the committed stamps.
    assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH);

    const { AppModule } = await import('./app.module.js');
    const app = await NestFactory.create(AppModule);

    // Through the ONE validated reader: the 3002 default lives only in `config/env.schema.ts`, and a
    // malformed PORT fails loudly here instead of becoming NaN — which Node treats as port 0, so the API
    // would bind a RANDOM port and every ALB health check would fail against an otherwise healthy task.
    await app.listen(settingFromEnv('PORT'));
}

await bootstrap();
