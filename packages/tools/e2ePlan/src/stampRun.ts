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

const run = promisify(execFile);

export interface RecordInput {
    readonly repo: string;
    readonly stateRoot?: string;
    readonly platform: Platform;
    /** The plan's `treeAtStart`. */
    readonly planTree: string;
    readonly selectedBy: RunEvidence['selectedBy'];
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
        selectedBy: input.selectedBy,
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
