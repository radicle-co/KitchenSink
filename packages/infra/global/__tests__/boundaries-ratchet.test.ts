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
 * The script accepts `turbo boundaries` output on stdin under `--stdin` so this suite can drive it with
 * fixtures instead of shelling out to turbo (fast, hermetic, and able to test the malformed-input paths
 * that a real run would never produce).
 *
 * ## Why the script SPAWNS turbo rather than being piped into (2026-08-10)
 *
 * The npm scripts used to be `turbo boundaries 2>&1 | node scripts/boundariesRatchet.mjs`. A shell
 * pipeline exits with the status of its LAST command, so `turbo` crashing — or the subcommand not
 * existing on an older turbo — produced exit 0 as long as the ratchet itself was satisfied, and CI's
 * `Workspace boundaries` step was green having checked nothing. `set -o pipefail` is not a fix here:
 * `npm config get script-shell` is unset, so npm runs scripts through `/bin/sh`, which on this machine
 * (and on ubuntu-latest) is `dash` — `set: Illegal option -o pipefail`.
 *
 * So the script owns the child process, and the two conditions get different messages: "turbo could not
 * run / did not complete" is a broken toolchain, "N new triples" is a real violation. The contract it
 * enforces on the child is the one turbo actually has, measured on 2.9.18:
 *
 *   - 0 findings → exit 0 and `Checked N files in M packages, no issues found` (the word `no`, NOT `0`)
 *   - k findings → exit 1 and `… k issues found`
 *
 * Any other combination — a non-zero exit with a clean report, an exit 0 with findings, a missing
 * summary — means turbo did not do what the gate assumes, and is a hard failure.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const script = path.join(repoRoot, 'scripts/boundariesRatchet.mjs');

/**
 * One `turbo boundaries` diagnostic block, in the real output shape.
 *
 * `root` defaults to this checkout, but is overridable so a test can drive the CI path shape. That matters:
 * GitHub checks out to `/home/runner/work/<repo>/<repo>/…`, repeating the repo name, and the parser's
 * original `/^.*?<repo>\//` strip was non-greedy — it cut at the FIRST occurrence and left a path that
 * matched no workspace. Every finding became unattributable and `Lint` failed in CI while passing locally.
 */
function block(pkg: string, file: string, root: string = repoRoot): string {
    return [
        `  x cannot import package \`${pkg}\` because it is not`,
        '  | a dependency',
        `    ,-[${root}/${file}:11:27]`,
        " 10 | import { cleanup } from '@testing-library/react';",
        ` 11 | import x from '${pkg}';`,
        '    `----',
        '',
    ].join('\n');
}

/**
 * Real runs always end with this summary line; its absence means turbo did not complete.
 *
 * ⚠️ `count === 0` renders as the WORD `no`, not `0` — measured against turbo 2.9.18, which prints
 * `Checked 0 files in 1 packages, no issues found`. The parser's original digits-only regex therefore
 * rejected a genuinely clean tree as an unusable report, so the gate would have started failing
 * permanently on the day the baseline was finally burned down to zero.
 */
