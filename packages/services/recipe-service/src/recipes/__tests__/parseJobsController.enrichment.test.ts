/**
 * ⛔ EVERY view-returning parse-job route ENRICHES its view (ADR-0071 review, item 16).
 *
 * `ParseJobMatchView` is a Content Enricher: it adds each proposed food's `match` to a job view the service built. The
 * contract that makes it safe is that NO route answers with an un-enriched view, because a client that read `match` off
 * one route and not another would show a cook a line as unmatched after it was matched. A hand list of routes cannot
 * catch the route someone adds later, so the routes are DISCOVERED from the controller's own Nest route metadata, and
 * each one is driven: its answer must be the enricher's output for the view the service returned, for the caller.
 */
import 'reflect-metadata';

import { PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../../auth/principal.js';
import type { MatchProposalService } from '../matchProposal.service.js';
import type { ParseJobMatchView } from '../parseJobMatchView.js';
import { ParseJobsController } from '../parseJobs.controller.js';
import type { ParseJobsService } from '../parseJobs.service.js';

const PRINCIPAL: Principal = {
    userId: '01JENRICHMENTOWNER0000000A',
    sub: 'clerk_01JENRICHMENTOWNER0000000A',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};

/** One argument that serves every route parameter after the principal and the caller: an id, an index, or a body. */
const ANY_ARGUMENT = { text: '1 cup milk', sourceLine: '1 cup milk', lineIndexes: [0] };

/** The controller's route handlers, read from Nest's route metadata. */
function routeHandlers(): readonly string[] {
    const prototype = ParseJobsController.prototype as unknown as Record<string, unknown>;

    return Object.getOwnPropertyNames(prototype).filter(
        (name) =>
            name !== 'constructor' &&
            typeof prototype[name] === 'function' &&
            Reflect.getMetadata(PATH_METADATA, prototype[name] as object) !== undefined,
    );
}

describe('ParseJobsController — every route answers with an ENRICHED view', () => {
    it('discovers the routes from the metadata (the guard is not a hand list)', () => {
        expect(routeHandlers()).toEqual(
            expect.arrayContaining(['create', 'getById', 'retry', 'editLine', 'withdrawLines', 'proposeMatches']),
        );
    });

    it.each(routeHandlers())(
        '⛔ %s answers with the enricher’s output for the service’s view, for the caller',
        async (handler) => {
            const view = { id: `view-of-${handler}` };
            const enriched = { id: `enriched-${handler}` };
            const service = new Proxy(
                {},
                { get: () => vi.fn().mockResolvedValue(view) },
            ) as unknown as ParseJobsService;
            const proposals = { propose: vi.fn().mockResolvedValue(undefined) } as unknown as MatchProposalService;
            const decorate = vi.fn().mockResolvedValue(enriched);
            const controller = new ParseJobsController(service, proposals, {
                decorate,
            } as unknown as ParseJobMatchView);
            const route = (controller as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[handler];

            const answered = await route?.call(
                controller,
                PRINCIPAL,
                undefined,
                ANY_ARGUMENT,
                ANY_ARGUMENT,
                ANY_ARGUMENT,
            );

            expect(answered).toBe(enriched);
            expect(decorate.mock.calls[0]?.slice(0, 3)).toStrictEqual([
                { userId: PRINCIPAL.userId, principalKind: 'real', containment: 'enforce' },
                undefined,
                view,
            ]);
        },
    );

    it('⛔ the matches route hands the enricher the request’s deadline, so the view’s reads end with it', async () => {
        const service = new Proxy(
            {},
            { get: () => vi.fn().mockResolvedValue({ id: 'view' }) },
        ) as unknown as ParseJobsService;
        const proposals = { propose: vi.fn().mockResolvedValue(undefined) } as unknown as MatchProposalService;
        const decorate = vi.fn().mockResolvedValue({ id: 'enriched' });
        const controller = new ParseJobsController(service, proposals, { decorate } as unknown as ParseJobMatchView);

        await controller.proposeMatches(PRINCIPAL, undefined, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');

        const deadline = decorate.mock.calls[0]?.[3];

        expect(deadline).toBeInstanceOf(AbortSignal);
        expect((deadline as AbortSignal).aborted).toBe(false);
    });

    it('every route but the matches route enriches WITHOUT a deadline (a plain poll has no budget to keep)', async () => {
        const service = new Proxy(
            {},
            { get: () => vi.fn().mockResolvedValue({ id: 'view' }) },
        ) as unknown as ParseJobsService;
        const decorate = vi.fn().mockResolvedValue({ id: 'enriched' });
        const controller = new ParseJobsController(
            service,
            { propose: vi.fn() } as unknown as MatchProposalService,
            { decorate } as unknown as ParseJobMatchView,
        );

        await controller.getById(PRINCIPAL, undefined, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');

        expect(decorate.mock.calls[0]?.[3]).toBeUndefined();
    });
});
