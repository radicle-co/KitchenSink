/**
 * `FoodsModule` (T-130) — wires the source-agnostic `/api/v1/foods/*` API onto the committed layers: the
 * per-aggregate DAOs (`FoodDao`, `CandidateStore`, `FoodSourcesDao`, `FoodSearchDao`), the source-adapter
 * registry (USDA wired), the per-source rolling-window limiter, the merge/persist service, the
 * {@link EnqueueEmitter} (in-process Postgres-as-queue), and the {@link AdmissionService} (backpressure).
 * The DAOs and the merge/registry/limiter are plain classes constructed over the global Drizzle client /
 * `pg` pool via factory providers (their class is the DI token); the controller, service, emitter, and
 * admission service are NestJS-managed.
 *
 * The {@link FoodAuthGuard} middleware is mounted ahead of {@link FoodsController} via `configure` so EVERY
 * `/api/v1/foods/*` route is authenticated before any handler runs (FR-035). No source (USDA) type leaks into
 * the controller layer (FR-ADP-1).
 *
 * @implements FR-001 FR-IDN-1
 */
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { FoodMetrics } from '../observability/emfMetrics.js';
import { FoodAuthGuard } from '../auth/foodAuth.guard.js';
import { FoodServiceErasureAuthService } from '../auth/foodServiceErasureAuth.service.js';
import { FoodServiceErasureGuard } from '../auth/foodServiceErasure.guard.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';
import { RollingWindowLimiter } from '../sources/RollingWindowLimiter.js';
import { createUsdaSourceRegistry } from '../sources/usda/usdaRegistry.js';
import { AdmissionService } from './admission.service.js';
import { AdminMetricsDao } from './admin/adminMetrics.dao.js';
import { AdminMetricsService } from './admin/adminMetrics.service.js';
import { FoodsAdminController } from './admin/foodsAdmin.controller.js';
import { CandidateStore, FetchQueueDao, FoodDao, FoodSourcesDao, SourceCallLogDao } from './dao/index.js';
import { FoodSearchDao } from './dao/foodSearch.dao.js';
import { EnqueueEmitter } from './enqueue.emitter.js';
import { FoodsController } from './foods.controller.js';
import { FoodsService } from './foods.service.js';
import { ServiceErasureController } from './serviceErasure.controller.js';
import { GoldenRecordMergeEngine } from './merge/mergeEngine.js';
import { MergeAndPersistService } from './merge/mergeAndPersist.service.js';
import { UserErasureService } from './userErasure.service.js';

@Module({
    controllers: [FoodsController, FoodsAdminController, ServiceErasureController],
    providers: [
        FoodsService,
        EnqueueEmitter,
        AdmissionService,
        AdminMetricsService,
        UserErasureService,
        FoodAuthGuard,
        // CR-002 / U4b / R11 — the internal service-principal erasure route's verifier + guard. The guard
        // is applied via @UseGuards on ServiceErasureController (NOT the FoodAuthGuard middleware below),
        // so the machine-auth path is structurally distinct from the Clerk user path.
        FoodServiceErasureAuthService,
        FoodServiceErasureGuard,
        {
            provide: AdminMetricsDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): AdminMetricsDao => new AdminMetricsDao(db),
        },
        { provide: FoodDao, inject: [DrizzleProvider], useFactory: (db: FoodDrizzle): FoodDao => new FoodDao(db) },
        // ⛔ NOT optional, and its absence did not fail a unit test: `AdminMetricsService` takes this in its
        // constructor (U9), so without the provider Nest cannot instantiate the module AT ALL — the API
        // process aborts at boot. It went unnoticed because the unit tests construct that service directly,
        // and because Nest reports a DI failure through `process.abort()`, which vitest surfaces only as
        // "Worker exited unexpectedly" (see `tests/foodsApi.integration.test.ts`'s boot call).
        {
            provide: FetchQueueDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): FetchQueueDao => new FetchQueueDao(db),
        },
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
        // T-199b — the EMF recorder the read path publishes the SC-004/SC-005 local-store serve rate
        // through. A factory rather than a bare class provider because its only constructor parameter is
        // the injectable line sink (defaulting to `console.log`), which Nest's DI cannot resolve.
        { provide: FoodMetrics, useFactory: (): FoodMetrics => new FoodMetrics() },
        // The ONE registry factory, shared with both Fargate entrypoints. It replaces a local `?? ''`
        // fallback that would have built a client with an EMPTY api key, and it is what finally gives
        // `USDA_API_BASE_URL` a consumer.
        { provide: SourceAdapterRegistry, useFactory: createUsdaSourceRegistry },
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
            useFactory: (db: FoodDrizzle): RollingWindowLimiter => new RollingWindowLimiter(new SourceCallLogDao(db)),
        },
    ],
    exports: [FoodsService, EnqueueEmitter, UserErasureService],
})
export class FoodsModule implements NestModule {
    /** Mount {@link FoodAuthGuard} on every `/api/v1/foods/*` route, incl. the admin endpoints (FR-035/FR-039). */
    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(FoodAuthGuard).forRoutes(FoodsController, FoodsAdminController);
    }
}
