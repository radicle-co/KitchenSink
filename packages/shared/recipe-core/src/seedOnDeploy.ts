/**
 * Whether a deploy at this stage may seed the deterministic recipe world.
 *
 * DESIGN PATTERN: Specification (policy) module — the sibling of `visibilityPolicy` and `provenancePolicy`.
 * One piece of knowledge, "which stage's deploy may write the fixture world", consumed by two callers that
 * must never disagree: the CDK stack decides at SYNTH whether to construct the seed runner at all, and the
 * runner itself re-asks at RUNTIME before it opens a connection.
 *
 * ## ⛔ Why an allowlist, and never `stage !== 'prod'`
 *
 * `src/database/seed.ts` writes recipes and a collection owned by two FABRICATED subjects
 * (`SEED_OWNER_FREE` / `SEED_OWNER_PRO`), some of them public. Against production that is fake public
 * recipes, owned by users who do not exist, in the real discovery feed. A denylist admits every value it
 * failed to anticipate — an unset stage, a typo, a stage added next year — and the direction it fails in
 * is production. An allowlist fails toward "did not seed", which costs a preview a fixture and nothing
 * more.
 *
 * The pattern is anchored and digits-only for the reason `PER_PR_ENVIRONMENT` in
 * `packages/infra/global/lib/sandbox-scheduler/scheduler.ts` records: a prefix rule admits `prod` itself,
 * and a loose one admits `prod-pr-1`.
 *
 * ⚠️ `pr-{N}` IS THE ONLY NON-PROD STAGE THIS SERVICE HAS. `infra/bin/app.ts` refuses to deploy the recipe
 * service at `sandbox` — there is no persistent non-prod instance, every PR deploys its own. If that ever
 * changes, this predicate is the one place that widens.
 *
 * ⛔ KEEP THIS MODULE FREE OF IMPORTS, and import it as `@kitchensink/recipe-core/seed-on-deploy` rather
 * than through the barrel. `RecipeServiceStack` is deployed as COMPILED JavaScript
 * (`cdk deploy --app "node infra/dist/bin/app.js"`), and Node strips types without remapping the `.js`
 * specifiers TypeScript sources use — so a leaf that imports anything fails at deploy time with
 * `ERR_MODULE_NOT_FOUND`. `recipeDatabaseName.ts` carries the same constraint for the same measured reason,
 * and is likewise absent from `index.ts`.
 *
 * @param stage - The deploy stage, e.g. `pr-91` or `prod`. An absent value fails closed.
 * @returns True only for a per-PR preview stage.
 */
export function seedsRecipeWorldOnDeploy(stage: string | undefined): boolean {
    return stage !== undefined && /^pr-\d+$/u.test(stage);
}
