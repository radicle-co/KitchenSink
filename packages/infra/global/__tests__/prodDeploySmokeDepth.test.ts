// @vitest-environment node
/**
 * Repo-wide guard: a post-deploy smoke must be able to FAIL for the reason it claims to check.
 *
 * `workflowInvariants.test.ts` invariant 5 already catches the crude form — a step named "Smoke test" that
 * swallows its own exit status. This file catches the two subtler forms, both of which were live on
 * `prod-deploy.yml` when it was written:
 *
 * | # | The silent pass | The step that had it |
 * |---|---|---|
 * | 1 | an env-gated test suite that NOTHING sets the gate for | `prodWebSurface.integration.test.ts` (`describe.runIf(PROD_WEB_SMOKE_ORIGIN)`) |
 * | 2 | a smoke that asserts only `/health` → 200, which a STALE task satisfies | "Smoke test — identity service live & reachable (prod)" (#137) |
 *
 * Neither is visible to `actionlint`, `zizmor`, or CodeQL: both are green YAML that verifies less than its
 * name claims.
 *
 * ## 1 — an env-gated suite nobody sets the gate for
 *
 * `describe.runIf(process.env['X'] !== undefined)` is the correct shape for a probe that needs the public
 * internet: it keeps a prod outage from redding every laptop and per-PR run. But it only becomes a GATE once
 * some workflow sets `X` **and runs that file**. Until then it is a test that reports success by not
 * executing — which is the same class of defect as a `|| true`, minus the grep-ability.
 *
 * The analyzer discovers the gate variables from the TEST SOURCES rather than a hardcoded list, so renaming
 * the gate in the test without updating the workflow fails here. It also requires the SAME step that sets the
 * variable to name the test file, because an `env:` on an unrelated step would otherwise satisfy it while the
 * suite still never ran.
 *
 * Scope is this package's `__tests__/` only. The repo-wide `DATABASE_URL`-gated integration tiers are a
 * different mechanism (a harness the CI job boots, not a per-step `env:`), and folding them in here would
 * need an allowlist long enough to hide the finding this file exists to surface.
 *
 * ## 2 — a smoke that a stale task passes
 *
 * `GET /health` → 200 proves a container is running. It does not prove it is the container this deploy just
 * built, and it does not prove a BROWSER can reach it — a service whose auth middleware answers the
 * credential-less CORS preflight with 401 is healthy to `curl` and unreachable to every browser. A recipe
 * build served `pr-73` for fifteen days behind exactly that green `/health`.
 *
 * So the rule is derived from the workflow itself: **every deploy flag that gates an image push must also
 * gate a smoke that compares the RUNNING image tag to the one this deploy built**, with the running tag read
 * from the live ECS task definition. Reading it from `github.sha` on both sides is a tautology that can never
 * fail, so that shape is rejected explicitly.
 *
 * ## Mutation evidence
 *
 * Written before the steps it demands, and watched fail:
 *
 *   - analyzer 1 reported `PROD_WEB_SMOKE_ORIGIN … set by no workflow step that runs it` against the real
 *     tree, and still reported it when the step existed but its `env:` was moved to a neighbouring step.
 *   - analyzer 2 reported `deploy_service → pushes an image but no smoke gated on it checks image currency`
 *     against the real tree, and reported the tautology form when `--running-image-tag` was fed
 *     `${{ github.sha }}` instead of the tag read from ECS.
 *   - both negative-control fixtures below fail if the corresponding positive rule is loosened.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));
/**
 * Both test tiers. The env-gated suite this analyzer exists for lives in the INTEGRATION tier — it probes a
 * live origin — and scanning only `__tests__/` silently found nothing the moment that tier was split out to
 * `tests/`, which is the failure mode where a discovery-based check reports "no violations" because it
 * looked in the wrong place. Reported paths carry the directory so the tier is visible in the expectation.
 */
const TEST_DIRS = [fileURLToPath(new URL('./', import.meta.url)), fileURLToPath(new URL('../tests/', import.meta.url))];
const PROD_DEPLOY = 'prod-deploy.yml';

