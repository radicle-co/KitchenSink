// @vitest-environment node
/**
 * ⛔ A test tier that CI does not run does not exist, and a LOCAL e2e tier must not run in CI at all.
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
 *   2. **LOCAL e2e absence.** No step in any workflow runs a LOCAL `test:e2e` tier. A LOCAL e2e suite runs only on a
 *      developer's machine (owner ruling 2026-10-03, `docs/CODING_STANDARDS.md` §7.1a), through the root
 *      `npm run test:e2e`. A workspace's tier is LOCAL when it has a `vitest.e2e.config.ts`: the config file name is
 *      the declaration, and `testTierDependencies.test.ts` verifies it, so no roster of workspaces is kept here.
 *   3. **Every other e2e tier's presence.** Every other `test:e2e` script is run by a step in `_ci.yml`,
 *      `deployedE2eTiers.yml` or `_ci-heavy.yml`, or is recorded in `E2E_TIERS_NOT_IN_CI` with its reason.
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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The workflows whose steps may run an e2e tier: the base pipeline, the deployed tiers, and the heavy suite. */
const E2E_RUNNERS = ['_ci.yml', 'deployedE2eTiers.yml', '_ci-heavy.yml'] as const;

/**
 * Workspaces whose non-LOCAL `test:e2e` script no CI step runs, each with the reason.
 *
 * ⛔ An exact set. An entry for a workspace a step does run, for a LOCAL tier, or for one that declares no
 * `test:e2e`, fails.
 */
const E2E_TIERS_NOT_IN_CI: ReadonlyMap<string, string> = new Map<string, string>([]);

interface Workspace {
    /** The package's `name` field, as `--workspace=@scope/name` would spell it. */
    readonly name: string;
    /** Its repo-relative directory, as `--workspace=packages/…` would spell it. */
    readonly directory: string;
}

/** A workspace declaring `test:e2e`, with whether that tier is LOCAL. */
interface E2eWorkspace extends Workspace {
    readonly local: boolean;
}

interface Step {
    readonly run?: string;
    readonly 'working-directory'?: string;
}

interface Job {
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

/**
 * LOCAL e2e tiers that some step runs. Pure.
 *
 * Every workflow counts, not only the e2e runners: a LOCAL tier run from any job is a LOCAL tier run in CI.
 *
 * @param workspaces - The workspaces declaring `test:e2e`.
 * @param tree - Every workflow.
 * @returns The names, sorted.
 */
function localTiersRunInCi(workspaces: readonly E2eWorkspace[], tree: WorkflowTree): readonly string[] {
    return workspaces
        .filter((workspace) => workspace.local && runs(tree, 'test:e2e', workspace))
        .map((workspace) => workspace.name)
        .sort();
}

/**
 * Every workspace declaring `test:e2e`, each LOCAL when it has a `vitest.e2e.config.ts` (the declaration).
 *
 * @returns The workspaces, in walk order.
 * @sideEffect Reads the working tree.
 */
function e2eWorkspaces(): readonly E2eWorkspace[] {
    return workspacesWithScript('test:e2e').map((workspace) => ({
        ...workspace,
        local: existsSync(join(REPO_ROOT, workspace.directory, 'vitest.e2e.config.ts')),
    }));
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

describe('a LOCAL e2e tier runs on no CI runner; every other e2e tier runs in CI', () => {
    const workspaces = e2eWorkspaces();
    const others = workspaces.filter((workspace) => !workspace.local);

    it('finds and classifies the e2e tiers at all — the discovery half', () => {
        expect(workspaces.length).toBeGreaterThanOrEqual(7);
        expect(workspaces.filter((workspace) => workspace.local).map((workspace) => workspace.name)).toEqual(
            expect.arrayContaining(['@kitchensink/food-service', '@kitchensink/recipe-service']),
        );
        expect(others.map((workspace) => workspace.name)).toContain('@commise/web');
    });

    it('⛔ no step in any workflow runs a LOCAL `test:e2e` tier', () => {
        expect(
            localTiersRunInCi(workspaces, everyWorkflow()),
            'a LOCAL e2e tier runs only on a developer’s machine, through the root `npm run test:e2e` ' +
                '(docs/CODING_STANDARDS.md §7.1a). Remove the CI step; CI runs unit, mocked integration and guards',
        ).toEqual([]);
    });

    it('⛔ every other `test:e2e` script is run by a CI step or recorded in E2E_TIERS_NOT_IN_CI', () => {
        expect(
            tiersWithNoRunSite(others, loadTree(E2E_RUNNERS), 'test:e2e', E2E_TIERS_NOT_IN_CI),
            'a `test:e2e` script no step runs never executes, which looks exactly like a passing suite. Run a ' +
                'DEPLOYED tier from deployedE2eTiers.yml, or record why not',
        ).toEqual([]);
    });

    it('⛔ E2E_TIERS_NOT_IN_CI holds no stale entry', () => {
        expect(staleExceptions(others, loadTree(E2E_RUNNERS), 'test:e2e', E2E_TIERS_NOT_IN_CI)).toEqual([]);
    });

    it('⛔ the root `npm run test:e2e` reaches every `test:e2e` script (the developer’s door)', () => {
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
        const fixtureWorkspaces: readonly E2eWorkspace[] = [
            { name: '@fixture/a', directory: 'packages/a', local: false },
            { name: '@fixture/b', directory: 'packages/b', local: false },
        ];
        const localWorkspace: E2eWorkspace = { name: '@fixture/l', directory: 'packages/l', local: true };

        /** A `_ci.yml` with one job whose single step is `step` (YAML lines at step indentation). */
        const pipeline = (step: readonly string[], jobLines: readonly string[] = []): WorkflowTree =>
            fixtureTree({
                '_ci.yml': ['jobs:', '    j:', ...jobLines, '        steps:', ...step, ''].join('\n'),
            });

        it.each<[string, WorkflowTree, readonly string[]]>([
            [
                'run by package name',
                pipeline(['            - run: npm run test:e2e --workspace=@fixture/l']),
                ['@fixture/l'],
            ],
            ['run by path', pipeline(['            - run: npm run test:e2e --workspace=packages/l']), ['@fixture/l']],
            [
                'run by the step’s working directory',
                pipeline(['            - working-directory: packages/l', '              run: npm run test:e2e']),
                ['@fixture/l'],
            ],
            [
                'run from a workflow that is not an e2e runner',
                fixtureTree({
                    'nightly.yml': [
                        'jobs:',
                        '    j:',
                        '        steps:',
                        '            - run: npm run test:e2e --workspace=@fixture/l',
                        '',
                    ].join('\n'),
                }),
                ['@fixture/l'],
            ],
            ['not run at all', pipeline(['            - run: echo nothing']), []],
            [
                'run only for its integration tier',
                pipeline(['            - run: npm run test:integration --workspace=@fixture/l']),
                [],
            ],
        ])('a LOCAL tier %s', (_shape, tree, expected) => {
            expect(localTiersRunInCi([localWorkspace], tree)).toEqual(expected);
        });

        it('does NOT flag a non-LOCAL tier that a step runs', () => {
            const tree = pipeline(['            - run: npm run test:e2e --workspace=@fixture/a']);

            expect(localTiersRunInCi([...fixtureWorkspaces, localWorkspace], tree)).toEqual([]);
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
