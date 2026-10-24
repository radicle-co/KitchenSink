import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { BASE_RECIPE_DATABASE_NAME } from '@kitchensink/recipe-core/database-name';

import { databaseConnectionSchema } from '../../config/config.types.js';
import { recipePoolConfigFromEnv } from '../poolConfig.js';

/**
 * The env schema VALIDATES the `DB_*` parts and the pool builder READS them, separately: neither hands the other
 * its result. So the database and role each falls back to when `DB_NAME` / `DB_USERNAME` are unset must be one
 * fact, or a service started without `DB_NAME` validates against one database and connects to another.
 */
describe('recipePoolConfigFromEnv defaults', () => {
    const saved = { ...process.env };

    beforeEach(() => {
        for (const key of ['DATABASE_URL', 'DB_NAME', 'DB_USERNAME']) {
            Reflect.deleteProperty(process.env, key);
        }

        process.env['DB_HOST'] = 'db.internal';
        process.env['DB_PORT'] = '5432';
    });

    afterEach(() => {
        process.env = { ...saved };
    });

    it('connects to the database and role the env schema defaults to', () => {
        const parsed = databaseConnectionSchema.parse({ DB_HOST: 'db.internal' });
        const pool = recipePoolConfigFromEnv();

        expect('DB_NAME' in parsed ? parsed.DB_NAME : undefined).toBe(BASE_RECIPE_DATABASE_NAME);
        expect('DB_USERNAME' in parsed ? parsed.DB_USERNAME : undefined).toBe(DATABASE_ROLES.recipe.app);
        expect(pool.database).toBe(BASE_RECIPE_DATABASE_NAME);
        expect(pool.user).toBe(DATABASE_ROLES.recipe.app);
    });
});
