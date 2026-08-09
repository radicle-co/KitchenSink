import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { settingFromEnv } from './config/env.schema.js';

/**
 * Bootstrap the food-service HTTP API.
 *
 * @sideEffect Starts the NestJS HTTP server on `PORT` (default 3002).
 */
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    // Through the ONE validated reader: the 3002 default lives only in `config/env.schema.ts`, and a
    // malformed PORT fails loudly here instead of becoming NaN — which Node treats as port 0, so the API
    // would bind a RANDOM port and every ALB health check would fail against an otherwise healthy task.
    await app.listen(settingFromEnv('PORT'));
}

await bootstrap();
