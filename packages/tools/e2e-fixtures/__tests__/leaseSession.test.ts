/**
 * Leasing a pool slot: resolve the ONE Clerk user the roster names, refuse it unless `poolAdmin` has
 * provisioned it, and only then sign in.
 *
 * Every refusal here is asserted to happen BEFORE a ticket is minted, because a ticket is a live credential for
 * whoever it names — the whole point of the pool gate is that nothing off the roster, and nothing the pool admin
 * has not marked, is ever signed into.
 */
import { ClerkAPIResponseError } from '@clerk/backend/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionHandle } from '../src/clerkSession.js';
import {
    clerkLeasePort,
    clerkSessionSweepPort,
    firstAvailableSlot,
    leaseErasureSubject,
    leaseSession,
    resolvePoolUser,
    SESSION_PAGE_SIZE,
    type LeasePort,
    type PoolUserRecord,
} from '../src/leaseSession.js';
import { consumableSlots, MAESTRO_ERASURE_SHARD, maestroErasureSlots, slotFor } from '../src/testPool.js';

const clerk = vi.hoisted(() => ({
    getUserList: vi.fn(),
    createSignInToken: vi.fn(),
    getSessionList: vi.fn(),
    revokeSession: vi.fn(),
}));

vi.mock('@clerk/backend', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@clerk/backend')>()),
    createClerkClient: () => ({
        users: { getUserList: clerk.getUserList },
        signInTokens: { createSignInToken: clerk.createSignInToken },
        sessions: { getSessionList: clerk.getSessionList, revokeSession: clerk.revokeSession },
    }),
}));

const ORIGIN = 'https://pr-91.sandbox.commise.app';
const PUBLISHABLE_KEY = `pk_test_${Buffer.from('x.clerk.accounts.dev$').toString('base64')}`;

const provisioned = (overrides: Partial<PoolUserRecord> = {}): PoolUserRecord => ({
    id: 'user_alfa',
    publicMetadata: { testPrincipal: true, roles: ['premium'], permissions: [], scopes: [] },
    externalId: '01J00000000000000000000000',
    ...overrides,
});

const portWith = (
    users: readonly PoolUserRecord[],
): LeasePort & {
    readonly findUsers: ReturnType<typeof vi.fn>;
    readonly mintTicket: ReturnType<typeof vi.fn>;
} => ({
    findUsers: vi.fn().mockResolvedValue(users),
    mintTicket: vi.fn().mockResolvedValue('ticket_1'),
});

const HANDLE: SessionHandle = {
    sessionId: 'sess_1',
    devJwt: 'dev_1',
    fapi: 'https://x.clerk.accounts.dev/v1',
    origin: ORIGIN,
    email: 'test-alfa+clerk_test@radcile.com',
};

describe('resolvePoolUser', () => {
    const slot = slotFor('k6', 'alfa');

    it('answers the one provisioned user the slot names', async () => {
        const port = portWith([provisioned()]);

        await expect(resolvePoolUser(slot, port)).resolves.toMatchObject({ id: 'user_alfa' });
        expect(port.findUsers).toHaveBeenCalledWith('test-alfa+clerk_test@radcile.com');
    });

    it('REFUSES a slot with no user, naming poolAdmin — a test run never creates one', async () => {
        await expect(resolvePoolUser(slot, portWith([]))).rejects.toThrow(/no Clerk user.*poolAdmin/u);
    });

    it('REFUSES an address two users hold — the lease would be ambiguous', async () => {
        await expect(resolvePoolUser(slot, portWith([provisioned(), provisioned({ id: 'u2' })]))).rejects.toThrow(
            /2 Clerk users/u,
        );
    });

    it.each([
        ['absent', {}],
        ['false', { testPrincipal: false }],
        ['a truthy non-boolean', { testPrincipal: 'true' }],
    ])('REFUSES a user whose test-principal marker is %s — poolAdmin has not provisioned it', async (_, metadata) => {
        await expect(resolvePoolUser(slot, portWith([provisioned({ publicMetadata: metadata })]))).rejects.toThrow(
            /not marked as a test principal/u,
        );
    });

    it('REFUSES a user without an external_id — every service call would answer 401', async () => {
        await expect(resolvePoolUser(slot, portWith([provisioned({ externalId: null })]))).rejects.toThrow(
            /external_id/u,
        );
    });

    it('never looks up an address that is not on the roster', async () => {
        const port = portWith([provisioned()]);
        const forged = { ...slot, email: 'someone@example.com' };

        await expect(resolvePoolUser(forged, port)).rejects.toThrow(/not a member of the test pool/u);
        expect(port.findUsers).not.toHaveBeenCalled();
    });
});

