/**
 * Guard for the workspace-boundaries ratchet (`scripts/boundariesRatchet.mjs`).
 *
 * `turbo boundaries` reports every import of a package that the importing workspace does not declare.
 * Fixing the three production phantoms (`@commise/i18n` and `@commise/features-core` in web,
 * `@commise/features-core` in mobile) took the count from 210 to 135, but the remainder is a real
 * backlog. Measured 2026-08-12 on turbo 2.9.18: 187 diagnostics across 3102 files in 34 packages — 175
 * of the undeclared-dependency rule, 8 type-only-import, and 4 imports-outside-package. By dependency
 * that is 77 `@testing-library/*` devDependency gaps, 56 `k6` (including the 8 type-only ones in
 * `@kitchensink/loadtest`, where `@types/k6` IS declared but the imports are real runtime imports the k6
 * binary resolves, so they cannot become `import type`), 14 `yaml`, one genuine package cycle (`ui` test
 * → `test-utils` → `ui`), and at least one outright false positive (an `import` statement inside a regex
 * literal in `cffShape.test.ts`). Roughly 3 of the total are the local-only `cdk.out` phantoms the
 * script's own docblock warns about, and never appear on a clean checkout.
 *
 * So the gate cannot simply fail on a non-zero count yet. The tempting alternative — run it with
 * `continue-on-error` — is precisely the defect class this repo lost four weeks of production to: a step
 * that is green because nobody reads its result. The ratchet is the honest middle: those diagnostics
 * collapse to 31 distinct (package, dependency, rule) triples, that set is checked in, and the build
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

/**
 * turbo's THIRD rule kind: a relative import that escapes its own package. It looks nothing like the other
 * two — it names no package at all, only the specifier — so the parser classified all four occurrences as
 * `unrecognized` and the gate refused to report, taking `ci / Lint` red with NO actionable list of findings.
 *
 * That refusal is the correct behaviour for an unparseable diagnostic (better a hard stop than a silent
 * under-count), but it makes the gate brittle in a specific way: ANY rule turbo adds in a future release
 * converts this step from "reports violations" into "reports nothing, exits 1". So the shape is now parsed
 * rather than merely tolerated, and these cases pin it.
 */
