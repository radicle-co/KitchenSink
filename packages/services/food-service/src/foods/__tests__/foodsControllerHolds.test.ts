/**
 * ADR-0040, food half: a root a test principal's pick created is deletable by its purge unless a real cook has been
 * told its id, and food-service cannot see what a recipe binds. So EVERY route that discloses a root id holds it, with
 * the verified principal as the audience, and does so BEFORE the answer leaves (or, for a by-id read, before the read).
 *
 * Written RED-first. The decision of WHO holds is `domain/__tests__/testPickedRootPolicy.test.ts`; the SQL is
 * `tests/e2e/testPickedRoots.e2e.test.ts`. This file pins WHICH routes call the door, with WHAT audience and ids, and
 * in WHICH order.
 */
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../auth/authenticatedPrincipal.js';
import type { Environment } from '../../config/env.schema.js';
import type { SearchTermQueryDto } from '../dto/foods.dto.js';
import type { AnsweredRoots } from '../answeredRoots.js';
import { FoodsController } from '../foods.controller.js';
import { FoodPendingError } from '../foods.errors.js';
import type { FoodsService } from '../foods.service.js';

const VALID_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

function makeCtx(): {
    readonly controller: FoodsController;
    readonly service: Record<string, ReturnType<typeof vi.fn>>;
    readonly hold: ReturnType<typeof vi.fn>;
} {
    const service = {
        getFood: vi.fn(),
        getStatus: vi.fn(),
        getCandidates: vi.fn(),
        search: vi.fn(),
        searchCatalog: vi.fn(),
        addByName: vi.fn(),
        batchAdd: vi.fn(),
        resolveRefs: vi.fn(),
    };
    const hold = vi.fn(async () => undefined);
    const controller = new FoodsController(
        service as unknown as FoodsService,
        new ConfigService<Environment, true>({ FOOD_MAX_BATCH_NAMES: 100 } as Environment),
        { purge: vi.fn() } as never,
        { list: vi.fn() },
        { execute: vi.fn() },
        { run: vi.fn() },
        { hold } as unknown as AnsweredRoots,
    );

    return { controller, service, hold };
}

function reqOf(testPrincipal: boolean | undefined): AuthenticatedRequest {
    return {
        user: { sub: 'user_1', userId: USER_ULID, scopes: [], permissions: [], testPrincipal },
    } as unknown as AuthenticatedRequest;
}

