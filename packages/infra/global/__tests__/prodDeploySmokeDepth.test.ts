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

import { minimatch } from 'minimatch';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { EDGE_POLICY } from '../lib/platform/EdgeStack.js';
import { scalarText } from './workflowScalar.js';

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
    /** Where the step runs — how a package outside the npm workspace is addressed. */
    readonly 'working-directory'?: string;
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
 * Matches `const NAME = process.env['VAR']` bindings — and a `const DERIVED = fn(NAME)` over one of them, the shape a
 * suite uses to vet the value before gating on it — then keeps the ones a `describe.runIf` / `describe.skipIf`
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

            for (const [, derived = '', argument = ''] of source.matchAll(/const\s+(\w+)\s*=\s*\w+\((\w+)\)/g)) {
                const variable = bindings.get(argument);

                if (variable !== undefined) {
                    bindings.set(derived, variable);
                }
            }

            for (const gate of source.matchAll(/describe\.(?:runIf|skipIf)\(([^)]*)\)/g)) {
                for (const [constant, variable] of bindings) {
                    // One entry per (file, variable): a file with several describes gated on the SAME variable
                    // states one fact — "this file needs that variable set" — and listing it twice would make
                    // the expectation below track how many describes a file happens to have.
                    const known = gates.some((seen) => seen.file === file && seen.variable === variable);

                    if (!known && new RegExp(`\\b${constant}\\b`).test(gate[1] ?? '')) {
                        gates.push({ file, variable });
                    }
                }
            }
        }
    }

    return gates;
}

/**
 * This package's own npm scripts, and the vitest `include` glob each one runs.
 *
 * ⚠️ Read from `package.json` + the config it names, never hard-coded. A step can run a gated suite two ways:
 * by naming the file (`npx vitest run tests/foo.integration.test.ts`, which is how `prod-deploy.yml` invokes
 * its one live probe) or by running the TIER that contains it (`npm run test:integration --workspace=…`,
 * which is how `_ci.yml` invokes every other integration spec in this package). A predicate that understood
 * only the first spelling reports a correctly-wired tier suite as unwired — the same defect shape
 * `cdkApps.ts` records for `npm run infra:deploy --workspace=`, where a reader that knew only the literal
 * `cdk deploy --app` spelling called a deployed app undeployed.
 *
 * @returns The `--workspace=` invocation that runs each tier, paired with the glob it includes. Impure.
 * @sideEffect Reads this package's manifest and its vitest configs.
 */
function tierInvocations(): readonly {
    readonly invocation: RegExp;
    readonly bareInvocation: RegExp;
    readonly include: string;
}[] {
    const packageRoot = fileURLToPath(new URL('../', import.meta.url));
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
        name: string;
        scripts: Record<string, string>;
    };
    const tiers: { invocation: RegExp; bareInvocation: RegExp; include: string }[] = [];

    for (const [script, body] of Object.entries(manifest.scripts)) {
        const config = /--config\s+(\S+)/.exec(body)?.[1];

        if (!body.startsWith('vitest run') || config === undefined) {
            continue;
        }

        const include = /include:\s*\[\s*'([^']+)'/.exec(readFileSync(join(packageRoot, config), 'utf8'))?.[1];

        if (include !== undefined) {
            tiers.push({
                // `RegExp.escape` (ES2025, in Node 24) rather than a hand-rolled character class — the
                // previous `/[/@-]/g` escaped three characters and not backslash, which is what CodeQL
                // `js/incomplete-sanitization` reports. A package name cannot contain one, so it was not a
                // live hole; it was a partial reimplementation of a platform function.
                // ⚠️ TWO SPELLINGS, kept as SEPARATE patterns rather than one alternation. `--workspace=`
                // can only address a workspace member, and this package left the workspace, so the tier is
                // now invoked bare from a step whose `working-directory:` is this package. The first attempt
                // alternated them in one regex, which made the workspace-specific half vacuous — a run of
                // ANOTHER package's tier matched the bare branch and satisfied this package's obligation.
                // The guard's own discrimination test caught it.
                invocation: new RegExp(`npm run ${script}\\s+--workspace=${RegExp.escape(manifest.name)}`),
                bareInvocation: new RegExp(`npm run ${script}(?:\\s|$)`),
                include,
            });
        }
    }

    return tiers;
}