interface WorkflowStep {
    readonly name?: string;
    readonly if?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly if?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface Workflow {
    readonly file: string;
    readonly doc: WorkflowDocument;
}

/** Parse every workflow in a directory, in filename order. */
function load(directory: string): readonly Workflow[] {
    return readdirSync(directory)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(directory, file), 'utf8')) as WorkflowDocument }));
}

/** The real `.github/workflows/` tree. */
function realWorkflows(): readonly Workflow[] {
    return load(WORKFLOW_DIR);
}

/** One `prod-deploy.yml` document, by filename rather than by position. */
function prodDeploy(): WorkflowDocument {
    const found = realWorkflows().find((workflow) => workflow.file === PROD_DEPLOY);

    if (found === undefined) {
        throw new Error(`${PROD_DEPLOY} is missing — every assertion in this file is anchored on it.`);
    }

    return found.doc;
}

/** Every step in a workflow, paired with its job name. */
function allSteps(doc: WorkflowDocument): readonly { readonly job: string; readonly step: WorkflowStep }[] {
    return Object.entries(doc.jobs ?? {}).flatMap(([job, definition]) =>
        (definition.steps ?? []).map((step) => ({ job, step })),
    );
}

/** A step's stable identity for violation messages. */
function stepLabel(step: WorkflowStep): string {
    return step.name ?? (step.run ?? '').split('\n')[0]?.trim() ?? '(unnamed)';
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — env-gated suites that nothing switches on
// ---------------------------------------------------------------------------------------------------------

/** A suite-level env gate found in a test file: which variable decides whether the suite runs at all. */
interface EnvGate {
    readonly file: string;
    readonly variable: string;
}

/**
 * Suite-level env gates in a directory of test files. Pure apart from reading the files.
 *
 * Matches `const NAME = process.env['VAR']` bindings, then keeps the ones a `describe.runIf` / `describe.skipIf`
 * argument mentions. Deliberately narrow: an `it.runIf` narrows a suite that already ran, so it is not the
 * "the whole file never executed" defect this analyzer is about.
 */
function findEnvGates(directories: readonly string[]): readonly EnvGate[] {
    const gates: EnvGate[] = [];

    for (const directory of directories) {
        if (!existsSync(directory)) {
            continue;
        }

        // The directory's own name, so a gate reads `tests/foo.integration.test.ts` and the tier is obvious.
        const tier = basename(directory.replace(/\/$/, ''));

        for (const name of readdirSync(directory)
            .filter((entry) => entry.endsWith('.test.ts'))
            .sort()) {
            const file = `${tier}/${name}`;
            const source = readFileSync(join(directory, name), 'utf8');
            const bindings = new Map(
                [...source.matchAll(/const\s+(\w+)\s*=\s*process\.env\['([^']+)'\]/g)].map((match) => [
                    match[1] as string,
                    match[2] as string,
                ]),
            );

            for (const gate of source.matchAll(/describe\.(?:runIf|skipIf)\(([^)]*)\)/g)) {
                for (const [constant, variable] of bindings) {
                    if (new RegExp(`\\b${constant}\\b`).test(gate[1] ?? '')) {
                        gates.push({ file, variable });
                    }
                }
            }
        }
    }

    return gates;
}

/**
 * Gates that no workflow step both SETS and RUNS.
 *
 * Both halves matter. A step that runs the file without setting the variable executes an empty suite; a step
 * that sets the variable without running the file sets it for nothing. Only the conjunction is a gate.
 */
