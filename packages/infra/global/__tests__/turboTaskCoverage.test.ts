// @vitest-environment node
/**
 * A turbo task named by a root script must be implemented by at least one workspace.
 *
 * ## The defect this was written for
 *
 * `npm run dev:local` — documented in `CLAUDE.md` as "Develop locally (persistent, all workspaces)" — ran
 * `turbo run dev:local`, which resolved **42 tasks and executed none of them**, because no workspace has ever
 * declared a `dev:local` script. Turbo treats a package without the script as nothing to do, so the command
 * printed a clean summary and exited 0 having started no service, no web app and no mobile bundler.
 *
 * That is the worst available failure mode for an orchestration command: it is indistinguishable from
 * success. It survived because the root script, the `turbo.json` task and the workspace scripts are three
 * separate files and nothing has ever required the third to exist.
 *
 * ## Scope, and why it is only the ROOT's turbo scripts
 *
 * Every task the root invokes is a promise to the developer who reads `CLAUDE.md`. A task defined in
 * `turbo.json` but invoked only ad hoc (`npx turbo run …`) makes no such promise and is not gated — the
 * asymmetry is deliberate, not an oversight.
 *
 * The root's own script of the same name does NOT count as an implementation: `dev:local` was "implemented"
 * exactly once, by the very script whose emptiness this gate exists to detect.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link unimplementedTasks} is a verdict over
 * plain data, fired at a deliberately-violating fake as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** A `package.json`'s script table, as this gate reads it. */
interface Manifest {
    /** Repo-relative path, `package.json` for the root. */
    readonly file: string;
    /** Its script names. */
    readonly scripts: readonly string[];
}

/** A root script that orchestrates a turbo task nothing implements. */
interface Unimplemented {
    /** The root script's name. */
    readonly rootScript: string;
    /** The turbo task it runs that no workspace implements. */
    readonly task: string;
}

/**
 * The turbo tasks a script body runs.
 *
 * `turbo run a b` runs two tasks, which `npm run lint` relies on (`turbo run lint format:check`). Flags and
 * anything after `--` are not tasks.
 *
 * @param body - A script body.
 * @returns The task names, in order. Pure.
 */
export function turboTasks(body: string): readonly string[] {
    const words = body.trim().split(/\s+/u);
    const runIndex = words.findIndex((word, index) => word === 'run' && words[index - 1]?.endsWith('turbo') === true);

    if (runIndex === -1) {
        return [];
    }

    const tasks: string[] = [];

    for (const word of words.slice(runIndex + 1)) {
        if (word === '--' || word.startsWith('-')) {
            break;
        }

        tasks.push(word);
    }

    return tasks;
}

/**
 * Root-invoked turbo tasks that no workspace implements.
 *
 * @param rootScripts - The root manifest's script table.
 * @param workspaces - Every NON-root manifest.
 * @returns One entry per unimplemented task, sorted. Pure.
 */
export function unimplementedTasks(
    rootScripts: Readonly<Record<string, string>>,
    workspaces: readonly Manifest[],
): readonly Unimplemented[] {
    const implemented = new Set(workspaces.flatMap((workspace) => workspace.scripts));

    return Object.entries(rootScripts)
        .flatMap(([rootScript, body]) =>
            turboTasks(body)
                .filter((task) => !implemented.has(task))
                .map((task) => ({ rootScript, task })),
        )
        .sort((a, b) => `${a.rootScript}/${a.task}`.localeCompare(`${b.rootScript}/${b.task}`));
}

/**
 * Every tracked `package.json` in the tree except the root's.
 *
 * @returns One entry per workspace manifest.
 * @sideEffect Shells out to git and reads the working tree.
 */
function workspaceManifests(): readonly Manifest[] {
    return presentFiles(['.'])
        .filter((file) => file.endsWith('package.json') && file !== 'package.json' && !file.includes('node_modules/'))
        .map((file) => {
            const parsed = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                scripts?: Record<string, string>;
            };

            return { file, scripts: Object.keys(parsed.scripts ?? {}) };
        });
}

/** The root manifest's script table. */
function rootScripts(): Readonly<Record<string, string>> {
    const parsed = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
    };

    return parsed.scripts ?? {};
}

describe('turbo task coverage', () => {
    it('gives every root-orchestrated turbo task at least one implementing workspace', () => {
        const workspaces = workspaceManifests();

        expect(workspaces.length, 'no workspace manifest found — the gate has stopped discovering').toBeGreaterThan(0);

        expect(
            unimplementedTasks(rootScripts(), workspaces),
            'A turbo task no workspace implements runs nothing and exits 0, which is indistinguishable ' +
                'from success. Either implement the script somewhere or stop advertising the command.',
        ).toEqual([]);
    });

    it('reads every task off a turbo invocation and stops at flags', () => {
        expect(turboTasks('turbo run lint format:check')).toEqual(['lint', 'format:check']);
        expect(turboTasks('turbo run build --filter=web')).toEqual(['build']);
        expect(turboTasks('turbo run test -- --watch')).toEqual(['test']);
        expect(turboTasks('npx turbo run dev')).toEqual(['dev']);
        expect(turboTasks('vitest run')).toEqual([]);
    });

    it('reports an unimplemented task and ignores an implemented one', () => {
        expect(
            unimplementedTasks({ real: 'turbo run build', phantom: 'turbo run dev:local' }, [
                { file: 'packages/a/package.json', scripts: ['build'] },
            ]),
        ).toEqual([{ rootScript: 'phantom', task: 'dev:local' }]);
    });
});