/**
 * Whether one workflow step actually runs a gated spec.
 *
 * @param run - The step's `run:` body.
 * @param file - The gated spec, package-relative (e.g. `tests/foo.integration.test.ts`).
 * @param tiers - The tier invocations from {@link tierInvocations}.
 * @returns `true` when the step names the file, or runs a tier whose glob includes it. Pure.
 */
function stepRunsSpec(
    run: string,
    file: string,
    tiers: readonly { readonly invocation: RegExp; readonly bareInvocation: RegExp; readonly include: string }[],
    workingDirectory: string | undefined = undefined,
): boolean {
    // ⛔ A BARE `npm run test:integration` is this package's tier ONLY when the step runs HERE. Without the
    // directory check, any workflow step invoking a same-named script in any other package would satisfy
    // this package's obligation — which is the guard passing for the wrong reason, the failure it exists to
    // refuse. The `--workspace=` spelling names the package itself and needs no such check.
    const runsHere = workingDirectory !== undefined && /packages\/infra\/global\/?$/u.test(workingDirectory.trim());

    return (
        run.includes(file) ||
        tiers.some(({ invocation, bareInvocation, include }) => {
            if (!minimatch(file, include)) {
                return false;
            }

            // A step that names a workspace must name THIS one; a step that names none must run HERE.
            return run.includes('--workspace=') ? invocation.test(run) : runsHere && bareInvocation.test(run);
        })
    );
}

/**
 * Gates that no workflow step both SETS and RUNS.
 *
 * Both halves matter. A step that runs the file without setting the variable executes an empty suite; a step
 * that sets the variable without running the file sets it for nothing. Only the conjunction is a gate.
 */
