/**
 * The create route charges the VERIFIED principal's allowance (never an id from the body), and hands the service the
 * principal's owner key, roles and kind: the one import allowance (004 FR-067) reads the plan and the test kind from them.
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

describe('ParseJobsController.create — the allowance', () => {
    it('hands the service the verified principal for the pasted text: owner, roles and kind', async () => {
        const free = await createAs(BASE);
        const paid = await createAs({ ...BASE, roles: ['premium'] });
        const test = await createAs({ ...BASE, principalKind: 'test' });

        expect(free).toHaveBeenCalledWith(expect.objectContaining({ userId: BASE.userId, roles: [] }), '1 cup milk');
        expect(paid).toHaveBeenCalledWith(
            expect.objectContaining({ userId: BASE.userId, roles: ['premium'] }),
            '1 cup milk',
        );
        expect(test).toHaveBeenCalledWith(
            expect.objectContaining({ userId: BASE.userId, principalKind: 'test' }),
            '1 cup milk',
        );
    });
});
