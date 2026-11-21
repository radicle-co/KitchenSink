#!/usr/bin/env node
// Workspace-boundaries ratchet — owned by this toolchain, not by any repository (owner decision 2026-09-14).
//
//   node boundariesRatchet.mjs [--repo <path>]            check: fail on a NEW (package, dependency, rule) triple
//   node boundariesRatchet.mjs [--repo <path>] --update   record what turbo reports now as the baseline
//
// Seams, for the suite: `--stdin` reads the report from fd 0 instead of spawning turbo; `--baseline <file>` replaces
// the default location; `--turbo-bin <path>` replaces the repository's own `node_modules/.bin/turbo`.
//
// WHY A RATCHET. `turbo boundaries` exits non-zero on any finding and a real tree has a backlog, so gating outright
// blocks everything, while `continue-on-error` is a step nobody reads. The baseline records what exists; growth fails.
// A baselined entry may carry a `why` — a DELIBERATE exception rather than debt — which `--update` carries across a
// rewrite for every entry still reported.
//
// WHY IT SPAWNS TURBO. Piped (`turbo boundaries | node …`), a crashed turbo read as success whenever the ratchet was
// satisfied. Owning the child lets a broken toolchain and a real violation carry different messages, and enforces the
// contract turbo actually has (measured 2.9.18): 0 findings → exit 0 with the word `no`; k findings → exit 1.
//
// ⛔ FINDINGS IN GITIGNORED BUILD OUTPUT ARE NOT COUNTED. turbo walks `dist/` and `cdk.out/`, so a stale build that
// still imports a dependency the source dropped surfaced as a NEW violation, and `--update` would have baselined it
// permanently. Each finding keeps the file turbo PRINTED and that path is put to `git check-ignore`; nothing reads the
// file's text. When git cannot answer, the check counts everything and `--update` refuses to write.
//
// WHERE THE BASELINE LIVES: `boundariesBaseline.json` beside this script (or `$SCQ_BOUNDARIES_BASELINE`), committed to
// the repository. Durable on purpose: it holds hand-written reasons, and a PR that grows it fails the CI GATE.
//
// @sideEffect Spawns turbo (or reads stdin), git; reads/writes the baseline; exits 0 or 1.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

import {
    carryReasons,
    decide,
    defaultBaselinePath,
    excludeIgnored,
    gitIgnoredFiles,
    parseReport,
    reportedIssueCount,
    workspaceDirs,
} from './boundariesCore.mjs';

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

/** @sideEffect Exits the process after printing to stderr. */
function fail(message) {
    console.error(message);
    process.exit(1);
}

let repo;

try {
    repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: argValue('--repo') ?? process.cwd(),
        encoding: 'utf8',
    }).trim();
} catch (error) {
    fail(
        `boundaries-ratchet: ${argValue('--repo') ?? process.cwd()} is not inside a git repository (${error.message.split('\n')[0]}).`,
    );
}

const fromStdin = args.includes('--stdin');
const update = args.includes('--update');
const explicitBaseline = argValue('--baseline');
const baselinePath = explicitBaseline ?? defaultBaselinePath(process.env);
const workspaceTurbo = path.join(repo, 'node_modules/.bin/turbo');
const turboBin = argValue('--turbo-bin') ?? (existsSync(workspaceTurbo) ? workspaceTurbo : 'turbo');

/**
 * Run `turbo boundaries` and return its report, or exit when the child cannot be trusted. Both streams are read:
 * turbo writes to stderr when stdout is a pipe and to stdout on a TTY.
 *
 * @sideEffect Spawns a child process; exits the process on a toolchain failure.
 */
