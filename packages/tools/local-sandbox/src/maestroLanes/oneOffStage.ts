/**
 * One-off Maestro flows: a flow file that is not committed, run by `maestro:lanes --one-off <path.yaml>`.
 *
 * The door copies each file into `<maestroDir>/oneOff/<runId>/<name>.yaml` (a folder git ignores, so no committed
 * flow is ever overwritten or restored by hand), runs it under the id `oneOff/<runId>/<name>`, and removes the run's
 * folder when the run ends. Stale folders from a run that was killed (no `finally`) are swept at the start. The
 * runner, the Mac sync and the lanes then see an ordinary file under `.maestro/`.
 *
 * A relative `runFlow`, `runScript` or `addMedia` target in a one-off resolves from its STAGED folder, so it is checked
 * before anything is copied: it must exist, and it must stay inside `.maestro/`. The check is lexical, so a symlink
 * inside `.maestro/` can still point out of it; that is accepted on a developer's own machine.
 *
 * @pattern Command-with-undo: {@link stageOneOffs} does the copy and returns its own `remove`.
 * @sideEffect {@link stageOneOffs} writes and deletes folders under `maestroDir`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';

import { ONE_OFF_DIR, flowReferences } from '@kitchensink/e2e-plan/maestroFlows';

/** A file name that is one plain word, so it is safe in a flow id, a runner selector and a Mac path. */
const PLAIN_FLOW_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.yaml$/u;

const PLAIN_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

/** One planned one-off. `target` is relative to the `.maestro` folder. */
export interface OneOffPlan {
    readonly id: string;
    readonly source: string;
    readonly target: string;
}

/**
 * Name each one-off by its basename alone, so a path cannot choose where it lands. Pure.
 *
 * @param paths - The files named on the command line.
 * @param runId - The run's own name, which becomes a folder.
 * @throws Naming the file, when a name is not a plain `.yaml` name or two files share one; or the run id, when it is
 *   not a plain name.
 */
export function planOneOffs(paths: readonly string[], runId: string): readonly OneOffPlan[] {
    if (!PLAIN_RUN_ID.test(runId)) {
        throw new Error(`maestro:lanes: the run id ${JSON.stringify(runId)} is not a plain name; it becomes a folder`);
    }

    const seen = new Set<string>();

    return paths.map((source) => {
        const name = path.basename(source);

        if (!PLAIN_FLOW_FILE.test(name)) {
            throw new Error(
                `maestro:lanes: --one-off ${source}: the file name ${JSON.stringify(name)} must be one plain word ` +
                    'ending in .yaml',
            );
        }

        if (seen.has(name)) {
            throw new Error(
                `maestro:lanes: --one-off names two files called ${name}; they would share one staged name`,
            );
        }

        seen.add(name);

        return {
            id: `${ONE_OFF_DIR}/${runId}/${name.slice(0, -'.yaml'.length)}`,
            source,
            target: `${ONE_OFF_DIR}/${runId}/${name}`,
        };
    });
}

/**
 * The relative targets of a one-off that would not resolve, each named. A target resolves from the staged folder; it
 * must exist under `.maestro/`, and a path that leaves it (or is absolute) is refused without being looked for. Pure
 * apart from the injected `exists`.
 *
 * @param text - The one-off's YAML.
 * @param targetDir - The staged folder, relative to `.maestro` (`oneOff/<runId>`).
 * @param exists - Whether a path relative to `.maestro` exists.
 */
export function referenceProblems(
    text: string,
    targetDir: string,
    exists: (relativeToMaestro: string) => boolean,
): readonly string[] {
    return flowReferences(text).flatMap((reference) => {
        if (path.posix.isAbsolute(reference)) {
            return [`${reference}: an absolute path; a one-off may run only files under .maestro/`];
        }

        const resolved = path.posix.normalize(path.posix.join(targetDir, reference));

        if (resolved === '..' || resolved.startsWith('../')) {
            return [`${reference}: resolves outside .maestro/ from ${targetDir}`];
        }

        return exists(resolved) ? [] : [`${reference}: not found (looked for .maestro/${resolved})`];
    });
}

/** The staged one-offs of a run. */
export interface StagedOneOffs {
    /** The flow ids to run, in the order the files were named. */
    readonly ids: readonly string[];
    /** Delete the run's folder, and the `oneOff` folder when it is then empty. Safe to call more than once. */
    remove(): void;
}

/**
 * Check every one-off, then stage them all. Nothing is copied when any check fails.
 *
 * @sideEffect Sweeps `<maestroDir>/oneOff`, then creates `<maestroDir>/oneOff/<runId>` and copies the files into it.
 * @throws Naming the path, when a source is missing, a reference does not resolve, or a name is refused.
 */
export function stageOneOffs(input: {
    readonly maestroDir: string;
    readonly paths: readonly string[];
    readonly runId: string;
}): StagedOneOffs {
    const { maestroDir, paths, runId } = input;

    // A run that names nothing must stop here: an empty id list would let the door pick the suite's flows instead.
    if (paths.length === 0) {
        throw new Error('maestro:lanes: --one-off named no flow file');
    }

    const plan = planOneOffs(paths, runId);
    const targetDir = `${ONE_OFF_DIR}/${runId}`;
    const problems = plan.flatMap((one) => {
        if (!existsSync(one.source)) {
            return [`${one.source}: no such file`];
        }

        try {
            return referenceProblems(readFileSync(one.source, 'utf8'), targetDir, (relative) =>
                existsSync(path.join(maestroDir, relative)),
            ).map((problem) => `${one.source}: ${problem}`);
        } catch (error) {
            // `flowReferences` throws on YAML that does not parse, and its message does not name the file.
            return [`${one.source}: ${error instanceof Error ? error.message : String(error)}`];
        }
    });

    if (problems.length > 0) {
        throw new Error(`maestro:lanes: refusing the --one-off flows:\n${problems.join('\n')}`);
    }

    const root = path.join(maestroDir, ONE_OFF_DIR);
    // A run that was killed never reached its `finally`: whatever is under `oneOff/` belongs to no live run.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(path.join(maestroDir, targetDir), { recursive: true });

    for (const one of plan) {
        copyFileSync(one.source, path.join(maestroDir, one.target));
    }

    return {
        ids: plan.map((one) => one.id),
        remove: () => {
            rmSync(path.join(maestroDir, targetDir), { recursive: true, force: true });

            // `rmdirSync` removes a folder only when it is empty, so another run's files are never touched.
            try {
                rmdirSync(root);
            } catch {
                // Not empty, or already gone: either way there is nothing more of this run to remove.
            }
        },
    };
}

/**
 * The `LaneRunDeps` part that stages `--one-off` flows: nothing for a run without the flag, so the changed-flow
 * selection runs as before, and `stageOneOffs` over exactly the paths named for a run with it.
 */
export function oneOffStaging(input: {
    readonly oneOffs: readonly string[] | undefined;
    readonly maestroDir: string;
    readonly runId: string;
}): { readonly stageOneOffs?: () => StagedOneOffs } {
    const { oneOffs, maestroDir, runId } = input;

    return oneOffs === undefined ? {} : { stageOneOffs: () => stageOneOffs({ maestroDir, paths: oneOffs, runId }) };
}
