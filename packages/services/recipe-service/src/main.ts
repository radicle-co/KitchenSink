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
import { NestFactory } from '@nestjs/core';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-recipe';

import { buildCorsOptions } from './config/cors.js';
import { CONTRACT_HASH } from './contract/contract-hash.js';
import { assertContractHashesAgree } from './contract/contract-skew.js';

/** Parse a comma-separated env allowlist into trimmed, non-empty entries (mirrors identity's parser). */
function parseCommaList(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

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

    // Cross-origin browser calls from the web app need CORS; reuse the Clerk authorized-parties allowlist
    // as the origin allowlist (same trust boundary), mirroring the identity service. See config/cors.ts.
    app.enableCors(buildCorsOptions(parseCommaList(process.env['CLERK_AUTHORIZED_PARTIES'])));

    await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
