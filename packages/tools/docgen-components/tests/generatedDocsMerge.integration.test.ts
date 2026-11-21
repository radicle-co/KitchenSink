// @vitest-environment node
/**
 * Two PRs that each change a component change the same aggregate lines of `docs/generated/components` (`totals`,
 * `coverage`, `counts`), so every pair of parallel PRs conflicted on derived output that `generatedOutput.integration`
 * already refuses to let go stale. The cure is three parts, and each is proved here against real git:
 *
 *   1. `.gitattributes` gives every generator output folder the `docgenRegenerate` merge driver. The folders are read
 *      from `config.ts`, which is the generator's own list, so a third output folder cannot be forgotten.
 *   2. The root `prepare` script runs the installer, since nothing else puts the driver on a machine.
 *   3. The driver keeps the current side (`installMergeDrivers.mjs` sets it to `true`), so the merge ends with no
 *      conflict, and the one after-merge script (`bin/afterMerge.ts`, run by `.husky/post-merge` and, for a merge
 *      commit, by `.husky/post-commit`) regenerates when the INCOMING side changed either folder. It reads the
 *      incoming side because the driver hides a both-sides change from the merge result.
 *
 * The merge is run in a temp repository that holds the real `.gitattributes`, so dropping the attribute makes the
 * merge conflict again and the test fail. Not covered, by design: GitHub's own conflict check ignores custom drivers,
 * a rebase runs neither hook, and `git merge --squash` leaves no merge commit to read (CI's generated-docs check
 * still fails stale output for both).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { COMPONENTS_OUT_DIR, DESIGN_OUT_DIR, REPO_ROOT } from '../src/config.js';

const OUT_DIRS = [COMPONENTS_OUT_DIR, DESIGN_OUT_DIR] as const;
const INSTALLER = join(REPO_ROOT, 'scripts/installMergeDrivers.mjs');
const POST_MERGE = join(REPO_ROOT, '.husky/post-merge');
const POST_COMMIT = join(REPO_ROOT, '.husky/post-commit');
const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx');
const AFTER_MERGE = join(REPO_ROOT, 'packages/tools/docgen-components/bin/afterMerge.ts');
const TOTALS_FILE = `${COMPONENTS_OUT_DIR}/index.json`;

/** Git is found on PATH through env, as `bin/afterMerge.ts` finds it: its place differs per machine. */
const ENV = '/usr/bin/env';
const SH = '/bin/sh';

