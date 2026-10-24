/**
 * `ensureDowngradedWorld` — the CI job that rebuilds the downgraded owner's world — over MOCKED boundaries (Clerk's
 * Backend API, the recipe service, identity), 2026-10-18.
 *
 * What a unit test of the planner cannot prove, and this does: the ORDER of the side effects (raise -> mint -> seed ->
 * settle -> mint -> verify), that a token minted before the raise is never used after it, that the owner is settled
 * whatever the seed did, and that a downgrade which did not hold fails the run.
 *
 * The doubles are STATEFUL so the order is behavioural rather than asserted on call logs alone: the Clerk double holds
 * the lane's roles; a token is minted FROM those roles at mint time (as Clerk's session claims are); identity reads
 * `paidFeatures` from the bearer's roles; and the recipe double refuses a private write unless the bearer carries
 * `premium` (`400 INVALID_VISIBILITY` on the real service). So a token cached across the raise, a seed before the
 * raise, or a settle that never ran each fail for the reason they would fail in CI.
 *
 * It does NOT prove a deployed service accepts the requests; only a deployed run does.
 */
import type { DowngradedOwnerPlan, DowngradedOwnerSnapshot } from '../src/downgradedOwnerWorld.js';
import type { PoolAdminPort, PoolUserCreate } from '@kitchensink/e2e-fixtures/poolAdmin';
import type { SessionCredential, SessionHandle } from '@kitchensink/e2e-fixtures';
import { DOWNGRADED_OWNER_LANE_ID, poolSlotMetadata, slotFor } from '@kitchensink/e2e-fixtures/testPool';
import type { PoolSlotMetadata } from '@kitchensink/e2e-fixtures/testPool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ensureDowngradedWorld,
    ensureDowngradedWorldDeps,
    type EnsureDowngradedWorldDeps,
} from '../src/ensureDowngradedWorld.js';
import { DOWNGRADED_OWNER_WORLD } from '../src/fixtureManifest.js';
import { isSignerNotEntitledError } from '../src/signerEntitlement.js';
import { isSignerStillEntitledError } from '../src/signerStillEntitledError.js';
import { memoizingTokenSource } from '../src/tokenSource.js';

const lease = vi.hoisted(() => ({ leaseSession: vi.fn() }));

vi.mock('@kitchensink/e2e-fixtures/lease', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@kitchensink/e2e-fixtures/lease')>()),
    leaseSession: lease.leaseSession,
}));

const slot = slotFor('roles', DOWNGRADED_OWNER_LANE_ID);
const handle: SessionHandle = {
    sessionId: 'sess_1',
    devJwt: 'dev',
    fapi: 'https://x.clerk.accounts.dev/v1',
    origin: 'https://pr-91.sandbox.commise.app',
    email: slot.email,
};

const standing: DowngradedOwnerSnapshot = {
    recipes: [{ id: 'r1', title: DOWNGRADED_OWNER_WORLD.recipe.title, visibility: 'private' }],
    collections: [{ id: 'c1', name: DOWNGRADED_OWNER_WORLD.collectionName, visibility: 'private' }],
};
const planned: DowngradedOwnerPlan = {
    createRecipe: true,
    deleteRecipeIds: [],
    createCollection: true,
    deleteCollectionIds: [],
};

/** Everything the run did, in order, across all four doubles. */
let events: string[];
/** The lane's roles in the Clerk double. */
let roles: readonly string[];
/** What the recipe double lists for the owner. */
let world: DowngradedOwnerSnapshot;
let logged: string[];

const rolesOf = (phase: 'seeding' | 'settled'): readonly string[] => poolSlotMetadata(slot, phase).roles;

/** A Clerk Backend API double over one user whose roles are `roles`. */
function clerkDouble(options: { readonly settleSticks?: boolean } = {}): PoolAdminPort {
    return {
        findUsers: vi.fn(async () => [
            {
                id: 'user_owner',
                emails: [slot.email],
                publicMetadata: { ...poolSlotMetadata(slot, 'seeding'), roles: [...roles] },
                externalId: 'ext',
            },
        ]),
        listUsers: vi.fn(async () => []),
        createUser: vi.fn(async (_input: PoolUserCreate) => ({ id: 'unused' })),
        mergeMetadata: vi.fn(async (_id: string, metadata: PoolSlotMetadata) => {
            const settling = metadata.roles.join() === rolesOf('settled').join();

            events.push(settling ? 'clerk:settle' : 'clerk:raise');

            if (!settling || options.settleSticks !== false) {
                roles = metadata.roles;
            }
        }),
        readExternalId: vi.fn(async () => 'ext'),
        reassertProfile: vi.fn(async () => undefined),
    };
}

