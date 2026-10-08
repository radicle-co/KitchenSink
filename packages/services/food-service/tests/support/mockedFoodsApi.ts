/**
 * The MOCKED integration tier's app (`docs/CODING_STANDARDS.md` §7.1a: integration mocks its dependencies).
 *
 * Boots, over a real HTTP listener, exactly the request path a deployed food task runs for a `FoodsController`
 * route — the CORS policy (installed through `corsPolicyFromEnv`, as `main.ts` installs it), `FoodAuthGuard` (mounted
 * as `FoodsModule` mounts it), the global `ZodValidationPipe`, the controller, the REAL `FoodsService`, the pure domain
 * it calls, and `ApiExceptionFilter` — with the persistence doubled. No `DatabaseModule` is imported, so no pool
 * exists and no connection can be opened.
 *
 * What only this tier proves: that a route is reachable at its path and not swallowed by a `:id` route, the
 * status code and headers Nest actually sends, the error ENVELOPE the filter renders from a pipe rejection or a
 * domain error, and that the verified requester reaches the policy. What it cannot prove — anything the database
 * does — is the LOCAL e2e tier's job (`tests/e2e/`).
 *
 * ⚠️ The calling suite must `vi.mock('@kitchensink/clerk-verify', …)` itself (a mock is hoisted per test file), and
 * answer tokens with {@link principalFor}.
 *
 * Any collaborator a route touches that the suite did not double THROWS, naming itself — so a route that starts
 * reaching further than the suite assumed fails loudly instead of passing over `undefined`.
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { Module, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClerkVerificationError } from '@kitchensink/clerk-verify';
import { ZodValidationPipe } from 'nestjs-zod';

import { AUTHOR_ID, STRANGER_ID } from '../../src/foods/__fixtures__/foodRefFacts.js';
import { FoodAuthGuard } from '../../src/auth/foodAuth.guard.js';
import { ApiExceptionFilter } from '../../src/common/filters/apiException.filter.js';
import { throttlerModuleOptions } from '../../src/common/throttle/throttle.config.js';
import { corsPolicyFromEnv } from '../../src/config/cors.js';
import type { Environment } from '../../src/config/env.schema.js';
import { CatalogOwnerReader } from '../../src/foods/catalogOwnerReader.service.js';
import { CitedSourcesService } from '../../src/foods/citedSources.service.js';
import type { CitedSourcesDao } from '../../src/foods/dao/citedSources.dao.js';
import { RequesterSourceBudgetDao } from '../../src/foods/dao/requesterSourceBudget.dao.js';
import type { FoodDao } from '../../src/foods/dao/food.dao.js';
import type { CandidateStore } from '../../src/foods/dao/foodCandidates.dao.js';
import type { FoodForwardDao } from '../../src/foods/dao/foodForward.dao.js';
import type { FoodSearchDao } from '../../src/foods/dao/foodSearch.dao.js';
import type { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import type { FoodVariantDao } from '../../src/foods/dao/foodVariant.dao.js';
import type { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import type { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { FoodsController } from '../../src/foods/foods.controller.js';
import { FoodsService } from '../../src/foods/foods.service.js';
import { ProgressiveFoodSearch } from '../../src/foods/progressive/ProgressiveFoodSearch.js';
import { AdoptRemoteFood } from '../../src/foods/remote/AdoptRemoteFood.js';
import { TestPrincipalPurgeService } from '../../src/foods/testPrincipalPurge.service.js';
import { FoodMetrics } from '../../src/observability/emfMetrics.js';
import { admittingSourceBudget } from './sourceBudgetFake.js';

/** The app ULID of the `operator` token: the requester key an admin route records. */
export const OPERATOR_ID = '01JQZK8N7QF3B2X4M6T0V5C0PS';

/** A verified principal, in the shape `verifyClerkToken` resolves. */
export interface MockPrincipal {
    readonly sub: string;
    readonly userId?: string;
    readonly scopes: string[];
    readonly permissions: string[];
    readonly testPrincipal: boolean;
}

/**
 * Token → principal for the deterministic auth matrix. An unknown token throws, which the guard answers `401`.
 *
 * - `author` / `stranger` — synced users, keyed on their app ULIDs.
 * - `service` — a `svc_*` principal: its sub IS its requester key, and it authored nothing.
 * - `unsynced` — a verified user token whose `external_id` has not synced (no `userId`).
 * - `operator` — a synced user holding the `food:admin` scope, keyed on {@link OPERATOR_ID}.
 *
 * @param token - The bearer the request carried.
 * @returns The principal.
 * @throws {ClerkVerificationError} for any other token.
 */
