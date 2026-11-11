// @vitest-environment node
/**
 * Repo-wide guard for ADR-0091: a cacheable fast-tier test that reads a file outside its own package says so in
 * turbo.json.
 *
 * The changed-only selector runs a package's tests when a file IN the package, or in a package it depends on, changes.
 * A test that reads another package's files, or a file outside every package, is invisible to that rule unless its
 * task declares the read as a `$TURBO_ROOT$` input, or turns its cache off (`cache: false`, which always runs). The
 * same declaration keeps turbo's cache honest, so this was already a caching defect before it was a selection one.
 *
 * A read counts when this guard can see it: a file-reading or path-forming call (`readFileSync`, `join`, `resolve`,
 * `globSync`, `new URL`, …) or a variable, holding a literal that resolves outside the package and
 * names something that exists. A read covered by the package graph (its own package, or a workspace it depends on)
 * needs no declaration. Only `test` and `test:integration` are fast tiers; `tests/e2e`, `tests/load` and
 * `tests/deployed` are not.
 *
 * What it does not prove: a path built only inside a template string or a helper in `src/` (e2e-plan's repo models read
 * both apps that way, which is why its integration task is `cache: false`). The fix for such a test is the same.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ownerOf, type TaskFacts } from '@kitchensink/e2e-plan/checkScope';
import { listPackages, loadTaskGraph } from '@kitchensink/e2e-plan/checkScopeGraph';
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import { isSource, pathLiterals, pathTarget, trackedPackageFiles } from './workspaceSourceScan.js';

const FAST_TEST_TASKS = ['test', 'test:integration'] as const;
const GRAPHS = await Promise.all(
    FAST_TEST_TASKS.map(async (task) => [task, await loadTaskGraph(repoRoot, task)] as const),
);
const WORKSPACES = GRAPHS[0][1].workspaces;

/** The selector's own facts for each fast test task, by `package#task`. */
const DEFINITIONS = new Map<string, TaskFacts>(
    GRAPHS.flatMap(([task, graph]) => graph.facts.map((fact) => [`${fact.package}#${task}`, fact] as const)),
);

const NOT_FAST = /\/tests\/(e2e|load|deployed)\/|\.e2e\.test\.|\.spec\.ts$/u;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$|\/(__tests__|tests)\//u;
const READS_FILES = /from ['"](node:)?(fs|fs\/promises|child_process)['"]|require\(['"](node:)?(fs|child_process)/u;

const taskOf = (file: string): 'test' | 'test:integration' =>
    /\.integration\.test\./u.test(file) ? 'test:integration' : 'test';

/** Whether a declared glob covers a target file or folder. */
const covers = (globs: readonly string[], target: string): boolean => {
    const match = picomatch([...globs], { dot: true });

    return match(target) || match(`${target}/x`) || globs.some((glob) => glob.startsWith(`${target}/`));
};

describe('pathLiterals', () => {
    it('reads paths from path-forming calls and path-named variables, and nothing else', () => {
        const source = [
            "const ROOT_DIR = '../../..';",
            "readFileSync(join(ROOT_DIR, 'docs', 'design', 'x.html'));",
            "const spec = resolve(import.meta.dirname, '../../web/src/a.ts');",
            "const SPECS_PATH = 'packages/apps/commise/web/tests/e2e';",
            "// readFileSync('docs/comment.md')",
            "label('docs/just-a-string.md');",
            "expect(classify('docs/fixture.md')).toBe(true);",
        ].join('\n');

        expect(pathLiterals('x.ts', source)).toEqual([
            '../../..',
            'docs',
            'design',
            'x.html',
            'docs/design/x.html',
            '../../web/src/a.ts',
            'packages/apps/commise/web/tests/e2e',
        ]);
    });

    it('resolves a relative path from the file, and skips one that names only a folder to join onto', () => {
        expect(pathTarget('packages/tools/a/__tests__/x.test.ts', '../../b/src/y.ts')).toBe(
            'packages/tools/b/src/y.ts',
        );
        expect(pathTarget('packages/tools/a/__tests__/x.test.ts', '../../../..')).toBeUndefined();
        expect(pathTarget('packages/tools/a/__tests__/x.test.ts', 'docs/x.md')).toBe('docs/x.md');
        expect(pathTarget('packages/tools/a/__tests__/x.test.ts', 'not/a/root/path')).toBeUndefined();
    });
});

describe('fast-tier tests that read outside their package', () => {
    const dependencies = new Map<string, Set<string>>();

    const closureOf = async (name: string): Promise<Set<string>> => {
        const known = dependencies.get(name);

        if (known !== undefined) {
            return known;
        }

        const found = new Set(await listPackages(repoRoot, [`--filter=${name}...`]));

        dependencies.set(name, found);

        return found;
    };

    const files = trackedPackageFiles().filter(
        (file) => isSource(file) && TEST_FILE.test(file) && !NOT_FAST.test(file),
    );

    it('scans the tree it claims to', () => {
        expect(DEFINITIONS.size).toBeGreaterThan(40);
        expect(files.length).toBeGreaterThan(1000);
    });

    it('declare the read in turbo.json, or turn the cache off', async () => {
        const undeclared = new Set<string>();

        for (const file of files) {
            const owner = ownerOf(file, WORKSPACES);
            const task = owner === undefined ? undefined : DEFINITIONS.get(`${owner}#${taskOf(file)}`);
            const text = task === undefined || !task.cache ? '' : readFileSync(join(repoRoot, file), 'utf8');

            if (owner === undefined || task === undefined || !task.cache || !READS_FILES.test(text)) {
                continue;
            }

            for (const written of pathLiterals(file, text)) {
                const target = pathTarget(file, written);
                const probe = target?.split('*')[0]?.replace(/\/$/u, '');

                if (target === undefined || probe === undefined || !existsSync(join(repoRoot, probe))) {
                    continue;
                }

                const reached = ownerOf(target, WORKSPACES);

                if (reached !== undefined && (await closureOf(owner)).has(reached)) {
                    continue;
                }

                if (!covers(task.outsideInputs, target)) {
                    undeclared.add(`${owner}#${taskOf(file)} reads ${target} (${file})`);
                }
            }
        }

        expect([...undeclared].sort()).toEqual([]);
    });
});
