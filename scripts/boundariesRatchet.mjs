/**
 * Workspace-boundaries ratchet.
 *
 * Runs `turbo boundaries` and fails when a workspace package imports a package it does not declare AND
 * that (package, dependency, rule) triple is not in the recorded baseline. Existing violations are
 * tolerated; new ones are a build failure.
 *
 * WHY A RATCHET AND NOT A PLAIN GATE. `turbo boundaries` exits non-zero on any finding, and the tree
 * currently has 187 across 3102 files in 34 packages (175 undeclared-dependency + 8 type-only-import +
 * 4 imports-outside-package; measured 2026-08-12, turbo 2.9.18, and ~3 of those are the local `cdk.out`
 * phantoms described below) — by dependency that is 77 `@testing-library/*` devDependency gaps, 56 k6
 * runtime imports, 14 `yaml`, one genuine package cycle (`ui` test -> `test-utils` -> `ui`), and at
 * least one false positive (an `import` statement inside a regex literal in `cffShape.test.ts`). Gating
 * outright would block every PR. The
 * obvious alternative — `continue-on-error` — is the exact defect class that cost this repository four
 * weeks of production: a step that is green because nobody reads its result. So the baseline is explicit
 * and checked in, and growth is a failure.
 *
 * A baselined entry may also carry a `why`, for the case where a finding is a DELIBERATE exception rather
 * than debt queued for burn-down. `--update` preserves it across a rewrite for every entry still reported,
 * and drops it with the entry when the finding is gone, so a stale exemption cannot outlive what it
 * excused. The `why` is the difference between recording a decision and silencing a gate.
 *
 * WHY IT SPAWNS TURBO ITSELF (changed 2026-08-10 — PR #91 review). The npm scripts used to be
 * `turbo boundaries 2>&1 | node scripts/boundariesRatchet.mjs`, and a shell pipeline exits with the
 * status of its LAST command. So `turbo` crashing — or `boundaries` not existing on an older turbo —
 * yielded exit 0 whenever the ratchet itself was satisfied, and CI's `Workspace boundaries` step was
 * green having verified nothing. That is the same silent-success class the ratchet exists to avoid,
 * reproduced in the gate's own plumbing.
 *
 * `set -o pipefail` is NOT the fix: `npm config get script-shell` is unset, so npm runs scripts through
 * `/bin/sh`, which is `dash` here and on ubuntu-latest — `set: Illegal option -o pipefail`. Owning the
 * child process removes the pipeline entirely and, more importantly, lets the two conditions get
 * DIFFERENT messages: a broken toolchain is not a boundaries violation and has a different fix.
 *
 * THE CONTRACT IT ENFORCES ON THE CHILD, measured against turbo 2.9.18 rather than assumed:
 *   - 0 findings → exit 0, and `Checked N files in M packages, no issues found` — the WORD `no`, not `0`
 *   - k findings → exit 1, and `… k issues found`
 * Anything else (non-zero exit with a clean report, exit 0 with findings, or no summary at all) means
 * turbo did not do what this gate assumes, and is a hard failure rather than a quiet pass.
 *
 * WHY A STDIN PATH STILL EXISTS. Under `--stdin` the report is read from fd 0, which keeps the decision
 * logic hermetic and lets its own suite drive it with fixtures — including the malformed-input cases a
 * real run would never produce. The flag is EXPLICIT rather than sniffed from fd 0's shape: a gate whose
 * strength depends on whether stdin happens to be a TTY, a closed pipe or `/dev/null` under some
 * runner is a gate decided by its environment, which is what this change is undoing.
 *
 * ⚠️ IF THIS REPORTS FINDINGS YOU DID NOT CAUSE, RUN `git clean -Xdf` FIRST — do not declare them and do
 * not baseline them. `turbo boundaries` walks the package directory including GITIGNORED BUILD OUTPUT, and
 * a `cdk synth` leaves `packages/infra/global/cdk.out/asset.<hash>/` full of CDK's OWN bundled provider
 * functions, which import `@aws-sdk/client-lambda`, `client-s3` and `client-sfn`. Those then surface as
 * three "NEW undeclared dependencies" of `@kitchensink/infra-global`, whose committed source imports none
 * of them. Measured 2026-08-07: deleting `cdk.out` alone takes the run from 3 findings back to OK.
 *
 * CI never sees this — no `cdk.out` exists on a clean checkout — which is precisely what makes it a trap:
 * it appears only to whoever just ran a synth, it names real npm packages, and it tells them to declare
 * them. Both plausible reactions are wrong. Adding the dependency ships three unused packages; adding a
 * baseline entry silences that (package, dependency) pair PERMANENTLY, including for a real violation
 * later. An automated attribution filter was tried and removed: deciding "is this a real import?" by
 * textual search counts mentions in comments and test strings, so it was unreliable in both directions —
 * worse than the documented workaround it replaced.
 *
 * @sideEffect Spawns `turbo boundaries` (or reads stdin under `--stdin`), reads/writes the baseline
 *             file, reads the workspace manifests, exits the process with 0 (no new violations) or 1
 *             (new violations, an unusable report, or a turbo that did not run correctly).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASELINE = path.join(repoRoot, 'scripts/boundaries-baseline.json');
const DEFAULT_RULE = 'undeclared-dependency';

/**
 * turbo's own end-of-run summary. `(\d+|no)` because a clean run prints the WORD `no`, which the
 * original digits-only pattern rejected as "no summary line" — so the gate would have started failing
 * permanently on the day the baseline was finally burned down to zero.
 */
