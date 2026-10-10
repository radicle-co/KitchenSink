/**
 * `POST /api/v1/foods/admin/foods/{id}/requeue` over a real HTTP request, with the food DAO and the queue DOUBLED
 * (§7.1a): the REAL `FoodAuthGuard`, `FoodsAdminController`, `FoodRecoveryService` and `ApiExceptionFilter`.
 *
 * A food mid-erasure rests at `DELETING`, which is store-internal: `NOT_REQUEUEABLE`'s `details.status` is the
 * published lifecycle, which does not hold it. So the requeue answers the plain `404` the refetch route answers for
 * the same food, in the published `FOOD_NOT_FOUND` shape. The `RESOLVED` food beside it is the control: the route still
 * publishes its observed status there.
 */
import 'reflect-metadata';

import { Module, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { FoodAuthGuard } from '../src/auth/foodAuth.guard.js';
import { ApiExceptionFilter } from '../src/common/filters/apiException.filter.js';
import { AdminMetricsService } from '../src/foods/admin/adminMetrics.service.js';
import { FoodRecoveryService, type RequeueFoodStore } from '../src/foods/admin/foodRecovery.service.js';
import { FoodsAdminController } from '../src/foods/admin/foodsAdmin.controller.js';
import { IllegalStatusTransitionError } from '../src/foods/dao/dao.errors.js';
import type { FoodStatus } from '../src/foods/dao/food.dao.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { principalFor } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const DELETING_ID = '01JQZK8N7QF3B2X4M6T0V5C0DE';
const RESOLVED_ID = '01JQZK8N7QF3B2X4M6T0V5C0RE';

describe('POST …/admin/foods/{id}/requeue — a DELETING food is a plain 404 (booted Nest, DAO doubled)', () => {
    const statuses = new Map<string, FoodStatus>([
        [DELETING_ID, 'DELETING'],
        [RESOLVED_ID, 'RESOLVED'],
    ]);
    // Neither status may move to PENDING, so both rejections reach the classification the route publishes.
    const foodStore: RequeueFoodStore = {
        setStatus: async ({ id }) => {
            throw new IllegalStatusTransitionError(id, 'PENDING');
        },
        getById: async (id) => {
            const status = statuses.get(id);

            return status === undefined ? undefined : { status };
        },
        isSeedOwned: async () => false,
    };
    const publishFoodRequested = vi.fn(async () => undefined);
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
        // Read by `FoodAuthGuard`'s constructor. Never dialled: `verifyClerkToken` is mocked above.
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';

        const recovery = new FoodRecoveryService(foodStore, { publishFoodRequested }, new SilentWorkerLogger());

        @Module({
            controllers: [FoodsAdminController],
            providers: [
                { provide: FoodRecoveryService, useValue: recovery },
                // Plain object: the requeue route never reads the metrics service.
                { provide: AdminMetricsService, useValue: {} },
                FoodAuthGuard,
                // Registered exactly as `AppModule` registers it.
                { provide: APP_FILTER, useClass: ApiExceptionFilter },
            ],
        })
        class RequeueTestModule implements NestModule {
            public configure(consumer: MiddlewareConsumer): void {
                consumer.apply(FoodAuthGuard).forRoutes(FoodsAdminController);
            }
        }

        app = await NestFactory.create(RequeueTestModule, { logger: false, abortOnError: false });
        await app.listen(0);
        baseUrl = await app.getUrl();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        publishFoodRequested.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    /** Requeue a food as the operator. */
    async function requeue(id: string): Promise<{ status: number; body: unknown }> {
        const response = await fetch(`${baseUrl}/api/v1/foods/admin/foods/${id}/requeue`, {
            method: 'POST',
            headers: { authorization: 'Bearer operator' },
        });

        return { status: response.status, body: await response.json() };
    }

    it('⛔ answers a DELETING food with the FOOD_NOT_FOUND 404, naming no status, and queues nothing', async () => {
        const { status, body } = await requeue(DELETING_ID);

        expect(status).toBe(404);
        expect(foodErrorSchema.parse(body)).toStrictEqual({
            code: 'FOOD_NOT_FOUND',
            message: expect.any(String),
            details: { id: DELETING_ID },
        });
        expect(publishFoodRequested).not.toHaveBeenCalled();
    });

    it('still answers a RESOLVED food with 409 NOT_REQUEUEABLE and its observed status', async () => {
        const { status, body } = await requeue(RESOLVED_ID);

        expect(status).toBe(409);
        expect(foodErrorSchema.parse(body)).toMatchObject({
            code: 'NOT_REQUEUEABLE',
            details: { id: RESOLVED_ID, status: 'RESOLVED' },
        });
    });
});
