/**
 * `poolAdmin` — the ONLY place test tooling creates a Clerk user or writes `public_metadata`.
 *
 * Asserted over an injected port, never against Clerk: the owner runs provisioning, and a test that reached a
 * real instance would be the very write this command exists to confine. What matters is the DECISION — which
 * slots are created, which are re-marked, what counts as drift — and that a dry run writes nothing at all.
 */
import { ClerkAPIResponseError } from '@clerk/backend/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clerkPoolAdminPort,
    metadataSatisfies,
    planPool,
    poolUserCreateInput,
    reconcilePool,
    type ObservedPoolUser,
    type PoolAdminPort,
} from '../src/poolAdmin.js';
import { POOL_PASSWORD, poolSlotMetadata, rosterSlots, slotFor } from '../src/testPool.js';

const clerk = vi.hoisted(() => ({ getUserList: vi.fn(), createUser: vi.fn(), updateUserMetadata: vi.fn() }));

vi.mock('@clerk/backend', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@clerk/backend')>()),
    createClerkClient: () => ({
        users: {
            getUserList: clerk.getUserList,
            createUser: clerk.createUser,
            updateUserMetadata: clerk.updateUserMetadata,
        },
    }),
}));

const alfa = slotFor('k6', 'alfa');
const signer = slotFor('maestro', 'signer');

const user = (email: string, overrides: Partial<ObservedPoolUser> = {}): ObservedPoolUser => ({
    id: `user_${email.split('@')[0] ?? ''}`,
    emails: [email],
    publicMetadata: {},
    externalId: 'ext',
    ...overrides,
});

const marked = (slot: typeof alfa, overrides: Partial<ObservedPoolUser> = {}): ObservedPoolUser =>
    user(slot.email, { publicMetadata: { ...poolSlotMetadata(slot) }, ...overrides });

describe('metadataSatisfies', () => {
    it('is satisfied by exactly the marker, permissions and scopes the roster declares', () => {
        expect(metadataSatisfies({ ...poolSlotMetadata(alfa) }, poolSlotMetadata(alfa))).toBe(true);
    });

    it('ignores keys the roster does not own — a merge-PATCH leaves them alone anyway', () => {
        expect(metadataSatisfies({ ...poolSlotMetadata(alfa), unrelated: 1 }, poolSlotMetadata(alfa))).toBe(true);
    });

    it.each([
        ['no marker', { permissions: ['premium'], scopes: [] }],
        ['a string marker', { testPrincipal: 'true', permissions: ['premium'], scopes: [] }],
        ['a missing premium grant', { testPrincipal: true, permissions: [], scopes: [] }],
        ['a stale extra grant', { testPrincipal: true, permissions: ['premium', 'admin'], scopes: [] }],
        ['a stale scope', { testPrincipal: true, permissions: ['premium'], scopes: ['food:admin'] }],
        ['permissions absent', { testPrincipal: true, scopes: [] }],
    ])('is NOT satisfied by %s', (_, actual) => {
        expect(metadataSatisfies(actual, poolSlotMetadata(alfa))).toBe(false);
    });
});

describe('planPool', () => {
    it('creates a slot nobody holds, re-marks one whose metadata is stale, and leaves a correct one alone', () => {
        const bravo = slotFor('k6', 'bravo');
        const plan = planPool(
            [alfa, bravo, signer],
            new Map([
                [alfa.email, []],
                [bravo.email, [user(bravo.email, { publicMetadata: { testPrincipal: true } })]],
                [signer.email, [marked(signer)]],
            ]),
            [],
        );

        expect(plan.actions).toEqual([
            { kind: 'create', slot: alfa },
            { kind: 'mark', slot: bravo, userId: `user_test-bravo+clerk_test` },
            { kind: 'ok', slot: signer, userId: `user_test-signer+clerk_test` },
        ]);
    });

    it('reports an address two users hold as ambiguous and never writes to either', () => {
        const plan = planPool([alfa], new Map([[alfa.email, [marked(alfa), marked(alfa, { id: 'dup' })]]]), []);

        expect(plan.actions).toEqual([
            { kind: 'ambiguous', slot: alfa, userIds: ['user_test-alfa+clerk_test', 'dup'] },
        ]);
    });

    it('treats a slot the lookup never answered as absent, not as correct', () => {
        expect(planPool([alfa], new Map(), []).actions).toEqual([{ kind: 'create', slot: alfa }]);
    });

    it('flags DRIFT: a marked user holding no roster address — the red alarm', () => {
        const stray = user('someone+clerk_test@example.com', { publicMetadata: { testPrincipal: true } });
        const plan = planPool([alfa], new Map([[alfa.email, [marked(alfa)]]]), [marked(alfa), stray]);

        expect(plan.drift).toEqual([{ id: stray.id, emails: stray.emails }]);
    });

    it('does not flag an unmarked user, or a marked user on the roster, as drift', () => {
        const plan = planPool([alfa], new Map([[alfa.email, [marked(alfa)]]]), [
            marked(alfa),
            user('person@example.com'),
            user('x@example.com', { publicMetadata: { testPrincipal: 1 } }),
        ]);

        expect(plan.drift).toEqual([]);
    });

    it('matches a roster address case-insensitively when judging drift', () => {
        const shouted = marked(alfa, { emails: [alfa.email.toUpperCase()] });

        expect(planPool([alfa], new Map([[alfa.email, [shouted]]]), [shouted]).drift).toEqual([]);
    });
});

