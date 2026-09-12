// @vitest-environment node
/**
 * Repo-wide guard: **a schema stack's `cdk deploy` runs under exactly the conditions that BUILT its asset.**
 *
 * ## The defect this was written for, which shipped and was caught in review
 *
 * ADR-0035 makes the migrate INVOKE unconditional, for the reason `run-migrations.sh` records at length: a
 * path-diff gate skips the net in precisely the case it exists for. That argument is about the invoke. It
 * was applied to the schema `cdk deploy` too, and there it is wrong, because that step has INPUTS — the
 * compiled CDK app and `dist-lambda/` — produced by steps that are themselves gated.
 *
 * Ungated, on a push that built neither:
 *
 *  - the deploy fails with `MODULE_NOT_FOUND` (the CDK app is absent) — loud, but it reds a production
 *    deploy for a service the push never touched; or, far worse,
 *  - the CDK app exists and `dist-lambda/` does not, so the stack synthesizes the THROWING inline
 *    placeholder and `cdk deploy` SUCCEEDS — replacing a working migration runner with a stub. The migrate
 *    step then fails, but the damage is already committed and persists until someone touches that service.
 *
 * ## Why equality, and why gating the deploy costs the ADR nothing
 *
 * ADR-0035's property lives in the invoke's `expectManifestSha`, not in the deploy's unconditionality. A
 * service's migrations sit under that service's own path, so either they changed — the flag is true and the
 * deploy runs — or they did not, and the previously-deployed runner still holds a set whose digest matches
 * the working tree. A runner stale for any OTHER reason is caught by the invoke refusing, which is the
 * whole point of the expectation.
 *
 * ⛔ IT ENUMERATES NOTHING. Both sides are derived from the step's own text: the schema deploy names its
 * `--app`, which names the service package, which is the workspace its `bundle:lambda` step names. A fourth
 * service is covered the day it lands.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** One workflow step, reduced to what this guard reads. */
interface Step {
    readonly name?: string;
    readonly if?: string;
    readonly run?: string;
}

/** A schema deploy paired with the step that built the asset it ships. */
interface SchemaDeploy {
    readonly workflow: string;
    readonly job: string;
    /** The service package the deploy's `--app` names, e.g. `packages/services/recipe-service`. */
    readonly servicePackage: string;
    /** The stack selector the command passes to `cdk deploy`. */
    readonly selector: string;
    readonly deployIf: string;
    readonly bundleIf: string | undefined;
}

/** Every deploy workflow, parsed. */
function workflows(): readonly { readonly file: string; readonly jobs: Record<string, { steps?: Step[] }> }[] {
    // ⚠️ EVERY workflow, not a `*deploy*` glob. The first draft used one and missed `_sandbox-preview.yml`
    // the moment the deploy jobs moved there — a discovery predicate that silently stopped seeing two of
    // the six schema deploys, which is the exact rot every anti-vacuity anchor in this directory exists for.
    //
    // ⛔ AND COMPOSITE ACTIONS, for the second turn of that same wheel. When every deploy became one job per
    // `infra/` folder, the schema deploy moved OUT of the workflows entirely and into
    // `.github/actions/infra-package/action.yml` — so a workflows-only glob went from seeing six to seeing
    // four, silently. A composite action's steps live under `runs.steps` rather than `jobs.<id>.steps`, so
    // they are folded in under a synthetic job name that names the file they really came from.
    const workflowFiles = globSync('.github/workflows/*.yml', { cwd: REPO_ROOT })
        .sort()
        .map((file) => ({
            file,
            jobs:
                (
                    yaml.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')) as {
                        jobs?: Record<string, { steps?: Step[] }>;
                    }
                ).jobs ?? {},
        }));

    const actionFiles = globSync('.github/actions/*/action.yml', { cwd: REPO_ROOT })
        .sort()
        .map((file) => {
            const steps =
                (yaml.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')) as { runs?: { steps?: Step[] } }).runs
                    ?.steps ?? [];

            return { file, jobs: { runs: { steps } } };
        });

    return [...workflowFiles, ...actionFiles];
}

/**
 * Every schema `cdk deploy` in the tree, paired with its own job's bundle step.
 *
 * @returns One entry per schema deploy step. Impure.
 * @sideEffect Reads the workflow files.
 */