describe('leaseSession', () => {
    const slot = slotFor('k6', 'alfa');

    it('signs in as the resolved user, minting the ticket for THAT user id', async () => {
        const port = portWith([provisioned()]);
        const establish = vi.fn().mockImplementation(async (input: { mintTicket: (e: string) => Promise<string> }) => {
            await input.mintTicket(slot.email);

            return HANDLE;
        });

        const leased = await leaseSession({ slot, publishableKey: PUBLISHABLE_KEY, origin: ORIGIN, port, establish });

        expect(leased).toEqual({ slot, userId: 'user_alfa', handle: HANDLE });
        expect(establish).toHaveBeenCalledWith(
            expect.objectContaining({ email: slot.email, publishableKey: PUBLISHABLE_KEY, origin: ORIGIN }),
        );
        expect(port.mintTicket).toHaveBeenCalledWith('user_alfa');
    });

    it('does not sign in at all when the slot is not provisioned', async () => {
        const port = portWith([provisioned({ publicMetadata: {} })]);
        const establish = vi.fn();

        await expect(
            leaseSession({ slot, publishableKey: PUBLISHABLE_KEY, origin: ORIGIN, port, establish }),
        ).rejects.toThrow(/test principal/u);
        expect(establish).not.toHaveBeenCalled();
        expect(port.mintTicket).not.toHaveBeenCalled();
    });
});

describe('firstAvailableSlot', () => {
    const erasure = consumableSlots('maestro');

    it('takes the first consumable slot, in declared order, whose user still exists', async () => {
        const port: LeasePort = {
            findUsers: vi.fn().mockImplementation(async (email: string) =>
                // The first two were consumed by earlier erasures.
                email === erasure[0]?.email || email === erasure[1]?.email ? [] : [provisioned()],
            ),
            mintTicket: vi.fn(),
        };

        await expect(firstAvailableSlot(erasure, port)).resolves.toMatchObject({ slot: erasure[2] });
    });

    it('skips a slot whose user exists but is not provisioned, rather than leasing it', async () => {
        const port: LeasePort = {
            findUsers: vi
                .fn()
                .mockImplementation(async (email: string) =>
                    email === erasure[0]?.email ? [provisioned({ publicMetadata: {} })] : [provisioned()],
                ),
            mintTicket: vi.fn(),
        };

        await expect(firstAvailableSlot(erasure, port)).resolves.toMatchObject({ slot: erasure[1] });
    });

    it('THROWS when every slot is consumed — the tier goes RED, it never skips', async () => {
        await expect(firstAvailableSlot(erasure, portWith([]))).rejects.toThrow(/all \d+ .*consumed.*poolAdmin/u);
    });

    it('does not blame consumption when the slots EXIST but are unprovisioned — it names each refusal', async () => {
        const failure = firstAvailableSlot(erasure, portWith([provisioned({ publicMetadata: {} })]));

        await expect(failure).rejects.toThrow(/none of \d+ slots is leasable/u);
        await expect(failure).rejects.not.toThrow(/consumed/u);
    });

    it('THROWS on an empty slot list rather than reporting nothing to lease', async () => {
        await expect(firstAvailableSlot([], portWith([provisioned()]))).rejects.toThrow(/no slots/u);
    });
});

/**
 * The erasure lane (2026-10-08, `maestroErasureSlots`; REWRITTEN 2026-10-13 for per-platform lanes): a platform's
 * erasure shard draws from EVERY one of THAT platform's subjects and from no other platform's, and every other shard
 * leases none. The first case is the measured failure behind the lane: the old stride gave the shard that runs the
 * flow only every other subject, so once its half was erased it went red while the rest stood unused.
 */
