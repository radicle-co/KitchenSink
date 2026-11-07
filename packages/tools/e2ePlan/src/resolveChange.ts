/**
 * Decides what a run measures its change from, and measures it: the one place that joins the stamp store, the base
 * policy and the git diff, so the plan bin and the doors that write a stamp read the same answer.
 */
import { changedFiles, changedSince } from './gitChangeSet.js';
import { chooseBase, type Base, type GreenStamp, type Platform } from './greenStamp.js';
import { currentBranch, readStamp, repoKeyOf, stampFile, stateRoot } from './stampStore.js';
import { snapshotTree, treeExists } from './worktreeSnapshot.js';

export interface ResolveInput {
    readonly repo: string;
    readonly explicitBase?: string | undefined;
    readonly ci: boolean;
    readonly platform?: Platform | undefined;
    /** Where stamps live. Defaults to the machine's state folder. */
    readonly stateRoot?: string;
}

export interface ResolvedChange {
    readonly base: Base;
    /** Changed files. Empty for a `none` base, where the whole suite runs and no list is needed. */
    readonly files: readonly string[];
    /** The tree of the working tree now. A run that passes stamps this one. */
    readonly tree: string;
    /** The commit or tree the files were measured from, for reading a registry as it was then. */
    readonly from: string | undefined;
    /** The stamp the run started from, which a later write compares against. */
    readonly previous: GreenStamp | undefined;
}

/**
 * The file that holds the stamp for one branch and platform of a repository.
 *
 * @sideEffect Runs git.
 * @param repo - The repository root.
 * @param root - The state root.
 * @param branch - The branch.
 * @param platform - The platform.
 * @returns The path.
 */
export async function stampLocation(repo: string, root: string, branch: string, platform: Platform): Promise<string> {
    return stampFile(root, await repoKeyOf(repo), branch, platform);
}

/**
 * Chooses the base and measures the change from it.
 *
 * @sideEffect Runs git, reads the stamp file, and writes tree objects.
 * @param input - The run's context.
 * @returns The base, the changed files and the tree.
 * @throws When an explicit or default ref has no merge base with HEAD.
 */
export async function resolveChange(input: ResolveInput): Promise<ResolvedChange> {
    const branch = await currentBranch(input.repo);
    // Read even when the base is a ref: the run may still advance the stamp, and must replace exactly this one.
    const previous =
        branch !== undefined && input.platform !== undefined
            ? readStamp(await stampLocation(input.repo, input.stateRoot ?? stateRoot(), branch, input.platform))
            : undefined;
    const base = chooseBase({
        explicitBase: input.explicitBase,
        ci: input.ci,
        platform: input.platform,
        branch,
        stamp: previous,
        stampTreeExists: previous !== undefined && (await treeExists(input.repo, previous.tree)),
    });

    if (base.kind === 'none') {
        return { base, files: [], tree: await snapshotTree(input.repo), from: undefined, previous };
    }

    if (base.kind === 'stamp') {
        const change = await changedSince(input.repo, base.stamp.tree);

        return { base, ...change, from: base.stamp.tree, previous };
    }

    const change = await changedFiles(input.repo, base.ref);

    return { base, files: change.files, tree: change.tree, from: change.mergeBase, previous };
}