const SUMMARY = /Checked\s+(\d+)\s+files?\s+in\s+(\d+)\s+packages?,\s+(\d+|no)\s+issues?\s+found/;

/** The workspace's own turbo, preferred over any globally installed copy. */
const WORKSPACE_TURBO = path.join(repoRoot, 'node_modules/.bin/turbo');

/**
 * Every workspace package's directory paired with its name, longest path first so a nested workspace
 * wins over its parent when both prefix a file path.
 *
 * @sideEffect Shells out to git and reads manifests from disk.
 * @returns {ReadonlyArray<{dir: string, name: string}>}
 */
function workspaceDirs() {
    const manifests = execFileSync('git', ['ls-files', '*package.json'], { cwd: repoRoot, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules') && !file.includes('prod.package.json'));

    const dirs = [];
    for (const file of manifests) {
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));
        } catch {
            continue;
        }
        const dir = file.replace(/\/?package\.json$/, '');
        if (typeof manifest.name === 'string' && dir.length > 0) {
            dirs.push({ dir, name: manifest.name });
        }
    }
    return dirs.sort((a, b) => b.dir.length - a.dir.length);
}

/**
 * Turns a `turbo boundaries` report into the set of violating (package, dependency, rule) triples.
 *
 * Pure: given the same report and workspace layout it always yields the same triples.
 *
 * @param {string} report
 * @param {ReadonlyArray<{dir: string, name: string}>} dirs
 * @returns {{pairs: ReadonlyArray<{package: string, dependency: string, rule: string}>, parsed: number, unmapped: ReadonlyArray<string>, unrecognized: ReadonlyArray<string>, unparseable: ReadonlyArray<string>}}
 */
