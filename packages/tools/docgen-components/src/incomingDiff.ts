/**
 * @module incomingDiff — the git arguments that tell `bin/afterMerge.ts` whether the INCOMING side of a merge changed a
 * generated folder. Both defects this module closes lived in these arguments, so they are one pure function a test
 * can pin without a repository:
 *
 *   - the diff is three-dot, `HEAD^1...HEAD^2`, the incoming branch's own change since the merge base. A two-dot
 *     diff would compare the two tips and report every change main made too.
 *   - every folder is `:(top)`-anchored, because npm starts the script from the workspace folder and a plain
 *     `docs/generated/...` would name a path under it.
 */

/**
 * The `git diff` arguments that list the generated files the incoming side changed.
 *
 * @param isMergeCommit - Whether `HEAD` has a second parent: a merge commit reads the incoming branch, a fast-forward
 *   (no second parent) reads what the pull moved.
 * @param folders - The generator's output folders, repository-relative.
 * @returns The arguments after `git`. Pure.
 */
export function incomingDiffArgs(isMergeCommit: boolean, folders: readonly string[]): readonly string[] {
    const range = isMergeCommit ? ['HEAD^1...HEAD^2'] : ['ORIG_HEAD', 'HEAD'];

    return ['diff', '--name-only', ...range, '--', ...folders.map((folder) => `:(top)${folder}`)];
}
