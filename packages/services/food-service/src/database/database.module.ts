/**
 * Global Drizzle database module for `@kitchensink/food-service`.
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

import * as schema from '../db/schema/index.js';

const { Pool } = pg;

/** DI token for the Drizzle client (mirrors identity's `DRIZZLE_CONNECTION`). */
export const DrizzleProvider = 'FOOD_DRIZZLE_CONNECTION';

/** DI token for the raw `pg.Pool` (needed for `LISTEN/NOTIFY` and `pg_notify` enqueue). */
export const PgPoolProvider = 'FOOD_PG_POOL';

/** The Drizzle client type exported by {@link DatabaseModule}, including the food schema. */
export type FoodDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Build the Postgres connection string from the validated environment.
 *
 * Prefers `DATABASE_URL`; falls back to the discrete `DB_*` parts. The discrete path appends
 * `sslmode=require` (RDS), matching the identity service.
 *
 * @returns A `postgresql://` connection string.
 * @throws {Error} when neither `DATABASE_URL` nor a complete `DB_*` set is present.
 */
function buildConnectionString(): string {
    const url = process.env['DATABASE_URL'];

    if (url) {
        return url;
    }

    const host = process.env['DB_HOST'];
    const port = process.env['DB_PORT'];
    const database = process.env['DB_NAME'];
    const user = process.env['DB_USERNAME'];
    const password = process.env['DB_PASSWORD'];

    if (!host || !port || !database || !user || !password) {
        throw new Error(
            'Missing required database configuration. Provide DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD.',
        );
    }

    return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
}

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
                    connectionString: buildConnectionString(),
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
