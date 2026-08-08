/**
 * Workspace-boundaries ratchet.
 *
 * Reads `turbo boundaries` output on stdin and fails when a workspace package imports a package it does
 * not declare AND that (package, dependency, rule) triple is not in the recorded baseline. Existing
 * violations are tolerated; new ones are a build failure.
 *
 * WHY A RATCHET AND NOT A PLAIN GATE. `turbo boundaries` exits non-zero on any finding, and the tree
 * currently has 135 (127 undeclared-dependency + 8 type-only-import) — by dependency that is 77
 * `@testing-library/*` devDependency gaps, 34 k6 runtime imports, one genuine package cycle (`ui` test
 * -> `test-utils` -> `ui`), and at least one false positive (an `import` statement inside a regex
 * literal in `cffShape.test.ts`). Gating outright would block every PR. The
 * obvious alternative — `continue-on-error` — is the exact defect class that cost this repository four
 * weeks of production: a step that is green because nobody reads its result. So the baseline is explicit
 * and checked in, and growth is a failure.
 *
 * WHY IT READS STDIN. Taking the report on stdin keeps the decision logic hermetic and lets its own
 * suite drive it with fixtures, including the malformed-input cases a real run would never produce.
 * The npm script supplies the real thing: `turbo boundaries 2>&1 | node scripts/boundariesRatchet.mjs`.
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
 * @sideEffect Reads stdin, reads/writes the baseline file, reads the workspace manifests, exits the
 *             process with 0 (no new violations) or 1 (new violations, or an unusable report).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASELINE = path.join(repoRoot, 'scripts/boundaries-baseline.json');
const DEFAULT_RULE = 'undeclared-dependency';

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
 * @returns {{pairs: ReadonlyArray<{package: string, dependency: string, rule: string}>, parsed: number, unmapped: ReadonlyArray<string>, unrecognized: ReadonlyArray<string>}}
 */
export function parseReport(report, dirs) {
    const seen = new Map();
    const unmapped = [];
    const unrecognized = [];

    // Split on the diagnostic marker rather than matching one message shape. turbo emits at least two
    // rule kinds and hard-wraps each message at an unpredictable column, so classifying per BLOCK is
    // what keeps the parsed total equal to turbo's own summary. The two kinds seen here are
    // "cannot import package X because it is not a dependency", and "importing from a type declaration
    // package, but import is not declared as a type-only import" — the latter currently only the k6 load
    // scripts, where @types/k6 IS declared but the imports are real runtime imports resolved by the k6
    // binary and so cannot become `import type`.
    const blocks = report.split(/^\s{2}x\s/m).slice(1);

    for (const block of blocks) {
        const location = block.match(/,-\[([^:\]]+)/);
        if (location === null) {
            unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
            continue;
        }
        const relative = location[1].replace(/^.*?KitchenSink\//, '');
        const owner = dirs.find((candidate) => relative.startsWith(`${candidate.dir}/`));
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
    return { pairs, parsed: blocks.length, unmapped, unrecognized };
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

const args = process.argv.slice(2);
const baselinePath = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : DEFAULT_BASELINE;
const update = args.includes('--update');

const report = readStdin();

// A report that does not carry turbo's own summary line is not a report. Treating an empty or truncated
// one as "zero findings" is how a crashed tool turns into a green build — refuse it loudly instead.
const summary = report.match(/Checked\s+(\d+)\s+files?\s+in\s+(\d+)\s+packages?,\s+(\d+)\s+issues?\s+found/);
if (summary === null) {
    const detail = report.trim().length === 0 ? 'no output on stdin' : 'output was incomplete';
    console.error(
        `boundaries-ratchet: turbo boundaries produced no summary line (${detail}) — the check did not run.\n` +
            'Expected "Checked N files in M packages, K issues found". Pipe it in:\n' +
            '  turbo boundaries 2>&1 | node scripts/boundariesRatchet.mjs',
    );
    process.exit(1);
}
const reportedCount = Number(summary[3]);

const { pairs, parsed, unmapped, unrecognized } = parseReport(report, workspaceDirs());

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

if (unmapped.length > 0) {
    console.error(
        `boundaries-ratchet: ${unmapped.length} finding(s) could not be attributed to a workspace ` +
            `package, e.g. ${unmapped[0]}. Refusing to report a partial result.`,
    );
    process.exit(1);
}

if (update) {
    writeFileSync(baselinePath, `${JSON.stringify({ pairs }, null, 4)}\n`);
    console.log(`boundaries-ratchet: baseline updated — ${pairs.length} triple(s) recorded.`);
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

console.log(`boundaries-ratchet: OK — ${pairs.length} known entry/entries, no new undeclared dependencies.`);
