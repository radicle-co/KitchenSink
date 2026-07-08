/**
 * T041-test — unit tests for {@link CollectionsController}: the pure request→service→response mapping
 * over a mocked {@link CollectionsService}. Pins that the OWNER always comes from `req.principal.userId`
 * (never the body), that malformed input is rejected with 400, that a missing principal is a 401, and
 * that pagination defaults are applied. End-to-end behaviour is covered by the integration/e2e tiers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedRequest, Principal } from '../../auth/principal.js';
import { CollectionsController } from '../collections.controller.js';
import type { CollectionsService } from '../collections.service.js';

type ServiceMock = { [K in keyof CollectionsService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
    return {
        createCollection: vi.fn(),
        listCollections: vi.fn(),
        getCollection: vi.fn(),
        updateCollection: vi.fn(),
        setVisibility: vi.fn(),
        deleteCollection: vi.fn(),
        addRecipe: vi.fn(),
        removeRecipe: vi.fn(),
    };
}

const PRINCIPAL: Principal = { userId: 'owner-1', sub: 'clerk_sub', scopes: [], permissions: [] };

function reqWith(principal?: Principal): AuthenticatedRequest {
    return { principal } as unknown as AuthenticatedRequest;
}

describe('CollectionsController', () => {
    let service: ServiceMock;
    let controller: CollectionsController;

    beforeEach(() => {
        service = makeService();
        controller = new CollectionsController(service as unknown as CollectionsService);
    });

    describe('create', () => {
        it('delegates with the principal userId and the validated body', async () => {
            service.createCollection.mockResolvedValue({ id: 'c1' });

            const result = await controller.create(reqWith(PRINCIPAL), { name: 'Weeknight Dinners' });

            expect(service.createCollection).toHaveBeenCalledWith('owner-1', { name: 'Weeknight Dinners' });
            expect(result).toEqual({ id: 'c1' });
        });

        it('rejects a body with an empty name (400)', async () => {
            await expect(controller.create(reqWith(PRINCIPAL), { name: '' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(service.createCollection).not.toHaveBeenCalled();
        });

        it('rejects a missing principal (401)', async () => {
            await expect(controller.create(reqWith(undefined), { name: 'X' })).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
        });
    });

    describe('list', () => {
        it('applies default pagination when the query is empty', async () => {
            service.listCollections.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });

            await controller.list(reqWith(PRINCIPAL), {});

            expect(service.listCollections).toHaveBeenCalledWith('owner-1', { page: 1, pageSize: 20 });
        });

        it('coerces provided page/pageSize query strings', async () => {
            service.listCollections.mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 5, hasMore: false });

            await controller.list(reqWith(PRINCIPAL), { page: '2', pageSize: '5' });

            expect(service.listCollections).toHaveBeenCalledWith('owner-1', { page: 2, pageSize: 5 });
        });

        it('rejects a pageSize over the cap (400)', async () => {
            await expect(controller.list(reqWith(PRINCIPAL), { pageSize: '500' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('getById', () => {
        it('delegates with the principal userId and path id', async () => {
            service.getCollection.mockResolvedValue({ id: 'c1', recipes: [] });

            const result = await controller.getById(reqWith(PRINCIPAL), 'c1');

            expect(service.getCollection).toHaveBeenCalledWith('owner-1', 'c1');
            expect(result).toEqual({ id: 'c1', recipes: [] });
        });
    });

    describe('update', () => {
        it('delegates the validated patch', async () => {
            service.updateCollection.mockResolvedValue({ id: 'c1', visibility: 'public' });

            await controller.update(reqWith(PRINCIPAL), 'c1', { visibility: 'public' });

            expect(service.updateCollection).toHaveBeenCalledWith('owner-1', 'c1', { visibility: 'public' });
        });

        it('rejects an empty patch (minProperties: 1 → 400)', async () => {
            await expect(controller.update(reqWith(PRINCIPAL), 'c1', {})).rejects.toBeInstanceOf(BadRequestException);
            expect(service.updateCollection).not.toHaveBeenCalled();
        });

        it('rejects an invalid visibility value (400)', async () => {
            await expect(
                controller.update(reqWith(PRINCIPAL), 'c1', { visibility: 'unlisted' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('remove', () => {
        it('delegates the delete and resolves void', async () => {
            service.deleteCollection.mockResolvedValue(undefined);

            await expect(controller.remove(reqWith(PRINCIPAL), 'c1')).resolves.toBeUndefined();
            expect(service.deleteCollection).toHaveBeenCalledWith('owner-1', 'c1');
        });
    });

    describe('addRecipe', () => {
        it('delegates with the validated recipeId', async () => {
            service.addRecipe.mockResolvedValue({ collectionId: 'c1', recipeId: 'r1' });

            await controller.addRecipe(reqWith(PRINCIPAL), 'c1', {
                recipeId: '00000000-0000-4000-8000-000000000001',
            });

            expect(service.addRecipe).toHaveBeenCalledWith('owner-1', 'c1', '00000000-0000-4000-8000-000000000001');
        });

        it('rejects a non-uuid recipeId (400)', async () => {
            await expect(
                controller.addRecipe(reqWith(PRINCIPAL), 'c1', { recipeId: 'not-a-uuid' }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(service.addRecipe).not.toHaveBeenCalled();
        });
    });

    describe('removeRecipe', () => {
        it('delegates the membership removal and resolves void', async () => {
            service.removeRecipe.mockResolvedValue(undefined);

            await expect(controller.removeRecipe(reqWith(PRINCIPAL), 'c1', 'r1')).resolves.toBeUndefined();
            expect(service.removeRecipe).toHaveBeenCalledWith('owner-1', 'c1', 'r1');
        });
    });
});
