/**
 * `FoodsModule` (T-130) — wires the source-agnostic `/api/v1/foods/*` API onto the committed layers: the
 * per-aggregate DAOs (`FoodDao`, `CandidateStore`, `FoodSourcesDao`, `FoodSearchDao`), the source-adapter
 * registry (USDA wired), the per-source rolling-window limiter, the merge/persist service, the
 * and the {@link EnqueueEmitter} (in-process Postgres-as-queue).
 * The DAOs and the merge/registry/limiter are plain classes constructed over the global Drizzle client /
 * `pg` pool via factory providers (their class is the DI token); the controller, service, emitter, and
 * enqueue emitter are NestJS-managed.
 *
 * The {@link FoodAuthGuard} middleware is mounted ahead of {@link FoodsController} via `configure` so EVERY
 * `/api/v1/foods/*` route is authenticated before any handler runs (FR-035). No source (USDA) type leaks into
 * the controller layer (FR-ADP-1).
 *
 * @implements FR-001 FR-IDN-1
 */
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { MeteredAdmission } from '../common/throttle/meteredAdmission.js';
import { throttlerModuleOptions } from '../common/throttle/throttle.config.js';
import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { FoodMetrics } from '../observability/emfMetrics.js';
import { FoodAuthGuard } from '../auth/foodAuth.guard.js';
import { FoodServiceErasureAuthService } from '../auth/foodServiceErasureAuth.service.js';
import { FoodServiceErasureGuard } from '../auth/foodServiceErasure.guard.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';
import { RollingWindowLimiter } from '../sources/RollingWindowLimiter.js';
import { createSourceRegistry } from '../sources/sourceRegistry.js';
import { AdminMetricsDao } from './admin/adminMetrics.dao.js';
import { AdminMetricsService } from './admin/adminMetrics.service.js';
import { FoodRecoveryService } from './admin/foodRecovery.service.js';
import { FoodsAdminController } from './admin/foodsAdmin.controller.js';
import { FetchQueueDao } from './dao/fetchQueue.dao.js';
import { FoodDao } from './dao/food.dao.js';
import { CandidateStore } from './dao/foodCandidates.dao.js';
import { FoodSourcesDao } from './dao/foodSources.dao.js';
import { SourceBackoffDao } from './dao/sourceBackoff.dao.js';
import { SourceCallLogDao } from './dao/sourceCallLog.dao.js';
import { FoodSearchDao } from './dao/foodSearch.dao.js';
import { FoodVariantDao } from './dao/foodVariant.dao.js';
import { FoodForwardDao } from './dao/foodForward.dao.js';
import { RequesterSourceBudgetDao } from './dao/requesterSourceBudget.dao.js';
import { SearchGapDao } from './dao/searchGap.dao.js';
import { CatalogOwnerReader } from './catalogOwnerReader.service.js';
import { CitedSourcesService } from './citedSources.service.js';
import { CitedSourcesDao } from './dao/citedSources.dao.js';
import { EnqueueEmitter } from './enqueue.emitter.js';
import { FoodsController } from './foods.controller.js';
import { FoodsService } from './foods.service.js';
import { ServiceErasureController } from './serviceErasure.controller.js';
import { GoldenRecordMergeEngine } from './merge/mergeEngine.js';
import { MergeAndPersistService } from './merge/mergeAndPersist.service.js';
import { AuthoredFoodsDao } from './dao/authoredFoods.dao.js';
import { TestPrincipalPurgeService } from './testPrincipalPurge.service.js';
import { UserErasureService } from './userErasure.service.js';
import { RoutedWorkerLogger } from '../worker/RoutedWorkerLogger.js';
import { remoteSearchSettingsFromEnv, settingFromEnv, type RemoteSearchSettings } from '../config/env.schema.js';
import { RemoteSearchEndingMetrics } from '../sources/remote/remoteSearchEndings.js';
import type { RemoteSearchPort } from '../sources/remote/remoteSearchPort.js';
import { SearchServiceRemoteSearch } from '../sources/remote/SearchServiceRemoteSearch.js';
import { UnconfiguredRemoteSearch } from '../sources/remote/UnconfiguredRemoteSearch.js';
import { RemoteAdoptionDao } from './dao/remoteAdoption.dao.js';
import { ProgressiveFoodSearch } from './progressive/ProgressiveFoodSearch.js';
import { AdoptRemoteFood } from './remote/AdoptRemoteFood.js';
import { SearchGapRecorder } from './SearchGapRecorder.js';
import { RemoteReferenceSealer } from './remote/RemoteReferenceSealer.js';
import { REMOTE_REFERENCE_SEALER, REMOTE_SEARCH_PORT, REMOTE_SEARCH_SETTINGS } from './remote/remoteSearch.tokens.js';
import { UnconfiguredReferenceSealer } from './remote/UnconfiguredReferenceSealer.js';