export function schemaDeploys(): readonly SchemaDeploy[] {
    return workflows().flatMap(({ file, jobs }) =>
        Object.entries(jobs).flatMap(([job, definition]) => {
            const steps = definition.steps ?? [];

            return steps.flatMap((step) => {
                const run = step.run ?? '';

                if (!/cdk deploy "kitchensink-[a-z]+-schema-/u.test(run)) {
                    return [];
                }

                // DERIVED from the deploy's own `--app` string, so the pairing cannot drift from the step.
                // ⚠️ RUNNER-AGNOSTIC. This matched `--app "node …"` literally, and every CDK app is now
                // launched by its own package's `tsx` (`<pkg>/infra/node_modules/.bin/tsx …`) because no
                // runner survives `npm prune --omit=dev` at the root. Naming the runner meant six real
                // schema deploys became "no --app this guard can attribute" — a guard going quiet, not red.
                const servicePackage = /--app "\S*?(packages\/services\/[a-z-]+)\/infra/u.exec(run)?.[1] ?? '';
                const selector = /cdk deploy "([^"]+)"/u.exec(run)?.[1] ?? '';
                const bundle = steps.find((candidate) =>
                    (candidate.run ?? '').includes(`bundle:lambda --workspace=${servicePackage}`),
                );

                return [
                    {
                        workflow: file,
                        job,
                        servicePackage,
                        selector,
                        deployIf: step.if ?? '',
                        bundleIf: bundle === undefined ? undefined : (bundle.if ?? ''),
                    },
                ];
            });
        }),
    );
}

