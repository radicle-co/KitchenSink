/**
 * Where the deployed cookbook import suite drives, parsed once from the environment.
 *
 * The caller resolves the stage's origins (`deployedE2eTiers.yml`, from `publicServiceOriginForStage`) and mints the
 * curator credential; this module only reads what it was handed. Naming nothing is a legal SKIP for a DEPLOYED tier
 * (`docs/CODING_STANDARDS.md` §7.1a). Naming part of a target, or declaring `E2E_TARGET=deployed` and naming none, is
 * a wiring defect, and it throws so that it cannot pass as a skip.
 *
 * @pattern Parse, don't validate — the environment becomes a discriminated union at the boundary
 */
import { assertWritableImportOrigin } from '../../../src/writableOrigin.js';

/** The variables that together name a target. */
const TARGET_VARIABLES = [
    'COOKBOOK_IMPORT_RECIPE_URL',
    'COOKBOOK_IMPORT_FOOD_URL',
    'COOKBOOK_IMPORT_CREDENTIALS',
] as const;

/** A deployed target, or the absence of one. */
export type DeployedImportTarget =
    | { readonly kind: 'absent' }
    | {
          readonly kind: 'present';
          /** The stage's recipe origin, admitted by the importer's write gate. */
          readonly recipeOrigin: string;
          /** The same stage's food origin. Searched, never written to. */
          readonly foodOrigin: string;
          /** The credential file `mintLinkageCredentials.ts` wrote. */
          readonly credentialsPath: string;
          /** A bearer without the curator grant, for the refusal case; absent unless a caller supplies one. */
          readonly ungrantedToken: string | undefined;
      };

/**
 * A variable's value, or `undefined` when it is unset or blank. Pure.
 *
 * @param env - The environment.
 * @param name - The variable.
 * @returns Its value.
 */
function valueOf(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
    const value = env[name];

    return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Read the target. Pure.
 *
 * @param env - The environment, normally `process.env`.
 * @returns The target, or `absent` when nothing names one.
 * @throws {Error} When part of a target is named, or a job declared a deployed target and named none.
 * @throws {ForbiddenImportOriginError} When the recipe origin is not one the importer may write to.
 */
export function readDeployedImportTarget(env: Readonly<Record<string, string | undefined>>): DeployedImportTarget {
    const recipeOrigin = valueOf(env, 'COOKBOOK_IMPORT_RECIPE_URL');
    const foodOrigin = valueOf(env, 'COOKBOOK_IMPORT_FOOD_URL');
    const credentialsPath = valueOf(env, 'COOKBOOK_IMPORT_CREDENTIALS');

    if (recipeOrigin === undefined && foodOrigin === undefined && credentialsPath === undefined) {
        if (env['E2E_TARGET'] === 'deployed') {
            throw new Error(
                `this job declares E2E_TARGET=deployed but names no target (${TARGET_VARIABLES.join(', ')}); a skip ` +
                    'here would report a suite nobody ran',
            );
        }

        return { kind: 'absent' };
    }

    if (recipeOrigin === undefined || foodOrigin === undefined || credentialsPath === undefined) {
        const missing = TARGET_VARIABLES.filter((name) => valueOf(env, name) === undefined);

        throw new Error(`a deployed target is named only in part; missing ${missing.join(', ')}`);
    }

    return {
        kind: 'present',
        recipeOrigin: assertWritableImportOrigin(recipeOrigin),
        foodOrigin,
        credentialsPath,
        ungrantedToken: valueOf(env, 'COOKBOOK_IMPORT_UNGRANTED_TOKEN'),
    };
}
