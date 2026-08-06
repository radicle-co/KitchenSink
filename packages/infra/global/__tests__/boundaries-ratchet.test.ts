/**
 * Guard for the workspace-boundaries ratchet (`scripts/boundariesRatchet.mjs`).
 *
 * `turbo boundaries` reports every import of a package that the importing workspace does not declare.
 * Fixing the three production phantoms (`@commise/i18n` and `@commise/features-core` in web,
 * `@commise/features-core` in mobile) took the count from 210 to 135, but the remainder is a real
 * backlog: 135 diagnostics — 127 of the undeclared-dependency rule plus 8 of the type-only-import rule.
 * By dependency that is 77 `@testing-library/*` devDependency gaps, 34 `k6` (26 undeclared + the 8
 * type-only ones in `@kitchensink/loadtest`, where `@types/k6` IS declared but the imports are real
 * runtime imports the k6 binary resolves, so they cannot become `import type`), one genuine package
 * cycle (`ui` test → `test-utils` → `ui`), and at least one outright false positive (an `import`
 * statement inside a regex literal in `cffShape.test.ts`).
 *
 * So the gate cannot simply fail on a non-zero count yet. The tempting alternative — run it with
 * `continue-on-error` — is precisely the defect class this repo lost four weeks of production to: a step
 * that is green because nobody reads its result. The ratchet is the honest middle: those 135 diagnostics
 * collapse to 26 distinct (package, dependency, rule) triples, that set is checked in, and the build
 * fails the moment a triple appears that is NOT in it. Burning the baseline down is follow-up work;
 * letting it grow is a build failure.
 *
 * GRANULARITY, stated because it is a real limitation: the unit is (package, dependency, rule), not
 * per-file. A 43rd `@testing-library/user-event` import inside `@commise/features-recipes` will not
 * fail, because that triple is already baselined. Per-file would churn on every refactor and get
 * disabled. What cannot slip through is a *new* package taking on a *new* undeclared dependency, which
 * is the direction the production defects came from.
 *
 * The script reads `turbo boundaries` output on stdin so this suite can drive it with fixtures instead
 * of shelling out to turbo (fast, hermetic, and able to test the malformed-input paths that a real run
 * would never produce).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const script = path.join(repoRoot, 'scripts/boundariesRatchet.mjs');

/** One `turbo boundaries` diagnostic block, in the real output shape. */
function block(pkg: string, file: string): string {
    return [
        `  x cannot import package \`${pkg}\` because it is not`,
        '  | a dependency',
        `    ,-[${repoRoot}/${file}:11:27]`,
        " 10 | import { cleanup } from '@testing-library/react';",
        ` 11 | import x from '${pkg}';`,
        '    `----',
        '',
    ].join('\n');
}

/** Real runs always end with this summary line; its absence means turbo did not complete. */
function summary(count: number, files = 2508, pkgs = 29): string {
    return `\nChecked ${files} files in ${pkgs} packages, ${count} issues found\n`;
}

interface RunResult {
    readonly code: number;
    readonly out: string;
}

/** @sideEffect Executes the ratchet script with the given stdin and baseline file. */
function run(stdin: string, baseline: unknown, extraArgs: readonly string[] = []): RunResult {
    const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-ratchet-'));
    const baselinePath = path.join(dir, 'baseline.json');
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 4));
    try {
        const out = execFileSync(process.execPath, [script, '--baseline', baselinePath, ...extraArgs], {
            input: stdin,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { code: 0, out };
    } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

const BASELINE = {
    pairs: [
        { package: '@commise/features-recipes', dependency: '@testing-library/user-event' },
        { package: '@commise/features-recipes', dependency: '@testing-library/dom' },
    ],
};

describe('boundaries ratchet', () => {
    it('passes when every reported pair is already baselined', () => {
        const stdin =
            block('@testing-library/user-event', 'packages/apps/commise/features/recipes/src/a.test.tsx') +
            block('@testing-library/dom', 'packages/apps/commise/features/recipes/src/b.test.tsx') +
            summary(2);

        const { code } = run(stdin, BASELINE);
        expect(code).toBe(0);
    });

    it('fails and names the offender when a package takes on a NEW undeclared dependency', () => {
        const stdin =
            block('@testing-library/dom', 'packages/apps/commise/features/recipes/src/b.test.tsx') +
            block('left-pad', 'packages/apps/commise/web/src/new.tsx') +
            summary(2);

        const { code, out } = run(stdin, BASELINE);
        expect(code).not.toBe(0);
        expect(out).toContain('left-pad');
        expect(out).toContain('@commise/web');
    });

    it('fails when a BASELINED dependency appears in a different package', () => {
        // The pair is the unit — @testing-library/dom is baselined for features-recipes only, so the
        // same dependency showing up in a new package is a new violation, not a covered one.
        const stdin = block('@testing-library/dom', 'packages/apps/commise/mobile/src/c.test.tsx') + summary(1);

        const { code, out } = run(stdin, BASELINE);
        expect(code).not.toBe(0);
        expect(out).toContain('@commise/mobile');
    });

    it('passes but reports staleness when a baselined pair is fixed', () => {
        const stdin =
            block('@testing-library/dom', 'packages/apps/commise/features/recipes/src/b.test.tsx') + summary(1);

        const { code, out } = run(stdin, BASELINE);
        expect(code).toBe(0);
        expect(out.toLowerCase()).toContain('stale');
        expect(out).toContain('@testing-library/user-event');
    });

    it('FAILS on empty input rather than reporting success', () => {
        // The whole point. If turbo crashes or its output format changes, zero parsed findings must not
        // read as "no violations" — that is the silent-success defect the ratchet exists to avoid.
        const { code, out } = run('', BASELINE);
        expect(code).not.toBe(0);
        expect(out.toLowerCase()).toMatch(/summary|did not|no output|incomplete/);
    });

    it('FAILS when the summary line is missing, even if diagnostics parsed', () => {
        const stdin = block('@testing-library/dom', 'packages/apps/commise/features/recipes/src/b.test.tsx');

        const { code } = run(stdin, BASELINE);
        expect(code).not.toBe(0);
    });

    it('FAILS when the parsed count disagrees with turbo’s own summary', () => {
        // Guards the parser itself: if the regex silently stops matching a changed output format, the
        // counts diverge and that must be an error rather than a smaller, quieter "pass".
        const stdin =
            block('@testing-library/dom', 'packages/apps/commise/features/recipes/src/b.test.tsx') + summary(99);

        const { code, out } = run(stdin, BASELINE);
        expect(code).not.toBe(0);
        expect(out).toMatch(/99|disagree|mismatch/i);
    });

    it('--update rewrites the baseline to exactly what was reported', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-ratchet-upd-'));
        const baselinePath = path.join(dir, 'baseline.json');
        writeFileSync(baselinePath, JSON.stringify(BASELINE, null, 4));
        const stdin = block('left-pad', 'packages/apps/commise/web/src/new.tsx') + summary(1);

        execFileSync(process.execPath, [script, '--baseline', baselinePath, '--update'], {
            input: stdin,
            encoding: 'utf8',
        });

        const written = JSON.parse(readFileSync(baselinePath, 'utf8'));
        expect(written.pairs).toEqual([
            { package: '@commise/web', dependency: 'left-pad', rule: 'undeclared-dependency' },
        ]);
    });
});
