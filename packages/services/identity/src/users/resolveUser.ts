import {
    ForbiddenException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { UserId } from '../types/index.js';
import { AccountDAO, UserDAO } from '@kitchensink/identity-db';
import type { AccountRow, UserRow } from '@kitchensink/identity-db';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DrizzleProvider } from '../database/database.module.js';

export interface ResolvedUser {
    readonly user: UserRow;
    readonly account: AccountRow;
}

@Injectable()
export class ResolveUserService {
    private readonly userDao: UserDAO;
    private readonly accountDao: AccountDAO;

    constructor(@Inject(DrizzleProvider) db: NodePgDatabase) {
        const daoDb = db as unknown as PostgresJsDatabase<Record<string, never>>;
        this.userDao = new UserDAO(daoDb);
        this.accountDao = new AccountDAO(daoDb);
    }

    async resolveUser(sub: string): Promise<ResolvedUser> {
        const user = await this.userDao.findById(sub as UserId);

        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (user.status === 'suspended') {
            throw new ForbiddenException('User is suspended');
        }

        const account = await this.accountDao.findByUserId(sub as UserId);

        if (!account) {
            // Anomaly, not "user absent": the user exists and isn't suspended but has no account. The
            // read-through middleware heals both aux rows before any read, so reaching here means a
            // narrow TOCTOU race (e.g. a concurrent delete) or a heal that didn't land. Fail LOUD with a
            // distinct, paging Sentry signal (R5 taxonomy) carrying only the app user id — never a bare
            // 404 that reads as "user not found" and silently never alerts. The middleware self-heals on
            // the next request; this read fails closed rather than returning a half-user.
            Sentry.captureException(new Error('Account missing for an existing user'), {
                tags: { 'auth.provisioning': 'failed' },
                contexts: { auth: { appUserId: user.id, outcome: 'account_missing' } },
            });

            throw new InternalServerErrorException('Account not yet provisioned');
        }

        return { user, account };
    }
}