export function parseReport(report, dirs) {
    const seen = new Map();
    const unmapped = [];
    const unrecognized = [];
    const unparseable = [];

    // Split on the diagnostic marker rather than matching one message shape. turbo emits several rule
    // kinds and hard-wraps each message at an unpredictable column, so classifying per BLOCK is
    // what keeps the parsed total equal to turbo's own summary. The three kinds seen here are
    // "cannot import package X because it is not a dependency"; "importing from a type declaration
    // package, but import is not declared as a type-only import" — the latter currently only the k6 load
    // scripts, where @types/k6 IS declared but the imports are real runtime imports resolved by the k6
    // binary and so cannot become `import type`; and "import `X` leaves the package", a RELATIVE import
    // that escapes its own workspace.
    //
    // That third kind names no package at all — only the specifier — so it matches neither of the other
    // two branches and, until it was given its own, sent every occurrence to `unrecognized`. The gate then
    // (correctly) refused to report a partial result, which took `ci / Lint` red while printing NO
    // actionable list. Parsing it keeps the refusal for genuinely unknown shapes without letting a rule
    // turbo already ships disable the whole step.
    const blocks = report.split(/^\s{2}x\s/m).slice(1);

    for (const block of blocks) {
        // Not a boundary finding at all: turbo could not READ the file. It carries no source location, so
        // it used to fall through to "matched no known rule shape" — failing the run (right) while pointing
        // the reader at an unhandled RULE (wrong). Its own class, because the two causes have opposite
        // fixes: a genuinely malformed file must be repaired, whereas a file being written underneath the
        // run (observed live on `provisioning.ts` while another process held it — `tsc --noEmit` on that
        // exact file was clean, and the next run was too) just needs the run repeated.
        const unreadable = block.match(/^failed to parse file\s+([^\n]*?)(?::\s*[^\n]*)?$/m);
        if (unreadable !== null) {
            unparseable.push(unreadable[1].trim());
            continue;
        }

        const location = block.match(/,-\[([^:\]]+)/);
        if (location === null) {
            unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
            continue;
        }
        // Match the workspace by looking for `<dir>/` ANYWHERE in the absolute path, rather than first
        // stripping a checkout root. The previous version stripped `/^.*?KitchenSink\//`, which is
        // non-greedy and therefore cut at the FIRST occurrence of the repo name — fine locally
        // (`/home/me/Development/KitchenSink/packages/…`) and broken on GitHub, whose checkout path repeats
        // it (`/home/runner/work/KitchenSink/KitchenSink/packages/…`). That left `KitchenSink/packages/…`,
        // which matches no workspace dir, so all 153 findings became unattributable and the run refused to
        // report a partial result. Not knowing the checkout root is the point: nothing here should depend on
        // where the repo happens to live, or on it being named KitchenSink at all.
        //
        // `dirs` is sorted longest-first, so a nested workspace wins over its parent.
        const absolute = location[1];
        const owner = dirs.find((candidate) => absolute.includes(`/${candidate.dir}/`));
        const relative = owner === undefined ? absolute : absolute.slice(absolute.indexOf(`/${owner.dir}/`) + 1);
        if (owner === undefined) {
            unmapped.push(relative);
            continue;
        }

        const named = block.match(/cannot import package .([^`'"]+)./);
        let dependency;
        let rule;
        if (named !== null) {
            dependency = named[1];
            rule = DEFAULT_RULE;
        } else if (/type declaration package/.test(block)) {
            // The message does not name the package, so take it from the offending import line and
            // reduce a subpath specifier to its package root (k6/http -> k6).
            const specifier = block.match(/from\s+['"]([^'"]+)['"]/);
            if (specifier === null) {
                unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
                continue;
            }
            const spec = specifier[1];
            dependency = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);
            rule = 'type-only-import';
        } else if (/leaves the package/.test(block)) {
            const escaping = block.match(/import\s+.([^`'"]+). leaves the package/);
            if (escaping === null) {
                unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
                continue;
            }
            // Key on the target resolved REPO-RELATIVE, not on the raw specifier. One target imported from
            // two directory depths yields two different `../` strings (`../../../../scripts/x.mjs` and
            // `../../../scripts/x.mjs` are the same file), so a raw-specifier key would read a file move
            // between sibling directories as a brand-new violation while silencing the old entry forever.
            // The repo root is derived from the owner's own directory rather than a checkout-root constant,
            // for the same reason the attribution above is: nothing here may depend on where the repo lives.
            const root = absolute.slice(0, absolute.indexOf(`/${owner.dir}/`) + 1);
            const resolved = path.resolve(path.dirname(absolute), escaping[1]);
            dependency = resolved.startsWith(root) ? resolved.slice(root.length) : resolved;
            rule = 'imports-outside-package';
        } else {
            unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
            continue;
        }

        seen.set(`${owner.name} ${dependency} ${rule}`, { package: owner.name, dependency, rule });
    }

    const pairs = [...seen.values()].sort(
        (a, b) =>
            a.package.localeCompare(b.package) ||
            a.dependency.localeCompare(b.dependency) ||
            a.rule.localeCompare(b.rule),
    );
    return { pairs, parsed: blocks.length, unmapped, unrecognized, unparseable };
}

/**
 * Decides the outcome by comparing what was reported against what is baselined. A baseline entry with
 * no explicit `rule` is treated as the common undeclared-dependency kind.
 *
 * Pure.
 *
 * @param {ReadonlyArray<{package: string, dependency: string, rule?: string}>} reported
 * @param {ReadonlyArray<{package: string, dependency: string, rule?: string}>} baselined
 * @returns {{added: ReadonlyArray<object>, stale: ReadonlyArray<object>}}
 */
export function decide(reported, baselined) {
    const key = (pair) => `${pair.package} ${pair.dependency} ${pair.rule ?? DEFAULT_RULE}`;
    const baselineKeys = new Set(baselined.map(key));
    const reportedKeys = new Set(reported.map(key));

    return {
        added: reported.filter((pair) => !baselineKeys.has(key(pair))),
        stale: baselined.filter((pair) => !reportedKeys.has(key(pair))),
    };
}

/** @sideEffect Reads all of stdin synchronously. @returns {string} */
function readStdin() {
    try {
        return readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

/**
 * How many issues turbo said it found, or `null` when its output carries no summary at all.
 *
 * Pure.
 *
 * @param {string} report
 * @returns {number | null}
 */
function reportedIssueCount(report) {
    const summary = report.match(SUMMARY);

    return summary === null ? null : summary[3] === 'no' ? 0 : Number(summary[3]);
}

/**
 * Run `turbo boundaries` and return its report, or exit the process when the child cannot be trusted.
 *
 * Both streams are concatenated on purpose: turbo 2.9.18 writes the diagnostics AND the summary to
 * stderr when stdout is a pipe, and to stdout when it is a TTY, so reading either one alone works in
 * exactly one of the two situations. `NO_COLOR` keeps ANSI escapes out of the text the parser matches.
 *
 * @param {string} turboBin
 * @sideEffect Spawns a child process; exits the process on a toolchain failure.
 * @returns {{report: string, reportedCount: number}}
 */
function runTurboBoundaries(turboBin) {
    const child = spawnSync(turboBin, ['boundaries'], {
        cwd: repoRoot,
        encoding: 'utf8',
        // The full report on this tree is ~700KB; node's 1MB default would truncate a slightly worse
        // one into an unparseable prefix, which the summary check would then (correctly but
        // confusingly) report as "turbo did not complete".
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    if (child.error !== undefined && child.error !== null) {
        console.error(
            `boundaries-ratchet: could not run \`${turboBin} boundaries\` (${child.error.message}) — the check ` +
                'did not run. This is a TOOLCHAIN failure, not a boundaries violation: install dependencies ' +
                '(`npm ci`) and retry.',
        );
        process.exit(1);
    }

    const report = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    const reportedCount = reportedIssueCount(report);
    // `status` is null when the child was killed by a signal, which is a failure like any other.
    const status = child.status;

    // A report with no summary line is not a report. Treating a crashed or truncated run as "zero
    // findings" is how a broken tool turns into a green build.
    if (reportedCount === null) {
        console.error(
            `boundaries-ratchet: \`turbo boundaries\` exited ${status ?? `on signal ${child.signal}`} and did ` +
                'not complete — its output carries no "Checked N files in M packages, K issues found" summary. ' +
                'This is a TOOLCHAIN failure, not a boundaries violation. Its output was:\n' +
                `${report.trimEnd() || '(nothing)'}`,
        );
        process.exit(1);
    }

    // The exit code and the reported count must agree, because that agreement is the ONLY evidence that
    // turbo's own finding signal still works. A non-zero exit on a clean report is the defect this
    // rewrite was opened for (it used to be masked by the pipeline); an exit 0 with findings would mean
    // every other consumer of `turbo boundaries` had gone silently green.
    const expected = reportedCount === 0 ? 0 : 1;
    if ((status === 0) !== (expected === 0)) {
        console.error(
            `boundaries-ratchet: \`turbo boundaries\` exited ${status ?? `on signal ${child.signal}`} while ` +
                `reporting ${reportedCount === 0 ? 'no issues' : `${reportedCount} issue(s)`} — those are ` +
                'inconsistent, so its result cannot be trusted either way. Expected exit 0 with no issues, or ' +
                'a non-zero exit with at least one. This is a TOOLCHAIN failure, not a boundaries violation.',
        );
        process.exit(1);
    }

    return { report, reportedCount };
}

const args = process.argv.slice(2);
/** Read the report from fd 0 instead of spawning turbo. The suite's hermetic path — see the docblock. */
const fromStdin = args.includes('--stdin');
const baselinePath = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : DEFAULT_BASELINE;
/** Test seam, mirroring `--baseline`: which turbo to spawn. Defaults to the workspace's own. */
const turboBin = args.includes('--turbo-bin')
    ? args[args.indexOf('--turbo-bin') + 1]
    : existsSync(WORKSPACE_TURBO)
      ? WORKSPACE_TURBO
      : 'turbo';
const update = args.includes('--update');

let report;
let reportedCount;

if (fromStdin) {
    report = readStdin();
    const counted = reportedIssueCount(report);

    if (counted === null) {
        const detail = report.trim().length === 0 ? 'no output on stdin' : 'output was incomplete';
        console.error(
            `boundaries-ratchet: turbo boundaries produced no summary line (${detail}) — the check did not run.\n` +
                'Expected "Checked N files in M packages, K issues found". Pipe it in:\n' +
                '  turbo boundaries 2>&1 | node scripts/boundariesRatchet.mjs --stdin',
        );
        process.exit(1);
    }

    reportedCount = counted;
} else {
    ({ report, reportedCount } = runTurboBoundaries(turboBin));
}

const { pairs, parsed, unmapped, unrecognized, unparseable } = parseReport(report, workspaceDirs());

// If the parser and turbo disagree on how many findings there were, the parser has drifted from the
// output format. A smaller, quieter number would silently shrink the ratchet's coverage.
if (parsed !== reportedCount) {
    console.error(
        `boundaries-ratchet: parsed ${parsed} diagnostics but turbo reported ${reportedCount} — the ` +
            'parser has drifted from the output format. Fix the parser rather than the baseline.',
    );
    process.exit(1);
}

if (unrecognized.length > 0) {
    console.error(
        `boundaries-ratchet: ${unrecognized.length} diagnostic(s) matched no known rule shape, e.g. ` +
            `"${unrecognized[0]}". Refusing to report a partial result.`,
    );
    process.exit(1);
}

// A file turbo could not read is a file whose imports were never checked, so this can never pass — that
// would be the silent-success class the whole gate exists to prevent. It is reported and then falls
// THROUGH to the normal violation report rather than exiting here, because the findings turbo did manage
// to produce are still worth printing: exiting early would hide every real violation behind one unreadable
// file, and make a transient mid-write collision look like the only problem in the tree.
if (unparseable.length > 0) {
    console.error(
        `boundaries-ratchet: turbo could not parse ${unparseable.length} file(s), so their imports were ` +
            'NOT checked. This is a toolchain failure, not a boundary violation:',
    );
    for (const file of unparseable) {
        console.error(`  - ${file}`);
    }
    console.error(
        'If the file is being written by another process, re-run. If it is genuinely malformed, fix it — ' +
            'do not baseline it, as there is nothing here to baseline.',
    );
}

if (unmapped.length > 0) {
    console.error(
        `boundaries-ratchet: ${unmapped.length} finding(s) could not be attributed to a workspace ` +
            `package, e.g. ${unmapped[0]}. Refusing to report a partial result.`,
    );
    process.exit(1);
}

if (update) {
    // ⛔ An unparseable file is fatal HERE, before anything is written — unlike the check path, which defers
    // its exit so real violations print first. `--update` regenerates the baseline from the parsed report, so
    // a file turbo could not read would simply be ABSENT from it: the baseline would then be a claim about a
    // tree that was never fully analyzed, the next run would compare against it happily, and CI would be green
    // over that file's imports forever. Exiting 0 having written it was the silent-success class this whole
    // gate exists to prevent. The message above already says it: there is nothing here to baseline.
    if (unparseable.length > 0) {
        console.error(
            `boundaries-ratchet: NOT updating the baseline — ${unparseable.length} file(s) could not be ` +
                'parsed, so a baseline written now would record a tree that was never fully checked. Fix or ' +
                're-run first, then update.',
        );
        process.exit(1);
    }

    // Carry each surviving entry's `why` across the rewrite. An entry may document WHY it is a deliberate
    // exception rather than debt to burn down, and `--update` regenerates the file from the parsed report,
    // which knows nothing about reasons. Without this merge the first `boundaries:update` after any
    // unrelated change would silently strip every explanation, leaving bare entries that read as
    // unexplained debt — and the next engineer would either "fix" a deliberate exception or re-silence a
    // real violation. A `why` on an entry that is NO LONGER reported is dropped along with the entry,
    // which is the point: a stale exemption should not outlive the thing it excused.
    let reasons = new Map();
    try {
        const existing = JSON.parse(readFileSync(baselinePath, 'utf8')).pairs ?? [];
        reasons = new Map(
            existing
                .filter((entry) => typeof entry.why === 'string' && entry.why.length > 0)
                .map((entry) => [`${entry.package} ${entry.dependency} ${entry.rule ?? DEFAULT_RULE}`, entry.why]),
        );
    } catch {
        // No readable baseline yet — `--update` is also how the file is first created.
    }

    const merged = pairs.map((pair) => {
        const why = reasons.get(`${pair.package} ${pair.dependency} ${pair.rule}`);
        return why === undefined ? pair : { ...pair, why };
    });

    writeFileSync(baselinePath, `${JSON.stringify({ pairs: merged }, null, 4)}\n`);
    console.log(`boundaries-ratchet: baseline updated — ${merged.length} triple(s) recorded.`);
    process.exit(0);
}

let baselined = [];
try {
    baselined = JSON.parse(readFileSync(baselinePath, 'utf8')).pairs ?? [];
} catch {
    console.error(`boundaries-ratchet: cannot read baseline at ${baselinePath}. Create it with --update.`);
    process.exit(1);
}

const { added, stale } = decide(pairs, baselined);

if (stale.length > 0) {
    console.log(
        `boundaries-ratchet: ${stale.length} baselined entry/entries are now STALE (fixed — please ` +
            'remove them from the baseline with --update):',
    );
    for (const pair of stale) {
        console.log(`  - ${pair.package} -> ${pair.dependency}`);
    }
}

if (added.length > 0) {
    console.error(`\nboundaries-ratchet: ${added.length} NEW undeclared dependency/dependencies:`);
    for (const pair of added) {
        console.error(`  x ${pair.package} imports ${pair.dependency} without declaring it (${pair.rule})`);
    }
    console.error(
        '\nDeclare it in that package’s package.json (dependencies for production imports, ' +
            'devDependencies for tests/tooling). Do not add it to the baseline to silence this — the ' +
            'baseline exists for the pre-existing backlog, not for new violations.',
    );
    process.exit(1);
}

// Reported above, but the exit is deferred to here so real violations print first. An unreadable file means
// part of the tree went unchecked, so "OK" would be a lie even with an otherwise clean report.
if (unparseable.length > 0) {
    process.exit(1);
}

console.log(`boundaries-ratchet: OK — ${pairs.length} known entry/entries, no new undeclared dependencies.`);
