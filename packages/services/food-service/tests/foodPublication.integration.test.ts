/**
 * The publication routes over a real HTTP request (§7.1a: the DAO is DOUBLED): the REAL `FoodAuthGuard`, controllers,
 * `FoodPublicationService`, global `ZodValidationPipe` and `ApiExceptionFilter`.
 *
 * What only this tier proves: the author routes are reachable and not swallowed by an `:id` route, a stranger's ask is
 * the 404 a missing id gets, `food:admin` gates the staff routes (`403` before anything else), every refusal is the
 * published envelope, and a body that is neither approve nor decline is a `400`. What the lock and the transaction do is
 * the LOCAL e2e tier's (`tests/e2e/publicationRequests.dao.e2e.test.ts`).
 */
import 'reflect-metadata';

import { Module, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { AUTHOR_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import { FoodAuthGuard } from '../src/auth/foodAuth.guard.js';
import { ApiExceptionFilter } from '../src/common/filters/apiException.filter.js';
import { AdminMetricsService } from '../src/foods/admin/adminMetrics.service.js';
import { FoodRecoveryService } from '../src/foods/admin/foodRecovery.service.js';
import { FoodsAdminController } from '../src/foods/admin/foodsAdmin.controller.js';
import type { AuthoredFoodsDao } from '../src/foods/dao/authoredFoods.dao.js';
import type { PublicationRequestsDao, PublicationRequestRecord } from '../src/foods/dao/publicationRequests.dao.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { FoodPublicationController } from '../src/foods/publication.controller.js';
import { FoodPublicationService } from '../src/foods/publication.service.js';
import { principalFor } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const FOOD_ID = '01JQZK8N7QF3B2X4M6T0V5C0FD';
const REQUEST_ID = '5b2a3a56-6f3c-4a39-9b1c-0d2f6e2d9a11';

const record = (overrides: Partial<PublicationRequestRecord> = {}): PublicationRequestRecord => ({
    id: REQUEST_ID,
    foodId: FOOD_ID,
    versionNumber: 1,
    status: 'pending',
    declineReason: null,
    createdAt: '2026-11-09T10:00:00.000Z',
    decidedAt: null,
    ...overrides,
});

const snapshot = {
    name: 'Grandma blend',
    description: null,
    macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 1 },
    portions: [],
};

describe('publication routes (booted Nest, DAO doubled)', () => {
    const dao = {
        request: vi.fn(),
        latestFor: vi.fn(),
        listPending: vi.fn(),
        decide: vi.fn(),
    };
    const authoredDao = { listOwn: vi.fn(), markSeen: vi.fn(async () => undefined) };
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';

        @Module({
            controllers: [FoodPublicationController, FoodsAdminController],
            providers: [
                {
                    provide: FoodPublicationService,
                    useValue: new FoodPublicationService(
                        dao as unknown as PublicationRequestsDao,
                        authoredDao as unknown as AuthoredFoodsDao,
                    ),
                },
                { provide: FoodRecoveryService, useValue: {} },
                { provide: AdminMetricsService, useValue: {} },
                FoodAuthGuard,
                { provide: APP_FILTER, useClass: ApiExceptionFilter },
                { provide: APP_PIPE, useValue: new ZodValidationPipe() },
            ],
        })
        class PublicationTestModule implements NestModule {
            public configure(consumer: MiddlewareConsumer): void {
                consumer.apply(FoodAuthGuard).forRoutes(FoodPublicationController, FoodsAdminController);
            }
        }

        app = await NestFactory.create(PublicationTestModule, { logger: false, abortOnError: false });
        await app.listen(0);
        baseUrl = await app.getUrl();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    async function call(
        method: string,
        path: string,
        token?: string,
        body?: unknown,
    ): Promise<{ status: number; body: unknown; headers: Headers }> {
        const headers: Record<string, string> = {};

        if (token !== undefined) {
            headers['authorization'] = `Bearer ${token}`;
        }

        if (body !== undefined) {
            headers['content-type'] = 'application/json';
        }

        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();

        return {
            status: response.status,
            body: text.length > 0 ? JSON.parse(text) : undefined,
            headers: response.headers,
        };
    }

    const askPath = `/api/v1/foods/authored/${FOOD_ID}/publication-request`;

    describe('POST …/authored/{id}/publication-request', () => {
        it('opens a request: 201 with the request and the version it names, never cached', async () => {
            dao.request.mockResolvedValue({ kind: 'opened', request: record() });
            dao.latestFor.mockResolvedValue({ request: record(), snapshot });

            const answer = await call('POST', askPath, 'author');

            expect(answer.status).toBe(201);
            expect(answer.headers.get('cache-control')).toBe('private, no-store');
            expect(answer.body).toStrictEqual({ request: record(), snapshot });
            expect(dao.request).toHaveBeenCalledWith(FOOD_ID, AUTHOR_ID);
        });

        it('answers the request already pending with 200', async () => {
            dao.request.mockResolvedValue({ kind: 'existing', request: record() });
            dao.latestFor.mockResolvedValue({ request: record(), snapshot });

            expect((await call('POST', askPath, 'author')).status).toBe(200);
        });

        it('answers a food that is not theirs as FOOD_NOT_FOUND, like a missing id', async () => {
            dao.request.mockResolvedValue({ kind: 'missing' });

            const answer = await call('POST', askPath, 'stranger');

            expect(answer.status).toBe(404);
            expect(foodErrorSchema.parse(answer.body)).toMatchObject({ code: 'FOOD_NOT_FOUND' });
        });

        it.each(['withdrawn', 'notPrivate', 'declined'] as const)(
            'refuses with %s as a 409 naming the reason',
            async (reason) => {
                dao.request.mockResolvedValue({ kind: 'refused', reason });

                const answer = await call('POST', askPath, 'author');

                expect(answer.status).toBe(409);
                expect(foodErrorSchema.parse(answer.body)).toMatchObject({
                    code: 'PUBLICATION_NOT_REQUESTABLE',
                    details: { id: FOOD_ID, reason },
                });
            },
        );

        it('refuses a service principal and an unauthenticated caller', async () => {
            expect((await call('POST', askPath, 'service')).status).toBe(403);
            expect((await call('POST', askPath)).status).toBe(401);
            expect(dao.request).not.toHaveBeenCalled();
        });

        it('rejects a malformed id before the DAO is touched', async () => {
            const answer = await call('POST', '/api/v1/foods/authored/not-an-id/publication-request', 'author');

            expect(answer.status).toBe(400);
            expect(dao.request).not.toHaveBeenCalled();
        });
    });

    describe('GET …/authored (the author’s list)', () => {
        it('returns the page and the unseen count, private and uncached', async () => {
            authoredDao.listOwn.mockResolvedValue({
                items: [
                    { id: FOOD_ID, name: 'Grandma', publicationState: 'asked', updatedAt: '2026-11-09T10:00:00.000Z' },
                ],
                nextCursor: 'abc',
                unseenDecisions: 2,
            });

            const answer = await call('GET', '/api/v1/foods/authored?cursor=prev', 'author');

            expect(answer.status).toBe(200);
            expect(answer.headers.get('cache-control')).toBe('private, no-store');
            expect(answer.body).toMatchObject({ nextCursor: 'abc', unseenDecisions: 2 });
            expect(authoredDao.listOwn).toHaveBeenCalledWith(AUTHOR_ID, { limit: 50, cursor: 'prev' });
        });

        it('asks for the first page without a cursor', async () => {
            authoredDao.listOwn.mockResolvedValue({ items: [], nextCursor: undefined, unseenDecisions: 0 });

            await call('GET', '/api/v1/foods/authored', 'author');

            expect(authoredDao.listOwn).toHaveBeenCalledWith(AUTHOR_ID, { limit: 50 });
        });

        it('refuses a service principal and an unknown query key', async () => {
            expect((await call('GET', '/api/v1/foods/authored', 'service')).status).toBe(403);
            expect((await call('GET', '/api/v1/foods/authored?page=2', 'author')).status).toBe(400);
            expect(authoredDao.listOwn).not.toHaveBeenCalled();
        });
    });

    describe('GET …/authored/{id}/publication-request', () => {
        it('marks a decided request seen when the author reads it', async () => {
            dao.latestFor.mockResolvedValue({
                request: record({ status: 'approved', decidedAt: '2026-11-09T11:00:00.000Z' }),
                snapshot,
            });

            await call('GET', askPath, 'author');

            expect(authoredDao.markSeen).toHaveBeenCalledWith(FOOD_ID, AUTHOR_ID);
        });

        it('marks nothing when there is no request', async () => {
            dao.latestFor.mockResolvedValue(undefined);

            await call('GET', askPath, 'author');

            expect(authoredDao.markSeen).not.toHaveBeenCalled();
        });

        it('returns the latest request with its version', async () => {
            dao.latestFor.mockResolvedValue({
                request: record({ status: 'declined', declineReason: 'No', decidedAt: '2026-11-09T11:00:00.000Z' }),
                snapshot,
            });

            const answer = await call('GET', askPath, 'author');

            expect(answer.status).toBe(200);
            expect(answer.headers.get('cache-control')).toBe('private, no-store');
            expect(answer.body).toMatchObject({ request: { status: 'declined', declineReason: 'No' } });
        });

        it('answers PUBLICATION_REQUEST_NOT_FOUND when the food has none', async () => {
            dao.latestFor.mockResolvedValue(undefined);

            const answer = await call('GET', askPath, 'author');

            expect(answer.status).toBe(404);
            expect(foodErrorSchema.parse(answer.body)).toMatchObject({ code: 'PUBLICATION_REQUEST_NOT_FOUND' });
        });
    });

    describe('staff routes', () => {
        const listPath = '/api/v1/foods/admin/publication-requests?status=pending';
        const decisionPath = `/api/v1/foods/admin/publication-requests/${REQUEST_ID}/decision`;

        it('lists the pending requests for food:admin', async () => {
            dao.listPending.mockResolvedValue([{ request: record(), snapshot, liveName: 'Grandma' }]);

            const answer = await call('GET', listPath, 'operator');

            expect(answer.status).toBe(200);
            expect(answer.body).toStrictEqual({ requests: [{ request: record(), snapshot, liveName: 'Grandma' }] });
        });

        it.each([
            ['GET', listPath, undefined],
            ['POST', decisionPath, { approve: true }],
        ])(
            'answers %s %s with 403 for a caller without food:admin, before anything else',
            async (method, path, body) => {
                expect((await call(method, path, 'author', body)).status).toBe(403);
                expect(dao.listPending).not.toHaveBeenCalled();
                expect(dao.decide).not.toHaveBeenCalled();
            },
        );

        it('approves', async () => {
            dao.decide.mockResolvedValue({
                kind: 'approved',
                request: record({ status: 'approved', decidedAt: '2026-11-09T11:00:00.000Z' }),
            });

            const answer = await call('POST', decisionPath, 'operator', { approve: true });

            expect(answer.status).toBe(200);
            expect(answer.body).toMatchObject({ status: 'approved' });
            expect(dao.decide).toHaveBeenCalledWith(REQUEST_ID, { approve: true });
        });

        it('declines with the reason the author will read', async () => {
            dao.decide.mockResolvedValue({
                kind: 'declined',
                request: record({
                    status: 'declined',
                    declineReason: 'Calories look wrong',
                    decidedAt: '2026-11-09T11:00:00.000Z',
                }),
            });

            const answer = await call('POST', decisionPath, 'operator', {
                approve: false,
                reason: 'Calories look wrong',
            });

            expect(answer.status).toBe(200);
            expect(dao.decide).toHaveBeenCalledWith(REQUEST_ID, { decline: 'Calories look wrong' });
        });

        it.each([
            [{}],
            [{ approve: false }],
            [{ approve: false, reason: '   ' }],
            [{ approve: true, reason: 'why' }],
            [{ approve: 'yes' }],
            [{ approve: true, decline: true }],
        ])('rejects the body %j with a 400 and decides nothing', async (body) => {
            expect((await call('POST', decisionPath, 'operator', body)).status).toBe(400);
            expect(dao.decide).not.toHaveBeenCalled();
        });

        it.each(['closed', 'withdrawn', 'notNewest'] as const)(
            'answers a stale approval (%s) with a 409',
            async (reason) => {
                dao.decide.mockResolvedValue({ kind: 'refused', reason });

                const answer = await call('POST', decisionPath, 'operator', { approve: true });

                expect(answer.status).toBe(409);
                expect(foodErrorSchema.parse(answer.body)).toMatchObject({
                    code: 'PUBLICATION_NOT_APPROVABLE',
                    details: { id: REQUEST_ID, reason },
                });
            },
        );

        it('answers a rename that now collides with DUPLICATE_AUTHORED_NAME, request still pending', async () => {
            dao.decide.mockResolvedValue({ kind: 'duplicate', existingId: 'f-other' });

            const answer = await call('POST', decisionPath, 'operator', { approve: true });

            expect(answer.status).toBe(409);
            expect(foodErrorSchema.parse(answer.body)).toMatchObject({
                code: 'DUPLICATE_AUTHORED_NAME',
                details: { existingId: 'f-other' },
            });
        });

        it('answers an unknown request with PUBLICATION_REQUEST_NOT_FOUND', async () => {
            dao.decide.mockResolvedValue({ kind: 'missing' });

            const answer = await call('POST', decisionPath, 'operator', { approve: true });

            expect(answer.status).toBe(404);
            expect(foodErrorSchema.parse(answer.body)).toMatchObject({ code: 'PUBLICATION_REQUEST_NOT_FOUND' });
        });

        it('rejects a request id that is not a UUID', async () => {
            const answer = await call('POST', '/api/v1/foods/admin/publication-requests/nope/decision', 'operator', {
                approve: true,
            });

            expect(answer.status).toBe(400);
        });
    });
});
