/**
 * Moves the green stamp after a local run, when the run earned it.
 *
 * The doors (web and mobile) call this once, at the end, with what they saw. The policy is `nextStamp`; this module
 * only gathers what a door cannot know (the branch, the HEAD, the tree now) and does the guarded write.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { nextStamp, type GreenStamp, type Platform, type RunEvidence } from './greenStamp.js';
import { stampLocation } from './resolveChange.js';
import { currentBranch, stateRoot, writeStamp } from './stampStore.js';
import { snapshotTree } from './worktreeSnapshot.js';

/** The folder the machine keeps its state in. Re-exported so a door has one public path to it. */
export { stateRoot } from './stampStore.js';
export { processEnv, type Env } from './env.js';

const run = promisify(execFile);

export interface RecordInput {
    readonly repo: string;
    readonly stateRoot?: string;
    readonly platform: Platform;
    /** The plan's `treeAtStart`. */
    readonly planTree: string;
    readonly outcomes: RunEvidence['outcomes'];
    readonly recorderClean: boolean;
    readonly dropped: readonly string[];
    /** The plan's `previous`: the stamp the run started from, which the write replaces and nothing else. */
    readonly previous: GreenStamp | undefined;
    readonly now?: string;
}

export type Recorded =
    | { readonly kind: 'written'; readonly stamp: GreenStamp }
    | { readonly kind: 'refused'; readonly reason: string }
    | { readonly kind: 'conflict' };

/**
 * Records a green run if it earned the stamp.
 *
 * @sideEffect Runs git, writes tree objects, and writes the stamp file.
 * @param input - What the run saw.
 * @returns Whether the stamp moved, and if not, why.
 */
export async function recordGreenRun(input: RecordInput): Promise<Recorded> {
    const branch = await currentBranch(input.repo);
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: input.repo })).stdout.trim();
    const next = nextStamp({
        platform: input.platform,
        branch,
        head,
        planTree: input.planTree,
        endTree: await snapshotTree(input.repo),
        outcomes: input.outcomes,
        recorderClean: input.recorderClean,
        previous: input.previous,
        dropped: input.dropped,
        now: input.now ?? new Date().toISOString(),
    });

    if ('refused' in next || branch === undefined) {
        return { kind: 'refused', reason: 'refused' in next ? next.refused : 'HEAD is detached' };
    }

    const file = await stampLocation(input.repo, input.stateRoot ?? stateRoot(), branch, input.platform);

    return writeStamp(file, next, input.previous) === 'written'
        ? { kind: 'written', stamp: next }
        : { kind: 'conflict' };
}

/** What a door keeps from planning: the tree the plan was made at and the stamp the run started from. */
export interface StampStart {
    readonly planTree: string;
    readonly previous: GreenStamp | undefined;
}

export interface SettleInput {
    readonly repo: string;
    readonly stateRoot?: string;
    readonly platform: Platform;
    /** Undefined when a person chose the tests or the plan gave no tree: the stamp then stays where it is. */
    readonly start: StampStart | undefined;
    /** What the selected tests did; undefined when the run left no report to count. */
    readonly outcomes: RunEvidence['outcomes'] | undefined;
    /** Declared specs or flows that could not run here. Printed every run, and carried into the stamp. */
    readonly owed: readonly string[];
    /** Whether the post-run recorder checks left the exit code alone. */
    readonly recorderClean: boolean;
    readonly log: (line: string) => void;
}

/**
 * The end of a local run, for every door: lists what is owed, moves the green stamp if the run earned it, and says what
 * happened. It never throws and never changes the door's exit code.
 *
 * @sideEffect Runs git, writes tree objects and the stamp file, and calls `log`.
 * @param input - What the run saw.
 */
export async function settleStamp(input: SettleInput): Promise<void> {
    const { platform, log } = input;

    if (input.owed.length > 0) {
        log(`${platform} owed: ${input.owed.join(', ')}`);
    }

    if (input.start === undefined) {
        return;
    }

    if (input.outcomes === undefined) {
        log(`${platform} green stamp not moved (the run left no report to count)`);

        return;
    }

    try {
        const result = await recordGreenRun({
            repo: input.repo,
            ...(input.stateRoot === undefined ? {} : { stateRoot: input.stateRoot }),
            platform,
            planTree: input.start.planTree,
            outcomes: input.outcomes,
            recorderClean: input.recorderClean,
            dropped: input.owed,
            previous: input.start.previous,
        });

        log(
            result.kind === 'written'
                ? `${platform} green stamp moved to this run (owed: ${result.stamp.owed.length})`
                : `${platform} green stamp not moved (${result.kind === 'refused' ? result.reason : 'another run moved it first'})`,
        );
    } catch (error) {
        log(
            `warning: could not record the ${platform} green stamp (${error instanceof Error ? error.message : String(error)})`,
        );
    }
}
