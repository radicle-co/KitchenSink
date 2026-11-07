/**
 * The pool's address NAMESPACE: how a local run gets users of its own.
 *
 * ⛔ WHY. The Maestro erasure flow really erases whoever it signs in as, and the user is then deleted from Clerk (by
 * the identity deletion worker when deployed; locally, which runs none, by `poolAdmin`). The shared sandbox pool's `erasure01` and `erasure06` are CI's, on the one Clerk instance every run shares.
 * A local run that leased them would destroy CI's subjects, and their `external_id` (written by the sandbox identity
 * webhook, which is down when the sandbox is) is not something a local run may rewrite. So a local run signs in users
 * that exist only for it, selected by one environment switch that every part of the toolchain reads from this module:
 * the lease, the purge, the alignment, the manifest's erasure guard and the refill cannot disagree about whose user it is.
 *
 * The invariants worth pinning are the ones whose failure is silent: the DEFAULT must be byte-identical to before (CI sets
 * nothing), the two namespaces must never share an address, and a local user must never read as drift to the owner's
 * full-roster audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { planPool } from '../src/poolAdmin.js';
import {
    assertPoolMember,
    knownPoolAddresses,
    maestroErasureSlots,
    maestroSlotForShard,
    poolNamespaceFrom,
    rosterSlots,
} from '../src/testPool.js';

describe('poolNamespaceFrom', () => {
    it('is the shared pool when nothing is set, so CI is unchanged', () => {
        expect(poolNamespaceFrom({})).toBe('shared');
        expect(poolNamespaceFrom({ E2E_POOL_NAMESPACE: '' })).toBe('shared');
    });

    it('is local only for the exact word', () => {
        expect(poolNamespaceFrom({ E2E_POOL_NAMESPACE: 'local' })).toBe('local');
    });

    it.each(['Local', 'LOCAL', ' local', 'shared', 'prod', 'constructor'])(
        'refuses %j rather than guessing',
        (value) => {
            expect(() => poolNamespaceFrom({ E2E_POOL_NAMESPACE: value })).toThrow(/E2E_POOL_NAMESPACE/u);
        },
    );
});

describe('the roster under each namespace', () => {
    it('keeps the shared addresses exactly as they were', () => {
        vi.stubEnv('E2E_POOL_NAMESPACE', '');

        expect(maestroSlotForShard('signer', 'android', 1).email).toBe('test-signer+clerk_test@radcile.com');
        expect(maestroErasureSlots('android', 1)[0]?.email).toBe('test-erasure01+clerk_test@radcile.com');
        vi.unstubAllEnvs();
    });

    it('moves every slot to a local-only address, keeping its lane and its username unique', () => {
        const shared = rosterSlots();

        vi.stubEnv('E2E_POOL_NAMESPACE', 'local');
        const local = rosterSlots();

        expect(local.map((slot) => slot.id)).toEqual(shared.map((slot) => slot.id));
        expect(local.map((slot) => slot.email)).toEqual(
            shared.map((slot) => slot.email.replace('test-', 'test-local-')),
        );
        expect(new Set(local.map((slot) => slot.username)).size).toBe(local.length);
        expect(local.map((slot) => slot.username)).not.toEqual(shared.map((slot) => slot.username));
        expect(maestroErasureSlots('ios', 1).map((slot) => slot.email)).toEqual(
            ['test-local-erasure06+clerk_test@radcile.com'],
        );
        vi.unstubAllEnvs();
    });

    it('never shares an address between the namespaces, and knows both', () => {
        const shared = rosterSlots().map((slot) => slot.email);

        vi.stubEnv('E2E_POOL_NAMESPACE', 'local');
        const local = rosterSlots().map((slot) => slot.email);
        vi.unstubAllEnvs();

        expect(shared.filter((email) => local.includes(email))).toEqual([]);
        expect([...knownPoolAddresses()].sort()).toEqual([...shared, ...local].sort());
    });

    it('admits a local address as a member only while the local namespace is selected', () => {
        const address = 'test-local-erasure01+clerk_test@radcile.com';

        expect(() => assertPoolMember(address)).toThrow(/not a member/u);
        vi.stubEnv('E2E_POOL_NAMESPACE', 'local');
        expect(() => assertPoolMember(address)).not.toThrow();
        expect(() => assertPoolMember('test-erasure01+clerk_test@radcile.com')).toThrow(/not a member/u);
        vi.unstubAllEnvs();
    });
});

describe('the owner’s drift audit', () => {
    it('does not call a local user a stray marked user', () => {
        const local = {
            id: 'user_local',
            emails: ['test-local-erasure01+clerk_test@radcile.com'],
            publicMetadata: { testPrincipal: true },
            externalId: null,
        };
        const stray = { ...local, id: 'user_stray', emails: ['someone-else+clerk_test@radcile.com'] };

        expect(planPool([], new Map(), [local, stray]).drift.map((entry) => entry.id)).toEqual(['user_stray']);
    });
});
