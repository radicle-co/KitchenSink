/**
 * Unit tests for {@link ServiceErasureController} (CR-002 / U4b / R11). The controller reads the target
 * owner ONLY from the verified principal (never a body) and delegates to {@link UserErasureService},
 * surfacing the erased requester id + the removed-row count (the reconciliation residue signal).
 */
import { describe, it, expect, vi } from 'vitest';

import { ServiceErasureController } from '../serviceErasure.controller.js';
import type { UserErasureService } from '../userErasure.service.js';
import type { ServicePrincipal } from '../../auth/servicePrincipal.js';

const PRINCIPAL: ServicePrincipal = { ownerId: '01JOWNER00000000000000000A', eventId: 'evt', actor: 'worker' };

describe('ServiceErasureController', () => {
    it('erases the TOKEN-bound owner and returns the requester id + deleted-row count', async () => {
        const erasure = {
            eraseUser: vi.fn().mockResolvedValue({
                requesterId: PRINCIPAL.ownerId,
                deletedRequesterRows: 3,
                deletedAuthoredFoods: 2,
                keptAuthoredFoods: 1,
            }),
        };
        const controller = new ServiceErasureController(erasure as unknown as UserErasureService);

        const result = await controller.eraseAccount(PRINCIPAL, { referencedFoodIds: ['f-kept'] });

        // The owner is the verified token's bound claim — never a request-supplied value; the body only
        // narrows Q3b's orphan arm (U18).
        expect(erasure.eraseUser).toHaveBeenCalledWith(PRINCIPAL.ownerId, ['f-kept']);
        expect(result).toEqual({
            requesterId: PRINCIPAL.ownerId,
            deletedRequesterRows: 3,
            deletedAuthoredFoods: 2,
            keptAuthoredFoods: 1,
        });
    });

    it('U18: the begin step tombstones and returns the authored ids', async () => {
        const erasure = {
            beginErasure: vi.fn().mockResolvedValue({ authoredFoodIds: ['f-1', 'f-2'] }),
        };
        const controller = new ServiceErasureController(erasure as unknown as UserErasureService);

        expect(await controller.beginErasure(PRINCIPAL)).toEqual({ authoredFoodIds: ['f-1', 'f-2'] });
        expect(erasure.beginErasure).toHaveBeenCalledWith(PRINCIPAL.ownerId);
    });

    it('surfaces an idempotent no-op (0 rows) for an owner with no food footprint', async () => {
        const erasure = {
            eraseUser: vi.fn().mockResolvedValue({
                requesterId: PRINCIPAL.ownerId,
                deletedRequesterRows: 0,
                deletedAuthoredFoods: 0,
                keptAuthoredFoods: 0,
            }),
        };
        const controller = new ServiceErasureController(erasure as unknown as UserErasureService);

        expect(await controller.eraseAccount(PRINCIPAL, {})).toEqual({
            requesterId: PRINCIPAL.ownerId,
            deletedRequesterRows: 0,
            deletedAuthoredFoods: 0,
            keptAuthoredFoods: 0,
        });
    });
});
