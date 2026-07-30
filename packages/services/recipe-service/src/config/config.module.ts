import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { apiConfigSchema } from './config.types.js';
import { localEnvFilePaths } from './env-files.js';
import { loadConfig } from './load-config.js';

/**
 * Global config module: validates `process.env` against {@link apiConfigSchema} at boot (via
 * {@link loadConfig}), so a missing/malformed value fails the NestJS bootstrap with a descriptive
 * aggregated error rather than surfacing later as a runtime `undefined`. Mirrors the identity and food
 * services' config modules, plus the development-only env-file load described on
 * {@link localEnvFilePaths}.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: localEnvFilePaths(process.env['NODE_ENV']),
            // Outside development there is no env file at all — config comes from the task definition only.
            ignoreEnvFile: localEnvFilePaths(process.env['NODE_ENV']).length === 0,
            validate: (config: Record<string, unknown>) => loadConfig(apiConfigSchema, config),
        }),
    ],
    exports: [ConfigModule],
})
export class AppConfigModule {}