describe('escaping-import rule (a relative import that leaves its package)', () => {
    /**
     * The real shape, measured against turbo 2.9.18. Note there is no package name anywhere in the
     * message — the only identifying token is the specifier, which is why this needed its own branch.
     */
    function escapes(specifier: string, file: string, root: string = repoRoot): string {
        return [
            `  x import \`${specifier}\` leaves the package`,
            `    ,-[${root}/${file}:19:54]`,
            ' 18 | ',
            ` 19 | import { rewriteExports } from '${specifier}';`,
            '    `----',
            '',
        ].join('\n');
    }

    it('parses the shape instead of refusing the whole report', () => {
        const result = run(
            escapes('../../../../scripts/prepareProdManifest.mjs', 'packages/infra/global/__tests__/a.test.ts') +
                summary(1),
            { pairs: [] },
        );

        expect(result.out).not.toContain('matched no known rule shape');
    });

    /**
     * The baseline key is the target resolved REPO-RELATIVE, not the raw specifier. The same escaping
     * import written from two different directory depths produces two different `../` strings for one
     * target, so keying on the raw specifier would let a move between sibling dirs read as a brand-new
     * violation while silencing the old entry forever.
     */
    it('keys the finding on the resolved target, so the depth of the importer does not matter', () => {
        const baseline = {
            pairs: [
                {
                    package: '@kitchensink/infra-global',
                    dependency: 'scripts/prepareProdManifest.mjs',
                    rule: 'imports-outside-package',
                },
            ],
        };

        const deep = run(
            escapes('../../../../scripts/prepareProdManifest.mjs', 'packages/infra/global/__tests__/a.test.ts') +
                summary(1),
            baseline,
        );
        const shallow = run(
            escapes('../../../scripts/prepareProdManifest.mjs', 'packages/infra/global/a.test.ts') + summary(1),
            baseline,
        );

        expect(deep.code).toBe(0);
        expect(shallow.code).toBe(0);
    });

    it('fails and names the target when a NEW escaping import appears', () => {
        const result = run(
            escapes('../../../../scripts/contractGenerate.mjs', 'packages/infra/global/__tests__/a.test.ts') +
                summary(1),
            { pairs: [] },
        );

        expect(result.code).toBe(1);
        expect(result.out).toContain('scripts/contractGenerate.mjs');
        expect(result.out).toContain('imports-outside-package');
    });

    /**
     * The rule is part of the KEY, not decoration. An escaping import of `x` and an undeclared dependency
     * on `x` are different violations with different fixes, so baselining one must never silence the other.
     */
    it('does not let a baselined escaping import silence an undeclared dependency of the same name', () => {
        const result = run(
            block('scripts/contractOwners.mjs', 'packages/infra/global/__tests__/a.test.ts') + summary(1),
            {
                pairs: [
                    {
                        package: '@kitchensink/infra-global',
                        dependency: 'scripts/contractOwners.mjs',
                        rule: 'imports-outside-package',
                    },
                ],
            },
        );

        expect(result.code).toBe(1);
        expect(result.out).toContain('undeclared-dependency');
    });

    /**
     * A baselined entry may carry a `why`, because these four are a DELIBERATE exception rather than
     * debt to burn down (see the baseline itself), and this repo's other exemption gate — the
     * storage-capacity check in `@kitchensink/contract-gen` — already requires a written reason to
     * opt out. `--update` rewrites the baseline from the parsed report, which knows nothing about
     * reasons, so without this the first `boundaries:update` after any unrelated change would silently
     * strip every explanation and leave four bare entries nobody could account for.
     */
    it('--update preserves the `why` on an entry that is still reported', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'boundaries-ratchet-why-'));
        const baselinePath = path.join(dir, 'baseline.json');
        writeFileSync(
            baselinePath,
            JSON.stringify({
                pairs: [
                    {
                        package: '@kitchensink/infra-global',
                        dependency: 'scripts/prepareProdManifest.mjs',
                        rule: 'imports-outside-package',
                        why: 'repo-root tooling is never packaged; the test needs its pure functions',
                    },
                    {
                        package: '@commise/web',
                        dependency: '@testing-library/react',
                        rule: 'undeclared-dependency',
                        why: 'this one is FIXED and must not survive the rewrite',
                    },
                ],
            }),
        );

        execFileSync(process.execPath, [script, '--stdin', '--baseline', baselinePath, '--update'], {
            input:
                escapes('../../../../scripts/prepareProdManifest.mjs', 'packages/infra/global/__tests__/a.test.ts') +
                summary(1),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const rewritten = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
            pairs: ReadonlyArray<{ dependency: string; why?: string }>;
        };

        expect(rewritten.pairs).toHaveLength(1);
        expect(rewritten.pairs[0]?.dependency).toBe('scripts/prepareProdManifest.mjs');
        expect(rewritten.pairs[0]?.why).toContain('never packaged');
    });

    it('still refuses the report for a genuinely unknown rule shape', () => {
        const invented = [
            '  x something turbo has not invented yet',
            `    ,-[${repoRoot}/packages/infra/global/a.ts:1:1]`,
            '    `----',
            '',
        ].join('\n');

        const result = run(invented + summary(1), { pairs: [] });

        expect(result.code).toBe(1);
        expect(result.out).toContain('matched no known rule shape');
    });
});

/**
 * turbo also emits a diagnostic that is NOT a boundary violation at all: it could not parse a file. It
 * carries no source location, so it fell through to "matched no known rule shape" — which fails the run
 * (right) while telling the reader to go hunting for an unhandled RULE (wrong). Observed for real while
 * another process was mid-write on `packages/utils/identity/src/provisioning.ts`: `tsc --noEmit` on that
 * exact file was clean, and the next run was clean too.
 *
 * So this is its own class, reported as the toolchain failure it is and naming the file, because the two
 * causes have completely different fixes — a genuinely malformed file must be fixed, whereas a file being
 * written underneath the run just needs the run repeated.
 */
describe('unparseable-file diagnostic (a toolchain failure, not a violation)', () => {
    const panic = (file: string): string => `  x failed to parse file ${repoRoot}/${file}: parser panicked\n  | \n\n`;

    it('names the file and calls it a parse failure, not an unknown rule', () => {
        const result = run(panic('packages/utils/identity/src/provisioning.ts') + summary(1), { pairs: [] });

        expect(result.code).toBe(1);
        expect(result.out).toContain('provisioning.ts');
        expect(result.out).not.toContain('matched no known rule shape');
    });

    /**
     * It must never be mistaken for a clean run. A file turbo could not read is a file whose imports were
     * never checked, so passing here would be the silent-success class this whole gate exists to prevent.
     */
    it('fails rather than passing over the file it could not read', () => {
        const result = run(panic('packages/utils/identity/src/provisioning.ts') + summary(1), {
            pairs: [{ package: '@kitchensink/infra-global', dependency: 'yaml', rule: 'undeclared-dependency' }],
        });

        expect(result.code).toBe(1);
    });

    it('still reports real violations found alongside an unparseable file', () => {
        const result = run(
            panic('packages/utils/identity/src/provisioning.ts') +
                block('@testing-library/react', 'packages/apps/commise/web/src/x.test.tsx') +
                summary(2),
            { pairs: [] },
        );

        expect(result.code).toBe(1);
        expect(result.out).toContain('provisioning.ts');
        expect(result.out).toContain('@testing-library/react');
    });
});
