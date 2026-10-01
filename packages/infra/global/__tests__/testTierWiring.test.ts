// @vitest-environment node
/**
 * ⛔ A test tier that CI does not run does not exist, and a LOCAL e2e tier that CI runs must prove it RAN.
 *
 * `docs/CODING_STANDARDS.md` §7 requires each non-unit tier to have its own config, its own `package.json` script,
 * exclusion from the default `test` globs, AND a CI step, because CI invokes these tiers per workspace BY NAME
 * rather than discovering them. The last clause had no backstop: a workspace could gain a good suite that no
 * workflow ever runs, and nothing went red. A suite that never executes reads exactly like a passing one.
 *
 * ## What is asserted
 *
 *   1. **Integration presence.** Every `test:integration` script is run by a step in `_ci.yml`. (Written when six
 *      `*.integration.test.ts` files in this package ran under the unit glob and a bundle one of them wrote
 *      broke `cdkNagTemplateParity`'s no-prod-diff proof; splitting them into a tier made CI wiring necessary.)
 *   2. **E2e presence.** Every `test:e2e` script is run by a step in `_ci.yml`, `deployedE2eTiers.yml` or
 *      `_ci-heavy.yml`, or is recorded in `E2E_TIERS_NOT_IN_CI` with its reason. Derived from the manifests,
 *      so no roster of workspaces can fall behind them.
 *   3. **LOCAL-run integrity.** Every job declaring `E2E_TARGET: local` (`e2eTargetDeclaration.ts`) starts its
 *      dependencies, writes vitest's JSON report, and then runs `.github/scripts/assertLocalTierRan.sh` on that
 *      same report, with nothing conditional or excused in the way. §7.1a says a LOCAL suite never skips, and
 *      every LOCAL suite here gates on `describe.skipIf(!hasTestDatabase)`: without the floor, a job with no
 *      database would skip everything and report green.
 *   4. **The floor script itself**, executed over fixture reports.
 *
 * ## One definition of "a step runs script S for workspace W"
 *
 * A step runs it when a line of its `run:` body invokes `npm run S` and names W as `--workspace=@scope/name` or
 * `--workspace=packages/path`, or names no workspace while the step (or its job's `defaults.run`) sets
 * `working-directory:` to W's directory. The last shape is for packages outside the npm workspace: every CDK
 * directory installs on its own, and `--workspace=` cannot address a package npm does not know.
 *
 * ⚠️ It is bound to the STEP, not the file. `--workspace=@kitchensink/recipe-service` already appears in
 * `_ci.yml` for the integration tier, so a file-wide search would report recipe's e2e tier as run when no step
 * runs it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { declaredE2eTarget } from './e2eTargetDeclaration.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');
const FLOOR_SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'assertLocalTierRan.sh');

/** The workflows whose steps may run an e2e tier: the base pipeline, the deployed tiers, and the heavy suite. */
const E2E_RUNNERS = ['_ci.yml', 'deployedE2eTiers.yml', '_ci-heavy.yml'] as const;

/**
 * Workspaces whose `test:e2e` script no CI step runs, each with the reason.
 *
 * ⛔ An exact set. An entry for a workspace a step does run, or for one that declares no `test:e2e`, fails.
 */
const E2E_TIERS_NOT_IN_CI: ReadonlyMap<string, string> = new Map([
    [
        '@kitchensink/identity-service',
        'Its suites boot the Nest app over MOCKED `pg` and SQS, as their headers say, so §7.1a would call them ' +
            'integration tests under an e2e name. They fit neither target: a LOCAL job would start containers ' +
            'nothing uses and the floor would vouch for a tier that proves no real dependency, and a DEPLOYED job ' +
            'cannot point them at an origin. Re-homing them is the corpus migration in §7.1a’s TRANSITION ' +
            'paragraph, which deletes this entry.',
    ],
    [
        '@kitchensink/identity-webhooks',
        'Its suites drive the Lambda handlers over mocked AWS SDK clients and a mocked `pg` pool: the same ' +
            'mismatch as identity-service, with the same owner.',
    ],
]);

