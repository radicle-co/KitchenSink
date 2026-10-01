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
    firstAvailableSlot,
    leaseSession,
    resolvePoolUser,
    type LeasePort,
    type PoolUserRecord,
} from '../src/leaseSession.js';
import { consumableSlots, slotFor } from '../src/testPool.js';

const clerk = vi.hoisted(() => ({ getUserList: vi.fn(), createSignInToken: vi.fn() }));

vi.mock('@clerk/backend', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@clerk/backend')>()),
    createClerkClient: () => ({
        users: { getUserList: clerk.getUserList },
        signInTokens: { createSignInToken: clerk.createSignInToken },
    }),
}));

const ORIGIN = 'https://pr-91.sandbox.commise.app';
const PUBLISHABLE_KEY = `pk_test_${Buffer.from('x.clerk.accounts.dev$').toString('base64')}`;

const provisioned = (overrides: Partial<PoolUserRecord> = {}): PoolUserRecord => ({
    id: 'user_alfa',
    publicMetadata: { testPrincipal: true, permissions: ['premium'], scopes: [] },
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