/** A token is minted FROM the lane's roles at this instant, as Clerk's session claims are. */
const mint = (): SessionCredential => {
    events.push(`mint:${roles.join('+')}`);

    return { token: `roles=${roles.join('+')}`, azp: handle.origin, sub: 'user_owner' };
};

/** Identity: `paidFeatures` is derived from the bearer's roles, and nothing else. */
const identityFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const bearer = new Headers(init?.headers).get('authorization') ?? '';
    const entitled = bearer.includes('premium');

    events.push(`identity:${entitled ? 'granted' : 'hidden'}`);

    return new Response(JSON.stringify({ account: { paidFeatures: entitled ? 'granted' : 'hidden' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}) as unknown as typeof globalThis.fetch;

function deps(admin: PoolAdminPort, overrides: Partial<EnsureDowngradedWorldDeps> = {}): EnsureDowngradedWorldDeps {
    return {
        slot,
        admin,
        signIn: vi.fn(async () => {
            events.push('signIn');

            return handle;
        }),
        tokenSource: (held) => memoizingTokenSource(held, { remint: async () => mint() }),
        readSnapshot: vi.fn(async (token) => {
            events.push(`read:${await token()}`);

            return world;
        }),
        seedWorld: vi.fn(async (token) => {
            const bearer = await token();

            events.push(`seed:${bearer}`);

            // The recipe service's rule: a private row only for an entitled caller.
            if (!bearer.includes('premium')) {
                throw new Error('400 INVALID_VISIBILITY');
            }

            world = standing;

            return planned;
        }),
        identity: { origin: 'https://identity.sandbox.commise.app', entitlement: { fetch: identityFetch } },
        log: (line) => logged.push(line),
        ...overrides,
    };
}

beforeEach(() => {
    events = [];
    logged = [];
    roles = rolesOf('settled');
    world = { recipes: [], collections: [] };
    lease.leaseSession.mockReset();
    vi.mocked(identityFetch).mockClear();
});

describe('ensureDowngradedWorld — the common path leaves the owner alone', () => {
    it('⛔ READY: a standing world and a settled owner raise nothing, seed nothing, and still verify the downgrade', async () => {
        world = standing;
        const admin = clerkDouble();

        await expect(ensureDowngradedWorld(deps(admin))).resolves.toBe('ready');

        expect(admin.mergeMetadata).not.toHaveBeenCalled();
        expect(events).toEqual(['signIn', 'mint:default', 'read:roles=default', 'mint:default', 'identity:hidden']);
    });

    it('SETTLE ONLY: a standing world with an owner left raised settles it and writes no row', async () => {
        world = standing;
        roles = rolesOf('seeding');
        const admin = clerkDouble();
        const run = deps(admin);

        await expect(ensureDowngradedWorld(run)).resolves.toBe('settleOnly');

        expect(run.seedWorld).not.toHaveBeenCalled();
        expect(admin.mergeMetadata).toHaveBeenCalledExactlyOnceWith('user_owner', poolSlotMetadata(slot, 'settled'));
        expect(roles).toEqual(rolesOf('settled'));
        expect(events.at(-1)).toBe('identity:hidden');
    });
});

describe('ensureDowngradedWorld — a missing world is rebuilt in the one order that works', () => {
    it('⛔ RESEED: raise -> a FRESH token -> entitlement -> seed -> settle -> a FRESH token -> verify', async () => {
        const admin = clerkDouble();

        await expect(ensureDowngradedWorld(deps(admin))).resolves.toBe('reseed');

        expect(events).toEqual([
            'signIn',
            'mint:default',
            'read:roles=default',
            'clerk:raise',
            // The token that proves the raise is minted AFTER it: one cached from the read above would still say default.
            'mint:premium',
            'identity:granted',
            'seed:roles=premium',
            'clerk:settle',
            'mint:default',
            'identity:hidden',
        ]);
        expect(roles).toEqual(rolesOf('settled'));
        expect(world).toEqual(standing);
    });

    it('⛔ a seed that fails still settles the owner, and the failure is the one that surfaces', async () => {
        const admin = clerkDouble();
        const failure = new Error('recipe service answered 503');
        const run = deps(admin, {
            seedWorld: vi.fn(async () => {
                events.push('seed:fails');
                throw failure;
            }),
        });

        await expect(ensureDowngradedWorld(run)).rejects.toBe(failure);

        expect(roles).toEqual(rolesOf('settled'));
        expect(events.slice(-2)).toEqual(['seed:fails', 'clerk:settle']);
    });

    it('⛔ an owner that is not entitled after the raise stops before any write — and is settled again', async () => {
        const admin = clerkDouble();
        const run = deps(admin, {
            tokenSource: (held) =>
                memoizingTokenSource(held, {
                    // A stale claim set: the raise never reached the token.
                    remint: async () => ({ token: 'roles=default', azp: handle.origin, sub: 'user_owner' }),
                }),
        });

        const failure = await ensureDowngradedWorld(run).catch((error: unknown) => error);

        expect(isSignerNotEntitledError(failure)).toBe(true);
        expect(run.seedWorld).not.toHaveBeenCalled();
        expect(roles).toEqual(rolesOf('settled'));
    });

    it('⛔ a settle that fails is reported with ::error:: and fails the run, even when the seed succeeded', async () => {
        const admin = clerkDouble({ settleSticks: false });

        const failure = await ensureDowngradedWorld(deps(admin)).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(String((failure as Error).message)).toMatch(/does not hold its settled roles/u);
        expect(logged.some((line) => line.startsWith('::error::') && /PREMIUM/u.test(line))).toBe(true);
    });

    it('⛔ a settle that fails after a seed failure does not hide the seed failure', async () => {
        const admin = clerkDouble({ settleSticks: false });
        const failure = new Error('recipe service answered 503');
        const run = deps(admin, {
            seedWorld: vi.fn(async () => {
                throw failure;
            }),
        });

        await expect(ensureDowngradedWorld(run)).rejects.toBe(failure);

        expect(logged.some((line) => line.startsWith('::error::') && /PREMIUM/u.test(line))).toBe(true);
    });
});

describe('ensureDowngradedWorld — the downgrade must have held', () => {
    it('⛔ fails loudly when identity still calls the owner entitled after the settle', async () => {
        world = standing;
        // Every mint says premium: the settle reached Clerk's metadata but not the claims a token carries.
        const stale = deps(clerkDouble(), {
            tokenSource: (held) =>
                memoizingTokenSource(held, {
                    remint: async () => ({ token: 'roles=premium', azp: handle.origin, sub: 'user_owner' }),
                }),
        });

        const failure = await ensureDowngradedWorld(stale).catch((error: unknown) => error);

        expect(isSignerStillEntitledError(failure)).toBe(true);
        expect(String((failure as Error).message)).toContain(slot.email);
    });
});

describe('ensureDowngradedWorldDeps — the Clerk key is judged before anything is signed in', () => {
    const environment = {
        clerkSecretKey: 'sk_live_not_a_development_key',
        clerkPublishableKey: 'pk_test_x',
        recipeOrigin: 'https://recipe-pr-91.commise.app',
        webOrigin: 'https://pr-91.sandbox.commise.app',
    };

    it('⛔ refuses a non-development key and never leases a session', () => {
        expect(() => ensureDowngradedWorldDeps(environment, 'https://identity.sandbox.commise.app')).toThrow(
            /development instance key/u,
        );
        expect(lease.leaseSession).not.toHaveBeenCalled();
    });

    it('accepts a development key without touching Clerk (nothing is signed in until the run starts)', () => {
        expect(() =>
            ensureDowngradedWorldDeps(
                { ...environment, clerkSecretKey: 'sk_test_ok' },
                'https://identity.sandbox.commise.app',
            ),
        ).not.toThrow();
        expect(lease.leaseSession).not.toHaveBeenCalled();
    });
});
