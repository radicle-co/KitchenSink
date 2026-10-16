import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { provisionCompleteUser, type CreatedByline, type Db, type ProvisionDeps } from '@kitchensink/identity-utils';
import { computeProfileScrub, deriveDisplayName, parseUsername, type BylineSnapshot } from '@kitchensink/identity-core';
import { eraseIdentityRow, newProfileClock, profileClock, UserDAO } from '@kitchensink/identity-db';

import { HANDLE_SYNC_PUBLISHER, publishOwedByline, type HandleSyncPublisher } from './handleSync.publisher.js';
import { AVATAR_OBJECT_STORE, type AvatarObjectStore } from './avatarObjectStore.js';

import { accounts, lifecycleEvents, profiles, users } from '@kitchensink/identity-db';
import { DrizzleProvider } from '../database/database.module.js';
import { SqsService } from '../queue/sqs.service.js';
import { paidFeatureAccess } from './domain/paidFeatureAccess.js';
import { PAID_FEATURES_GATE } from './paidFeaturesGate.provider.js';
import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import type { VerifiedClerkClaims } from '../auth/clerkAuth.service.js';
import { ResolveUserService } from './resolveUser.js';
import { newUserId, type UserId } from '../types/index.js';
import { createServiceLogger } from '@kitchensink/service-logging';
import { traceAuth } from '../observability/authTrace.js';
import { reportDeletionEnqueueFailure } from '../queue/deletionEnqueue.error.js';
import { resolveTestPrincipalContainment } from '../config/env.schema.js';
import { evaluateTestPrincipalContainment, type ContainedAction } from './domain/testPrincipalContainment.js';

/** Per-identity, never-deliverable placeholder for users whose Clerk token carries no email claim. */
function placeholderEmail(sub: string): string {
    return `${sub}@no-email.invalid`;
}

/**
 * Refuse a lifecycle action the test-principal containment Specification denies (ADR-0040).
 *
 * Called FIRST by each contained action — before any database read, S3 call or queue message — because the
 * damage it prevents (a banned or deleted Clerk pool member) is done by the side effects, not by the response.
 * The mode is read at call time and fails closed (see `resolveTestPrincipalContainment`).
 *
 * @param ctx - The verified caller.
 * @param action - The lifecycle action being attempted.
 * @throws ForbiddenException carrying `code: 'TEST_PRINCIPAL_CONTAINED'` in identity's error envelope.
 * @sideEffect Reads `process.env['TEST_PRINCIPAL_CONTAINMENT']`.
 */
function assertNotContained(ctx: AuthorizerContext, action: ContainedAction): void {
    const decision = evaluateTestPrincipalContainment({
        testPrincipal: ctx.testPrincipal,
        containment: resolveTestPrincipalContainment(process.env['TEST_PRINCIPAL_CONTAINMENT']),
        action,
    });

    if (!decision.allowed) {
        throw new ForbiddenException({ code: decision.code, message: decision.reason });
    }
}

@Injectable()
export class UsersService {
    private readonly logger = createServiceLogger(UsersService.name);

    constructor(
        @Inject(DrizzleProvider) private readonly db: NodePgDatabase,
        private readonly sqs: SqsService,
        private readonly resolver: ResolveUserService,
        @Inject(HANDLE_SYNC_PUBLISHER) private readonly handleSync: HandleSyncPublisher,
        @Inject(AVATAR_OBJECT_STORE) private readonly avatarStore: AvatarObjectStore,
        @Inject(PAID_FEATURES_GATE) private readonly paidFeaturesGate: boolean,
    ) {}

    /** Dependency bundle for the shared provisioning routine (KTD2: schema-injected, db cast per repo convention). */
    private provisionDeps(): ProvisionDeps {
        return { db: this.db as unknown as Db, schema: { users, accounts, profiles }, newUserId, newProfileClock };
    }

