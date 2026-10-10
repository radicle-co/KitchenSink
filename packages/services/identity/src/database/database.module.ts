import { Module, Global } from '@nestjs/common';
import { users, accounts, profiles } from '@kitchensink/identity-db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { identityPoolConfig } from './poolConfig.js';

const { Pool } = pg;

export const DrizzleProvider = 'DRIZZLE_CONNECTION';

/** The Drizzle client type provided by {@link DatabaseModule}, including the identity schema. */
export type IdentityDrizzle = ReturnType<
    typeof drizzle<{ users: typeof users; accounts: typeof accounts; profiles: typeof profiles }>
>;

@Global()
@Module({
    providers: [
        {
            provide: DrizzleProvider,
            async useFactory() {
                // The identity service's own RDS-IAM login (`identity_service`), not the master password it used
                // to connect with — see `poolConfig.ts`.
                const pool = new Pool({
                    ...identityPoolConfig(),
                    max: 20,
                    idleTimeoutMillis: 30_000,
                    connectionTimeoutMillis: 5_000,
                });

                return drizzle(pool, { schema: { users, accounts, profiles } });
            },
        },
    ],
    exports: [DrizzleProvider],
})
export class DatabaseModule {}
