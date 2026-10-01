/**
 * ADR-0040 — unit tests for {@link TestResetController}: a thin adapter over {@link TestResetService}.
 *
 * Pins what the controller alone decides: that it hands the service the ACTING slice of the verified principal and
 * nothing a client supplied, that the request is exempt from the erasure write-lock (a second reset during an active
 * one must get the running job back, not a `423`), and the route shape the published contract names.
 */
import 'reflect-metadata';

import { HttpStatus, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../../auth/principal.js';
import { SKIP_ERASURE_LOCK } from '../skipErasureLock.decorator.js';
import { TestResetController } from '../testReset.controller.js';
import type { TestResetService } from '../testReset.service.js';

const PRINCIPAL: Principal = {
    userId: '01JZRESETCONTROLLERUSER001',
    sub: 'user_clerk',
    scopes: ['recipes:mappings:global'],
    permissions: ['premium'],
    principalKind: 'test',
    containment: 'enforce',
};
const ACTING = { userId: PRINCIPAL.userId, principalKind: 'test', containment: 'enforce' } as const;
const JOB_ID = '00000000-0000-4000-8000-0000000000f2';

function makeController() {
    const service = {
        requestReset: vi.fn().mockResolvedValue({ jobId: JOB_ID, status: 'queued' }),
        getReset: vi.fn().mockResolvedValue({ jobId: JOB_ID, status: 'running', createdAt: 'a', updatedAt: 'b' }),
    };

    return { service, controller: new TestResetController(service as unknown as TestResetService) };
}

describe('TestResetController', () => {
    it('requests a reset for the verified principal’s acting slice — there is no target a client can name', async () => {
        const { service, controller } = makeController();

        expect(await controller.requestReset(PRINCIPAL)).toEqual({ jobId: JOB_ID, status: 'queued' });
        expect(service.requestReset).toHaveBeenCalledExactlyOnceWith(ACTING);
    });

    it('reads a job for the verified principal and the path id', async () => {
        const { service, controller } = makeController();

        await controller.getReset(PRINCIPAL, JOB_ID);

        expect(service.getReset).toHaveBeenCalledExactlyOnceWith(ACTING, JOB_ID);
    });

    it('serves POST api/v1/account/test-reset with 202, EXEMPT from the erasure write-lock', () => {
        const handler = TestResetController.prototype.requestReset;

        expect(Reflect.getMetadata(PATH_METADATA, TestResetController)).toBe('api/v1/account/test-reset');
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.ACCEPTED);
        expect(Reflect.getMetadata(SKIP_ERASURE_LOCK, handler)).toBe(true);
    });

    it('serves GET api/v1/account/test-reset/:jobId', () => {
        const handler = TestResetController.prototype.getReset;

        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':jobId');
    });
});