function findUnwiredEnvGates(gates: readonly EnvGate[], workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, variable } of gates) {
        const wired = workflows.some(({ doc }) =>
            allSteps(doc).some(({ step }) => {
                const value = step.env?.[variable] ?? doc.env?.[variable];

                return value !== undefined && String(value) !== '' && (step.run ?? '').includes(file);
            }),
        );

        if (!wired) {
            violations.push(
                `${file} → suite is gated on \`${variable}\`, which no workflow step both sets and runs the ` +
                    'file with, so the suite reports success by never executing',
            );
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — smokes a stale task would pass
// ---------------------------------------------------------------------------------------------------------

/** `docker buildx build … --push`: the step that puts a new image in ECR. */
const IMAGE_PUSH = /docker buildx build[\s\S]*--push/;

/** The deploy flags a step's `if:` reads, e.g. `deploy_service`. */
function gatingFlags(step: WorkflowStep): readonly string[] {
    return [...(step.if ?? '').matchAll(/steps\.flags\.outputs\.(deploy_\w+)/g)].map((match) => match[1] as string);
}

/** The workspace directory a push step builds from, e.g. `packages/services/food-service`. */
function builtPackage(step: WorkflowStep): string | undefined {
    return (step.run ?? '').match(/-f\s+(packages\/services\/[\w-]+)\/Dockerfile/)?.[1];
}

/**
 * Whether a service is reachable from a BROWSER, decided by whether its own bootstrap enables CORS.
 *
 * DERIVED, not listed, and that distinction is the whole point. The browser-reachability assertion applies
 * to identity and recipe (both call `app.enableCors(…)` in `main.ts`, and the web app calls both
 * cross-origin) and does NOT apply to the food service, which has no `enableCors` at all because nothing
 * outside the cluster calls it — its only consumer is the recipe service, server-to-server via
 * `foodCatalog.gateway.ts`. Sending food a preflight asserts something false by design: `OPTIONS
 * /api/v1/recipes` against it is an app 404.
 *
 * The two alternatives were both worse. An exception list here would be a place to add a service to in
 * order to make a check go away. Giving food CORS purely so a smoke could pass would open a browser-facing
 * surface with no browser consumer, to satisfy a test. Reading the source means a service that GAINS CORS
 * immediately owes the assertion, and one that has it cannot silently drop it.
 *
 * @sideEffect Reads the service's `main.ts`.
 */
function isBrowserFacing(servicePackage: string): boolean {
    try {
        return /\.enableCors\s*\(/.test(readFileSync(join(REPO_ROOT, servicePackage, 'src/main.ts'), 'utf8'));
    } catch {
        // A service with no `src/main.ts` is not a Nest HTTP app; treat it as not browser-facing rather
        // than inventing a violation.
        return false;
    }
}

/**
 * Deploy flags that push an image but whose smoke cannot tell a fresh task from a stale one.
 *
 * The expectation is derived from the workflow, not listed here: whatever gates an image push must also gate
 * an image-currency assertion. A new service leg therefore inherits the requirement automatically, which is
 * the whole point — #137 existed because identity's smoke was written before the check existed and nothing
 * re-examined it afterwards.
 */
function findShallowImageSmokes(doc: WorkflowDocument): readonly string[] {
    const violations: string[] = [];
    const steps = allSteps(doc);
    const pushSteps = steps.filter(({ step }) => IMAGE_PUSH.test(step.run ?? ''));
    const pushing = new Set(pushSteps.flatMap(({ step }) => gatingFlags(step)));
    /** flag → the workspace whose Dockerfile that flag's push step builds. */
    const packageOf = new Map(
        pushSteps.flatMap(({ step }) => {
            const servicePackage = builtPackage(step);

            return servicePackage === undefined ? [] : gatingFlags(step).map((flag) => [flag, servicePackage] as const);
        }),
    );

    for (const flag of [...pushing].sort()) {
        const candidates = steps.filter(
            ({ step }) => gatingFlags(step).includes(flag) && (step.run ?? '').includes('--expected-image-tag'),
        );

        if (candidates.length === 0) {
            violations.push(
                `${flag} → pushes an image but no smoke gated on it asserts image currency: ` +
                    '`/health` → 200 is satisfied by a task running a build from weeks ago',
            );
            continue;
        }

        for (const { step } of candidates) {
            const run = step.run ?? '';

            // The tag under test must come from the RUNNING task, or the comparison is `sha == sha`.
            if (!/describe-task-definition[\s\S]*containerDefinitions\[0\]\.image/.test(run)) {
                violations.push(
                    `${flag}::${stepLabel(step)} → asserts image currency without reading the running task ` +
                        "definition's image, so it cannot know what is actually deployed",
                );
            }

            if (/--running-image-tag\s+"?\$\{\{\s*github\.sha\s*\}\}"?/.test(run)) {
                violations.push(
                    `${flag}::${stepLabel(step)} → compares github.sha to github.sha, a tautology that passes ` +
                        'however stale the running task is',
                );
            }

            // Browser reachability is the other thing `/health` cannot see: a credential-less CORS preflight
            // answered by auth middleware is a 401, i.e. healthy to curl and dead to every browser. Required
            // exactly when the service ENABLES CORS, and forbidden when it does not — see isBrowserFacing.
            const servicePackage = packageOf.get(flag);
            const browserFacing = servicePackage !== undefined && isBrowserFacing(servicePackage);

            if (browserFacing && !run.includes('--web-origin')) {
                violations.push(
                    `${flag}::${stepLabel(step)} → checks image currency but not browser reachability ` +
                        `(no --web-origin, and ${servicePackage as string}/src/main.ts enables CORS, so a CORS ` +
                        'regression stays invisible)',
                );
            }

            if (!browserFacing && run.includes('--web-origin')) {
                // Not pedantry: the preflight would fail, so the smoke would red for a reason that has
                // nothing to do with the deploy — and the fix people reach for is deleting the smoke.
                violations.push(
                    `${flag}::${stepLabel(step)} → passes --web-origin for a service that does NOT enable ` +
                        `CORS (${servicePackage ?? 'unknown package'}), so the preflight asserts a browser ` +
                        'path that does not exist and the smoke fails for a reason unrelated to the deploy',
                );
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — assertions
// ---------------------------------------------------------------------------------------------------------

describe('every env-gated suite in this package is switched on by a workflow', () => {
    it('finds the suite-level gate variable in the test sources', () => {
        // Anchors the discovery half: if the gate is renamed, or the `describe.runIf` becomes an
        // unconditional `describe`, this stops matching and the wiring assertion below loses its subject.
        expect(findEnvGates(TEST_DIRS)).toEqual([
            { file: 'tests/prodWebSurface.integration.test.ts', variable: 'PROD_WEB_SMOKE_ORIGIN' },
        ]);
    });

    it('flags a gate that no workflow sets', () => {
        const violations = findUnwiredEnvGates(
            [{ file: 'live-probe.integration.test.ts', variable: 'LIVE_PROBE_ORIGIN' }],
            load(WORKFLOW_DIR),
        );

        expect(violations.join('\n')).toMatch(/LIVE_PROBE_ORIGIN/);
    });

    it('flags a gate whose variable is set by a step that does not run the file', () => {
        const gates = [{ file: 'probe.integration.test.ts', variable: 'PROBE_ORIGIN' }];
        const workflows: readonly Workflow[] = [
            {
                file: 'split.yml',
                doc: {
                    jobs: {
                        deploy: {
                            steps: [
                                { name: 'Set it', env: { PROBE_ORIGIN: 'https://example.com' }, run: 'echo nothing' },
                                { name: 'Run it', run: 'npx vitest run __tests__/probe.integration.test.ts' },
                            ],
                        },
                    },
                },
            },
        ];

        // The defect this negative control pins: an `env:` on the wrong step reads like wiring and is not.
        expect(findUnwiredEnvGates(gates, workflows).join('\n')).toMatch(/PROBE_ORIGIN/);
    });

    it('does NOT flag a gate set by the step that runs the file', () => {
        const gates = [{ file: 'probe.integration.test.ts', variable: 'PROBE_ORIGIN' }];
        const workflows: readonly Workflow[] = [
            {
                file: 'joined.yml',
                doc: {
                    jobs: {
                        deploy: {
                            steps: [
                                {
                                    name: 'Probe',
                                    env: { PROBE_ORIGIN: 'https://example.com' },
                                    run: 'npx vitest run __tests__/probe.integration.test.ts',
                                },
                            ],
                        },
                    },
                },
            },
        ];

        expect(findUnwiredEnvGates(gates, workflows)).toEqual([]);
    });

    it('holds for the real tree', () => {
        expect(
            findUnwiredEnvGates(findEnvGates(TEST_DIRS), realWorkflows()),
            'an env-gated probe that nothing sets the gate for is a test that passes by not running — the ' +
                'same silent success as a `|| true`, without the grep-ability',
        ).toEqual([]);
    });

    it('runs the live web-surface probe UNGATED by any deploy flag', () => {
        // The web app is deployed by Vercel's git integration, not by this workflow, so no
        // `steps.flags.outputs.deploy_*` says anything about whether its surface is worth checking. Gating the
        // probe on one would mean a webhooks-only merge silently stops looking at production's front door.
        const probes = allSteps(prodDeploy()).filter(({ step }) =>
            (step.run ?? '').includes('prodWebSurface.integration.test.ts'),
        );

        expect(probes.length).toBeGreaterThan(0);

        for (const { step } of probes) {
            expect(gatingFlags(step), `${stepLabel(step)} must not be gated on a deploy flag`).toEqual([]);
        }
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — assertions
// ---------------------------------------------------------------------------------------------------------

describe('every image-pushing leg of prod-deploy.yml has a smoke a stale task would fail', () => {
    it('flags a leg whose smoke never mentions the expected image tag', () => {
        const violations = findShallowImageSmokes({
            jobs: {
                deploy: {
                    steps: [
                        {
                            name: 'Push',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run: 'docker buildx build -t image --push .',
                        },
                        {
                            name: 'Smoke test — thing is live',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run: 'curl -f https://thing.example.com/health',
                        },
                    ],
                },
            },
        });

        expect(violations.join('\n')).toMatch(/deploy_thing → pushes an image/);
    });

    it('flags a smoke that compares github.sha to itself', () => {
        const violations = findShallowImageSmokes({
            jobs: {
                deploy: {
                    steps: [
                        {
                            name: 'Push',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run: 'docker buildx build -t image --push .',
                        },
                        {
                            name: 'Smoke test — thing is current',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run:
                                'npx tsx smoke.ts --web-origin https://example.com ' +
                                '--expected-image-tag "${{ github.sha }}" --running-image-tag "${{ github.sha }}"',
                        },
                    ],
                },
            },
        });

        expect(violations.join('\n')).toMatch(/tautology/);
        // …and separately, that it never asked ECS what is running.
        expect(violations.join('\n')).toMatch(/running task/);
    });

    it('flags a BROWSER-FACING service whose currency check ignores browser reachability', () => {
        // `packages/services/identity` really does call `app.enableCors(…)`, so this fixture's push step
        // makes the analyzer demand `--web-origin` — the requirement is derived from that source file, not
        // from a list here, so this case dies the moment identity stops being browser-facing.
        const violations = findShallowImageSmokes({
            jobs: {
                deploy: {
                    steps: [
                        {
                            name: 'Push',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run: 'docker buildx build -f packages/services/identity/Dockerfile -t image --push .',
                        },
                        {
                            name: 'Smoke test — thing is current',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run:
                                'image=$(aws ecs describe-task-definition --query ' +
                                "'taskDefinition.containerDefinitions[0].image')\n" +
                                'npx tsx smoke.ts --expected-image-tag "${{ github.sha }}" ' +
                                '--running-image-tag "${image##*:}"',
                        },
                    ],
                },
            },
        });

        expect(violations.join('\n')).toMatch(/--web-origin/);
        expect(violations.join('\n')).toMatch(/enables CORS/);
    });

    it('does NOT demand browser reachability from a service that enables no CORS', () => {
        // `packages/services/food-service/src/main.ts` has no `enableCors`: nothing outside the cluster
        // calls it (the recipe service does, server-to-server). Demanding a preflight here would be
        // demanding an assertion that is false by design.
        const violations = findShallowImageSmokes({
            jobs: {
                deploy: {
                    steps: [
                        {
                            name: 'Push',
                            if: "steps.flags.outputs.deploy_food == 'true'",
                            run: 'docker buildx build -f packages/services/food-service/Dockerfile -t image --push .',
                        },
                        {
                            name: 'Smoke test — food is current',
                            if: "steps.flags.outputs.deploy_food == 'true'",
                            run:
                                'image=$(aws ecs describe-task-definition --task-definition "$td" --query ' +
                                "'taskDefinition.containerDefinitions[0].image' --output text)\n" +
                                'npx tsx smoke.ts --expected-image-tag "${{ github.sha }}" ' +
                                '--running-image-tag "${image##*:}"',
                        },
                    ],
                },
            },
        });

        expect(violations).toEqual([]);
    });

    it('flags --web-origin passed to a service that enables no CORS', () => {
        // The other direction, and not pedantry: the preflight would fail, so the smoke would red for a
        // reason unrelated to the deploy — and the fix people reach for when that happens is deleting it.
        const violations = findShallowImageSmokes({
            jobs: {
                deploy: {
                    steps: [
                        {
                            name: 'Push',
                            if: "steps.flags.outputs.deploy_food == 'true'",
                            run: 'docker buildx build -f packages/services/food-service/Dockerfile -t image --push .',
                        },
                        {
                            name: 'Smoke test — food is current',
                            if: "steps.flags.outputs.deploy_food == 'true'",
                            run:
                                'image=$(aws ecs describe-task-definition --task-definition "$td" --query ' +
                                "'taskDefinition.containerDefinitions[0].image' --output text)\n" +
                                'npx tsx smoke.ts --web-origin https://example.com ' +
                                '--expected-image-tag "${{ github.sha }}" --running-image-tag "${image##*:}"',
                        },
                    ],
                },
            },
        });

        expect(violations.join('\n')).toMatch(/does NOT enable/);
    });

    it('does NOT flag a leg whose smoke reads the running task definition', () => {
        const violations = findShallowImageSmokes({
            jobs: {
                deploy: {
                    steps: [
                        {
                            name: 'Push',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run: 'docker buildx build -f packages/services/identity/Dockerfile -t image --push .',
                        },
                        {
                            name: 'Smoke test — thing is current',
                            if: "steps.flags.outputs.deploy_thing == 'true'",
                            run:
                                'image=$(aws ecs describe-task-definition --task-definition "$td" --query ' +
                                "'taskDefinition.containerDefinitions[0].image' --output text)\n" +
                                'npx tsx smoke.ts --web-origin https://example.com ' +
                                '--expected-image-tag "${{ github.sha }}" --running-image-tag "${image##*:}"',
                        },
                    ],
                },
            },
        });

        expect(violations).toEqual([]);
    });

    it('is not vacuous: the real workflow does push images under deploy flags', () => {
        // Pins the discovery half. If `docker buildx build … --push` is ever renamed or restructured, the
        // real-tree assertion below would go quiet rather than red, so measure the subject explicitly.
        const pushing = new Set(
            allSteps(prodDeploy())
                .filter(({ step }) => IMAGE_PUSH.test(step.run ?? ''))
                .flatMap(({ step }) => gatingFlags(step)),
        );

        expect([...pushing].sort()).toEqual(['deploy_food', 'deploy_recipe', 'deploy_service']);
    });

    it('EVERY image-pushing leg now has a smoke a stale task would fail', () => {
        expect(
            findShallowImageSmokes(prodDeploy()),
            'a smoke that only checks `/health` passes for a task running a build from weeks ago (#137)',
        ).toEqual([]);
    });

    it('derives the browser-reachability requirement from each service, and gets a real answer', () => {
        // Guards the derivation itself. If `isBrowserFacing` silently started answering `false` for
        // everything — a moved `main.ts`, a renamed `enableCors` — the assertion above would go quiet
        // rather than red, because "not browser-facing" is the permissive answer.
        expect({
            identity: isBrowserFacing('packages/services/identity'),
            recipe: isBrowserFacing('packages/services/recipe-service'),
            food: isBrowserFacing('packages/services/food-service'),
        }).toEqual({ identity: true, recipe: true, food: false });
    });
});
