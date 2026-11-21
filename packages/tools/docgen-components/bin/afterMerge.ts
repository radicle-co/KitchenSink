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
 * Not handled: a rebase. It runs neither hook, and CI's generated-docs check still fails stale output.
 *
 * @sideEffect Runs git and npm, and rewrites the generated documentation directories. It never stages or commits.
 */
import { execFileSync } from 'node:child_process';

import { COMPONENTS_OUT_DIR, DESIGN_OUT_DIR } from '../src/config.js';

/** Absolute, so the script never resolves git through a PATH it does not control. */
const GIT = '/usr/bin/git';

/** npm sets this to its own CLI script for every `npm run`, so the script finds npm without a PATH lookup. */
const NPM_CLI = process.env['npm_execpath'];

/**
 * Runs git in the current repository and returns its output, or null when it fails.
 *
 * @param args - The arguments after `git`.
 * @returns Standard output, or null on a non-zero exit.
 */
function git(args: readonly string[]): string | null {
    try {
        return execFileSync(GIT, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    } catch {
        return null;
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

const outputFolders = [COMPONENTS_OUT_DIR, DESIGN_OUT_DIR];
const isMergeCommit = git(['rev-parse', '-q', '--verify', 'HEAD^2']) !== null;
const incoming = isMergeCommit
    ? git(['diff', '--name-only', 'HEAD^1...HEAD^2', '--', ...outputFolders])
    : git(['diff', '--name-only', 'ORIG_HEAD', 'HEAD', '--', ...outputFolders]);

if (incoming !== null && incoming.trim() !== '') {
    generate();
    process.stdout.write('Generated docs were regenerated after the merge: review and commit them.\n');
}
