import './instrument.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { NestSentryLogger } from './observability/sentry-logging.js';
import { buildCorsOptions } from './config/cors.js';
import { parseCommaList } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, { logger: new NestSentryLogger() });

    // U11/F3: the service is fronted by a public ALB and called cross-origin by the web/mobile apps.
    // With no CORS those calls are blocked. Reuse the Clerk authorized-parties allowlist as the CORS
    // origin allowlist (same trust boundary).
    app.enableCors(buildCorsOptions(parseCommaList(process.env['CLERK_AUTHORIZED_PARTIES'])));

    const port = Number.parseInt(process.env['PORT'] ?? '3001', 10);

    await app.listen(port);
}

await bootstrap();
