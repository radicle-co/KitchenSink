// @vitest-environment node
/**
 * Repo-wide guard: the food and recipe legs of `prod-deploy.yml` must be REACHABLE.
 *
 * ## The failure this pins
 *
 * Both feature services carry a full prod leg — image push, CDK deploy, DB migration, smoke test — and
 * neither had ever run. Two independent gates made them dead code:
 *
 *   1. `on.push.paths` listed only the identity/global paths, so a food-only or recipe-only merge to `main`
 *      never STARTED the workflow. Those legs deployed only when a change happened to be bundled with an
 *      identity or global change — which is worse than never, because it is nondeterministic.
 *   2. `workflow_dispatch` set `deploy_global/service/webhooks` but never `deploy_food`/`deploy_recipe`, so
 *      there was no manual escape hatch either — contradicting the file's own comment, "a workflow_dispatch
 *      deploys everything".
 *
 * Net effect: green prod deploys that silently skipped two of the three services, and no way to bring them
 * up by hand.
 *
 * ## Why it is asserted this way
 *
 * The flag logic is a shell script embedded in YAML, so it is EXECUTED as real `bash` here rather than
 * re-implemented in TypeScript — a second copy of the rules could drift from the one the workflow runs,
 * which is the same reasoning `prScope.test.ts` uses for the teardown predicates.
 *
 * The step's inputs reach it through its `env:` block, NOT as `${{ … }}` interpolated into the script body
 * (zizmor `template-injection`: Actions substitutes an expression textually before bash parses the body, so
 * an interpolated value is executable source, whereas an env var is only ever data). This harness therefore
 * mirrors the real execution model: it resolves each `env:` VALUE's expressions from the scenario and hands
 * the results to bash as real environment variables.
 *
 * Three properties keep that from degrading into a test that passes on nothing:
 *
 *   1. An expression the scenario does not supply is a hard error, never an empty string — "expression
 *      silently interpolated to nothing" is a defect class this file has already hit.
 *   2. A `${{ … }}` found in the script BODY fails outright, which is what stops the template-injection fix
 *      from being quietly reverted.
 *   3. The script runs under `bash -eu`, so a variable it reads that the step's `env:` block does not
 *      declare aborts with a non-zero status instead of defaulting to empty. Deleting the `env:` block
 *      reds this file rather than turning every flag silently `false`.
 *
 * The trigger check derives its expectation from the paths-filter groups, so adding a new watched path to
 * the `food`/`recipe` filters without also adding it to the push trigger fails here.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/prod-deploy.yml', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
    readonly id?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: { readonly filters?: string };
}

/** An Actions expression, as it appears in an `env:` value. */
const EXPRESSION = /\$\{\{\s*([^}]+?)\s*\}\}/g;

interface Workflow {
    readonly on: { readonly push: { readonly paths: readonly string[] } };
    readonly jobs: Record<string, { readonly steps?: WorkflowStep[] }>;
}

function workflow(): Workflow {
    return parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
}

/** The paths-filter groups, as `{ group: [path, ...] }`. The filter body is itself a YAML document. */
function filterGroups(): Record<string, readonly string[]> {
    const steps = Object.values(workflow().jobs)[0]?.steps ?? [];
    const filters = steps.find((step) => step.id === 'changes')?.with?.filters;

    if (filters === undefined) {
        throw new Error('prod-deploy.yml has no `id: changes` paths-filter step — this guard is anchored on it.');
    }

    return parse(filters) as Record<string, readonly string[]>;
}

/** The `Compute deploy flags` step. This guard is anchored on its name. */
function flagsStep(): WorkflowStep & { readonly run: string } {
    const steps = Object.values(workflow().jobs)[0]?.steps ?? [];
    const step = steps.find((candidate) => candidate.name === 'Compute deploy flags');

    if (step?.run === undefined) {
        throw new Error('prod-deploy.yml has no `Compute deploy flags` step — this guard is anchored on its name.');
    }

    return { ...step, run: step.run };
}

