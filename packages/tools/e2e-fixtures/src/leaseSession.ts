/**
 * Lease a slot of the fixed test pool: find the ONE Clerk user the roster names, refuse it unless `poolAdmin`
 * has provisioned it, and sign in as it.
 *
 * ## Why every refusal happens before the sign-in
 *
 * A ticket is a live credential for whoever it names. `establishSession` already refuses an address that is not
 * on the roster; this adds the two facts only Clerk can answer — that the user carries the
 * `public_metadata.testPrincipal` marker `poolAdmin` writes, and that the webhook has given it the
 * `external_id` every service authorizes on. A slot failing either is a pool nobody provisioned, and the fix
 * is an owner run of `poolAdmin --apply`, never a user created by the test run (owner ruling 2026-09-13: "We
 * should have a pool of test users for clerk so that we don't need to create ones").
 *
 * The marker is not only a tooling check: the services read the same `public_metadata.testPrincipal` claim as an
 * authorization input (ADR-0040) — containment on an enforcing stage, and the self-purge `resetPool` issues — so a
 * slot leased without it would be refused that purge and fail its reset.
 *
 * @pattern Facade over `clerkSession.ts`'s `establishSession` — resolution, the provisioning checks, then the sign-in
 * @pattern Port — `LeasePort`, with `clerkLeasePort` as the Clerk Backend API adapter, so every rule is testable without Clerk
 */
import { createClerkClient } from '@clerk/backend';

import {
    BACKEND_MAX_WAIT_SECONDS,
    BACKEND_RETRIES,
    describeClerkBackendFailure,
    establishSession,
    TICKET_LIFETIME_SECONDS,
    withClerkBackendRetry,
    type SessionHandle,
} from './clerkSession.js';
import { assertPoolMember, type PoolSlot } from './testPool.js';

/** A Clerk user reduced to the facts a lease decides on. */
export interface PoolUserRecord {
    readonly id: string;
    readonly publicMetadata: Readonly<Record<string, unknown>>;
    readonly externalId: string | null;
}

/** What a lease needs from Clerk's Backend API. */
export interface LeasePort {
    /** Every user holding exactly this address. */
    readonly findUsers: (email: string) => Promise<readonly PoolUserRecord[]>;
    /** A single-use sign-in ticket for a user id. */
    readonly mintTicket: (userId: string) => Promise<string>;
}

/** A signed-in slot. */
export interface LeasedSession {
    readonly slot: PoolSlot;
    readonly userId: string;
    readonly handle: SessionHandle;
}

/** Why a resolution failed, as data, so {@link firstAvailableSlot} can tell "consumed" from "broken". */
type Resolution = { readonly user: PoolUserRecord } | { readonly refusal: string; readonly absent: boolean };

/** Decide whether the users holding a slot's address make a leasable slot. Pure. */
function judge(slot: PoolSlot, users: readonly PoolUserRecord[]): Resolution {
    const [user, ...others] = users;

    if (user === undefined) {
        return {
            refusal: `no Clerk user holds pool slot ${slot.tier}/${slot.id} (${slot.email}) — run poolAdmin --apply`,
            absent: true,
        };
    }

    if (others.length > 0) {
        return {
            refusal: `${users.length} Clerk users hold pool slot ${slot.tier}/${slot.id} (${slot.email})`,
            absent: false,
        };
    }

    // Strictly `=== true`: a marker written as a string or a number is not one `poolAdmin` wrote.
    if (user.publicMetadata['testPrincipal'] !== true) {
        return {
            refusal: `${slot.email} is not marked as a test principal — run poolAdmin --apply before leasing it`,
            absent: false,
        };
    }

    if (user.externalId === null || user.externalId === '') {
        return {
            refusal:
                `${slot.email} has no external_id, so every service call would answer 401 — the identity webhook ` +
                'has not backfilled it; poolAdmin --apply waits for that',
            absent: false,
        };
    }

    return { user };
}