    async upsertUser(
        _ctx: AuthorizerContext,
        input: { identityId: string; email: string; name?: string; picture?: string },
    ): Promise<{ id: string; created: boolean }> {
        const result = await provisionCompleteUser<typeof users.$inferSelect>(
            this.provisionDeps(),
            {
                identityId: input.identityId,
                email: input.email,
                name: input.name,
                displayName: input.name,
                picture: input.picture,
            },
            // Publishes nothing, so it owes nothing: a debt no caller settles is a sync the backstop reports as LOST.
            { onEmailCollision: 'placeholder', owesCreatedByline: false, emailIsReal: true },
        );

        if (result.kind !== 'complete') {
            throw new Error('upsertUser: provisioning returned incomplete unexpectedly');
        }

        const { user } = result;

        return { id: user.id, created: user.createdAt.getTime() === user.updatedAt.getTime() };
    }

    /**
     * Read-through resolution for an authenticated Clerk session: map the verified token's Clerk
     * identity id (`sub`) to the app user, creating the user + account + profile on first sight so
     * the response never depends on the `user.created` webhook having arrived. Returns the
     * `AuthorizerContext` the rest of the request pipeline expects.
     *
     * @sideEffect creates user/account/profile rows on first request for a new identity.
     */
    async resolveOrCreateFromClaims(claims: VerifiedClerkClaims): Promise<AuthorizerContext> {
        // The ONE display-name rule (W8-a.2 / decision 6), shared with the recipe write-time handle fallback
        // via @kitchensink/identity-core — so both services derive the "@handle" identically, no divergence.
        const displayName = deriveDisplayName(claims);
        // The public byline (owner ruling 2026-10-13). A claim the boundary refuses is dropped, never stored.
        const username = parseUsername(claims.username);
        const realEmail = claims.email;

        // One query: fetch the user AND whether its account + profile already exist (the hot-path
        // completeness pre-check — a complete user takes a single SELECT and no write on every
        // authenticated request; only an incomplete/new user pays for provisioning).
        const [found] = await this.db
            .select({ user: users, accountId: accounts.id, profileId: profiles.id })
            .from(users)
            .leftJoin(accounts, eq(accounts.userId, users.id))
            .leftJoin(profiles, eq(profiles.userId, users.id))
            .where(eq(users.identityId, claims.sub))
            .limit(1);

        let userRow: typeof users.$inferSelect;
        // The byline a profile insert created on THIS request, if any — published once, after the row is settled.
        let createdByline: CreatedByline | undefined;

        if (!found) {
            // Create through the shared routine. `users.email` is NOT NULL: when the token carries no
            // email claim, pass a per-identity placeholder (`emailIsReal: false`). When a real email
            // already belongs to a DIFFERENT identity, the routine's `placeholder` policy re-provisions
            // with the placeholder rather than 500ing (provisioning runs on every authenticated request).
            const result = await provisionCompleteUser<typeof users.$inferSelect>(
                this.provisionDeps(),
                {
                    identityId: claims.sub,
                    email: realEmail ?? placeholderEmail(claims.sub),
                    name: displayName || undefined,
                    displayName: displayName || undefined,
                    picture: claims.picture,
                    username,
                },
                { onEmailCollision: 'placeholder', owesCreatedByline: true, emailIsReal: realEmail !== undefined },
            );

            if (result.kind !== 'complete') {
                // Unreachable under the `placeholder` policy (it always provisions a complete user);
                // kept so the type stays honest and a future policy change fails loudly here.
                throw new Error('read-through provisioning returned incomplete unexpectedly');
            }

            userRow = result.user;
            createdByline = result.createdByline;
            traceAuth('provision.created', {
                sub: claims.sub,
                userId: userRow.id,
                emailIsReal: realEmail !== undefined,
            });
        } else {
            userRow = found.user;
            traceAuth('provision.existing', { sub: claims.sub, userId: userRow.id });

            // A CLOSED (tombstoned) or ERASED account MUST NOT be granted an authorizer context — deny
            // before any heal or context build. Defense-in-depth alongside the Clerk ban/delete, which is
            // async (deletion-worker) and networkless-verified here, so an already-issued, still-valid
            // session token would otherwise pass. Recovery is admin-mediated reactivation, never a
            // self-service sign-in. (Mirrors resolveUser's status gate.)
            if (userRow.status === 'tombstoned' || userRow.status === 'erased') {
                throw new ForbiddenException('Account is closed');
            }

            // Heal an incomplete existing user (missing account OR profile — the old check looked only at
            // accounts) through the same idempotent routine. Only fires when the pre-check found a gap.
            if (!found.accountId || !found.profileId) {
                const healed = await provisionCompleteUser(
                    this.provisionDeps(),
                    {
                        identityId: claims.sub,
                        email: userRow.email,
                        name: displayName || undefined,
                        displayName: displayName || undefined,
                        picture: claims.picture,
                        username,
                    },
                    { onEmailCollision: 'placeholder', owesCreatedByline: true, emailIsReal: true },
                );

                if (healed.kind === 'complete') {
                    createdByline = healed.createdByline;
                }
            }
        }

        const userId = userRow.id;

        await this.publishByline(userId, createdByline);

        return {
            userId,
            email: userRow.email,
            clerkUserId: claims.sub,
            // Authorization grants come from the Clerk-signed token (admin-set public_metadata),
            // not from any client-suppliable header. Empty when the token grants nothing.
            scopes: claims.scopes ?? [],
            permissions: claims.permissions ?? [],
            // The verified roles (`public_metadata.roles`); the paid-features answer is derived from them.
            roles: claims.roles,
            tokenType: 'user',
            // ADR-0040: carried from the signed claim so the lifecycle actions can contain a test-pool member.
            testPrincipal: claims.testPrincipal,
        };
    }

