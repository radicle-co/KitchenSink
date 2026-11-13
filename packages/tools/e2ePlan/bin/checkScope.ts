/**
 * Runs the fast tiers only on what a change affects (ADR-0091).
 *
 *   npm run scope -- run <task>... [--filter=<group>]... [<turbo flag>]...
 *       Runs `turbo run <task>` on the packages the change selects (the changed packages, what depends on them, and
 *       the tasks turbo cannot cache), kept inside the `--filter` group when one is given. Prints why, and prints
 *       why when it runs nothing.
 *   npm run scope -- list <task> [--filter=<group>]...
 *       Prints the selected packages as a JSON array (and writes `packages=` to `$GITHUB_OUTPUT` when that is set).
 *   npm run scope -- files docs <command>...
 *       Runs the command on the changed files the tier checks, on every file when its configuration changed, and
 *       not at all when none changed.
 *
 * The change is, in order: everything when `FULL_SUITE=1` or `CHECK_SCOPE_FULL` holds a reason; the JSON array of
 * paths in `CHECK_SCOPE_FILES` (CI's `select-checks` job); otherwise the files changed since the merge base with
 * `--base=<ref>`, else `CHECK_SCOPE_BASE`, else `origin/main`, the working tree included (`--base=HEAD` is what is
 * staged or edited, which the pre-commit hook uses).
 *
 * Fails SAFE where it can: a change it cannot read runs everything, with a warning. If turbo itself cannot answer, the
 * step fails, because without turbo it can name no package to run.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { scopeTask, type ChangeSource, type TaskScope } from '../src/checkScope.js';
import { FILE_TIERS, isFileTier, scopeFiles } from '../src/checkScopeFiles.js';
import { loadTaskGraph, resolveTaskPackages } from '../src/checkScopeGraph.js';
import { changedFiles } from '../src/gitChangeSet.js';
import { findRepoRoot } from '../src/repoRoot.js';

const repo = findRepoRoot(process.cwd(), process.env['INIT_CWD']);
const [command = '', ...argv] = process.argv.slice(2);
const baseFlag = argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length);
const rest = argv.filter((arg) => !arg.startsWith('--base='));

const fail = (message: string): never => {
    process.stderr.write(`${message}\n`);
    process.exit(2);
};

async function changeSource(): Promise<ChangeSource> {
    const forced = process.env['CHECK_SCOPE_FULL'] ?? '';

    if (process.env['FULL_SUITE'] === '1') {
        return { kind: 'full', reason: 'FULL_SUITE=1' };
    }

    if (forced !== '') {
        return { kind: 'full', reason: forced };
    }

    const given = process.env['CHECK_SCOPE_FILES'];

    if (given !== undefined && given !== '') {
        const parsed: unknown = JSON.parse(given);

        if (!Array.isArray(parsed) || !parsed.every((path): path is string => typeof path === 'string')) {
            throw new Error('CHECK_SCOPE_FILES is not a JSON array of paths');
        }

        return { kind: 'files', files: parsed };
    }

    return {
        kind: 'files',
        files: (await changedFiles(repo, baseFlag ?? process.env['CHECK_SCOPE_BASE'] ?? 'origin/main')).files,
    };
}

async function safeChange(): Promise<ChangeSource> {
    try {
        return await changeSource();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        process.stderr.write(`warning: the selector could not read the change (${message}); running everything\n`);

        return { kind: 'full', reason: 'the selector could not read the change' };
    }
}

const say = (line: string): void => {
    process.stderr.write(`${line}\n`);
};

const explain = (task: string, scope: TaskScope, packages: readonly string[]): void => {
    if (scope.kind === 'all') {
        say(`${task}: the whole tier (${packages.length} packages), because:`);
        scope.reasons.slice(0, 10).forEach((reason) => say(`  - ${reason}`));

        if (scope.reasons.length > 10) {
            say(`  - …and ${scope.reasons.length - 10} more`);
        }

        return;
    }

    say(`${task}: ${packages.length} packages selected by this change. Seeds:`);
    scope.seeds.forEach((seed) => say(`  - ${seed.id}: ${seed.because}`));
};

async function selectPackages(task: string, group: readonly string[], change: ChangeSource): Promise<string[]> {
    const graph = await loadTaskGraph(repo, task);
    let scope = scopeTask({
        change,
        workspaces: graph.workspaces,
        facts: graph.facts,
        declaredElsewhere: graph.declaredElsewhere,
    });
    let packages: string[];

    try {
        packages = await resolveTaskPackages(repo, scope, graph, group);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        scope = { kind: 'all', reasons: [`the selector failed (${message})`] };
        packages = await resolveTaskPackages(repo, scope, graph, group);
    }

    explain(task, scope, packages);

    return packages;
}

function runTasks(tasks: readonly string[], flags: readonly string[], change: ChangeSource): Promise<number> {
    const group = flags.filter((flag) => flag.startsWith('--filter'));
    const passThrough = flags.filter((flag) => !flag.startsWith('--filter'));

    return tasks.reduce(async (previous, task) => {
        const status = await previous;

        if (status !== 0) {
            return status;
        }

        const packages = await selectPackages(task, group, change);

        if (packages.length === 0) {
            say(`::notice::No package needs ${task} for this change, so none runs.`);

            return 0;
        }

        const filters = packages.map((name) => `--filter=${name}`);
        const result = spawnSync(
            join(repo, 'node_modules', '.bin', 'turbo'),
            ['run', task, ...filters, ...passThrough],
            {
                cwd: repo,
                stdio: 'inherit',
            },
        );

        return result.status ?? 1;
    }, Promise.resolve(0));
}

function runFiles(tier: string, cmd: readonly string[], change: ChangeSource): number {
    if (!isFileTier(tier)) {
        return fail(`error: unknown file tier "${tier}" (known: ${Object.keys(FILE_TIERS).join(', ')})`);
    }

    const [program, ...args] = cmd;

    if (program === undefined) {
        return fail('error: files needs a command to run');
    }

    const scope = scopeFiles(tier, change);
    let targets: readonly string[];

    if (scope.kind === 'all') {
        say(`${tier}: every file, because ${scope.reasons.join('; ')}`);
        targets = FILE_TIERS[tier].allArgs;
    } else {
        // A deleted file has nothing left to check.
        targets = scope.files.filter((file) => existsSync(join(repo, file)));

        if (targets.length === 0) {
            say(`::notice::No ${tier} file changed, so the ${tier} check does not run.`);

            return 0;
        }

        say(`${tier}: ${targets.length} changed files`);
    }

    return spawnSync(program, [...args, ...targets], { cwd: repo, stdio: 'inherit' }).status ?? 1;
}

const change = await safeChange();

switch (command) {
    case 'run': {
        const tasks = rest.filter((arg) => !arg.startsWith('-'));

        if (tasks.length === 0) {
            fail('error: run needs at least one task');
        }

        process.exit(
            await runTasks(
                tasks,
                rest.filter((arg) => arg.startsWith('-')),
                change,
            ),
        );
        break;
    }

    case 'list': {
        const [task, ...group] = rest;

        if (task === undefined) {
            fail('error: list needs a task');
        }

        const packages = JSON.stringify(await selectPackages(String(task), group, change));
        const target = process.env['GITHUB_OUTPUT'];

        process.stdout.write(`${packages}\n`);

        if (target !== undefined && target !== '') {
            appendFileSync(target, `packages=${packages}\n`);
        }

        break;
    }

    case 'files': {
        const [tier = '', ...cmd] = rest;

        process.exit(runFiles(tier, cmd, change));
        break;
    }

    default:
        fail(`error: unknown command "${command}" (known: run, list, files)`);
}
