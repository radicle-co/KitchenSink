/**
 * T135-test — unit tests for {@link AccountController}: the pure request→service→response mapping over a
 * mocked {@link ErasureService}.
 *
 * Requirement → test map:
 *
 *   - **FR-038 / REQ-IF-007 (owner scoping)** — the owner is ALWAYS the `@OwnerId()`-injected app-user
 *     ULID from the verified token; a client-supplied `ownerId` in the body can never redirect the
 *     erasure at another account (that would be account-takeover-grade IDOR).
 *     → `describe('the owner key')`
 *   - **api.openapi.yaml `requestAccountErasure`** — the body is OPTIONAL, and the response is returned
 *     verbatim as `{ jobId, status }` with no invented fields.
 *     → `describe('the request body')` / `describe('the response')`
 *
 * The `401`-on-missing-principal path lives in `@OwnerId()` itself
 * (`auth/__tests__/current-principal.decorator.test.ts`); the wire status codes (`202`/`410`) are pinned
 * over real HTTP by the integration tier (T137).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AccountController } from '../account.controller.js';
import type { ErasureService } from '../erasure.service.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE, type ErasureRequestDto } from '../dto/erasure.dto.js';

type ServiceMock = { [K in keyof ErasureService]: ReturnType<typeof vi.fn> };

const OWNER = 'owner-1';
const ACCEPTED = { jobId: '00000000-0000-4000-8000-0000000000e1', status: 'queued' } as const;

let erasure: ServiceMock;
let controller: AccountController;

beforeEach(() => {
    erasure = { requestErasure: vi.fn().mockResolvedValue(ACCEPTED) };
    controller = new AccountController(erasure as unknown as ErasureService);
});

describe('the owner key', () => {
    it('passes the authenticated owner id through to the service', async () => {
        await controller.requestErasure(OWNER, {});

        expect(erasure.requestErasure).toHaveBeenCalledExactlyOnceWith(OWNER, {});
    });

    it('IGNORES an ownerId smuggled in the body — erasure is only ever scoped to the caller', async () => {
        const hostile = { ownerId: 'victim-2', confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE };

        await controller.requestErasure(OWNER, hostile as ErasureRequestDto);

        const [ownerArg] = erasure.requestErasure.mock.calls[0] ?? [];
        expect(ownerArg).toBe(OWNER);
        expect(ownerArg).not.toBe('victim-2');
    });
});

describe('the request body', () => {
    it('accepts an absent body (the contract marks the requestBody optional)', async () => {
        await expect(controller.requestErasure(OWNER, undefined)).resolves.toEqual(ACCEPTED);
    });

    it('forwards a supplied confirmation phrase to the service for validation', async () => {
        const body: ErasureRequestDto = { confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE };

        await controller.requestErasure(OWNER, body);

        expect(erasure.requestErasure).toHaveBeenCalledExactlyOnceWith(OWNER, body);
    });
});

describe('the response', () => {
    it('returns the service result verbatim — exactly { jobId, status }, no invented fields', async () => {
        const result = await controller.requestErasure(OWNER, {});

        expect(result).toEqual(ACCEPTED);
        expect(Object.keys(result).sort()).toEqual(['jobId', 'status']);
    });

    it('propagates a service rejection untouched for the exception filter to map', async () => {
        const failure = new Error('boom');
        erasure.requestErasure.mockRejectedValue(failure);

        await expect(controller.requestErasure(OWNER, {})).rejects.toBe(failure);
    });
});