function makeRes(): Response {
    return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

/** Whether `first` was called before `second`. */
function calledBefore(first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>): boolean {
    return (first.mock.invocationCallOrder[0] ?? Infinity) < (second.mock.invocationCallOrder[0] ?? -Infinity);
}

describe('FoodsController — every answer that names a root holds it (ADR-0040)', () => {
    let ctx: ReturnType<typeof makeCtx>;

    beforeEach(() => {
        ctx = makeCtx();
    });

    it('GET /search holds the hits it answers, under the caller, before answering', async () => {
        ctx.service['search']?.mockResolvedValue({ results: [{ id: 'R1', name: 'kale', score: 1 }] });

        await ctx.controller.search({ query: 'kale' }, reqOf(false));

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ testPrincipal: false }), ['R1']);
    });

    it('hands the hold the test principal claim, so the policy can spare a pool slot', async () => {
        ctx.service['search']?.mockResolvedValue({ results: [{ id: 'R1', name: 'kale', score: 1 }] });

        await ctx.controller.search({ query: 'kale' }, reqOf(true));

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ testPrincipal: true }), ['R1']);
    });

    it('⛔ GET /catalog/search holds under NO principal: the edge serves its answer to every caller', async () => {
        ctx.service['searchCatalog']?.mockResolvedValue({ results: [{ id: 'R1', name: 'kale', score: 1 }] });

        await ctx.controller.searchCatalog({ query: 'kale' } as SearchTermQueryDto);

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(undefined, ['R1']);
    });

    it('POST / holds the root it answers and the entry that root forwards to', async () => {
        ctx.service['addByName']?.mockResolvedValue({
            id: 'R1',
            status: 'RESOLVED',
            forwardedTo: { kind: 'root', id: 'R2' },
        });

        await ctx.controller.addByName({ name: 'Broccoli' }, reqOf(false), makeRes());

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(expect.anything(), ['R1', 'R2']);
    });

    it('POST /batch holds every item it answers', async () => {
        ctx.service['batchAdd']?.mockResolvedValue({
            items: [
                { id: 'R1', status: 'RESOLVED', name: 'kale' },
                { id: 'R2', status: 'PENDING' },
            ],
        });

        await ctx.controller.batch({ names: ['kale', 'chard'] }, reqOf(false));

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(expect.anything(), ['R1', 'R2']);
    });

    it('POST /refs/resolve holds the refs it was asked about BEFORE reading, and what the read adds after', async () => {
        const resolve = ctx.service['resolveRefs'];
        resolve?.mockResolvedValue({
            entries: [
                {
                    outcome: 'found',
                    ref: { kind: 'root', id: 'R1' },
                    name: 'kale',
                    status: 'RESOLVED',
                    forwardedTo: { kind: 'root', id: 'R9' },
                },
            ],
        });

        await ctx.controller.resolveRefs({ refs: [{ kind: 'root', id: 'R1' }] }, reqOf(false));

        expect(ctx.hold).toHaveBeenNthCalledWith(1, expect.anything(), ['R1']);
        expect(ctx.hold).toHaveBeenNthCalledWith(2, expect.anything(), ['R1', 'R9']);
        expect(ctx.hold.mock.invocationCallOrder[0]).toBeLessThan(resolve?.mock.invocationCallOrder[0] ?? 0);
        expect(ctx.hold.mock.invocationCallOrder[1]).toBeGreaterThan(resolve?.mock.invocationCallOrder[0] ?? Infinity);
    });

    it.each(['getStatus', 'getCandidates'] as const)('GET /{id}/%s holds the id BEFORE it reads', async (method) => {
        const read = ctx.service[method];
        read?.mockResolvedValue({ id: VALID_ID });

        await ctx.controller[method](VALID_ID, reqOf(false));

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(expect.anything(), [VALID_ID]);
        expect(read !== undefined && calledBefore(ctx.hold, read)).toBe(true);
    });

    it('⛔ GET /{id} also holds the forward target its answer names, which may be a ROOT', async () => {
        ctx.service['getFood']?.mockResolvedValue({ id: VALID_ID, forwardedTo: { kind: 'root', id: 'R9' } });

        await ctx.controller.getFood(VALID_ID, reqOf(false), makeRes());

        expect(ctx.hold).toHaveBeenCalledTimes(2);
        expect(ctx.hold).toHaveBeenNthCalledWith(1, expect.anything(), [VALID_ID]);
        expect(ctx.hold).toHaveBeenNthCalledWith(2, expect.anything(), [VALID_ID, 'R9']);
    });

    it('⛔ GET /{id}/status also holds the forward target its RESOLVED record names', async () => {
        ctx.service['getStatus']?.mockResolvedValue({
            id: VALID_ID,
            status: 'RESOLVED',
            food: { id: VALID_ID, forwardedTo: { kind: 'root', id: 'R9' } },
        });

        await ctx.controller.getStatus(VALID_ID, reqOf(false));

        expect(ctx.hold).toHaveBeenNthCalledWith(1, expect.anything(), [VALID_ID]);
        expect(ctx.hold).toHaveBeenNthCalledWith(2, expect.anything(), [VALID_ID, 'R9']);
    });

    it('GET /{id} holds the id BEFORE it reads, and also when the food is still pending', async () => {
        const read = ctx.service['getFood'];
        read?.mockRejectedValue(new FoodPendingError(VALID_ID, 'PENDING', 30));

        await ctx.controller.getFood(VALID_ID, reqOf(false), makeRes());

        expect(ctx.hold).toHaveBeenCalledExactlyOnceWith(expect.anything(), [VALID_ID]);
        expect(read !== undefined && calledBefore(ctx.hold, read)).toBe(true);
    });

    it('⛔ fails the answer when the hold cannot be written, so no id leaves unprotected', async () => {
        ctx.service['search']?.mockResolvedValue({ results: [{ id: 'R1', name: 'kale', score: 1 }] });
        ctx.hold.mockRejectedValue(new Error('database down'));

        await expect(ctx.controller.search({ query: 'kale' }, reqOf(false))).rejects.toThrow('database down');
    });
});