    /**
     * Publish a byline this service's write created or changed, and settle the debt that write recorded (plan
     * 2026-10-15-010 D6b/D6c). Best-effort: a failed fan-out must not fail the sign-in or the rename it follows; the
     * owed marker is the backstop's record of it.
     *
     * @param userId - The app-user ULID.
     * @param byline - The snapshot with the stamp its write returned, or `undefined` when nothing is owed.
     * @sideEffect Publishes to the handle-sync topic; updates `profiles`.
     */
    private async publishByline(
        userId: UserId,
        byline: (BylineSnapshot & { readonly stampedAt: Date }) | undefined,
    ): Promise<void> {
        if (byline === undefined) {
            return;
        }

        const sync = await publishOwedByline(
            this.handleSync,
            (owner, owedAt, code) => new UserDAO(this.db).settleHandleSync(owner, owedAt, code),
            userId,
            byline,
        );

        if (sync.outcome === 'owed') {
            this.logger.error('handle-sync publish failed (the write it follows still succeeded)', {
                userId,
                error: sync.error,
                settleError: sync.settleError,
            });
        }
    }

    async getUserMe(ctx: AuthorizerContext) {
        const userId = ctx.userId;
        const { user, account } = await this.resolver.resolveUser(userId);
        const [profile] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);

