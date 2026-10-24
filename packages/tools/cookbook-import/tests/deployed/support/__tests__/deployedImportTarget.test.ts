/**
 * Where the deployed cookbook import suite drives, read from the environment.
 *
 * The suite SKIPS when no target is named, which the DEPLOYED tier allows (`docs/CODING_STANDARDS.md` §7.1a). What
 * these cases hold is the line around that skip: a half-named target, or a job that declared a deployed target and
 * named none, is a wiring defect and must fail, because a skip there would be a green nobody earned. And the suite
 * writes PUBLIC recipes, so a production recipe origin is refused by the importer's own write gate.
 */
import { describe, expect, it } from 'vitest';

import { isForbiddenImportOriginError } from '../../../../src/writableOrigin.js';
import { readDeployedImportTarget } from '../deployedImportTarget.js';

const RECIPE = 'https://recipe-pr-91.commise.app';
const FOOD = 'https://food-pr-91.commise.app';
const CREDENTIALS = '/tmp/cookbookImport/linkage-credentials.json';

/** A fully named per-PR target. */
const named = {
    COOKBOOK_IMPORT_RECIPE_URL: RECIPE,
    COOKBOOK_IMPORT_FOOD_URL: FOOD,
    COOKBOOK_IMPORT_CREDENTIALS: CREDENTIALS,
} as const;

describe('readDeployedImportTarget', () => {
    it.each<[string, Readonly<Record<string, string>>]>([
        ['nothing is named', {}],
        [
            'every variable is blank',
            { COOKBOOK_IMPORT_RECIPE_URL: ' ', COOKBOOK_IMPORT_FOOD_URL: '', COOKBOOK_IMPORT_CREDENTIALS: '' },
        ],
        ['a target other than deployed is declared', { E2E_TARGET: 'local' }],
    ])('is absent when %s', (_case, env) => {
        expect(readDeployedImportTarget(env)).toEqual({ kind: 'absent' });
    });

    it('fails when the job declared a deployed target and named none, rather than skipping to a green', () => {
        expect(() => readDeployedImportTarget({ E2E_TARGET: 'deployed' })).toThrow(/declares E2E_TARGET=deployed/u);
    });

    it.each<[string, Readonly<Record<string, string>>, readonly string[]]>([
        [
            'only the recipe origin',
            { COOKBOOK_IMPORT_RECIPE_URL: RECIPE },
            ['COOKBOOK_IMPORT_FOOD_URL', 'COOKBOOK_IMPORT_CREDENTIALS'],
        ],
        ['everything but the food origin', { ...named, COOKBOOK_IMPORT_FOOD_URL: '' }, ['COOKBOOK_IMPORT_FOOD_URL']],
        [
            'everything but the credential',
            { ...named, COOKBOOK_IMPORT_CREDENTIALS: '  ' },
            ['COOKBOOK_IMPORT_CREDENTIALS'],
        ],
    ])('fails on %s, naming exactly what is missing', (_case, env, missing) => {
        const thrown = captured(() => readDeployedImportTarget(env));

        for (const name of Object.keys(named)) {
            if (missing.includes(name)) {
                expect(thrown.message).toContain(name);
            } else {
                expect(thrown.message).not.toContain(name);
            }
        }
    });

    it('reads a full target, with no ungranted token unless one is named', () => {
        expect(readDeployedImportTarget(named)).toEqual({
            kind: 'present',
            recipeOrigin: RECIPE,
            foodOrigin: FOOD,
            credentialsPath: CREDENTIALS,
            ungrantedToken: undefined,
        });
    });

    it('carries the ungranted token when one is named', () => {
        expect(readDeployedImportTarget({ ...named, COOKBOOK_IMPORT_UNGRANTED_TOKEN: 'tok_ungranted' })).toMatchObject({
            kind: 'present',
            ungrantedToken: 'tok_ungranted',
        });
    });

    it.each(['https://recipe.commise.app', 'https://recipe.example.com'])(
        'refuses the recipe origin %s through the importer’s own write gate',
        (origin) => {
            expect(
                isForbiddenImportOriginError(
                    captured(() => readDeployedImportTarget({ ...named, COOKBOOK_IMPORT_RECIPE_URL: origin })),
                ),
            ).toBe(true);
        },
    );
});

/**
 * Run `act` and return what it threw.
 *
 * @param act - The call expected to throw.
 * @returns The thrown error.
 * @throws {Error} when `act` returns, or throws something that is not an `Error`.
 */
function captured(act: () => unknown): Error {
    try {
        act();
    } catch (error) {
        if (error instanceof Error) {
            return error;
        }

        throw new Error('threw a non-Error', { cause: error });
    }

    throw new Error('expected a throw, but the call returned');
}
