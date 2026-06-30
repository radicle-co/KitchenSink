/**
 * `FoodsModule` (T-130) — wires the source-agnostic `/v1/foods/*` API onto the committed layers: the
 * per-aggregate DAOs (`FoodDao`, `CandidateStore`, `FoodSourcesDao`, `FoodSearchDao`), the source-adapter
 * registry (USDA wired), the per-source rolling-window limiter, the merge/persist service, the
 * {@link EnqueueEmitter} (in-process Postgres-as-queue), and the {@link AdmissionService} (backpressure).
 * The DAOs and the merge/registry/limiter are plain classes constructed over the global Drizzle client /
 * `pg` pool via factory providers (their class is the DI token); the controller, service, emitter, and
 * admission service are NestJS-managed.
 *
 * The {@link FoodAuthGuard} middleware is mounted ahead of {@link FoodsController} via `configure` so EVERY
 * `/v1/foods/*` route is authenticated before any handler runs (FR-035). No source (USDA) type leaks into
 * the controller layer (FR-ADP-1).
 *
 * @implements FR-001 FR-IDN-1
 */
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { UsdaApiClient } from '@kitchensink/usda-client';

import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { FoodAuthGuard } from '../auth/food-auth.guard.js';
import { SourceAdapterRegistry } from '../sources/food-source-adapter.js';
import { RollingWindowLimiter, type SourceCap } from '../sources/rolling-window-limiter.js';
import { UsdaSourceAdapter } from '../sources/usda/usda.adapter.js';
import { AdmissionService } from './admission.service.js';
import { CandidateStore, FoodDao, FoodSourcesDao, SourceCallLogDao } from './dao/index.js';
import { FoodSearchDao } from './dao/food-search.dao.js';
import { EnqueueEmitter } from './enqueue.emitter.js';
import { FoodsController } from './foods.controller.js';
import { FoodsService } from './foods.service.js';
import { GoldenRecordMergeEngine } from './merge/merge-engine.js';
import { MergeAndPersistService } from './merge/merge-and-persist.service.js';

/** Build the per-source caps from env (`USDA_RATE_LIMIT_PER_HOUR`); pause at 90% (FR-019). */
function usdaCaps(): { usda: SourceCap } {
    const hardCap = Number(process.env['USDA_RATE_LIMIT_PER_HOUR'] ?? 1000);

    return { usda: { hardCap, pauseThreshold: Math.floor(hardCap * 0.9) } };
}

@Module({
    controllers: [FoodsController],
    providers: [
        FoodsService,
        EnqueueEmitter,
        AdmissionService,
        FoodAuthGuard,
        { provide: FoodDao, inject: [DrizzleProvider], useFactory: (db: FoodDrizzle): FoodDao => new FoodDao(db) },
        {
            provide: CandidateStore,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): CandidateStore => new CandidateStore(db),
        },
        {
            provide: FoodSourcesDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): FoodSourcesDao => new FoodSourcesDao(db),
        },
        {
            provide: FoodSearchDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): FoodSearchDao => new FoodSearchDao(db),
        },
        {
            provide: SourceAdapterRegistry,
            useFactory: (): SourceAdapterRegistry => {
                const registry = new SourceAdapterRegistry();
                const apiKey = process.env['USDA_API_KEY'] ?? '';
                registry.register(new UsdaSourceAdapter(new UsdaApiClient({ apiKey })));

                return registry;
            },
        },
        {
            provide: GoldenRecordMergeEngine,
            inject: [SourceAdapterRegistry],
            useFactory: (registry: SourceAdapterRegistry): GoldenRecordMergeEngine =>
                new GoldenRecordMergeEngine(registry),
        },
        {
            provide: MergeAndPersistService,
            inject: [DrizzleProvider, GoldenRecordMergeEngine],
            useFactory: (db: FoodDrizzle, engine: GoldenRecordMergeEngine): MergeAndPersistService =>
                new MergeAndPersistService(db, engine),
        },
        {
            provide: RollingWindowLimiter,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): RollingWindowLimiter =>
                new RollingWindowLimiter(new SourceCallLogDao(db), { caps: usdaCaps() }),
        },
    ],
    exports: [FoodsService, EnqueueEmitter],
})
export class FoodsModule implements NestModule {
    /** Mount {@link FoodAuthGuard} on every `/v1/foods/*` route (FR-035). */
    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(FoodAuthGuard).forRoutes(FoodsController);
    }
}
