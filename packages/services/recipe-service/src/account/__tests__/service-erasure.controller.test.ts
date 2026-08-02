/**
 * Unit tests for {@link ServiceErasureController} — the pure principal→service→response mapping over a
 * mocked {@link ErasureService} (CR-002 / U4a).
 *
 * The wire-level facts (the guard rejecting a forged/absent token, the AuthMiddleware exclusion, the 202
 * status) are pinned over real HTTP by the integration tier. Here we pin only that the controller scopes
 * the erasure to the TOKEN-bound principal and returns the service result verbatim — never reading an
 * owner from anywhere but the verified principal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ServiceErasureController } from '../service-erasure.controller.js';
import type { ErasureService } from '../erasure.service.js';
import type { ServicePrincipal } from '../../auth/service-principal.js';
import type { ServiceErasureAcceptedResponse } from '../dto/service-erasure.dto.js';

const PRINCIPAL: ServicePrincipal = {
    ownerId: '01JTARGETOWNER0000000000AA',
    eventId: 'evt_del_7',
    actor: 'identity-deletion-worker',
};
const ACCEPTED: ServiceErasureAcceptedResponse = {
    jobId: '00000000-0000-4000-8000-0000000000e1',
    status: 'queued',
    triggerSource: 'service',
};

type ServiceMock = { requestServiceErasure: ReturnType<typeof vi.fn> };

let erasure: ServiceMock;
let controller: ServiceErasureController;

beforeEach(() => {
    erasure = { requestServiceErasure: vi.fn().mockResolvedValue(ACCEPTED) };
    controller = new ServiceErasureController(erasure as unknown as ErasureService);
});

describe('POST /api/v1/internal/account/erasure', () => {
    it('passes the VERIFIED service principal straight to the service — owner comes only from the token', async () => {
        await controller.eraseAccount(PRINCIPAL);

        expect(erasure.requestServiceErasure).toHaveBeenCalledExactlyOnceWith(PRINCIPAL);
    });

    it('returns the service result verbatim (jobId, status, triggerSource)', async () => {
        const result = await controller.eraseAccount(PRINCIPAL);

        expect(result).toEqual(ACCEPTED);
    });

    it('propagates a service rejection untouched for the exception filter to map', async () => {
        const failure = new Error('boom');
        erasure.requestServiceErasure.mockRejectedValue(failure);

        await expect(controller.eraseAccount(PRINCIPAL)).rejects.toBe(failure);
    });
});