function summary(count: number, files = 2508, pkgs = 29): string {
    return `\nChecked ${files} files in ${pkgs} packages, ${count === 0 ? 'no' : count} issues found\n`;
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
        // `--stdin` is EXPLICIT rather than sniffed. Deciding between "read the pipe" and "spawn turbo"
        // by inspecting fd 0 would make the gate's behaviour depend on the ambient shape of stdin — a
        // TTY locally, `/dev/null` or an immediately-closed pipe under a CI runner — which is precisely
        // the kind of environment-decided gate strength this whole file exists to prevent.
        const out = execFileSync(process.execPath, [script, '--stdin', '--baseline', baselinePath, ...extraArgs], {
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

/**
 * Run the ratchet in its DEFAULT mode — spawning `turbo boundaries` itself — against a stub `turbo`
 * that emits `report` on the stream and exits with `code`.
 *
 * The stub is handed over explicitly via `--turbo-bin` rather than shadowed onto `PATH`: the real
 * resolution order prefers `<repoRoot>/node_modules/.bin/turbo` (so the workspace's own turbo wins over
 * whatever global copy a developer happens to have), and a PATH stub could not displace it.
 *
 * @param stream - Which stream the stub writes to. turbo 2.9.18 routes both the diagnostics and the
 *                 summary to stderr when stdout is a pipe, and to stdout when it is a TTY, so the
 *                 script reads BOTH and each is covered here.
 * @sideEffect Creates a temp dir holding an executable `turbo` stub and executes the script.
 */
function runSpawned(
    report: string,
    code: number,
    baseline: unknown,
    options: { readonly stream?: 'stdout' | 'stderr'; readonly extraArgs?: readonly string[] } = {},
): RunResult {
    const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-ratchet-spawn-'));
    const baselinePath = path.join(dir, 'baseline.json');
    const reportPath = path.join(dir, 'report.txt');
    const turboBin = path.join(dir, 'turbo');

    writeFileSync(baselinePath, JSON.stringify(baseline, null, 4));
    writeFileSync(reportPath, report);
    writeFileSync(
        turboBin,
        `#!/usr/bin/env bash\ncat ${JSON.stringify(reportPath)} 1>&${options.stream === 'stdout' ? 1 : 2}\nexit ${code}\n`,
    );
    chmodSync(turboBin, 0o755);

    return runWithTurboBin(turboBin, baselinePath, options.extraArgs ?? []);
}

/** @sideEffect Executes the ratchet script in spawning mode against an arbitrary `turbo` path. */
function runWithTurboBin(turboBin: string, baselinePath: string, extraArgs: readonly string[] = []): RunResult {
    try {
        const out = execFileSync(
            process.execPath,
            [script, '--baseline', baselinePath, '--turbo-bin', turboBin, ...extraArgs],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
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

        execFileSync(process.execPath, [script, '--stdin', '--baseline', baselinePath, '--update'], {
            input: stdin,
            encoding: 'utf8',
        });

        const written = JSON.parse(readFileSync(baselinePath, 'utf8'));
        expect(written.pairs).toEqual([
            { package: '@commise/web', dependency: 'left-pad', rule: 'undeclared-dependency' },
        ]);
    });
});

/**
 * The gate's OWN integrity — that it cannot report success for a run that did not happen.
 *
 * Every case here was red against the piped form (`turbo boundaries 2>&1 | node …`), because a shell
 * pipeline yields the last command's status and the ratchet was satisfied in all of them.
 */
describe('the ratchet owns the turbo child, and refuses a run it cannot trust', () => {
    const CLEAN_BASELINE = { pairs: [] };
    const ONE_FINDING = block('@testing-library/dom', 'packages/apps/commise/features/recipes/src/b.test.tsx');

    it('passes on a genuinely clean tree — `no issues found`, exit 0', () => {
        // Also the regression for the digits-only summary regex: turbo writes the WORD `no`, so the
        // old parser called a fully burned-down tree "an unusable report" and exited 1 forever.
        const { code, out } = runSpawned(`Checking packages...${summary(0)}`, 0, CLEAN_BASELINE);

        expect(code).toBe(0);
        expect(out).toContain('OK');
    });

    it('passes when turbo exits 1 with findings that are all baselined (its normal shape)', () => {
        const { code } = runSpawned(ONE_FINDING + summary(1), 1, {
            pairs: [{ package: '@commise/features-recipes', dependency: '@testing-library/dom' }],
        });

        expect(code).toBe(0);
    });

    it('reads the report from STDOUT too, since turbo picks the stream by TTY-ness', () => {
        const { code } = runSpawned(
            ONE_FINDING + summary(1),
            1,
            {
                pairs: [{ package: '@commise/features-recipes', dependency: '@testing-library/dom' }],
            },
            { stream: 'stdout' },
        );

        expect(code).toBe(0);
    });

    it('FAILS when turbo exits non-zero while reporting a CLEAN tree', () => {
        // ⛔ THE DEFECT THE COPILOT REVIEW NAMED, in its purest form: the ratchet is satisfied (nothing
        // to compare), the child failed, and the old pipeline returned 0. Nothing else in this file
        // catches it — every other case has a report the ratchet can object to on its own.
        const { code, out } = runSpawned(`Checking packages...${summary(0)}`, 3, CLEAN_BASELINE);

        expect(code).not.toBe(0);
        expect(out).toMatch(/exited 3/);
        expect(out).toMatch(/no issues|inconsisten/i);
    });

    it('FAILS when turbo exits 0 while reporting findings', () => {
        // The mirror image, and the more dangerous direction: a turbo that stops signalling findings
        // through its exit code would make every OTHER consumer of `turbo boundaries` silently green.
        const { code, out } = runSpawned(ONE_FINDING + summary(1), 0, {
            pairs: [{ package: '@commise/features-recipes', dependency: '@testing-library/dom' }],
        });

        expect(code).not.toBe(0);
        expect(out).toMatch(/exited 0/);
    });

    it('FAILS with a TOOLCHAIN message when turbo crashes without completing', () => {
        // An older turbo answers `unknown command: boundaries`; a crashed one truncates. Both must be
        // distinguishable in the log from "you introduced a violation", which is a different fix.
        const { code, out } = runSpawned('error: unrecognized subcommand `boundaries`\n', 2, CLEAN_BASELINE);

        expect(code).not.toBe(0);
        expect(out).toMatch(/did not complete|could not/i);
        expect(out).toContain('unrecognized subcommand');
        expect(out).not.toMatch(/NEW undeclared/);
    });

    it('FAILS with a TOOLCHAIN message when the turbo binary is not there at all', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-ratchet-missing-'));
        const baselinePath = path.join(dir, 'baseline.json');
        writeFileSync(baselinePath, JSON.stringify(CLEAN_BASELINE));

        const { code, out } = runWithTurboBin(path.join(dir, 'no-such-turbo'), baselinePath);

        expect(code).not.toBe(0);
        expect(out).toMatch(/could not run/i);
        expect(out).toMatch(/ENOENT|no-such-turbo/);
    });

    it('spawns turbo for --update too, so `boundaries:update` cannot record a phantom baseline', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-ratchet-upd-spawn-'));
        const baselinePath = path.join(dir, 'baseline.json');
        writeFileSync(baselinePath, JSON.stringify(CLEAN_BASELINE));

        const failed = runWithTurboBin(path.join(dir, 'no-such-turbo'), baselinePath, ['--update']);

        expect(failed.code).not.toBe(0);
        // …and the baseline is untouched, rather than rewritten to an empty set.
        expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual(CLEAN_BASELINE);
    });

    it('resolves the workspace turbo by default, without --turbo-bin', () => {
        // Pins the production resolution path: `node_modules/.bin/turbo` must be what a bare invocation
        // runs, or every assertion above is about a code path CI never takes.
        expect(existsSync(path.join(repoRoot, 'node_modules/.bin/turbo'))).toBe(true);
        expect(readFileSync(script, 'utf8')).toContain('node_modules/.bin/turbo');
    });
});