function findUnwiredEnvGates(
    gates: readonly EnvGate[],
    workflows: readonly Workflow[],
    tiers: readonly {
        readonly invocation: RegExp;
        readonly bareInvocation: RegExp;
        readonly include: string;
    }[] = [],
): readonly string[] {
    const violations: string[] = [];

    for (const { file, variable } of gates) {
        const wired = workflows.some(({ doc }) =>
            allSteps(doc).some(({ step }) => {
                const value = step.env?.[variable] ?? doc.env?.[variable];

                return (
                    value !== undefined &&
                    scalarText(value) !== '' &&
                    stepRunsSpec(step.run ?? '', file, tiers, step['working-directory'])
                );
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
 * DERIVED, not listed, and that distinction is the whole point. A service whose `main.ts` calls `app.enableCors(…)`
 * must have its smoke see a preflight ADMIT the web origin; one that does not must have its smoke see a preflight
 * REFUSE it (`--expect-cors deny`, plan 002 S2). All three image-pushing services enable CORS since plan 002 S4.
 *
 * An exception list here would be a place to add a service to in order to make a check go away. Reading the source
 * means a service that GAINS CORS immediately owes the admit assertion, and one that has it cannot silently drop it.
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
 * The paths the edge shares across callers for a service (ADR-0020), read from `EDGE_POLICY`, the one authority.
 * The deploy smoke must preflight each one, in the direction the service's CORS decides: a CORS-enabled service must
 * ADMIT its web origin there (the edge keys those paths on `Origin`), and one without CORS must refuse it.
 *
 * @param servicePackage - The workspace directory, e.g. `packages/services/food-service`.
 * @returns The cached paths, without the trailing wildcard. Pure over the imported policy.
 */
function edgeCachedPathsOf(servicePackage: string): readonly string[] {
    const directory = basename(servicePackage);
    const service = Object.keys(EDGE_POLICY)
        .filter((name): name is keyof typeof EDGE_POLICY => name in EDGE_POLICY)
        .find((name) => directory === name || directory === `${name}-service`);

    return service === undefined
        ? []
        : EDGE_POLICY[service].sharedCachePathPatterns.map((pattern) => pattern.replace(/\*$/u, ''));
}

/**
 * The values a command passes a flag, as whole tokens with surrounding quotes removed. Compared as text, so a value
 * holding `.` or `?` cannot match anything but itself. Pure.
 *
 * @param run - A step's shell text.
 * @param flag - The flag, e.g. `--deny-preflight-path`.
 * @returns Each value, in order.
 */
function flagValues(run: string, flag: string): readonly string[] {
    const tokens = run.split(/\s+/u);

    return tokens.flatMap((token, index) =>
        token === flag && index + 1 < tokens.length ? [(tokens[index + 1] ?? '').replace(/^(['"])(.*)\1$/u, '$2')] : [],
    );
}

/** What the analyzer derives from the tree about one service. Handed in so a fixture can state a service's facts. */
interface ServiceFacts {
    readonly isBrowserFacing: (servicePackage: string) => boolean;
    readonly edgeCachedPathsOf: (servicePackage: string) => readonly string[];
}

/** The facts as the real tree states them. */
const TREE_FACTS: ServiceFacts = { isBrowserFacing, edgeCachedPathsOf };

/**
 * Deploy flags that push an image but whose smoke cannot tell a fresh task from a stale one.
 *
 * The expectation is derived from the workflow, not listed here: whatever gates an image push must also gate
 * an image-currency assertion. A new service leg therefore inherits the requirement automatically, which is
 * the whole point — #137 existed because identity's smoke was written before the check existed and nothing
 * re-examined it afterwards.
 *
 * @param doc - The parsed workflow.
 * @param facts - What each service's source says; the real tree unless a fixture states otherwise.
 * @returns The violations, sorted.
 */
function findShallowImageSmokes(doc: WorkflowDocument, facts: ServiceFacts = TREE_FACTS): readonly string[] {
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
            // answered by auth middleware is a 401, i.e. healthy to curl and dead to every browser. A service that
            // ENABLES CORS must be preflighted and admit its web origin; one that does not must be preflighted and
            // REFUSE it (plan 002 S2), so the day it starts admitting browsers is a red smoke, not a silent change.
            const servicePackage = packageOf.get(flag);
            const browserFacing = servicePackage !== undefined && facts.isBrowserFacing(servicePackage);
            const assertsRefusal = /--expect-cors\s+deny\b/.test(run);

            if (browserFacing && (!run.includes('--web-origin') || assertsRefusal)) {
                violations.push(
                    `${flag}::${stepLabel(step)} → does not assert browser reachability ` +
                        `(needs --web-origin without --expect-cors deny: ${servicePackage as string}/src/main.ts ` +
                        'enables CORS, so a CORS regression stays invisible)',
                );
            }

            // Each path the edge shares across callers, preflighted in the direction the service's CORS decides
            // (plan 002 S4): admitted when the service enables CORS, since the edge keys the path on `Origin`, and
            // refused when it does not, since a CORS header there would then be served to every origin.
            for (const path of servicePackage === undefined ? [] : facts.edgeCachedPathsOf(servicePackage)) {
                const admitted = flagValues(run, '--preflight-path').includes(path);
                const refused = flagValues(run, '--deny-preflight-path').includes(path);

                if (browserFacing && refused) {
                    violations.push(
                        `${flag}::${stepLabel(step)} → demands a refusal on ${path}, which ` +
                            `${servicePackage as string} serves to browsers: it enables CORS and the edge keys the ` +
                            'path on Origin',
                    );
                } else if (browserFacing && !admitted) {
                    violations.push(
                        `${flag}::${stepLabel(step)} → does not assert that the edge-cached path admits browsers ` +
                            `(needs --preflight-path ${path}: the service enables CORS and the edge caches the path)`,
                    );
                } else if (!browserFacing && !refused) {
                    violations.push(
                        `${flag}::${stepLabel(step)} → does not assert that the edge-cached path refuses browsers ` +
                            `(needs --deny-preflight-path ${path}: the service enables no CORS)`,
                    );
                }
            }

            if (!browserFacing && !(run.includes('--web-origin') && assertsRefusal)) {
                violations.push(
                    `${flag}::${stepLabel(step)} → does not assert that browsers are refused (needs --web-origin ` +
                        `with --expect-cors deny: ${servicePackage ?? 'unknown package'} does NOT enable CORS, so a ` +
                        'service that starts admitting browsers would pass unnoticed)',
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
            // ADR-0031's reaper suite issues real `DROP DATABASE` statements, and the role split's bootstrap and
            // role-model suites create and drop roles and databases, so all three are gated on a
            // `DATABASE_ADMIN_URL` that only `_ci.yml`'s `integration-infra` job supplies — from a throwaway
            // postgres service container, set on the step that runs them. Each reads it through
            // `throwawayServerUrl`, which refuses a non-loopback server.
            { file: 'tests/dbBootstrap.integration.test.ts', variable: 'DATABASE_ADMIN_URL' },
            { file: 'tests/dbRoleModel.integration.test.ts', variable: 'DATABASE_ADMIN_URL' },
            { file: 'tests/perPrDatabaseReaper.integration.test.ts', variable: 'DATABASE_ADMIN_URL' },
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

    it('accepts a step that runs the TIER containing the file, not just one naming it', () => {
        // The spelling `_ci.yml` actually uses. Without this the analyzer reports a correctly-wired suite as
        // unwired, and the "fix" a reader reaches for is deleting the gate — which turns a boundary test
        // into one that cannot run at all.
        const tiers = tierInvocations();

        expect(
            tiers.length,
            'no vitest tier resolved from package.json — the analyzer stopped discovering',
        ).toBeGreaterThan(0);
        expect(
            stepRunsSpec(
                'npm run test:integration --workspace=@kitchensink/infra-global',
                'tests/perPrDatabaseReaper.integration.test.ts',
                tiers,
            ),
        ).toBe(true);
    });

    it('accepts the working-directory spelling, which is how a non-workspace package is invoked', () => {
        const tiers = tierInvocations();

        expect(
            stepRunsSpec(
                'npm run test:integration',
                'tests/perPrDatabaseReaper.integration.test.ts',
                tiers,
                'packages/infra/global',
            ),
        ).toBe(true);
    });

    it('⛔ does NOT accept a tier run of a DIFFERENT workspace, or a file outside the tier glob', () => {
        const tiers = tierInvocations();

        // ⛔ A bare `npm run test:integration` from SOMEWHERE ELSE is another package's tier. Accepting it
        // would let any package's integration step discharge this package's obligation.
        expect(
            stepRunsSpec(
                'npm run test:integration',
                'tests/perPrDatabaseReaper.integration.test.ts',
                tiers,
                'packages/services/identity',
            ),
        ).toBe(false);
        // And with no directory at all, a bare invocation says nothing about which package ran.
        expect(stepRunsSpec('npm run test:integration', 'tests/perPrDatabaseReaper.integration.test.ts', tiers)).toBe(
            false,
        );

        // Another package's integration tier does not run this package's specs.
        expect(
            stepRunsSpec(
                'npm run test:integration --workspace=@kitchensink/identity-service',
                'tests/perPrDatabaseReaper.integration.test.ts',
                tiers,
            ),
        ).toBe(false);
        // A unit spec is not in the integration tier's `include` glob, so the tier run does not cover it.
        expect(
            stepRunsSpec(
                'npm run test:integration --workspace=@kitchensink/infra-global',
                '__tests__/perPrDatabaseReaper.test.ts',
                tiers,
            ),
        ).toBe(false);
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
            findUnwiredEnvGates(findEnvGates(TEST_DIRS), realWorkflows(), tierInvocations()),
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

    /** A prod-deploy shape: food's image push and a currency smoke run with `smokeFlags`. */
    function foodLeg(smokeFlags: string): WorkflowDocument {
        return {
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
                                `npx tsx smoke.ts ${smokeFlags} ` +
                                '--expected-image-tag "${{ github.sha }}" --running-image-tag "${image##*:}"',
                        },
                    ],
                },
            },
        };
    }

    /**
     * The facts the analyzer derives from the tree, for a service that enables NO CORS and whose edge caches two
     * paths. REWRITTEN for plan 002 S4: these rules were proven on food, and food now enables CORS, so no real
     * image-pushing service is left to prove them on. The facts are handed in instead, so the refusal branch keeps
     * a subject.
     */
    const nonCorsService: ServiceFacts = {
        isBrowserFacing: () => false,
        edgeCachedPathsOf: () => ['/api/v1/foods/nutrition', '/v1/foods/nutrition'],
    };

    it('demands a REFUSAL from a service that enables no CORS (plan 002 S2)', () => {
        // A smoke that asserts nothing about CORS on such a service cannot notice it starting to admit browsers.
        expect(findShallowImageSmokes(foodLeg(''), nonCorsService).join('\n')).toMatch(/--expect-cors deny/);
        expect(findShallowImageSmokes(foodLeg('--web-origin https://example.com'), nonCorsService).join('\n')).toMatch(
            /--expect-cors deny/,
        );
        expect(
            findShallowImageSmokes(
                foodLeg(
                    '--web-origin https://example.com --expect-cors deny ' +
                        '--deny-preflight-path /api/v1/foods/nutrition --deny-preflight-path /v1/foods/nutrition',
                ),
                nonCorsService,
            ),
        ).toEqual([]);
    });

    it('reads a flag`s values as whole tokens, so a path is compared as text and never as a pattern', () => {
        const run = 'smoke.ts --deny-preflight-path /a.b \\\n    --deny-preflight-path "/c" --other /d';

        expect(flagValues(run, '--deny-preflight-path')).toEqual(['/a.b', '/c']);
        expect(flagValues('smoke.ts --deny-preflight-path /aXb', '--deny-preflight-path')).not.toContain('/a.b');
        expect(flagValues('smoke.ts', '--deny-preflight-path')).toEqual([]);
    });

    it('demands a refusal on every edge-cached path of a service that enables no CORS', () => {
        // The paths come from `EDGE_POLICY`, the one authority, so a newly cached path is owed a preflight.
        const missing = findShallowImageSmokes(
            foodLeg('--web-origin https://example.com --expect-cors deny'),
            nonCorsService,
        ).join('\n');

        expect(missing).toMatch(/--deny-preflight-path \/api\/v1\/foods\/nutrition/);
        expect(missing).toMatch(/--deny-preflight-path \/v1\/foods\/nutrition/);
        expect(
            findShallowImageSmokes(
                foodLeg(
                    '--web-origin https://example.com --expect-cors deny --deny-preflight-path /api/v1/foods/nutrition',
                ),
                nonCorsService,
            ).join('\n'),
        ).toMatch(/--deny-preflight-path \/v1\/foods\/nutrition/);
    });

    // Plan 002 S4. Food enables CORS and the edge keys its nutrition cache on the URL and `Origin`, so the web
    // origin must be ADMITTED on each cached path. These cases run on the real derivation from food's own source.
    it('demands an ADMIT on every edge-cached path of a service that enables CORS (plan 002 S4)', () => {
        const missing = findShallowImageSmokes(foodLeg('--web-origin https://example.com')).join('\n');

        expect(missing).toMatch(/--preflight-path \/api\/v1\/foods\/nutrition/);
        expect(missing).toMatch(/--preflight-path \/v1\/foods\/nutrition/);
        expect(
            findShallowImageSmokes(
                foodLeg(
                    '--web-origin https://example.com ' +
                        '--preflight-path /api/v1/foods/nutrition --preflight-path /v1/foods/nutrition',
                ),
            ),
        ).toEqual([]);
    });

    it('flags a cached path a CORS-enabled service is told to refuse, which would declare the web app blocked', () => {
        const violations = findShallowImageSmokes(
            foodLeg(
                '--web-origin https://example.com --preflight-path /api/v1/foods/nutrition ' +
                    '--preflight-path /v1/foods/nutrition --deny-preflight-path /v1/foods/nutrition',
            ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatch(/demands a refusal on \/v1\/foods\/nutrition, which/);
    });

    it('owes no cached-path preflight for a service whose edge caches nothing', () => {
        expect(edgeCachedPathsOf('packages/services/recipe-service')).toStrictEqual([]);
        expect(edgeCachedPathsOf('packages/services/identity')).toStrictEqual([]);
        expect(edgeCachedPathsOf('packages/services/food-service')).toStrictEqual([
            '/api/v1/foods/nutrition',
            '/v1/foods/nutrition',
        ]);
    });

    it('flags --expect-cors deny on a BROWSER-FACING service, whose browsers it would declare unreachable', () => {
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
                                'npx tsx smoke.ts --web-origin https://example.com --expect-cors deny ' +
                                '--expected-image-tag "${{ github.sha }}" --running-image-tag "${image##*:}"',
                        },
                    ],
                },
            },
        });

        expect(violations.join('\n')).toMatch(/enables CORS/);
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
        //
        // Food flipped to `true` in plan 002 S4, the change that enabled its CORS.
        expect({
            identity: isBrowserFacing('packages/services/identity'),
            recipe: isBrowserFacing('packages/services/recipe-service'),
            food: isBrowserFacing('packages/services/food-service'),
        }).toEqual({ identity: true, recipe: true, food: true });
    });
});