interface Workspace {
    /** The package's `name` field, as `--workspace=@scope/name` would spell it. */
    readonly name: string;
    /** Its repo-relative directory, as `--workspace=packages/…` would spell it. */
    readonly directory: string;
}

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly if?: unknown;
    readonly 'continue-on-error'?: unknown;
    readonly 'working-directory'?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly name?: string;
    readonly if?: unknown;
    readonly 'continue-on-error'?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly services?: Readonly<Record<string, { readonly image?: string } | null>>;
    readonly defaults?: { readonly run?: { readonly 'working-directory'?: string } };
    readonly steps?: readonly Step[];
}

interface WorkflowDoc {
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** A workflow tree as `[file, parsed]` pairs — real files, or fixtures parsed from text. */
type WorkflowTree = readonly (readonly [string, WorkflowDoc])[];

/**
 * Read workflows by name.
 *
 * @param files - File names under `.github/workflows/`.
 * @returns The parsed tree.
 * @sideEffect Reads the working tree.
 */
function loadTree(files: readonly string[]): WorkflowTree {
    return files.map((file) => [file, parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as WorkflowDoc] as const);
}

/** Every workflow in `.github/workflows/`. */
const everyWorkflow = (): WorkflowTree =>
    loadTree(readdirSync(WORKFLOW_DIR).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml')));

/** A fixture tree parsed from YAML text. */
const fixtureTree = (files: Readonly<Record<string, string>>): WorkflowTree =>
    Object.entries(files).map(([file, text]) => [file, parse(text) as WorkflowDoc] as const);

/**
 * Every workspace declaring `script`.
 *
 * Walks `packages/` rather than reading the root `workspaces` globs, so a package added outside the declared
 * globs is still found; the point is to find scripts nobody is running.
 *
 * @param script - The `package.json` script name.
 * @param directory - Where to walk from.
 * @param depth - How deep the walk already is.
 * @returns The workspaces, in walk order.
 * @sideEffect Reads the working tree.
 */
function workspacesWithScript(script: string, directory = PACKAGES_DIR, depth = 0): readonly Workspace[] {
    if (depth > 4) {
        return [];
    }

    const found: Workspace[] = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
            continue;
        }

        const child = join(directory, entry.name);

        if (entry.isDirectory()) {
            found.push(...workspacesWithScript(script, child, depth + 1));
            continue;
        }

        if (entry.name !== 'package.json') {
            continue;
        }

        const manifest = JSON.parse(readFileSync(child, 'utf8')) as {
            name?: string;
            scripts?: Record<string, string>;
        };

        if (manifest.scripts?.[script] && manifest.name) {
            found.push({ name: manifest.name, directory: relative(REPO_ROOT, directory).replaceAll('\\', '/') });
        }
    }

    return found;
}