describe('a schema deploy names a stack `cdk deploy` will actually match', () => {
    it('⛔ every selector equals a construct id the app declares', () => {
        // ⛔ MEASURED, not theorised. `cdk deploy <selector>` matches a stack's CONSTRUCT ID, not its
        // CloudFormation name — `cdk deploy "kitchensink-food-schema-pr-91"` answered
        // `No stacks match the name(s) …` against an app that declared it perfectly, and the deploy failed
        // AFTER building and pushing an image.
        //
        // Every other consumer addresses the stack by its CloudFormation name, because that is what
        // CloudFormation knows. The schema stacks therefore use ONE string for both, and this is what says
        // so: the selector in the workflow must be the id the `new *SchemaStack(app, …)` call passes.
        const violations = schemaDeploys().flatMap((deploy) => {
            const app = globSync(`${deploy.servicePackage}/infra/bin/app.ts`, { cwd: REPO_ROOT })[0];

            if (app === undefined) {
                return [`${deploy.workflow}: ${deploy.servicePackage} has no CDK entrypoint to check against`];
            }

            const source = readFileSync(path.join(REPO_ROOT, app), 'utf8');
            // ⚠️ The literal, not a binding. It is spelled inline in the app for a reason the app states:
            // three other guards derive this app's stacks by reading exactly this template out of the
            // `new …Stack(app, …)` call, and hoisting it to a variable made all of them resolve nothing.
            const declared = [...source.matchAll(/new \w*SchemaStack\(\s*app,\s*`([^`]+)`\s*,/gu)].map(
                ([, value]) => value,
            );
            // `${stage}` in the app, `${STAGE}` in the shell — one template, two spellings.
            const normalise = (value: string): string => value.replace(/\$\{stage\}|\$\{STAGE\}/gu, '{stage}');
            const selector = normalise(deploy.selector);

            return declared.map(normalise).includes(selector)
                ? []
                : [
                      `${deploy.workflow}:${deploy.job} deploys "${deploy.selector}", which is not a construct id ` +
                          `${app} declares (it declares: ${declared.join(', ') || 'none'}). ` +
                          '`cdk deploy` matches the construct id, so this fails AFTER the image is built.',
                  ];
        });

        expect(violations).toStrictEqual([]);
    });
});

/**
 * The half of the schema-deploy contract that the composite action parameterised away.
 *
 * `action.yml` deploys `"${SCHEMA_STACK}-${STAGE}"`, so the STACK NAME is no longer readable from the step —
 * it is an input, supplied once per job in `deploy-infra.yml`. These assertions put the literal back under
 * guard at the place it now lives, so "which databases get a schema deploy" cannot drift silently.
 */
describe('every database-backed package declares its schema stack at the call site', () => {
    const callSites = (): Record<string, Record<string, string>> => {
        const doc = yaml.parse(readFileSync(path.join(REPO_ROOT, '.github/workflows/deploy-infra.yml'), 'utf8')) as {
            jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, string> }[] }>;
        };

        return Object.fromEntries(
            Object.entries(doc.jobs ?? {}).flatMap(([job, definition]) => {
                const step = (definition.steps ?? []).find(({ uses }) => uses?.endsWith('infra-package'));

                return step?.with ? [[job, step.with] as const] : [];
            }),
        );
    };

    it('is not vacuous: every infra package has a call site', () => {
        expect(Object.keys(callSites()).length).toBeGreaterThanOrEqual(9);
    });

    it('⛔ exactly the three services that own a database declare one', () => {
        const declaring = Object.entries(callSites())
            .filter(([, inputs]) => inputs['schema-stack'] !== undefined)
            .map(([job]) => job)
            .sort();

        // ⚠️ EQUALITY, not `arrayContaining`. A fourth package quietly acquiring a schema deploy, or one of
        // these three losing it, are both defects and both must be a red test.
        // ⚠️ The `-schema` JOBS, not the service jobs. ADR-0035 puts the schema ahead of everything that
        // reads it, and the first reader is often a different package: `recipe-workers` reads the recipe
        // database that `recipe-service`'s app declares, and deploys before it.
        expect(declaring).toEqual(['food-schema', 'identity-schema', 'recipe-schema']);
    });

    it('⛔ each names a migration runner, a database and a migrations directory alongside it', () => {
        for (const [job, inputs] of Object.entries(callSites())) {
            if (inputs['schema-stack'] === undefined) {
                continue;
            }

            // A schema stack with no runner deploys the stack and applies nothing — green, and the schema
            // never moves. ADR-0035's whole point is that those are separate facts that travel together.
            expect(inputs['migration-export'], `${job} declares a schema stack but no migration runner`).toBeTruthy();
            expect(inputs['migration-database'], `${job} declares a schema stack but no database`).toBeTruthy();
            expect(inputs['migrations-dir'], `${job} declares a schema stack but no migrations dir`).toBeTruthy();
            expect(inputs['aws-region'], `${job}'s migration invoke has no region`).toBeTruthy();
        }
    });
});

describe('a schema deploy runs under exactly the conditions that built its asset', () => {
    it('finds the schema deploys at all — a vacuous pass here would assert nothing below', () => {
        // ⛔ The ANCHOR. Was six — three in prod, two in the sandbox feature deploy, one in the sandbox
        // identity deploy. It is FOUR now, and the two that left did not disappear: when every deploy became
        // one job per `infra/` folder, the preview's two literal steps collapsed into ONE step in
        // `.github/actions/infra-package/action.yml` that deploys `"${SCHEMA_STACK}-${STAGE}"`.
        //
        // ⚠️ A PARAMETERISED stack name is invisible to a regex looking for `kitchensink-<x>-schema-`, which
        // is why the literal is asserted at the CALL SITES instead, in the test immediately below. Lowering
        // this number without that companion test would be exactly the vacuity this anchor exists to stop.
        expect(schemaDeploys().length).toBeGreaterThanOrEqual(4);
    });

    it('resolves each deploy to the service package whose asset it ships', () => {
        const unresolved = schemaDeploys()
            .filter((deploy) => deploy.servicePackage === '')
            .map((deploy) => `${deploy.workflow}:${deploy.job}`);

        expect(unresolved, 'these schema deploys name no --app this guard can attribute').toStrictEqual([]);
    });

    it('⛔ carries the SAME condition as the step that bundles its runner', () => {
        const mismatched = schemaDeploys().flatMap((deploy) => {
            if (deploy.bundleIf === undefined) {
                return [
                    `${deploy.workflow}:${deploy.job} deploys ${deploy.servicePackage}'s schema stack but that ` +
                        'job never bundles its Lambda — the stack would ship a throwing placeholder',
                ];
            }

            return deploy.deployIf === deploy.bundleIf
                ? []
                : [
                      `${deploy.workflow}:${deploy.job} deploys ${deploy.servicePackage}'s schema stack under ` +
                          `\`${deploy.deployIf || '(always)'}\` but bundles its asset under ` +
                          `\`${deploy.bundleIf || '(always)'}\`. On a run where the second is false and the ` +
                          'first is true, the stack synthesizes the THROWING inline placeholder and the ' +
                          'deploy SUCCEEDS — replacing a working runner with a stub that persists.',
                  ];
        });

        expect(mismatched).toStrictEqual([]);
    });

    it('⛔ never gates the schema deploy MORE loosely than the bundle, which is the damaging direction', () => {
        // Stated separately from the equality above because the two failures are not symmetric. A deploy
        // gated MORE tightly than its bundle merely wastes a build; a deploy gated more LOOSELY ships a
        // placeholder over a working runner. If the equality is ever relaxed to an implication, this is the
        // half that must survive.
        const looser = schemaDeploys()
            .filter((deploy) => deploy.bundleIf !== undefined && deploy.bundleIf !== '' && deploy.deployIf === '')
            .map((deploy) => `${deploy.workflow}:${deploy.job} (${deploy.servicePackage}) deploys unconditionally`);

        expect(looser).toStrictEqual([]);
    });
});
