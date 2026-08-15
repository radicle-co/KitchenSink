/**
 * The identity service's process entry point.
 *
 * ⚠️ TWO ORDERING CONSTRAINTS, BOTH LOAD-BEARING — DO NOT "TIDY" EITHER.
 *
 * 1. `./instrument.js` STAYS FIRST. Sentry's instrumentation must be installed before anything it patches is
 *    loaded, which is why it is a bare side-effect import at the top of the file. It also means a contract-skew
 *    crash below IS reported, rather than dying silently.
 * 2. `AppModule` IS LOADED WITH A **DYNAMIC** IMPORT. ES modules evaluate every static import before a single
 *    statement of this body runs, and `config/config.module.ts` calls `ConfigModule.forRoot({ validate })` in
 *    its `@Module` decorator argument — i.e. AT MODULE-EVALUATION TIME. With a static
 *    `import { AppModule } from './app.module.js'`, a broken environment throws `ConfigValidationError` out of
 *    the ESM loader before `bootstrap()` is entered, so the contract-skew assertion could not be the first thing
 *    to run no matter where it was written. Deferring the import makes the ordering real instead of
 *    asserted-in-a-comment. `__tests__/mainBootOrder.test.ts` fails if the static form comes back.
 */
import './instrument.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-identity';

import { CONTRACT_HASH } from './contract/contractHash.js';
import { assertContractHashesAgree } from './contract/contractSkew.js';
import { NestSentryLogger } from './observability/sentryLogging.js';
import { buildCorsPolicy } from './config/cors.js';

async function bootstrap(): Promise<void> {
    // DRIFT LAYER 3 (Skew) — the first thing this process does after Sentry is installed, and before config is
    // validated, the DI graph exists, or any database pool / AWS client is constructed. If the contract every
    // client compiles against does not describe this binary, there is nothing to be gained by getting further.
    // See `contract/contractSkew.ts` for what this does and does not catch, and for why failing closed costs no
    // availability: both values are baked into the image, so the outcome is fixed at build time and the unit
    // suite asserts it on the committed stamps.
    assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH);

    const { AppModule } = await import('./app.module.js');
    const logger = new NestSentryLogger();
    const app = await NestFactory.create(AppModule, { logger });

    // U11/F3: the service is fronted by a public ALB and called cross-origin by the web app, so with no
    // CORS those calls are blocked. The origin allowlist is DERIVED from the same Clerk `azp` boundary the
    // token check uses (`config/cors.ts`), per stage, and denies when nothing is configured. The resolved
    // mode is logged because "which posture is live" was previously unobservable — an empty parties list
    // silently became `origin: true` on every non-prod stage.
    const cors = buildCorsPolicy({
        stage: process.env['STAGE'] ?? 'dev',
        authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
        previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
        previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
    });

    app.enableCors(cors.options);
    logger.log(`CORS origin mode: ${cors.mode}`, 'bootstrap');

    const port = Number.parseInt(process.env['PORT'] ?? '3001', 10);

    await app.listen(port);
}

await bootstrap();
