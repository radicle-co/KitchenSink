/**
 * The single authoritative naming rule for the recipe logical database (ADR-0006).
 *
 * ONE piece of knowledge — "which logical database does a recipe deploy at stage X talk to" — consumed by
 * two CDK stacks that must never disagree: `RecipeServiceStack` (the ECS API + the in-VPC migration runner)
 * and `RecipeWorkersStack` (the six async Lambdas). It lives here, in `@kitchensink/recipe-core`, for the
 * same reason {@link recipeObjectKeys} does: both service packages already depend on this one, and neither
 * may own shared naming alone.
 *
 * **Why it moved here (defect #119).** The derivation used to live inside `recipe-service`'s CDK stack. The
 * `recipe-workers` stack could not reach it, so its CDK app fell back to `process.env['RECIPE_DB_NAME'] ??
 * 'kitchensink_recipes'` — and CI never passed that variable. The measured result on the live `pr-73`
 * preview: the recipe API ran against `kitchensink_recipes_pr_73` while all six workers ran against the
 * SHARED `kitchensink_recipes`. Three of those workers are scheduled and destructive (version-archive
 * prune, GDPR erasure sweep, orphan deletion), so the divergence was a cross-stage data-loss path, not a
 * read-side inconsistency. Nothing tied the two resolutions together, which is exactly why they drifted
 * silently — so the cross-stack parity test in
 * `packages/services/recipe-service/infra/__tests__/recipe-database-name-parity.test.ts` is part of this
 * contract, not an optional extra.
 *
 * **Import it as `@kitchensink/recipe-core/database-name`, never through the package barrel — and keep this
 * module free of imports.** Its consumers include `RecipeServiceStack`, and the recipe service's CDK app is
 * deployed as COMPILED JavaScript (`cdk deploy --app "node infra/dist/bin/app.js"`). Node can load a `.ts`
 * file by stripping types, but it does NOT remap the `.js` specifiers TypeScript sources use, so importing
 * the barrel (`./src/index.ts`, which re-exports `./recipe.types.js` and friends) fails at deploy time with
 * `ERR_MODULE_NOT_FOUND` — verified, and it would break every recipe-service deploy. A leaf module with no
 * imports has nothing left to resolve, which is what makes this subpath safe from both a `tsx` app (the
 * workers) and a compiled one (the service). That is also why it is NOT re-exported from `index.ts`: the
 * deploy-safe path is the only path, so nobody can pick the one that breaks.
 *
 * Every function here is pure.
 */

/**
 * The single shared base logical database on the persistent platform instance (ADR-0006).
 *
 * The platform `DataStack` provisions exactly this one and exports its name as
 * `kitchensink-data-{baseStage}:RecipeDatabaseName`; per-PR databases are derived FROM it, never
 * provisioned alongside it.
 */
export const BASE_RECIPE_DATABASE_NAME = 'kitchensink_recipes';

/**
 * Resolve the recipe service's logical database name for a stage. A base stage (prod/sandbox) uses the
 * imported shared name; every other stage gets an isolated `kitchensink_recipes_{suffix}` on the SAME
 * shared instance (ADR-0006). Mirrors food's `foodDatabaseNameForStage`.
 *
 * The SUFFIX form is load-bearing in two directions: it matches food's `kitchensink_food_pr_7`, and it is
 * the only shape the migration runner's `^kitchensink_recipes(_[a-z0-9_]+)?$` validator accepts — a prefix
 * form would be refused by `ensureDatabaseExists`, leaving a preview with no database at all.
 *
 * @param stage - The deploy stage (`prod`, or an ephemeral stage such as `pr-73`).
 * @param baseStage - The persistent platform stage the deploy rides.
 * @param importedBaseName - The base stage's `RecipeDatabaseName` (a CFN export value, or the unresolved
 *   `Fn.importValue` token for it). Returned verbatim on a base stage; ignored on an ephemeral one, which
 *   is what lets a caller holding a resolved literal and a caller holding an unresolved token agree.
 * @returns The imported base name for a base stage, else the derived per-stage database name.
 * @throws {Error} when the stage sanitizes to an empty suffix — returning the bare base name there would
 *   silently point an ephemeral deploy at the SHARED database (the #119 blast radius).
 */
export function recipeDatabaseNameForStage(stage: string, baseStage: string, importedBaseName: string): string {
    if (stage === baseStage) {
        return importedBaseName;
    }

    const suffix = stage
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (suffix === '') {
        throw new Error(
            `Cannot derive a per-PR recipe database name from stage '${stage}': it sanitizes to an empty suffix.`,
        );
    }

    return `${BASE_RECIPE_DATABASE_NAME}_${suffix}`;
}