const git = (cwd: string, ...args: string[]): string =>
    execFileSync(ENV, ['git', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const scratch: string[] = [];

afterEach(() => {
    for (const directory of scratch.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** The workspace the hooks name, as the real repository has it, so the hook files run unchanged in a temp repo. */
const WORKSPACE_DIR = 'packages/tools/docgen-components';
const WORKSPACE_NAME = '@kitchensink/docgen-components';

/** The stub `docs:generate`: records a call in `DOCGEN_CALLS_FILE`, and edits the tracked totals file as a real run does. */
const RECORD_CALL =
    "const fs = require('node:fs'); fs.appendFileSync(process.env.DOCGEN_CALLS_FILE, 'generate\\n'); fs.appendFileSync(process.env.DOCGEN_TOTALS_FILE, '\\n')";

/**
 * A repository with the real `.gitattributes`, one totals file on `main`, the driver installed when asked, and a
 * minimal copy of the workspace the hooks run: its `docs:after-merge` is the real script, and its `docs:generate`
 * only records that it ran (`RECORD_CALL`).
 */
function makeRepo(installDriver: boolean): string {
    const repo = mkdtempSync(join(tmpdir(), 'docgenMerge-'));
    scratch.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    copyFileSync(join(REPO_ROOT, '.gitattributes'), join(repo, '.gitattributes'));

    if (installDriver) {
        execFileSync(process.execPath, [INSTALLER], { cwd: repo });
    }

    mkdirSync(join(repo, WORKSPACE_DIR), { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, workspaces: [WORKSPACE_DIR] }), 'utf8');
    writeFileSync(
        join(repo, WORKSPACE_DIR, 'package.json'),
        JSON.stringify({
            name: WORKSPACE_NAME,
            version: '0.0.0',
            scripts: {
                'docs:after-merge': `${JSON.stringify(TSX)} ${JSON.stringify(AFTER_MERGE)}`,
                'docs:generate': `${JSON.stringify(process.execPath)} -e "${RECORD_CALL}"`,
            },
        }),
        'utf8',
    );
    writeTotals(repo, 10);
    git(repo, 'add', '.gitattributes', 'package.json', WORKSPACE_DIR, TOTALS_FILE);
    git(repo, 'commit', '-qm', 'base');

    return repo;
}

function writeTotals(repo: string, components: number): void {
    mkdirSync(join(repo, COMPONENTS_OUT_DIR), { recursive: true });
    writeFileSync(
        join(repo, TOTALS_FILE),
        `{\n    "totals": { "components": ${String(components)} },\n    "schemaVersion": 1\n}\n`,
        'utf8',
    );
}

/**
 * Two branches that change the same totals line differently, then `prA` merges `prB`. `noCommit` stops the merge before
 * its commit, as the squad's own merges do, so the caller commits it.
 */
function mergeTwoPrs(
    repo: string,
    { noCommit = false }: { readonly noCommit?: boolean } = {},
): { readonly merged: boolean; readonly text: string } {
    git(repo, 'checkout', '-qb', 'prA');
    writeTotals(repo, 11);
    git(repo, 'commit', '-qam', 'A adds a component');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'checkout', '-qb', 'prB');
    writeTotals(repo, 12);
    git(repo, 'commit', '-qam', 'B adds a component');
    git(repo, 'checkout', '-q', 'prA');

    let merged = true;

    try {
        git(repo, 'merge', '-q', noCommit ? '--no-commit' : '--no-edit', '--no-ff', 'prB');
    } catch {
        merged = false;
    }

    return { merged, text: readFileSync(join(repo, TOTALS_FILE), 'utf8') };
}

describe('the output folders carry the merge driver', () => {
    it.each(OUT_DIRS)('%s and its subfolders are attributed to docgenRegenerate', (directory) => {
        const files = [`${directory}/index.json`, `${directory}/groups/a.json`];
        const out = git(REPO_ROOT, 'check-attr', 'merge', '--', ...files);

        expect(out.trim().split('\n')).toEqual(files.map((file) => `${file}: merge: docgenRegenerate`));
    });
});

describe('a checkout installs the driver', () => {
    it('runs the installer from the root prepare script, so every npm install sets it up', () => {
        const manifest = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');

        expect(manifest).toMatch(/"prepare":\s*"[^"]*node scripts\/installMergeDrivers\.mjs/u);
    });
});

describe('a merge of two PRs that change the same totals line', () => {
    it('conflicts without the driver, which is what this exists to cure', () => {
        const { merged } = mergeTwoPrs(makeRepo(false));

        expect(merged).toBe(false);
    });

    it('ends with no conflict and the current side kept, with the driver installed', () => {
        const { merged, text } = mergeTwoPrs(makeRepo(true));

        expect(merged).toBe(true);
        expect(text).toContain('"components": 11');
        expect(text).not.toContain('<<<<<<<');
    });
});

describe('the hooks regenerate when the incoming side changed an output folder', () => {
    /**
     * Runs a real hook file the way git does, from the repository root, and returns how many times `docs:generate` ran.
     * The hook starts the script through `npm run --workspace`, so the script runs from the workspace folder, which is
     * the directory a hook never shares with a test that starts the script itself.
     */
    function generations(repo: string, hook: string): number {
        const log = join(repo, 'calls.txt');
        execFileSync(SH, [hook], {
            cwd: repo,
            env: { ...process.env, DOCGEN_CALLS_FILE: log, DOCGEN_TOTALS_FILE: join(repo, TOTALS_FILE) },
            stdio: 'ignore',
        });

        try {
            return readFileSync(log, 'utf8').trim().split('\n').length;
        } catch {
            return 0;
        }
    }

    /** `main` merges a branch that changed `changed`, a file `main` never touched. */
    function mergeOfUntouchedFile(changed: string): string {
        const repo = makeRepo(true);
        git(repo, 'checkout', '-qb', 'feature');
        mkdirSync(join(repo, changed, '..'), { recursive: true });
        writeFileSync(join(repo, changed), 'x\n', 'utf8');
        git(repo, 'add', changed);
        git(repo, 'commit', '-qm', 'feature');
        git(repo, 'checkout', '-q', 'main');
        writeFileSync(join(repo, 'other.txt'), 'y\n', 'utf8');
        git(repo, 'add', 'other.txt');
        git(repo, 'commit', '-qm', 'main moves');
        git(repo, 'merge', '-q', '--no-edit', 'feature');

        return repo;
    }

    it.each(OUT_DIRS)(
        'post-merge runs docs:generate when a file under %s changed on the incoming side',
        (directory) => {
            expect(generations(mergeOfUntouchedFile(`${directory}/groups/a.json`), POST_MERGE)).toBe(1);
        },
    );

    it('post-merge does nothing when the merge touched neither folder', () => {
        expect(generations(mergeOfUntouchedFile('packages/x/readme.md'), POST_MERGE)).toBe(0);
    });

    /**
     * The case the driver exists for. Both sides changed the same generated file, and the `true` driver keeps ours, so
     * the merge result shows NO change to it: only the incoming side's own diff tells the script to regenerate.
     */
    it('post-merge runs docs:generate once when both sides changed the same generated file', () => {
        const repo = makeRepo(true);
        expect(mergeTwoPrs(repo).merged).toBe(true);

        expect(generations(repo, POST_MERGE)).toBe(1);
    });

    it('post-commit runs docs:generate once for a merge made with --no-commit and committed by hand', () => {
        const repo = makeRepo(true);
        expect(mergeTwoPrs(repo, { noCommit: true }).merged).toBe(true);
        git(repo, 'commit', '-qm', 'merge prB');

        expect(generations(repo, POST_COMMIT)).toBe(1);
    });

    it('post-commit does nothing for a commit that is not a merge', () => {
        const repo = mergeOfUntouchedFile(`${COMPONENTS_OUT_DIR}/groups/a.json`);
        writeFileSync(join(repo, 'plain.txt'), 'z\n', 'utf8');
        git(repo, 'add', 'plain.txt');
        git(repo, 'commit', '-qm', 'plain');

        expect(generations(repo, POST_COMMIT)).toBe(0);
    });

    it('post-merge runs docs:generate after a fast-forward pull that changed an output folder', () => {
        const repo = makeRepo(true);
        git(repo, 'checkout', '-qb', 'feature');
        writeTotals(repo, 11);
        git(repo, 'commit', '-qam', 'feature adds a component');
        git(repo, 'checkout', '-q', 'main');
        git(repo, 'merge', '-q', '--ff-only', 'feature');

        expect(generations(repo, POST_MERGE)).toBe(1);
    });
});

describe('a hook leaves the regenerated files to the author', () => {
    it('neither stages nor commits what the regeneration changed', () => {
        const repo = makeRepo(true);
        expect(mergeTwoPrs(repo).merged).toBe(true);
        const head = git(repo, 'rev-parse', 'HEAD');

        execFileSync(SH, [POST_MERGE], {
            cwd: repo,
            env: {
                ...process.env,
                DOCGEN_CALLS_FILE: join(repo, 'calls.txt'),
                DOCGEN_TOTALS_FILE: join(repo, TOTALS_FILE),
            },
            stdio: 'ignore',
        });

        expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
        expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
        expect(git(repo, 'diff', '--name-only').trim()).toBe(TOTALS_FILE);
    });
});
