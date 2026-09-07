/**
 * Every migration runner a pipeline can reach is actually INVOKED by every pipeline that can reach it.
 *
 * ## What this guard was written for, and what changed under it
 *
 * It was written when a runner had no invoke. `RecipeWorkersStack` shipped a SECOND copy of
 * recipe-service's bundle — ADR-0022's only way to order that app's eight DB-touching Lambdas behind a
 * schema, since `DependsOn` cannot leave a stack — and `prod-deploy.yml` mentioned its output only in a
 * comment. Between the two `cdk deploy`s there was a real window in which that runner had created and
 * migrated the database and no net could reach it.
 *
 * The schema now owns its own stack per database, deployed and invoked by its own pipeline step ahead of
 * every consumer, so there is exactly ONE runner per database and the second copy is gone. The window this
 * guard was written for cannot recur — but the class can, the moment a fourth service lands or someone
 * re-adds an in-stack runner, so the guard stays and its anchor became stronger rather than weaker: not
 * "at least four outputs" (a number that fell when the duplicate went), but ONE PER DATABASE FAMILY, which
 * is the invariant that actually matters.
 *
 * ## Why the discovery axis is the `CfnOutput`
 *
 * `prodDeployMigrationOrder.test.ts` discovers runners from the SOURCE HANDLER — `src/**\/migrate/handler.ts`
 * — which is correct for the three services that author one and structurally blind to a stack that ships
 * someone else's bundle. This file discovers on the axis that makes a runner REACHABLE at all: the
 * `CfnOutput`. That is the same shape `.github/scripts/teardown-sandbox-pr.sh` §1 uses to find per-PR
 * database drop doors (`^[A-Za-z]+MigrationFunctionName$`), so the two consumers of that convention agree —
 * a runner published for teardown to reach is a runner the migrate step must reach too.
 *
 * ⛔ A runner with NO output is out of scope and stays that way — it is unreachable from a pipeline by
 * definition, and `WebhooksStack` deliberately publishes none (its DB-touching Lambdas are ordered by
 * deploying AFTER the identity service). What this suite forbids is the state that actually occurred: an
 * output that exists, that teardown uses, and that no deploy workflow ever invokes.
 */

import { describe, expect, it } from 'vitest';

import { publishedRunnerOutputs, readRepoFile, stackSources } from './migrationRunners.js';

/** The workflow that deploys production. Every runner's net must appear here. */
const PROD_DEPLOY = '.github/workflows/prod-deploy.yml';

/** Every deploy workflow that targets a non-prod stage. Every runner's net must appear in one of them. */
const SANDBOX_DEPLOYS = [
    // ⚠️ `_sandbox-preview.yml`: the deploy jobs moved to `_sandbox-preview.yml`, a REUSABLE workflow, because GitHub Actions has no cross-workflow `needs` — `_ci.yml` has to be able to run them as one branch of its own graph.
    '.github/workflows/_sandbox-preview.yml',
    '.github/workflows/sandbox-identity-deploy.yml',
];

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

    it('discovers ONE runner per database family — the anchor, and the invariant', () => {
        // ⚠️ THREE, DOWN FROM FOUR, and the drop is the decision rather than a regression. The fourth was
        // `RecipeWorkersMigrationFunctionName`: a second runner for the recipe database, existing only so a
        // second in-stack Trigger could order that app's Lambdas. One schema stack per database replaced
        // both, and a stack ahead of everything orders every consumer regardless of which app it is in.
        //
        // Asserted as a SET rather than a count, so a fourth service that lands tomorrow fails here loudly
        // instead of quietly satisfying a `>=`, and a re-introduced duplicate is a name this list does not
        // expect rather than a number that happens to be big enough.
        expect([...outputs].sort()).toStrictEqual([
            'FoodMigrationFunctionName',
            'IdentityMigrationFunctionName',
            'RecipeMigrationFunctionName',
        ]);
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