describe('leaseErasureSubject', () => {
    const android = maestroErasureSlots('android', MAESTRO_ERASURE_SHARD);
    const ios = maestroErasureSlots('ios', MAESTRO_ERASURE_SHARD);
    const portStanding = (...standing: readonly (string | undefined)[]): LeasePort => ({
        findUsers: vi
            .fn()
            .mockImplementation(async (email: string) => (standing.includes(email) ? [provisioned()] : [])),
        mintTicket: vi.fn(),
    });

    it('⛔ reaches the LAST of a platform’s subjects when every earlier one is consumed', async () => {
        const last = android.at(-1);

        await expect(
            leaseErasureSubject('android', MAESTRO_ERASURE_SHARD, portStanding(last?.email)),
        ).resolves.toMatchObject({ slot: last });
    });

    it('⛔ draws iOS’s subject from erasure06-10 and Android’s from erasure01-05, never across', async () => {
        const everyone = portStanding(...consumableSlots('maestro').map((slot) => slot.email));

        await expect(leaseErasureSubject('android', MAESTRO_ERASURE_SHARD, everyone)).resolves.toMatchObject({
            slot: { id: 'erasure01' },
        });
        await expect(leaseErasureSubject('ios', MAESTRO_ERASURE_SHARD, everyone)).resolves.toMatchObject({
            slot: { id: 'erasure06' },
        });
    });

    it('⛔ does NOT fall back to the other platform’s subjects when its own are consumed', async () => {
        const otherPlatformOnly = portStanding(...android.map((slot) => slot.email));

        await expect(leaseErasureSubject('ios', MAESTRO_ERASURE_SHARD, otherPlatformOnly)).rejects.toThrow(
            /all 5 .*consumed.*poolAdmin/u,
        );
        expect(ios).toHaveLength(5);
    });

    it('⛔ leases NOTHING on any other shard, and does not even look', async () => {
        const port = portWith([provisioned()]);

        await expect(leaseErasureSubject('android', MAESTRO_ERASURE_SHARD + 1, port)).resolves.toBeNull();
        await expect(leaseErasureSubject('ios', MAESTRO_ERASURE_SHARD + 1, port)).resolves.toBeNull();
        expect(port.findUsers).not.toHaveBeenCalled();
    });

    it('still goes RED on the erasure shard when every subject is consumed', async () => {
        await expect(leaseErasureSubject('android', MAESTRO_ERASURE_SHARD, portWith([]))).rejects.toThrow(
            /all 5 .*consumed.*poolAdmin/u,
        );
    });
});

describe('clerkLeasePort', () => {
    beforeEach(() => {
        clerk.getUserList.mockReset();
        clerk.createSignInToken.mockReset();
    });

    it('names the step, the address, the status and the codes when Clerk refuses for good', async () => {
        clerk.getUserList.mockRejectedValue(
            new ClerkAPIResponseError('', {
                data: [{ code: 'authorization_invalid', message: 'nope', long_message: '', meta: {} }],
                status: 401,
            }),
        );

        await expect(clerkLeasePort('sk_test_x').findUsers('test-alfa+clerk_test@radcile.com')).rejects.toThrow(
            /user lookup for test-alfa\+clerk_test@radcile\.com: 401, retry-after none, authorization_invalid/u,
        );
    });

    it('reads id, public metadata and external id for an exact address', async () => {
        clerk.getUserList.mockResolvedValue({
            data: [{ id: 'user_1', publicMetadata: { testPrincipal: true }, externalId: 'ext_1' }],
        });

        await expect(clerkLeasePort('sk_test_x').findUsers('test-alfa+clerk_test@radcile.com')).resolves.toEqual([
            { id: 'user_1', publicMetadata: { testPrincipal: true }, externalId: 'ext_1' },
        ]);
        expect(clerk.getUserList).toHaveBeenCalledWith({ emailAddress: ['test-alfa+clerk_test@radcile.com'] });
    });

    it('mints a short-lived ticket for a user id', async () => {
        clerk.createSignInToken.mockResolvedValue({ token: 'ticket_9' });

        await expect(clerkLeasePort('sk_test_x').mintTicket('user_1')).resolves.toBe('ticket_9');
        expect(clerk.createSignInToken).toHaveBeenCalledWith({ userId: 'user_1', expiresInSeconds: 60 });
    });
});

