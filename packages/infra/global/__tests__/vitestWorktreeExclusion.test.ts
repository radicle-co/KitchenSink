import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import picomatch from 'picomatch';

import { baseConfig } from '@kitchensink/vitest';

/**
 * Vitest must not collect test files out of a nested git worktree.
 *
 * ⛔ THIS IS A LOCAL-ONLY FAILURE, WHICH IS EXACTLY WHY IT NEEDS A GUARD. CI clones one tree and has no
 * worktrees, so a root-scoped `vitest run` there collects the package it was pointed at. On a developer's
 * machine the same command walked into every registered worktree — measured 2026-09-04 at **544 test files
 * instead of 20**, of which 282 "failed", every one of them another branch's tests being run under this
 * package's config. A run whose failures are all imaginary is worse than no run: it trains the reader to
 * discount red, and it cost a real diagnostic detour the same day.
 *
 * ⚠️ `.gitignore` DOES list both roots and that is NOT sufficient — vitest resolves `include`/`exclude` with
 * picomatch and never reads `.gitignore`, so the ignore entry buys nothing here. The exclusion has to be in
 * the config.
 *
 * The assertion runs the REAL matcher (`picomatch`, which is vitest's own) over paths taken from
 * `git worktree list`, rather than comparing the exclude array to a literal. A string comparison would pass
 * for a pattern that is subtly wrong — `.worktrees` without the `**` tail matches the directory and none of
 * the files inside it — which is the failure this is built to catch.
 */
describe('the shared vitest config excludes nested worktrees', () => {
    // ⚠️ Spread into a mutable array: picomatch's `Glob` type does not admit a `readonly string[]`.
    const isExcluded = picomatch([...baseConfig.test.exclude]);

    /** Both worktree roots in use: `.worktrees/` for feature branches, `.claude/worktrees/` for agents. */
    const representativePaths = [
        '.worktrees/004-recipe-importing/packages/services/recipe-workers/__tests__/x.test.ts',
        '.claude/worktrees/agent-a99d843d77b5a5ba1/packages/infra/global/__tests__/y.test.ts',
    ];

    it.each(representativePaths)('excludes %s', (candidate) => {
        expect(isExcluded(candidate)).toBe(true);
    });

    it('still collects a test in the real tree — the exclusion is not a blanket', () => {
        expect(isExcluded('packages/infra/global/__tests__/vitestWorktreeExclusion.test.ts')).toBe(false);
        expect(isExcluded('packages/services/recipe-workers/__tests__/parsing/z.test.ts')).toBe(false);
    });

    it('excludes every worktree git actually has registered, not just the two named above', () => {
        // ⛔ Derived from git, never a hardcoded list: a copy of a list cannot detect that the list is
        // incomplete. A worktree added tomorrow under a new root fails this without anyone editing it.
        const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], {
            cwd: path.resolve(import.meta.dirname, '../../../..'),
            encoding: 'utf8',
        });

        const roots = listed
            .split('\n')
            .filter((line) => line.startsWith('worktree '))
            .map((line) => line.slice('worktree '.length))
            .map((absolute) => path.relative(path.resolve(import.meta.dirname, '../../../..'), absolute))
            .filter((relative) => relative !== '' && !relative.startsWith('..'));

        expect(roots.length).toBeGreaterThan(0);

        for (const root of roots) {
            expect(isExcluded(`${root}/packages/anything/__tests__/a.test.ts`)).toBe(true);
        }
    });
});
