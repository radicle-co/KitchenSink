/**
 * The SSM parameter through which the recipe schema stack tells everything else which database it made.
 *
 * ## Why a parameter and not a shared function
 *
 * Three stacks need this name: `RecipeSchemaStack` CREATES the database, and `RecipeServiceStack` and
 * `RecipeWorkersStack` read from it. They used to derive it independently, each calling
 * `recipeDatabaseNameForStage` with its own arguments — `(stage, baseStage, importedName)` in one,
 * `(props.stage, props.baseStage, props.dbBaseName)` in another. One authority, three call sites, three
 * chances to be handed the wrong pair.
 *
 * ⛔ That is not hypothetical. Measured on the live `pr-73` preview (#119): the API task ran with
 * `DB_NAME=kitchensink_recipes_pr_73` while all six worker Lambdas ran with `RECIPE_DB_NAME=kitchensink_recipes`
 * — the SHARED sandbox database. Three of those workers are on EventBridge schedules and destructive (version
 * archive prune, GDPR erasure sweep, erasure-orphan deletion), so a cross-stage data-loss path was live and
 * only a coincident RDS-IAM auth failure (#121) stopped it firing.
 *
 * A shared function makes agreement LIKELY. A shared lookup makes it STRUCTURAL: the stack that creates the
 * database publishes the name it actually used, and the consumers read that value rather than re-deriving it
 * from inputs they might not have been given correctly.
 *
 * ⚠️ Only the KEY is derived here, and it takes one argument. That is the difference from the value: a path
 * built from `stage` alone has no second input to disagree about.
 *
 * ⚠️ SSM rather than a CloudFormation export, deliberately. `Fn.importValue` makes the producer undeletable
 * while any consumer imports it, and this repository has already been bitten by that deadlock — a stage whose
 * exports are in use cannot be torn down, which is exactly what per-PR previews do constantly.
 *
 * @module
 */

/**
 * The SSM parameter path carrying the recipe database name for a stage.
 *
 * @param stage - The deploy stage (`prod`, `sandbox`, `pr-91`, …).
 * @returns The parameter path. Pure, total.
 */
export function recipeDatabaseNameParameter(stage: string): string {
    return `/kitchensink/${stage}/recipe/database-name`;
}