describe('poolUserCreateInput', () => {
    it('creates a password-typed slot with the password the flows type, and the marker in the same call', () => {
        expect(poolUserCreateInput(signer, 'random')).toEqual({
            emailAddress: [signer.email],
            username: signer.username,
            password: POOL_PASSWORD,
            firstName: 'Test',
            lastName: 'signer',
            skipPasswordChecks: true,
            publicMetadata: poolSlotMetadata(signer),
        });
    });

    it('gives a ticket-only slot the random password it is handed, never the committed one', () => {
        expect(poolUserCreateInput(alfa, 'random-xyz').password).toBe('random-xyz');
    });
});

describe('reconcilePool', () => {
    const fakePort = (existing: readonly ObservedPoolUser[]) => {
        const port = {
            findUsers: vi.fn(async (email: string) =>
                existing.filter((candidate) => candidate.emails.some((e) => e.toLowerCase() === email)),
            ),
            listUsers: vi.fn(async () => existing),
            createUser: vi.fn(async (input: { emailAddress: readonly string[] }) => ({
                id: `created_${input.emailAddress[0] ?? ''}`,
            })),
            mergeMetadata: vi.fn(async () => undefined),
            readExternalId: vi.fn(async () => 'ext_new'),
        } satisfies PoolAdminPort;

        return port;
    };

    const options = {
        randomPassword: () => 'random',
        now: () => 0,
        sleep: async () => undefined,
    };

    it('⛔ a DRY RUN writes nothing — no create, no metadata write — and still reports the plan', async () => {
        const port = fakePort([user(alfa.email)]);

        const report = await reconcilePool(port, { ...options, slots: [alfa, signer], apply: false });

        expect(port.createUser).not.toHaveBeenCalled();
        expect(port.mergeMetadata).not.toHaveBeenCalled();
        expect(report.plan.actions.map((action) => action.kind)).toEqual(['mark', 'create']);
        expect(report.healthy).toBe(false);
    });

    it('with --apply, creates the absent, merge-marks the stale, and waits for the new users’ external_id', async () => {
        const port = fakePort([user(alfa.email)]);

        const report = await reconcilePool(port, { ...options, slots: [alfa, signer], apply: true });

        expect(port.mergeMetadata).toHaveBeenCalledWith('user_test-alfa+clerk_test', poolSlotMetadata(alfa));
        expect(port.createUser).toHaveBeenCalledTimes(1);
        expect(port.createUser).toHaveBeenCalledWith(poolUserCreateInput(signer, 'random'));
        expect(port.readExternalId).toHaveBeenCalledWith(`created_${signer.email}`);
        expect(report.healthy).toBe(true);
    });

    it('is healthy and silent when every slot is already provisioned', async () => {
        const port = fakePort([marked(alfa)]);

        const report = await reconcilePool(port, { ...options, slots: [alfa], apply: true });

        expect(port.createUser).not.toHaveBeenCalled();
        expect(port.mergeMetadata).not.toHaveBeenCalled();
        expect(report.healthy).toBe(true);
    });

    it('is UNHEALTHY on drift even when every roster slot is fine, and writes nothing to the stray user', async () => {
        const stray = user('stray+clerk_test@example.com', { publicMetadata: { testPrincipal: true } });
        const port = fakePort([marked(alfa), stray]);

        const report = await reconcilePool(port, { ...options, slots: [alfa], apply: true });

        expect(report.healthy).toBe(false);
        expect(port.mergeMetadata).not.toHaveBeenCalled();
    });

    it('is UNHEALTHY on an ambiguous slot and does not write to it', async () => {
        const port = fakePort([user(alfa.email), user(alfa.email, { id: 'dup' })]);

        const report = await reconcilePool(port, { ...options, slots: [alfa], apply: true });

        expect(report.healthy).toBe(false);
        expect(port.mergeMetadata).not.toHaveBeenCalled();
        expect(port.createUser).not.toHaveBeenCalled();
    });

    it('covers the whole roster by default', async () => {
        const port = fakePort([]);

        const report = await reconcilePool(port, { ...options, apply: false });

        expect(report.plan.actions).toHaveLength(rosterSlots().length);
    });
});