describe('checkout-root independence', () => {
    /**
     * GitHub checks out to `/home/runner/work/<repo>/<repo>/…` — the repo name appears TWICE. The parser
     * used to strip `/^.*?KitchenSink\//`, which is non-greedy, so it cut at the first occurrence and left
     * `KitchenSink/packages/…`: a path matching no workspace directory. All 153 findings became
     * unattributable, the ratchet refused to report a partial result (correctly), and `ci / Lint` failed on
     * a run that was green locally, where the path contains the name once.
     *
     * Pinned with the real runner shape rather than a generic double segment, and paired with an
     * unrelated-root case so the parser cannot go back to depending on what the repo is called.
     */
    it("attributes findings under GitHub's doubled checkout path", () => {
        const ci = '/home/runner/work/KitchenSink/KitchenSink';
        const result = run(
            block('@testing-library/react', 'packages/apps/commise/web/src/x.test.tsx', ci) + summary(1),
            {
                pairs: [
                    { package: '@commise/web', dependency: '@testing-library/react', rule: 'undeclared-dependency' },
                ],
            },
        );

        expect(result.out).not.toContain('could not be attributed');
        expect(result.code).toBe(0);
    });

    it('does not depend on the repository being named KitchenSink', () => {
        const renamed = '/srv/ci/some-other-name';
        const result = run(
            block('@testing-library/react', 'packages/apps/commise/web/src/x.test.tsx', renamed) + summary(1),
            {
                pairs: [
                    { package: '@commise/web', dependency: '@testing-library/react', rule: 'undeclared-dependency' },
                ],
            },
        );

        expect(result.out).not.toContain('could not be attributed');
        expect(result.code).toBe(0);
    });
});
