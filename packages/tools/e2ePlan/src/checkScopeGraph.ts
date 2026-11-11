/**
 * The turbo side of the changed-only selector (ADR-0091): what turbo knows about the workspaces, each package's task,
 * and which packages depend on which. Turbo already holds the package graph and every task's resolved definition, so
 * this module asks it rather than keeping a second copy.
 *
 * @pattern Adapter over the turbo CLI (`turbo ls`, `turbo run --dry=json`)
 */
import { execFile } from 'node:child_process';
import { join, normalize } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { TaskFacts, TaskScope, Workspace } from './checkScope.js';

const run = promisify(execFile);

/** Tasks whose result depends on one package's own files only, so a dependency's change does not select them. */
const SELF_CONTAINED_TASKS: ReadonlySet<string> = new Set(['format', 'format:check']);

const lsSchema = z.object({
    packages: z.object({ items: z.array(z.object({ name: z.string(), path: z.string() })) }),
});

const drySchema = z.object({
    tasks: z.array(
        z.object({
            package: z.string(),
            task: z.string(),
            directory: z.string(),
            command: z.string(),
            resolvedTaskDefinition: z.object({ cache: z.boolean(), inputs: z.array(z.string()).nullable() }),
        }),
    ),
});

/** What the selector needs from turbo for one task. */
export interface TaskGraph {
    readonly workspaces: readonly Workspace[];
    /** One entry per package that really defines the task. */
    readonly facts: readonly TaskFacts[];
}

const turboBin = (repo: string): string => join(repo, 'node_modules', '.bin', 'turbo');

async function turbo(repo: string, args: readonly string[]): Promise<unknown> {
    const { stdout } = await run(turboBin(repo), [...args], {
        cwd: repo,
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
    });

    return JSON.parse(stdout.slice(stdout.indexOf('{')));
}

async function listPackages(repo: string, filters: readonly string[]): Promise<string[]> {
    const parsed = lsSchema.parse(await turbo(repo, ['ls', ...filters, '--output=json']));

    return parsed.packages.items.map((item) => item.name);
}

/**
 * A declared input that leaves its package, as a repo-relative glob. turbo resolves `$TURBO_ROOT$/x` to a path
 * relative to the package folder (`../../x`), so it is joined back onto that folder.
 */
const outsideInput = (directory: string, input: string): string | undefined =>
    input.startsWith('../') ? normalize(join(directory, input)) : undefined;

/**
 * Reads the workspaces and one task's resolved definition per package.
 *
 * @sideEffect Runs turbo.
 * @param repo - The repository root.
 * @param task - The turbo task.
 * @returns The workspaces and the task's facts.
 */
export async function loadTaskGraph(repo: string, task: string): Promise<TaskGraph> {
    const ls = lsSchema.parse(await turbo(repo, ['ls', '--output=json']));
    const dry = drySchema.parse(await turbo(repo, ['run', task, '--dry=json']));

    return {
        workspaces: ls.packages.items.map((item) => ({ name: item.name, dir: item.path })),
        facts: dry.tasks
            // turbo lists a package that lacks the script as `<NONEXISTENT>`; it runs nothing, so it is no package of the task.
            .filter((entry) => entry.task === task && entry.command !== '<NONEXISTENT>')
            .map((entry) => ({
                package: entry.package,
                cache: entry.resolvedTaskDefinition.cache,
                outsideInputs: (entry.resolvedTaskDefinition.inputs ?? []).flatMap(
                    (input) => outsideInput(entry.directory, input) ?? [],
                ),
            })),
    };
}

/**
 * Turns a scope into the concrete packages to run: the seeds and (for most tasks) everything that depends on them,
 * through turbo's own `...pkg` filter, kept to the packages that define the task and to the caller's group.
 *
 * The group is an INTERSECTION. turbo unions repeated `--filter` flags, so the selector resolves both sides to names
 * and intersects them here, and emits names only.
 *
 * @sideEffect Runs turbo.
 * @param repo - The repository root.
 * @param task - The turbo task.
 * @param scope - The decision.
 * @param graph - From {@link loadTaskGraph}.
 * @param group - turbo `--filter` flags that bound the run (a CI matrix leg); empty for no bound.
 * @returns Sorted package names. Empty means run nothing.
 */
export async function resolveTaskPackages(
    repo: string,
    task: string,
    scope: TaskScope,
    graph: TaskGraph,
    group: readonly string[],
): Promise<string[]> {
    const withTask = new Set(graph.facts.map((fact) => fact.package));
    const inGroup = group.length === 0 ? withTask : new Set(await listPackages(repo, group));
    let chosen: ReadonlySet<string> = withTask;

    if (scope.kind === 'some') {
        const walk = !SELF_CONTAINED_TASKS.has(task);

        chosen =
            scope.seeds.length === 0
                ? new Set()
                : new Set(
                      await listPackages(
                          repo,
                          scope.seeds.map((seed) => `--filter=${walk && seed.dependents ? '...' : ''}${seed.id}`),
                      ),
                  );
    }

    return [...chosen].filter((name) => withTask.has(name) && inGroup.has(name)).sort();
}
