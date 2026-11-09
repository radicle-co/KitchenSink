/**
 * The caller a food route acts for, narrowed from the guard-populated request. One definition for every controller, so
 * "who is the caller, and is it a person" cannot be answered two ways.
 */
import { UnauthorizedException } from '@nestjs/common';

import { apiError } from '../common/apiError.js';
import {
    IDENTITY_SYNC_PENDING_CODE,
    resolveRequesterId,
    type AuthenticatedPrincipal,
    type AuthenticatedRequest,
} from './authenticatedPrincipal.js';

/**
 * Narrow the guard-populated principal, failing closed with `401` if somehow absent.
 *
 * @param req - The guard-authenticated request.
 * @returns The verified principal.
 * @throws (→ 401) when `req.user` is absent.
 */
export function requirePrincipal(req: AuthenticatedRequest): AuthenticatedPrincipal {
    if (!req.user) {
        throw new UnauthorizedException('Valid Clerk session or M2M token required');
    }

    return req.user;
}

/**
 * The requester key: the app-user ULID for a user principal, or the `svc_*` id for a service principal. Never falls
 * back to the raw Clerk `sub` (the pre-U1 keying).
 *
 * @param req - The guard-authenticated request.
 * @returns The resolved requester key.
 * @throws (→ 401) when `req.user` is absent or the app-user ULID has not synced yet (`IDENTITY_SYNC_PENDING`).
 */
export function requireRequesterId(req: AuthenticatedRequest): string {
    const resolution = resolveRequesterId(requirePrincipal(req));

    if (resolution.status === IDENTITY_SYNC_PENDING_CODE) {
        // `apiError` takes a PUBLISHED `FoodErrorCode`, so the auth constant and the published code agreeing is a
        // `typecheck` obligation rather than a convention.
        throw apiError(
            IDENTITY_SYNC_PENDING_CODE,
            'App-user identity (external_id) not yet available; retry with a refreshed token.',
        );
    }

    return resolution.requesterId;
}

/**
 * The requester key, narrowed to a PERSON: authored rows belong to people, so a `svc_*` service principal is refused
 * with `403`.
 *
 * @param req - The guard-authenticated request.
 * @returns The caller's app-user ULID.
 * @throws (→ 401) the {@link requireRequesterId} cases; (→ 403) for a service principal.
 */
export function requireUserUlid(req: AuthenticatedRequest): string {
    const requesterId = requireRequesterId(req);

    if (requesterId.startsWith('svc_')) {
        throw apiError('FORBIDDEN', 'Authored foods belong to user accounts, not service principals.');
    }

    return requesterId;
}
