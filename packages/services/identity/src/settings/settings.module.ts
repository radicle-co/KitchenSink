import { Module } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SettingsDAO } from '@kitchensink/identity-db';

import { DrizzleProvider } from '../database/database.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
    controllers: [SettingsController],
    providers: [
        {
            provide: SettingsDAO,
            useFactory: (db: NodePgDatabase): SettingsDAO => new SettingsDAO(db),
            inject: [DrizzleProvider],
        },
        SettingsService,
    ],
})
export class SettingsModule {}
