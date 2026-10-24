/**
 * Unit tests for the async-producer provenance guard (T-053, FR-048, CR-002/U1). Pure logic: a leased
 * `fetch_queue` row is drainable only when EVERY recorded requester id is a real principal — an app-user
 * **ULID** (CR-002/U1: requesters are re-keyed off the Clerk `sub` onto the app ULID) or an allowlisted
 * `svc_*` service principal — and there is at least one. A row with no recorded requester, a raw Clerk
 * `sub` (`user_*`), or a forbidden `'system'` shortcut is refused.
 */
import { describe, expect, it } from 'vitest';

import { hasValidProvenance, isValidPrincipal } from '../provenance.js';
import { SVC_ADMIN_REQUEUE } from '../change-refresh/changeRefresh.consumer.js';

/** A structurally valid app-user ULID (identity's `users.id`) — the post-U1 requester key. */
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
/** A second valid ULID for many-requester assertions. */
const USER_ULID_2 = '01HZY0T9R4M8QK3W7C5B2N6D0E';

describe('isValidPrincipal (FR-048, CR-002/U1)', () => {
    it('accepts a valid app-user ULID (the post-U1 user requester key)', () => {
        expect(isValidPrincipal(USER_ULID)).toBe(true);
        expect(isValidPrincipal(USER_ULID_2)).toBe(true);
    });

    it('accepts an allowlisted named service principal (svc_*)', () => {
        expect(isValidPrincipal('svc_change_refresh')).toBe(true);
        expect(isValidPrincipal('svc_recipe_import')).toBe(true);
    });

    /**
     * U9's operator requeue re-enqueues a blackholed food as this principal, which is the ENTIRE mechanism
     * by which the escape hatch recovers anything: `tombstone` prunes `fetch_requesters` (DSN-10), so a
     * blackholed food has no requester and the drain would refuse the requeued row. Pinned by name, not
     * by shape — a rename that missed the constant would leave the requeue enqueuing an id this validator
     * still accepts (any `svc_*` passes), so only naming it here ties the two together.
     */
    it('accepts SVC_ADMIN_REQUEUE — the principal U9 recovery depends on', () => {
        expect(isValidPrincipal(SVC_ADMIN_REQUEUE)).toBe(true);
        expect(SVC_ADMIN_REQUEUE).toBe('svc_admin_requeue');
    });

    it('rejects a raw Clerk sub (a legacy pre-U1 requester key) — it is not a ULID and not svc_*', () => {
        // The whole point of U1: a `user_*` Clerk sub must NO LONGER pass provenance — a user requester
        // is now the app ULID. A leftover legacy row is refused, not silently honoured.
        expect(isValidPrincipal('user_2abc')).toBe(false);
        expect(isValidPrincipal('user_31Habcdefghijklmnopqrst')).toBe(false);
    });

    it('rejects the forbidden "system" shortcut (no unauthenticated bypass)', () => {
        expect(isValidPrincipal('system')).toBe(false);
        expect(isValidPrincipal('SYSTEM')).toBe(false);
    });

    it('rejects an empty / whitespace-only requester id', () => {
        expect(isValidPrincipal('')).toBe(false);
        expect(isValidPrincipal('   ')).toBe(false);
    });

    it('rejects a bare "svc_" prefix with no principal name', () => {
        expect(isValidPrincipal('svc_')).toBe(false);
    });

    it('rejects a malformed ULID (wrong length / illegal Crockford char)', () => {
        expect(isValidPrincipal('01J9ZK8N7QF3B2X4M6T0V5C1A')).toBe(false); // 25 chars
        expect(isValidPrincipal('01J9ZK8N7QF3B2X4M6T0V5C1ABX')).toBe(false); // 27 chars
        expect(isValidPrincipal('01J9ZK8N7QF3B2X4M6T0V5C1IL')).toBe(false); // I and L are illegal
    });
});

describe('hasValidProvenance (FR-048, CR-002/U1)', () => {
    it('refuses a row with NO recorded requester', () => {
        expect(hasValidProvenance([])).toBe(false);
    });

    it('accepts a single-requester row whose id is a valid ULID', () => {
        expect(hasValidProvenance([USER_ULID])).toBe(true);
    });

    it('requires EVERY requester to be valid for a many-requester food', () => {
        expect(hasValidProvenance([USER_ULID, USER_ULID_2, 'svc_change_refresh'])).toBe(true);
        expect(hasValidProvenance([USER_ULID, 'system'])).toBe(false);
        expect(hasValidProvenance([USER_ULID, ''])).toBe(false);
        // A single stranded legacy raw-sub requester poisons the whole set (FR-048).
        expect(hasValidProvenance([USER_ULID, 'user_legacy'])).toBe(false);
    });
});
