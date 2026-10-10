/**
 * The food database both pipeline functions connect to, read from the environment the schema stack gives each of them
 * (curated catalog plan U3). The migration runner and the seed function are handed the same three variables from the
 * same `foodDatabaseName`, so they read them through one function.
 */
import { describe, expect, it } from 'vitest';

import { readFoodDbTarget } from '../foodDbTarget.js';

const ENV = { FOOD_DB_ENDPOINT: 'db.example.internal', FOOD_DB_PORT: '5432', FOOD_DB_NAME: 'kitchensink_food_pr_7' };

describe('readFoodDbTarget', () => {
    it('reads the host, the port as a number, and the database', () => {
        expect(readFoodDbTarget(ENV)).toStrictEqual({
            host: 'db.example.internal',
            port: 5432,
            database: 'kitchensink_food_pr_7',
        });
    });

    it.each(['FOOD_DB_ENDPOINT', 'FOOD_DB_PORT', 'FOOD_DB_NAME'])('⛔ refuses a missing %s, naming it', (name) => {
        expect(() => readFoodDbTarget({ ...ENV, [name]: undefined })).toThrow(
            `Missing required environment variable: ${name}`,
        );
        expect(() => readFoodDbTarget({ ...ENV, [name]: '' })).toThrow(name);
    });

    it.each(['abc', '5432\n', '0', '65536', '54.32', '-1'])('⛔ refuses the port %j, which is no TCP port', (port) => {
        expect(() => readFoodDbTarget({ ...ENV, FOOD_DB_PORT: port })).toThrow(/Invalid FOOD_DB_PORT/u);
    });
});
