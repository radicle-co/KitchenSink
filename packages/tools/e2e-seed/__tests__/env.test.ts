/**
 * A misconfigured job must fail loudly and completely, not one variable per fifty-minute run.
 */
import { describe, expect, it } from 'vitest';

import { readSeedEnvironment } from '../src/env.js';

const complete = {
    CLERK_SECRET_KEY: 'sk_test_x',
    CLERK_PUBLISHABLE_KEY: 'pk_test_x',
    E2E_SEED_RECIPE_URL: 'https://recipe-pr-91.commise.app/',
    E2E_SEED_WEB_ORIGIN: 'https://pr-91.sandbox.commise.app',
};

describe('readSeedEnvironment', () => {
    it('reads a complete environment and trims trailing slashes off both origins', () => {
        expect(readSeedEnvironment(complete)).toEqual({
            clerkSecretKey: 'sk_test_x',
            clerkPublishableKey: 'pk_test_x',
            recipeOrigin: 'https://recipe-pr-91.commise.app',
            webOrigin: 'https://pr-91.sandbox.commise.app',
        });
    });

    it('names EVERY missing variable in one message', () => {
        expect(() => readSeedEnvironment({})).toThrow(
            /CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, E2E_SEED_RECIPE_URL, E2E_SEED_WEB_ORIGIN/,
        );
    });

    it('treats a blank value as missing — an empty origin would address a bare label', () => {
        expect(() => readSeedEnvironment({ ...complete, E2E_SEED_RECIPE_URL: '   ' })).toThrow(/E2E_SEED_RECIPE_URL/);
    });

    it('supplies NO defaults — a default would let a job silently address the wrong stage', () => {
        for (const name of Object.keys(complete)) {
            const partial = { ...complete, [name]: undefined };

            expect(() => readSeedEnvironment(partial)).toThrow(new RegExp(name));
        }
    });
});
