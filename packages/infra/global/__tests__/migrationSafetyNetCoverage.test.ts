/**
 * ADR-0022 §4 keeps an idempotent `run-migrations.sh` invoke in every deploy pipeline as the SAFETY NET
 * behind the in-stack Trigger — the thing that catches "a stage whose schema is behind for a reason no code
 * change explains: a restore, a stage created later, a `deploy_webhooks`-only run".
 *
 * One runner had no net. `RecipeWorkersStack`'s `RecipeSchemaMigrationRunner` addresses the SAME database
 * with the SAME bundle as `RecipeServiceStack`'s, and `recipe-workers` deploys FIRST — so between the two
 * `cdk deploy`s (with two hard-failing steps and the service deploy's own failure modes in between, one of
 * which wedged `kitchensink-recipe-service-pr-91` in `UPDATE_ROLLBACK_FAILED`) there is a real window in
 * which the workers' Trigger has created and migrated the database and the service's net is unreachable.
 *
 * ## Why the existing guard could not see it
 *
 * `prodDeployMigrationOrder.test.ts` discovers runners from the SOURCE HANDLER — `src/**\/migrate/handler.ts`
 * — which is correct for the three services that author one. `recipe-workers` authors none: it deploys
 * recipe-service's bundle, deliberately, because "the runner has to be deployed WITH the SQL it applies".
 * So it is invisible to that predicate BY CONSTRUCTION, and adding it to a list there would be the copied
 * list this repository keeps paying for.
 *
 * This file discovers on a DIFFERENT axis — the `CfnOutput` that makes a runner reachable from a pipeline at
 * all. That is the same shape `.github/scripts/teardown-sandbox-pr.sh` §1 already uses to find per-PR
 * database drop doors (`^[A-Za-z]+MigrationFunctionName$`), so the two consumers of that convention now
 * agree: a runner published for teardown to reach is a runner the safety net must reach too.
 *
 * ⛔ A runner with NO output is out of scope here and stays that way — it is unreachable from a pipeline by
 * definition, and `WebhooksStack` deliberately publishes none (ADR-0022: its DB-touching Lambdas are ordered
 * by deploying AFTER the identity service). What this suite forbids is the state that actually occurred: an
 * output that exists, that teardown uses, and that no deploy workflow ever invokes.
 */

import { describe, expect, it } from 'vitest';

import { publishedRunnerOutputs, readRepoFile, stackSources } from './migrationRunners.js';

/** The workflow that deploys production. Every runner's net must appear here. */
const PROD_DEPLOY = '.github/workflows/prod-deploy.yml';

/** Every deploy workflow that targets a non-prod stage. Every runner's net must appear in one of them. */
const SANDBOX_DEPLOYS = ['.github/workflows/sandbox-deploy.yml', '.github/workflows/sandbox-identity-deploy.yml'];

/**
 * An output no `run-migrations.sh` invoke names, in the workflows it must appear in.
 *
 * The match is on the invoke's ARGUMENT, not merely on the file containing the word: an output mentioned
 * only in a comment — which is exactly how `RecipeWorkersMigrationFunctionName` appeared in
 * `prod-deploy.yml` while nothing invoked it — must still count as uncovered.
 */
export function findUncoveredRunners(
    outputs: readonly string[],
    invokedIn: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
    const violations: string[] = [];

    for (const output of outputs) {
        if (!(invokedIn[PROD_DEPLOY] ?? []).includes(output)) {
            violations.push(`${output} has no ADR-0022 §4 safety-net invoke in ${PROD_DEPLOY}`);
        }

        if (!SANDBOX_DEPLOYS.some((file) => (invokedIn[file] ?? []).includes(output))) {
            violations.push(`${output} has no safety-net invoke in any of: ${SANDBOX_DEPLOYS.join(', ')}`);
        }
    }

    return violations;
}

/**
 * The output ids passed to `run-migrations.sh run` in one workflow's text.
 *
 * `run` takes `<region> <stackName> <outputKey> <label>`, and the call is written across a line
 * continuation, so this reads the whole invocation rather than a single line.
 */
export function runnerOutputsInvokedBy(workflow: string): readonly string[] {
    return [...workflow.matchAll(/run-migrations\.sh\s+run\s+[\s\S]{0,200}?\s([A-Za-z]+MigrationFunctionName)\s/g)].map(
        (match) => match[1] ?? '',
    );
}

describe('every migration runner a pipeline can reach has an ADR-0022 §4 safety net', () => {
    const outputs = publishedRunnerOutputs(readRepoFile, stackSources());

    it('discovers the runners at all — a vacuous pass here would assert nothing below', () => {
        expect(outputs.length).toBeGreaterThanOrEqual(4);
    });

    it('agrees with the teardown script, which finds the same doors by the same shape', () => {
        // ONE convention, two consumers. If teardown's pattern is ever narrowed, this fails rather than
        // letting the two quietly disagree about which runners exist.
        expect(readRepoFile('.github/scripts/teardown-sandbox-pr.sh')).toContain('MigrationFunctionName');
    });

    it('invokes each of them from prod and from a sandbox deploy', () => {
        const invokedIn = Object.fromEntries(
            [PROD_DEPLOY, ...SANDBOX_DEPLOYS].map((file) => [file, runnerOutputsInvokedBy(readRepoFile(file))]),
        );

        expect(findUncoveredRunners(outputs, invokedIn)).toEqual([]);
    });
});

describe('the rules themselves detect the absence they exist to detect', () => {
    it('finds an output in a stack source, and ignores a mention that is not one', () => {
        const sources = { 'a.ts': "new CfnOutput(this, 'XMigrationFunctionName', { value: fn.functionName });" };

        expect(publishedRunnerOutputs((file) => sources[file as 'a.ts'], ['a.ts'])).toEqual(['XMigrationFunctionName']);
        expect(publishedRunnerOutputs(() => '// see XMigrationFunctionName in the other stack', ['a.ts'])).toEqual([]);
    });

    it('reads the output id out of a real invocation, and never out of prose', () => {
        expect(
            runnerOutputsInvokedBy(
                'bash .github/scripts/run-migrations.sh run "${REGION}" \\\n  "stack-${STAGE}" FoodMigrationFunctionName food\n',
            ),
        ).toEqual(['FoodMigrationFunctionName']);

        // The state that actually shipped: named in a comment, invoked by nothing.
        expect(runnerOutputsInvokedBy('# RecipeWorkersMigrationFunctionName has no net at all\n')).toEqual([]);
    });

    it('reports an uncovered runner once per workflow class that misses it', () => {
        expect(findUncoveredRunners(['ZMigrationFunctionName'], {})).toHaveLength(2);
        expect(
            findUncoveredRunners(['ZMigrationFunctionName'], {
                [PROD_DEPLOY]: ['ZMigrationFunctionName'],
                [SANDBOX_DEPLOYS[0] ?? '']: ['ZMigrationFunctionName'],
            }),
        ).toEqual([]);
    });
});
