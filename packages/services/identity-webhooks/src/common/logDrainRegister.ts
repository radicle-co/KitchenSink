/**
 * THE log-drain register (plan U15) — every CloudWatch log group the drain forwards, and how to read its
 * stage.
 *
 * ⛔ WHY IT REPLACES A REGEX. `stageFromLogGroup` matched one shape,
 * `kitchensink-identity-<component>-<stage>-…`, and answered `'unknown'` for anything else. Two things were
 * already wrong with that, and both were SILENT:
 *
 *  1. **The identity ECS group is `/kitchensink/identity-service/<stage>`** — slashes, not hyphens — so
 *     every log line from the service that serves real users arrived in Sentry tagged `environment:unknown`.
 *  2. **A sandbox webhook group resolved to a CONSTRUCT ID.** Those groups take CDK's generated physical
 *     name, `kitchensink-identity-webhooks-sandbox-WebhooksLogGroup<hash>`, and the pattern's
 *     `sandbox-[a-z0-9]+` arm happily matched `sandbox-WebhooksLogGroup…`, producing an `environment` named
 *     after a construct. Nobody filters on that, so those lines were effectively invisible too.
 *
 * A regex guesses. This register KNOWS: each entry names a source, the shape of its group, and where the
 * stage sits in it. ⛔ An unregistered group is a FAILURE, never a guess — `'unknown'` is a value someone
 * has to notice, and nobody did for as long as both defects existed.
 *
 * ⚠️ The ADR-0042 table is the authority for WHICH groups exist and which stack owns each one's subscription
 * filter; this module is the RUNTIME half, and `logDrainRegister.test.ts` plus the repo-wide guard hold the
 * two in agreement. No single synthesized template can see across stacks, which is why the register is a
 * document rather than an assertion over one app.
 */

/** How a source's log-group name is built, and where the stage sits inside it. */
export interface LogDrainSource {
    /** The register key — also the Sentry `service` tag for lines from this group. */
    readonly service: string;
    /**
     * Matches this source's group names, capturing the stage as group 1.
     *
     * ⚠️ ANCHORED where the shape allows it. A CDK-generated name carries a trailing hash, so those patterns
     * end open — but the stage capture is always bounded by a literal on BOTH sides, which is exactly what
     * the old pattern lacked when it swallowed `WebhooksLogGroup` into a stage name.
     */
    readonly pattern: RegExp;
}

/**
 * Every log group the drain forwards.
 *
 * ⛔ Keep in lockstep with ADR-0042's `log-drain:start`/`end` table. The ADR names the stack that owns each
 * filter — knowledge that lives across CDK apps and cannot be derived from any one of them — while this list
 * is what the forwarder reads at runtime.
 */
export const LOG_DRAIN_SOURCES: readonly LogDrainSource[] = [
    // ⛔ The slash-path group the old regex could not match at all. `/kitchensink/identity-service/prod`.
    { service: 'identity-service', pattern: /^\/kitchensink\/identity-service\/([a-z0-9-]+)$/iu },
    // CDK-generated names: `<stack>-<ConstructId><hash>`, where `<stack>` ends in the stage. The stage is
    // bounded by `-` on the left and the construct id on the right, so it cannot swallow the id.
    { service: 'identity-webhooks', pattern: /^kitchensink-identity-webhooks-([a-z0-9-]+?)-WebhooksLogGroup/iu },
    { service: 'identity-webhooks-api', pattern: /^kitchensink-identity-webhooks-([a-z0-9-]+?)-IdentityWebhooksApi/iu },
    { service: 'log-forwarder', pattern: /^kitchensink-identity-webhooks-([a-z0-9-]+?)-LogForwarderLogGroup/iu },
    // Explicitly named Lambda groups.
    { service: 'recipe-workers', pattern: /^\/aws\/lambda\/kitchensink-recipe-workers-([a-z0-9-]+)$/iu },
    { service: 'ingredient-parser', pattern: /^\/aws\/lambda\/kitchensink-ingredient-parser-([a-z0-9-]+)$/iu },
    // CDK-generated service groups.
    { service: 'recipe-service', pattern: /^kitchensink-recipe-([a-z0-9-]+?)-RecipeApiLogGroup/iu },
    { service: 'food-service', pattern: /^kitchensink-food-([a-z0-9-]+?)-FoodApiLogGroup/iu },
    { service: 'food-worker', pattern: /^kitchensink-food-([a-z0-9-]+?)-FoodWorkerLogGroup/iu },
    { service: 'food-change-refresh', pattern: /^kitchensink-food-([a-z0-9-]+?)-FoodChangeRefreshLogGroup/iu },
    // U18: the platform functions that wrote to IMPLICIT groups — no template, no teardown, no retention.
    {
        service: 'identity-migration',
        pattern: /^kitchensink-identity-schema-([a-z0-9-]+?)-IdentityMigrationLogGroup/iu,
    },
    { service: 'food-migration', pattern: /^kitchensink-food-schema-([a-z0-9-]+?)-FoodMigrationLogGroup/iu },
    { service: 'recipe-migration', pattern: /^kitchensink-recipe-schema-([a-z0-9-]+?)-RecipeMigrationLogGroup/iu },
    { service: 'db-bootstrap', pattern: /^kitchensink-data-([a-z0-9-]+?)-DbBootstrapLogGroup/iu },
    { service: 'per-pr-reaper', pattern: /^kitchensink-data-([a-z0-9-]+?)-PerPrDatabaseReaperLogGroup/iu },
    {
        service: 'sandbox-scheduler',
        pattern: /^kitchensink-sandbox-scheduler-([a-z0-9-]+?)-SandboxSchedulerLogGroup/iu,
    },
];

/** What the register concluded about one group name. */
export interface LogSourceIdentity {
    /** The register key. */
    readonly service: string;
    /** The deploy stage, lowercased. */
    readonly stage: string;
}

/**
 * Identify a log group.
 *
 * ⛔ Answers `undefined` for an unregistered group rather than guessing a stage. The caller decides what to
 * do with that — and `'unknown'`, the old answer, is precisely what let two whole services' logs sit
 * mislabelled for as long as nobody went looking.
 *
 * @param logGroup - The CloudWatch log group name.
 * @returns The source and stage, or `undefined` when the group is not in the register. Pure.
 */
export function identifyLogSource(logGroup: string): LogSourceIdentity | undefined {
    for (const source of LOG_DRAIN_SOURCES) {
        const match = source.pattern.exec(logGroup);

        if (match?.[1] !== undefined) {
            return { service: source.service, stage: match[1].toLowerCase() };
        }
    }

    return undefined;
}