export function principalFor(token: string): MockPrincipal {
    switch (token) {
        case 'author':
            return { sub: 'user_author', userId: AUTHOR_ID, scopes: [], permissions: [], testPrincipal: false };
        case 'stranger':
            return { sub: 'user_stranger', userId: STRANGER_ID, scopes: [], permissions: [], testPrincipal: false };
        case 'service':
            return { sub: 'svc_recipe', scopes: [], permissions: [], testPrincipal: false };
        case 'unsynced':
            return { sub: 'user_unsynced', scopes: [], permissions: [], testPrincipal: false };
        case 'operator':
            return {
                sub: 'user_operator',
                userId: OPERATOR_ID,
                scopes: ['food:admin'],
                permissions: [],
                testPrincipal: false,
            };
        default:
            throw new ClerkVerificationError();
    }
}

/** The collaborators a suite doubles. Each member is PARTIAL: only the methods the suite's routes reach. */
export interface MockedFoodsApiDoubles {
    readonly foodDao: Partial<Record<keyof FoodDao, unknown>>;
    readonly candidates?: Partial<Record<keyof CandidateStore, unknown>>;
    /** A root's variants, read by `GET /{id}` and `/status` for a catalog root (curated U8). */
    readonly variants?: Partial<Record<keyof FoodVariantDao, unknown>>;
    /** The ranked local search behind `GET /api/v1/foods/search`. */
    readonly searchDao?: Partial<Record<keyof FoodSearchDao, unknown>>;
    /** The crosswalk lookups search issues after ranking. */
    readonly sources?: Partial<Record<keyof FoodSourcesDao, unknown>>;
    /** The owner reader itself; when absent, the real reader runs over the other doubles (curated U8 S4, S5). */
    readonly owners?: Partial<Record<keyof CatalogOwnerReader, unknown>>;
    /** The forward chains the real owner reader follows for a retired ref. */
    readonly forwards?: Partial<Record<keyof FoodForwardDao, unknown>>;
    /** The cited-dataset read behind `GET /api/v1/foods/sources`; the real service and policy run over it. */
    readonly citedSources?: Pick<CitedSourcesDao, 'listCitedDatasets'>;
    /**
     * The per-requester source budget the capped routes charge and refund. Unless a suite doubles it, every charge is
     * admitted ({@link admittingSourceBudget}), so a suite about another limit observes that limit alone.
     */
    readonly sourceBudget?: Pick<RequesterSourceBudgetDao, 'charge' | 'refund'>;
    /** The queue writes behind add, batch and refetch. */
    readonly enqueue?: Partial<Record<keyof EnqueueEmitter, unknown>>;
    /** The merge seam behind PATCH resolve: a pick forwarded to a catalog holder writes through it (FOOD-SERVICE-6). */
    readonly merge?: Partial<Record<keyof MergeAndPersistService, unknown>>;
    /** The remote pick command behind `POST /api/v1/foods/remote/adopt` (ADR-0055 point 10). */
    readonly remoteAdopt?: Pick<AdoptRemoteFood, 'execute'>;
    /** The progressive search behind `GET /api/v1/foods/search/progressive` (ADR-0055 point 5). */
    readonly progressive?: Pick<ProgressiveFoodSearch, 'run'>;
}

/** One HTTP answer, with the raw text kept for byte comparisons. */
export interface MockedResponse {
    readonly status: number;
    readonly text: string;
    readonly body: unknown;
    readonly headers: Headers;
}

/** The booted app plus a request helper. */
export interface MockedFoodsApi {
    /** The listener's origin, for a suite that reads a body itself (the progressive search's frames). */
    readonly baseUrl: string;
    /** Issue a request; omit `token` for an unauthenticated call. */
    readonly call: (
        method: string,
        path: string,
        options?: { token?: string; body?: unknown; headers?: Readonly<Record<string, string>> },
    ) => Promise<MockedResponse>;
    /** Close the listener and the app. */
    readonly close: () => Promise<void>;
}

/**
 * A collaborator the suite did not stand up: ANY property read throws, naming the collaborator and member.
 *
 * @param name - The collaborator's name, for the failure message.
 * @returns The trap.
 */
function unstaged(name: string): never {
    return new Proxy(
        {},
        {
            get: (_target, member) => {
                throw new Error(`${name}.${String(member)} was reached by a route this harness does not stand up`);
            },
        },
    ) as never;
}

