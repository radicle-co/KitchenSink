import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtureRepo, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import { findRepoRoot } from '../src/repoRoot.js';

describe('findRepoRoot', () => {
    let repo: FixtureRepo;

    beforeEach(() => {
        repo = makeFixtureRepo({ 'a/b/file.txt': 'x\n' });
        execFileSync('git', ['init', '-q'], { cwd: repo.root });
    });
    afterEach(() => repo.remove());

    it('finds the top of the repository from a folder deep inside it, as npm leaves a script in its package folder', () => {
        expect(findRepoRoot(join(repo.root, 'a/b'))).toBe(realpathSync(repo.root));
    });

    it('prefers the folder the user typed the command in (INIT_CWD) to the folder npm moved to', () => {
        mkdirSync(join(repo.root, 'pkg'));

        expect(findRepoRoot(join(repo.root, 'a'), join(repo.root, 'pkg'))).toBe(realpathSync(repo.root));
    });

    it('throws, naming the folder, outside any repository', () => {
        expect(() => findRepoRoot('/')).toThrow(/not inside a git repository/u);
    });
});
