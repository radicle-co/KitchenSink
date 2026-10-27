/**
 * The create route charges the VERIFIED principal's allowance (never an id from the body) and passes no tier: the
 * allowance is the same for every caller until 010 specifies tier rules (004 FR-022).
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
    it('charges the verified principal for the pasted text, whatever its roles', async () => {
        const free = await createAs(BASE);
        const paid = await createAs({ ...BASE, roles: ['premium'] });

        expect(free).toHaveBeenCalledWith(BASE.userId, '1 cup milk');
        expect(paid).toHaveBeenCalledWith(BASE.userId, '1 cup milk');
    });
});
