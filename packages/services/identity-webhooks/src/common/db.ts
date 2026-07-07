import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { accounts, profiles, users } from '@commise/services-identity/database/schema';

import { getJsonSecret } from './secrets.js';

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
type DbSecret = {
    username: string;
    password: string;
    host: string;
    port: number | string;
    dbname?: string;
    database?: string;
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
type IdentityDb = ReturnType<
    typeof drizzle<{ users: typeof users; accounts: typeof accounts; profiles: typeof profiles }>
>;

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
let pool: Pool | null = null;

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
let dbInstance: IdentityDb | null = null;

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
export const getDb = async (dbSecretArn: string) => {
    if (dbInstance) {
        return dbInstance;
    }

    const secret = (await getJsonSecret(dbSecretArn)) as unknown as DbSecret;
    const database = secret.dbname ?? secret.database;

    if (!database) {
        throw new Error(`Database secret '${dbSecretArn}' missing dbname/database`);
    }

    pool = new Pool({
        user: secret.username,
        password: secret.password,
        host: secret.host,
        port: Number(secret.port),
        database,
        ssl: process.env.STAGE === 'local' ? false : { rejectUnauthorized: false },
        max: Number(process.env.DB_POOL_MAX ?? '5'),
    });

    dbInstance = drizzle<{ users: typeof users; accounts: typeof accounts; profiles: typeof profiles }>(pool, {
        schema: {
            users,
            accounts,
            profiles,
        },
        casing: 'snake_case',
    });

    return dbInstance;
};
