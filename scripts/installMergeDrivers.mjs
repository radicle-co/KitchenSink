// Installs the `docgenRegenerate` merge driver named in .gitattributes into the repository's own git config, which
// every worktree shares. The driver is `true`: it keeps the current side and leaves the merge to .husky/post-merge to
// regenerate, because either side of derived output is as good as the other. Run by `prepare`.
import { execFileSync } from 'node:child_process';

/**
 * Runs `git config` in the current repository. Git is found on PATH, because its place differs per machine: Homebrew,
 * /usr/bin.
 *
 * @param {...string} args - The arguments after `git config`.
 */
function gitConfig(...args) {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git's place differs per machine
    execFileSync('git', ['config', ...args], { stdio: 'ignore' });
}

try {
    gitConfig('merge.docgenRegenerate.name', 'Generated docs: keep ours, regenerate after');
    gitConfig('merge.docgenRegenerate.driver', 'true');
} catch (error) {
    // Not a git checkout (an image build or an exported tree): there is no merge to configure. Say so, and do not fail.
    console.warn(`installMergeDrivers: the merge driver was not configured (${String(error)})`);
}
