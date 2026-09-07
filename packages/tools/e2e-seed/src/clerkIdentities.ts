/**
 * Provisioning the run's Clerk identities — creation, the premium grant, and the wait for `external_id`.
 *
 * Split out of the `provision` CLI so the CLI stays a Facade with no rules of its own, and so the one
 * genuinely subtle step here — that a token is useless until the webhook has backfilled the claim the
 * services authorize on — sits beside its own explanation.
 */
import { createClerkClient } from '@clerk/backend';
import { awaitExternalId, EXTERNAL_ID_DEADLINE_MS, EXTERNAL_ID_POLL_MS } from '@kitchensink/e2e-fixtures';

/**
 * The permission that makes a caller premium to the RECIPE SERVICE.
 *
 * ⚠️ It is read from the Clerk-signed token's `public_metadata` (`recipes.service.ts`'s
 * `PREMIUM_PERMISSION`), which is why the seeder can grant it with the secret key it already holds and
 * needs no new API. The MOBILE UI gates the same control on `account.subscriptionTier` from the identity
 * database instead — a second authority for one fact, which is a live divergence rather than a property of
 * this fixture. Granting here makes the SERVICE accept the private creates the seeded world contains.
 */
export const PREMIUM_PERMISSION = 'premium';

/** A Clerk client bound to the stage's instance. */
export type Clerk = ReturnType<typeof createClerkClient>;

/** What one provisioned identity is. */
export interface ProvisionedIdentity {
    readonly id: string;
    readonly email: string;
    readonly externalId: string;
}

/**
 * Create (or reuse) one identity, grant it what it needs, and wait for the claim the services read.
 *
 * Idempotent: a re-attempt of the same run derives a NEW run key (`GITHUB_RUN_ATTEMPT` changes), but a
 * repeated `provision` inside one attempt must not fail on Clerk's per-instance uniqueness.
 *
 * @sideEffect Creates or updates a Clerk user and polls for the webhook backfill.
 */
export async function provisionIdentity(
    clerk: Clerk,
    input: {
        readonly email: string;
        readonly username: string;
        readonly password: string;
        readonly firstName: string;
        readonly lastName: string;
        readonly premium: boolean;
    },
): Promise<ProvisionedIdentity> {
    const existing = await clerk.users.getUserList({ emailAddress: [input.email] });
    const publicMetadata = input.premium ? { permissions: [PREMIUM_PERMISSION] } : {};

    let user = existing.data[0];

    if (user === undefined) {
        // The instance requires first/last name AND a username, and enforces the username unique per
        // instance — which is why it is run-scoped too, not just the address.
        user = await clerk.users.createUser({
            emailAddress: [input.email],
            password: input.password,
            firstName: input.firstName,
            lastName: input.lastName,
            username: input.username,
            skipPasswordChecks: true,
            publicMetadata,
        });
    } else if (input.premium) {
        // A reused user may predate the grant. Set it every time rather than trusting what is there.
        user = await clerk.users.updateUser(user.id, { publicMetadata });
    }

    const userId = user.id;
    const externalId = await awaitExternalId(input.email, {
        deadlineMs: EXTERNAL_ID_DEADLINE_MS,
        pollMs: EXTERNAL_ID_POLL_MS,
        read: async () => (await clerk.users.getUser(userId)).externalId,
        now: Date.now,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });

    return { id: userId, email: input.email, externalId };
}
