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
 * `__tests__/main-boot-order.test.ts` fails if the static form comes back.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-recipe';

import { buildCorsPolicy } from './config/cors.js';
import { CONTRACT_HASH } from './contract/contract-hash.js';
import { assertContractHashesAgree } from './contract/contract-skew.js';

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
    new Logger('bootstrap').log(`CORS origin mode: ${cors.mode}`);

    await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