/** Strip one pair of matching surrounding quotes from a shell word. */
function unquote(word: string): string {
    return /^(["']).*\1$/su.test(word) ? word.slice(1, -1) : word;
}

/**
 * What each `npm run <script>` invocation in a step names: its `--workspace=` values, or `dir:<path>` for a bare
 * invocation under a working directory. Pure.
 *
 * @param step - The step.
 * @param job - The step's job, for `defaults.run.working-directory`.
 * @param script - The script name.
 * @returns The spellings, one per workspace named.
 */
function invocationsIn(step: Step, job: Job, script: string): readonly string[] {
    const invokes = new RegExp(String.raw`\bnpm run ${script.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\w:-])`, 'u');
    const lines = (step.run ?? '').replace(/\\\n/gu, ' ').split('\n');
    const directory = step['working-directory'] ?? job.defaults?.run?.['working-directory'];

    return lines
        .filter((line) => invokes.test(line))
        .flatMap((line) => {
            const named = [...line.matchAll(/--workspace=(\S+)/gu)].map((match) => unquote(match[1] ?? ''));

            if (named.length > 0) {
                return named;
            }

            return directory === undefined ? [] : [`dir:${directory}`];
        });
}

/**
 * Whether any step in the tree runs `script` for `workspace`. Pure.
 *
 * @param tree - The workflows to search.
 * @param script - The script name.
 * @param workspace - The workspace.
 * @returns True when a step names it by package name, by path, or by working directory.
 */
function runs(tree: WorkflowTree, script: string, workspace: Workspace): boolean {
    const spellings = new Set([workspace.name, workspace.directory, `dir:${workspace.directory}`]);

    return tree.some(([, doc]) =>
        Object.values(doc.jobs ?? {}).some((job) =>
            (job.steps ?? []).some((step) =>
                invocationsIn(step, job, script).some((spelling) => spellings.has(spelling)),
            ),
        ),
    );
}

/**
 * Workspaces declaring `script` that no step runs and no exception records. Pure.
 *
 * @param workspaces - The workspaces declaring the script.
 * @param tree - The workflows whose steps count.
 * @param script - The script name.
 * @param exceptions - Workspace names recorded as not run, with reasons.
 * @returns The names, sorted.
 */
function tiersWithNoRunSite(
    workspaces: readonly Workspace[],
    tree: WorkflowTree,
    script: string,
    exceptions: ReadonlyMap<string, string>,
): readonly string[] {
    return workspaces
        .filter((workspace) => !exceptions.has(workspace.name) && !runs(tree, script, workspace))
        .map((workspace) => workspace.name)
        .sort();
}

/**
 * Exceptions that no longer describe the tree: the workspace IS run, or declares no such script. Pure.
 *
 * @param workspaces - The workspaces declaring the script.
 * @param tree - The workflows whose steps count.
 * @param script - The script name.
 * @param exceptions - Workspace names recorded as not run, with reasons.
 * @returns The stale names, sorted.
 */
function staleExceptions(
    workspaces: readonly Workspace[],
    tree: WorkflowTree,
    script: string,
    exceptions: ReadonlyMap<string, string>,
): readonly string[] {
    return [...exceptions.keys()]
        .filter((name) => {
            const workspace = workspaces.find((candidate) => candidate.name === name);

            return workspace === undefined || runs(tree, script, workspace);
        })
        .sort();
}

/** The report path an e2e run writes with `--outputFile.json=<path>`, or undefined. */
function jsonReportOf(step: Step): string | undefined {
    const match = /--outputFile\.json[=\s]\s*("[^"]*"|'[^']*'|[^\s\\]+)/u.exec(step.run ?? '');

    return match?.[1] === undefined ? undefined : unquote(match[1]);
}

/** The report path a floor step hands `assertLocalTierRan.sh`, or undefined when the step does not run it. */
function floorReportOf(step: Step): string | undefined {
    const match = /assertLocalTierRan\.sh\s+("[^"]*"|'[^']*'|[^\s\\]+)/u.exec(step.run ?? '');

    return match?.[1] === undefined ? undefined : unquote(match[1]);
}

/** Why a step's outcome might not reach the job's: an `if:` can skip it, `continue-on-error` can excuse it. */
function escapes(subject: string, holder: Job | Step): readonly string[] {
    return [
        ...(holder.if === undefined ? [] : [`${subject}-conditional`]),
        ...(holder['continue-on-error'] === undefined ? [] : [`${subject}-excused`]),
    ];
}

/** Whether a connection URL's host is on the runner. */
function isLoopback(url: string): boolean {
    try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * Why one LOCAL job's run could report green without having run. Pure.
 *
 * @param job - A job declaring `E2E_TARGET: local`.
 * @returns Its findings, in a fixed order.
 */
function localJobFindings(job: Job): readonly string[] {
    const findings: string[] = [...escapes('job', job)];
    const services = Object.values(job.services ?? {});

    if (services.length === 0) {
        findings.push('no-services');
    }

    const steps = job.steps ?? [];
    const at = steps.findIndex((step) => /\bnpm run test:e2e(?![\w:-])/u.test(step.run ?? ''));
    const run = steps[at];

    if (run === undefined) {
        return [...findings, 'no-e2e-step'];
    }

    if (services.some((service) => /(?:^|\/)postgres(?:[:@]|$)/u.test(service?.image ?? ''))) {
        const url = { ...job.env, ...run.env }['DATABASE_ADMIN_URL'];

        if (typeof url !== 'string' || !isLoopback(url)) {
            findings.push(`database-not-loopback (${typeof url === 'string' ? url : 'unset'})`);
        }
    }

    findings.push(...escapes('e2e-step', run));

    const written = jsonReportOf(run);

    if (written === undefined) {
        return [...findings, 'no-json-report'];
    }

    const floor = steps.slice(at + 1).find((step) => floorReportOf(step) !== undefined);

    if (floor === undefined) {
        return [...findings, 'no-floor-step'];
    }

    const read = floorReportOf(floor);

    if (read !== written) {
        findings.push(`floor-reads-another-report (${read ?? '?'}, not ${written})`);
    }

    return [...findings, ...escapes('floor-step', floor)];
}

/**
 * Every LOCAL e2e job whose run could report green without having run, with the reasons. Pure.
 *
 * @param tree - The workflow tree.
 * @returns `file::job → findings`, sorted.
 */
function localRunFindings(tree: WorkflowTree): readonly string[] {
    return tree
        .flatMap(([file, doc]) =>
            Object.entries(doc.jobs ?? {})
                .filter(([, job]) => declaredE2eTarget(job) === 'local')
                .map(([key, job]) => [`${file}::${key}`, localJobFindings(job)] as const),
        )
        .filter(([, findings]) => findings.length > 0)
        .map(([id, findings]) => `${id} → ${findings.join('; ')}`)
        .sort();
}

describe('every integration tier is called by CI', () => {
    const workspaces = workspacesWithScript('test:integration');
    const ci = loadTree(['_ci.yml']);

    it('finds the integration tiers at all — the discovery half', () => {
        // Anchors the analyzer: if the walk breaks or the script is renamed, every assertion below would
        // pass vacuously over an empty list. This is the check that stops "no violations" from meaning
        // "nothing was looked at".
        expect(workspaces.length).toBeGreaterThanOrEqual(9);
        expect(workspaces.map((workspace) => workspace.name)).toContain('@kitchensink/infra-global');
    });

    it.each(workspaces.map((workspace) => [workspace.name, workspace] as const))(
        '%s is run by a step in _ci.yml',
        (_name, workspace) => {
            expect(
                runs(ci, 'test:integration', workspace),
                `${workspace.name} declares a \`test:integration\` script that no _ci.yml step runs. The suite ` +
                    `never executes — which looks exactly like a passing suite. Add a step running ` +
                    `\`npm run test:integration --workspace=${workspace.name}\`, or, for a package outside the npm ` +
                    `workspace, a step with \`working-directory: ${workspace.directory}\`.`,
            ).toBe(true);
        },
    );
});

describe('every e2e tier is run by CI, or recorded as not run', () => {
    const workspaces = workspacesWithScript('test:e2e');

    it('finds the e2e tiers at all — the discovery half', () => {
        expect(workspaces.length).toBeGreaterThanOrEqual(7);
        expect(workspaces.map((workspace) => workspace.name)).toEqual(
            expect.arrayContaining(['@kitchensink/food-service', '@kitchensink/recipe-service']),
        );
    });

    it('⛔ every `test:e2e` script is run by a CI step or recorded in E2E_TIERS_NOT_IN_CI', () => {
        expect(
            tiersWithNoRunSite(workspaces, loadTree(E2E_RUNNERS), 'test:e2e', E2E_TIERS_NOT_IN_CI),
            'a `test:e2e` script no step runs never executes, which looks exactly like a passing suite. Run it from ' +
                'a LOCAL job in _ci.yml or a DEPLOYED tier in deployedE2eTiers.yml, or record why not',
        ).toEqual([]);
    });

    it('⛔ E2E_TIERS_NOT_IN_CI holds no stale entry', () => {
        expect(staleExceptions(workspaces, loadTree(E2E_RUNNERS), 'test:e2e', E2E_TIERS_NOT_IN_CI)).toEqual([]);
    });

    it('⛔ the root `npm run test:e2e` reaches every `test:e2e` script (owner ruling 2026-09-20: the manual door)', () => {
        const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
            readonly workspaces: readonly string[];
            readonly scripts: Readonly<Record<string, string>>;
        };
        const door = root.scripts['test:e2e'] ?? '';
        // Turbo reaches a package inside the workspace globs; one outside them (a CDK package installs on its own)
        // must be named by the door itself.
        const unreached = workspaces.filter(
            (workspace) =>
                !root.workspaces.some((glob) => minimatch(workspace.directory, glob)) &&
                !door.includes(`npm run test:e2e --prefix ${workspace.directory}`),
        );

        expect(door).toContain('turbo run test:e2e');
        expect(unreached.map((workspace) => workspace.directory)).toEqual([]);
    });

    describe('the analyzers, over fixture trees', () => {
        const fixtureWorkspaces: readonly Workspace[] = [
            { name: '@fixture/a', directory: 'packages/a' },
            { name: '@fixture/b', directory: 'packages/b' },
        ];

        /** A `_ci.yml` with one job whose single step is `step` (YAML lines at step indentation). */
        const pipeline = (step: readonly string[], jobLines: readonly string[] = []): WorkflowTree =>
            fixtureTree({
                '_ci.yml': ['jobs:', '    j:', ...jobLines, '        steps:', ...step, ''].join('\n'),
            });

        it('flags a workspace whose only run site is a different script', () => {
            const tree = pipeline(['            - run: npm run test:integration --workspace=@fixture/a']);

            expect(tiersWithNoRunSite(fixtureWorkspaces.slice(0, 1), tree, 'test:e2e', new Map())).toEqual([
                '@fixture/a',
            ]);
        });

        it('flags a workspace named by a step that runs a longer script with the same prefix', () => {
            const tree = pipeline(['            - run: npm run test:e2e:smoke --workspace=@fixture/a']);

            expect(tiersWithNoRunSite(fixtureWorkspaces.slice(0, 1), tree, 'test:e2e', new Map())).toEqual([
                '@fixture/a',
            ]);
        });

        it('flags a workspace named on one line while another line runs the script', () => {
            const tree = pipeline([
                '            - run: |',
                '                  npm run build --workspace=@fixture/a',
                '                  npm run test:e2e',
            ]);

            expect(tiersWithNoRunSite(fixtureWorkspaces.slice(0, 1), tree, 'test:e2e', new Map())).toEqual([
                '@fixture/a',
            ]);
        });

        it.each([
            ['by package name', ['            - run: npm run test:e2e --workspace=@fixture/a -- --reporter=json'], []],
            ['by path', ['            - run: npm run test:e2e --workspace=packages/a'], []],
            [
                'by the step’s working directory',
                ['            - working-directory: packages/a', '              run: npm run test:e2e'],
                [],
            ],
            [
                'across a line continuation',
                [
                    '            - run: |',
                    '                  npm run test:e2e \\',
                    '                    --workspace=@fixture/a',
                ],
                [],
            ],
        ])('accepts a run site %s', (_spelling, step, jobLines) => {
            expect(
                tiersWithNoRunSite(fixtureWorkspaces.slice(0, 1), pipeline(step, jobLines), 'test:e2e', new Map()),
            ).toEqual([]);
        });

        it('accepts a run site by the job’s default working directory', () => {
            const tree = pipeline(
                ['            - run: npm run test:e2e'],
                ['        defaults:', '            run:', '                working-directory: packages/a'],
            );

            expect(tiersWithNoRunSite(fixtureWorkspaces.slice(0, 1), tree, 'test:e2e', new Map())).toEqual([]);
        });

        it('accepts a workspace recorded as not run', () => {
            const tree = pipeline(['            - run: echo nothing']);

            expect(
                tiersWithNoRunSite(fixtureWorkspaces.slice(0, 1), tree, 'test:e2e', new Map([['@fixture/a', 'why']])),
            ).toEqual([]);
        });

        it('flags an exception for a workspace that IS run, and one for a workspace that does not exist', () => {
            const tree = pipeline(['            - run: npm run test:e2e --workspace=@fixture/a']);
            const exceptions = new Map([
                ['@fixture/a', 'run after all'],
                ['@fixture/b', 'genuinely not run'],
                ['@fixture/ghost', 'no such workspace'],
            ]);

            expect(staleExceptions(fixtureWorkspaces, tree, 'test:e2e', exceptions)).toEqual([
                '@fixture/a',
                '@fixture/ghost',
            ]);
        });
    });
});

describe('every LOCAL e2e job proves its suite ran', () => {
    it('finds LOCAL jobs at all — the discovery half', () => {
        const local = everyWorkflow().flatMap(([, doc]) =>
            Object.values(doc.jobs ?? {}).filter((job) => declaredE2eTarget(job) === 'local'),
        );

        expect(local.length).toBeGreaterThanOrEqual(2);
    });

    it('⛔ holds for every LOCAL job in .github/workflows/', () => {
        expect(
            localRunFindings(everyWorkflow()),
            'a LOCAL e2e job writes vitest’s JSON report and then runs .github/scripts/assertLocalTierRan.sh on that ' +
                'report, with nothing conditional or excused in the way (docs/CODING_STANDARDS.md §7.1a)',
        ).toEqual([]);
    });

    describe('the analyzer, over fixture jobs', () => {
        const RUN =
            '            - run: npm run test:e2e --workspace=@fixture/a -- --reporter=json --outputFile.json="${RUNNER_TEMP}/a.json"';
        const FLOOR = '            - run: bash .github/scripts/assertLocalTierRan.sh "${RUNNER_TEMP}/a.json" a';
        const POSTGRES = ['        services:', '            postgres:', '                image: postgres:18'];
        const ENV = [
            '              env:',
            '                  DATABASE_ADMIN_URL: postgres://postgres:postgres@localhost:5432/postgres',
        ];

        /** One LOCAL job, `j`, in a `_ci.yml`. */
        const localJob = (lines: readonly string[]): WorkflowTree =>
            fixtureTree({
                '_ci.yml': [
                    'jobs:',
                    '    j:',
                    '        name: E2E (a — LOCAL Postgres)',
                    '        env:',
                    '            E2E_TARGET: local',
                    ...lines,
                    '',
                ].join('\n'),
            });

        it('does NOT flag a well-formed LOCAL job', () => {
            expect(localRunFindings(localJob([...POSTGRES, '        steps:', RUN, ...ENV, FLOOR]))).toEqual([]);
        });

        it.each([
            ['no floor step', [...POSTGRES, '        steps:', RUN, ...ENV], 'no-floor-step'],
            ['a floor only BEFORE the run', [...POSTGRES, '        steps:', FLOOR, RUN, ...ENV], 'no-floor-step'],
            [
                'a floor that is continue-on-error',
                [...POSTGRES, '        steps:', RUN, ...ENV, FLOOR, '              continue-on-error: true'],
                'floor-step-excused',
            ],
            [
                'a floor with an if:',
                [...POSTGRES, '        steps:', RUN, ...ENV, FLOOR, '              if: ${{ !cancelled() }}'],
                'floor-step-conditional',
            ],
            [
                'a floor that reads a different report',
                [
                    ...POSTGRES,
                    '        steps:',
                    RUN,
                    ...ENV,
                    '            - run: bash .github/scripts/assertLocalTierRan.sh "${RUNNER_TEMP}/b.json" a',
                ],
                'floor-reads-another-report (${RUNNER_TEMP}/b.json, not ${RUNNER_TEMP}/a.json)',
            ],
            [
                'a run that writes no JSON report',
                [
                    ...POSTGRES,
                    '        steps:',
                    '            - run: npm run test:e2e --workspace=@fixture/a',
                    ...ENV,
                    FLOOR,
                ],
                'no-json-report',
            ],
            [
                'a run that is continue-on-error',
                [...POSTGRES, '        steps:', RUN, ...ENV, '              continue-on-error: true', FLOOR],
                'e2e-step-excused',
            ],
            ['no e2e step at all', [...POSTGRES, '        steps:', FLOOR], 'no-e2e-step'],
            ['no services', ['        steps:', RUN, ...ENV, FLOOR], 'no-services'],
            [
                'a Postgres service with no loopback admin URL',
                [...POSTGRES, '        steps:', RUN, FLOOR],
                'database-not-loopback (unset)',
            ],
            [
                'a Postgres service and an admin URL off the runner',
                [
                    ...POSTGRES,
                    '        steps:',
                    RUN,
                    '              env:',
                    '                  DATABASE_ADMIN_URL: postgres://postgres:postgres@db.example.com:5432/postgres',
                    FLOOR,
                ],
                'database-not-loopback (postgres://postgres:postgres@db.example.com:5432/postgres)',
            ],
            [
                'a job-level if:',
                ["        if: github.event_name == 'push'", ...POSTGRES, '        steps:', RUN, ...ENV, FLOOR],
                'job-conditional',
            ],
            [
                'a job-level continue-on-error',
                ['        continue-on-error: true', ...POSTGRES, '        steps:', RUN, ...ENV, FLOOR],
                'job-excused',
            ],
        ])('flags %s', (_shape, lines, finding) => {
            expect(localRunFindings(localJob(lines))).toEqual([`_ci.yml::j → ${finding}`]);
        });
    });
});

describe('assertLocalTierRan.sh — the floor, executed', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'local-tier-floor-'));

    afterAll(() => {
        rmSync(scratch, { recursive: true, force: true });
    });

    /**
     * Run the real script.
     *
     * @param args - Its arguments.
     * @returns The exit status and the combined output.
     * @sideEffect Spawns bash.
     */
    function floor(args: readonly string[]): { readonly status: number | null; readonly log: string } {
        const result = spawnSync('bash', [FLOOR_SCRIPT, ...args], { encoding: 'utf8' });

        return { status: result.status, log: `${result.stdout}${result.stderr}` };
    }

    /**
     * Write a report and return its path.
     *
     * @param name - The file name.
     * @param body - The file's text.
     * @returns The absolute path.
     * @sideEffect Writes a file under the scratch directory.
     */
    function reportFile(name: string, body: string): string {
        const path = join(scratch, name);

        writeFileSync(path, body);

        return path;
    }

    /** A vitest JSON report's four counts, zero unless given, with optional per-test results. */
    const report = (counts: Readonly<Record<string, unknown>>, results: readonly unknown[] = []): string =>
        JSON.stringify({
            numPassedTests: 0,
            numFailedTests: 0,
            numPendingTests: 0,
            numTodoTests: 0,
            ...counts,
            testResults: [{ name: '/x.e2e.test.ts', assertionResults: results }],
        });

    it.each([
        ['0 executed', 1, report({}), /executed no test/],
        [
            '3 passed, 1 skipped',
            1,
            report({ numPassedTests: 3, numPendingTests: 1 }, [
                { fullName: 'suite passes', status: 'passed' },
                { fullName: 'suite rejects a duplicate', status: 'skipped' },
            ]),
            /did not run 1 test[\s\S]*suite rejects a duplicate/,
        ],
        ['3 passed, 1 todo', 1, report({ numPassedTests: 3, numTodoTests: 1 }), /did not run 1 test/],
        ['3 passed, 1 failed', 1, report({ numPassedTests: 3, numFailedTests: 1 }), /failed 1 test/],
        ['3 passed', 0, report({ numPassedTests: 3 }), /3 test\(s\) executed/],
        ['an empty object', 1, '{}', /not a vitest JSON report/],
        ['counts given as strings', 1, report({ numPassedTests: '3' }), /not a vitest JSON report/],
        ['a fractional count', 1, report({ numPassedTests: 2.5 }), /not a vitest JSON report/],
        ['malformed JSON', 1, '{"numPassedTests": 3,', /not a vitest JSON report/],
    ])('%s → exit %i', (shape, status, body, message) => {
        const outcome = floor([reportFile(`${shape.replaceAll(/\W/gu, '')}.json`, body), 'fixture']);

        expect(outcome.status, outcome.log).toBe(status);
        expect(outcome.log).toMatch(message);

        if (status === 1) {
            expect(outcome.log).toMatch(/^::error::/mu);
        }
    });

    it('a missing report → exit 1', () => {
        const outcome = floor([join(scratch, 'absent.json'), 'fixture']);

        expect(outcome.status, outcome.log).toBe(1);
        expect(outcome.log).toMatch(/^::error::.*wrote no report/mu);
    });

    it.each([
        ['no arguments', []],
        ['one argument', [join(scratch, 'x.json')]],
        ['an empty label', [join(scratch, 'x.json'), '']],
    ])('%s → exit 2', (_shape, args) => {
        expect(floor(args).status).toBe(2);
    });
});