/**
 * Run the `Compute deploy flags` step as real bash and return its `$GITHUB_OUTPUT` as a map.
 *
 * `expressions` supplies every `${{ … }}` the step's `env:` block references; an unlisted one throws rather
 * than becoming an empty string, which is how an interpolation bug would otherwise hide.
 *
 * @sideEffect Spawns bash and writes to a temp directory.
 */
function computeFlags(expressions: Readonly<Record<string, string>>): Record<string, string> {
    const step = flagsStep();

    // The inputs must arrive as environment DATA. An expression left in the body would be substituted into
    // the script text by Actions, which is exactly the template-injection shape this step was fixed to avoid.
    const inlined = [...step.run.matchAll(EXPRESSION)].map(([, expression]) => expression);

    expect(
        inlined,
        'the flags script interpolates these expressions directly into its body — route them through the ' +
            "step's `env:` block and read them as quoted shell variables instead",
    ).toEqual([]);

    // Resolve the step's declared env: the same values Actions would compute, keyed by the real variable
    // names the script reads.
    const environment = Object.fromEntries(
        Object.entries(step.env ?? {}).map(([name, value]) => [
            name,
            String(value).replace(EXPRESSION, (_match, expression: string) => {
                if (!(expression in expressions)) {
                    throw new Error(
                        `The flags step declares ${name}: \${{ ${expression} }}, which this test does not ` +
                            'supply. Add it to the scenario rather than letting it resolve to an empty string.',
                    );
                }

                return expressions[expression] as string;
            }),
        ]),
    );

    const directory = mkdtempSync(join(tmpdir(), 'prod-deploy-flags-'));
    const scriptPath = join(directory, 'flags.sh');
    const outputPath = join(directory, 'github_output');

    writeFileSync(scriptPath, step.run);
    writeFileSync(outputPath, '');

    // `-u` as well as `-e`: a variable the script reads but the step's `env:` block never declared must abort
    // loudly, not default to empty and quietly turn every flag `false`.
    //
    // ⚠️ `cwd` is the REPOSITORY ROOT, which is what Actions gives a step. The flags script shells out to
    // `.github/scripts/deploy-gate.sh` for the deploy-graph closure, so running from vitest's own cwd would
    // fail on a path that is correct in CI — and running the real script rather than a re-implementation is
    // the same rule `deployGate.test.ts` and `prScope.test.ts` follow.
    const result = spawnSync('bash', ['-eu', scriptPath], {
        cwd: repoRoot,
        env: { ...process.env, ...environment, GITHUB_OUTPUT: outputPath },
        encoding: 'utf8',
    });

    expect(result.status, `flags script failed: ${result.stderr}`).toBe(0);

    return Object.fromEntries(
        readFileSync(outputPath, 'utf8')
            .split('\n')
            .filter((line) => line.includes('='))
            .map((line) => {
                const separator = line.indexOf('=');

                return [line.slice(0, separator), line.slice(separator + 1)];
            }),
    );
}

/**
 * A push where only the named filter groups matched, and every cross-app export is published.
 *
 * `unmet` is the ONE other input the step takes — the deploy-graph edges whose export the account does not
 * currently answer for. Empty is the healthy platform, which is what every pre-existing assertion below
 * describes; {@link pushWithUnmet} supplies a real one.
 */
function push(...changed: readonly string[]): Record<string, string> {
    return pushWithUnmet('', ...changed);
}

/** As {@link push}, with a deploy-graph edge whose export the account does not publish. */
function pushWithUnmet(unmet: string, ...changed: readonly string[]): Record<string, string> {
    const groups = Object.keys(filterGroups());

    return computeFlags({
        'github.event_name': 'push',
        'steps.imports.outputs.unmet_imports': unmet,
        ...Object.fromEntries(
            groups.map((group) => [`steps.changes.outputs.${group}`, String(changed.includes(group))]),
        ),
    });
}

