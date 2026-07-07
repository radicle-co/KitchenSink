import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

/**
 * Bootstrap the food-service HTTP API.
 *
 * @sideEffect Starts the NestJS HTTP server on `PORT` (default 3002).
 */
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    const port = Number.parseInt(process.env['PORT'] ?? '3002', 10);

    await app.listen(port);
}

await bootstrap();
