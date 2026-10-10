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
import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { FOOD_API_POOL_MIN, createFoodApiPool, prewarmPool } from './apiPool.js';
import { foodPoolConfigFromEnv } from './poolConfig.js';
import * as schema from '../db/schema/index.js';

/** DI token for the Drizzle client (mirrors identity's `DRIZZLE_CONNECTION`). */
export const DrizzleProvider = 'FOOD_DRIZZLE_CONNECTION';

/** DI token for the raw `pg.Pool` (needed for `LISTEN/NOTIFY` and `pg_notify` enqueue). */
export const PgPoolProvider = 'FOOD_PG_POOL';

/** The Drizzle client type exported by {@link DatabaseModule}, including the food schema. */
export type FoodDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Global module providing the shared `pg.Pool` and Drizzle client to the food service.
 *
 * @sideEffect Opens a Postgres connection pool at module init, and its floor of connections in the background.
 */
@Global()
@Module({
    providers: [
        {
            provide: PgPoolProvider,
            useFactory(): pg.Pool {
                const logger = new Logger('FoodPgPool');
                const pool = createFoodApiPool(foodPoolConfigFromEnv(), logger);

                // Not awaited: boot does not wait on the database, and the prewarm never rejects.
                void prewarmPool(pool, FOOD_API_POOL_MIN, logger);

                return pool;
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
export class DatabaseModule implements OnModuleDestroy {
    public constructor(@Inject(PgPoolProvider) private readonly pool: pg.Pool) {}

    /**
     * Close the pool with the app. The floor keeps connections open however long they are idle, so without this an
     * app closed inside a live process (a LOCAL e2e suite) would leave them open until the process exits.
     *
     * @sideEffect Closes every pooled connection.
     */
    public async onModuleDestroy(): Promise<void> {
        await this.pool.end();
    }
}