describe('prod-deploy.yml — the food and recipe legs are reachable', () => {
    it('starts the workflow for a change to any path its filters watch', () => {
        const groups = filterGroups();
        const triggerPaths = workflow().on.push.paths;
        const watched = [...new Set([...(groups['food'] ?? []), ...(groups['recipe'] ?? [])])];

        // Every path that can set deploy_food/deploy_recipe must also be able to START the run. Without this
        // the flag is computed on a workflow that never fires for a food- or recipe-only merge.
        const unreachable = watched.filter((path) => !triggerPaths.includes(path));

        expect(
            unreachable,
            'these paths gate a prod deploy leg but are absent from on.push.paths, so a change touching only ' +
                'them never starts the workflow',
        ).toEqual([]);
    });

    it('deploys the feature services on a manual dispatch', () => {
        const groups = Object.keys(filterGroups());
        const flags = computeFlags({
            'github.event_name': 'workflow_dispatch',
            'steps.imports.outputs.unmet_imports': '',
            ...Object.fromEntries(groups.map((group) => [`steps.changes.outputs.${group}`, 'false'])),
        });

        // The escape hatch. A first bring-up (or a rollback) of a feature service has no other route, and the
        // step's own comment already claims a dispatch "deploys everything".
        expect(flags['deploy_food']).toBe('true');
        expect(flags['deploy_recipe']).toBe('true');
        expect(flags['deploy_global']).toBe('true');
        expect(flags['deploy_service']).toBe('true');
        expect(flags['deploy_webhooks']).toBe('true');
    });

    it('does NOT let a global-only change roll a feature service to prod', () => {
        const flags = push('global');

        // The deliberate asymmetry this guard must not erode: identity is implied by a shared-infra change,
        // the feature services are not. Reaching them by dispatch must not make them a side effect of a push.
        expect(flags['deploy_food']).toBe('false');
        expect(flags['deploy_recipe']).toBe('false');
        expect(flags['deploy_service']).toBe('true');
        expect(flags['deploy_webhooks']).toBe('true');
    });

    it('deploys exactly the feature service whose own paths changed', () => {
        const food = push('food');

        expect(food['deploy_food']).toBe('true');
        expect(food['deploy_recipe']).toBe('false');

        const recipe = push('recipe');

        expect(recipe['deploy_recipe']).toBe('true');
        expect(recipe['deploy_food']).toBe('false');

        // Feature-only changes must not drag identity along.
        //
        // ⚠️ This used to also assert `run_migrations === 'false'`. That output is gone: the schema apply is
        // ungated (ADR-0035), because a path-diff gate skips it in exactly the case it exists for. What
        // remains true, and is what this test was really about, is that a recipe-only push does not deploy
        // identity — the ORDERING of identity's schema against identity's service is
        // `prodDeployMigrationOrder.test.ts`'s.
        expect(recipe['deploy_service']).toBe('false');
        expect(recipe['deploy_webhooks']).toBe('false');
    });
});

/**
 * ## The deploy graph is CLOSED — a consumer leg never deploys without its producer
 *
 * Every assertion above describes the gate's PATH-DIFF half, and that half was the whole gate. Each leg was
 * decided in isolation, so a change touching only `packages/services/identity-webhooks/**` set
 * `deploy_webhooks=true` and `deploy_global=false` — and `WebhooksStack` resolves
 * `kitchensink-service-logs-{stage}:IdentityServiceLogGroupName`, an export of `ServiceLogsStack`, which
 * ADR-0028 made a child of the GLOBAL app. The ADR recorded that the new stack "already deploys before both
 * consumers, so no deploy order changed": true of the ORDER, false of the GATE, because the earlier leg does
 * not run at all.
 *
 * That is not hypothetical. Measured against the live account on 2026-09-02, `kitchensink-service-logs-prod`
 * DOES NOT EXIST — ADR-0028 added it on 2026-08-30 and prod has had no platform deploy since — so the next
 * webhooks-only merge would have failed inside `cdk deploy` on `No export named … found`.
 *
 * These scenarios drive the step's REAL bash against the REAL `deploy-gate.sh`, so deleting the closure call
 * from the workflow reds them. Nothing here enumerates an edge: the edge list is derived from the CDK source
 * (`scripts/infrastructureManifest.mjs`) and asserted separately by `crossAppImportClosure.test.ts`; these
 * tests only prove the workflow ACTS on an unmet one.
 */
