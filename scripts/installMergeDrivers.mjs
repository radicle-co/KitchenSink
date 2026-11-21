// Installs the `docgenRegenerate` merge driver named in .gitattributes into the repository's own git config, which
// every worktree shares. The driver is `true`: it keeps the current side and leaves the merge to .husky/post-merge to
// regenerate, because either side of derived output is as good as the other. Run by `prepare`.
import { execFileSync } from 'node:child_process';

// The installer runs under `npm install` on a developer's machine, where git lives in different places (Homebrew,
// /usr/bin), so it is found on PATH.
/**
 * Runs `git config` in the current repository.
 *
 * @param {...string} args - The arguments after `git config`.
 */
function gitConfig(...args) {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is found on PATH: its location differs per machine
    execFileSync('git', ['config', ...args], { stdio: 'ignore' });
}

try {
    gitConfig('merge.docgenRegenerate.name', 'Generated docs: keep ours, regenerate after');
    gitConfig('merge.docgenRegenerate.driver', 'true');
} catch {
    // Not a git checkout (an image build or an exported tree): there is no merge to configure.
}
