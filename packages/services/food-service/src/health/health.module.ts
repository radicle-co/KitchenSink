import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';

/** Exposes the unauthenticated `/health` probe. */
@Module({
    controllers: [HealthController],
})
export class HealthModule {}
