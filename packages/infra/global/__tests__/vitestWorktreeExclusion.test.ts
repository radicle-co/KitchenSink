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

    it('excludes every worktree git actually has registered here, however many that is', () => {
        // ⛔ Derived from git, never a hardcoded list: a copy of a list cannot detect that the list is
        // incomplete. A worktree added tomorrow under a NEW root fails this without anyone editing it.
        //
        // ⚠️ DELIBERATELY NOT `expect(roots.length).toBeGreaterThan(0)`, and that assertion is why this
        // suite first went red in CI while passing on every developer machine. A CI runner clones ONE tree
        // and registers no extra worktrees, so `roots` is legitimately EMPTY there — demanding at least one
        // asserts a property of the checkout, not of the config, which is precisely the environment-coupled
        // failure this whole file exists to prevent. The two representative paths above carry the
        // non-vacuous assertion in every environment; this case ADDS the live roots wherever they exist.
        const repoRoot = path.resolve(import.meta.dirname, '../../../..');
        const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], {
            cwd: repoRoot,
            encoding: 'utf8',
        });

        const roots = listed
            .split('\n')
            .filter((line) => line.startsWith('worktree '))
            .map((line) => line.slice('worktree '.length))
            .map((absolute) => path.relative(repoRoot, absolute))
            .filter((relative) => relative !== '' && !relative.startsWith('..'));

        for (const root of roots) {
            expect(isExcluded(`${root}/packages/anything/__tests__/a.test.ts`), `${root} is collectable`).toBe(true);
        }
    });
});
