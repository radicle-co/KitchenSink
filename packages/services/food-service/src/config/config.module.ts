import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EnvironmentSchema } from './env.schema.js';

/**
 * Global config module: validates `process.env` against {@link EnvironmentSchema} at boot, so a
 * missing required value (the source API key `USDA_API_KEY` or the database block) or any malformed
 * value fails the NestJS bootstrap with a descriptive Zod error rather than surfacing as a runtime
 * `undefined`. The source-agnostic operational + auth knobs carry documented defaults.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: (config: Record<string, unknown>) => EnvironmentSchema.parse(config),
        }),
    ],
    exports: [ConfigModule],
})
export class AppConfigModule {}
