/**
 * Global Drizzle database module for `@kitchensink/recipe-service` (T018).
 *
 * Owns a single long-lived `pg` pool wrapped by Drizzle over the shared RDS `kitchensink_recipes`
 * logical database (passwordless RDS-IAM, `recipe_app` role). Mirrors the food/identity `DatabaseModule`
 * provider pattern: a global `@Module` exporting the {@link DrizzleProvider} + {@link PgPoolProvider}
 * injection tokens. The pool config (RDS-IAM token provider) comes from `pool-config.ts`; the token+
 * factory wiring is finalized with infra (RecipeDbBootstrap custom resource) but is correct + typechecks
 * as-is.
 *
 * @sideEffect Opens a Postgres connection pool at module init.
 */
import { Global, Module } from '@nestjs/common';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from './client.js';
import { recipePoolConfigFromEnv } from './pool-config.js';

const { Pool } = pg;

/** DI token for the Drizzle client (mirrors identity's `DRIZZLE_CONNECTION`, food's `FOOD_DRIZZLE_CONNECTION`). */
export const DrizzleProvider = 'RECIPE_DRIZZLE_CONNECTION';

/** DI token for the raw `pg.Pool` (needed for advisory locks, `LISTEN/NOTIFY`, and raw SQL). */
export const PgPoolProvider = 'RECIPE_PG_POOL';

/** The Drizzle client type provided by {@link DatabaseModule}, including the recipe schema. */
export type { RecipeDrizzle };

@Global()
@Module({
    providers: [
        {
            provide: PgPoolProvider,
            useFactory(): pg.Pool {
                return new Pool({
                    ...recipePoolConfigFromEnv(),
                    max: 20,
                    idleTimeoutMillis: 30_000,
                    connectionTimeoutMillis: 5_000,
                });
            },
        },
        {
            provide: DrizzleProvider,
            inject: [PgPoolProvider],
            useFactory(pool: pg.Pool): RecipeDrizzle {
                return createRecipeDrizzle(pool);
            },
        },
    ],
    exports: [DrizzleProvider, PgPoolProvider],
})
export class DatabaseModule {}