        return {
            user: {
                id: user.id,
                email: user.email,
                status: user.status,
                displayName: profile?.displayName ?? '',
                avatarUrl: profile?.avatarUrl ?? null,
                username: profile?.username ?? null,
                createdAt: user.createdAt.toISOString(),
                updatedAt: user.updatedAt.toISOString(),
            },
            account: {
                id: account.id,
                userId: account.userId,
                // ⛔ DERIVED per request from the verified roles and this stage's gate (`paidFeatureAccess`), never
                // read from `accounts.subscription_tier`, which nothing writes. Clients render from this alone.
                paidFeatures: paidFeatureAccess({ roles: ctx.roles, gate: this.paidFeaturesGate }),
                createdAt: account.createdAt.toISOString(),
                updatedAt: account.updatedAt.toISOString(),
            },
        };
    }

    async patchUserMe(ctx: AuthorizerContext, input: { displayName?: string; avatarUrl?: string | null }) {
        const userId = ctx.userId;

        const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!existing) {
            throw new NotFoundException('User not found');
        }

        const renamed = input.displayName !== undefined;
        // The profile as THIS statement left it. ⛔ `RETURNING`, not a read-back: a second statement could see a
        // concurrent webhook's later write, and the snapshot published below must be exactly the state this write's
        // stamp keys (plan 2026-10-15-010 D6).
        const [updatedProfile] =
            input.displayName !== undefined || input.avatarUrl !== undefined
                ? await this.db
                      .update(profiles)
                      .set({
                          // Trimmed: one name has one stored form, and the consumer would trim it anyway.
                          ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
                          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
                          // ⛔ U9/R21: the OWED MARKER moves with the name, in this one statement and on the
                          // database's clock (`profileClock`). The publish below happens after the commit and is
                          // best-effort, so without the marker a failed fan-out left nothing behind.
                          //
                          // ⚠️ Only on a NAME change: an avatar edit changes no byline, so it owes nothing.
                          ...(renamed ? { handleSyncOwedAt: profileClock, handleSyncFailureCode: null } : {}),
                          updatedAt: profileClock,
                      })
                      .where(eq(profiles.userId, userId))
                      .returning()
                : await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
        const [updatedAccount] = await this.db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);

        // Handle-sync (W8-a.2): a rename publishes the byline snapshot — the new display name AND the Clerk username
        // the row already holds — keyed by the stamp the write returned. Best-effort: a failed publish must NOT fail
        // the rename; the owed marker is the backstop's record of it.
        if (renamed && updatedProfile !== undefined) {
            await this.publishByline(userId, {
                displayName: updatedProfile.displayName,
                username: updatedProfile.username,
                stampedAt: updatedProfile.updatedAt,
            });
        }

        return {
            user: {
                id: existing.id,
                email: existing.email,
                status: existing.status,
                displayName: updatedProfile?.displayName ?? '',
                avatarUrl: updatedProfile?.avatarUrl ?? null,
                username: updatedProfile?.username ?? null,
                createdAt: existing.createdAt.toISOString(),
                updatedAt: (updatedProfile?.updatedAt ?? existing.updatedAt).toISOString(),
            },
            account: {
                id: updatedAccount?.id,
                userId: updatedAccount?.userId,
                paidFeatures: paidFeatureAccess({ roles: ctx.roles, gate: this.paidFeaturesGate }),
                createdAt: updatedAccount?.createdAt.toISOString(),
                updatedAt: updatedAccount?.updatedAt.toISOString(),
            },
        };
    }

    /**
     * Account CLOSURE (CR-002 U2, the app's "close account" action) — a RECOVERABLE tombstone, NOT erasure.
     *
     * Applies the closure field-scrub (Specification A): the users row is UPDATEd (never hard-deleted — R1) to
     * `status='tombstoned'` with a ULID-keyed placeholder email and a nulled avatar mirror; the companion rows
     * are KEPT (only the profile avatar is scrubbed) so an admin-mediated `unbanUser` recovery restores the
     * display name. The R8 audit row is written in the SAME transaction. The avatar S3 object is deleted
     * best-effort (S3 is not transactional), and the Clerk BAN is handed to the deletion-worker via a `closure`
     * queue message — this service holds no Clerk secret (public ALB), so it never calls Clerk directly.
     *
     * ⛔ A TEST PRINCIPAL is refused under `TEST_PRINCIPAL_CONTAINMENT=enforce` (ADR-0040) before anything is read —
     * the ban would disable a shared Clerk test-pool member.
     *
     * @throws ForbiddenException (`TEST_PRINCIPAL_CONTAINED`) when containment refuses the caller.
     * @sideEffect tombstones the user, writes an audit row, deletes the avatar S3 object, and enqueues a ban.
     */
    async deleteUserMe(ctx: AuthorizerContext) {
        assertNotContained(ctx, 'closeAccount');

        const userId = ctx.userId;
        const clerkUserId = ctx.clerkUserId;

        const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!existing) {
            throw new NotFoundException('User not found');
        }

        const now = new Date();
        const directive = computeProfileScrub('closure', userId);

        // Lock the users row FIRST (the UPDATE), then touch the profile — matching provisionCompleteUser's
        // lock order so a delete racing a concurrent provision of the same identity can't deadlock (d59e11c).
        await this.db.transaction(async (tx) => {
            await tx
                .update(users)
                .set({
                    ...directive.userColumns,
                    deletedAt: now,
                    updatedAt: now,
                    // ⛔ U10/R26: the INTENT advances with the status, in this transaction. The Clerk ban is
                    // handed to the deletion worker and the queue is unordered, so the worker must be able
                    // to tell "this is the newest thing the database wants" from "this is an old message
                    // that outlived its intent" — which it cannot do from the event name alone.
                    statusVersion: sql`${users.statusVersion} + 1`,
                })
                .where(eq(users.id, userId));

            // Closure keeps the companion rows (displayName survives for recovery); scrub only the avatar.
            if (directive.profileScrub) {
                await tx
                    .update(profiles)
                    .set({ ...directive.profileScrub, updatedAt: now })
                    .where(eq(profiles.userId, userId));
            }

            // R8: append-only audit row, written in the SAME transaction as the state change (trigger = the
            // user's own self-service close action).
            await tx.insert(lifecycleEvents).values({
                userId,
                event: 'closure',
                triggerSource: 'user',
                actor: userId,
                occurredAt: now,
            });
        });

        // Best-effort avatar S3 delete: a failed delete leaves an orphaned object (no DB link) but must NEVER
        // block closure — the DB tombstone above is already the source of truth.
        if (directive.removeAvatarObject) {
            try {
                await this.avatarStore.deleteAllForUser(userId);
            } catch (err) {
                this.logger.warn('closure: avatar S3 delete failed (row already scrubbed)', {
                    userId,
                    error: String(err),
                });
            }
        }

        // Hand the durable, reversible Clerk BAN to the deletion-worker (the only holder of the Clerk secret).
        //
        // ⛔ NOT BEST-EFFORT, AND NOT A `warn`. The tombstone above is committed, so a failure here leaves the
        // database saying "closed" while Clerk keeps the session alive and keeps minting JWTs for the account
        // the user just closed. It is reported through the ONE paging path in `deletionEnqueue.error.ts` — see
        // that module for why the state is left divergent-but-loud rather than rolled back (the audit row is
        // append-only, so a retry of closure would write a second one) and for the sweep that should converge it.
        try {
            await this.sqs.enqueueDeletion({ identityId: clerkUserId, userId, event: 'closure' });
        } catch (err) {
            reportDeletionEnqueueFailure({ event: 'closure', userId, identityId: clerkUserId, error: err });
        }

        return {
            sub: userId,
            deletedAt: now.toISOString(),
            message: 'Account closure initiated',
        };
    }

    /**
     * Account ERASURE (plan U2) — the IRREVERSIBLE sibling of {@link deleteUserMe}'s recoverable closure.
     *
     * ⛔ **Why this exists.** The app's "erase my data" control called the RECIPE service and nothing else,
     * so an erasure destroyed the user's recipes and left the identity row, the Clerk account, the avatar
     * object and food's requester rows all intact — the user could sign straight back in to an account they
     * had been told was destroyed. Recipe cannot close that gap from its side: it does not own the user and
     * holds no Clerk secret. Identity owns the user, so the account-level erasure is initiated here.
     *
     * **What this method does NOT do, and must not.** It does not call Clerk. This service sits behind a
     * public ALB and holds no Clerk secret — the same reason closure hands its BAN to the deletion-worker —
     * so the Clerk `deleteUser` is the worker's job, driven by the message enqueued below. Every downstream
     * effect of an erasure (Clerk account deleted, recipe erased, food's requester rows dropped) hangs off
     * that one message, which is why a failure to enqueue PAGES rather than warns.
     *
     * **Ordering, and the window it leaves.** The scrub commits before the Clerk identity is deleted, so
     * between the two a token minted earlier still verifies. That window is closed by the scrub itself:
     * `status='erased'` brings the row under the R10 anti-resurrection guard, so the token resolves to an
     * erased user rather than read-through-creating a fresh one. The inverse order is not available to us —
     * it would require the Clerk secret this service deliberately does not have.
     *
     * Idempotent: an already-erased user is a no-op that writes no second audit row (R9, append-only) and
     * re-enqueues nothing.
     *
     * @param ctx - The verified caller. The owner is taken from the token, never from a body.
     * @returns The erasure acknowledgement (`202`-shaped; the work is asynchronous).
     * ⛔ A TEST PRINCIPAL is refused under `TEST_PRINCIPAL_CONTAINMENT=enforce` (ADR-0040) before anything is read —
     * the Clerk delete, plus R10 anti-resurrection, would make a shared test-pool member unusable forever.
     *
     * @throws ForbiddenException (`TEST_PRINCIPAL_CONTAINED`) when containment refuses the caller.
     * @throws NotFoundException when no such user exists.
     * @sideEffect Erases the identity row, deletes the avatar object, and enqueues the erasure event.
     */
    async eraseUserMe(ctx: AuthorizerContext) {
        assertNotContained(ctx, 'eraseAccount');

        const userId = ctx.userId;
        const clerkUserId = ctx.clerkUserId;

        const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!existing) {
            throw new NotFoundException('User not found');
        }

        const now = new Date();

        if (existing.status === 'erased') {
            // R9: the audit log is append-only, so a retry, a double-tap, or the reconciliation sweep
            // re-driving this must not manufacture a second erasure event for one erasure. Nothing is
            // re-enqueued either — the original message is already in flight or already processed.
            this.logger.log('erasure: already-erased user, no-op', { userId });

            return { sub: userId, erasedAt: now.toISOString(), message: 'Account erasure already completed' };
        }

        // ONE definition of "erased" for all three callers (this, the tombstone-sweep, the user.deleted
        // webhook) — the field-scrub, the companion-row purge and the R8 audit row, in one transaction.
        // `providerDeletedAt: null` — this service holds no Clerk secret, so the provider deletion is OWED; the
        // deletion worker the message below wakes confirms it, and erasure reconciliation re-enqueues until it does.
        await eraseIdentityRow(this.db, { userId, triggerSource: 'user', actor: userId, providerDeletedAt: null }, now);

        // The row is already scrubbed and S3 is not transactional, so a failed object delete cannot roll the
        // erasure back — but it leaves a real photograph of a user who asked to be erased, with no DB row
        // pointing at it and therefore nothing to find it by later. That is an ERROR, not the `warn` closure
        // uses for its recoverable tombstone.
        try {
            await this.avatarStore.deleteAllForUser(userId);
        } catch (err) {
            this.logger.error('erasure: avatar S3 delete FAILED — orphaned object for an erased user', {
                userId,
                error: String(err),
            });
        }

        // ⛔ NOT BEST-EFFORT. Identity has scrubbed its own row, so the database says "erased" — but the
        // Clerk account still exists and both downstream services still hold the user's data. All of that is
        // destroyed by the worker this message wakes. Swallowing a failure here produces a user who was told
        // their data was erased while their account still signs in, with nothing recorded anywhere.
        try {
            await this.sqs.enqueueDeletion({ identityId: clerkUserId, userId, event: 'erasure' });
        } catch (err) {
            reportDeletionEnqueueFailure({ event: 'erasure', userId, identityId: clerkUserId, error: err });
        }

        return { sub: userId, erasedAt: now.toISOString(), message: 'Account erasure initiated' };
    }
}
