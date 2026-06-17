import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { provisionCompleteUser, type Db, type ProvisionDeps } from '@kitchensink/identity-utils';

import { users, accounts, profiles } from '../database/index.js';
import { DrizzleProvider } from '../database/database.module.js';
import { SqsService } from '../queue/sqs.service.js';
import type { AuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import type { VerifiedClerkClaims } from '../auth/clerk-auth.service.js';
import { ResolveUserService } from './resolveUser.js';
import { newUserId, type UserId } from '../types/index.js';
import { createServiceLogger } from '../observability/sentry-logging.js';
import { traceAuth } from '../observability/auth-trace.js';

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

    /** Dependency bundle for the shared provisioning routine (KTD2: schema-injected, db cast per repo convention). */
    private provisionDeps(): ProvisionDeps {
        return { db: this.db as unknown as Db, schema: { users, accounts, profiles }, newUserId };
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
            { onEmailCollision: 'placeholder', emailIsReal: true },
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
        const displayName = [claims.firstName, claims.lastName].filter(Boolean).join(' ').trim();
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
                },
                { onEmailCollision: 'placeholder', emailIsReal: realEmail !== undefined },
            );

            if (result.kind !== 'complete') {
                // Unreachable under the `placeholder` policy (it always provisions a complete user);
                // kept so the type stays honest and a future policy change fails loudly here.
                throw new Error('read-through provisioning returned incomplete unexpectedly');
            }

            userRow = result.user;
            traceAuth('provision.created', {
                sub: claims.sub,
                userId: userRow.id,
                emailIsReal: realEmail !== undefined,
            });
        } else {
            userRow = found.user;
            traceAuth('provision.existing', { sub: claims.sub, userId: userRow.id });

            // Heal an incomplete existing user (missing account OR profile — the old check looked only at
            // accounts) through the same idempotent routine. Only fires when the pre-check found a gap.
            if (!found.accountId || !found.profileId) {
                await provisionCompleteUser(
                    this.provisionDeps(),
                    {
                        identityId: claims.sub,
                        email: userRow.email,
                        name: displayName || undefined,
                        displayName: displayName || undefined,
                        picture: claims.picture,
                    },
                    { onEmailCollision: 'placeholder', emailIsReal: true },
                );
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
