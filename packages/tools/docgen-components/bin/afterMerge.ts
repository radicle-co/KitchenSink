/**
 * @module bin/afterMerge — regenerates the derived docs after a merge that changed them on the incoming side.
 *
 * `npm run docs:after-merge --workspace=@kitchensink/docgen-components`, called from `.husky/post-merge` and from
 * `.husky/post-commit` (for a merge commit, which is how a merge made with `--no-commit` ends).
 *
 * The decision reads the INCOMING side, never the merge result. The `docgenRegenerate` merge driver keeps our side of a
 * generated file, so when both branches changed one, `git diff ORIG_HEAD HEAD` shows nothing and would never
 * regenerate: the very case the driver exists for. For a merge commit the script diffs `HEAD^1...HEAD^2`, the incoming
 * branch's own change. A fast-forward has no second parent, so it diffs `ORIG_HEAD HEAD`.
 *
 * Not handled: a rebase, which runs neither hook, and `git merge --squash`, which leaves no merge commit to read. CI's
 * generated-docs check still fails stale output for both.
 *
 * @sideEffect Runs git and npm, and rewrites the generated documentation directories. It never stages or commits.
 */
import { execFileSync } from 'node:child_process';

import { GENERATED_OUTPUT_DIRS } from '../src/config.js';
import { incomingDiffArgs } from '../src/incomingDiff.js';

/**
 * The git the hook found, as an absolute path (`KS_GIT_BIN="$(command -v git)"` in `.husky/post-merge` and
 * `.husky/post-commit`). Its place differs per machine, and the script runs only from a hook, where git is on PATH.
 */
const GIT_BIN = process.env['KS_GIT_BIN'];

/** npm sets this to its own CLI script for every `npm run`, so the script finds npm without a PATH lookup. */
const NPM_CLI = process.env['npm_execpath'];

/**
 * Runs git in the current repository and returns its output. A failure throws.
 *
 * @param args - The arguments after `git`.
 * @param stderr - Where git's error output goes. The default shows it in the hook's output.
 * @returns Standard output.
 * @throws When the hook did not hand over git, or git exits non-zero.
 */
function git(args: readonly string[], stderr: 'inherit' | 'ignore' = 'inherit'): string {
    if (GIT_BIN === undefined) {
        throw new Error('afterMerge must be started by a git hook, which sets KS_GIT_BIN to the git it found');
    }

    return execFileSync(GIT_BIN, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', stderr] });
}

/**
 * Whether HEAD has a second parent, which is the case for a merge commit. `rev-parse` exits non-zero when it has none,
 * and that exit is the answer, so it is the one git call here whose failure is read as "no".
 *
 * @returns True for a merge commit.
 */
function isMergeCommit(): boolean {
    try {
        git(['rev-parse', '-q', '--verify', 'HEAD^2'], 'ignore');

        return true;
    } catch {
        return false;
    }
}

/**
 * Runs `npm run docs:generate` through the npm that started this script.
 *
 * @throws When it was not started by npm, because there is then no npm to run.
 */
function generate(): void {
    if (NPM_CLI === undefined) {
        throw new Error('afterMerge must be started by `npm run docs:after-merge`, which sets npm_execpath');
    }

    execFileSync(process.execPath, [NPM_CLI, 'run', 'docs:generate', '--workspace=@kitchensink/docgen-components'], {
        stdio: 'inherit',
    });
}

const incoming = git(incomingDiffArgs(isMergeCommit(), GENERATED_OUTPUT_DIRS));

if (incoming.trim() !== '') {
    generate();
    process.stdout.write('Generated docs were regenerated after the merge: review and commit them.\n');
}
