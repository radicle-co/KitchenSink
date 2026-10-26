/**
 * The create route hands the allowance the caller's TIER, read from the verified principal's roles by the one tier
 * source every policy shares (`isPremiumPrincipal`) — never from the body (004 FR-022, the 010 seam).
 */
import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../../auth/principal.js';
import type { MatchProposalService } from '../matchProposal.service.js';
import type { ParseJobMatchView } from '../parseJobMatchView.js';
import { ParseJobsController } from '../parseJobs.controller.js';
import type { ParseJobsService } from '../parseJobs.service.js';

const BASE: Principal = {
    userId: '01JQUOTACONTROLLEROWNER000A',
    sub: 'clerk_01JQUOTACONTROLLEROWNER000A',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};

async function createAs(principal: Principal): Promise<ReturnType<typeof vi.fn>> {
    const create = vi.fn().mockResolvedValue({ id: 'job' });
    const controller = new ParseJobsController(
        { create } as unknown as ParseJobsService,
        {} as MatchProposalService,
        { decorate: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as ParseJobMatchView,
    );

    await controller.create(principal, undefined, { text: '1 cup milk' });

    return create;
}

describe('ParseJobsController.create — the tier', () => {
    it('hands the service a free tier for a principal without a paid role', async () => {
        const create = await createAs(BASE);

        expect(create).toHaveBeenCalledWith(BASE.userId, '1 cup milk', { isPremium: false });
    });

    it('hands the service a premium tier for a principal with a paid role', async () => {
        const create = await createAs({ ...BASE, roles: ['premium'] });

        expect(create).toHaveBeenCalledWith(BASE.userId, '1 cup milk', { isPremium: true });
    });
});
