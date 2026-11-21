// Installs the `docgenRegenerate` merge driver named in .gitattributes into the repository's own git config, which
// every worktree shares. The driver is `true`: it keeps the current side and leaves the merge to .husky/post-merge to
// regenerate, because either side of derived output is as good as the other. Run by `prepare`.
import { execFileSync } from 'node:child_process';

try {
    execFileSync('git', ['config', 'merge.docgenRegenerate.name', 'Generated docs: keep ours, regenerate after'], {
        stdio: 'ignore',
    });
    execFileSync('git', ['config', 'merge.docgenRegenerate.driver', 'true'], { stdio: 'ignore' });
} catch {
    // Not a git checkout (an image build or an exported tree): there is no merge to configure.
}
