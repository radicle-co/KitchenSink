import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UserId } from '../types/index.js';
import { AccountDAO, UserDAO } from '../database/dao/index.js';
import type { AccountRow, UserRow } from '@kitchensink/identity-service/database/schema';
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
            throw new NotFoundException('Account not found');
        }

        return { user, account };
    }
}
