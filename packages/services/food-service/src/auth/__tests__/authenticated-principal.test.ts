/**
 * Unit tests for the requester-key resolution (CR-002/U1, R5). Pure logic mapping a verified
 * {@link AuthenticatedPrincipal} to the id recorded in `fetch_requesters`:
 *   - a service principal (`svc_*` sub) → its `svc_*` id (unchanged from pre-U1),
 *   - a user principal → the app-user ULID (`userId`, from the token's `external_id`),
 *   - a user principal whose `external_id` has not synced yet → `identity-sync-pending` (DEFER; the
 *     caller must NOT fall back to the raw Clerk `sub`).
 */
import { describe, expect, it } from 'vitest';

import {
    IDENTITY_SYNC_PENDING_CODE,
    resolveRequesterId,
    type AuthenticatedPrincipal,
} from '../authenticated-principal.js';

/** A structurally valid app-user ULID (identity's `users.id`, surfaced from `external_id`). */
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** Build a principal fixture with sensible empty-privilege defaults. */
function makePrincipal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
    return { sub: 'user_clerk123', scopes: [], permissions: [], ...overrides };
}

describe('resolveRequesterId (CR-002/U1, R5)', () => {
    it('resolves a user principal to its app-user ULID (userId), NEVER the Clerk sub', () => {
        const result = resolveRequesterId(makePrincipal({ sub: 'user_clerk123', userId: USER_ULID }));

        expect(result).toEqual({ status: 'resolved', requesterId: USER_ULID });
    });

    it('defers a user principal whose external_id has not synced yet (first-token race)', () => {
        // The shared verifier leaves userId undefined until identity backfills external_id to Clerk.
        const result = resolveRequesterId(makePrincipal({ sub: 'user_clerk123', userId: undefined }));

        expect(result).toEqual({ status: IDENTITY_SYNC_PENDING_CODE });
    });

    it('NEVER falls back to the raw Clerk sub when userId is absent', () => {
        const result = resolveRequesterId(makePrincipal({ sub: 'user_clerk123' }));

        expect(result).not.toEqual({ status: 'resolved', requesterId: 'user_clerk123' });
    });

    it('resolves a service principal (svc_*) to its own id, ignoring any (absent) userId', () => {
        const result = resolveRequesterId(makePrincipal({ sub: 'svc_recipe_import', userId: undefined }));

        expect(result).toEqual({ status: 'resolved', requesterId: 'svc_recipe_import' });
    });

    it('treats an empty-string userId as unsynced (defer), not a valid requester', () => {
        const result = resolveRequesterId(makePrincipal({ sub: 'user_clerk123', userId: '' }));

        expect(result).toEqual({ status: IDENTITY_SYNC_PENDING_CODE });
    });
});