@Module({
    // The per-user cap's storage and options (plan 002 R42). The guard is bound per route, never globally, so only
    // the routes `throttle.decorators.ts` marks are capped.
    imports: [ThrottlerModule.forRoot(throttlerModuleOptions)],
    controllers: [FoodsController, FoodsAdminController, ServiceErasureController],
    providers: [
        FoodsService,
        EnqueueEmitter,
        AdminMetricsService,
        UserErasureService,
        // ADR-0040 — the authored-food test purge behind `POST /api/v1/foods/authored/test-purge`.
        TestPrincipalPurgeService,
        FoodAuthGuard,
        // CR-002 / U4b / R11 — the internal service-principal erasure route's verifier + guard. The guard
        // is applied via @UseGuards on ServiceErasureController (NOT the FoodAuthGuard middleware below),
        // so the machine-auth path is structurally distinct from the Clerk user path.
        FoodServiceErasureAuthService,
        FoodServiceErasureGuard,
        // U9's write side. A FACTORY, not a class provider: its structured audit sink is the `WorkerLogger`
        // INTERFACE, which erases to `Object` in `design:paramtypes`, so Nest's DI cannot resolve it and the
        // module would fail to instantiate at boot (the failure mode the `FetchQueueDao` note below records).
        {
            provide: FoodRecoveryService,
            inject: [FoodDao, EnqueueEmitter],
            useFactory: (foodDao: FoodDao, enqueue: EnqueueEmitter): FoodRecoveryService =>
                new FoodRecoveryService(foodDao, enqueue, new RoutedWorkerLogger('food-admin')),
        },
        {
            provide: AdminMetricsDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): AdminMetricsDao => new AdminMetricsDao(db),
        },
        { provide: FoodDao, inject: [DrizzleProvider], useFactory: (db: FoodDrizzle): FoodDao => new FoodDao(db) },
        // U10 — the authored-foods write path, its own repository (the single-writer disciplines must not
        // share a class; see the DAO's docstring).
        {
            provide: AuthoredFoodsDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): AuthoredFoodsDao => new AuthoredFoodsDao(db),
        },
        // ⛔ NOT optional, and its absence did not fail a unit test: `FoodRecoveryService` takes this in its
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
        {
            provide: FoodVariantDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): FoodVariantDao => new FoodVariantDao(db),
        },
        {
            provide: FoodForwardDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): FoodForwardDao => new FoodForwardDao(db),
        },
        CatalogOwnerReader,
        // The Data sources read (plan R55): its own Repository, which nothing else reads through.
        {
            provide: CitedSourcesService,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): CitedSourcesService => new CitedSourcesService(new CitedSourcesDao(db)),
        },
        // T-199b — the EMF recorder the read path publishes the SC-004/SC-005 local-store serve rate
        // through. A factory rather than a bare class provider because its only constructor parameter is
        // the injectable line sink (defaulting to `console.log`), which Nest's DI cannot resolve.
        { provide: FoodMetrics, useFactory: (): FoodMetrics => new FoodMetrics() },
        // The ONE registry factory, shared with both Fargate entrypoints. Every client it builds goes through the
        // rate-limited transport (ADR-0053 §3), charged to the INTERACTIVE lane: in this process a cook is waiting
        // on every source call (PATCH resolve, the remote pick).
        {
            provide: SourceAdapterRegistry,
            inject: [DrizzleProvider, RollingWindowLimiter, FoodMetrics],
            useFactory: (db: FoodDrizzle, limiter: RollingWindowLimiter, metrics: FoodMetrics): SourceAdapterRegistry =>
                createSourceRegistry({
                    lane: 'interactive',
                    // Counted per request, so the requester source budget refunds the calls a request did not make.
                    admission: new MeteredAdmission(limiter),
                    blocks: new SourceBackoffDao(db),
                    metrics,
                }),
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
            useFactory: (db: FoodDrizzle): RollingWindowLimiter => new RollingWindowLimiter(new SourceCallLogDao(db)),
        },
        // Each requester's hourly share of the source window, charged and refunded on resolve, the remote pick and each
        // remote search the cache could not answer.
        {
            provide: RequesterSourceBudgetDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): RequesterSourceBudgetDao => new RequesterSourceBudgetDao(db),
        },
        // Remote search (ADR-0055): the settings, read once at boot so a partly configured stage fails to start; the
        // search service's Adapter, or the Null Object when the stage has none; and the reference sealer beside it.
        { provide: REMOTE_SEARCH_SETTINGS, useFactory: (): RemoteSearchSettings => remoteSearchSettingsFromEnv() },
        {
            provide: REMOTE_SEARCH_PORT,
            inject: [
                REMOTE_SEARCH_SETTINGS,
                DrizzleProvider,
                RollingWindowLimiter,
                RequesterSourceBudgetDao,
                FoodMetrics,
            ],
            useFactory: (
                settings: RemoteSearchSettings,
                db: FoodDrizzle,
                limiter: RollingWindowLimiter,
                budget: RequesterSourceBudgetDao,
                metrics: FoodMetrics,
            ): RemoteSearchPort =>
                settings.kind === 'configured'
                    ? new SearchServiceRemoteSearch({
                          origin: settings.origin,
                          keyPairId: settings.keyPairId,
                          signingKey: settings.signingKey,
                          window: limiter,
                          budget,
                          blocks: new SourceBackoffDao(db),
                          metrics,
                          endings: new RemoteSearchEndingMetrics(metrics, settingFromEnv('STAGE')),
                      })
                    : new UnconfiguredRemoteSearch(),
        },
        {
            provide: REMOTE_REFERENCE_SEALER,
            inject: [REMOTE_SEARCH_SETTINGS],
            useFactory: (settings: RemoteSearchSettings): Pick<RemoteReferenceSealer, 'open' | 'seal'> =>
                settings.kind === 'configured'
                    ? new RemoteReferenceSealer(settings.referenceKey)
                    : new UnconfiguredReferenceSealer(),
        },
        // The remote pick (ADR-0055 point 10): its fetch goes through the API registry's interactive lane, a placeholder's
        // queue row is leased around it, and the root's record is written by the source pipeline's own merge writer,
        // inside the adoption's transaction.
        {
            provide: AdoptRemoteFood,
            inject: [
                REMOTE_REFERENCE_SEALER,
                CatalogOwnerReader,
                SourceAdapterRegistry,
                DrizzleProvider,
                GoldenRecordMergeEngine,
                FetchQueueDao,
            ],
            useFactory: (
                sealer: Pick<RemoteReferenceSealer, 'open'>,
                owners: CatalogOwnerReader,
                registry: SourceAdapterRegistry,
                db: FoodDrizzle,
                engine: GoldenRecordMergeEngine,
                queue: FetchQueueDao,
            ): AdoptRemoteFood =>
                new AdoptRemoteFood({
                    sealer,
                    owners,
                    registry,
                    adoption: new RemoteAdoptionDao(db),
                    queue,
                    persistRoot: (candidate) => async (writer, foodId) => {
                        await new MergeAndPersistService(writer, engine).resolveFromPicks({
                            foodId,
                            picks: [candidate],
                        });
                    },
                }),
        },
        // The search-gap record (ADR-0055 point 4): written by the progressive search, pruned by change-refresh.
        {
            provide: SearchGapDao,
            inject: [DrizzleProvider],
            useFactory: (db: FoodDrizzle): SearchGapDao => new SearchGapDao(db),
        },
        // The progressive search (ADR-0055 points 4, 5 and 9): S3's two reads, every remote source through the port,
        // the owner reader's "held", the remote pick's named-root read, the reference sealer, and the search-gap record.
        {
            provide: SearchGapRecorder,
            inject: [SearchGapDao, FoodMetrics],
            useFactory: (gaps: SearchGapDao, metrics: FoodMetrics): SearchGapRecorder =>
                new SearchGapRecorder(gaps, metrics),
        },
        {
            provide: ProgressiveFoodSearch,
            inject: [
                FoodsService,
                REMOTE_SEARCH_PORT,
                CatalogOwnerReader,
                DrizzleProvider,
                REMOTE_REFERENCE_SEALER,
                SearchGapRecorder,
            ],
            useFactory: (
                database: FoodsService,
                remote: RemoteSearchPort,
                owners: CatalogOwnerReader,
                db: FoodDrizzle,
                sealer: Pick<RemoteReferenceSealer, 'seal'>,
                gaps: SearchGapRecorder,
            ): ProgressiveFoodSearch =>
                new ProgressiveFoodSearch({
                    database,
                    remote,
                    owners,
                    namedRoots: new RemoteAdoptionDao(db),
                    sealer,
                    gaps,
                }),
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
