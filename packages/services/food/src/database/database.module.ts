/**
 * Global Drizzle database module for `@commise/services-food`.
 *
 * Exposes a single long-lived `pg` pool wrapped by Drizzle over the `kitchensink_food`
 * logical database (plan §1). Mirrors the identity service's `DatabaseModule` provider
 * pattern: a global `@Module` exporting a {@link DrizzleProvider} injection token resolved
 * from the validated Zod env (`DATABASE_URL` or the discrete `DB_*` parts).
 *
 * @implements FR-001
 */
import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { foodPoolConfigFromEnv } from './pool-config.js';
import * as schema from '../db/schema/index.js';

const { Pool } = pg;

/** DI token for the Drizzle client (mirrors identity's `DRIZZLE_CONNECTION`). */
export const DrizzleProvider = 'FOOD_DRIZZLE_CONNECTION';

/** DI token for the raw `pg.Pool` (needed for `LISTEN/NOTIFY` and `pg_notify` enqueue). */
export const PgPoolProvider = 'FOOD_PG_POOL';

/** The Drizzle client type exported by {@link DatabaseModule}, including the food schema. */
export type FoodDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Global module providing the shared `pg.Pool` and Drizzle client to the food service.
 *
 * @sideEffect Opens a Postgres connection pool at module init.
 */
@Global()
@Module({
    providers: [
        {
            provide: PgPoolProvider,
            useFactory(): pg.Pool {
                return new Pool({
                    ...foodPoolConfigFromEnv(),
                    max: 20,
                    idleTimeoutMillis: 30_000,
                    connectionTimeoutMillis: 5_000,
                });
            },
        },
        {
            provide: DrizzleProvider,
            inject: [PgPoolProvider],
            useFactory(pool: pg.Pool): FoodDrizzle {
                return drizzle(pool, { schema });
            },
        },
    ],
    exports: [DrizzleProvider, PgPoolProvider],
})
export class DatabaseModule {}