/**
 * The one provisioned Clerk user behind a slot, or a refusal naming what to run.
 *
 * @sideEffect One Backend API lookup.
 */
export async function resolvePoolUser(slot: PoolSlot, port: LeasePort): Promise<PoolUserRecord> {
    assertPoolMember(slot.email);

    const verdict = judge(slot, await port.findUsers(slot.email));

    if ('refusal' in verdict) {
        throw new Error(verdict.refusal);
    }

    return verdict.user;
}

/**
 * Resolve, check, then sign in.
 *
 * @sideEffect A Backend API lookup, a ticket mint, and a throttled Frontend API sign-in (see `establishSession`).
 */
export async function leaseSession(input: {
    readonly slot: PoolSlot;
    readonly publishableKey: string;
    readonly origin: string;
    readonly port: LeasePort;
    readonly establish?: typeof establishSession;
}): Promise<LeasedSession> {
    const user = await resolvePoolUser(input.slot, input.port);
    const establish = input.establish ?? establishSession;
    const handle = await establish({
        email: input.slot.email,
        publishableKey: input.publishableKey,
        origin: input.origin,
        // The ticket is minted for the id resolved above, not re-looked-up by address.
        mintTicket: () => input.port.mintTicket(user.id),
    });

    return { slot: input.slot, userId: user.id, handle };
}

/**
 * The first slot, in declared order, whose user still exists and is provisioned.
 *
 * For CONSUMABLE slots — a real erasure destroys its subject — so a consumed slot is skipped rather than
 * failing the run. A slot that exists but fails a provisioning check is skipped too: leasing it would fail
 * later and opaquely.
 *
 * ⛔ Every slot consumed is an ERROR, never "nothing to lease". A tier that silently skipped its erasure flow
 * would report green over a story it never ran.
 *
 * @sideEffect One Backend API lookup per slot inspected.
 */
export async function firstAvailableSlot(
    slots: readonly PoolSlot[],
    port: LeasePort,
): Promise<{ readonly slot: PoolSlot; readonly user: PoolUserRecord }> {
    if (slots.length === 0) {
        throw new Error('test pool: no slots to lease from');
    }

    const refusals: string[] = [];
    let consumed = 0;

    for (const slot of slots) {
        assertPoolMember(slot.email);

        const verdict = judge(slot, await port.findUsers(slot.email));

        if (!('refusal' in verdict)) {
            return { slot, user: verdict.user };
        }

        consumed += verdict.absent ? 1 : 0;
        refusals.push(verdict.refusal);
    }

    throw new Error(
        consumed === slots.length
            ? `test pool: all ${slots.length} consumable slots are consumed — replenish them with poolAdmin --apply`
            : `test pool: none of ${slots.length} slots is leasable:\n  ${refusals.join('\n  ')}`,
    );
}

/**
 * The {@link LeasePort} over Clerk's Backend API. A 429 is retried — that limit is instance-wide and recovers in
 * seconds — and anything else is final.
 *
 * @sideEffect The returned port calls the Clerk Backend API.
 */
export function clerkLeasePort(secretKey: string): LeasePort {
    const clerk = createClerkClient({ secretKey });

    const backend = async <T>(step: string, identity: string, call: () => Promise<T>): Promise<T> => {
        try {
            return await withClerkBackendRetry(call, {
                retries: BACKEND_RETRIES,
                maxWaitSeconds: BACKEND_MAX_WAIT_SECONDS,
            });
        } catch (error) {
            throw describeClerkBackendFailure(step, identity, error);
        }
    };

    return {
        findUsers: async (email) => {
            const { data } = await backend('user lookup', email, () =>
                clerk.users.getUserList({ emailAddress: [email] }),
            );

            return data.map((user) => ({
                id: user.id,
                publicMetadata: user.publicMetadata,
                externalId: user.externalId,
            }));
        },
        mintTicket: async (userId) => {
            const { token } = await backend('sign-in ticket mint', userId, () =>
                clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: TICKET_LIFETIME_SECONDS }),
            );

            return token;
        },
    };
}