describe('clerkSessionSweepPort', () => {
    const held: SessionHandle = { ...HANDLE, sessionId: 'sess_held', email: 'test-signer+clerk_test@radcile.com' };
    const session = (id: string, status = 'active') => ({ id, status });
    const page = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, index) => session(`${prefix}${index}`));

    beforeEach(() => {
        clerk.getUserList.mockReset();
        clerk.getSessionList.mockReset();
        clerk.revokeSession.mockReset();
        clerk.getUserList.mockResolvedValue({ data: [{ id: 'user_signer' }] });
        clerk.revokeSession.mockResolvedValue({});
    });

    it('pages through every active session and revokes all of them except the held one, one at a time', async () => {
        const first = [...page('a', SESSION_PAGE_SIZE - 1), session('sess_held')];
        const second = page('b', 3);
        clerk.getSessionList.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: second });
        let inFlight = 0;
        let overlapped = false;
        clerk.revokeSession.mockImplementation(async () => {
            inFlight += 1;
            overlapped ||= inFlight > 1;
            await Promise.resolve();
            inFlight -= 1;
        });

        await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).resolves.toBe(
            SESSION_PAGE_SIZE - 1 + 3,
        );

        expect(clerk.getUserList).toHaveBeenCalledWith({ emailAddress: [held.email] });
        expect(clerk.getSessionList).toHaveBeenNthCalledWith(1, {
            userId: 'user_signer',
            status: 'active',
            limit: SESSION_PAGE_SIZE,
            offset: 0,
        });
        expect(clerk.getSessionList).toHaveBeenNthCalledWith(2, {
            userId: 'user_signer',
            status: 'active',
            limit: SESSION_PAGE_SIZE,
            offset: SESSION_PAGE_SIZE,
        });
        const revoked = clerk.revokeSession.mock.calls.map(([id]) => id as string);
        expect(revoked).toHaveLength(SESSION_PAGE_SIZE - 1 + 3);
        expect(new Set(revoked)).toEqual(
            new Set([...first, ...second].map((entry) => entry.id).filter((id) => id !== 'sess_held')),
        );
        expect(overlapped).toBe(false);
    });

    it('⛔ NEVER revokes the held session, even when it is the only one', async () => {
        clerk.getSessionList.mockResolvedValue({ data: [session('sess_held')] });

        await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).resolves.toBe(0);

        expect(clerk.revokeSession).not.toHaveBeenCalled();
    });

    it('does not revoke a session Clerk lists as anything but active, whatever the filter did', async () => {
        clerk.getSessionList.mockResolvedValue({ data: [session('s_ended', 'ended'), session('s_live')] });

        await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).resolves.toBe(1);

        expect(clerk.revokeSession.mock.calls).toEqual([['s_live']]);
    });

    it('retries a 429 on a revoke through the shared backend wrapper', async () => {
        clerk.getSessionList.mockResolvedValue({ data: [session('s_1')] });
        clerk.revokeSession
            .mockRejectedValueOnce(new ClerkAPIResponseError('', { data: [], status: 429, retryAfter: 0 }))
            .mockResolvedValueOnce({});

        await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).resolves.toBe(1);

        expect(clerk.revokeSession).toHaveBeenCalledTimes(2);
    });

    it('retries a 429 on a session listing too', async () => {
        clerk.getSessionList
            .mockRejectedValueOnce(new ClerkAPIResponseError('', { data: [], status: 429, retryAfter: 0 }))
            .mockResolvedValueOnce({ data: [session('s_1')] });

        await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).resolves.toBe(1);

        expect(clerk.getSessionList).toHaveBeenCalledTimes(2);
    });

    it('names the step and the session when a revoke is refused for good', async () => {
        clerk.getSessionList.mockResolvedValue({ data: [session('s_1')] });
        clerk.revokeSession.mockRejectedValue(
            new ClerkAPIResponseError('', {
                data: [{ code: 'authorization_invalid', message: 'nope', long_message: '', meta: {} }],
                status: 401,
            }),
        );

        await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).rejects.toThrow(
            /session revoke for s_1: 401/u,
        );
    });

    it('REFUSES an address that is not on the pool roster, before any lookup', async () => {
        await expect(
            clerkSessionSweepPort('sk_test_x').endOtherSessions({ ...held, email: 'real.person@example.com' }),
        ).rejects.toThrow();

        expect(clerk.getUserList).not.toHaveBeenCalled();
        expect(clerk.revokeSession).not.toHaveBeenCalled();
    });

    it.each([[[]], [[{ id: 'u1' }, { id: 'u2' }]]])(
        'REFUSES to sweep when the address resolves to %j users — it ends nothing',
        async (users) => {
            clerk.getUserList.mockResolvedValue({ data: users });

            await expect(clerkSessionSweepPort('sk_test_x').endOtherSessions(held)).rejects.toThrow(
                /Clerk users? hold/u,
            );

            expect(clerk.getSessionList).not.toHaveBeenCalled();
            expect(clerk.revokeSession).not.toHaveBeenCalled();
        },
    );
});
