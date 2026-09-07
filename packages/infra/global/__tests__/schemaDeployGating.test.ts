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
    readonly deployIf: string;
    readonly bundleIf: string | undefined;
}

/** Every deploy workflow, parsed. */
function workflows(): readonly { readonly file: string; readonly jobs: Record<string, { steps?: Step[] }> }[] {
    // ⚠️ EVERY workflow, not a `*deploy*` glob. The first draft used one and missed `_sandbox-preview.yml`
    // the moment the deploy jobs moved there — a discovery predicate that silently stopped seeing two of
    // the six schema deploys, which is the exact rot every anti-vacuity anchor in this directory exists for.
    return globSync('.github/workflows/*.yml', { cwd: REPO_ROOT })
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
                const servicePackage = /--app "node (packages\/services\/[a-z-]+)\/infra/u.exec(run)?.[1] ?? '';
                const bundle = steps.find((candidate) =>
                    (candidate.run ?? '').includes(`bundle:lambda --workspace=${servicePackage}`),
                );

                return [
                    {
                        workflow: file,
                        job,
                        servicePackage,
                        deployIf: step.if ?? '',
                        bundleIf: bundle === undefined ? undefined : (bundle.if ?? ''),
                    },
                ];
            });
        }),
    );
}

describe('a schema deploy runs under exactly the conditions that built its asset', () => {
    it('finds the schema deploys at all — a vacuous pass here would assert nothing below', () => {
        // ⛔ The ANCHOR. Six today: three in prod, two in the sandbox feature deploy, one in the sandbox
        // identity deploy. A regex that stopped matching would make every assertion below pass over nothing.
        expect(schemaDeploys().length).toBeGreaterThanOrEqual(6);
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
