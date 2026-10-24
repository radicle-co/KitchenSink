/**
 * Integration test: the erasure route's body is validated by the REAL global `ZodValidationPipe` over a REAL HTTP
 * request. The pipe is the controller boundary; a unit test of the schema alone cannot show the pipe is bound to it.
 *
 * The body carries no authority (the owner is the verified token's claim), so an unknown key — an `ownerId` a
 * caller hopes to smuggle — must be REFUSED with `400`, never silently stripped and accepted.
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { Module, type INestApplication } from '@nestjs/common';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FoodServiceErasureAuthService } from '../src/auth/foodServiceErasureAuth.service.js';
import { FoodServiceErasureGuard } from '../src/auth/foodServiceErasure.guard.js';
import { ServiceErasureController } from '../src/foods/serviceErasure.controller.js';
import { UserErasureService } from '../src/foods/userErasure.service.js';

const eraseUser = vi.fn().mockResolvedValue({
    requesterId: '01JOWNER00000000000000000A',
    deletedRequesterRows: 0,
    deletedAuthoredFoods: 0,
    keptAuthoredFoods: 0,
});

const PRINCIPAL = { ownerId: '01JOWNER00000000000000000A', eventId: 'evt', actor: 'worker' };

@Module({
    controllers: [ServiceErasureController],
    providers: [
        { provide: UserErasureService, useValue: { eraseUser } },
        FoodServiceErasureGuard,
        { provide: FoodServiceErasureAuthService, useValue: { verify: vi.fn().mockResolvedValue(PRINCIPAL) } },
        { provide: APP_PIPE, useValue: new ZodValidationPipe() },
    ],
})
class TestModule {}

describe('POST /api/v1/internal/account/erasure body', () => {
    let app: INestApplication;
    let base: string;

    beforeAll(async () => {
        app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
        await app.listen(0, '127.0.0.1');
        base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/internal/account/erasure`;
    });

    afterAll(async () => {
        await app.close();
    });

    const post = (body?: unknown) =>
        fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

    it('refuses an unknown key (a smuggled ownerId) with 400 and never erases', async () => {
        eraseUser.mockClear();
        const res = await post({ ownerId: '01JATTACKER0000000000000000' });

        expect(res.status).toBe(400);
        expect(eraseUser).not.toHaveBeenCalled();
    });

    it('refuses an unknown key alongside a valid one', async () => {
        const res = await post({ referencedFoodIds: ['f-1'], extra: true });

        expect(res.status).toBe(400);
    });

    it('accepts a body-less POST as the empty request', async () => {
        eraseUser.mockClear();
        const res = await post();

        expect(res.status).toBe(200);
        expect(eraseUser).toHaveBeenCalledWith('01JOWNER00000000000000000A', []);
    });

    it('accepts the referenced-food list', async () => {
        eraseUser.mockClear();
        const res = await post({ referencedFoodIds: ['f-1'] });

        expect(res.status).toBe(200);
        expect(eraseUser).toHaveBeenCalledWith('01JOWNER00000000000000000A', ['f-1']);
    });
});
