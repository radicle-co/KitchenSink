import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';

import { users, accounts, profiles } from '../database/index.js';
import { DrizzleProvider } from '../database/database.module.js';
import { SqsService } from '../queue/sqs.service.js';
import type { AuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import type { VerifiedClerkClaims } from '../auth/clerk-auth.service.js';
import { ResolveUserService } from './resolveUser.js';
import { newUserId, type UserId } from '../types/index.js';
import { createServiceLogger } from '../observability/sentry-logging.js';

/** Postgres unique-violation (23505) on a specific named constraint/index. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === '23505' &&
        (err as { constraint?: unknown }).constraint === constraint
    );
}

/** Per-identity, never-deliverable placeholder for users whose Clerk token carries no email claim. */
function placeholderEmail(sub: string): string {
    return `${sub}@no-email.invalid`;
}

@Injectable()
export class UsersService {
    private readonly logger = createServiceLogger(UsersService.name);

    constructor(
        @Inject(DrizzleProvider) private readonly db: NodePgDatabase,
        private readonly sqs: SqsService,
        private readonly resolver: ResolveUserService,
    ) {}

    async upsertUser(
        _ctx: AuthorizerContext,
        input: { identityId: string; email: string; name?: string; picture?: string },
    ): Promise<{ id: string; created: boolean }> {
        const { id, created } = await this.upsertUserRecord(input);

        return { id, created };
    }

    /**
     * Idempotently upsert a user (keyed on the Clerk identity id) and, on first creation, the
     * companion account + profile rows. Shared by the explicit `/v1/users/upsert` endpoint and the
     * read-through auth path. Idempotency is anchored on the `users.identityId` unique constraint,
     * so concurrent callers (webhook + read-through) converge on a single row set.
     */
    private async upsertUserRecord(
        input: {
            identityId: string;
            email: string;
            name?: string;
            picture?: string;
        },
        // The read-through path may synthesize a placeholder email when the token carries no email
        // claim. `emailIsReal: false` means "do NOT overwrite an existing email on conflict" — so a
        // concurrent user.created webhook that already wrote the real email is never clobbered with the
        // placeholder. The explicit /upsert endpoint and the webhook always pass real emails (default).
        opts: { emailIsReal?: boolean } = {},
    ): Promise<{ id: string; created: boolean; row: typeof users.$inferSelect }> {
        const emailIsReal = opts.emailIsReal ?? true;
        const now = new Date();
        const id = newUserId();

        // User + account + profile creation is atomic: a partial row set (user without account) would
        // 404 getUserMe until the next read-through/webhook heals it. The transaction also rolls back
        // cleanly if the email-unique insert collides, leaving the placeholder-retry a clean slate.
        return this.db.transaction(async (tx) => {
            const [row] = await tx
                .insert(users)
                .values({
                    id,
                    identityId: input.identityId,
                    email: input.email,
                    name: input.name ?? null,
                    picture: input.picture ?? null,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: users.identityId,
                    set: {
                        // Never let a read-through placeholder/empty clobber a real value a concurrent
                        // webhook may have just written: overwrite email only when it's real, and
                        // COALESCE name/picture so a null incoming keeps the existing value.
                        ...(emailIsReal ? { email: input.email } : {}),
                        name: sql`coalesce(${input.name ?? null}, ${users.name})`,
                        picture: sql`coalesce(${input.picture ?? null}, ${users.picture})`,
                        updatedAt: now,
                    },
                })
                .returning();

            const created = row.createdAt.getTime() === row.updatedAt.getTime();

            if (created) {
                await tx.insert(accounts).values({ userId: row.id }).onConflictDoNothing();
                await tx
                    .insert(profiles)
                    .values({ userId: row.id, displayName: input.name ?? '' })
                    .onConflictDoNothing();
            }

            return { id: row.id, created, row };
        });
    }

    /** Idempotently ensure a user's account + profile rows exist. No-op when already present. */
    private async ensureAccountAndProfile(userId: string, displayName: string): Promise<void> {
        await this.db.insert(accounts).values({ userId }).onConflictDoNothing();
        await this.db.insert(profiles).values({ userId, displayName }).onConflictDoNothing();
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
        const displayName = [claims.firstName, claims.lastName].filter(Boolean).join(' ').trim();

        const [existing] = await this.db.select().from(users).where(eq(users.identityId, claims.sub)).limit(1);

        let userRow: typeof users.$inferSelect;

        if (!existing) {
            // Create the user + account + profile on first sight. Use the row returned by the upsert
            // directly (no re-read): correct even when a concurrent webhook won the insert, since the
            // identity_id ON CONFLICT clause returns the surviving row.
            //
            // `users.email` is NOT NULL UNIQUE. When the token carries no email claim (instance not
            // customized), use a per-identity placeholder so two emailless users don't collide on the
            // unique index. `.invalid` is reserved (RFC 2606), never deliverable; the webhook backfills.
            const realEmail = claims.email;

            try {
                const { row } = await this.upsertUserRecord(
                    {
                        identityId: claims.sub,
                        email: realEmail ?? placeholderEmail(claims.sub),
                        name: displayName || undefined,
                        picture: claims.picture,
                    },
                    { emailIsReal: realEmail !== undefined },
                );
                userRow = row;
            } catch (err) {
                // The user's real email already belongs to a DIFFERENT Clerk identity (Clerk permits
                // shared emails — delete+recreate, social link). Provisioning runs in AuthMiddleware on
                // every request, so a raw unique-violation would 500 and HARD-LOCK the user out of every
                // route. Provision with the per-identity placeholder instead and let the webhook
                // reconcile; the placeholder is keyed on `sub`, so it can only conflict on identityId
                // (handled by the upsert), never on the email index.
                if (realEmail !== undefined && isUniqueViolation(err, 'users_email_unique')) {
                    this.logger.warn('Email already in use by another identity; provisioning with placeholder', {
                        sub: claims.sub,
                    });
                    const { row } = await this.upsertUserRecord(
                        {
                            identityId: claims.sub,
                            email: placeholderEmail(claims.sub),
                            name: displayName || undefined,
                            picture: claims.picture,
                        },
                        { emailIsReal: false },
                    );
                    userRow = row;
                } else {
                    throw err;
                }
            }
        } else {
            userRow = existing;
            // Heal legacy/partial records (e.g. a webhook-first user created before the account
            // backstop existed): ensure account + profile without an unconditional per-request write.
            const [account] = await this.db.select().from(accounts).where(eq(accounts.userId, userRow.id)).limit(1);

            if (!account) {
                await this.ensureAccountAndProfile(userRow.id, displayName);
            }
        }

        return {
            userId: userRow.id as UserId,
            email: userRow.email,
            clerkUserId: claims.sub,
            // Authorization grants come from the Clerk-signed token (admin-set public_metadata),
            // not from any client-suppliable header. Empty when the token grants nothing.
            scopes: claims.scopes ?? [],
            permissions: claims.permissions ?? [],
            tokenType: 'user',
        };
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
                createdAt: user.createdAt.toISOString(),
                updatedAt: user.updatedAt.toISOString(),
            },
            account: {
                id: account.id,
                userId: account.userId,
                subscriptionTier: account.subscriptionTier,
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

        const now = new Date();

        if (input.displayName !== undefined || input.avatarUrl !== undefined) {
            await this.db
                .update(profiles)
                .set({
                    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
                    ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
                    updatedAt: now,
                })
                .where(eq(profiles.userId, userId));
        }

        const [updatedProfile] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
        const [updatedAccount] = await this.db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);

        return {
            user: {
                id: existing.id,
                email: existing.email,
                status: existing.status,
                displayName: updatedProfile?.displayName ?? '',
                avatarUrl: updatedProfile?.avatarUrl ?? null,
                createdAt: existing.createdAt.toISOString(),
                updatedAt: now.toISOString(),
            },
            account: {
                id: updatedAccount?.id,
                userId: updatedAccount?.userId,
                subscriptionTier: updatedAccount?.subscriptionTier ?? 'free',
                createdAt: updatedAccount?.createdAt.toISOString(),
                updatedAt: updatedAccount?.updatedAt.toISOString(),
            },
        };
    }

    async deleteUserMe(ctx: AuthorizerContext) {
        const userId = ctx.userId;
        const clerkUserId = ctx.clerkUserId;

        const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!existing) {
            throw new NotFoundException('User not found');
        }

        const deletedAt = new Date();

        await this.db.transaction(async (tx) => {
            await tx.delete(accounts).where(eq(accounts.userId, userId));
            await tx.delete(profiles).where(eq(profiles.userId, userId));
            await tx.delete(users).where(eq(users.id, userId));
        });

        try {
            await this.sqs.enqueueDeletion(clerkUserId, userId, 'user-initiated');
        } catch (err) {
            this.logger.warn('Failed to enqueue deletion', { userId, error: String(err) });
        }

        return {
            sub: userId,
            deletedAt: deletedAt.toISOString(),
            message: 'Account deletion initiated',
        };
    }
}