function runTurboBoundaries() {
    const child = spawnSync(turboBin, ['boundaries'], {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    if (child.error !== undefined && child.error !== null) {
        fail(
            `boundaries-ratchet: could not run \`${turboBin} boundaries\` (${child.error.message}) — the check did not run. ` +
                'This is a TOOLCHAIN failure, not a boundaries violation: install dependencies and retry.',
        );
    }

    const report = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    const reportedCount = reportedIssueCount(report);
    const status = child.status;

    if (reportedCount === null) {
        fail(
            `boundaries-ratchet: \`turbo boundaries\` exited ${status ?? `on signal ${child.signal}`} and did not complete — its ` +
                'output carries no "Checked N files in M packages, K issues found" summary. This is a TOOLCHAIN failure, not a ' +
                `boundaries violation. Its output was:\n${report.trimEnd() || '(nothing)'}`,
        );
    }

    // The exit code and the reported count must agree: that agreement is the only evidence turbo's own signal works.
    if ((status === 0) !== (reportedCount === 0)) {
        fail(
            `boundaries-ratchet: \`turbo boundaries\` exited ${status ?? `on signal ${child.signal}`} while reporting ` +
                `${reportedCount === 0 ? 'no issues' : `${reportedCount} issue(s)`} — those are inconsistent, so its result cannot be ` +
                'trusted either way. This is a TOOLCHAIN failure, not a boundaries violation.',
        );
    }

    return { report, reportedCount };
}

let report;
let reportedCount;

if (fromStdin) {
    try {
        report = readFileSync(0, 'utf8');
    } catch {
        report = '';
    }

    reportedCount = reportedIssueCount(report);

    if (reportedCount === null) {
        fail(
            `boundaries-ratchet: turbo boundaries produced no summary line (${report.trim().length === 0 ? 'no output on stdin' : 'output was incomplete'}) ` +
                '— the check did not run. Expected "Checked N files in M packages, K issues found".',
        );
    }
} else {
    ({ report, reportedCount } = runTurboBoundaries());
}

const { findings, parsed, unmapped, unrecognized, unparseable } = parseReport(report, workspaceDirs(repo));
// Only repo-relative paths go to git: one foreign absolute path makes `git check-ignore` reject the WHOLE batch.
const ownedUnread = unparseable.filter((unread) => unread.owned).map((unread) => unread.file);
const ignoreDecision = gitIgnoredFiles(repo, [...findings.map((finding) => finding.file), ...ownedUnread]);

if (ignoreDecision.ignored === null) {
    console.error(
        `boundaries-ratchet: \`git check-ignore\` failed (${ignoreDecision.error}); build output cannot be told from source, so every finding is counted.`,
    );
}

const ignoredFiles = ignoreDecision.ignored ?? new Set();
const { pairs, counted, skipped } = excludeIgnored(findings, ignoredFiles);
const unreadIgnored = ownedUnread.filter((file) => ignoredFiles.has(file));
const unreadSource = unparseable.map((unread) => unread.file).filter((file) => !unreadIgnored.includes(file));

if (parsed !== reportedCount) {
    fail(
        `boundaries-ratchet: parsed ${parsed} diagnostics but turbo reported ${reportedCount} — the parser has drifted from the ` +
            'output format. Fix the parser rather than the baseline.',
    );
}

if (unrecognized.length > 0) {
    fail(
        `boundaries-ratchet: ${unrecognized.length} diagnostic(s) matched no known rule shape, e.g. "${unrecognized[0]}". Refusing to report a partial result.`,
    );
}

// Reported, then falls THROUGH, so the real violations turbo did produce still print. The exit comes at the end.
if (unreadSource.length > 0) {
    console.error(
        `boundaries-ratchet: turbo could not parse ${unreadSource.length} file(s), so their imports were NOT checked. This is a toolchain failure, not a boundary violation:`,
    );
    for (const file of unreadSource) {
        console.error(`  - ${file}`);
    }
    console.error(
        'If the file is being written by another process, re-run. If it is genuinely malformed, fix it — do not baseline it, as there is nothing here to baseline.',
    );
}

if (unmapped.length > 0) {
    fail(
        `boundaries-ratchet: ${unmapped.length} finding(s) could not be attributed to a workspace package, e.g. ${unmapped[0]}. Refusing to report a partial result.`,
    );
}

const SHOWN = 10;

if (unreadIgnored.length > 0) {
    console.log(
        `boundaries-ratchet: turbo could not parse ${unreadIgnored.length} GITIGNORED file(s); not counted, as they are build output:`,
    );
    for (const file of unreadIgnored.slice(0, SHOWN)) {
        console.log(`  - ${file}`);
    }
    if (unreadIgnored.length > SHOWN) {
        console.log(`  … and ${unreadIgnored.length - SHOWN} more`);
    }
}

if (skipped.length > 0) {
    const skippedFiles = [...new Set(skipped.map((finding) => finding.file))];

    console.log(
        `boundaries-ratchet: ${skipped.length} finding(s) in ${skippedFiles.length} GITIGNORED file(s) were not counted — build output. ` +
            'If a file below is a stale build, delete that build output; do not declare or baseline what it imports:',
    );
    for (const finding of skipped.slice(0, SHOWN)) {
        console.log(`  - ${finding.file}${finding.line === null ? '' : `:${finding.line}`} (${finding.dependency})`);
    }
    if (skipped.length > SHOWN) {
        console.log(`  … and ${skipped.length - SHOWN} more`);
    }
}

/** The baseline's entries, `undefined` when there is no file, or a thrown error when it is unreadable. */
function readBaseline() {
    if (!existsSync(baselinePath)) {
        return undefined;
    }

    return JSON.parse(readFileSync(baselinePath, 'utf8')).pairs ?? [];
}

if (update) {
    if (ignoreDecision.ignored === null && (findings.length > 0 || unparseable.length > 0)) {
        fail(
            'boundaries-ratchet: NOT updating the baseline — `git check-ignore` failed, so findings in gitignored build output cannot be excluded and could be recorded permanently. Fix git, then update.',
        );
    }

    // An update regenerates from the parsed report, so a file turbo could not read would be ABSENT from it: a baseline
    // claiming a tree that was never fully checked. Refuse before anything is written.
    if (unreadSource.length > 0) {
        fail(
            `boundaries-ratchet: NOT updating the baseline — ${unreadSource.length} file(s) could not be parsed, so a baseline written now would record a tree that was never fully checked. Fix or re-run first, then update.`,
        );
    }

    let existing = [];

    try {
        existing = readBaseline() ?? [];
    } catch {
        // An unreadable file is replaced; its reasons cannot be carried, and the rewrite says how many it recorded.
    }

    const merged = carryReasons(pairs, existing);

    mkdirSync(path.dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify({ pairs: merged }, null, 4)}\n`);
    console.log(`boundaries-ratchet: baseline updated — ${merged.length} triple(s) recorded at ${baselinePath}.`);
    process.exit(0);
}

let baselined;

try {
    baselined = readBaseline();
} catch (error) {
    fail(`boundaries-ratchet: cannot read the baseline at ${baselinePath} (${error.message}).`);
}

if (baselined === undefined) {
    fail(
        `boundaries-ratchet: no baseline for ${repo} (looked for ${baselinePath}). Every current finding would read as new, so ` +
            'nothing is judged. Record the existing backlog deliberately with `--update`, after reviewing what turbo reports.',
    );
}

const { added, stale } = decide(pairs, baselined);

if (stale.length > 0) {
    console.log(
        `boundaries-ratchet: ${stale.length} baselined entry/entries are now STALE (fixed — remove them with --update):`,
    );
    for (const pair of stale) {
        console.log(`  - ${pair.package} -> ${pair.dependency}`);
    }
}

if (added.length > 0) {
    console.error(`\nboundaries-ratchet: ${added.length} NEW undeclared dependency/dependencies:`);
    for (const pair of added) {
        console.error(`  x ${pair.package} imports ${pair.dependency} without declaring it (${pair.rule})`);

        const at = counted.filter(
            (finding) =>
                finding.package === pair.package &&
                finding.dependency === pair.dependency &&
                finding.rule === pair.rule,
        );

        for (const finding of at.slice(0, 5)) {
            console.error(`      at ${finding.file}${finding.line === null ? '' : `:${finding.line}`}`);
        }
        if (at.length > 5) {
            console.error(`      … and ${at.length - 5} more`);
        }
    }
    console.error(
        '\nDeclare it in that package’s package.json (dependencies for production imports, devDependencies for tests/tooling). ' +
            'Do not add it to the baseline to silence this — the baseline exists for the pre-existing backlog, not for new violations.',
    );
    process.exit(1);
}

if (unreadSource.length > 0) {
    process.exit(1);
}

console.log(`boundaries-ratchet: OK — ${pairs.length} known entry/entries, no new undeclared dependencies.`);
