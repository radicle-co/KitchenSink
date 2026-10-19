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
    describeReport,
    metadataSatisfies,
    parsePoolAdminArgs,
    planPool,
    poolProfileReassert,
    poolScopeOptions,
    poolUserCreateInput,
    laneHoldsPhase,
    reconcilePool,
    setLanePhase,
    type ObservedPoolUser,
    type PoolAdminPort,
    type PoolProfileReassert,
    type PoolUserCreate,
} from '../src/poolAdmin.js';
import {
    consumableSlots,
    DOWNGRADED_OWNER_LANE_ID,
    MAESTRO_ERASURE_SHARD,
    MAESTRO_PLATFORMS,
    maestroErasureSlots,
    POOL_PASSWORD,
    poolSlotMetadata,
    rosterSlots,
    slotFor,
    type PoolSlotMetadata,
} from '../src/testPool.js';

const clerk = vi.hoisted(() => ({
    getUserList: vi.fn(),
    createUser: vi.fn(),
    updateUserMetadata: vi.fn(),
    updateUser: vi.fn(),
}));

vi.mock('@clerk/backend', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@clerk/backend')>()),
    createClerkClient: () => ({
        users: {
            getUserList: clerk.getUserList,
            createUser: clerk.createUser,
            updateUserMetadata: clerk.updateUserMetadata,
            updateUser: clerk.updateUser,
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
    it('is satisfied by exactly the marker, roles, permissions and scopes the roster declares', () => {
        expect(metadataSatisfies({ ...poolSlotMetadata(alfa) }, poolSlotMetadata(alfa))).toBe(true);
    });

    it('ignores keys the roster does not own — a merge-PATCH leaves them alone anyway', () => {
        expect(metadataSatisfies({ ...poolSlotMetadata(alfa), unrelated: 1 }, poolSlotMetadata(alfa))).toBe(true);
    });

    // `alfa` is a premium k6 VU: roles ['premium'], no permission, no scope.
    it.each([
        ['no marker', { roles: ['premium'], permissions: [], scopes: [] }],
        ['a string marker', { testPrincipal: 'true', roles: ['premium'], permissions: [], scopes: [] }],
        ['a missing premium role', { testPrincipal: true, roles: [], permissions: [], scopes: [] }],
        ['roles absent', { testPrincipal: true, permissions: [], scopes: [] }],
        ['a different role', { testPrincipal: true, roles: ['vip'], permissions: [], scopes: [] }],
        ['a stale extra role', { testPrincipal: true, roles: ['premium', 'admin'], permissions: [], scopes: [] }],
        // The OLD grant: a user still carrying the premium permission is re-marked, which revokes it.
        [
            'the old premium permission',
            { testPrincipal: true, roles: ['premium'], permissions: ['premium'], scopes: [] },
        ],
        ['a stale scope', { testPrincipal: true, roles: ['premium'], permissions: [], scopes: ['food:admin'] }],
        ['permissions absent', { testPrincipal: true, roles: ['premium'], scopes: [] }],
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
    /**
     * A STATEFUL port: a create makes the user exist (marked, and — standing in for the identity webhook — with an
     * `external_id`), and a metadata merge changes what the next lookup sees. REWRITTEN 2026-10-08 from a static
     * fake, because `reconcilePool` now RE-OBSERVES every slot after it writes and a static fake answered that
     * re-observation with the pre-write world.
     */
    const fakePort = (
        existing: readonly ObservedPoolUser[],
        behaviour: { readonly backfills?: boolean; readonly createSticks?: boolean } = {},
    ) => {
        const users: ObservedPoolUser[] = [...existing];
        const holding = (email: string): readonly ObservedPoolUser[] =>
            users.filter((candidate) => candidate.emails.some((e) => e.toLowerCase() === email));
        const port = {
            findUsers: vi.fn(async (email: string) => holding(email)),
            listUsers: vi.fn(async () => [...users]),
            createUser: vi.fn(async (input: PoolUserCreate) => {
                const id = `created_${input.emailAddress[0] ?? ''}`;

                if (behaviour.createSticks !== false) {
                    users.push({
                        id,
                        emails: [...input.emailAddress],
                        publicMetadata: { ...input.publicMetadata },
                        externalId: behaviour.backfills === false ? null : 'ext_new',
                    });
                }

                return { id };
            }),
            mergeMetadata: vi.fn(async (userId: string, metadata: PoolSlotMetadata) => {
                const index = users.findIndex((candidate) => candidate.id === userId);
                const found = users[index];

                if (found !== undefined) {
                    users[index] = { ...found, publicMetadata: { ...found.publicMetadata, ...metadata } };
                }
            }),
            readExternalId: vi.fn(async () => 'ext_new'),
            reassertProfile: vi.fn(async (_userId: string, _profile: PoolProfileReassert) => undefined),
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

        const report = await reconcilePool(port, { ...options, slots: [alfa, signer], drift: 'audit', apply: false });

        expect(port.createUser).not.toHaveBeenCalled();
        expect(port.mergeMetadata).not.toHaveBeenCalled();
        expect(report.plan.actions.map((action) => action.kind)).toEqual(['mark', 'create']);
        expect(report.healthy).toBe(false);
    });

    it('with --apply, creates the absent, merge-marks the stale, and waits for the new users’ external_id', async () => {
        const port = fakePort([user(alfa.email)]);

        const report = await reconcilePool(port, { ...options, slots: [alfa, signer], drift: 'audit', apply: true });

        expect(port.mergeMetadata).toHaveBeenCalledWith('user_test-alfa+clerk_test', poolSlotMetadata(alfa));
        expect(port.createUser).toHaveBeenCalledTimes(1);
        expect(port.createUser).toHaveBeenCalledWith(poolUserCreateInput(signer, 'random'));
        expect(port.readExternalId).toHaveBeenCalledWith(`created_${signer.email}`);
        expect(report.unleasable).toEqual([]);
        expect(report.healthy).toBe(true);
    });

    it('is healthy and silent when every slot is already provisioned', async () => {
        const port = fakePort([marked(alfa)]);

        const report = await reconcilePool(port, { ...options, slots: [alfa], drift: 'audit', apply: true });

        expect(port.createUser).not.toHaveBeenCalled();
        expect(port.mergeMetadata).not.toHaveBeenCalled();
        expect(report.healthy).toBe(true);
    });

    it('is UNHEALTHY on drift even when every roster slot is fine, and writes nothing to the stray user', async () => {
        const stray = user('stray+clerk_test@example.com', { publicMetadata: { testPrincipal: true } });
        const port = fakePort([marked(alfa), stray]);

        const report = await reconcilePool(port, { ...options, slots: [alfa], drift: 'audit', apply: true });

        expect(report.healthy).toBe(false);
        expect(port.mergeMetadata).not.toHaveBeenCalled();
    });

    it('is UNHEALTHY on an ambiguous slot and does not write to it', async () => {
        const port = fakePort([user(alfa.email), user(alfa.email, { id: 'dup' })]);

        const report = await reconcilePool(port, { ...options, slots: [alfa], drift: 'audit', apply: true });

        expect(report.healthy).toBe(false);
        expect(port.mergeMetadata).not.toHaveBeenCalled();
        expect(port.createUser).not.toHaveBeenCalled();
    });

    it('covers the whole roster by default', async () => {
        const port = fakePort([]);

        const report = await reconcilePool(port, { ...options, drift: 'audit', apply: false });

        expect(report.plan.actions).toHaveLength(rosterSlots().length);
    });

    /**
     * ⛔ HEALTHY MEANS LEASABLE. `planPool` judges a marked, single-holder slot `ok` whatever its `external_id` — and
     * `reconcilePool` used to wait for an `external_id` only on the users it had just created. So a slot created by
     * an earlier, cancelled run whose webhook never backfilled stayed `ok` for ever while every lease of it answered
     * "no external_id". The refill exists so the next lease succeeds, so it is judged by the lease's own rule.
     */
    describe('healthy means every reconciled slot is LEASABLE, judged by re-reading it after the writes', () => {
        it('is UNHEALTHY when a pre-existing marked slot has no external_id — a dry run', async () => {
            const port = fakePort([marked(alfa, { externalId: null })]);

            const report = await reconcilePool(port, { ...options, slots: [alfa], drift: 'audit', apply: false });

            expect(report.plan.actions.map((action) => action.kind)).toEqual(['ok']);
            expect(report.unleasable).toEqual([expect.stringMatching(/external_id/u)]);
            expect(report.healthy).toBe(false);
        });

        it('is UNHEALTHY when a pre-existing marked slot has no external_id — after --apply too', async () => {
            const port = fakePort([marked(alfa, { externalId: null })]);

            const report = await reconcilePool(port, { ...options, slots: [alfa], drift: 'audit', apply: true });

            expect(report.unleasable).toEqual([expect.stringMatching(/external_id/u)]);
            expect(report.healthy).toBe(false);
        });

        it('is UNHEALTHY when a create reported success but the slot is still absent on re-read', async () => {
            const port = fakePort([], { createSticks: false });

            const report = await reconcilePool(port, { ...options, slots: [signer], drift: 'audit', apply: true });

            expect(port.createUser).toHaveBeenCalledTimes(1);
            expect(report.unleasable).toEqual([expect.stringMatching(/no Clerk user holds/u)]);
            expect(report.healthy).toBe(false);
        });

        it('re-reads the slots AFTER writing, not the snapshot it planned from', async () => {
            const port = fakePort([user(alfa.email)]);

            await reconcilePool(port, { ...options, slots: [alfa], drift: 'audit', apply: true });

            // Once to plan, once to verify.
            expect(port.findUsers).toHaveBeenCalledTimes(2);
        });

        it('names every unleasable slot in the report', () => {
            const lines = describeReport({
                plan: { actions: [{ kind: 'ok', slot: alfa, userId: 'u' }], drift: [] },
                applied: true,
                unleasable: ['test-alfa+clerk_test@radcile.com has no external_id'],
                unsettled: [],
                healthy: false,
            });

            expect(lines).toContain('UNLEASABLE test-alfa+clerk_test@radcile.com has no external_id');
            expect(lines.at(-1)).toMatch(/NOT healthy/u);
        });
    });

    /**
     * The 2026-10-08 refill: the Maestro job tops the erasure subjects up before it provisions. Its scope is the
     * whole contract of that door, so these pin it against the real roster rather than hand-picked slots.
     * REWRITTEN 2026-10-13: the scope is now (platform, shard), so each platform refills only ITS OWN five subjects.
     */
    describe.each(MAESTRO_PLATFORMS)('the Maestro erasure refill scope, %s', (platform) => {
        const scope = { kind: 'maestroErasure', platform, shard: MAESTRO_ERASURE_SHARD } as const;
        const own = maestroErasureSlots(platform, MAESTRO_ERASURE_SHARD);

        it('⛔ creates ONLY this platform’s erasure subjects, even when every other slot on the roster is absent', async () => {
            const port = fakePort([]);

            const report = await reconcilePool(port, { ...options, ...poolScopeOptions(scope), apply: true });
            const created = port.createUser.mock.calls.map(([input]) => input.emailAddress[0]);

            expect([...created].sort()).toEqual(own.map((slot) => slot.email).sort());
            expect(own).toHaveLength(5);
            expect(port.mergeMetadata).not.toHaveBeenCalled();
            expect(report.healthy).toBe(true);
        });

        it('⛔ re-marks ONLY this platform’s erasure subjects — a stale signer or the other platform’s subject is left alone', async () => {
            const stale = { publicMetadata: { testPrincipal: true } };
            const port = fakePort([
                user(signer.email, stale),
                ...consumableSlots('maestro').map((slot) => user(slot.email, stale)),
            ]);

            await reconcilePool(port, { ...options, ...poolScopeOptions(scope), apply: true });

            expect(port.mergeMetadata).toHaveBeenCalledTimes(own.length);
            expect(port.mergeMetadata).not.toHaveBeenCalledWith(`user_test-signer+clerk_test`, expect.anything());

            const touched = new Set(own.map((slot) => `user_${slot.email}`));
            const other = consumableSlots('maestro').filter((slot) => !own.some((mine) => mine.id === slot.id));

            for (const slot of other) {
                expect(touched.has(`user_${slot.email}`)).toBe(false);
                expect(port.findUsers).not.toHaveBeenCalledWith(slot.email);
            }
        });

        it('does not read the whole instance for drift, and is not failed by an unrelated stray', async () => {
            const stray = user('stray+clerk_test@example.com', { publicMetadata: { testPrincipal: true } });
            const port = fakePort([stray, ...own.map((slot) => marked(slot))]);

            const report = await reconcilePool(port, { ...options, ...poolScopeOptions(scope), apply: true });

            expect(port.listUsers).not.toHaveBeenCalled();
            expect(report.plan.drift).toEqual([]);
            expect(report.healthy).toBe(true);
        });

        it('touches nothing at all for a shard that leases no erasure subject', async () => {
            const port = fakePort([]);

            const report = await reconcilePool(port, {
                ...options,
                ...poolScopeOptions({ ...scope, shard: MAESTRO_ERASURE_SHARD + 1 }),
                apply: true,
            });

            expect(port.findUsers).not.toHaveBeenCalled();
            expect(port.createUser).not.toHaveBeenCalled();
            expect(report.plan.actions).toEqual([]);
            expect(report.healthy).toBe(true);
        });
    });
});

describe('poolScopeOptions', () => {
    it('reconciles the whole roster and audits drift for the owner’s run', () => {
        expect(poolScopeOptions({ kind: 'roster' })).toEqual({
            slots: rosterSlots(),
            drift: 'audit',
            profile: 'reassert',
        });
    });

    it.each(MAESTRO_PLATFORMS)(
        'reconciles exactly %s’s erasure subjects, and skips the instance-wide drift audit',
        (platform) => {
            expect(poolScopeOptions({ kind: 'maestroErasure', platform, shard: MAESTRO_ERASURE_SHARD })).toEqual({
                slots: maestroErasureSlots(platform, MAESTRO_ERASURE_SHARD),
                drift: 'skip',
                profile: 'leave',
            });
        },
    );
});

describe('parsePoolAdminArgs', () => {
    it('is a dry run over the whole roster with no arguments', () => {
        expect(parsePoolAdminArgs([])).toEqual({ apply: false, phase: 'seeding', scope: { kind: 'roster' } });
    });

    it('writes the whole roster with --apply alone (the owner’s run)', () => {
        expect(parsePoolAdminArgs(['--apply'])).toEqual({ apply: true, phase: 'seeding', scope: { kind: 'roster' } });
    });

    it('settles the downgraded owner only when asked: --settle-downgraded', () => {
        expect(parsePoolAdminArgs(['--apply', '--settle-downgraded'])).toEqual({
            apply: true,
            phase: 'settled',
            scope: { kind: 'roster' },
        });
    });

    it('scopes to one platform shard’s erasure subjects with --maestro-erasure --platform P --shard N', () => {
        expect(parsePoolAdminArgs(['--apply', '--maestro-erasure', '--platform', 'ios', '--shard', '2'])).toEqual({
            apply: true,
            phase: 'seeding',
            scope: { kind: 'maestroErasure', platform: 'ios', shard: 2 },
        });
        expect(parsePoolAdminArgs(['--shard', '1', '--platform', 'android', '--maestro-erasure'])).toEqual({
            apply: false,
            phase: 'seeding',
            scope: { kind: 'maestroErasure', platform: 'android', shard: 1 },
        });
    });

    it.each([
        [['--maestro-erasure', '--shard', '1'], /--platform/u],
        [['--maestro-erasure', '--platform', 'ios'], /--shard/u],
        [['--maestro-erasure'], /--platform|--shard/u],
        [['--platform', 'ios'], /--maestro-erasure/u],
        [['--shard', '1'], /--maestro-erasure/u],
        [['--maestro-erasure', '--platform', 'windows', '--shard', '1'], /platform/u],
        [['--maestro-erasure', '--platform', '', '--shard', '1'], /platform/u],
        [['--maestro-erasure', '--platform', ' ios', '--shard', '1'], /platform/u],
        [['--maestro-erasure', '--platform', 'IOS', '--shard', '1'], /platform/u],
        [['--maestro-erasure', '--platform', 'ios', '--platform', 'android', '--shard', '1'], /once/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard'], /--shard/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard', '0'], /positive integer/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard', ' 1'], /positive integer/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard', '1.5'], /positive integer/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard', '1', '--shard', '2'], /once/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard', '1', '--settle-downgraded'], /--settle-downgraded/u],
        [['--force'], /^poolAdmin: Unknown option '--force'/u],
        [['apply'], /^poolAdmin: Unexpected argument 'apply'/u],
        [['--maestro-erasure', '--platform', 'ios', '--shard', '--apply'], /--shard/u],
    ] as const)('⛔ refuses %j rather than guessing a scope', (argv, message) => {
        expect(() => parsePoolAdminArgs(argv)).toThrow(message);
    });
});

/**
 * Identity learns a Clerk username only from the `user.created` / `user.updated` webhook (owner rule: never filled on
 * read). Pool slots created before identity migration 0016 hold a Clerk username and an identity profile without
 * one, so the owner's full run re-asserts the roster's profile through Clerk, which emits the event.
 */
describe('poolProfileReassert', () => {
    it('is the username and names the roster declares for the slot — the create body’s own values', () => {
        const create = poolUserCreateInput(alfa, 'pw');

        expect(poolProfileReassert(alfa)).toEqual({
            username: create.username,
            firstName: create.firstName,
            lastName: create.lastName,
        });
    });
});

/**
 * Owner decision 2026-10-19 (plan 013 C4 / matrix G18): the Maestro co-author and the web peer sign in by password for
 * `sessionHandoff`. A co-author that ALREADY exists was created with a random password nobody holds, and `poolAdmin`
 * only ever wrote the password in the CREATE body, so a plain `--apply` would have left it unable to sign in. The
 * owner's whole-roster run therefore re-states the committed password for every slot that carries it.
 */
describe('poolProfileReassert password', () => {
    const coauthor = slotFor('maestro', 'coauthor');

    it('carries the committed password, with the checks skipped, for a slot a flow types a password for', () => {
        expect(poolProfileReassert(coauthor)).toEqual({
            ...poolProfileReassert(alfa),
            username: coauthor.username,
            lastName: coauthor.id,
            password: POOL_PASSWORD,
            skipPasswordChecks: true,
        });
    });

    it('⛔ never carries a password for a slot nothing types one for (its random password stays unknown)', () => {
        expect(Object.keys(poolProfileReassert(alfa))).toEqual(['username', 'firstName', 'lastName']);
    });

    it('is applied to an EXISTING co-author by the whole-roster run, and not to a CI refill (`leave`)', async () => {
        const existing = [marked(coauthor)];
        const reassertProfile = vi.fn(async (_userId: string, _profile: PoolProfileReassert) => undefined);
        const fake = {
            findUsers: vi.fn(async (email: string) => existing.filter((u) => u.emails.includes(email))),
            listUsers: vi.fn(async () => [...existing]),
            createUser: vi.fn(async () => ({ id: 'created' })),
            mergeMetadata: vi.fn(async () => undefined),
            readExternalId: vi.fn(async () => 'ext'),
            reassertProfile,
        } satisfies PoolAdminPort;
        const base = { randomPassword: () => 'r', now: () => 0, sleep: async () => undefined, drift: 'skip' } as const;

        await reconcilePool(fake, { ...base, slots: [coauthor], apply: true, profile: 'reassert' });

        expect(reassertProfile).toHaveBeenCalledWith(
            existing[0]?.id,
            expect.objectContaining({ password: POOL_PASSWORD }),
        );

        reassertProfile.mockClear();
        await reconcilePool(fake, { ...base, slots: [coauthor], apply: true, profile: 'leave' });

        expect(reassertProfile).not.toHaveBeenCalled();
    });
});

describe('reconcilePool profile re-assert', () => {
    const port = (existing: readonly ObservedPoolUser[]) => {
        const reassertProfile = vi.fn(async (_userId: string, _profile: PoolProfileReassert) => undefined);
        const base = {
            findUsers: vi.fn(async (email: string) =>
                existing.filter((candidate) => candidate.emails.some((e) => e.toLowerCase() === email)),
            ),
            listUsers: vi.fn(async () => [...existing]),
            createUser: vi.fn(async () => ({ id: 'created' })),
            mergeMetadata: vi.fn(async () => undefined),
            readExternalId: vi.fn(async () => 'ext'),
            reassertProfile,
        } satisfies PoolAdminPort;

        return base;
    };

    const run = { randomPassword: () => 'r', now: () => 0, sleep: async () => undefined, drift: 'skip' } as const;

    it('with --apply and profile reassert, re-asserts every existing slot — marked or stale — exactly once', async () => {
        const stale = user(signer.email);
        const fake = port([marked(alfa), stale]);

        await reconcilePool(fake, { ...run, slots: [alfa, signer], apply: true, profile: 'reassert' });

        expect(fake.reassertProfile).toHaveBeenCalledTimes(2);
        expect(fake.reassertProfile).toHaveBeenCalledWith(
            `user_${alfa.email.split('@')[0]}`,
            poolProfileReassert(alfa),
        );
        expect(fake.reassertProfile).toHaveBeenCalledWith(stale.id, poolProfileReassert(signer));
    });

    it('⛔ never asserts for an absent slot (the create carries the profile) or an ambiguous one', async () => {
        const fake = port([user(alfa.email), user(alfa.email, { id: 'dup' })]);

        await reconcilePool(fake, { ...run, slots: [alfa, signer], apply: true, profile: 'reassert' });

        expect(fake.reassertProfile).not.toHaveBeenCalled();
    });

    it('⛔ writes nothing on a dry run, and nothing when the scope leaves profiles alone', async () => {
        const dry = port([marked(alfa)]);
        const leave = port([marked(alfa)]);

        await reconcilePool(dry, { ...run, slots: [alfa], apply: false, profile: 'reassert' });
        await reconcilePool(leave, { ...run, slots: [alfa], apply: true, profile: 'leave' });

        expect(dry.reassertProfile).not.toHaveBeenCalled();
        expect(leave.reassertProfile).not.toHaveBeenCalled();
    });

    it('defaults to leaving profiles alone, so a caller that never heard of it writes nothing new', async () => {
        const fake = port([marked(alfa)]);

        await reconcilePool(fake, { ...run, slots: [alfa], apply: true });

        expect(fake.reassertProfile).not.toHaveBeenCalled();
    });
});

describe('clerkPoolAdminPort', () => {
    beforeEach(() => {
        clerk.getUserList.mockReset();
        clerk.createUser.mockReset();
        clerk.updateUserMetadata.mockReset();
        clerk.updateUser.mockReset();
    });

    it('⛔ refuses a key that is not a development instance key before building a client', () => {
        expect(() => clerkPoolAdminPort('sk_live_x')).toThrow(/development/u);
    });

    it('re-asserts a profile with updateUser, naming only username and names — never metadata', async () => {
        clerk.updateUser.mockResolvedValue({});

        await clerkPoolAdminPort('sk_test_x').reassertProfile('user_1', poolProfileReassert(alfa));

        expect(clerk.updateUser).toHaveBeenCalledWith('user_1', poolProfileReassert(alfa));
        expect(clerk.updateUserMetadata).not.toHaveBeenCalled();
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

/**
 * The DOWNGRADED OWNER (plan 2026-10-14-009 T2): a lane that owns private things yet holds no entitled role. The recipe
 * service refuses a private recipe from such a cook, so its world can only be seeded while it is `premium`, then it is
 * downgraded. The order is a pure decision of `planPool`, never prose: a plain run never downgrades and never undoes a
 * downgrade, and only `--settle-downgraded` moves the roles.
 */
describe('the downgraded owner', () => {
    const owner = slotFor('roles', DOWNGRADED_OWNER_LANE_ID);
    const asPremium = (): ObservedPoolUser =>
        user(owner.email, { publicMetadata: { ...poolSlotMetadata(owner, 'seeding') } });
    const asDefault = (): ObservedPoolUser =>
        user(owner.email, { publicMetadata: { ...poolSlotMetadata(owner, 'settled') } });

    it('is declared premium while its world is seeded and default once it is settled', () => {
        expect(poolSlotMetadata(owner, 'seeding').roles).toEqual(['premium']);
        expect(poolSlotMetadata(owner, 'settled').roles).toEqual(['default']);
    });

    it('is created premium, whatever the phase — a user created default could never be seeded', () => {
        expect(poolUserCreateInput(owner, 'random').publicMetadata.roles).toEqual(['premium']);
    });

    it('a lane with one state is the same in both phases', () => {
        expect(poolSlotMetadata(alfa, 'seeding')).toEqual(poolSlotMetadata(alfa, 'settled'));
    });

    it('⛔ while seeding, leaves the user as it finds it — premium (not yet seeded) or default (already settled)', () => {
        for (const holder of [asPremium(), asDefault()]) {
            const plan = planPool([owner], new Map([[owner.email, [holder]]]), [], 'seeding');

            expect(plan.actions, holder.publicMetadata['roles']?.toString()).toEqual([
                { kind: 'ok', slot: owner, userId: holder.id },
            ]);
        }
    });

    it('when settling, downgrades a premium user and leaves a default one alone', () => {
        expect(planPool([owner], new Map([[owner.email, [asPremium()]]]), [], 'settled').actions).toEqual([
            { kind: 'mark', slot: owner, userId: asPremium().id },
        ]);
        expect(planPool([owner], new Map([[owner.email, [asDefault()]]]), [], 'settled').actions).toEqual([
            { kind: 'ok', slot: owner, userId: asDefault().id },
        ]);
    });

    const options = { randomPassword: () => 'random', now: () => 0, sleep: async () => undefined };

    const portHolding = (holder: ObservedPoolUser) => {
        let current = holder;

        return {
            findUsers: vi.fn(async () => [current]),
            listUsers: vi.fn(async () => [current]),
            createUser: vi.fn(async () => ({ id: 'unused' })),
            mergeMetadata: vi.fn(async (_id: string, metadata: PoolSlotMetadata) => {
                current = { ...current, publicMetadata: { ...current.publicMetadata, ...metadata } };
            }),
            readExternalId: vi.fn(async () => 'ext'),
            reassertProfile: vi.fn(async () => undefined),
        } satisfies PoolAdminPort;
    };

    it('writes default roles to the premium user only when settling', async () => {
        const seeding = portHolding(asPremium());
        await reconcilePool(seeding, { ...options, slots: [owner], drift: 'skip', apply: true, phase: 'seeding' });
        expect(seeding.mergeMetadata).not.toHaveBeenCalled();

        const settling = portHolding(asPremium());
        const report = await reconcilePool(settling, {
            ...options,
            slots: [owner],
            drift: 'skip',
            apply: true,
            phase: 'settled',
        });

        expect(settling.mergeMetadata).toHaveBeenCalledWith(asPremium().id, poolSlotMetadata(owner, 'settled'));
        expect(report.healthy).toBe(true);
    });

    it('⛔ settling a user that did not exist is NOT healthy: it was created premium and is still to be seeded', async () => {
        const created: ObservedPoolUser[] = [];
        const port = {
            ...portHolding(asPremium()),
            findUsers: vi.fn(async () => created),
            createUser: vi.fn(async (input: PoolUserCreate) => {
                created.push({
                    id: 'new',
                    emails: [...input.emailAddress],
                    publicMetadata: { ...input.publicMetadata },
                    externalId: 'ext',
                });

                return { id: 'new' };
            }),
        } satisfies PoolAdminPort;

        const report = await reconcilePool(port, {
            ...options,
            slots: [owner],
            drift: 'skip',
            apply: true,
            phase: 'settled',
        });

        expect(created[0]?.publicMetadata['roles']).toEqual(['premium']);
        expect(report.unsettled).toEqual([owner.email]);
        expect(report.healthy).toBe(false);
    });
});

/**
 * One lane, one phase (2026-10-18 amendment — the CI job `downgraded-owner-world`). `reconcilePool --settle-downgraded`
 * can only ever move a lane DOWN, so a settled owner whose world was dropped could not be raised again; `setLanePhase`
 * moves exactly one lane either way. These tests hold what makes that safe: it refuses a lane with a single state, an
 * absent or ambiguous holder, and a write that did not stick.
 */
describe('setLanePhase — move one lane between its two states', () => {
    const owner = slotFor('roles', DOWNGRADED_OWNER_LANE_ID);
    const holder = (phase: 'seeding' | 'settled', id = 'user_owner'): ObservedPoolUser =>
        user(owner.email, { id, publicMetadata: { ...poolSlotMetadata(owner, phase) } });

    /** A stateful port over a list of holders; `sticks: false` makes a merge a no-op, as a lost write would be. */
    const portOver = (holders: readonly ObservedPoolUser[], sticks = true) => {
        let current = [...holders];

        return {
            findUsers: vi.fn(async () => current),
            listUsers: vi.fn(async () => current),
            createUser: vi.fn(async () => ({ id: 'unused' })),
            mergeMetadata: vi.fn(async (id: string, metadata: PoolSlotMetadata) => {
                if (sticks) {
                    current = current.map((candidate) =>
                        candidate.id === id
                            ? { ...candidate, publicMetadata: { ...candidate.publicMetadata, ...metadata } }
                            : candidate,
                    );
                }
            }),
            readExternalId: vi.fn(async () => 'ext'),
            reassertProfile: vi.fn(async () => undefined),
        } satisfies PoolAdminPort;
    };

    it('raises a settled lane to its seeding roles, which a plain run never does', async () => {
        const port = portOver([holder('settled')]);

        await setLanePhase(port, owner, 'seeding');

        expect(port.mergeMetadata).toHaveBeenCalledExactlyOnceWith('user_owner', poolSlotMetadata(owner, 'seeding'));
        expect(await laneHoldsPhase(port, owner, 'seeding')).toBe(true);
        expect(await laneHoldsPhase(port, owner, 'settled')).toBe(false);
    });

    it('settles a raised lane', async () => {
        const port = portOver([holder('seeding')]);

        await setLanePhase(port, owner, 'settled');

        expect(await laneHoldsPhase(port, owner, 'settled')).toBe(true);
    });

    it('⛔ refuses a lane that has only one state — this door exists for the downgraded owner alone', async () => {
        const port = portOver([user(alfa.email, { publicMetadata: { ...poolSlotMetadata(alfa) } })]);

        await expect(setLanePhase(port, alfa, 'seeding')).rejects.toThrow(/one state|seedRoles|downgraded/iu);
        expect(port.mergeMetadata).not.toHaveBeenCalled();
    });

    it.each([
        ['absent', [] as ObservedPoolUser[], /not provisioned|absent|no user/iu],
        ['ambiguous', [holder('settled', 'a'), holder('settled', 'b')], /more than one|ambiguous/iu],
    ])('refuses an %s holder and writes nothing', async (_name, holders, message) => {
        const port = portOver(holders);

        await expect(setLanePhase(port, owner, 'seeding')).rejects.toThrow(message);
        expect(port.mergeMetadata).not.toHaveBeenCalled();
    });

    it('⛔ fails when the write did not stick — a returned PATCH is not a held role', async () => {
        const port = portOver([holder('settled')], false);

        await expect(setLanePhase(port, owner, 'seeding')).rejects.toThrow(/did not take|does not hold/iu);
    });

    it('laneHoldsPhase is false for an absent lane rather than throwing', async () => {
        expect(await laneHoldsPhase(portOver([]), owner, 'settled')).toBe(false);
    });
});
