import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { apiConfigSchema } from './config.types.js';
import { loadConfig } from './load-config.js';

/**
 * Global config module: validates `process.env` against {@link apiConfigSchema} at boot (via
 * {@link loadConfig}), so a missing/malformed value fails the NestJS bootstrap with a descriptive
 * aggregated error rather than surfacing later as a runtime `undefined`. Mirrors the identity and
 * food services' config modules.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: (config: Record<string, unknown>) => loadConfig(apiConfigSchema, config),
        }),
    ],
    exports: [ConfigModule],
})
export class AppConfigModule {}