/**
 * Boot the mocked tier's app on an ephemeral port.
 *
 * @param doubles - The persistence doubles the suite's routes read.
 * @returns The request helper and teardown.
 * @sideEffect Sets the Clerk env vars `FoodAuthGuard` reads at construction, and starts an HTTP listener.
 */
export async function bootMockedFoodsApi(doubles: MockedFoodsApiDoubles): Promise<MockedFoodsApi> {
    // Read by `FoodAuthGuard`'s constructor. Never dialled: `verifyClerkToken` is mocked by the suite.
    process.env['CLERK_JWT_KEY'] = 'PEM';
    process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';

    const service = new FoodsService(
        doubles.foodDao as unknown as FoodDao,
        (doubles.candidates ?? unstaged('CandidateStore')) as unknown as CandidateStore,
        (doubles.sources ?? unstaged('FoodSourcesDao')) as unknown as FoodSourcesDao,
        (doubles.searchDao ?? unstaged('FoodSearchDao')) as unknown as FoodSearchDao,
        (doubles.merge ?? unstaged('MergeAndPersistService')) as unknown as MergeAndPersistService,
        (doubles.enqueue ?? unstaged('EnqueueEmitter')) as unknown as EnqueueEmitter,
        unstaged('SourceAdapterRegistry'),
        new FoodMetrics(() => undefined),
        unstaged('AuthoredFoodsDao'),
        (doubles.variants ?? unstaged('FoodVariantDao')) as unknown as FoodVariantDao,
        // Unless a suite doubles the reader itself, the REAL owner reader runs over the doubled DAOs, so the mocked tier
        // exercises the Facade's composition and not a stand-in for it.
        (doubles.owners ??
            new CatalogOwnerReader(
                (doubles.sources ?? unstaged('FoodSourcesDao')) as unknown as FoodSourcesDao,
                (doubles.forwards ?? unstaged('FoodForwardDao')) as unknown as FoodForwardDao,
                (doubles.variants ?? unstaged('FoodVariantDao')) as unknown as FoodVariantDao,
                doubles.foodDao as unknown as FoodDao,
                new FoodMetrics(() => undefined),
            )) as unknown as CatalogOwnerReader,
    );

    @Module({
        // As `FoodsModule` registers it: the per-user cap's storage and options, read by the route-scoped guard.
        imports: [ThrottlerModule.forRoot(throttlerModuleOptions)],
        controllers: [FoodsController],
        providers: [
            { provide: FoodsService, useValue: service },
            // Plain objects, not traps: Nest probes every provider for lifecycle hooks at boot.
            { provide: TestPrincipalPurgeService, useValue: {} },
            { provide: AdoptRemoteFood, useValue: doubles.remoteAdopt ?? {} },
            { provide: ProgressiveFoodSearch, useValue: doubles.progressive ?? {} },
            { provide: RequesterSourceBudgetDao, useValue: doubles.sourceBudget ?? admittingSourceBudget() },
            {
                provide: CitedSourcesService,
                useValue: new CitedSourcesService(doubles.citedSources ?? unstaged('CitedSourcesDao')),
            },
            {
                provide: ConfigService,
                useValue: new ConfigService<Environment, true>({ FOOD_MAX_BATCH_NAMES: 100 } as Environment),
            },
            FoodAuthGuard,
            // Registered exactly as `AppModule` registers them.
            { provide: APP_FILTER, useClass: ApiExceptionFilter },
            { provide: APP_PIPE, useValue: new ZodValidationPipe() },
        ],
    })
    class MockedFoodsApiModule implements NestModule {
        public configure(consumer: MiddlewareConsumer): void {
            consumer.apply(FoodAuthGuard).forRoutes(FoodsController);
        }
    }

    // `abortOnError: false`: a module that cannot boot must fail the suite, not `process.abort()` the worker.
    const app: INestApplication = await NestFactory.create(MockedFoodsApiModule, {
        logger: false,
        abortOnError: false,
    });
    // Before `listen`, through the same reader, exactly as `main.ts` does it.
    app.enableCors(corsPolicyFromEnv().options);
    await app.listen(0);
    const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    return {
        baseUrl,
        call: async (method, path, options = {}): Promise<MockedResponse> => {
            const headers: Record<string, string> = { ...options.headers };

            if (options.token !== undefined) {
                headers['authorization'] = `Bearer ${options.token}`;
            }

            if (options.body !== undefined) {
                headers['content-type'] = 'application/json';
            }

            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
            });
            const text = await response.text();

            return {
                status: response.status,
                text,
                body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined,
                headers: response.headers,
            };
        },
        close: async (): Promise<void> => {
            await app.close();
        },
    };
}