describe('prod-deploy.yml — the deploy graph is closed against unmet cross-app imports', () => {
    /** The edge the account was actually missing on 2026-09-02, in the form the probe step publishes. */
    const SERVICE_LOGS_UNMET =
        'packages/services/identity-webhooks/infra/bin/app.ts>packages/infra/global/bin/app.ts>' +
        'kitchensink-service-logs-prod:IdentityServiceLogGroupName';

    it('forces the global leg when a deploying webhooks leg needs an export prod has not published', () => {
        const flags = pushWithUnmet(SERVICE_LOGS_UNMET, 'webhooks');

        expect(flags['deploy_webhooks']).toBe('true');
        expect(flags['deploy_global']).toBe('true');
    });

    it('leaves the global leg alone when the consumer that needs the export is not deploying', () => {
        // ⛔ The narrowness ADR-0010's cost argument demands. If an unmet export forced the platform leg
        // regardless of who needed it, a food-only merge would roll RDS, the VPC and the edge to prod as a
        // side effect — and it would do so on EVERY push until somebody noticed.
        const flags = pushWithUnmet(SERVICE_LOGS_UNMET, 'food');

        expect(flags['deploy_food']).toBe('true');
        expect(flags['deploy_global']).toBe('false');
        expect(flags['deploy_webhooks']).toBe('false');
    });

    it('changes nothing at all when every cross-app export is published', () => {
        // The steady state, which must stay exactly as cheap as it was.
        expect(pushWithUnmet('', 'webhooks')).toMatchObject({
            deploy_webhooks: 'true',
            deploy_global: 'false',
            deploy_service: 'false',
            deploy_food: 'false',
            deploy_recipe: 'false',
        });
    });

    it('closes a leg its consumer forced, so the forced leg gets its schema too', () => {
        // ⚠️ REWRITTEN, not deleted. It used to assert `run_migrations === 'true'` here, on the reasoning
        // that a leg the closure FORCES still owes its schema and computing that flag from the pre-closure
        // values would skip the migrate step for exactly the deploy that was added late.
        //
        // The flag is gone — the schema apply is ungated now, so nothing can skip it — but the closure it
        // was testing is not, and it is what makes the forced leg's schema deploy run at all: the schema
        // `cdk deploy` is gated on `deploy_service`, so a closure that failed to set it would deploy the
        // identity service against a runner nothing had updated.
        //
        // The edge used here is the PRE-ADR-0028 one, which was real until 2026-08-30: webhooks imported the
        // log group name straight from `kitchensink-identity-service-{stage}`.
        const flags = pushWithUnmet(
            'packages/services/identity-webhooks/infra/bin/app.ts>packages/services/identity/infra/bin/app.ts>' +
                'kitchensink-identity-service-prod:IdentityServiceLogGroupName',
            'webhooks',
        );

        expect(flags['deploy_service']).toBe('true');
    });

    it('reads the unmet edges as DATA, never as script text', () => {
        // zizmor `template-injection`, asserted behaviourally rather than by inspection: the value arrives
        // through the step's `env:` block, so shell metacharacters in it can only ever be an invalid edge
        // token. Interpolated into the body they would be source code.
        const step = flagsStep();

        expect(Object.values(step.env ?? {}).join(' ')).toContain('steps.imports.outputs.unmet_imports');
        expect(step.run).not.toContain('steps.imports.outputs');
    });
});
