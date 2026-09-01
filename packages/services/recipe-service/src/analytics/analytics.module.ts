/**
 * Analytics plan U3 — the analytics capture module.
 *
 * Exports {@link AnalyticsService}, the single fire-and-forget writer both capture doors share: the
 * server door (RecipesController's detail read, CollectionsService's save) injects it directly, and
 * U4's ingestion controller mounts beside it in this module. The database comes from the global
 * `DatabaseModule` provider, so this module has no imports of its own.
 */
import { Module } from '@nestjs/common';

import { AnalyticsService } from './analytics.service.js';

@Module({
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule {}