describe('clerkPoolAdminPort', () => {
    beforeEach(() => {
        clerk.getUserList.mockReset();
        clerk.createUser.mockReset();
        clerk.updateUserMetadata.mockReset();
    });

    it('⛔ refuses a key that is not a development instance key before building a client', () => {
        expect(() => clerkPoolAdminPort('sk_live_x')).toThrow(/development/u);
    });

    it('writes metadata with the MERGE endpoint, never updateUser (which replaces)', async () => {
        clerk.updateUserMetadata.mockResolvedValue({});

        await clerkPoolAdminPort('sk_test_x').mergeMetadata('user_1', poolSlotMetadata(alfa));

        expect(clerk.updateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: poolSlotMetadata(alfa) });
    });

    /**
     * Measured 2026-09-14 on the sandbox development instance: `--apply` died on a `429` carrying `retryAfter: 2`
     * after p-retry's three quick retries, a few creates in. The Backend API limit is instance-wide, so a one-off
     * reconciliation must wait out what Clerk asks for rather than give up.
     */
    describe('rides out the instance-wide Backend API rate limit', () => {
        const tooManyRequests = (retryAfter?: number) =>
            new ClerkAPIResponseError('Too Many Requests', { data: [], status: 429, retryAfter });

        it('waits the retry-after Clerk states, then succeeds', async () => {
            const sleep = vi.fn().mockResolvedValue(undefined);
            clerk.createUser
                .mockRejectedValueOnce(tooManyRequests(2))
                .mockRejectedValueOnce(tooManyRequests(3))
                .mockResolvedValueOnce({ id: 'user_new' });

            const port = clerkPoolAdminPort('sk_test_x', { sleep });
            const created = await port.createUser(poolUserCreateInput(alfa, 'pw'));

            expect(created).toEqual({ id: 'user_new' });
            expect(sleep.mock.calls).toEqual([[2000], [3000]]);
        });

        it('keeps trying through a sustained limit longer than three quick retries', async () => {
            const sleep = vi.fn().mockResolvedValue(undefined);

            for (let attempt = 0; attempt < 6; attempt += 1) {
                clerk.createUser.mockRejectedValueOnce(tooManyRequests());
            }

            clerk.createUser.mockResolvedValueOnce({ id: 'user_late' });

            await expect(
                clerkPoolAdminPort('sk_test_x', { sleep }).createUser(poolUserCreateInput(alfa, 'pw')),
            ).resolves.toEqual({ id: 'user_late' });
            expect(sleep.mock.calls).toEqual([[2000], [4000], [8000], [16000], [30000], [30000]]);
        });

        it('gives up after twelve retries — thirteen consecutive 429s reject', async () => {
            const sleep = vi.fn().mockResolvedValue(undefined);
            clerk.createUser.mockRejectedValue(tooManyRequests());

            await expect(
                clerkPoolAdminPort('sk_test_x', { sleep }).createUser(poolUserCreateInput(alfa, 'pw')),
            ).rejects.toMatchObject({ status: 429 });
            expect(clerk.createUser).toHaveBeenCalledTimes(13);
        });

        it('does not retry an error that is not a rate limit', async () => {
            const sleep = vi.fn().mockResolvedValue(undefined);
            clerk.createUser.mockRejectedValueOnce(
                new ClerkAPIResponseError('Unprocessable', { data: [], status: 422 }),
            );

            await expect(
                clerkPoolAdminPort('sk_test_x', { sleep }).createUser(poolUserCreateInput(alfa, 'pw')),
            ).rejects.toMatchObject({ status: 422 });
            expect(clerk.createUser).toHaveBeenCalledTimes(1);
            expect(sleep).not.toHaveBeenCalled();
        });
    });

    it('pages through every user when listing for drift', async () => {
        const page = (count: number, offset: number) =>
            Array.from({ length: count }, (_, index) => ({
                id: `u${offset + index}`,
                emailAddresses: [{ emailAddress: `u${offset + index}@example.com` }],
                publicMetadata: {},
                externalId: null,
            }));

        clerk.getUserList
            .mockResolvedValueOnce({ data: page(100, 0), totalCount: 150 })
            .mockResolvedValueOnce({ data: page(50, 100), totalCount: 150 });

        const users = await clerkPoolAdminPort('sk_test_x').listUsers();

        expect(users).toHaveLength(150);
        expect(clerk.getUserList).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
    });
});
